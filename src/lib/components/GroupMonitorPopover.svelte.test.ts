import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import GroupMonitorPopover from "./GroupMonitorPopover.svelte";
import type { MonitorBarResponse } from "$lib/server/api-server/monitor-bar/get";

const DAY = 1768478400; // 2026-01-15T12:00:00Z

function monitorBar(name: string): MonitorBarResponse {
  return {
    name,
    description: "",
    image: null,
    currentStatus: "UP",
    uptime: "100.00",
    avgLatency: "10ms",
    uptimeData: [],
    fromTimeStamp: DAY,
    toTimeStamp: DAY,
    maxLatency: "10ms",
    minLatency: "10ms",
  };
}

const children = createRawSnippet(() => ({
  render: () => `<span>Included Monitors (2)</span>`,
}));

function stubMonitorBars() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          data: { api: monitorBar("API"), db: monitorBar("Database") },
          missingTags: [],
        }),
      } as Response;
    }),
  );
}

async function openGroup(layoutStyle?: "default-list" | "default-grid" | "compact-list" | "compact-grid") {
  const screen = await render(GroupMonitorPopover, {
    tags: ["api", "db"],
    days: 30,
    endOfDayTodayAtTz: DAY,
    layoutStyle,
    children,
  });
  await screen.getByRole("button", { name: "Included Monitors (2)" }).click();
  return screen;
}

describe("GroupMonitorPopover — display theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the vertical list layout when the group has no saved theme", async () => {
    stubMonitorBars();
    const screen = await openGroup();

    const firstMember = screen.getByRole("link", { name: "API" });
    await expect.element(firstMember).toBeInTheDocument();
    expect(firstMember.element().closest(".grid")).toBeNull();
    expect(firstMember.element().closest(".border-b")).not.toBeNull();
  });

  it("lays members out in a responsive grid for a grid theme", async () => {
    stubMonitorBars();
    const screen = await openGroup("default-grid");

    const firstMember = screen.getByRole("link", { name: "API" });
    await expect.element(firstMember).toBeInTheDocument();
    const grid = firstMember.element().closest(".grid");
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("sm:grid-cols-2");
  });
});
