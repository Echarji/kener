import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import MonitorSelector from "./MonitorSelector.svelte";

const monitors = [
  { tag: "api", name: "API" },
  { tag: "web", name: "Website" },
  { tag: "db", name: "Database" },
];

describe("MonitorSelector", () => {
  it("lists every monitor with its tag", async () => {
    const screen = await render(MonitorSelector, { monitors });

    await expect.element(screen.getByText("API", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("Website")).toBeInTheDocument();
    await expect.element(screen.getByText("Database")).toBeInTheDocument();
  });

  it("filters the list by the search term, matching name or tag", async () => {
    const screen = await render(MonitorSelector, { monitors });

    await screen.getByPlaceholder("Search monitors...").fill("web");

    await expect.element(screen.getByText("Website")).toBeInTheDocument();
    await expect.element(screen.getByText("API", { exact: true })).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    const screen = await render(MonitorSelector, { monitors });

    await screen.getByPlaceholder("Search monitors...").fill("does-not-exist");

    await expect.element(screen.getByText("No monitors found")).toBeInTheDocument();
  });

  it("marks a monitor as selected when clicked and updates the count", async () => {
    const screen = await render(MonitorSelector, { monitors });

    const apiButton = screen.getByRole("button", { name: /API/ });
    await expect.element(apiButton).toHaveAttribute("aria-pressed", "false");

    await apiButton.click();

    await expect.element(apiButton).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByText(/1\s+selected/)).toBeInTheDocument();
  });

  it("clears the whole selection", async () => {
    const screen = await render(MonitorSelector, { monitors, selected: ["api", "web"] });

    await expect.element(screen.getByText(/2\s+selected/)).toBeInTheDocument();

    await screen.getByRole("button", { name: "Clear" }).click();

    await expect.element(screen.getByText(/0\s+selected/)).toBeInTheDocument();
  });

  it("selects all monitors matching the current filter", async () => {
    const screen = await render(MonitorSelector, { monitors });

    await screen.getByPlaceholder("Search monitors...").fill("a");
    // "API" and "Database" both contain "a"; "Website" does not.
    await screen.getByRole("button", { name: "Select all" }).click();

    await expect.element(screen.getByText(/2\s+selected/)).toBeInTheDocument();
  });

  it("renders a loading state while monitors load", async () => {
    const screen = await render(MonitorSelector, { monitors: [], loading: true });

    await expect.element(screen.getByText("API", { exact: true })).not.toBeInTheDocument();
    // The list region exists but shows the spinner, not the empty message.
    await expect.element(screen.getByText("No monitors found")).not.toBeInTheDocument();
  });

  it("does not allow changing the selection when disabled", async () => {
    const screen = await render(MonitorSelector, { monitors, disabled: true });

    await expect.element(screen.getByRole("button", { name: /API/ })).toBeDisabled();
    await expect.element(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    await expect.element(screen.getByText(/0\s+selected/)).toBeInTheDocument();
  });
});
