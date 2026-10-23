---
title: User Subscriptions
description: Let users subscribe to the monitors they care about
---

Use subscriptions to let users receive email updates for the **monitors** they choose. A subscriber is emailed only when one of their monitors changes status or is affected by an incident or maintenance.

## How subscriptions work {#how-subscriptions-work}

1. Admin enables subscriptions in dashboard settings.
2. Email must be configured (SMTP/Resend) so verification and update emails can be sent.
3. User subscribes from the public status page using email + OTP verification.
4. User searches for and selects one or more monitors.
5. Kener emails the user only for events that affect those monitors.

## Prerequisites {#prerequisites}

Before users can subscribe:

- Subscriptions must be enabled in **Manage → Subscriptions**.
- Email setup must be valid.
- At least one active, visible monitor must exist.

> [!IMPORTANT]
> The subscribe UI is shown only when subscriptions are enabled **and** email sending is available.

See [Email Setup](/docs/v4/setup/email-setup).

## Enable subscriptions (admin) {#enable-subscriptions-admin}

Go to **Manage → Subscriptions** and turn on **Enable Subscriptions**.

This writes the `subscriptionsSettings` site configuration used by the subscription API. The email method is enabled at the same time.

## How users subscribe (public flow) {#how-users-subscribe-public-flow}

From the status page, user clicks **Subscribe**:

1. Enter email. If a [Captcha provider](/docs/v4/captcha) is enabled, solve the challenge first.
2. Kener sends a 6-digit verification code.
3. User enters OTP to verify.
4. Kener stores a subscriber session token in browser storage.
5. User searches the monitor list and checks the monitors they want updates about.

Preferences save as soon as a monitor is checked or unchecked. If the token is invalid or expired, the user is asked to verify again.

## Add subscriber from backend (admin) {#add-subscriber-from-backend-admin}

You can add subscribers manually from **Manage → Subscriptions**:

1. Click **Add Subscriber**.
2. Enter the email address.
3. Search for and select the monitors to follow.
4. Save.

Admins can also:

- Change a subscriber's monitors with the edit button
- Delete subscribers

## When notifications are triggered {#when-notifications-are-triggered}

Kener selects recipients by monitor, not by event type. A subscriber receives an email only when at least one of the following is true:

- A monitor they follow changes between `UP`, `DOWN`, and `DEGRADED`.
- An incident that affects a monitor they follow gets an update.
- A maintenance that affects a monitor they follow changes event status.

Hidden monitors never send subscriber email. See [Monitor visibility](/docs/v4/monitors/visibility#where-each-rule-applies).

An incident or maintenance marked global (`is_global = YES`) affects every monitor, so every active subscriber receives that email.

### Monitor status notifications {#monitor-status-notifications}

When a monitoring check changes a visible monitor's status, Kener emails every subscriber of that monitor. The mail includes the previous and new status and links to the monitor page. Status values that send mail are `UP`, `DOWN`, and `DEGRADED`; changes to or from `NO_DATA` do not send.

### Incident notifications {#incident-notifications}

Kener queues an incident subscription email for each update posted on an incident, from any source:

- An update added in the dashboard
- An update added through the API (`POST /api/v4/incidents/{incident_id}/comments`)
- The update an alert adds when it creates the incident, and when it resolves it

Only subscribers of the incident's affected monitors receive it. Updates on legacy incidents of type `MAINTENANCE` (from before v4 maintenances) do not queue this email.

### Maintenance notifications {#maintenance-notifications}

Maintenance subscription emails are queued on maintenance event status transitions:

- `READY` (starting soon)
- `ONGOING`
- `COMPLETED`
- `CANCELLED`

Only subscribers of the maintenance's affected monitors receive them.

## How emails are delivered {#how-emails-are-delivered}

When an event is queued:

1. Kener collects the monitors the event affects.
2. Kener selects the active email subscribers who follow at least one of those monitors.
3. Kener renders the `subscription_update` email template with event/site variables.
4. Kener enqueues **one email per recipient** (privacy-safe fan-out).
5. Email sender queue sends the final emails.

## Upgrade from Kener v3 {#upgrade-from-v3}

Upgrading an existing database imports legacy subscribers automatically:

- Subscriber emails and statuses are preserved. Existing v4 subscribers are reused, so no duplicate subscribers are created.
- Each v3 `subscriptions.subscriptions_monitors` value becomes a monitor subscription for that email.
- The legacy `_` value (all monitors) becomes a subscription to every active, visible monitor.
- Event-based v4 preferences (`incidents` / `maintenances`) also become subscriptions to every active, visible monitor.

Rows that cannot be mapped, such as a deleted monitor tag or a missing subscriber, are not discarded. Kener writes them to the `subscription_migration_report` table with the source row and reason, and logs a warning during migration.

> [!TIP]
> Back up the database before upgrading. After migrating, review `subscription_migration_report` and update those subscribers manually in **Manage → Subscriptions** if needed.

## Verify your setup {#verify-your-setup}

- Enable subscriptions in the dashboard.
- Confirm email setup works.
- Subscribe with a test email from the public status page.
- Select one monitor.
- Trigger a status change, or add an incident that affects only that monitor.
- Confirm the email arrives, then confirm an event affecting a different monitor does not.
