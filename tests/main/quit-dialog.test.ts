import { beforeEach, describe, expect, it, vi } from "vitest";

const showPlainMessageDialog = vi.hoisted(() => vi.fn(async () => 1));

vi.mock("@main/plain-message-dialog", () => ({ showPlainMessageDialog }));
vi.mock("electron", () => ({ app: { isPackaged: false }, systemPreferences: {} }));

import { applyLanguagePreference } from "@main/i18n";
import { askWorkNotSaved } from "@main/quit-dialog";

beforeEach(() => {
  showPlainMessageDialog.mockClear();
  applyLanguagePreference("en");
});

describe("the quit question about unsaved work", () => {
  it("names what is not saved and offers Cancel, Retry as the default, and a destructive Quit anyway", async () => {
    await askWorkNotSaved([{ kind: "settings" }, { kind: "sidecar", file: "photo.json" }]);

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "Changes not saved",
      detail: "Not saved: Settings, photo.json",
      buttons: ["Cancel", "Retry", "Quit anyway"],
      defaultId: 1,
      cancelId: 0,
      destructiveId: 2,
    }));
  });

  it.each([[0, "cancel"], [1, "retry"], [2, "quit"]] as const)("reads button %i as %s", async (button, choice) => {
    showPlainMessageDialog.mockResolvedValueOnce(button);
    await expect(askWorkNotSaved([{ kind: "settings" }])).resolves.toBe(choice);
  });
});
