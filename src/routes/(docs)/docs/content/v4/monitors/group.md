---
title: Group Monitor
description: Combine multiple monitors into a weighted aggregate status
---

Group monitors aggregate member monitor status and latency into one monitor.

## Minimum setup {#minimum-setup}

Requirements from current validation:

- at least **2** member monitors
- members must be active, non-group monitors
- weights must sum to approximately `1` (tolerance `0.01`)
- `executionDelay` must be `>= 1000` ms
- `latencyCalculation` in `AVG | MAX | MIN`

## Status scoring model {#status-scoring-model}

Member statuses are normalized to a 0–1 scale:

- `UP = 1`
- `DEGRADED = 0.5`
- `DOWN = 0`

Members in `MAINTENANCE` are treated as `UP` (score `1`) and do not affect the group status.

Weighted score:

```
Σ(member.weight * statusScore)
```

Mapped group status:

- `= 1` → **UP** (all members healthy)
- `> 0` and `< 1` → **DEGRADED** (partial failure)
- `= 0` → **DOWN** (all members down)

### Example {#scoring-example}

5 monitors with equal weight (`0.2` each), 1 is DOWN:

```
4 × 0.2 × 1 (UP) + 1 × 0.2 × 0 (DOWN) = 0.8 → DEGRADED
```

## On the status page {#on-the-status-page}

A group monitor added to a [page](/docs/v4/pages) is shown as a card:

- The group's name, description, uptime and status history, and its status: **Operational** (`UP`), **Degraded**, **Down** or **Under Maintenance**, by the [scoring model](#status-scoring-model) above. One member down among healthy ones makes the group **Degraded**, not **Down**.
- A summary of its members' statuses, worst first, for example `1 down · 3 operational`.
- Its members, laid out by the group's [display settings](#status-page-display).

Members that are inactive, or [hidden](/docs/v4/monitors/visibility) from the viewer, are left out of the card. Each member and the group can be [subscribed to](/docs/v4/subscriptions#monitor-notifications) on their own.

### Status page display {#status-page-display}

Set these under **Status page display** when editing the group:

| Setting    | Options             | What visitors see                                                                                                                                                                      |
| :--------- | :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layout** | `list`, `grid`      | Members one below the other, or side by side in columns that fit the card's width.                                                                                                     |
| **Style**  | `simple`, `compact` | `simple`: each member with its icon, description, uptime and status history bar. `compact`: one line per member with its status and uptime; **Included Monitors** opens their history. |

A group saved without these settings shows a compact list. Visitors can switch a group between list and grid with the toggle on its card; their choice is stored in their browser for that group.

## Latency aggregation {#latency-aggregation}

Group latency uses selected mode:

- `AVG`: average member latency
- `MAX`: slowest member latency
- `MIN`: fastest member latency

## Execution delay {#execution-delay}

`executionDelay` (in milliseconds) controls how long the group monitor waits before running its aggregation. This delay gives member monitors time to complete their own checks and update the cache before the group reads their statuses.

- Default: `1000` (1 second). Minimum: `1000`.
- If member monitors take longer to finish (e.g. slow API checks), increase this value so the group always reads fresh results.
- Only affects cron-driven execution. When a member's status is updated via the API, the cache is updated immediately and the group will read the new value on its next run.

## Configuration fields {#configuration-fields}

| Field                | Type                   | Default   | Notes                                          |
| :------------------- | :--------------------- | :-------- | :--------------------------------------------- |
| `monitors`           | `Array<{tag, weight}>` | `[]`      | Required, min 2                                |
| `executionDelay`     | `number`               | `1000`    | ms to wait before aggregating; must be >= 1000 |
| `latencyCalculation` | `AVG\|MAX\|MIN`        | `AVG`     |                                                |
| `membersLayout`      | `list\|grid`           | `list`    | How the status page lays out the members       |
| `membersStyle`       | `simple\|compact`      | `compact` | `simple` adds each member's status history     |

## Example {#example}

```json
{
    "monitor_type": "GROUP",
    "type_data": {
        "monitors": [
            { "tag": "api", "weight": 0.6 },
            { "tag": "db", "weight": 0.3 },
            { "tag": "cache", "weight": 0.1 }
        ],
        "executionDelay": 1500,
        "latencyCalculation": "AVG",
        "membersLayout": "grid",
        "membersStyle": "simple"
    }
}
```

## Troubleshooting {#troubleshooting}

- **Cannot save**: verify weights sum to `1`, min member count, and delay >= `1000`
- **Unexpected stale status (cron)**: increase `executionDelay` so member checks finish before the group aggregates
- **Unexpected stale status (API updates)**: ensure you are running a version that updates the cache on API writes — older versions only updated the cache from cron, causing the group to miss API-driven status changes
- **Group too sensitive/lenient**: adjust weights — higher weight on critical monitors makes their failure impact the group score more
