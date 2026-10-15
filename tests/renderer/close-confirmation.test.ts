import { describe, expect, it } from "vitest";
import { closeConfirmation } from "@renderer/close-confirmation";
import { createTranslator } from "@shared/i18n/translate";

describe("closeConfirmation", () => {
  it("asks before any window close or quit that discards work, naming the saves and descriptions it cancels", () => {
    const en = createTranslator("en");
    const withSaves = closeConfirmation({ hasWork: true, savesInFlight: true });
    expect(withSaves && en.t(withSaves.message)).toMatch(/discard the current workspace\? Saves and descriptions still in progress are cancelled/);
    const withoutSaves = closeConfirmation({ hasWork: true, savesInFlight: false });
    expect(withoutSaves && en.t(withoutSaves.message)).toBe("Close and discard the current workspace?");
  });

  it("asks nothing when there is no workspace to lose", () => {
    expect(closeConfirmation({ hasWork: false, savesInFlight: false })).toBeNull();
  });
});
