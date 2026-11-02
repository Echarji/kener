import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { i18n, t } from "./i18n";

describe("t", () => {
  it("fills placeholders in a translation", async () => {
    await i18n.loadTranslations("en");

    expect(get(t)("Included Monitors (%count)", { count: "3" })).toBe("Included Monitors (3)");
  });

  it("falls back to the key, placeholders filled, when the locale has no translation for it", async () => {
    await i18n.loadTranslations("en");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(get(t)("Not translated for %name yet", { name: "Public API" })).toBe("Not translated for Public API yet");

    warn.mockRestore();
  });
});
