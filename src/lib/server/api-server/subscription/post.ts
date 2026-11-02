import { json, error } from "@sveltejs/kit";
import type { APIServerRequest } from "$lib/server/types/api-server";
import type { SubscriptionsConfig } from "$lib/server/types/db.js";
import { GetSiteDataByKey } from "$lib/server/controllers/siteDataController";
import { VerifyCaptchaToken } from "$lib/server/controllers/captchaController";
import {
  SubscriberLogin,
  VerifySubscriberOTP,
  VerifySubscriberToken,
  UpdateSubscriberPreferences,
  GetSubscribableMonitors,
  MonitorSubscriptionsEnabled,
} from "$lib/server/controllers/userSubscriptionsController";

// The most monitors one preferences update may name.
const MAX_MONITORS_PER_UPDATE = 500;

interface LoginRequest {
  action: "login";
  email: string;
  captchaToken?: string | null;
}

interface VerifyRequest {
  action: "verify";
  email: string;
  code: string;
}

interface GetPreferencesRequest {
  action: "getPreferences";
  token: string;
}

interface UpdatePreferencesRequest {
  action: "updatePreferences";
  token: string;
  incidents?: boolean;
  maintenances?: boolean;
  // Replaces the monitors the subscriber follows.
  monitors?: string[];
}

interface GetMonitorsRequest {
  action: "getMonitors";
}

type PostRequestBody =
  | LoginRequest
  | VerifyRequest
  | GetPreferencesRequest
  | UpdatePreferencesRequest
  | GetMonitorsRequest;

export default async function post(req: APIServerRequest): Promise<Response> {
  const body = req.body as PostRequestBody;
  const { action } = body;

  // Check if subscriptions are enabled
  const config = await GetSubscriptionConfig();
  if (!config || !config.enable) {
    return error(400, { message: "Subscriptions are not enabled" });
  }

  const emailEnabled =
    config.methods?.emails?.incidents === true ||
    config.methods?.emails?.maintenances === true ||
    MonitorSubscriptionsEnabled(config);
  if (!emailEnabled) {
    return error(400, { message: "Email subscriptions are not enabled" });
  }

  switch (action) {
    case "login":
      return handleLogin((body as LoginRequest).email, (body as LoginRequest).captchaToken, config);
    case "verify":
      return handleVerify((body as VerifyRequest).email, (body as VerifyRequest).code);
    case "getPreferences":
      return handleGetPreferences((body as GetPreferencesRequest).token, config);
    case "updatePreferences":
      return handleUpdatePreferences(
        (body as UpdatePreferencesRequest).token,
        (body as UpdatePreferencesRequest).incidents,
        (body as UpdatePreferencesRequest).maintenances,
        (body as UpdatePreferencesRequest).monitors,
        config,
      );
    case "getMonitors":
      return handleGetMonitors(config);
    default:
      return error(400, { message: "Invalid action" });
  }
}

async function GetSubscriptionConfig(): Promise<SubscriptionsConfig | null> {
  const subscriptionsSettings = await GetSiteDataByKey("subscriptionsSettings");
  if (!subscriptionsSettings) {
    return null;
  }
  return subscriptionsSettings as SubscriptionsConfig;
}

async function handleLogin(
  email: string,
  captchaToken: string | null | undefined,
  config: SubscriptionsConfig,
): Promise<Response> {
  const captchaResult = await VerifyCaptchaToken(captchaToken);
  if (!captchaResult.success) {
    return error(400, { message: "Captcha verification failed" });
  }

  const result = await SubscriberLogin(email);
  if (!result.success) {
    return error(400, { message: result.error || "Failed to send verification code" });
  }

  return json({ success: true, message: "Verification code sent" });
}

async function handleVerify(email: string, code: string): Promise<Response> {
  const result = await VerifySubscriberOTP(email, code);
  if (!result.success) {
    return error(400, { message: result.error || "Verification failed" });
  }

  return json({ success: true, token: result.token });
}

async function handleGetPreferences(token: string, config: SubscriptionsConfig): Promise<Response> {
  const result = await VerifySubscriberToken(token);
  if (!result.success) {
    return error(401, { message: result.error || "Invalid token" });
  }

  const monitorsEnabled = MonitorSubscriptionsEnabled(config);
  return json({
    success: true,
    email: result.user?.email,
    subscriptions: result.subscriptions,
    monitors: monitorsEnabled ? result.monitors || [] : [],
    availableSubscriptions: {
      incidents: config.methods?.emails?.incidents === true,
      maintenances: config.methods?.emails?.maintenances === true,
      monitors: monitorsEnabled,
    },
  });
}

async function handleGetMonitors(config: SubscriptionsConfig): Promise<Response> {
  if (!MonitorSubscriptionsEnabled(config)) {
    return error(400, { message: "Monitor subscriptions are not enabled" });
  }
  return json({ success: true, monitors: await GetSubscribableMonitors() });
}

async function handleUpdatePreferences(
  token: string,
  incidents: boolean | undefined,
  maintenances: boolean | undefined,
  monitors: unknown,
  config: SubscriptionsConfig,
): Promise<Response> {
  // Only allow updating subscriptions that are enabled in config
  const preferences: { incidents?: boolean; maintenances?: boolean; monitors?: string[] } = {};

  if (incidents !== undefined && config.methods?.emails?.incidents) {
    preferences.incidents = incidents;
  }
  if (maintenances !== undefined && config.methods?.emails?.maintenances) {
    preferences.maintenances = maintenances;
  }
  if (monitors !== undefined && MonitorSubscriptionsEnabled(config)) {
    if (!Array.isArray(monitors) || !monitors.every((tag) => typeof tag === "string")) {
      return error(400, { message: "monitors must be an array of monitor tags" });
    }
    if (monitors.length > MAX_MONITORS_PER_UPDATE) {
      return error(400, { message: `At most ${MAX_MONITORS_PER_UPDATE} monitors are allowed` });
    }
    preferences.monitors = monitors;
  }

  const result = await UpdateSubscriberPreferences(token, preferences);
  if (!result.success) {
    return error(400, { message: result.error || "Failed to update preferences" });
  }

  return json(result.monitors !== undefined ? { success: true, monitors: result.monitors } : { success: true });
}
