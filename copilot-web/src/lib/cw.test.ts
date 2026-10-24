import { describe, expect, it } from "vitest";
import { syncThemeAndFavicon } from "./cw";

describe("syncThemeAndFavicon", () => {
  it("calls the boot hook defined by themeInit when present", () => {
    let called = 0;
    (globalThis as { window?: unknown }).window = {
      __cwApplyTheme: () => {
        called++;
      },
    };
    expect(() => syncThemeAndFavicon()).not.toThrow();
    expect(called).toBe(1);
  });

  it("does not throw when window or the hook is missing", () => {
    expect(() => syncThemeAndFavicon()).not.toThrow();
  });
});