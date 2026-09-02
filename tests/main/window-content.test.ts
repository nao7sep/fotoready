import { describe, expect, it, vi } from "vitest";
import { loadRendererWindowContent } from "@main/window-content";

describe("renderer window document loading", () => {
  it("keeps a hostile Chromium load rejection observable to startup", async () => {
    const hostile = new Error("ERR_FILE_NOT_FOUND EACCES /private/tmp/FOTOREADY_RENDERER");
    const target = {
      loadURL: vi.fn(async () => undefined),
      loadFile: vi.fn(async () => { throw hostile; }),
    };

    await expect(loadRendererWindowContent(target, undefined, "/app/index.html"))
      .rejects.toBe(hostile);
    expect(target.loadFile).toHaveBeenCalledWith("/app/index.html");
  });
});
