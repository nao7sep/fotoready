import { beforeEach, describe, expect, it, vi } from "vitest";

const showPlainMessageDialog = vi.hoisted(() => vi.fn(async () => 1));

vi.mock("@main/plain-message-dialog", () => ({ showPlainMessageDialog }));
vi.mock("electron", () => ({ app: { isPackaged: false }, systemPreferences: {} }));

import { applyLanguagePreference } from "@main/i18n";
import { askDiscardWorkspace, askWorkNotSaved } from "@main/quit-dialog";

beforeEach(() => {
  showPlainMessageDialog.mockClear();
  applyLanguagePreference("en");
});

describe("the quit question about unsaved work", () => {
  it("confirms workspace discard through the existing standalone dialog with safe cancellation", async () => {
    await expect(askDiscardWorkspace(true)).resolves.toBe(true);
    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Saves still in progress are cancelled"),
      buttons: ["Cancel", "Close"], defaultId: 0, cancelId: 0, destructiveId: 1,
    }));
    showPlainMessageDialog.mockResolvedValueOnce(0);
    await expect(askDiscardWorkspace(false)).resolves.toBe(false);
    showPlainMessageDialog.mockRejectedValueOnce(new Error("dialog unavailable"));
    await expect(askDiscardWorkspace(false)).rejects.toThrow("dialog unavailable");
  });

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
