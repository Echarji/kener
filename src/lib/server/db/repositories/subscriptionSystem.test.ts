import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import knex, { type Knex } from "knex";
import { SubscriptionSystemRepository } from "./subscriptionSystem";

describe("SubscriptionSystemRepository — monitor subscriptions", () => {
  let db: Knex;
  let repo: SubscriptionSystemRepository;

  // Methods are addressed by id; keep a map for readability.
  let aliceMethod = 0;
  let bobMethod = 0;
  let aliceUser = 0;
  let bobUser = 0;

  beforeAll(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });

    await db.schema.createTable("subscriber_users", (table) => {
      table.increments("id").primary();
      table.string("email", 255).notNullable().unique();
      table.string("status", 20).notNullable().defaultTo("PENDING");
      table.string("verification_code", 10).nullable();
      table.timestamp("verification_expires_at").nullable();
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
    });
    await db.schema.createTable("subscriber_methods", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_user_id").unsigned().notNullable();
      table.string("method_type", 50).notNullable();
      table.string("method_value", 500).notNullable();
      table.string("status", 20).notNullable().defaultTo("ACTIVE");
      table.text("meta").nullable();
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
    });
    await db.schema.createTable("monitors", (table) => {
      table.increments("id").primary();
      table.string("tag", 255).notNullable().unique();
      table.string("name", 255).notNullable().unique();
    });
    await db.schema.createTable("subscriber_monitors", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_user_id").unsigned().notNullable();
      table.integer("subscriber_method_id").unsigned().notNullable();
      table.string("monitor_tag", 255).notNullable();
      table.string("status", 20).notNullable().defaultTo("ACTIVE");
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
      table.unique(["subscriber_user_id", "subscriber_method_id", "monitor_tag"]);
    });

    repo = new SubscriptionSystemRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db("subscriber_monitors").del();
    await db("subscriber_methods").del();
    await db("subscriber_users").del();
    await db("monitors").del();

    await db("monitors").insert([
      { tag: "api", name: "API" },
      { tag: "web", name: "Website" },
      { tag: "db", name: "Database" },
    ]);

    aliceUser = (await db("subscriber_users").insert({ email: "alice@example.com", status: "ACTIVE" }))[0];
    bobUser = (await db("subscriber_users").insert({ email: "bob@example.com", status: "ACTIVE" }))[0];
    aliceMethod = (
      await db("subscriber_methods").insert({
        subscriber_user_id: aliceUser,
        method_type: "email",
        method_value: "alice@example.com",
        status: "ACTIVE",
      })
    )[0];
    bobMethod = (
      await db("subscriber_methods").insert({
        subscriber_user_id: bobUser,
        method_type: "email",
        method_value: "bob@example.com",
        status: "ACTIVE",
      })
    )[0];
  });

  it("creates and reads back a monitor subscription", async () => {
    const created = await repo.createSubscriberMonitor({
      subscriber_user_id: aliceUser,
      subscriber_method_id: aliceMethod,
      monitor_tag: "api",
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.monitor_tag).toBe("api");
    expect(created.status).toBe("ACTIVE");

    const byId = await repo.getSubscriberMonitorById(created.id);
    expect(byId?.monitor_tag).toBe("api");
  });

  it("filters monitor subscriptions by user, method, tag and status", async () => {
    await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["api", "web"]);
    await repo.setSubscriberMonitors(bobUser, bobMethod, ["db"]);

    expect((await repo.getSubscriberMonitors({ subscriber_method_id: aliceMethod })).map((r) => r.monitor_tag)).toEqual(
      expect.arrayContaining(["api", "web"]),
    );
    expect((await repo.getSubscriberMonitors({ monitor_tags: ["api", "db"] })).map((r) => r.monitor_tag)).toEqual(
      expect.arrayContaining(["api", "db"]),
    );
    expect(await repo.getSubscriberMonitors({ status: "INACTIVE" })).toEqual([]);
  });

  it("replaces the whole selection atomically (and clears when empty)", async () => {
    await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["api", "web"]);
    await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["db"]);

    const after = await repo.getSubscriberMonitors({ subscriber_method_id: aliceMethod });
    expect(after.map((r) => r.monitor_tag)).toEqual(["db"]);

    await repo.setSubscriberMonitors(aliceUser, aliceMethod, []);
    expect(await repo.getSubscriberMonitors({ subscriber_method_id: aliceMethod })).toEqual([]);

    // Other subscribers are untouched by a replace.
    await repo.setSubscriberMonitors(bobUser, bobMethod, ["api"]);
    await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["web"]);
    expect((await repo.getSubscriberMonitors({ subscriber_method_id: bobMethod })).map((r) => r.monitor_tag)).toEqual([
      "api",
    ]);
  });

  it("de-duplicates tags passed to setSubscriberMonitors", async () => {
    const saved = await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["api", "api", "api"]);
    expect(saved).toHaveLength(1);
  });

  it("deletes by method id when a subscriber is removed", async () => {
    await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["api", "web"]);
    await repo.setSubscriberMonitors(bobUser, bobMethod, ["db"]);

    const deleted = await repo.deleteSubscriberMonitorsByMethodId(aliceMethod);
    expect(deleted).toBe(2);
    expect(await repo.getSubscriberMonitors({ subscriber_method_id: aliceMethod })).toEqual([]);
    expect((await repo.getSubscriberMonitors({ subscriber_method_id: bobMethod })).map((r) => r.monitor_tag)).toEqual([
      "db",
    ]);
  });

  describe("getSubscribersForMonitors", () => {
    it("returns only subscribers of the given monitors", async () => {
      await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["api"]);
      await repo.setSubscriberMonitors(bobUser, bobMethod, ["db"]);

      const result = await repo.getSubscribersForMonitors(["api"]);
      expect(result).toHaveLength(1);
      expect(result[0].user.email).toBe("alice@example.com");
      expect(result[0].monitor_tag).toBe("api");
    });

    it("returns each subscriber once per matched monitor", async () => {
      await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["api", "web"]);

      const result = await repo.getSubscribersForMonitors(["api", "web"]);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.monitor_tag).sort()).toEqual(["api", "web"]);
    });

    it("never returns a subscriber of an unrelated monitor", async () => {
      await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["api"]);

      expect(await repo.getSubscribersForMonitors(["db"])).toEqual([]);
    });

    it("skips inactive users and inactive delivery methods", async () => {
      await db("subscriber_monitors").insert({
        subscriber_user_id: aliceUser,
        subscriber_method_id: aliceMethod,
        monitor_tag: "api",
        status: "ACTIVE",
      });
      await db("subscriber_users").where("id", aliceUser).update({ status: "PENDING" });

      expect(await repo.getSubscribersForMonitors(["api"])).toEqual([]);
    });

    it("returns nothing for an empty tag list", async () => {
      await repo.setSubscriberMonitors(aliceUser, aliceMethod, ["api"]);
      expect(await repo.getSubscribersForMonitors([])).toEqual([]);
    });
  });
});
