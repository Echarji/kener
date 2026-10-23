import db from "$lib/server/db/db.js";
import type {
  SubscriptionMethodType,
  SubscriptionEventType,
  UserSubscriptionV2Record,
  SubscriberUserRecord,
  SubscriberMethodRecord,
  MonitorSubscriptionWithMonitorRecord,
  SubscriptionMigrationReportRecord,
  SubscriptionsConfig,
  DbTimestamp,
} from "$lib/server/types/db.js";

/**
 * Email subscriptions are available when the email method is enabled. Older
 * configurations only had per-event flags, so either of those counts too.
 */
export function IsEmailSubscriptionConfigured(config: SubscriptionsConfig | null | undefined): boolean {
  if (!config) return false;
  const emails = config.methods?.emails;
  return emails?.enabled === true || emails?.incidents === true || emails?.maintenances === true;
}

// ============ V2 Admin Functions ============

/**
 * Get subscribers by method type with pagination (for admin) - V2 version
 */
export async function GetSubscribersByMethod(
  method: SubscriptionMethodType,
  page: number = 1,
  limit: number = 25,
): Promise<{
  subscribers: Array<{
    id: number;
    subscriber_send: string;
    subscriber_type: string;
    subscriber_status: string;
    created_at: DbTimestamp;
    subscription_count: number;
    event_types: SubscriptionEventType[];
  }>;
  total: number;
  totalPages: number;
  page: number;
  limit: number;
}> {
  // Use V2 tables
  const rawSubscribers = await db.getSubscribersByMethodTypeV2(method, page, limit);
  const total = await db.getMethodsCountByType(method);
  const totalPages = Math.ceil(total / limit);

  // Map to expected format for compatibility with existing UI
  const subscribers = rawSubscribers.map((s) => ({
    id: s.method_id, // Use method_id as ID since that's what we need for details page
    subscriber_send: s.method_value,
    subscriber_type: method,
    subscriber_status: s.status,
    created_at: s.created_at,
    subscription_count: s.subscription_count,
    event_types: s.event_types,
  }));

  return {
    subscribers,
    total,
    totalPages,
    page,
    limit,
  };
}

/**
 * Get subscriber counts by method (for admin dashboard) - V2 version
 */
export async function GetSubscriberCountsByMethod(): Promise<{
  email: number;
}> {
  const [email] = await Promise.all([db.getMethodsCountByType("email")]);

  return { email };
}

/**
 * Get subscriber details by method ID - V2 version
 */
export async function GetSubscriberWithSubscriptionsV2(methodId: number): Promise<{
  user: SubscriberUserRecord;
  method: SubscriberMethodRecord;
  subscriptions: UserSubscriptionV2Record[];
  monitors: MonitorSubscriptionWithMonitorRecord[];
} | null> {
  const result = await db.getSubscriberDetailsByMethodId(methodId);
  if (!result) return null;

  const monitors = await db.getMonitorSubscriptionsWithMonitorForMethod(methodId);

  return { ...result, monitors };
}

// ============ Legacy helpers ============

/**
 * Delete a subscription - V2 version
 */
export async function DeleteUserSubscription(id: number): Promise<{ success: boolean; error?: string }> {
  await db.deleteUserSubscriptionV2(id);
  return { success: true };
}

/**
 * Update subscription status - V2 version
 */
export async function UpdateUserSubscriptionStatus(
  id: number,
  status: "ACTIVE" | "INACTIVE",
): Promise<{ success: boolean; error?: string }> {
  await db.updateUserSubscriptionV2(id, { status });
  return { success: true };
}

/**
 * Format event type for display
 */
export function FormatEventType(eventType: SubscriptionEventType): string {
  switch (eventType) {
    case "incidents":
      return "Incident Updates";
    case "maintenances":
      return "Maintenance Updates";
    default:
      return eventType;
  }
}

// ============ Monitor subscriptions ============

export interface SubscribableMonitor {
  tag: string;
  name: string;
  description: string | null;
  category_name: string | null;
}

/**
 * Monitors a public visitor may subscribe to: active and visible on the
 * status page.
 */
export async function GetSubscribableMonitors(): Promise<SubscribableMonitor[]> {
  const monitors = await db.getMonitors({ status: "ACTIVE", is_hidden: "NO" });
  return monitors
    .map((monitor) => ({
      tag: monitor.tag,
      name: monitor.name,
      description: monitor.description || null,
      category_name: monitor.category_name || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getValidMonitorTags(monitorTags: string[]): Promise<string[]> {
  if (monitorTags.length === 0) return [];

  const monitors = await db.getMonitors({
    status: "ACTIVE",
    is_hidden: "NO",
    tags: [...new Set(monitorTags)],
  });
  const valid = new Set(monitors.map((monitor) => monitor.tag));
  return [...new Set(monitorTags)].filter((tag) => valid.has(tag));
}

/**
 * Replace the set of monitors a subscriber method follows. Rows that are no
 * longer selected are deactivated (not deleted) so data is never lost.
 */
async function SetMonitorSubscriptionsForMethod(
  subscriberUserId: number,
  subscriberMethodId: number,
  monitorTags: string[],
): Promise<string[]> {
  const validTags = await getValidMonitorTags(monitorTags);
  const desired = new Set(validTags);
  const existing = await db.getMonitorSubscriptions({ subscriber_method_id: subscriberMethodId });
  const existingByTag = new Map(existing.map((subscription) => [subscription.monitor_tag, subscription]));

  for (const subscription of existing) {
    if (desired.has(subscription.monitor_tag)) {
      if (subscription.status !== "ACTIVE") {
        await db.updateMonitorSubscription(subscription.id, { status: "ACTIVE" });
      }
    } else if (subscription.status === "ACTIVE") {
      await db.updateMonitorSubscription(subscription.id, { status: "INACTIVE" });
    }
  }

  for (const tag of validTags) {
    if (!existingByTag.has(tag)) {
      await db.createMonitorSubscription({
        subscriber_user_id: subscriberUserId,
        subscriber_method_id: subscriberMethodId,
        monitor_tag: tag,
        status: "ACTIVE",
      });
    }
  }

  return validTags;
}

/**
 * Get active email addresses for the monitors an event affects.
 * Undefined means every monitor (a global event).
 */
export async function GetActiveEmailsForMonitors(monitorTags?: string[]): Promise<string[]> {
  const emails = await db.getActiveEmailsForMonitors(monitorTags);
  return [...new Set(emails)];
}

/**
 * Legacy helper kept for callers that still ask by event type. New code
 * should use GetActiveEmailsForMonitors so unrelated monitors are excluded.
 */
export async function GetActiveEmailsForEventType(eventType: SubscriptionEventType): Promise<string[]> {
  const subscribers = await db.getSubscribersForEvent(eventType);

  // Filter for email method type and extract unique email addresses
  const emails = subscribers.filter((s) => s.method.method_type === "email").map((s) => s.method.method_value);

  // Return unique emails
  return [...new Set(emails)];
}

// ============ Admin Subscriber Management Functions ============

export interface AdminSubscriberRecord {
  user_id: number;
  method_id: number;
  email: string;
  monitors: string[];
  monitor_names: string[];
  subscription_count: number;
  created_at: DbTimestamp;
}

/**
 * Get paginated list of subscribers for admin view
 */
export async function GetAdminSubscribersPaginated(
  page: number = 1,
  limit: number = 10,
): Promise<{
  subscribers: AdminSubscriberRecord[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
}> {
  // Get all active subscriber users with email methods
  const result = await db.getSubscribersByMethodTypeV2("email", page, limit);
  const total = await db.getMethodsCountByType("email");
  const totalPages = Math.ceil(total / limit);

  const allSubscriptions = await db.getMonitorSubscriptionsForMethods(result.map((item) => item.method_id));
  const subscriptionsByMethod = new Map<number, MonitorSubscriptionWithMonitorRecord[]>();
  for (const subscription of allSubscriptions) {
    const list = subscriptionsByMethod.get(subscription.subscriber_method_id) || [];
    list.push(subscription);
    subscriptionsByMethod.set(subscription.subscriber_method_id, list);
  }

  const subscribers: AdminSubscriberRecord[] = result.map((item) => {
    const active = (subscriptionsByMethod.get(item.method_id) || []).filter((s) => s.status === "ACTIVE");
    return {
      user_id: item.id,
      method_id: item.method_id,
      email: item.email,
      monitors: active.map((s) => s.monitor_tag),
      monitor_names: active.map((s) => s.monitor_name),
      subscription_count: active.length,
      created_at: item.created_at,
    };
  });

  return {
    subscribers,
    total,
    totalPages,
    page,
    limit,
  };
}

/**
 * Admin: replace a subscriber's monitor subscriptions.
 */
export async function AdminSetSubscriberMonitors(
  methodId: number,
  monitorTags: string[],
): Promise<{ success: boolean; error?: string; monitors?: string[] }> {
  const method = await db.getSubscriberMethodById(methodId);
  if (!method) {
    return { success: false, error: "Subscriber not found" };
  }

  const monitors = await SetMonitorSubscriptionsForMethod(method.subscriber_user_id, methodId, monitorTags);
  return { success: true, monitors };
}

/**
 * Admin: enable or disable one monitor subscription for a subscriber.
 */
export async function AdminUpdateSubscriptionStatus(
  methodId: number,
  monitorTag: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  const method = await db.getSubscriberMethodById(methodId);
  if (!method) {
    return { success: false, error: "Subscriber not found" };
  }

  const [validTag] = await getValidMonitorTags([monitorTag]);
  if (!validTag) {
    return { success: false, error: "Monitor not found" };
  }

  const existing = await db.getMonitorSubscriptions({
    subscriber_method_id: methodId,
    monitor_tag: validTag,
  });

  if (enabled) {
    if (existing.length === 0) {
      await db.createMonitorSubscription({
        subscriber_user_id: method.subscriber_user_id,
        subscriber_method_id: methodId,
        monitor_tag: validTag,
        status: "ACTIVE",
      });
    } else if (existing[0].status !== "ACTIVE") {
      await db.updateMonitorSubscription(existing[0].id, { status: "ACTIVE" });
    }
  } else if (existing.length > 0 && existing[0].status === "ACTIVE") {
    await db.updateMonitorSubscription(existing[0].id, { status: "INACTIVE" });
  }

  return { success: true };
}

/**
 * Admin: Delete a subscriber completely (user, method, and all subscriptions)
 */
export async function AdminDeleteSubscriber(methodId: number): Promise<{ success: boolean; error?: string }> {
  // Get method to find user
  const method = await db.getSubscriberMethodById(methodId);
  if (!method) {
    return { success: false, error: "Subscriber not found" };
  }

  // Delete all subscriptions for this method
  await db.deleteMonitorSubscriptionsByMethodId(methodId);
  const subscriptions = await db.getUserSubscriptionsV2({
    subscriber_method_id: methodId,
  });

  for (const sub of subscriptions) {
    await db.deleteUserSubscriptionV2(sub.id);
  }

  // Delete the method
  await db.deleteSubscriberMethod(methodId);

  // Check if user has any other methods
  const otherMethods = await db.getSubscriberMethodsByUserId(method.subscriber_user_id);
  if (otherMethods.length === 0) {
    // Delete the user too
    await db.deleteSubscriberUser(method.subscriber_user_id);
  }

  return { success: true };
}

/**
 * Admin: Add a new subscriber following the given monitors.
 */
export async function AdminAddSubscriber(
  email: string,
  monitorTags: string[] = [],
): Promise<{ success: boolean; error?: string; subscriber?: AdminSubscriberRecord }> {
  if (!ValidateEmail(email)) {
    return { success: false, error: "Invalid email address" };
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check if user already exists
  let user = await db.getSubscriberUserByEmail(normalizedEmail);
  if (!user) {
    // Create new user
    user = await db.createSubscriberUser({
      email: normalizedEmail,
      status: "ACTIVE",
    });
  } else if (user.status !== "ACTIVE") {
    // Activate existing user
    await db.updateSubscriberUser(user.id, { status: "ACTIVE" });
  }

  // Check if email method exists
  let method = await db.getSubscriberMethodByUserAndType(user.id, "email", normalizedEmail);
  if (!method) {
    method = await db.createSubscriberMethod({
      subscriber_user_id: user.id,
      method_type: "email",
      method_value: normalizedEmail,
      status: "ACTIVE",
    });
  } else if (method.status !== "ACTIVE") {
    await db.updateSubscriberMethod(method.id, { status: "ACTIVE" });
  }

  const monitors = await SetMonitorSubscriptionsForMethod(user.id, method.id, monitorTags);
  const monitorRows = await db.getMonitorSubscriptionsWithMonitorForMethod(method.id);
  const active = monitorRows.filter((row) => row.status === "ACTIVE");

  return {
    success: true,
    subscriber: {
      user_id: user.id,
      method_id: method.id,
      email: normalizedEmail,
      monitors,
      monitor_names: active.map((row) => row.monitor_name),
      subscription_count: active.length,
      created_at: method.created_at,
    },
  };
}

// ============ Public Subscription Functions ============

import { GenerateTokenWithExpiry, VerifyToken } from "./commonController.js";
import { GenerateRandomNumber, ValidateEmail } from "../tool.js";
import sendEmail from "../notification/email_notification.js";
import { GetAllSiteData } from "./controller.js";
import { siteDataToVariables } from "../notification/notification_utils.js";
import { GetGeneralEmailTemplateById } from "./generalTemplateController.js";

interface SubscriberTokenPayload {
  subscriber_user_id: number;
  subscriber_method_id: number;
  email: string;
  type: "subscriber";
}

/**
 * Verify subscriber token and return subscriber info
 */
export async function VerifySubscriberToken(token: string): Promise<{
  success: boolean;
  error?: string;
  user?: SubscriberUserRecord;
  method?: SubscriberMethodRecord;
  subscriptions?: { monitors: string[] };
}> {
  const decoded = await VerifyToken(token);
  if (!decoded || (decoded as unknown as SubscriberTokenPayload).type !== "subscriber") {
    return { success: false, error: "Invalid or expired token" };
  }

  const payload = decoded as unknown as SubscriberTokenPayload;
  const user = await db.getSubscriberUserById(payload.subscriber_user_id);
  if (!user || user.status !== "ACTIVE") {
    return { success: false, error: "User not found or inactive" };
  }

  const method = await db.getSubscriberMethodById(payload.subscriber_method_id);
  if (!method || method.status !== "ACTIVE") {
    return { success: false, error: "Subscription method not found or inactive" };
  }

  const monitors = await db.getMonitorSubscriptionTagsForMethod(method.id);

  return { success: true, user, method, subscriptions: { monitors } };
}

/**
 * Login/Register subscriber - send verification code
 */
export async function SubscriberLogin(email: string): Promise<{ success: boolean; error?: string }> {
  if (!ValidateEmail(email)) {
    return { success: false, error: "Invalid email address" };
  }

  const normalizedEmail = email.toLowerCase().trim();
  const verificationCode = String(GenerateRandomNumber(6));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Check if user exists
  let user = await db.getSubscriberUserByEmail(normalizedEmail);

  if (!user) {
    // Create new user
    user = await db.createSubscriberUser({
      email: normalizedEmail,
      status: "PENDING",
      verification_code: verificationCode,
      verification_expires_at: expiresAt,
    });
  } else {
    // Update verification code
    await db.updateSubscriberUser(user.id, {
      verification_code: verificationCode,
      verification_expires_at: expiresAt,
    });
  }

  // Get email template
  const template = await GetGeneralEmailTemplateById("subscription_account_code");
  if (!template) {
    return { success: false, error: "Email template not found" };
  }

  // Get site data for variables
  const siteData = await GetAllSiteData();
  const siteVars = siteDataToVariables(siteData);

  // Prepare variables
  const emailVars = {
    ...siteVars,
    email_code: verificationCode,
  };

  // Send email
  try {
    await sendEmail(
      template.template_html_body || "",
      template.template_subject || "Your Verification Code",
      emailVars,
      [normalizedEmail],
      undefined,
      template.template_text_body || "",
    );
    return { success: true };
  } catch (error) {
    console.error("Failed to send verification email:", error);
    return { success: false, error: "Failed to send verification email" };
  }
}

/**
 * Verify OTP and return token
 */
export async function VerifySubscriberOTP(
  email: string,
  code: string,
): Promise<{ success: boolean; error?: string; token?: string }> {
  if (!ValidateEmail(email)) {
    return { success: false, error: "Invalid email address" };
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await db.getSubscriberUserByEmail(normalizedEmail);

  if (!user) {
    return { success: false, error: "User not found" };
  }

  // Check verification code
  if (user.verification_code !== code) {
    return { success: false, error: "Invalid verification code" };
  }

  // Check expiry
  if (user.verification_expires_at && new Date(user.verification_expires_at) < new Date()) {
    return { success: false, error: "Verification code expired" };
  }

  // Activate user
  await db.updateSubscriberUser(user.id, {
    status: "ACTIVE",
    verification_code: null,
    verification_expires_at: null,
  });

  // Create or get email method
  let method = await db.getSubscriberMethodByUserAndType(user.id, "email", normalizedEmail);
  if (!method) {
    method = await db.createSubscriberMethod({
      subscriber_user_id: user.id,
      method_type: "email",
      method_value: normalizedEmail,
      status: "ACTIVE",
    });
  }

  // Generate token (1 year expiry)
  const tokenPayload: SubscriberTokenPayload = {
    subscriber_user_id: user.id,
    subscriber_method_id: method.id,
    email: normalizedEmail,
    type: "subscriber",
  };

  const token = await GenerateTokenWithExpiry(tokenPayload, "1y");
  return { success: true, token };
}

/**
 * Replace the signed-in subscriber's monitor preferences.
 */
export async function UpdateSubscriberPreferences(
  token: string,
  monitorTags: string[],
): Promise<{ success: boolean; error?: string; monitors?: string[] }> {
  const verifyResult = await VerifySubscriberToken(token);
  if (!verifyResult.success || !verifyResult.user || !verifyResult.method) {
    return { success: false, error: verifyResult.error || "Invalid token" };
  }

  const monitors = await SetMonitorSubscriptionsForMethod(verifyResult.user.id, verifyResult.method.id, monitorTags);

  return { success: true, monitors };
}

// ============ Migration report ============

export async function GetSubscriptionMigrationReport(
  page: number = 1,
  limit: number = 25,
): Promise<{
  rows: SubscriptionMigrationReportRecord[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
}> {
  const [rows, total] = await Promise.all([
    db.getSubscriptionMigrationReport(page, limit),
    db.getSubscriptionMigrationReportCount(),
  ]);

  return {
    rows,
    total,
    totalPages: Math.ceil(total / limit),
    page,
    limit,
  };
}
