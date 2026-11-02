import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import SubscribeMenu from "./SubscribeMenu.svelte";
import { RequestSubscribe, subscriber } from "$lib/client/subscriber.svelte";

const { page } = vi.hoisted(() => ({
  page: {
    data: {
      dateAndTimeFormat: { dateOnly: "yyyy-MM-dd", timeOnly: "HH:mm" },
      isMonitorSubsEnabled: false,
    } as Record<string, unknown>,
    url: new URL("http://localhost/"),
    params: {},
    route: { id: null },
  },
}));
vi.mock("$app/state", () => ({ page }));

function mockFetchByUrl(handlers: Record<string, () => Promise<unknown>>) {
  return vi.fn(async (url: string) => {
    const match = Object.keys(handlers).find((key) => url.includes(key));
    if (!match) throw new Error(`Unhandled fetch in test: ${url}`);
    const body = await handlers[match]();
    return { ok: true, json: async () => body } as Response;
  });
}

describe("SubscribeMenu — captcha gating", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables Continue until the captcha reports a token when a provider is configured", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByUrl({ "captcha-config.json": async () => ({ provider: "turnstile", siteKey: "site-key-123" }) }),
    );

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    await expect.element(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("leaves Continue enabled when no captcha provider is configured", async () => {
    vi.stubGlobal("fetch", mockFetchByUrl({ "captcha-config.json": async () => ({ provider: null, siteKey: null }) }));

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    await expect.element(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled();
  });

  it("shows the server's specific error message instead of a generic one when login fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("captcha-config.json")) {
        return { ok: true, json: async () => ({ provider: null, siteKey: null }) } as Response;
      }
      if (url.includes("dashboard-apis/subscription")) {
        return { ok: false, json: async () => ({ message: "Captcha verification failed" }) } as Response;
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    await screen.getByLabelText("Email address").fill("test@example.com");
    await screen.getByRole("button", { name: "Continue" }).click();

    await expect.element(screen.getByText("Captcha verification failed")).toBeInTheDocument();
  });

  it("resets the captcha widget after a rejected token so the user can solve it again", async () => {
    const resetSpy = vi.fn();
    const renderSpy = vi.fn((_container: HTMLElement, opts: { callback: (t: string) => void }) => {
      opts.callback("solved-token-1");
      return "widget-id-1";
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).turnstile = { render: renderSpy, reset: resetSpy };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("captcha-config.json")) {
        return { ok: true, json: async () => ({ provider: "turnstile", siteKey: "site-key-123" }) } as Response;
      }
      if (url.includes("dashboard-apis/subscription")) {
        return { ok: false, json: async () => ({ message: "Captcha verification failed" }) } as Response;
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    const continueButton = screen.getByRole("button", { name: "Continue" });
    // Widget "solves" immediately per the renderSpy mock above.
    await expect.element(continueButton).not.toBeDisabled();

    await screen.getByLabelText("Email address").fill("test@example.com");
    await continueButton.click();

    await vi.waitFor(() => expect(resetSpy).toHaveBeenCalledWith("widget-id-1"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).turnstile;
  });

  it("sends the user back to solve a fresh captcha on Resend instead of replaying the consumed token", async () => {
    const renderSpy = vi.fn((_container: HTMLElement, opts: { callback: (t: string) => void }) => {
      opts.callback("solved-token-1");
      return "widget-id-1";
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).turnstile = { render: renderSpy, reset: vi.fn() };

    const loginCalls: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("captcha-config.json")) {
        return { ok: true, json: async () => ({ provider: "turnstile", siteKey: "site-key-123" }) } as Response;
      }
      if (url.includes("dashboard-apis/subscription")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        loginCalls.push(body);
        return { ok: true, json: async () => ({ success: true, message: "Verification code sent" }) } as Response;
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    const continueButton = screen.getByRole("button", { name: "Continue" });
    await expect.element(continueButton).not.toBeDisabled();

    await screen.getByLabelText("Email address").fill("test@example.com");
    await continueButton.click();

    // Now on the OTP view -- Resend has no captcha widget to solve here.
    const resendButton = screen.getByRole("button", { name: /resend/i });
    await expect.element(resendButton).toBeInTheDocument();
    await resendButton.click();

    // Should go back to the login view for a fresh solve, not silently
    // replay the already-consumed token from the first submission.
    await expect.element(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(loginCalls.length).toBe(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).turnstile;
  });
});

describe("SubscribeMenu — monitor subscriptions", () => {
  const MONITORS = [
    { tag: "api", name: "Public API", description: "REST API", image: null, monitor_type: "API" },
    { tag: "db", name: "Database", description: null, image: null, monitor_type: "TCP" },
    { tag: "checkout", name: "Checkout", description: null, image: null, monitor_type: "GROUP" },
    { tag: "web", name: "Website", description: null, image: null, monitor_type: "API" },
  ];
  let followed: string[];
  let updates: Array<Record<string, unknown>>;

  beforeEach(() => {
    localStorage.clear();
    followed = [];
    updates = [];
    subscriber.monitorTags = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("captcha-config.json")) {
          return { ok: true, json: async () => ({ provider: null, siteKey: null }) } as Response;
        }
        const body = JSON.parse((init?.body as string) || "{}");
        const reply = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
        switch (body.action) {
          case "getPreferences":
            return reply({
              success: true,
              email: "visitor@example.com",
              subscriptions: { incidents: true, maintenances: false },
              monitors: followed,
              availableSubscriptions: { incidents: true, maintenances: true, monitors: true },
            });
          case "getMonitors":
            return reply({ success: true, monitors: MONITORS });
          case "updatePreferences":
            updates.push(body);
            followed = [...body.monitors].sort();
            return reply({ success: true, monitors: followed });
          case "login":
            return reply({ success: true, message: "Verification code sent" });
          case "verify":
            return reply({ success: true, token: "token-1" });
        }
        throw new Error(`Unhandled action in test: ${body.action}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    page.data.isMonitorSubsEnabled = false;
  });

  it("searches the monitors, adds several, and shows them as subscribed", async () => {
    localStorage.setItem("subscriber_token", "token-1");
    followed = ["api"];

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    const subscribed = screen.getByRole("list", { name: "Subscribed monitors (1)" });
    await expect.element(subscribed.getByText("Public API")).toBeInTheDocument();
    await screen.getByRole("button", { name: "Manage monitors" }).click();

    await expect.element(screen.getByRole("checkbox", { name: "Public API" })).toBeChecked();
    await expect.element(screen.getByText("Subscribed", { exact: true })).toBeInTheDocument();
    await screen.getByRole("searchbox", { name: "Search monitors" }).fill("site");
    await expect.element(screen.getByRole("checkbox", { name: "Website" })).toBeInTheDocument();
    await expect.element(screen.getByRole("checkbox", { name: "Database" })).not.toBeInTheDocument();
    await screen.getByRole("checkbox", { name: "Website" }).click();

    await screen.getByRole("searchbox", { name: "Search monitors" }).fill("");
    await screen.getByText("Checkout").click();
    await expect.element(screen.getByText("3 selected")).toBeInTheDocument();
    await screen.getByRole("button", { name: "Save" }).click();

    await expect.element(screen.getByText("Subscribed to 3 monitors.")).toBeInTheDocument();
    expect(updates).toEqual([{ action: "updatePreferences", token: "token-1", monitors: ["api", "web", "checkout"] }]);
    const nowSubscribed = screen.getByRole("list", { name: "Subscribed monitors (3)" });
    await expect.element(nowSubscribed.getByText("Website")).toBeInTheDocument();
    expect(subscriber.monitorTags).toEqual(["api", "checkout", "web"]);
  });

  it("unsubscribes from one monitor and keeps the others", async () => {
    localStorage.setItem("subscriber_token", "token-1");
    followed = ["api", "web"];

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();
    await screen.getByRole("button", { name: "Unsubscribe from Website" }).click();

    await expect.element(screen.getByText("Unsubscribed from Website.")).toBeInTheDocument();
    expect(updates.map((u) => u.monitors)).toEqual([["api"]]);
    await expect.element(screen.getByRole("list", { name: "Subscribed monitors (1)" })).toBeInTheDocument();
    // The incident subscription is untouched.
    expect(updates.every((u) => !("incidents" in u))).toBe(true);
  });

  it("subscribes a new visitor to the monitor whose bell they pressed once they verify their email", async () => {
    page.data.isMonitorSubsEnabled = true;

    const screen = await render(SubscribeMenu, {});
    RequestSubscribe("web");

    const pending = screen.getByRole("list", { name: "Monitors to subscribe to" });
    await expect.element(pending.getByText("Website")).toBeInTheDocument();
    await screen.getByLabelText("Email address").fill("visitor@example.com");
    await screen.getByRole("button", { name: "Continue" }).click();

    await screen.getByRole("textbox").fill("123456");
    await screen.getByRole("button", { name: "Verify" }).click();

    await expect.element(screen.getByText("Subscribed to Website.")).toBeInTheDocument();
    expect(updates).toEqual([{ action: "updatePreferences", token: "token-1", monitors: ["web"] }]);
    expect(localStorage.getItem("subscriber_token")).toBe("token-1");
  });

  it("opens the picker with the monitor selected when a signed-in subscriber presses its bell", async () => {
    localStorage.setItem("subscriber_token", "token-1");
    followed = ["api"];

    const screen = await render(SubscribeMenu, {});
    await vi.waitFor(() => expect(subscriber.monitorTags).toEqual(["api"]));
    RequestSubscribe("db");

    await expect.element(screen.getByRole("checkbox", { name: "Database" })).toBeChecked();
    await expect.element(screen.getByRole("checkbox", { name: "Public API" })).toBeChecked();
    await screen.getByRole("button", { name: "Cancel" }).click();

    await expect.element(screen.getByRole("list", { name: "Subscribed monitors (1)" })).toBeInTheDocument();
    expect(updates).toEqual([]);
  });
});
