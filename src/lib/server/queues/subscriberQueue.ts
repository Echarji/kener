/**
 * Subscriber Queue - receives subscription variable data and trigger id
 * Finds all subscribers for a given trigger and sends emails via senderQueue
 */

import { Queue, Worker, Job, type JobsOptions } from "bullmq";
import q from "./q.js";
import { GetAllSiteData } from "../controllers/controller.js";
import { siteDataToVariables } from "../notification/notification_utils.js";
import type { SubscriptionVariableMap } from "../notification/types.js";
import { GetGeneralEmailTemplateById } from "../controllers/generalTemplateController.js";
import { GetActiveEmailsForEventType, GetActiveEmailsForMonitors } from "../controllers/userSubscriptionsController.js";
import emailQueue from "./emailQueue.js";
let subscriberQueue: Queue | null = null;
let worker: Worker | null = null;
const queueName = "subscriberQueue";
const jobNamePrefix = "subscriberJob";

interface SubscriberJobData {
  variables: SubscriptionVariableMap;
}

const getQueue = () => {
  if (!subscriberQueue) {
    subscriberQueue = q.createQueue(queueName);
  }
  return subscriberQueue;
};

const addWorker = () => {
  if (worker) return worker;

  worker = q.createWorker(getQueue(), async (job: Job): Promise<void> => {
    const { variables } = job.data as SubscriberJobData;

    try {
      // Get site data for template variables
      const siteData = await GetAllSiteData();
      const templateSiteVars = siteDataToVariables(siteData);

      const template = await GetGeneralEmailTemplateById("subscription_update");
      if (!template) {
        throw new Error("Subscription email template not found");
      }
      const emailVars = (() => {
        // monitor_tags/monitor_names are only used to resolve recipients in this worker; the
        // email template engine expects scalars, so keep monitor_list (a string) instead.
        const { monitor_tags: _monitorTags, monitor_names: _monitorNames, ...templateVars } = variables;
        return {
          ...templateSiteVars,
          ...templateVars,
        };
      })();

      const eventType = variables.event_type;

      // Resolve recipients. Monitor-based subscriptions take precedence: when the event carries
      // affected monitor tags only the subscribers of those monitors are notified. Falling back
      // to the legacy event-type query keeps any not-yet-migrated trigger working.
      const monitorTags = variables.monitor_tags || [];
      const subscriberEmails =
        monitorTags.length > 0
          ? await GetActiveEmailsForMonitors(monitorTags)
          : await GetActiveEmailsForEventType(eventType);

      if (subscriberEmails.length === 0) {
        console.log(
          monitorTags.length > 0
            ? `📭 No active subscribers for monitors: ${monitorTags.join(", ")}`
            : `📭 No active subscribers for event type: ${eventType}`,
        );
        return;
      }

      // Queue individual emails for each subscriber (for privacy - no shared recipients)
      for (const email of subscriberEmails) {
        await emailQueue.push({
          toEmails: [email],
          templateHtmlBody: template.template_html_body || "",
          templateSubject: template.template_subject || "Event Update",
          templateTextBody: template.template_text_body || "",
          variables: emailVars,
        });
      }

      console.log(
        `📮 Queued ${subscriberEmails.length} subscription email(s) for ${
          monitorTags.length > 0 ? `monitors: ${monitorTags.join(", ")}` : `event: ${eventType}`
        }`,
      );
    } catch (error) {
      console.error("Error processing subscriber queue job:", error);
      throw error;
    }
  });

  worker.on("completed", (job: Job) => {
    // const { monitor_tags } = job.data as SubscriberJobData;
    // console.log(`✅ Subscriber job completed for monitors: ${monitor_tags.join(", ")}`);
  });

  worker.on("failed", (job: Job | undefined, err: Error) => {
    console.error("❌ Subscriber job failed:", err.message);
  });

  return worker;
};

/**
 * Push a subscriber notification job to the queue
 */
export const push = async (variables: SubscriptionVariableMap, options?: JobsOptions) => {
  if (!options) {
    options = {};
  }
  if (!options) {
    options = {};
  }
  options.removeOnComplete = {
    age: 300, // keep up to 5 minutes
    count: 100, // keep up to 100 jobs
  };
  options.removeOnFail = {
    age: 24 * 3600, // keep up to 24 hours
  };
  const queue = getQueue();
  addWorker();

  // Use deduplication to prevent duplicate notifications for the same event. The id is derived
  // from the event type + update id (which already includes the affected monitor for status
  // changes), so retried pushes collapse into a single delivery.
  const deDupId = `subscriber-${variables.event_type}-${variables.update_id}`;
  if (!options.deduplication) {
    options.deduplication = {
      id: deDupId,
    };
  }

  await queue.add(
    `${jobNamePrefix}_${variables.update_id}`,
    {
      variables,
    },
    options,
  );
};

/**
 * Graceful shutdown
 */
export const shutdown = async () => {
  if (worker) {
    await worker.close();
    worker = null;
  }
};

export default {
  push,
  shutdown,
};
