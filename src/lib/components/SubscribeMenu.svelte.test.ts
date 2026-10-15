import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import SubscribeMenu from "./SubscribeMenu.svelte";

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

describe("SubscribeMenu — monitor preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("subscriber_token", "subscriber-token-1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSubscriptionFetch(handlers: {
    getPreferences?: () => unknown;
    updatePreferences?: (body: { monitorTags?: string[] }) => unknown;
  }) {
    const calls: Array<{ action: string; monitorTags?: string[] }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("captcha-config.json")) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes("dashboard-apis/subscription")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        calls.push(body);
        if (body.action === "getPreferences") {
          return { ok: true, json: async () => handlers.getPreferences?.() ?? {} } as Response;
        }
        if (body.action === "updatePreferences") {
          return { ok: true, json: async () => handlers.updatePreferences?.(body) ?? { success: true } } as Response;
        }
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  it("loads the subscriber's monitors and marks them selected", async () => {
    stubSubscriptionFetch({
      getPreferences: () => ({
        email: "alice@example.com",
        monitors: ["api"],
        availableMonitors: [
          { tag: "api", name: "API" },
          { tag: "web", name: "Website" },
        ],
      }),
    });

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    await expect.element(screen.getByText("alice@example.com")).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: /API/ })).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByRole("button", { name: /Website/ })).toHaveAttribute("aria-pressed", "false");
    await expect.element(screen.getByText(/1\s+selected/)).toBeInTheDocument();
  });

  it("saves the edited monitor selection and confirms it", async () => {
    const calls = stubSubscriptionFetch({
      getPreferences: () => ({
        email: "alice@example.com",
        monitors: ["api"],
        availableMonitors: [
          { tag: "api", name: "API" },
          { tag: "web", name: "Website" },
        ],
      }),
      updatePreferences: (body) => ({ success: true, monitors: body.monitorTags }),
    });

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    // Wait for the preferences view to settle before interacting.
    await expect.element(screen.getByRole("button", { name: /Website/ })).toHaveAttribute("aria-pressed", "false");

    await screen.getByRole("button", { name: /Website/ }).click();
    await screen.getByRole("button", { name: "Save preferences" }).click();

    await expect.element(screen.getByText("Your monitor subscriptions have been saved.")).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();

    const update = calls.find((call) => call.action === "updatePreferences");
    expect(update?.monitorTags?.slice().sort()).toEqual(["api", "web"]);
  });

  it("clears every monitor subscription", async () => {
    const calls = stubSubscriptionFetch({
      getPreferences: () => ({
        email: "alice@example.com",
        monitors: ["api", "web"],
        availableMonitors: [
          { tag: "api", name: "API" },
          { tag: "web", name: "Website" },
        ],
      }),
      updatePreferences: (body) => ({ success: true, monitors: body.monitorTags }),
    });

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    await expect.element(screen.getByText(/2\s+selected/)).toBeInTheDocument();

    await screen.getByRole("button", { name: "Clear" }).click();
    await screen.getByRole("button", { name: "Save preferences" }).click();

    await expect.element(screen.getByText("Your monitor subscriptions have been saved.")).toBeInTheDocument();
    const update = calls.find((call) => call.action === "updatePreferences");
    expect(update?.monitorTags).toEqual([]);
  });
});
