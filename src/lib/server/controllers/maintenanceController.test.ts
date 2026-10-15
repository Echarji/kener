import { beforeEach, describe, expect, it, vi } from "vitest";
import GC from "../../global-constants.js";

const h = vi.hoisted(() => ({
  db: {
    getScheduledEventsStartingSoon: vi.fn(),
    getScheduledEventsAlreadyStarted: vi.fn(),
    getReadyEventsInProgress: vi.fn(),
    getOngoingEventsCompleted: vi.fn(),
    updateMaintenanceEventStatus: vi.fn(),
    getMonitorsByMaintenanceId: vi.fn(),
    getMaintenanceById: vi.fn(),
    getMonitors: vi.fn(),
  },
  GetAllSiteData: vi.fn(),
  subscriberPush: vi.fn(),
}));

vi.mock("../db/db.js", () => ({ default: h.db }));
vi.mock("./controller.js", () => ({ GetAllSiteData: h.GetAllSiteData }));
vi.mock("../queues/subscriberQueue.js", () => ({ default: { push: h.subscriberPush } }));

import { UpdateMaintenanceEventStatuses } from "./maintenanceController.js";

const siteData = {
  siteURL: "https://status.example.com",
  siteName: "Example",
  colors: {},
  globalMaintenanceNotificationSettings: {
    reminder_buffer_hours: 24,
    event_types: { reminder: true, started: true, ended: true },
  },
};

function scheduledEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    maintenance_id: 3,
    title: "Database upgrade",
    description: "Upgrading",
    start_date_time: 2000,
    end_date_time: 2600,
    status: GC.SCHEDULED,
    ...overrides,
  };
}

describe("maintenanceController — notification targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.GetAllSiteData.mockResolvedValue(siteData);
    h.db.getScheduledEventsStartingSoon.mockResolvedValue([]);
    h.db.getScheduledEventsAlreadyStarted.mockResolvedValue([]);
    h.db.getReadyEventsInProgress.mockResolvedValue([]);
    h.db.getOngoingEventsCompleted.mockResolvedValue([]);
    h.db.getMonitorsByMaintenanceId.mockResolvedValue([]);
    h.db.getMaintenanceById.mockResolvedValue({ id: 3, is_global: GC.NO });
    h.db.getMonitors.mockResolvedValue([]);
    h.subscriberPush.mockResolvedValue(undefined);
  });

  it("targets exactly the monitors attached to the maintenance", async () => {
    h.db.getScheduledEventsStartingSoon.mockResolvedValue([scheduledEvent()]);
    h.db.getMonitorsByMaintenanceId.mockResolvedValue([
      { monitor_tag: "api", monitor_name: "API", monitor_impact: "DOWN" },
      { monitor_tag: "web", monitor_name: "Website", monitor_impact: "MAINTENANCE" },
    ]);

    await UpdateMaintenanceEventStatuses();

    expect(h.subscriberPush).toHaveBeenCalledTimes(1);
    const [variables] = h.subscriberPush.mock.calls[0];
    expect(variables.monitor_tags).toEqual(["api", "web"]);
    expect(variables.monitor_list).toBe("API(DOWN), Website(MAINTENANCE)");
  });

  it("falls back to every active non-hidden monitor for a global maintenance without rows", async () => {
    h.db.getScheduledEventsStartingSoon.mockResolvedValue([scheduledEvent()]);
    h.db.getMaintenanceById.mockResolvedValue({ id: 3, is_global: GC.YES });
    h.db.getMonitors.mockResolvedValue([{ tag: "api" }, { tag: "web" }]);

    await UpdateMaintenanceEventStatuses();

    expect(h.db.getMonitors).toHaveBeenCalledWith({ status: GC.ACTIVE, is_hidden: GC.NO });
    const [variables] = h.subscriberPush.mock.calls[0];
    expect(variables.monitor_tags).toEqual(["api", "web"]);
    expect(variables.monitor_list).toBe("All Monitors");
  });

  it("does not fall back for a non-global maintenance without rows", async () => {
    h.db.getScheduledEventsStartingSoon.mockResolvedValue([scheduledEvent()]);
    h.db.getMaintenanceById.mockResolvedValue({ id: 3, is_global: GC.NO });

    await UpdateMaintenanceEventStatuses();

    expect(h.db.getMonitors).not.toHaveBeenCalled();
    const [variables] = h.subscriberPush.mock.calls[0];
    expect(variables.monitor_tags).toEqual([]);
  });

  it("does not notify when the matching event type is disabled", async () => {
    h.db.getScheduledEventsStartingSoon.mockResolvedValue([scheduledEvent()]);
    h.GetAllSiteData.mockResolvedValue({
      ...siteData,
      globalMaintenanceNotificationSettings: {
        reminder_buffer_hours: 24,
        event_types: { reminder: false, started: true, ended: true },
      },
    });

    await UpdateMaintenanceEventStatuses();

    expect(h.subscriberPush).not.toHaveBeenCalled();
  });

  it("notifies per started event with its own monitor scope", async () => {
    h.db.getReadyEventsInProgress.mockResolvedValue([scheduledEvent({ id: 6, maintenance_id: 4, status: GC.READY })]);
    h.db.getMonitorsByMaintenanceId.mockImplementation(async (maintenanceId: number) =>
      maintenanceId === 4 ? [{ monitor_tag: "db", monitor_name: "Database", monitor_impact: "MAINTENANCE" }] : [],
    );

    await UpdateMaintenanceEventStatuses();

    const [variables] = h.subscriberPush.mock.calls[0];
    expect(variables.monitor_tags).toEqual(["db"]);
    expect(variables.update_subject).toContain("Maintenance");
  });
});
