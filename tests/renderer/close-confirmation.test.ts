import { describe, expect, it } from "vitest";
import { closeConfirmation } from "@renderer/close-confirmation";
import { windowCloseQuits } from "@main/window-close";
import { createTranslator } from "@shared/i18n/translate";

describe("closeConfirmation", () => {
  it("asks before a close that ends the app, naming the saves it cancels", () => {
    const en = createTranslator("en");
    const withSaves = closeConfirmation({ endsApp: true }, { hasWork: true, savesInFlight: true });
    expect(withSaves && en.t(withSaves.message)).toMatch(/discard the current workspace\? Saves still in progress are cancelled/);
    const withoutSaves = closeConfirmation({ endsApp: true }, { hasWork: true, savesInFlight: false });
    expect(withoutSaves && en.t(withoutSaves.message)).toBe("Close and discard the current workspace?");
  });

  it("asks nothing when the close keeps the workspace and its saves running", () => {
    expect(closeConfirmation({ endsApp: false }, { hasWork: true, savesInFlight: true })).toBeNull();
  });

  it("asks nothing when there is no workspace to lose", () => {
    expect(closeConfirmation({ endsApp: true }, { hasWork: false, savesInFlight: false })).toBeNull();
  });
});

describe("windowCloseQuits", () => {
  it("keeps the app running after a window close only on macOS", () => {
    expect(windowCloseQuits("darwin")).toBe(false);
    expect(windowCloseQuits("win32")).toBe(true);
    expect(windowCloseQuits("linux")).toBe(true);
  });
});
