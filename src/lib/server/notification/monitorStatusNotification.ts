import db from "$lib/server/db/db.js";
import GC from "../../global-constants.js";
import mdToHTML from "../../marked.js";
import { GetAllSiteData } from "../controllers/controller.js";
import { siteDataToVariables } from "./notification_utils.js";
import type { SubscriptionVariableMap } from "./types.js";
import subscriberQueue from "../queues/subscriberQueue.js";

const NOTIFIABLE_MONITOR_STATUSES = new Set<string>([GC.UP, GC.DOWN, GC.DEGRADED]);

/**
 * Email the subscribers of a monitor when its status changes. Callers pass the
 * status before and after the sample; no mail is sent for a non-transition or
 * for a monitor that is hidden from the status page.
 */
export async function NotifySubscribersOfMonitorStatusChange(
  monitorTag: string,
  previousStatus: string,
  newStatus: string,
  timestamp: number,
): Promise<void> {
  if (previousStatus === newStatus) return;
  if (!NOTIFIABLE_MONITOR_STATUSES.has(previousStatus) || !NOTIFIABLE_MONITOR_STATUSES.has(newStatus)) return;

  try {
    const monitor = await db.getMonitorByTag(monitorTag);
    if (!monitor || monitor.status !== "ACTIVE" || monitor.is_hidden === "YES") return;

    const siteData = await GetAllSiteData();
    const siteUrl = siteDataToVariables(siteData).site_url;

    const variables: SubscriptionVariableMap = {
      title: `${monitor.name} is ${newStatus}`,
      cta_url: `${siteUrl}monitors/${monitor.tag}`,
      cta_text: "View Monitor",
      update_text: mdToHTML(`**${monitor.name}** changed status from **${previousStatus}** to **${newStatus}**.`),
      update_subject: `[${monitor.name}] Status changed to ${newStatus}`,
      update_id: `${monitor.tag}_${timestamp}`,
      event_type: "monitor_status",
      monitor_tags: [monitor.tag],
      update_state: newStatus,
      incident_impact: newStatus,
      is_down: newStatus === GC.DOWN,
      is_degraded: newStatus === GC.DEGRADED,
    };

    await subscriberQueue.push(variables, {
      deduplication: { id: `subscriber-monitor-${monitor.tag}-${timestamp}` },
    });
  } catch (error) {
    console.error(`Error sending subscriber notification for monitor ${monitorTag}:`, error);
  }
}
