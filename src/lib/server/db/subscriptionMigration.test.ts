import { afterAll, beforeAll, describe, expect, it } from "vitest";
import knex, { type Knex } from "knex";
import { up } from "../../../../migrations/20261023120000_add_monitor_subscriptions";

// The V3 -> V4 upgrade keeps the legacy `subscribers` / `subscriptions` tables.
// This test runs the import against in-memory SQLite and checks that emails,
// users, and monitor choices survive, that hidden monitors are skipped, and
// that rows which cannot be mapped are reported instead of dropped.
describe("monitor subscription migration", () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });

    await db.schema.createTable("monitors", (table) => {
      table.string("tag").primary();
      table.string("name").notNullable();
      table.string("status").notNullable();
      table.string("is_hidden").notNullable().defaultTo("NO");
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

    await db.schema.createTable("user_subscriptions_v2", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_user_id").notNullable();
      table.integer("subscriber_method_id").notNullable();
      table.string("event_type").notNullable();
      table.string("status").notNullable().defaultTo("ACTIVE");
    });

    await db.schema.createTable("subscribers", (table) => {
      table.increments("id").primary();
      table.string("subscriber_send").notNullable();
      table.text("subscriber_meta");
      table.string("subscriber_type").notNullable();
      table.string("subscriber_status").notNullable();
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
      table.unique(["subscriber_send", "subscriber_type"]);
    });

    await db.schema.createTable("subscriptions", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_id").unsigned().notNullable();
      table.string("subscriptions_status").notNullable();
      table.string("subscriptions_monitors").notNullable();
      table.text("subscriptions_meta");
    });

    await db("monitors").insert([
      { tag: "api", name: "Public API", status: "ACTIVE", is_hidden: "NO" },
      { tag: "db", name: "Database", status: "ACTIVE", is_hidden: "NO" },
      { tag: "secret", name: "Secret", status: "ACTIVE", is_hidden: "YES" },
      { tag: "old", name: "Old", status: "INACTIVE", is_hidden: "NO" },
    ]);

    // A V4 subscriber created before this upgrade, with the old event-based
    // preference.
    await db("subscriber_users").insert({ id: 1, email: "existing@example.com", status: "ACTIVE" });
    await db("subscriber_methods").insert({
      id: 1,
      subscriber_user_id: 1,
      method_type: "email",
      method_value: "existing@example.com",
      status: "ACTIVE",
    });
    await db("user_subscriptions_v2").insert({
      subscriber_user_id: 1,
      subscriber_method_id: 1,
      event_type: "incidents",
      status: "ACTIVE",
    });

    // V3 rows.
    await db("subscribers").insert([
      {
        id: 1,
        subscriber_send: "v3@example.com",
        subscriber_type: "email",
        subscriber_status: "ACTIVE",
      },
      {
        id: 2,
        subscriber_send: "existing@example.com",
        subscriber_type: "email",
        subscriber_status: "ACTIVE",
      },
      {
        id: 3,
        subscriber_send: "unmapped@example.com",
        subscriber_type: "email",
        subscriber_status: "ACTIVE",
      },
      {
        id: 4,
        subscriber_send: "hook@example.com",
        subscriber_type: "webhook",
        subscriber_status: "ACTIVE",
      },
    ]);

    await db("subscriptions").insert([
      { id: 1, subscriber_id: 1, subscriptions_status: "ACTIVE", subscriptions_monitors: "api" },
      { id: 2, subscriber_id: 2, subscriptions_status: "ACTIVE", subscriptions_monitors: "_" },
      { id: 3, subscriber_id: 3, subscriptions_status: "ACTIVE", subscriptions_monitors: "deleted-monitor" },
      { id: 4, subscriber_id: 999, subscriptions_status: "ACTIVE", subscriptions_monitors: "api" },
    ]);

    await up(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("preserves existing users and does not create duplicate subscribers", async () => {
    const users = await db("subscriber_users").select("email");
    const emails = users.map((user: { email: string }) => user.email).sort();
    expect(emails).toEqual(["existing@example.com", "unmapped@example.com", "v3@example.com"]);

    const methods = await db("subscriber_methods").where("subscriber_user_id", 1);
    expect(methods).toHaveLength(1);
  });

  it("maps V3 monitor choices and expands the legacy all-monitors value", async () => {
    const v3 = await db("subscriber_users").where("email", "v3@example.com").first();
    const v3Subs = await db("subscriber_monitor_subscriptions").where("subscriber_user_id", v3.id).pluck("monitor_tag");
    expect(v3Subs).toEqual(["api"]);

    const existing = await db("subscriber_users").where("email", "existing@example.com").first();
    const existingSubs = await db("subscriber_monitor_subscriptions")
      .where("subscriber_user_id", existing.id)
      .pluck("monitor_tag");
    // The V2 incident preference and the V3 "_" row both map to every visible
    // active monitor, without duplicates and without hidden or inactive ones.
    expect(existingSubs.sort()).toEqual(["api", "db"]);
  });

  it("reports instead of discarding rows that cannot be mapped", async () => {
    const report = await db("subscription_migration_report").select("reason", "subscriber_email");
    const reasons = report.map((row: { reason: string }) => row.reason).join("\n");

    expect(reasons).toContain("deleted-monitor");
    expect(reasons).toContain("Unsupported legacy subscriber type");
    expect(reasons).toContain("missing subscriber id 999");
    expect(report.map((row: { subscriber_email: string }) => row.subscriber_email)).toContain("unmapped@example.com");
  });
});
