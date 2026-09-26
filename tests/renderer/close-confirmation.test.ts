import { describe, expect, it } from "vitest";
import { closeConfirmation } from "@renderer/close-confirmation";
import { windowCloseQuits } from "@main/window-close";

describe("closeConfirmation", () => {
  it("asks before a close that ends the app, naming the saves it cancels", () => {
    expect(closeConfirmation({ endsApp: true }, { hasWork: true, savesInFlight: true })?.message)
      .toMatch(/discard the current workspace\? Saves still in progress are cancelled/);
    expect(closeConfirmation({ endsApp: true }, { hasWork: true, savesInFlight: false })?.message)
      .toBe("Close and discard the current workspace?");
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
