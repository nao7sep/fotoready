import { beforeEach, describe, expect, it, vi } from "vitest";

const showPlainMessageDialog = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@main/plain-message-dialog", () => ({ showPlainMessageDialog }));

import { notifyCorruptSettings, notifyStartupFailure } from "@main/startup-dialog";

beforeEach(() => showPlainMessageDialog.mockClear());

describe("startup recovery dialog", () => {
  it("keeps the quarantine path in diagnostics only", async () => {
    await notifyCorruptSettings();

    expect(showPlainMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "Settings could not be read",
      detail: expect.stringContaining("recorded in the session log"),
    }));
    expect(JSON.stringify(showPlainMessageDialog.mock.calls[0])).not.toMatch(/\/private\/tmp|\.invalid/);
  });

  it("owns fatal startup copy without accepting exception diagnostics", async () => {
    await notifyStartupFailure();

    expect(showPlainMessageDialog).toHaveBeenCalledWith({
      title: "FotoReady could not start",
      message: "FotoReady could not finish opening its settings and workspace.",
      detail: "No photos or project files were changed. Check the session log, then start FotoReady again.",
    });
  });
});
