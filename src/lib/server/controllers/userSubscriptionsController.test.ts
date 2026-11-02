import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";

// TEST_DATABASE_URL=postgresql://… or mysql://… runs this file on that engine instead of in-memory SQLite.
// It empties the subscription, monitor and site data tables of that database.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
vi.mock("$lib/server/db/db", async () => {
  const { default: DbImpl } = await import("$lib/server/db/dbimpl");
  if (process.env.TEST_DATABASE_URL) {
    const { default: knexOb } = await import("../../../../knexfile");
    return { default: new DbImpl(knexOb) };
  }
  return {
    default: new DbImpl({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true }),
  };
});
vi.mock("$lib/server/cache/cache", () => ({
  getCache: async (_key: string, fetcher?: () => unknown) => (fetcher ? await fetcher() : null),
  setCache: async () => {},
  deleteCache: async () => {},
}));
vi.mock("$lib/server/queues/subscriberQueue", () => ({ default: { push: vi.fn() } }));
vi.mock("$lib/server/queues/alertingQueue", () => ({ default: { push: vi.fn() } }));

import db from "$lib/server/db/db";
import { up as addMonitorSubscriptions } from "../../../../migrations/20261102120000_add_monitor_subscriptions";
import {
  GetSubscriberEmailsForNotification,
  MonitorSubscriptionsEnabled,
  UpdateSubscriberPreferences,
  VerifySubscriberOTP,
  VerifySubscriberToken,
} from "./userSubscriptionsController";

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;

// Children first, so the foreign keys allow each delete.
const TABLES = [
  "user_monitor_subscriptions",
  "user_subscriptions_v2",
  "subscriber_methods",
  "subscriber_users",
  "subscriptions",
  "subscribers",
  "monitors",
  "site_data",
];

const monitorRow = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag,
  name: tag.toUpperCase(),
  status: "ACTIVE",
  is_hidden: "NO",
  monitor_type: "NONE",
  type_data: "{}",
  ...extra,
});

async function reset(monitorsSetting?: boolean) {
  for (const table of TABLES) await knex(table).del();
  await knex("monitors").insert([
    monitorRow("api"),
    monitorRow("web"),
    monitorRow("db"),
    monitorRow("secret", { is_hidden: "YES" }),
  ]);
  await db.insertOrUpdateSiteData(
    "subscriptionsSettings",
    JSON.stringify({
      enable: true,
      methods: {
        emails: {
          incidents: true,
          maintenances: true,
          ...(monitorsSetting === undefined ? {} : { monitors: monitorsSetting }),
        },
      },
    }),
    "object",
  );
}

async function subscriber(email: string, status = "ACTIVE") {
  const user = await db.createSubscriberUser({ email, status: status as "ACTIVE" });
  const method = await db.createSubscriberMethod({
    subscriber_user_id: user.id,
    method_type: "email",
    method_value: email,
  });
  return { user, method };
}

async function signIn(email: string): Promise<string> {
  await db.createSubscriberUser({ email, status: "PENDING", verification_code: "123456" });
  const result = await VerifySubscriberOTP(email, "123456");
  expect(result.success).toBe(true);
  return result.token!;
}

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name.slice("/migrations/".length),
      getMigration: async (name: string) => migrations[name],
    },
  });
});

afterAll(async () => {
  await knex.destroy();
});

describe("monitor subscriptions repository", () => {
  beforeEach(() => reset());

  it("keeps exactly the monitors last set, once each", async () => {
    const { user, method } = await subscriber("a@example.com");

    await db.setMonitorSubscriptions(user.id, method.id, ["web", "api", "api"]);
    expect(await db.getMonitorSubscriptionTags(method.id)).toEqual(["api", "web"]);

    await db.setMonitorSubscriptions(user.id, method.id, ["web", "db"]);
    expect(await db.getMonitorSubscriptionTags(method.id)).toEqual(["db", "web"]);
    expect(await knex("user_monitor_subscriptions").where("subscriber_method_id", method.id)).toHaveLength(2);

    await db.setMonitorSubscriptions(user.id, method.id, []);
    expect(await db.getMonitorSubscriptionTags(method.id)).toEqual([]);
  });

  it("refuses a second row for the same subscriber and monitor", async () => {
    const { user, method } = await subscriber("a@example.com");
    const row = { subscriber_user_id: user.id, subscriber_method_id: method.id, monitor_tag: "api", status: "ACTIVE" };

    await knex("user_monitor_subscriptions").insert(row);
    await expect(knex("user_monitor_subscriptions").insert(row)).rejects.toThrow();
  });

  it("finds each verified subscriber of the monitors once", async () => {
    const a = await subscriber("a@example.com");
    const b = await subscriber("b@example.com");
    const pending = await subscriber("pending@example.com", "PENDING");
    await db.setMonitorSubscriptions(a.user.id, a.method.id, ["api", "web"]);
    await db.setMonitorSubscriptions(b.user.id, b.method.id, ["db"]);
    await db.setMonitorSubscriptions(pending.user.id, pending.method.id, ["api"]);

    expect((await db.getEmailsSubscribedToMonitors(["api", "web"])).sort()).toEqual(["a@example.com"]);
    expect((await db.getEmailsSubscribedToMonitors(["web", "db"])).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(await db.getEmailsSubscribedToMonitors([])).toEqual([]);
  });

  it("drops a monitor's subscriptions with the monitor", async () => {
    const { user, method } = await subscriber("a@example.com");
    await db.setMonitorSubscriptions(user.id, method.id, ["api", "web"]);

    await db.deleteMonitorSubscriptionsByTag("api");

    expect(await db.getMonitorSubscriptionTags(method.id)).toEqual(["web"]);
  });
});

describe("who a subscriber notification goes to", () => {
  beforeEach(() => reset());

  async function everyIncident(email: string) {
    const { user, method } = await subscriber(email);
    await db.createUserSubscriptionV2({
      subscriber_user_id: user.id,
      subscriber_method_id: method.id,
      event_type: "incidents",
    });
    return { user, method };
  }

  it("emails a person subscribed to the event type and to one of its monitors once", async () => {
    const both = await everyIncident("both@example.com");
    await db.setMonitorSubscriptions(both.user.id, both.method.id, ["api"]);
    await everyIncident("incidents@example.com");
    const apiOnly = await subscriber("api@example.com");
    await db.setMonitorSubscriptions(apiOnly.user.id, apiOnly.method.id, ["api"]);
    const webOnly = await subscriber("web@example.com");
    await db.setMonitorSubscriptions(webOnly.user.id, webOnly.method.id, ["web"]);

    const recipients = await GetSubscriberEmailsForNotification("incidents", ["api"]);

    expect(recipients.sort()).toEqual(["api@example.com", "both@example.com", "incidents@example.com"]);
  });

  it("emails only the monitors' subscribers for a status change or a monitors-only update", async () => {
    await everyIncident("incidents@example.com");
    const apiOnly = await subscriber("api@example.com");
    await db.setMonitorSubscriptions(apiOnly.user.id, apiOnly.method.id, ["api"]);

    expect(await GetSubscriberEmailsForNotification("monitors", ["api"])).toEqual(["api@example.com"]);
    expect(await GetSubscriberEmailsForNotification("incidents", ["api"], true)).toEqual(["api@example.com"]);
    expect(await GetSubscriberEmailsForNotification("monitors", ["web"])).toEqual([]);
  });

  it("leaves the monitors' subscribers out when monitor subscriptions are off", async () => {
    await reset(false);
    await everyIncident("incidents@example.com");
    const apiOnly = await subscriber("api@example.com");
    await db.setMonitorSubscriptions(apiOnly.user.id, apiOnly.method.id, ["api"]);

    expect(await GetSubscriberEmailsForNotification("incidents", ["api"])).toEqual(["incidents@example.com"]);
    expect(await GetSubscriberEmailsForNotification("monitors", ["api"])).toEqual([]);
  });
});

describe("a subscriber's monitor preferences", () => {
  beforeEach(() => reset());

  it("subscribes to the chosen monitors and leaves out ones a visitor cannot see", async () => {
    const token = await signIn("visitor@example.com");

    const result = await UpdateSubscriberPreferences(token, { monitors: ["web", "api", "secret", "missing"] });

    expect(result).toEqual({ success: true, monitors: ["api", "web"] });
    expect((await VerifySubscriberToken(token)).monitors).toEqual(["api", "web"]);
  });

  it("unsubscribes from a monitor and keeps a subscription to a now-hidden one", async () => {
    const token = await signIn("visitor@example.com");
    await UpdateSubscriberPreferences(token, { monitors: ["api", "web", "db"] });
    await knex("monitors").where("tag", "db").update({ is_hidden: "YES" });

    await UpdateSubscriberPreferences(token, { monitors: ["web"] });

    const { method } = await VerifySubscriberToken(token);
    expect(await db.getMonitorSubscriptionTags(method!.id)).toEqual(["db", "web"]);
    expect((await VerifySubscriberToken(token)).monitors).toEqual(["web"]);
  });

  it("leaves the incident and maintenance subscriptions as they are", async () => {
    const token = await signIn("visitor@example.com");
    await UpdateSubscriberPreferences(token, { incidents: true });

    await UpdateSubscriberPreferences(token, { monitors: ["api"] });

    expect((await VerifySubscriberToken(token)).subscriptions).toEqual({ incidents: true, maintenances: false });
  });
});

describe("MonitorSubscriptionsEnabled", () => {
  it("is on with subscriptions unless monitor subscriptions are turned off", () => {
    const config = (monitors?: boolean) => ({
      enable: true,
      methods: { emails: { incidents: false, maintenances: false, monitors } },
    });
    expect(MonitorSubscriptionsEnabled(config())).toBe(true);
    expect(MonitorSubscriptionsEnabled(config(true))).toBe(true);
    expect(MonitorSubscriptionsEnabled(config(false))).toBe(false);
    expect(MonitorSubscriptionsEnabled({ ...config(true), enable: false })).toBe(false);
    expect(MonitorSubscriptionsEnabled(null)).toBe(false);
  });
});

describe("migration 20261102120000: Kener v3 subscribers", () => {
  beforeEach(() => reset());

  async function v3Subscriber(email: string, status: string, monitors: Array<[string, string]>) {
    await knex("subscribers").insert({ subscriber_send: email, subscriber_type: "email", subscriber_status: status });
    const { id } = await knex("subscribers").where({ subscriber_send: email }).first();
    for (const [tag, subscriptionStatus] of monitors) {
      await knex("subscriptions").insert({
        subscriber_id: id,
        subscriptions_status: subscriptionStatus,
        subscriptions_monitors: tag,
      });
    }
  }

  async function snapshot() {
    const users = await knex("subscriber_users").orderBy("email").select("email", "status");
    const methods = await knex("subscriber_methods as sm")
      .join("subscriber_users as su", "sm.subscriber_user_id", "su.id")
      .orderBy("su.email")
      .select("su.email", "sm.method_type", "sm.method_value", "sm.status");
    const events = await knex("user_subscriptions_v2 as us")
      .join("subscriber_users as su", "us.subscriber_user_id", "su.id")
      .orderBy(["su.email", "us.event_type"])
      .select("su.email", "us.event_type", "us.status");
    const monitors = await knex("user_monitor_subscriptions as ums")
      .join("subscriber_users as su", "ums.subscriber_user_id", "su.id")
      .orderBy(["su.email", "ums.monitor_tag"])
      .select("su.email", "ums.monitor_tag", "ums.status");
    return { users, methods, events, monitors };
  }

  it("copies verified v3 subscriptions, once, and leaves the v3 tables as they were", async () => {
    // Followed two monitors that still exist, one that is gone, and one subscription it turned off.
    await v3Subscriber("tags@example.com", "ACTIVE", [
      ["api", "ACTIVE"],
      ["web", "ACTIVE"],
      ["deleted-monitor", "ACTIVE"],
      ["db", "INACTIVE"],
    ]);
    // Followed every monitor.
    await v3Subscriber("all@example.com", "ACTIVE", [["_", "ACTIVE"]]);
    // Never verified.
    await v3Subscriber("pending@example.com", "PENDING", [["api", "ACTIVE"]]);
    // Already signed up on v4 without verifying, and turned maintenance updates off there.
    await v3Subscriber("Both@Example.com ", "ACTIVE", [
      ["ALL", "ACTIVE"],
      ["db", "ACTIVE"],
    ]);
    const existing = await subscriber("both@example.com", "PENDING");
    await db.createUserSubscriptionV2({
      subscriber_user_id: existing.user.id,
      subscriber_method_id: existing.method.id,
      event_type: "maintenances",
      status: "INACTIVE",
    });
    const v3Before = { subscribers: await knex("subscribers"), subscriptions: await knex("subscriptions") };

    await addMonitorSubscriptions(knex);
    const after = await snapshot();

    expect(after.users).toEqual([
      { email: "all@example.com", status: "ACTIVE" },
      { email: "both@example.com", status: "ACTIVE" },
      { email: "tags@example.com", status: "ACTIVE" },
    ]);
    expect(after.methods).toEqual([
      { email: "all@example.com", method_type: "email", method_value: "all@example.com", status: "ACTIVE" },
      { email: "both@example.com", method_type: "email", method_value: "both@example.com", status: "ACTIVE" },
      { email: "tags@example.com", method_type: "email", method_value: "tags@example.com", status: "ACTIVE" },
    ]);
    expect(after.events).toEqual([
      { email: "all@example.com", event_type: "incidents", status: "ACTIVE" },
      { email: "all@example.com", event_type: "maintenances", status: "ACTIVE" },
      { email: "both@example.com", event_type: "incidents", status: "ACTIVE" },
      { email: "both@example.com", event_type: "maintenances", status: "INACTIVE" },
    ]);
    expect(after.monitors).toEqual([
      { email: "both@example.com", monitor_tag: "db", status: "ACTIVE" },
      { email: "tags@example.com", monitor_tag: "api", status: "ACTIVE" },
      { email: "tags@example.com", monitor_tag: "web", status: "ACTIVE" },
    ]);

    await addMonitorSubscriptions(knex);
    expect(await snapshot()).toEqual(after);
    expect({ subscribers: await knex("subscribers"), subscriptions: await knex("subscriptions") }).toEqual(v3Before);
  });
});
