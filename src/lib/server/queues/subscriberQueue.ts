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
import { GetActiveEmailsForMonitors } from "../controllers/userSubscriptionsController.js";
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

      // Only subscribers following a monitor this event affects receive the
      // mail. Undefined monitor_tags means the event affects every monitor
      // (a global incident or maintenance).
      const { monitor_tags: monitorTags, ...templateVariables } = variables;
      const emailVars = {
        ...templateSiteVars,
        ...templateVariables,
      };

      const subscriberEmails = await GetActiveEmailsForMonitors(monitorTags);

      if (subscriberEmails.length === 0) {
        const scope = monitorTags === undefined ? "all monitors" : monitorTags.join(", ") || "no monitors";
        console.log(`📭 No active subscribers for monitors: ${scope}`);
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

      console.log(`📮 Queued ${subscriberEmails.length} subscription email(s) for event: ${variables.event_type}`);
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

  // Use deduplication to prevent duplicate notifications
  const deDupId = `subscriber-${variables.event_type}-${variables.update_id}-${Date.now()}`;
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
