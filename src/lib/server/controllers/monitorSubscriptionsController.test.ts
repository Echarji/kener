import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, subscriberQueue, cache, siteData, subscriptionsConfig } = vi.hoisted(() => ({
  db: {
    getMonitorByTag: vi.fn(),
    getActiveIncidentComments: vi.fn(),
    getMonitorsByIncidentId: vi.fn(),
    getMaintenanceById: vi.fn(),
    getMonitorsByMaintenanceId: vi.fn(),
    getMaintenanceEventsByMaintenanceId: vi.fn(),
  },
  subscriberQueue: { push: vi.fn() },
  cache: new Map<string, { status: string; ts: number }>(),
  siteData: {
    siteURL: "https://status.example.com",
    siteName: "Example",
    colors: {},
    globalMaintenanceNotificationSettings: {
      reminder_buffer_hours: 1,
      event_types: { created: true, reminder: true, started: true, ended: true },
    },
  } as Record<string, unknown>,
  subscriptionsConfig: {
    value: { enable: true, methods: { emails: { incidents: true, maintenances: true } } } as Record<string, unknown>,
  },
}));
vi.mock("../db/db.js", () => ({ default: db }));
vi.mock("../queues/subscriberQueue.js", () => ({ default: subscriberQueue }));
vi.mock("../cache/setGet.js", () => ({
  GetSubscriberLastStatus: vi.fn(async (tag: string) => cache.get(tag) ?? null),
  SetSubscriberLastStatus: vi.fn(async (tag: string, value: { status: string; ts: number }) => {
    cache.set(tag, value);
  }),
}));
vi.mock("./siteDataController.js", () => ({
  GetAllSiteData: vi.fn(async () => siteData),
  GetSiteDataByKey: vi.fn(async (key: string) => (key === "subscriptionsSettings" ? subscriptionsConfig.value : null)),
}));

import { NotifyMonitorStatusChange, NotifyMonitorsAddedToMaintenance } from "./monitorSubscriptionsController.js";

const NOW = Math.floor(Date.now() / 1000);

describe("NotifyMonitorStatusChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    subscriptionsConfig.value = { enable: true, methods: { emails: { incidents: true, maintenances: true } } };
    db.getMonitorByTag.mockResolvedValue({ tag: "api", name: "Public API", status: "ACTIVE", is_hidden: "NO" });
  });

  it("only starts tracking on the first status it sees", async () => {
    await NotifyMonitorStatusChange("api", 60, "UP");

    expect(subscriberQueue.push).not.toHaveBeenCalled();
    expect(cache.get("api")).toEqual({ status: "UP", ts: 60 });
  });

  it("emails only the monitor's subscribers when the status changes", async () => {
    await NotifyMonitorStatusChange("api", 60, "UP");
    await NotifyMonitorStatusChange("api", 120, "UP");
    await NotifyMonitorStatusChange("api", 180, "DOWN");

    expect(subscriberQueue.push).toHaveBeenCalledOnce();
    const [variables, options, audience] = subscriberQueue.push.mock.calls[0];
    expect(variables).toMatchObject({
      event_type: "monitors",
      title: "Public API is Down",
      cta_url: "https://status.example.com/monitors/api",
      monitor_tag: "api",
      monitor_status: "DOWN",
      monitor_previous_status: "UP",
      is_down: true,
      is_up: false,
      is_monitor_update: true,
    });
    expect(options).toEqual({ deduplication: { id: "subscriber-monitors-api-180" } });
    expect(audience).toEqual({ monitorTags: ["api"], monitorsOnly: true });
  });

  it("emails again on recovery", async () => {
    await NotifyMonitorStatusChange("api", 60, "DOWN");
    await NotifyMonitorStatusChange("api", 120, "DEGRADED");
    await NotifyMonitorStatusChange("api", 180, "UP");

    expect(subscriberQueue.push.mock.calls.map(([variables]) => variables.monitor_status)).toEqual(["DEGRADED", "UP"]);
  });

  it("ignores a status older than the last one seen", async () => {
    await NotifyMonitorStatusChange("api", 180, "UP");
    await NotifyMonitorStatusChange("api", 120, "DOWN");

    expect(subscriberQueue.push).not.toHaveBeenCalled();
    expect(cache.get("api")).toEqual({ status: "UP", ts: 180 });
  });

  it("sends nothing for a maintenance window the monitor leaves as it entered it", async () => {
    await NotifyMonitorStatusChange("api", 60, "UP");
    await NotifyMonitorStatusChange("api", 120, "MAINTENANCE");
    await NotifyMonitorStatusChange("api", 180, "UP");

    expect(subscriberQueue.push).not.toHaveBeenCalled();
  });

  it("keeps tracking but sends nothing for a hidden monitor or when monitor subscriptions are off", async () => {
    db.getMonitorByTag.mockResolvedValue({ tag: "api", name: "Public API", status: "ACTIVE", is_hidden: "YES" });
    await NotifyMonitorStatusChange("api", 60, "UP");
    await NotifyMonitorStatusChange("api", 120, "DOWN");

    db.getMonitorByTag.mockResolvedValue({ tag: "api", name: "Public API", status: "ACTIVE", is_hidden: "NO" });
    subscriptionsConfig.value = {
      enable: true,
      methods: { emails: { incidents: true, maintenances: true, monitors: false } },
    };
    await NotifyMonitorStatusChange("api", 180, "UP");

    expect(subscriberQueue.push).not.toHaveBeenCalled();
    expect(cache.get("api")).toEqual({ status: "UP", ts: 180 });
  });

  it("never throws, so a failure cannot fail the monitoring job", async () => {
    await NotifyMonitorStatusChange("api", 60, "UP");
    db.getMonitorByTag.mockRejectedValue(new Error("connection reset"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(NotifyMonitorStatusChange("api", 120, "DOWN")).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("NotifyMonitorsAddedToMaintenance", () => {
  const maintenance = { id: 7, title: "Database upgrade", description: null, status: "ACTIVE" };

  beforeEach(() => {
    vi.clearAllMocks();
    (siteData.globalMaintenanceNotificationSettings as { event_types: { created: boolean } }).event_types.created =
      true;
    db.getMaintenanceById.mockResolvedValue(maintenance);
    db.getMonitorsByMaintenanceId.mockResolvedValue([
      { monitor_tag: "api", monitor_name: "Public API", monitor_impact: "MAINTENANCE" },
      { monitor_tag: "db", monitor_name: "Database", monitor_impact: "DOWN" },
    ]);
    db.getMaintenanceEventsByMaintenanceId.mockResolvedValue([
      { id: 1, maintenance_id: 7, start_date_time: NOW - 7200, end_date_time: NOW - 3600, status: "COMPLETED" },
      { id: 2, maintenance_id: 7, start_date_time: NOW + 3600, end_date_time: NOW + 7200, status: "SCHEDULED" },
    ]);
  });

  it("emails the added monitors' subscribers about the next window", async () => {
    await NotifyMonitorsAddedToMaintenance(7, ["db"]);

    expect(subscriberQueue.push).toHaveBeenCalledOnce();
    const [variables, , audience] = subscriberQueue.push.mock.calls[0];
    expect(variables).toMatchObject({
      event_type: "maintenances",
      update_id: "maintenance_2_monitors_added",
      monitor_tag: "db",
      monitor_name: "Database",
      is_monitor_update: true,
      is_maintenance: true,
    });
    expect(variables.update_text).toContain("now also affects <strong>Database</strong>");
    expect(audience).toEqual({ monitorTags: ["db"], monitorsOnly: true });
  });

  it("sends nothing for a hidden monitor, an inactive maintenance, or one with no window ahead", async () => {
    await NotifyMonitorsAddedToMaintenance(7, ["hidden-monitor"]);

    db.getMaintenanceById.mockResolvedValue({ ...maintenance, status: "INACTIVE" });
    await NotifyMonitorsAddedToMaintenance(7, ["db"]);

    db.getMaintenanceById.mockResolvedValue(maintenance);
    db.getMaintenanceEventsByMaintenanceId.mockResolvedValue([
      { id: 1, maintenance_id: 7, start_date_time: NOW - 7200, end_date_time: NOW - 3600, status: "COMPLETED" },
    ]);
    await NotifyMonitorsAddedToMaintenance(7, ["db"]);

    expect(subscriberQueue.push).not.toHaveBeenCalled();
  });

  it("sends nothing when maintenance creation notifications are turned off", async () => {
    (siteData.globalMaintenanceNotificationSettings as { event_types: { created: boolean } }).event_types.created =
      false;

    await NotifyMonitorsAddedToMaintenance(7, ["db"]);

    expect(subscriberQueue.push).not.toHaveBeenCalled();
  });
});
