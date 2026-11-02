import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, subscriberQueue, NotifyMonitorsAddedToMaintenance } = vi.hoisted(() => ({
  db: {
    getMaintenanceById: vi.fn(),
    updateMaintenance: vi.fn(),
    getMaintenanceMonitors: vi.fn(),
    removeAllMonitorsFromMaintenance: vi.fn(),
    addMonitorsToMaintenanceWithStatus: vi.fn(),
    addMonitorToMaintenance: vi.fn(),
    getMonitorByTag: vi.fn(),
    getMaintenanceEventsByMaintenanceId: vi.fn(),
    deleteMaintenanceEvent: vi.fn(),
    createMaintenanceEvent: vi.fn(),
    getMonitorsByMaintenanceId: vi.fn(),
    getMaintenanceEventById: vi.fn(),
    updateMaintenanceEventStatus: vi.fn(),
  },
  subscriberQueue: { push: vi.fn() },
  NotifyMonitorsAddedToMaintenance: vi.fn(),
}));
vi.mock("../db/db.js", () => ({ default: db }));
vi.mock("../queues/subscriberQueue.js", () => ({ default: subscriberQueue }));
vi.mock("./monitorSubscriptionsController.js", () => ({ NotifyMonitorsAddedToMaintenance }));
vi.mock("./controller.js", () => ({
  GetAllSiteData: vi.fn(async () => ({ siteURL: "https://status.example.com", siteName: "Example", colors: {} })),
}));

import { AddMonitorToMaintenance, UpdateMaintenance, UpdateMaintenanceEventStatus } from "./maintenanceController.js";

const NOW = Math.floor(Date.now() / 1000);
const maintenance = {
  id: 7,
  title: "Database upgrade",
  description: null,
  start_date_time: NOW + 86400,
  rrule: "FREQ=MINUTELY;COUNT=1",
  duration_seconds: 3600,
  status: "ACTIVE",
  is_global: "NO",
};

describe("UpdateMaintenance: mail to the subscribers of added monitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getMaintenanceById.mockResolvedValue(maintenance);
    db.getMaintenanceMonitors.mockResolvedValue([{ monitor_tag: "api", monitor_impact: "MAINTENANCE" }]);
    db.getMaintenanceEventsByMaintenanceId.mockResolvedValue([]);
    db.createMaintenanceEvent.mockImplementation(async (event: object) => ({ id: 1, ...event }));
    db.getMonitorsByMaintenanceId.mockResolvedValue([]);
  });

  it("asks to email only the subscribers of the monitors that were not on it before", async () => {
    await UpdateMaintenance(7, {
      title: "Database upgrade",
      monitors: [
        { monitor_tag: "api", monitor_impact: "MAINTENANCE" },
        { monitor_tag: "db", monitor_impact: "DOWN" },
      ],
    });

    expect(NotifyMonitorsAddedToMaintenance).toHaveBeenCalledWith(7, ["db"]);
  });

  it("leaves it to the new window's mail when the schedule change creates one", async () => {
    await UpdateMaintenance(7, {
      start_date_time: NOW + 2 * 86400,
      monitors: [
        { monitor_tag: "api", monitor_impact: "MAINTENANCE" },
        { monitor_tag: "db", monitor_impact: "DOWN" },
      ],
    });

    expect(db.createMaintenanceEvent).toHaveBeenCalledOnce();
    expect(NotifyMonitorsAddedToMaintenance).not.toHaveBeenCalled();
  });
});

describe("AddMonitorToMaintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getMaintenanceById.mockResolvedValue(maintenance);
    db.getMonitorByTag.mockResolvedValue({ tag: "db" });
  });

  it("asks to email the monitor's subscribers only when it is new on the maintenance", async () => {
    db.getMaintenanceMonitors.mockResolvedValue([{ monitor_tag: "api" }]);
    await AddMonitorToMaintenance(7, "db");
    expect(NotifyMonitorsAddedToMaintenance).toHaveBeenCalledWith(7, ["db"]);

    vi.clearAllMocks();
    db.getMaintenanceMonitors.mockResolvedValue([{ monitor_tag: "db" }]);
    await AddMonitorToMaintenance(7, "db");
    expect(NotifyMonitorsAddedToMaintenance).not.toHaveBeenCalled();
  });
});

describe("maintenance status mails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("also go to the subscribers of the maintenance's visible monitors", async () => {
    const event = { id: 3, maintenance_id: 7, start_date_time: NOW + 3600, end_date_time: NOW + 7200 };
    db.getMaintenanceEventById.mockResolvedValue({ ...event, status: "SCHEDULED" });
    db.getMaintenanceById.mockResolvedValue(maintenance);
    db.getMonitorsByMaintenanceId.mockResolvedValue([
      { monitor_tag: "api", monitor_name: "Public API", monitor_impact: "MAINTENANCE" },
    ]);

    await UpdateMaintenanceEventStatus(3, "CANCELLED");

    expect(subscriberQueue.push).toHaveBeenCalledOnce();
    const [variables, , audience] = subscriberQueue.push.mock.calls[0];
    expect(variables).toMatchObject({ event_type: "maintenances", update_id: "maintenance_3_cancelled" });
    expect(audience).toEqual({ monitorTags: ["api"] });
  });
});
