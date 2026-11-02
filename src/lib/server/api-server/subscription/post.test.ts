import { afterEach, describe, expect, it, vi } from "vitest";

const {
  VerifyCaptchaToken,
  GetSiteDataByKey,
  SubscriberLogin,
  VerifySubscriberToken,
  UpdateSubscriberPreferences,
  GetSubscribableMonitors,
} = vi.hoisted(() => ({
  VerifyCaptchaToken: vi.fn(),
  GetSiteDataByKey: vi.fn(),
  SubscriberLogin: vi.fn(),
  VerifySubscriberToken: vi.fn(),
  UpdateSubscriberPreferences: vi.fn(),
  GetSubscribableMonitors: vi.fn(),
}));

vi.mock("$lib/server/controllers/captchaController", () => ({ VerifyCaptchaToken }));
vi.mock("$lib/server/controllers/siteDataController", () => ({ GetSiteDataByKey }));
vi.mock("$lib/server/controllers/userSubscriptionsController", () => ({
  SubscriberLogin,
  VerifySubscriberOTP: vi.fn(),
  VerifySubscriberToken,
  UpdateSubscriberPreferences,
  GetSubscribableMonitors,
  // As in userSubscriptionsController: on with subscriptions unless turned off.
  MonitorSubscriptionsEnabled: (config: { enable?: boolean; methods?: { emails?: { monitors?: boolean } } }) =>
    !!config?.enable && config.methods?.emails?.monitors !== false,
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

describe("POST /dashboard-apis/subscription — monitor subscriptions", () => {
  const withMonitors = (monitors?: boolean) => ({
    enable: true,
    methods: { emails: { incidents: false, maintenances: false, ...(monitors === undefined ? {} : { monitors }) } },
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lets a visitor sign in when monitor updates are the only subscription on offer", async () => {
    GetSiteDataByKey.mockResolvedValue(withMonitors());
    VerifyCaptchaToken.mockResolvedValue({ success: true });
    SubscriberLogin.mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "login", email: "a@b.com" } } as any);

    expect(response.status).toBe(200);
  });

  it("lists the monitors a visitor can subscribe to", async () => {
    GetSiteDataByKey.mockResolvedValue(withMonitors(true));
    GetSubscribableMonitors.mockResolvedValue([{ tag: "api", name: "API" }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "getMonitors" } } as any);

    expect(await response.json()).toEqual({ success: true, monitors: [{ tag: "api", name: "API" }] });
  });

  it("refuses to list monitors when monitor subscriptions are off", async () => {
    GetSiteDataByKey.mockResolvedValue({ enable: true, methods: { emails: { incidents: true, monitors: false } } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(post({ body: { action: "getMonitors" } } as any)).rejects.toMatchObject({ status: 400 });
    expect(GetSubscribableMonitors).not.toHaveBeenCalled();
  });

  it("returns the subscriber's monitors with their preferences", async () => {
    GetSiteDataByKey.mockResolvedValue(withMonitors());
    VerifySubscriberToken.mockResolvedValue({
      success: true,
      user: { email: "a@b.com" },
      subscriptions: { incidents: false, maintenances: false },
      monitors: ["api"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await post({ body: { action: "getPreferences", token: "t" } } as any);

    expect(await response.json()).toMatchObject({
      monitors: ["api"],
      availableSubscriptions: { incidents: false, maintenances: false, monitors: true },
    });
  });

  it("replaces the subscriber's monitors and returns the ones kept", async () => {
    GetSiteDataByKey.mockResolvedValue(withMonitors());
    UpdateSubscriberPreferences.mockResolvedValue({ success: true, monitors: ["api"] });

    const response = await post({
      body: { action: "updatePreferences", token: "t", monitors: ["api", "gone"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(UpdateSubscriberPreferences).toHaveBeenCalledWith("t", { monitors: ["api", "gone"] });
    expect(await response.json()).toEqual({ success: true, monitors: ["api"] });
  });

  it("rejects monitors that are not a list of tags", async () => {
    GetSiteDataByKey.mockResolvedValue(withMonitors());

    for (const monitors of ["api", [1, 2], Array(501).fill("api")]) {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        post({ body: { action: "updatePreferences", token: "t", monitors } } as any),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(UpdateSubscriberPreferences).not.toHaveBeenCalled();
  });

  it("ignores monitors when monitor subscriptions are off", async () => {
    GetSiteDataByKey.mockResolvedValue({ enable: true, methods: { emails: { incidents: true, monitors: false } } });
    UpdateSubscriberPreferences.mockResolvedValue({ success: true });

    const response = await post({
      body: { action: "updatePreferences", token: "t", incidents: true, monitors: ["api"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(UpdateSubscriberPreferences).toHaveBeenCalledWith("t", { incidents: true });
    expect(await response.json()).toEqual({ success: true });
  });
});
