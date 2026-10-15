import type { Knex } from "knex";

/**
 * Monitor-based subscriptions.
 *
 * The previous subscription model (`user_subscriptions_v2`) targeted an *event type*
 * ("incidents" / "maintenances"): a subscriber opted into all incidents or all maintenance
 * updates globally. This migration introduces `subscriber_monitors`, which binds a subscriber
 * (via its delivery method) to a specific monitor tag, so notifications can be filtered down
 * to the monitors a user actually cares about.
 *
 * The existing subscriber identity tables (`subscriber_users`, `subscriber_methods`) are
 * reused unchanged. The legacy `user_subscriptions_v2` table is intentionally preserved so no
 * subscriber data is lost; existing active subscribers are also backfilled onto every currently
 * active, non-hidden monitor, which reproduces the old "notify me about everything" behaviour
 * until they curate their selection in the subscription popup.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Create subscriber_monitors table with its indexes and constraints inline. Creating the
  // whole table in a single statement keeps it atomic on every engine and avoids duplicate-index
  // errors (which, on Postgres, would abort the migration transaction).
  if (!(await knex.schema.hasTable("subscriber_monitors"))) {
    await knex.schema.createTable("subscriber_monitors", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_user_id").unsigned().notNullable();
      table.integer("subscriber_method_id").unsigned().notNullable();
      table.string("monitor_tag", 255).notNullable();
      table.string("status", 20).notNullable().defaultTo("ACTIVE");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());

      table.index(["subscriber_user_id"]);
      table.index(["subscriber_method_id"]);
      table.index(["monitor_tag"]);
      table.index(["status"]);
      table.unique(["subscriber_user_id", "subscriber_method_id", "monitor_tag"], {
        indexName: "sub_monitors_user_method_tag_unique",
      });

      table.foreign("subscriber_user_id").references("id").inTable("subscriber_users").onDelete("CASCADE");
      table.foreign("subscriber_method_id").references("id").inTable("subscriber_methods").onDelete("CASCADE");
      table.foreign("monitor_tag").references("tag").inTable("monitors").onDelete("CASCADE");
    });
  }

  // 2. Best-effort backfill. Existing active event subscribers are mapped onto every active,
  // non-hidden monitor. Guarded so a failure can never leave the schema half-migrated, and
  // only runs when the new table is still empty (never overwrites a user's curation).
  try {
    const hasNewTable = await knex.schema.hasTable("subscriber_monitors");
    const hasLegacyTable = await knex.schema.hasTable("user_subscriptions_v2");
    const hasMonitors = await knex.schema.hasTable("monitors");
    if (!hasNewTable || !hasLegacyTable || !hasMonitors) {
      return;
    }

    const existing = await knex("subscriber_monitors").count("id as count").first();
    if (Number(existing?.count || 0) > 0) {
      return;
    }

    const activeSubs = await knex("user_subscriptions_v2")
      .where("status", "ACTIVE")
      .select("subscriber_user_id", "subscriber_method_id");

    const monitors = await knex("monitors").where("status", "ACTIVE").where("is_hidden", "NO").select("tag");

    if (activeSubs.length === 0 || monitors.length === 0) {
      return;
    }

    // De-duplicate (user, method) pairs: a subscriber may hold both an incidents and a
    // maintenances row, which must not produce duplicate monitor rows.
    const pairs = new Map<number, { subscriber_user_id: number; subscriber_method_id: number }>();
    for (const row of activeSubs) {
      const key = Number(row.subscriber_method_id);
      if (!pairs.has(key)) {
        pairs.set(key, {
          subscriber_user_id: Number(row.subscriber_user_id),
          subscriber_method_id: Number(row.subscriber_method_id),
        });
      }
    }

    const rows: Array<Record<string, unknown>> = [];
    for (const pair of pairs.values()) {
      for (const monitor of monitors) {
        rows.push({
          subscriber_user_id: pair.subscriber_user_id,
          subscriber_method_id: pair.subscriber_method_id,
          monitor_tag: monitor.tag,
          status: "ACTIVE",
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      }
    }

    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      await knex("subscriber_monitors").insert(rows.slice(i, i + batchSize));
    }
  } catch (error) {
    console.warn("Monitor subscription backfill skipped:", error);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("subscriber_monitors");
}
