import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, subscriberQueue } = vi.hoisted(() => ({
  db: {
    getIncidentById: vi.fn(),
    insertIncidentComment: vi.fn(),
    updateIncident: vi.fn(),
    setIncidentEndTimeToNull: vi.fn(),
    getMonitorsByIncidentId: vi.fn(),
    createIncident: vi.fn(),
    getMonitorByTag: vi.fn(),
    insertIncidentMonitorWithMerge: vi.fn(),
    getIncidentMonitorsByIncidentID: vi.fn(async (): Promise<object[]> => []),
    getActiveIncidentComments: vi.fn(async (): Promise<object[]> => []),
  },
  subscriberQueue: { push: vi.fn() },
}));
vi.mock("../db/db.js", () => ({ default: db }));
vi.mock("../queues/subscriberQueue.js", () => ({ default: subscriberQueue }));
vi.mock("./siteDataController.js", () => ({
  GetAllSiteData: vi.fn(async () => ({ siteURL: "https://status.example.com", siteName: "Example", colors: {} })),
}));

import {
  AddIncidentComment,
  AddIncidentMonitor,
  CreateNewIncidentWithCommentAndMonitor,
} from "./incidentController.js";

const incident = {
  id: 12,
  title: "Checkout is slow",
  state: "INVESTIGATING",
  incident_type: "INCIDENT",
  is_global: "YES",
  start_date_time: 1000,
  end_date_time: null,
};

function pushedVariables() {
  expect(subscriberQueue.push).toHaveBeenCalledOnce();
  return subscriberQueue.push.mock.calls[0][0];
}

describe("AddIncidentComment: subscriber mail variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getIncidentById.mockResolvedValue(incident);
    db.insertIncidentComment.mockImplementation(async (_id: number, comment: string, state: string) => ({
      id: 99,
      comment,
      state,
    }));
  });

  it("flags the comment's state and the worst monitor impact", async () => {
    db.getMonitorsByIncidentId.mockResolvedValue([
      { monitor_tag: "api", monitor_impact: "DEGRADED" },
      { monitor_tag: "web", monitor_impact: "DOWN" },
    ]);

    await AddIncidentComment(12, "Looking into it", "INVESTIGATING", 2000);

    expect(pushedVariables()).toMatchObject({
      update_state: "INVESTIGATING",
      is_investigating: true,
      is_identified: false,
      is_monitoring: false,
      is_resolved: false,
      incident_impact: "DOWN",
      is_down: true,
      is_degraded: false,
    });
  });

  it("reads degraded when no monitor is down", async () => {
    db.getMonitorsByIncidentId.mockResolvedValue([{ monitor_tag: "api", monitor_impact: "DEGRADED" }]);

    await AddIncidentComment(12, "Fixed", "RESOLVED", 3000);

    expect(pushedVariables()).toMatchObject({
      is_resolved: true,
      is_investigating: false,
      incident_impact: "DEGRADED",
      is_down: false,
      is_degraded: true,
    });
  });

  it("still sends the mail, without impact, when the monitors cannot be read", async () => {
    db.getMonitorsByIncidentId.mockRejectedValue(new Error("connection reset"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await AddIncidentComment(12, "Looking into it", "INVESTIGATING", 2000);

    expect(pushedVariables()).toMatchObject({
      is_investigating: true,
      incident_impact: "",
      is_down: false,
      is_degraded: false,
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("leaves the impact empty for an incident without monitors", async () => {
    db.getMonitorsByIncidentId.mockResolvedValue([]);

    await AddIncidentComment(12, "We know why", "IDENTIFIED", 2500);

    expect(pushedVariables()).toMatchObject({
      is_identified: true,
      incident_impact: "",
      is_down: false,
      is_degraded: false,
    });
  });

  it("also addresses the mail to the subscribers of the incident's monitors", async () => {
    db.getMonitorsByIncidentId.mockResolvedValue([
      { monitor_tag: "api", monitor_impact: "DEGRADED" },
      { monitor_tag: "web", monitor_impact: "DOWN" },
    ]);

    await AddIncidentComment(12, "Looking into it", "INVESTIGATING", 2000);

    expect(subscriberQueue.push.mock.calls[0][2]).toEqual({ monitorTags: ["api", "web"] });
  });

  it("rejects a RESOLVED comment dated before the incident start, and saves and sends nothing", async () => {
    await expect(AddIncidentComment(12, "Fixed", "RESOLVED", 900)).rejects.toThrow(
      "A RESOLVED comment cannot be dated before the incident start",
    );

    expect(db.insertIncidentComment).not.toHaveBeenCalled();
    expect(db.updateIncident).not.toHaveBeenCalled();
    expect(subscriberQueue.push).not.toHaveBeenCalled();
  });
});

describe("CreateNewIncidentWithCommentAndMonitor", () => {
  let attached: Array<{ monitor_tag: string; monitor_impact: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    attached = [];
    db.createIncident.mockResolvedValue({ id: 12 });
    db.getIncidentById.mockResolvedValue(incident);
    db.getMonitorByTag.mockResolvedValue({ tag: "web" });
    db.insertIncidentMonitorWithMerge.mockImplementation(
      async (row: { monitor_tag: string; monitor_impact: string }) => {
        attached.push(row);
      },
    );
    db.getMonitorsByIncidentId.mockImplementation(async () => [...attached]);
    db.insertIncidentComment.mockImplementation(async (_id: number, comment: string, state: string) => ({
      id: 99,
      comment,
      state,
    }));
  });

  const create = (alertValue: string, alertFor = "STATUS") =>
    CreateNewIncidentWithCommentAndMonitor(
      { title: "web alert", start_date_time: 1000 } as Parameters<typeof CreateNewIncidentWithCommentAndMonitor>[0],
      "Alert triggered",
      "web",
      alertValue,
      alertFor,
    );

  it.each([
    ["a STATUS DOWN alert", "STATUS", "DOWN", "DOWN"],
    ["a STATUS DEGRADED alert", "STATUS", "DEGRADED", "DEGRADED"],
    ["a LATENCY alert, whose value is a threshold in ms", "LATENCY", "1000", "DEGRADED"],
    ["an UPTIME alert, whose value is a percentage", "UPTIME", "99.5", "DEGRADED"],
  ])(
    "attaches the monitor for %s before the opening comment, so its mail carries the impact",
    async (_, alertFor, alertValue, impact) => {
      await expect(create(alertValue, alertFor)).resolves.toEqual({ incident_id: 12 });

      expect(attached).toEqual([{ incident_id: 12, monitor_tag: "web", monitor_impact: impact }]);
      expect(db.insertIncidentMonitorWithMerge.mock.invocationCallOrder[0]).toBeLessThan(
        db.insertIncidentComment.mock.invocationCallOrder[0],
      );
      expect(pushedVariables()).toMatchObject({
        is_investigating: true,
        incident_impact: impact,
        is_down: impact === "DOWN",
        is_degraded: impact === "DEGRADED",
      });
    },
  );

  it("opens a STATUS UP alert's incident without the monitor, so a healthy monitor is not called degraded", async () => {
    await expect(create("UP")).resolves.toEqual({ incident_id: 12 });

    expect(db.insertIncidentMonitorWithMerge).not.toHaveBeenCalled();
    expect(db.insertIncidentComment).toHaveBeenCalledOnce();
    expect(pushedVariables()).toMatchObject({
      is_investigating: true,
      incident_impact: "",
      is_down: false,
      is_degraded: false,
    });
  });

  it("claims no impact for an alert type it does not know", async () => {
    await expect(create("DOWN", "SOMETHING_NEW")).resolves.toEqual({ incident_id: 12 });

    expect(db.insertIncidentMonitorWithMerge).not.toHaveBeenCalled();
    expect(pushedVariables()).toMatchObject({ incident_impact: "", is_down: false, is_degraded: false });
  });

  it("still posts the opening comment and its mail when the monitor cannot be attached, then raises", async () => {
    db.getMonitorByTag.mockResolvedValue(undefined);

    await expect(create("DOWN")).rejects.toThrow("Monitor with tag web does not exist");

    expect(db.insertIncidentComment).toHaveBeenCalledOnce();
    expect(pushedVariables()).toMatchObject({ is_investigating: true, incident_impact: "" });
  });
});

describe("AddIncidentMonitor: mail to the monitor's subscribers", () => {
  const update = { id: 99, comment: "We are on it", state: "INVESTIGATING" };

  beforeEach(() => {
    vi.clearAllMocks();
    db.getIncidentById.mockResolvedValue(incident);
    db.getMonitorByTag.mockResolvedValue({ tag: "web" });
    db.getIncidentMonitorsByIncidentID.mockResolvedValue([]);
    db.getActiveIncidentComments.mockResolvedValue([update]);
    db.getMonitorsByIncidentId.mockResolvedValue([{ monitor_tag: "web", monitor_impact: "DOWN", monitor_name: "Web" }]);
  });

  it("emails only that monitor's subscribers when it joins an incident that has posted an update", async () => {
    await AddIncidentMonitor(12, "web", "DOWN");

    expect(subscriberQueue.push).toHaveBeenCalledOnce();
    const [variables, options, audience] = subscriberQueue.push.mock.calls[0];
    expect(variables).toMatchObject({
      event_type: "incidents",
      monitor_tag: "web",
      monitor_name: "Web",
      is_monitor_update: true,
      incident_impact: "DOWN",
      is_down: true,
    });
    expect(variables.update_text).toContain("We are on it");
    expect(options).toEqual({ deduplication: { id: "subscriber-incident-monitor-12-web" } });
    expect(audience).toEqual({ monitorTags: ["web"], monitorsOnly: true });
  });

  it("sends nothing when only the impact of a monitor already on the incident changes", async () => {
    db.getIncidentMonitorsByIncidentID.mockResolvedValue([{ monitor_tag: "web", monitor_impact: "DEGRADED" }]);

    await AddIncidentMonitor(12, "web", "DOWN");

    expect(db.insertIncidentMonitorWithMerge).toHaveBeenCalledOnce();
    expect(subscriberQueue.push).not.toHaveBeenCalled();
  });

  it("sends nothing before the incident's first update, which reaches the monitor's subscribers itself", async () => {
    db.getActiveIncidentComments.mockResolvedValue([]);

    await AddIncidentMonitor(12, "web", "DOWN");

    expect(subscriberQueue.push).not.toHaveBeenCalled();
  });

  it("sends nothing for a resolved incident or a hidden monitor", async () => {
    db.getIncidentById.mockResolvedValue({ ...incident, state: "RESOLVED" });
    await AddIncidentMonitor(12, "web", "DOWN");

    db.getIncidentById.mockResolvedValue(incident);
    db.getMonitorsByIncidentId.mockResolvedValue([]);
    await AddIncidentMonitor(12, "web", "DOWN");

    expect(subscriberQueue.push).not.toHaveBeenCalled();
  });
});
