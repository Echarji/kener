import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import MonitorList from "./MonitorList.svelte";
import type { MonitorBarResponse } from "$lib/server/api-server/monitor-bar/get";
import type { StatusType } from "$lib/types/status";

const { page } = vi.hoisted(() => ({
  page: {
    data: {
      siteStatusColors: { UP: "#22c55e", DOWN: "#ef4444", DEGRADED: "#eab308", MAINTENANCE: "#3b82f6" },
      dateAndTimeFormat: { dateOnly: "yyyy-MM-dd", timeOnly: "HH:mm" },
      isSubsEnabled: true,
      canSendEmail: true,
      isMonitorSubsEnabled: true,
    } as Record<string, unknown>,
    url: new URL("http://localhost/"),
    params: {},
    route: { id: null },
  },
}));
vi.mock("$app/state", () => ({ page }));

const bar = (name: string, currentStatus: StatusType, uptime: string): MonitorBarResponse => ({
  name,
  description: `Description of ${name}`,
  image: null,
  currentStatus,
  uptime,
  avgLatency: "120ms",
  uptimeData: [],
  fromTimeStamp: 0,
  toTimeStamp: 0,
  maxLatency: "0",
  minLatency: "0",
  monitorType: name === "Checkout" ? "GROUP" : "API",
});

const BARS: Record<string, MonitorBarResponse> = {
  checkout: bar("Checkout", "DEGRADED", "99.10"),
  api: bar("Public API", "UP", "99.99"),
  web: bar("Website", "UP", "100.00"),
  payments: bar("Payments", "DOWN", "97.50"),
  status: bar("Status Page", "UP", "100.00"),
};

// Each render asks for its own day so the monitor-bar client's cache never answers for an earlier test.
let endOfDay = 1768521599;

function renderList(
  display?: { layout: "list" | "grid"; style: "simple" | "compact" },
  layoutStyle: "compact-list" | "default-grid" = "compact-list",
) {
  endOfDay += 86400;
  return render(MonitorList, {
    monitorTags: ["checkout", "status"],
    monitorGroupMembersByTag: { checkout: ["api", "web", "payments"] },
    monitorGroupDisplayByTag: display ? { checkout: display } : {},
    layoutStyle,
    days: 7,
    endOfDayTodayAtTz: endOfDay,
  });
}

const membersBox = (container: HTMLElement) => container.querySelector("[data-members-layout]");

describe("MonitorList", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const tags = decodeURIComponent(new URL(url, "http://localhost").searchParams.get("tags") || "").split(",");
        const data = Object.fromEntries(tags.filter((tag) => BARS[tag]).map((tag) => [tag, BARS[tag]]));
        return { ok: true, json: async () => ({ data, missingTags: [] }) } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a group with its status, its members' statuses and their uptime", async () => {
    const screen = await renderList();

    const group = screen.getByRole("region", { name: "Checkout group" });
    await expect.element(group.getByText("Degraded", { exact: true })).toBeInTheDocument();
    await expect.element(group.getByText("Group · 3 monitors")).toBeInTheDocument();
    await expect.element(group.getByText("1 down")).toBeInTheDocument();
    await expect.element(group.getByText("2 operational")).toBeInTheDocument();

    const members = group.getByRole("list", { name: "Monitors in this group" });
    await expect.element(members.getByRole("link", { name: "Payments" })).toBeInTheDocument();
    await expect.element(members.getByText("97.50%")).toBeInTheDocument();
    await expect.element(members.getByText("Down:")).toBeInTheDocument();
    await expect.element(members.getByRole("button", { name: "Subscribe to Website" })).toBeInTheDocument();
  });

  it("shows a group that has not chosen its display as a compact list", async () => {
    const screen = await renderList();

    await expect.poll(() => membersBox(screen.container)?.getAttribute("data-members-layout")).toBe("list");
    expect(membersBox(screen.container)?.getAttribute("data-members-style")).toBe("compact");
    const members = screen.getByRole("list", { name: "Monitors in this group" });
    await expect.element(members).not.toHaveClass("@md:grid-cols-2");
    await expect.element(screen.getByRole("button", { name: "Included Monitors (3)" })).toBeInTheDocument();
  });

  it("lays out a compact grid in columns", async () => {
    const screen = await renderList({ layout: "grid", style: "compact" });

    const members = screen.getByRole("list", { name: "Monitors in this group" });
    await expect.element(members).toHaveClass("@md:grid-cols-2");
    await expect.element(members.getByText("97.50%")).toBeInTheDocument();
  });

  it("shows each member with its status history in the simple style", async () => {
    const screen = await renderList({ layout: "grid", style: "simple" });

    const members = screen.getByRole("list", { name: "Monitors in this group" });
    await expect.element(members).toHaveClass("@2xl:grid-cols-2");
    await expect.element(members.getByRole("link", { name: "Payments" })).toBeInTheDocument();
    await expect.element(members.getByText("Description of Payments")).toBeInTheDocument();
    expect(members.element().querySelectorAll("[aria-label^='Status calendar']").length).toBe(3);
    expect(screen.container.textContent).not.toContain("Included Monitors");
  });

  it("lets a visitor switch a group between list and grid and remembers it for that group", async () => {
    const screen = await renderList({ layout: "list", style: "compact" });
    const layout = () => membersBox(screen.container)?.getAttribute("data-members-layout");

    await expect.poll(layout).toBe("list");
    await screen.getByRole("radio", { name: "Grid view" }).click();
    await expect.poll(layout).toBe("grid");
    expect(JSON.parse(localStorage.getItem("kener_group_views") || "{}")).toEqual({ checkout: "grid" });

    // Pressing the pressed layout again keeps it.
    await screen.getByRole("radio", { name: "Grid view" }).click();
    await expect.poll(layout).toBe("grid");

    screen.unmount();
    const again = await renderList({ layout: "list", style: "compact" });
    await expect.poll(() => membersBox(again.container)?.getAttribute("data-members-layout")).toBe("grid");
    await again.getByRole("radio", { name: "List view" }).click();
    await expect.poll(() => membersBox(again.container)?.getAttribute("data-members-layout")).toBe("list");
    expect(JSON.parse(localStorage.getItem("kener_group_views") || "{}")).toEqual({ checkout: "list" });
  });

  it("keeps the page's own layout for the monitors, with no page-wide toggle", async () => {
    const screen = await renderList(undefined, "default-grid");

    await expect.element(screen.getByRole("link", { name: "Status Page" })).toBeInTheDocument();
    // The only layout toggle is the group's own.
    expect(screen.container.querySelectorAll('[aria-label="Group layout"]').length).toBe(1);
    expect(screen.container.querySelector(".md\\:grid-cols-4")).not.toBeNull();
  });

  it("hides the per-monitor subscribe buttons when monitor subscriptions are off", async () => {
    page.data.isMonitorSubsEnabled = false;
    try {
      const screen = await renderList();
      await expect.element(screen.getByRole("link", { name: "Website" })).toBeInTheDocument();
      expect(screen.container.querySelector('[aria-label^="Subscribe to"]')).toBeNull();
    } finally {
      page.data.isMonitorSubsEnabled = true;
    }
  });
});
