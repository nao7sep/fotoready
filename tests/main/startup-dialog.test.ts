import { beforeEach, describe, expect, it, vi } from "vitest";

const showPlainMessageDialog = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@main/plain-message-dialog", () => ({ showPlainMessageDialog }));
vi.mock("electron", () => ({ app: { isPackaged: false }, systemPreferences: {} }));

import { applyLanguagePreference } from "@main/i18n";
import {
  notifyCorruptSettings,
  notifyStartupFailure,
  requireCorruptSettingsNotice,
} from "@main/startup-dialog";

beforeEach(() => {
  showPlainMessageDialog.mockClear();
  applyLanguagePreference("en");
});

describe("startup recovery dialog", () => {
  it("keeps the quarantine path in diagnostics only", async () => {
    await notifyCorruptSettings();

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "Settings could not be read",
      detail: expect.stringContaining("recorded in the session log"),
    }));
    expect(JSON.stringify(showPlainMessageDialog.mock.calls[0])).not.toMatch(/\/private\/tmp|\.invalid/);
  });

  it("fails closed with the dialog rejection preserved when recovery cannot be presented", async () => {
    const cause = new Error("EACCES /private/tmp/FOTOREADY_RECOVERY_SENTINEL");
    showPlainMessageDialog.mockRejectedValueOnce(cause);
    const logger = { error: vi.fn() };

    const result = requireCorruptSettingsNotice(logger);

    await expect(result).rejects.toMatchObject({
      message: "FotoReady could not present the corrupt-settings recovery notice.",
      cause,
    });
    expect(logger.error).toHaveBeenCalledWith(
      "could not show the corrupt-settings recovery dialog",
      expect.objectContaining({
        mod: "main",
        err: expect.objectContaining({ cause }),
      }),
    );
  });

  it("owns fatal startup copy without accepting exception diagnostics", async () => {
    await notifyStartupFailure();

    expect(showPlainMessageDialog).toHaveBeenCalledWith({
      title: "FotoReady could not start",
      message: "FotoReady could not finish opening its settings and workspace.",
      detail: "No photos or project files were changed. Check the session log, then start FotoReady again.",
      closeLabel: "OK",
      detailsLabel: "Message details",
      lang: "en",
    });
  });

  it("speaks the interface language, in its words and its document language", async () => {
    applyLanguagePreference("de");
    await notifyStartupFailure();

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "FotoReady konnte nicht starten",
      closeLabel: "OK",
      detailsLabel: "Einzelheiten der Meldung",
      lang: "de",
    }));
  });
});
