import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@shared/types/log";

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));

import { readDirectoryAssets } from "@main/file-asset-catalog";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("readDirectoryAssets", () => {
  it("keeps the empty-library fallback observable when the directory cannot be read", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-assets-"));
    roots.push(root);
    const notADirectory = path.join(root, "library");
    fs.writeFileSync(notADirectory, "not a directory");
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await expect(readDirectoryAssets(notADirectory, [".cube"], logger)).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/asset library directory/i),
      expect.objectContaining({ assetDir: notADirectory, err: expect.anything() }),
    );
  });
});
