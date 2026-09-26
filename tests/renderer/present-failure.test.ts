// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { presentFailure } from "@renderer/present-failure";
import { message } from "@shared/i18n/translate";

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
