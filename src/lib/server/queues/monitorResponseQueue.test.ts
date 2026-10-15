import { beforeEach, describe, expect, it, vi } from "vitest";
import GC from "../../global-constants.js";

const h = vi.hoisted(() => ({
  capturedProcessor: null as null | ((job: { data: Record<string, unknown> }) => Promise<unknown>),
  queueAdd: vi.fn(async () => ({})),
  InsertMonitoringData: vi.fn(),
  GetAllSiteData: vi.fn(),
  GetLastMonitoringValue: vi.fn(),
  SetLastMonitoringValue: vi.fn(),
  alertingPush: vi.fn(),
  subscriberPush: vi.fn(),
  getMonitorByTag: vi.fn(),
}));

vi.mock("./q.js", () => ({
  default: {
    createQueue: () => ({ name: "monitorResponseQueue", add: h.queueAdd }),
    createWorker: (_queue: unknown, processor: (job: { data: Record<string, unknown> }) => Promise<unknown>) => {
      h.capturedProcessor = processor;
      return { on: () => {} };
    },
  },
}));

vi.mock("../controllers/controller.js", () => ({
  InsertMonitoringData: h.InsertMonitoringData,
  GetAllSiteData: h.GetAllSiteData,
}));

vi.mock("../cache/setGet.js", () => ({
  GetLastMonitoringValue: h.GetLastMonitoringValue,
  SetLastMonitoringValue: h.SetLastMonitoringValue,
}));

vi.mock("./alertingQueue.js", () => ({ default: { push: h.alertingPush } }));
vi.mock("./subscriberQueue.js", () => ({ default: { push: h.subscriberPush } }));
vi.mock("../db/db.js", () => ({ default: { getMonitorByTag: h.getMonitorByTag } }));

import monitorResponseQueue from "./monitorResponseQueue.js";

function runJob(data: Record<string, unknown>) {
  if (!h.capturedProcessor) throw new Error("worker processor not captured yet");
  return h.capturedProcessor({ data });
}

const baseObservation = {
  monitorTag: "api",
  ts: 2,
  status: GC.DOWN,
  latency: 12,
  type: GC.REALTIME,
  error_message: null,
  raw_status: null,
};

describe("monitorResponseQueue — status-change notifications", () => {
  beforeEach(async () => {
    h.InsertMonitoringData.mockReset().mockResolvedValue({
      monitor_tag: "api",
      timestamp: 2,
      status: GC.DOWN,
      latency: 12,
      type: GC.REALTIME,
    });
    h.GetAllSiteData.mockReset().mockResolvedValue({
      siteURL: "https://status.example.com",
      siteName: "Example",
      colors: {},
    });
    h.SetLastMonitoringValue.mockReset().mockResolvedValue(undefined);
    h.alertingPush.mockReset();
    h.subscriberPush.mockReset().mockResolvedValue(undefined);
    h.getMonitorByTag.mockReset().mockResolvedValue({ tag: "api", name: "API", is_hidden: GC.NO, status: GC.ACTIVE });
    h.GetLastMonitoringValue.mockReset().mockResolvedValue({
      monitor_tag: "api",
      timestamp: 1,
      status: GC.UP,
      latency: 10,
      type: GC.REALTIME,
    });

    // Capture the worker processor by pushing one job through the (mocked) queue.
    await monitorResponseQueue.push("api", 1, {
      status: GC.DOWN,
      latency: 12,
      type: GC.REALTIME,
    } as never);
  });

  it("emails the subscribers of the monitor when its status changes", async () => {
    await runJob(baseObservation);

    expect(h.subscriberPush).toHaveBeenCalledTimes(1);
    const [variables, options] = h.subscriberPush.mock.calls[0];
    expect(variables.event_type).toBe("status");
    expect(variables.monitor_tags).toEqual(["api"]);
    expect(variables.monitor_names).toEqual(["API"]);
    expect(variables.is_down).toBe(true);
    expect(variables.is_degraded).toBe(false);
    expect(variables.cta_url).toBe("https://status.example.com/monitors/api");
    expect(options.deduplication.id).toBe("subscriber-status-api-2");
  });

  it("only sends one notification for a repeated observation of the same change", async () => {
    await runJob(baseObservation);
    await runJob(baseObservation);

    // Both jobs ran, but the dedup id is stable, so the queue can collapse them.
    expect(h.subscriberPush).toHaveBeenCalledTimes(2);
    const ids = h.subscriberPush.mock.calls.map((call) => call[1].deduplication.id);
    expect(new Set(ids).size).toBe(1);
  });

  it("does not notify when the status did not change", async () => {
    h.GetLastMonitoringValue.mockResolvedValue({
      monitor_tag: "api",
      timestamp: 1,
      status: GC.DOWN,
      latency: 10,
      type: GC.REALTIME,
    });

    await runJob(baseObservation);

    expect(h.subscriberPush).not.toHaveBeenCalled();
  });

  it("does not notify when there is no previous status to compare against", async () => {
    h.GetLastMonitoringValue.mockResolvedValue(null);

    await runJob(baseObservation);

    expect(h.subscriberPush).not.toHaveBeenCalled();
  });

  it.each([GC.INCIDENT, GC.MAINTENANCE, GC.DEFAULT_STATUS])(
    "does not notify for %s observations (overlays are covered by incident/maintenance mail)",
    async (type) => {
      await runJob({ ...baseObservation, type });

      expect(h.subscriberPush).not.toHaveBeenCalled();
    },
  );

  it("does not notify when the monitor is hidden", async () => {
    h.getMonitorByTag.mockResolvedValue({ tag: "api", name: "API", is_hidden: GC.YES, status: GC.ACTIVE });

    await runJob(baseObservation);

    expect(h.subscriberPush).not.toHaveBeenCalled();
  });

  it("does not notify when the monitor is inactive", async () => {
    h.getMonitorByTag.mockResolvedValue({ tag: "api", name: "API", is_hidden: GC.NO, status: "INACTIVE" });

    await runJob(baseObservation);

    expect(h.subscriberPush).not.toHaveBeenCalled();
  });

  it("marks a degradation correctly", async () => {
    h.GetLastMonitoringValue.mockResolvedValue({
      monitor_tag: "api",
      timestamp: 1,
      status: GC.UP,
      latency: 10,
      type: GC.REALTIME,
    });

    await runJob({ ...baseObservation, status: GC.DEGRADED });

    const [variables] = h.subscriberPush.mock.calls[0];
    expect(variables.is_degraded).toBe(true);
    expect(variables.is_down).toBe(false);
    expect(variables.monitor_tags).toEqual(["api"]);
  });

  it("propagates an insert failure instead of notifying", async () => {
    h.InsertMonitoringData.mockResolvedValue(null);

    await expect(runJob(baseObservation)).rejects.toThrow("Failed to insert monitoring data");
    expect(h.subscriberPush).not.toHaveBeenCalled();
  });
});
