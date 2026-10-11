import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPipeline } from "@shared/defaults";
import { getOpModule } from "@core/ops/catalog";
import { relinkMissingAssets } from "@main/asset-relink";
import { importDirectoryAssets, readDirectoryAssets } from "@main/file-asset-catalog";

vi.mock("electron", () => ({ shell: {} }));
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("relocating imported stamps", () => {
  it("keeps a supported imported format before a same-stem built-in alias", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-relink-"));
    roots.push(root);
    const source = path.join(root, "heart.webp");
    await fs.writeFile(source, "distinct imported stamp");
    const bundledStamps = path.resolve("resources/stamps");
    const oldFolder = path.join(root, "old-library");
    const [imported] = await importDirectoryAssets([source], oldFolder, [".png", ".svg", ".webp"], await readDirectoryAssets(bundledStamps, [".png", ".svg", ".webp"]));
    expect(imported.status).toBe("imported");
    const currentFolder = path.join(root, "current-library");
    await fs.rename(oldFolder, currentFolder);
    const pipeline = defaultPipeline();
    pipeline.ops.push({ id: "stamp", type: "stamp", enabled: true, params: { ...getOpModule("stamp")!.defaultParams, assetPath: imported.entry.path } });
    const relinked = await relinkMissingAssets(pipeline, { bundledStamps, importedStamps: currentFolder, bundledLuts: null, importedLuts: null });
    expect(relinked.ops[0].params.assetPath).toBe(path.join(currentFolder, "heart.webp"));
    expect(await fs.readFile(String(relinked.ops[0].params.assetPath), "utf8")).toBe("distinct imported stamp");
  });
});
