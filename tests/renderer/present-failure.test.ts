// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { presentFailure } from "@renderer/present-failure";
import { message } from "@shared/i18n/translate";
import { ipcFailure } from "@shared/ipc-failure";

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
  vi.restoreAllMocks();
});

describe("presentFailure", () => {
  it("preserves cause diagnostics while returning authored copy", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "api", { configurable: true, value: { system: { log } } });
    const cause = new TypeError("EACCES /private/tmp/FOTOREADY_CAUSE_SENTINEL");
    const error = new Error("Error invoking remote method FOTOREADY_SENTINEL", { cause });

    const authored = message("failure.assetImport");
    const result = presentFailure(error, authored, "asset import failed");

    expect(result).toBe(authored);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining("FOTOREADY_SENTINEL"),
          cause: expect.objectContaining({ message: expect.stringContaining("FOTOREADY_CAUSE_SENTINEL") }),
        }),
      }),
    }));
  });

});

describe("presentFailure with a main-authored reason", () => {
  it("puts the reason beneath the operation's own copy", () => {
    Object.defineProperty(window, "api", { configurable: true, value: { system: { log: vi.fn().mockResolvedValue(undefined) } } });
    const reason = message("failure.pathVariable", { variable: "PHOTOS" });
    const authored = message("failure.lutRefresh");

    expect(presentFailure(ipcFailure(reason), authored, "LUT library refresh failed")).toEqual(
      message("failure.withReason", { failure: authored, reason })
    );
    expect(presentFailure(ipcFailure(reason), null, "LUT library refresh failed")).toBeNull();
  });
});
