import { beforeEach, describe, expect, it, vi } from "vitest";

const showPlainMessageDialog = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@main/plain-message-dialog", () => ({ showPlainMessageDialog }));
vi.mock("electron", () => ({ app: { isPackaged: false }, systemPreferences: {} }));

import { applyLanguagePreference } from "@main/i18n";
import {
  notifyCorruptSettings,
  notifyNewerFormat,
  notifyStartupFailure,
  notifySettingsQuarantineFailure,
  showCorruptSettingsNotice,
} from "@main/startup-dialog";

beforeEach(() => {
  showPlainMessageDialog.mockClear();
  applyLanguagePreference("en");
});

describe("startup recovery dialog", () => {
  it("names the set-aside settings file and says every setting started at its default", async () => {
    await notifyCorruptSettings("/Users/someone/.fotoready/config-20261006-031340-000-utc.invalid");

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "Settings could not be read",
      detail: expect.stringMatching(/every setting at its default.*\/Users\/someone\/\.fotoready\/config-20261006-031340-000-utc\.invalid$/),
    }));
  });

  it("continues startup after completed quarantine when the notice fails, retaining its path and cause", async () => {
    const cause = new Error("dialog unavailable");
    showPlainMessageDialog.mockRejectedValueOnce(cause);
    const logger = { error: vi.fn() };
    await expect(showCorruptSettingsNotice(logger, "/config.invalid")).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "could not show the corrupt-settings recovery dialog",
      { mod: "main", quarantinedTo: "/config.invalid", err: cause },
    );
    await expect(showCorruptSettingsNotice(logger, "/config.invalid")).resolves.toBe(true);
    expect(showPlainMessageDialog).toHaveBeenLastCalledWith(expect.objectContaining({ detail: expect.stringContaining("/config.invalid") }));
  });

  it("owns fatal startup copy without accepting exception diagnostics", async () => {
    await notifyStartupFailure();

    expect(showPlainMessageDialog).toHaveBeenCalledWith({
      title: "FotoReady could not start",
      message: "FotoReady could not finish opening its settings and workspace.",
      detail: "No photos or project files were changed. Check the session log, then start FotoReady again.",
      buttons: ["OK"],
      detailsLabel: "Message details",
      lang: "en",
    });
  });

  it("names the file a newer FotoReady wrote, which was left as it is", async () => {
    await notifyNewerFormat("/Users/someone/.fotoready/config.json");

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "A file is from a newer FotoReady",
      message: expect.stringContaining("left as it is"),
      detail: expect.stringContaining("/Users/someone/.fotoready/config.json"),
      lang: "en",
    }));
  });

  it("names the unreadable settings left in place and explains repair or move recovery", async () => {
    await notifySettingsQuarantineFailure("/chosen/config.json");
    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "Settings could not be read",
      message: expect.stringContaining("original file was left in place"),
      detail: "Repair or move this file, then start FotoReady again: /chosen/config.json",
    }));
  });

  it("speaks the interface language, in its words and its document language", async () => {
    await applyLanguagePreference("de");
    await notifyStartupFailure();

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "FotoReady konnte nicht starten",
      buttons: ["OK"],
      detailsLabel: "Einzelheiten der Meldung",
      lang: "de",
    }));
  });
});
