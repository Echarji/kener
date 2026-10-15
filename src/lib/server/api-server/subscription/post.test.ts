import { afterEach, describe, expect, it, vi } from "vitest";

const {
  VerifyCaptchaToken,
  GetSiteDataByKey,
  SubscriberLogin,
  VerifySubscriberToken,
  UpdateSubscriberPreferences,
  GetAvailableMonitors,
} = vi.hoisted(() => ({
  VerifyCaptchaToken: vi.fn(),
  GetSiteDataByKey: vi.fn(),
  SubscriberLogin: vi.fn(),
  VerifySubscriberToken: vi.fn(),
  UpdateSubscriberPreferences: vi.fn(),
  GetAvailableMonitors: vi.fn(),
}));

vi.mock("$lib/server/controllers/captchaController", () => ({ VerifyCaptchaToken }));
vi.mock("$lib/server/controllers/siteDataController", () => ({ GetSiteDataByKey }));
vi.mock("$lib/server/controllers/userSubscriptionsController", () => ({
  SubscriberLogin,
  VerifySubscriberOTP: vi.fn(),
  VerifySubscriberToken,
  UpdateSubscriberPreferences,
  GetAvailableMonitors,
}));

import post from "./post";

const enabledConfig = { enable: true, methods: { emails: { incidents: true, maintenances: false } } };

describe("POST /dashboard-apis/subscription — login action", () => {
  afterEach(() => {
    VerifyCaptchaToken.mockReset();
    GetSiteDataByKey.mockReset();
    SubscriberLogin.mockReset();
  });

  it("rejects and never calls SubscriberLogin when captcha verification fails", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifyCaptchaToken.mockResolvedValue({ success: false });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      post({ body: { action: "login", email: "a@b.com", captchaToken: "bad" } } as any),
    ).rejects.toMatchObject({ status: 400 });
    expect(SubscriberLogin).not.toHaveBeenCalled();
  });

  it("proceeds to SubscriberLogin when captcha verification passes", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifyCaptchaToken.mockResolvedValue({ success: true });
    SubscriberLogin.mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "login", email: "a@b.com", captchaToken: "good" } } as any);

    expect(response.status).toBe(200);
    expect(VerifyCaptchaToken).toHaveBeenCalledWith("good");
    expect(SubscriberLogin).toHaveBeenCalledWith("a@b.com");
  });

  it("proceeds when no captchaToken is sent and no provider is configured (verify no-ops to success)", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifyCaptchaToken.mockResolvedValue({ success: true });
    SubscriberLogin.mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "login", email: "a@b.com" } } as any);

    expect(response.status).toBe(200);
    expect(VerifyCaptchaToken).toHaveBeenCalledWith(undefined);
  });

  it("passes an explicit JSON null captchaToken through unchanged (not coerced to undefined)", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifyCaptchaToken.mockResolvedValue({ success: true });
    SubscriberLogin.mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "login", email: "a@b.com", captchaToken: null } } as any);

    expect(response.status).toBe(200);
    expect(VerifyCaptchaToken).toHaveBeenCalledWith(null);
  });
});

describe("POST /dashboard-apis/subscription — preferences actions", () => {
  afterEach(() => {
    VerifySubscriberToken.mockReset();
    UpdateSubscriberPreferences.mockReset();
    GetAvailableMonitors.mockReset();
  });

  it("returns the subscriber's monitors plus the available monitor catalog", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifySubscriberToken.mockResolvedValue({
      success: true,
      user: { email: "a@b.com" },
      subscriptions: { incidents: true, maintenances: false },
      monitor_tags: ["api"],
    });
    GetAvailableMonitors.mockResolvedValue([
      { tag: "api", name: "API", category_name: null },
      { tag: "web", name: "Website", category_name: null },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "getPreferences", token: "tok" } } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.monitors).toEqual(["api"]);
    expect(body.availableMonitors).toEqual([
      { tag: "api", name: "API" },
      { tag: "web", name: "Website" },
    ]);
  });

  it("saves the monitor selection on updatePreferences", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    UpdateSubscriberPreferences.mockResolvedValue({ success: true, monitor_tags: ["api", "web"] });

    const response = await post({
      body: { action: "updatePreferences", token: "tok", monitorTags: ["api", "web"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(UpdateSubscriberPreferences).toHaveBeenCalledWith("tok", { monitorTags: ["api", "web"] });
    expect(body.monitors).toEqual(["api", "web"]);
  });

  it("rejects an invalid token on getPreferences", async () => {
    GetSiteDataByKey.mockResolvedValue(enabledConfig);
    VerifySubscriberToken.mockResolvedValue({ success: false, error: "Invalid or expired token" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(post({ body: { action: "getPreferences", token: "bad" } } as any)).rejects.toMatchObject({
      status: 401,
    });
  });
});
