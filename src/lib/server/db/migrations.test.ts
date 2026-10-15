import { afterEach, beforeEach, describe, expect, it } from "vitest";
import knex, { type Knex } from "knex";
import { up, down } from "../../../../migrations/20261014120000_add_monitor_subscriptions";

/**
 * Exercises the monitor-subscription migration against a throwaway SQLite database: schema
 * creation, the legacy-subscriber backfill, idempotency, the unique guard, and the down path.
 */
describe("migration 20261014120000_add_monitor_subscriptions", () => {
  let db: Knex;
  let methodId = 0;
  let userId = 0;

  beforeEach(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });

    await db.schema.createTable("subscriber_users", (table) => {
      table.increments("id").primary();
      table.string("email", 255).notNullable().unique();
      table.string("status", 20).notNullable().defaultTo("PENDING");
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
    });
    await db.schema.createTable("subscriber_methods", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_user_id").unsigned().notNullable();
      table.string("method_type", 50).notNullable();
      table.string("method_value", 500).notNullable();
      table.string("status", 20).notNullable().defaultTo("ACTIVE");
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
    });
    await db.schema.createTable("user_subscriptions_v2", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_user_id").unsigned().notNullable();
      table.integer("subscriber_method_id").unsigned().notNullable();
      table.string("event_type", 50).notNullable();
      table.string("status", 20).notNullable().defaultTo("ACTIVE");
      table.timestamp("created_at").defaultTo(db.fn.now());
      table.timestamp("updated_at").defaultTo(db.fn.now());
    });
    await db.schema.createTable("monitors", (table) => {
      table.increments("id").primary();
      table.string("tag", 255).notNullable().unique();
      table.string("name", 255).notNullable().unique();
      table.string("status", 255);
      table.string("is_hidden", 255).defaultTo("NO");
    });

    await db("monitors").insert([
      { tag: "api", name: "API", status: "ACTIVE", is_hidden: "NO" },
      { tag: "web", name: "Website", status: "ACTIVE", is_hidden: "NO" },
      { tag: "hidden", name: "Hidden", status: "ACTIVE", is_hidden: "YES" },
      { tag: "retired", name: "Retired", status: "INACTIVE", is_hidden: "NO" },
    ]);

    userId = (await db("subscriber_users").insert({ email: "alice@example.com", status: "ACTIVE" }))[0];
    methodId = (
      await db("subscriber_methods").insert({
        subscriber_user_id: userId,
        method_type: "email",
        method_value: "alice@example.com",
        status: "ACTIVE",
      })
    )[0];
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("creates the table with the unique guard and cascade foreign keys", async () => {
    await up(db);

    expect(await db.schema.hasTable("subscriber_monitors")).toBe(true);

    const insert = () =>
      db("subscriber_monitors").insert({
        subscriber_user_id: userId,
        subscriber_method_id: methodId,
        monitor_tag: "api",
        status: "ACTIVE",
      });

    await insert();
    await expect(insert()).rejects.toThrow();

    // Deleting the owning user cascades to the subscription rows.
    await db("subscriber_users").where("id", userId).del();
    expect(await db("subscriber_monitors").where("subscriber_user_id", userId)).toHaveLength(0);
  });

  it("backfills legacy active event subscribers onto every active, non-hidden monitor", async () => {
    await db("user_subscriptions_v2").insert([
      { subscriber_user_id: userId, subscriber_method_id: methodId, event_type: "incidents", status: "ACTIVE" },
      { subscriber_user_id: userId, subscriber_method_id: methodId, event_type: "maintenances", status: "ACTIVE" },
    ]);

    await up(db);

    const rows = await db("subscriber_monitors").where("subscriber_method_id", methodId).select("monitor_tag");
    // Both legacy rows are the same (user, method) pair, deduped; hidden/inactive monitors skipped.
    expect(rows.map((r) => r.monitor_tag).sort()).toEqual(["api", "web"]);
  });

  it("does not backfill inactive legacy subscribers", async () => {
    await db("user_subscriptions_v2").insert({
      subscriber_user_id: userId,
      subscriber_method_id: methodId,
      event_type: "incidents",
      status: "INACTIVE",
    });

    await up(db);

    expect(await db("subscriber_monitors")).toHaveLength(0);
  });

  it("is idempotent and never overwrites an existing curation", async () => {
    await up(db);
    await db("subscriber_monitors").insert({
      subscriber_user_id: userId,
      subscriber_method_id: methodId,
      monitor_tag: "api",
      status: "ACTIVE",
    });

    // A second run must neither throw nor add rows.
    await up(db);

    expect(await db("subscriber_monitors")).toHaveLength(1);
  });

  it("drops the table on down", async () => {
    await up(db);
    expect(await db.schema.hasTable("subscriber_monitors")).toBe(true);

    await down(db);
    expect(await db.schema.hasTable("subscriber_monitors")).toBe(false);
  });
});
