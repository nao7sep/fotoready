// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("renderer log bridge", () => {
  it("uses the captured console fallback when diagnostic IPC rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.fn().mockRejectedValue(new Error("bridge rejected"));
    Object.defineProperty(window, "api", { configurable: true, value: { system: { log } } });
    const { reportRendererLog } = await import("@renderer/renderer-log");

    reportRendererLog({ level: "error", message: "original diagnostic", fields: { sentinel: true } });
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("could not be recorded"),
      expect.objectContaining({ entry: expect.objectContaining({ message: "original diagnostic" }) }),
    );
  });
});
