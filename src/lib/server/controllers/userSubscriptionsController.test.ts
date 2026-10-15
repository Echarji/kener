import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    getSubscribersForMonitors: vi.fn(),
    getMonitors: vi.fn(),
    setSubscriberMonitors: vi.fn(),
  },
}));

vi.mock("$lib/server/db/db.js", () => ({ default: db }));

import {
  GetActiveEmailsForMonitors,
  SetSubscriberMonitors,
  GetAvailableMonitors,
  GetAllSubscribableMonitorTags,
} from "./userSubscriptionsController.js";

function subscriber(email: string, methodType = "email") {
  return {
    user: { id: 1, email, status: "ACTIVE" },
    method: { id: 10, method_type: methodType, method_value: email, status: "ACTIVE" },
    monitor_tag: "api",
  };
}

describe("GetActiveEmailsForMonitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unique email addresses of the matched subscribers", async () => {
    db.getSubscribersForMonitors.mockResolvedValue([
      subscriber("alice@example.com"),
      subscriber("alice@example.com"), // duplicated across two monitors
      subscriber("bob@example.com"),
    ]);

    const emails = await GetActiveEmailsForMonitors(["api", "web"]);
    expect(emails).toEqual(["alice@example.com", "bob@example.com"]);
    expect(db.getSubscribersForMonitors).toHaveBeenCalledWith(["api", "web"]);
  });

  it("ignores delivery methods that are not email", async () => {
    db.getSubscribersForMonitors.mockResolvedValue([
      subscriber("alice@example.com"),
      subscriber("webhook-value", "webhook"),
    ]);

    expect(await GetActiveEmailsForMonitors(["api"])).toEqual(["alice@example.com"]);
  });

  it("queries nothing and returns empty for an empty monitor list", async () => {
    expect(await GetActiveEmailsForMonitors([])).toEqual([]);
    expect(db.getSubscribersForMonitors).not.toHaveBeenCalled();
  });
});

describe("SetSubscriberMonitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getMonitors.mockResolvedValue([
      { tag: "api", name: "API" },
      { tag: "web", name: "Website" },
    ]);
    db.setSubscriberMonitors.mockImplementation(async (_u: number, _m: number, tags: string[]) =>
      tags.map((tag) => ({ monitor_tag: tag })),
    );
  });

  it("drops tags that are not active, non-hidden monitors", async () => {
    await SetSubscriberMonitors(1, 10, ["api", "ghost"]);
    expect(db.setSubscriberMonitors).toHaveBeenCalledWith(1, 10, ["api"]);
  });

  it("trims, de-duplicates and drops blanks", async () => {
    await SetSubscriberMonitors(1, 10, [" api ", "api", "", "web"]);
    expect(db.setSubscriberMonitors).toHaveBeenCalledWith(1, 10, ["api", "web"]);
  });

  it("clears the selection when nothing valid is provided", async () => {
    await SetSubscriberMonitors(1, 10, []);
    expect(db.setSubscriberMonitors).toHaveBeenCalledWith(1, 10, []);
  });
});

describe("GetAvailableMonitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns active, non-hidden monitors sorted by name", async () => {
    db.getMonitors.mockResolvedValue([
      { tag: "web", name: "Website" },
      { tag: "api", name: "API" },
    ]);

    const monitors = await GetAvailableMonitors();
    expect(monitors.map((m) => m.tag)).toEqual(["api", "web"]);
    expect(db.getMonitors).toHaveBeenCalledWith({ status: "ACTIVE", is_hidden: "NO" });
  });
});

describe("GetAllSubscribableMonitorTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns every active, non-hidden monitor tag", async () => {
    db.getMonitors.mockResolvedValue([
      { tag: "api", name: "API" },
      { tag: "web", name: "Website" },
    ]);

    expect(await GetAllSubscribableMonitorTags()).toEqual(["api", "web"]);
  });
});
