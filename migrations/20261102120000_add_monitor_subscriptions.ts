import type { Knex } from "knex";

// Kener v3 kept subscribers in `subscribers` and one row per followed monitor in `subscriptions`:
// `subscriptions_monitors` held a monitor tag, or "_" ("ALL" in older builds) for every monitor.
const V3_EVERY_MONITOR = new Set(["_", "ALL"]);

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("user_monitor_subscriptions"))) {
    await knex.schema.createTable("user_monitor_subscriptions", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_user_id").unsigned().notNullable();
      table.integer("subscriber_method_id").unsigned().notNullable();
      table.string("monitor_tag", 255).notNullable();
      table.string("status", 20).notNullable().defaultTo("ACTIVE");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
      table.unique(["subscriber_method_id", "monitor_tag"], { indexName: "user_monitor_subs_method_tag_unique" });
      table.index(["monitor_tag"], "user_monitor_subs_monitor_tag_index");
      table.index(["subscriber_user_id"], "user_monitor_subs_user_index");
      table.foreign("subscriber_user_id").references("id").inTable("subscriber_users").onDelete("CASCADE");
      table.foreign("subscriber_method_id").references("id").inTable("subscriber_methods").onDelete("CASCADE");
    });
  }

  await copyV3Subscriptions(knex);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("user_monitor_subscriptions");
}

/**
 * Copies verified v3 email subscribers into the v4 tables. A v3 subscription to every monitor becomes
 * the incidents and maintenances subscriptions; a subscription to a monitor that still exists becomes a
 * monitor subscription. Rows that already exist are left as they are, so a subscriber who changed their
 * v4 preferences keeps them, and running this twice adds nothing. The v3 tables are not changed.
 */
async function copyV3Subscriptions(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("subscribers")) || !(await knex.schema.hasTable("subscriptions"))) {
    return;
  }

  const v3Subscribers: Array<{ id: number; subscriber_send: string | null }> = await knex("subscribers")
    .where({ subscriber_type: "email", subscriber_status: "ACTIVE" })
    .select("id", "subscriber_send");
  if (v3Subscribers.length === 0) return;

  const monitorTags = new Set<string>((await knex("monitors").select("tag")).map((m: { tag: string }) => m.tag));

  for (const v3Subscriber of v3Subscribers) {
    const email = String(v3Subscriber.subscriber_send || "")
      .toLowerCase()
      .trim();
    if (!email.includes("@") || email.length > 255) continue;

    const targets: string[] = (
      await knex("subscriptions")
        .where({ subscriber_id: v3Subscriber.id, subscriptions_status: "ACTIVE" })
        .select("subscriptions_monitors")
    ).map((row: { subscriptions_monitors: string }) => String(row.subscriptions_monitors));
    const everyMonitor = targets.some((target) => V3_EVERY_MONITOR.has(target));
    const tags = [...new Set(targets.filter((target) => monitorTags.has(target)))];
    if (!everyMonitor && tags.length === 0) continue;

    const userId = await findOrCreateActiveUser(knex, email);
    const methodId = await findOrCreateEmailMethod(knex, userId, email);

    if (everyMonitor) {
      for (const eventType of ["incidents", "maintenances"]) {
        const existing = await knex("user_subscriptions_v2")
          .where({ subscriber_user_id: userId, subscriber_method_id: methodId, event_type: eventType })
          .first();
        if (!existing) {
          await knex("user_subscriptions_v2").insert({
            subscriber_user_id: userId,
            subscriber_method_id: methodId,
            event_type: eventType,
            status: "ACTIVE",
          });
        }
      }
    }

    for (const tag of tags) {
      const existing = await knex("user_monitor_subscriptions")
        .where({ subscriber_method_id: methodId, monitor_tag: tag })
        .first();
      if (!existing) {
        await knex("user_monitor_subscriptions").insert({
          subscriber_user_id: userId,
          subscriber_method_id: methodId,
          monitor_tag: tag,
          status: "ACTIVE",
        });
      }
    }
  }
}

// v3 verified the address, so a v4 sign-up that was never verified becomes active.
async function findOrCreateActiveUser(knex: Knex, email: string): Promise<number> {
  const existing = await knex("subscriber_users").where({ email }).first();
  if (existing) {
    if (existing.status === "PENDING") {
      await knex("subscriber_users").where({ id: existing.id }).update({ status: "ACTIVE", updated_at: knex.fn.now() });
    }
    return existing.id;
  }
  await knex("subscriber_users").insert({ email, status: "ACTIVE" });
  return (await knex("subscriber_users").where({ email }).first()).id;
}

async function findOrCreateEmailMethod(knex: Knex, userId: number, email: string): Promise<number> {
  const where = { subscriber_user_id: userId, method_type: "email", method_value: email };
  const existing = await knex("subscriber_methods").where(where).first();
  if (existing) return existing.id;
  await knex("subscriber_methods").insert({ ...where, status: "ACTIVE" });
  return (await knex("subscriber_methods").where(where).first()).id;
}
