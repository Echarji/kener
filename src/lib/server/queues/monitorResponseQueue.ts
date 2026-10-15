import type { MonitoringResult } from "../types/monitor.js";
import { Queue, Worker, Job, type JobsOptions } from "bullmq";
import q from "./q.js";
import { InsertMonitoringData, GetAllSiteData } from "../controllers/controller.js";
import { GetLastMonitoringValue, SetLastMonitoringValue } from "../cache/setGet.js";
import alertingQueue from "./alertingQueue.js";
import subscriberQueue from "./subscriberQueue.js";
import db from "../db/db.js";
import GC from "../../global-constants.js";
import mdToHTML from "../../marked.js";
import { siteDataToVariables } from "../notification/notification_utils.js";
import type { SubscriptionVariableMap } from "../notification/types.js";
import type { MonitoringData } from "../types/db.js";
let monitorResponseQueue: Queue | null = null;
let worker: Worker | null = null;
const queueName = "monitorResponseQueue";
const jobNamePrefix = "monitorResponseJob";

interface JobData {
  status: string;
  latency: number;
  type: string;
  monitorTag: string;
  ts: number;
  error_message?: string | null;
  raw_status?: string | null;
}

// Observations that represent the monitor's own check result. Incident/maintenance overlays and
// DEFAULT fills are excluded: their status transitions are communicated by the incident and
// maintenance notifications, not as a monitor status change.
const NOTIFIABLE_TYPES = new Set<string>([GC.REALTIME, GC.TIMEOUT, GC.ERROR]);
const NOTIFIABLE_STATUSES = new Set<string>([GC.UP, GC.DOWN, GC.DEGRADED]);

const getQueue = () => {
  if (!monitorResponseQueue) {
    monitorResponseQueue = q.createQueue(queueName);
  }
  return monitorResponseQueue;
};

/**
 * Notify the subscribers of a monitor when its status changes. Recipients are resolved from the
 * subscribed monitor tag, so only followers of this monitor are emailed.
 */
const notifySubscribersOfStatusChange = async (
  monitorTag: string,
  previousStatus: string,
  newStatus: string,
  ts: number,
): Promise<void> => {
  try {
    const monitor = await db.getMonitorByTag(monitorTag);
    if (!monitor || monitor.is_hidden === GC.YES || monitor.status === "INACTIVE") {
      return;
    }

    const siteData = await GetAllSiteData();
    const siteUrl = siteDataToVariables(siteData).site_url;
    const name = monitor.name || monitorTag;

    const variables: SubscriptionVariableMap = {
      title: `Monitor Status Changed: ${name}`,
      cta_url: `${siteUrl}monitors/${monitorTag}`,
      cta_text: "View Monitor",
      update_text: mdToHTML(`**${name}** changed status from **${previousStatus}** to **${newStatus}**.`),
      update_subject: `[${name}] status changed to ${newStatus}`,
      update_id: `status_${monitorTag}_${ts}`,
      event_type: "status",
      update_state: newStatus,
      is_down: newStatus === GC.DOWN,
      is_degraded: newStatus === GC.DEGRADED,
      monitor_tags: [monitorTag],
      monitor_names: [name],
      monitor_list: name,
    };

    await subscriberQueue.push(variables, {
      deduplication: { id: `subscriber-status-${monitorTag}-${ts}` },
    });
  } catch (err) {
    console.error(`Error sending status-change notification for monitor ${monitorTag}:`, err);
  }
};

const addWorker = () => {
  if (worker) return worker;

  worker = q.createWorker(getQueue(), async (job: Job): Promise<MonitoringData | null> => {
    const { monitorTag, ts, status, latency, type, error_message, raw_status } = job.data as JobData;

    // The status before this observation, used to detect a change worth notifying. Read before
    // the cache is overwritten below.
    const previous = await GetLastMonitoringValue(monitorTag);

    const dbRes = await InsertMonitoringData({
      monitor_tag: monitorTag,
      timestamp: ts,
      status: status,
      latency: latency,
      type: type,
      error_message: error_message,
      raw_status: raw_status,
    });

    if (!dbRes) {
      console.error("Failed to insert monitoring data for monitorTag:", monitorTag, "timestamp:", ts);
      throw new Error("Failed to insert monitoring data");
    }

    await SetLastMonitoringValue(monitorTag, {
      monitor_tag: monitorTag,
      timestamp: ts,
      status: status,
      latency: latency,
      type: type,
    });
    alertingQueue.push(monitorTag, ts, status);

    if (
      NOTIFIABLE_TYPES.has(type) &&
      previous &&
      previous.status != null &&
      NOTIFIABLE_STATUSES.has(previous.status) &&
      NOTIFIABLE_STATUSES.has(status) &&
      previous.status !== status
    ) {
      await notifySubscribersOfStatusChange(monitorTag, previous.status, status, ts);
    }

    return dbRes;
  });

  worker.on("completed", (job: Job, returnvalue: any) => {
    // const { monitorTag, ts, status, latency, type } = job.data as JobData;
    // console.log(`💾 Store: ${monitorTag} @ ${new Date(ts * 1000).toISOString()}`);
  });

  return worker;
};

export const push = async (monitorTag: string, ts: number, result: MonitoringResult, options?: JobsOptions) => {
  const deDupId = `${monitorTag}-${ts}`;
  if (!options) {
    options = {};
  }
  if (!options.deduplication) {
    options.deduplication = {
      id: deDupId,
    };
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
  await queue.add(
    jobNamePrefix + "_" + monitorTag,
    {
      monitorTag,
      ts,
      ...result,
    },
    options,
  );
};

//graceful shutdown
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
