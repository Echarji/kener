import db from "../db/db.js";
import GC from "../../global-constants.js";
import { format } from "date-fns";
import mdToHTML from "../../marked.js";
import { GetSubscriberLastStatus, SetSubscriberLastStatus } from "../cache/setGet.js";
import subscriberQueue from "../queues/subscriberQueue.js";
import { GetAllSiteData } from "./siteDataController.js";
import { GetSubscriptionsConfig, MonitorSubscriptionsEnabled } from "./userSubscriptionsController.js";
import { maintenanceToVariables, siteDataToVariables } from "../notification/notification_utils.js";
import type { SubscriptionVariableMap } from "../notification/types.js";
import type { IncidentRecord, MaintenanceEventRecordDetailed } from "../types/db.js";
import { GetNowTimestampUTC } from "../tool.js";
import seedSiteData from "../db/seedSiteData.js";

// The statuses a monitor's subscribers are told about when it moves between them. MAINTENANCE is
// announced by the maintenance emails instead.
const STATUS_LABEL: Record<string, string> = {
  [GC.UP]: "Up",
  [GC.DOWN]: "Down",
  [GC.DEGRADED]: "Degraded",
};
const IMPACT_LABEL: Record<string, string> = {
  ...STATUS_LABEL,
  [GC.MAINTENANCE]: "Maintenance",
};

/**
 * Emails a monitor's subscribers when its status moves between UP, DOWN and DEGRADED. Called with
 * every status the monitor records. The last status seen is kept in the cache: the first status seen
 * only starts the tracking, a status older than the last one seen is ignored, and MAINTENANCE neither
 * notifies nor replaces the last status, so a monitor that leaves maintenance as it entered it sends
 * nothing. Never throws: a failure here must not fail the monitoring job that called it.
 */
export async function NotifyMonitorStatusChange(monitorTag: string, ts: number, status: string): Promise<void> {
  try {
    if (!STATUS_LABEL[status]) return;

    const last = await GetSubscriberLastStatus(monitorTag);
    if (last && ts <= last.ts) return;
    await SetSubscriberLastStatus(monitorTag, { status, ts });
    if (!last || last.status === status) return;

    if (!MonitorSubscriptionsEnabled(await GetSubscriptionsConfig())) return;
    const monitor = await db.getMonitorByTag(monitorTag);
    if (!monitor || monitor.status !== GC.ACTIVE || monitor.is_hidden === GC.YES) return;

    const siteUrl = siteDataToVariables(await GetAllSiteData()).site_url;
    const previousLabel = STATUS_LABEL[last.status] || last.status;
    const currentLabel = STATUS_LABEL[status];
    const changedAt = format(new Date(ts * 1000), "PPpp");
    const variables: SubscriptionVariableMap = {
      title: `${monitor.name} is ${currentLabel}`,
      cta_url: `${siteUrl}monitors/${monitor.tag}`,
      cta_text: "View Monitor",
      update_text: mdToHTML(
        `**${monitor.name}** changed from **${previousLabel}** to **${currentLabel}** at ${changedAt}.`,
      ),
      update_subject: `[${monitor.name}] Status changed to ${currentLabel}`,
      update_id: `monitor_${monitor.tag}_${ts}`,
      event_type: "monitors",
      monitor_name: monitor.name,
      monitor_tag: monitor.tag,
      is_monitor_update: true,
      monitor_status: status,
      monitor_previous_status: last.status,
      is_up: status === GC.UP,
      is_down: status === GC.DOWN,
      is_degraded: status === GC.DEGRADED,
    };
    await subscriberQueue.push(
      variables,
      { deduplication: { id: `subscriber-monitors-${monitor.tag}-${ts}` } },
      { monitorTags: [monitor.tag], monitorsOnly: true },
    );
  } catch (err) {
    console.error(`Error sending status change notification for monitor ${monitorTag}:`, err);
  }
}

/**
 * Emails the subscribers of a monitor just added to an incident. Only an unresolved incident that has
 * posted an update sends this: an incident's first update reaches the subscribers of every monitor it
 * has by then, so a monitor added before that update needs no email of its own. Never throws.
 */
export async function NotifyMonitorAddedToIncident(
  incident: Pick<IncidentRecord, "id" | "title" | "state" | "incident_type">,
  monitorTag: string,
): Promise<void> {
  try {
    if (incident.incident_type !== GC.INCIDENT || incident.state === GC.RESOLVED) return;

    const [latestUpdate] = await db.getActiveIncidentComments(incident.id);
    if (!latestUpdate) return;
    // Hidden monitors are left out, as on the status page.
    const monitor = (await db.getMonitorsByIncidentId(incident.id)).find((m) => m.monitor_tag === monitorTag);
    if (!monitor) return;

    const siteUrl = siteDataToVariables(await GetAllSiteData()).site_url;
    const impact = monitor.monitor_impact || "";
    const update =
      `**${monitor.monitor_name}** has been added to this incident` +
      (IMPACT_LABEL[impact] ? ` with impact **${IMPACT_LABEL[impact]}**` : "") +
      `.\n\n**Latest update (${latestUpdate.state}):**\n\n${latestUpdate.comment}`;
    const variables: SubscriptionVariableMap = {
      title: incident.title,
      cta_url: `${siteUrl}incidents/${incident.id}`,
      cta_text: "View Incident",
      update_text: mdToHTML(update),
      update_subject: `[#${incident.id}:${incident.state}] ${monitor.monitor_name} affected: ${incident.title}`,
      update_id: `incident_${incident.id}_monitor_${monitorTag}`,
      event_type: "incidents",
      update_state: incident.state,
      is_investigating: incident.state === GC.INVESTIGATING,
      is_identified: incident.state === GC.IDENTIFIED,
      is_monitoring: incident.state === GC.MONITORING,
      is_resolved: false,
      incident_impact: impact === GC.DOWN || impact === GC.DEGRADED ? impact : "",
      is_down: impact === GC.DOWN,
      is_degraded: impact === GC.DEGRADED,
      monitor_name: monitor.monitor_name,
      monitor_tag: monitorTag,
      is_monitor_update: true,
    };
    await subscriberQueue.push(
      variables,
      { deduplication: { id: `subscriber-incident-monitor-${incident.id}-${monitorTag}` } },
      { monitorTags: [monitorTag], monitorsOnly: true },
    );
  } catch (err) {
    console.error(`Error notifying subscribers of ${monitorTag} added to incident ${incident.id}:`, err);
  }
}

/**
 * Emails the subscribers of monitors just added to a maintenance, about its next window that has not
 * ended. A maintenance that is inactive, or has no such window, sends nothing; so does one whose
 * "created" notifications are turned off, since this email announces the maintenance to new readers.
 * Never throws.
 */
export async function NotifyMonitorsAddedToMaintenance(maintenanceId: number, monitorTags: string[]): Promise<void> {
  try {
    if (monitorTags.length === 0) return;

    const siteData = await GetAllSiteData();
    const notificationSettings =
      siteData.globalMaintenanceNotificationSettings || seedSiteData.globalMaintenanceNotificationSettings;
    if (!notificationSettings.event_types.created) return;

    const maintenance = await db.getMaintenanceById(maintenanceId);
    if (!maintenance || maintenance.status !== GC.ACTIVE) return;

    // Hidden monitors are left out, as on the status page.
    const monitors = await db.getMonitorsByMaintenanceId(maintenanceId);
    const added = monitors.filter((m) => monitorTags.includes(m.monitor_tag));
    if (added.length === 0) return;

    const now = GetNowTimestampUTC();
    const nextEvent = (await db.getMaintenanceEventsByMaintenanceId(maintenanceId)).find(
      (e) => e.end_date_time > now && e.status !== GC.COMPLETED && e.status !== GC.CANCELLED,
    );
    if (!nextEvent) return;

    const event: MaintenanceEventRecordDetailed = {
      ...nextEvent,
      status: nextEvent.status as MaintenanceEventRecordDetailed["status"],
      title: maintenance.title,
      description: maintenance.description || null,
    };
    const monitorNames = monitors.map((m) => `${m.monitor_name}(${m.monitor_impact})`).join(", ");
    const addedNames = added.map((m) => `**${m.monitor_name}**`).join(", ");
    const variables: SubscriptionVariableMap = maintenanceToVariables(
      event,
      monitorNames,
      `now also affects ${addedNames}`,
      "monitors_added",
      "Maintenance Scheduled",
      siteDataToVariables(siteData).site_url,
    );
    if (added.length === 1) {
      variables.monitor_name = added[0].monitor_name;
      variables.monitor_tag = added[0].monitor_tag;
    }
    variables.is_monitor_update = true;

    await subscriberQueue.push(variables, undefined, {
      monitorTags: added.map((m) => m.monitor_tag),
      monitorsOnly: true,
    });
  } catch (err) {
    console.error(`Error notifying subscribers of monitors added to maintenance ${maintenanceId}:`, err);
  }
}
