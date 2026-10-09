import { beforeEach, describe, expect, it, vi } from "vitest";

const showPlainMessageDialog = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@main/plain-message-dialog", () => ({ showPlainMessageDialog }));
vi.mock("electron", () => ({ app: { isPackaged: false }, systemPreferences: {} }));

import { applyLanguagePreference } from "@main/i18n";
import {
  notifyNewerFormat,
  notifySettingsRecovery,
  notifyStartupFailure,
  notifySettingsQuarantineFailure,
  showSettingsNotice,
} from "@main/startup-dialog";

beforeEach(() => {
  showPlainMessageDialog.mockClear();
  applyLanguagePreference("en");
});

describe("startup recovery dialog", () => {
  it("names the set-aside settings file and says every setting started at its default", async () => {
    await notifySettingsRecovery({ kind: "setAside", path: "/Users/someone/.fotoready/config-20261006-031340-utc.invalid" });

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "Settings could not be read",
      detail: expect.stringMatching(/every setting at its default.*\/Users\/someone\/\.fotoready\/config-20261006-031340-utc\.invalid$/),
    }));
  });

  it("reports settings it could not open as left in place, not as damaged", async () => {
    await notifySettingsRecovery({ kind: "unreadable", path: "/Users/someone/.fotoready/config.json" });

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "Settings could not be read",
      message: "FotoReady could not open its settings file. It started with every setting at its default and left the file as it is.",
      detail: "Settings changes cannot be saved until FotoReady can open this file. Check its permissions and the disk it is on, then start FotoReady again: /Users/someone/.fotoready/config.json",
    }));
  });

  it("logs a notice that cannot be shown and does not retry it", async () => {
    const cause = new Error("dialog unavailable");
    showPlainMessageDialog.mockRejectedValueOnce(cause);
    const logger = { error: vi.fn() };
    const notice = { kind: "setAside", path: "/config.invalid" } as const;
    await expect(showSettingsNotice(logger, notice)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith("could not show the settings recovery notice", { mod: "main", notice, err: cause });
    expect(showPlainMessageDialog).toHaveBeenCalledOnce();
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
