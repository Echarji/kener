---
title: User Subscriptions
description: Let users subscribe to incident, maintenance and monitor email updates
---

Use subscriptions to let users receive email updates for **incidents**, **maintenances**, and the **monitors** they pick.

## How subscriptions work {#how-subscriptions-work}

1. Admin enables subscriptions in dashboard settings.
2. Email must be configured (SMTP/Resend) so verification and update emails can be sent.
3. User subscribes from the public status page using email + OTP verification.
4. User enables incidents and/or maintenances preferences, and/or picks monitors.
5. When events are triggered, Kener sends emails to active subscribers for that event type and to the subscribers of the monitors it affects.

## Prerequisites {#prerequisites}

Before users can subscribe:

- Subscriptions must be enabled in **Manage → Subscriptions**.
- At least one email subscription type must be enabled (`incidents`, `maintenances` and/or `monitors`).
- Email setup must be valid.

> [!IMPORTANT]
> The subscribe UI is shown only when subscriptions are enabled **and** email sending is available.

See [Email Setup](/docs/v4/setup/email-setup).

## Enable subscriptions (admin) {#enable-subscriptions-admin}

Go to **Manage → Subscriptions**:

1. Turn on **Enable Subscriptions**.
2. Enable any of:
    - **Incident Updates**: every incident.
    - **Maintenance Updates**: every maintenance.
    - **Monitor Updates**: only the monitors each subscriber picks. See [Monitor notifications](#monitor-notifications).
3. Save.

This writes the `subscriptionsSettings` site configuration used by the subscription API. Settings saved before **Monitor Updates** existed have no `monitors` key; there, monitor subscriptions are on whenever subscriptions are.

## How users subscribe (public flow) {#how-users-subscribe-public-flow}

From the status page, user clicks **Subscribe**, or the bell next to a monitor:

1. Enter email. If a [Captcha provider](/docs/v4/captcha) is enabled, solve the challenge first. With **Monitor Updates** on, the user can also pick monitors here; a monitor's bell picks that monitor.
2. Kener sends a 6-digit verification code.
3. User enters OTP to verify. Kener subscribes them to the monitors they picked.
4. Kener stores a subscriber session token in browser storage.
5. User toggles preferences for incidents and/or maintenances, and manages monitors: **Manage monitors** opens a searchable list to add or remove several at once, and the **×** next to a monitor unsubscribes from it.

The picker lists active monitors that are not [hidden](/docs/v4/monitors/visibility). A filled bell on a monitor shows the signed-in user follows it.

If token is invalid/expired, user is asked to verify again.

## Add subscriber from backend (admin) {#add-subscriber-from-backend-admin}

You can add subscribers manually from **Manage → Subscriptions**:

1. Click **Add Subscriber**.
2. Enter email.
3. Select event types (incidents, maintenances).
4. Save.

Admins can also:

- Toggle incident/maintenance subscription per subscriber
- See the monitors each subscriber follows (the **Monitors** column)
- Delete subscribers

## When notifications are triggered {#when-notifications-are-triggered}

Kener emails subscribers about an incident or maintenance only when it is global (`is_global = YES`) or affects at least one monitor that is not hidden. See [Monitor visibility](/docs/v4/monitors/visibility#where-each-rule-applies).

### Incident notifications {#incident-notifications}

Kener queues an incident subscription email for each update posted on an incident, from any source:

- An update added in the dashboard
- An update added through the API (`POST /api/v4/incidents/{incident_id}/comments`)
- The update an alert adds when it creates the incident, and when it resolves it

Updates on legacy incidents of type `MAINTENANCE` (from before v4 maintenances) do not queue this email.

### Maintenance notifications {#maintenance-notifications}

Maintenance subscription emails are queued on maintenance event status transitions:

- `READY` (starting soon)
- `ONGOING`
- `COMPLETED`

### Monitor notifications {#monitor-notifications}

A subscriber who picked a monitor is emailed when:

| Event                                                         | Email                                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The monitor's status changes between `UP`, `DOWN`, `DEGRADED` | One email per change. `MAINTENANCE` is announced by the maintenance emails instead, so a monitor that leaves maintenance in the status it entered with sends none. |
| The monitor is added to an incident                           | Only when the incident is not resolved and has posted an update; the incident's first update already reaches the subscribers of every monitor it has by then.      |
| The monitor is added to a maintenance                         | About the maintenance's next window that has not ended, when the maintenance is active and its **created** notifications are on.                                   |
| An incident or maintenance affecting the monitor is updated   | The same [incident](#incident-notifications) and [maintenance](#maintenance-notifications) emails as above.                                                        |

Hidden monitors send no monitor emails. Deleting a monitor deletes its subscriptions.

## How emails are delivered {#how-emails-are-delivered}

When an event is queued:

1. Kener selects active subscribers for that `event_type`, and the subscribers of the monitors the event affects. An email about one monitor (a status change, or a monitor added to an incident or maintenance) goes to that monitor's subscribers only.
2. Kener renders the `subscription_update` email template with event/site variables.
3. Kener enqueues **one email per recipient**, so a user who matches several ways gets one email (privacy-safe fan-out).
4. Email sender queue sends the final emails.

## Upgrading from Kener v3 {#upgrading-from-kener-v3}

The migration `20261102120000_add_monitor_subscriptions` copies verified v3 email subscribers into the v4 tables:

- A v3 subscription to every monitor (`_`) becomes the incidents and maintenances subscriptions.
- A v3 subscription to a monitor that still exists becomes a monitor subscription.

Unverified v3 subscribers and turned-off v3 subscriptions are not copied. A v4 subscriber with the same email keeps their v4 preferences, and is activated if they never verified on v4. The v3 `subscribers` and `subscriptions` tables are left unchanged. Turn subscriptions back on in **Manage → Subscriptions** after upgrading.

## Verify your setup {#verify-your-setup}

- Enable subscriptions in dashboard.
- Confirm email setup works.
- Subscribe with a test email from public status page.
- Enable incident and/or maintenance preferences, or pick a monitor.
- Trigger a test incident or wait for maintenance state transition.
- Confirm email arrives.
