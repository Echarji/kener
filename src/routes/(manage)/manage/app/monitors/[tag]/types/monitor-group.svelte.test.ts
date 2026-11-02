import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import type { GroupMonitorTypeData } from "$lib/server/types/monitor";
import MonitorGroup from "./monitor-group.svelte";

const groupData = (display: Partial<GroupMonitorTypeData> = {}) =>
  ({
    monitors: [
      { tag: "api", weight: 0.5 },
      { tag: "web", weight: 0.5 },
    ],
    executionDelay: 1000,
    latencyCalculation: "AVG",
    ...display,
  }) as GroupMonitorTypeData;

describe("monitor-group form: status page display", () => {
  it("shows a compact list for a group that has not chosen", async () => {
    const data = $state(groupData());
    const screen = await render(MonitorGroup, { data, availableMonitors: [], tag: "checkout" });

    await expect.element(screen.getByRole("radio", { name: "List" })).toBeChecked();
    await expect.element(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
    expect(data.membersLayout).toBeUndefined();
    expect(data.membersStyle).toBeUndefined();
  });

  it("stores the layout and style the admin picks", async () => {
    const data = $state(groupData());
    const screen = await render(MonitorGroup, { data, availableMonitors: [], tag: "checkout" });

    await screen.getByRole("radio", { name: "Grid" }).click();
    await screen.getByRole("radio", { name: "Simple" }).click();

    expect(data.membersLayout).toBe("grid");
    expect(data.membersStyle).toBe("simple");
    await expect.element(screen.getByRole("radio", { name: "Grid" })).toBeChecked();
  });

  it("shows the stored choice and keeps it when the pressed option is pressed again", async () => {
    const data = $state(groupData({ membersLayout: "grid", membersStyle: "simple" }));
    const screen = await render(MonitorGroup, { data, availableMonitors: [], tag: "checkout" });

    await expect.element(screen.getByRole("radio", { name: "Grid" })).toBeChecked();
    await screen.getByRole("radio", { name: "Simple" }).click();

    expect(data.membersStyle).toBe("simple");
  });
});
