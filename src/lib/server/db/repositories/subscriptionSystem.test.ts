import { afterAll, beforeAll, describe, expect, it } from "vitest";
import knex, { type Knex } from "knex";
import { SubscriptionSystemRepository } from "./subscriptionSystem.js";

// Repository-level check against in-memory SQLite: notifications must reach
// exactly the active subscribers of the monitors an event affects.
describe("SubscriptionSystemRepository monitor subscriptions", () => {
  let db: Knex;
  let repo: SubscriptionSystemRepository;

  beforeAll(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });

    await db.schema.createTable("monitors", (table) => {
      table.string("tag").primary();
      table.string("name").notNullable();
      table.string("description");
    });

    await db.schema.createTable("subscriber_users", (table) => {
      table.increments("id").primary();
      table.string("email").notNullable().unique();
      table.string("status").notNullable().defaultTo("PENDING");
      table.string("verification_code");
      table.timestamp("verification_expires_at");
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
    });

    await db.schema.createTable("subscriber_methods", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_user_id").notNullable();
      table.string("method_type").notNullable();
      table.string("method_value").notNullable();
      table.string("status").notNullable().defaultTo("ACTIVE");
      table.text("meta");
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
    });

    await db.schema.createTable("subscriber_monitor_subscriptions", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_user_id").notNullable();
      table.integer("subscriber_method_id").notNullable();
      table.string("monitor_tag").notNullable();
      table.string("status").notNullable().defaultTo("ACTIVE");
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
      table.unique(["subscriber_user_id", "subscriber_method_id", "monitor_tag"]);
    });

    await db("monitors").insert([
      { tag: "api", name: "Public API" },
      { tag: "db", name: "Database" },
    ]);

    await db("subscriber_users").insert([
      { id: 1, email: "active@example.com", status: "ACTIVE" },
      { id: 2, email: "pending@example.com", status: "PENDING" },
      { id: 3, email: "all@example.com", status: "ACTIVE" },
    ]);

    await db("subscriber_methods").insert([
      { id: 1, subscriber_user_id: 1, method_type: "email", method_value: "active@example.com", status: "ACTIVE" },
      { id: 2, subscriber_user_id: 2, method_type: "email", method_value: "pending@example.com", status: "ACTIVE" },
      { id: 3, subscriber_user_id: 3, method_type: "email", method_value: "all@example.com", status: "ACTIVE" },
    ]);

    await db("subscriber_monitor_subscriptions").insert([
      { subscriber_user_id: 1, subscriber_method_id: 1, monitor_tag: "api", status: "ACTIVE" },
      { subscriber_user_id: 1, subscriber_method_id: 1, monitor_tag: "db", status: "INACTIVE" },
      { subscriber_user_id: 2, subscriber_method_id: 2, monitor_tag: "api", status: "ACTIVE" },
      { subscriber_user_id: 3, subscriber_method_id: 3, monitor_tag: "api", status: "ACTIVE" },
      { subscriber_user_id: 3, subscriber_method_id: 3, monitor_tag: "db", status: "ACTIVE" },
    ]);

    repo = new SubscriptionSystemRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("returns only active subscribers of the affected monitors", async () => {
    expect(await repo.getActiveEmailsForMonitors(["api"])).toEqual(["active@example.com", "all@example.com"]);
    expect(await repo.getActiveEmailsForMonitors(["db"])).toEqual(["all@example.com"]);
    expect(await repo.getActiveEmailsForMonitors(["api", "db"])).toEqual(["active@example.com", "all@example.com"]);
  });

  it("returns every active monitor subscriber for a global event", async () => {
    expect(await repo.getActiveEmailsForMonitors(undefined)).toEqual(["active@example.com", "all@example.com"]);
  });

  it("returns no one when a scoped event has no monitors", async () => {
    expect(await repo.getActiveEmailsForMonitors([])).toEqual([]);
    expect(await repo.getActiveEmailsForMonitors(["missing"])).toEqual([]);
  });

  it("exposes the active monitor tags for preferences", async () => {
    expect(await repo.getMonitorSubscriptionTagsForMethod(1)).toEqual(["api"]);
    expect(await repo.getMonitorSubscriptionCountByMethod(1)).toBe(1);
    expect(await repo.getMonitorSubscriptionCountByMethod(3)).toBe(2);
  });
});
