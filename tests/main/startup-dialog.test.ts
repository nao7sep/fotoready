import { beforeEach, describe, expect, it, vi } from "vitest";

const showPlainMessageDialog = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@main/plain-message-dialog", () => ({ showPlainMessageDialog }));
vi.mock("electron", () => ({ app: { isPackaged: false }, systemPreferences: {} }));

import { applyLanguagePreference } from "@main/i18n";
import { notifyRefusedFiles, notifyStartupFailure, showSideStoreOff } from "@main/startup-dialog";
import { RefusedFileError } from "@adapters/json-store";

beforeEach(() => {
  showPlainMessageDialog.mockClear();
  applyLanguagePreference("en");
});

describe("startup recovery dialog", () => {
  it("names every refused file in one stop, saying which a newer version wrote and which could not be read", async () => {
    await notifyRefusedFiles([
      new RefusedFileError("/Users/someone/.fotoready/config.json", "unreadable"),
      new RefusedFileError("/Users/someone/.fotoready/state.json", "newer")
    ]);

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "FotoReady could not start",
      message: "FotoReady stopped because it cannot use these files. It changed nothing.",
      detail: [
        "Could not be read: /Users/someone/.fotoready/config.json",
        "Saved by a newer version of FotoReady: /Users/someone/.fotoready/state.json",
        "Open the newer version of FotoReady, or repair or restore the file, or move it elsewhere to start this version without it."
      ].join("\n\n"),
    }));
  });

  it("says visibly that Records are off, naming the database left as it is", async () => {
    await showSideStoreOff({ error: vi.fn() }, "records", "/Users/someone/.fotoready/records.sqlite3", "newer");

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "Records are off for this session",
      detail: expect.stringContaining("newer version of FotoReady and was left as it is: /Users/someone/.fotoready/records.sqlite3"),
    }));
  });

  it("logs a side-store notice that cannot be shown and does not retry it", async () => {
    const cause = new Error("dialog unavailable");
    showPlainMessageDialog.mockRejectedValueOnce(cause);
    const logger = { error: vi.fn() };
    await expect(showSideStoreOff(logger, "backups", "/backups.sqlite3", "unreadable")).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith("could not show the notice that a side store is off", { mod: "main", store: "backups", filePath: "/backups.sqlite3", err: cause });
    expect(showPlainMessageDialog).toHaveBeenCalledOnce();
  });

  it("owns fatal startup copy without accepting exception diagnostics", async () => {
    await notifyStartupFailure();

    expect(showPlainMessageDialog).toHaveBeenCalledWith({
      title: "FotoReady could not start",
      message: "FotoReady could not finish opening its settings and workspace.",
      detail: "No photos or project files were changed. Check Records the next time FotoReady starts.",
      buttons: ["OK"],
      detailsLabel: "Message details",
      lang: "en",
    });
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
