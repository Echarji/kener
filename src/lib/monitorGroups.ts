import type { StatusType } from "$lib/types/status";

/** How a group monitor lays its members out on the status page. */
export type GroupMembersLayout = "list" | "grid";
/** How much each member shows: simple adds its status history bar, compact keeps it to one line. */
export type GroupMembersStyle = "simple" | "compact";

export const GROUP_MEMBERS_LAYOUTS: readonly GroupMembersLayout[] = ["list", "grid"];
export const GROUP_MEMBERS_STYLES: readonly GroupMembersStyle[] = ["simple", "compact"];

export interface GroupDisplay {
  layout: GroupMembersLayout;
  style: GroupMembersStyle;
}

/** What a group that has not chosen shows, including groups saved before the options existed. */
export const DEFAULT_GROUP_DISPLAY: GroupDisplay = { layout: "list", style: "compact" };

/** A group monitor's members display, read from its type_data. Unknown values fall back to the default. */
export function GroupDisplayOf(
  typeData: { membersLayout?: unknown; membersStyle?: unknown } | null | undefined,
): GroupDisplay {
  const layout = GROUP_MEMBERS_LAYOUTS.find((value) => value === typeData?.membersLayout);
  const style = GROUP_MEMBERS_STYLES.find((value) => value === typeData?.membersStyle);
  return { layout: layout ?? DEFAULT_GROUP_DISPLAY.layout, style: style ?? DEFAULT_GROUP_DISPLAY.style };
}

// The layout each visitor picked per group, by group tag, kept in their browser.
export const GROUP_VIEW_STORAGE_KEY = "kener_group_views";

/** The layouts stored for each group, keeping only valid entries. */
export function ParseStoredGroupViews(raw: string | null | undefined): Record<string, GroupMembersLayout> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => GROUP_MEMBERS_LAYOUTS.includes(value as GroupMembersLayout)),
    ) as Record<string, GroupMembersLayout>;
  } catch {
    return {};
  }
}

export type MemberStatusCounts = Record<StatusType, number> & { total: number };

/** How many of a group's members are in each status. Members whose status has not loaded are not counted. */
export function CountMemberStatuses(statuses: Array<StatusType | null | undefined>): MemberStatusCounts {
  const counts: MemberStatusCounts = { UP: 0, DEGRADED: 0, DOWN: 0, MAINTENANCE: 0, NO_DATA: 0, total: 0 };
  for (const status of statuses) {
    if (!status) continue;
    counts[status] = (counts[status] ?? 0) + 1;
    counts.total++;
  }
  return counts;
}

// Worst first: the order a group's member summary lists its statuses in.
const SUMMARY_ORDER: StatusType[] = ["DOWN", "DEGRADED", "MAINTENANCE", "UP", "NO_DATA"];

/** The statuses a group's members are in, worst first, with how many members are in each. */
export function SummarizeMemberStatuses(counts: MemberStatusCounts): Array<{ status: StatusType; count: number }> {
  return SUMMARY_ORDER.filter((status) => counts[status] > 0).map((status) => ({ status, count: counts[status] }));
}

/**
 * The i18n key naming a monitor's or group's current status. A group's status is the one Kener records
 * for the group monitor (see services/groupCall.ts): UP when every member is up, DOWN when every
 * member is down, and DEGRADED in between, by member weight.
 */
export const STATUS_LABEL_KEY: Record<StatusType, string> = {
  UP: "Operational",
  DEGRADED: "Degraded",
  DOWN: "Down",
  MAINTENANCE: "Under Maintenance",
  NO_DATA: "No Status Available",
};

/** The i18n key and count for one entry of a group's member summary, such as "%count down". */
export const MEMBER_SUMMARY_KEY: Record<StatusType, string> = {
  UP: "%count operational",
  DEGRADED: "%count degraded",
  DOWN: "%count down",
  MAINTENANCE: "%count under maintenance",
  NO_DATA: "%count without data",
};
