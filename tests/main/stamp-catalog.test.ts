import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));

import { importLuts, listLuts } from "@main/lut-catalog";
import { importStamps, listStamps } from "@main/stamp-catalog";
import { header } from "../helpers/file-header";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("selected asset library folders", () => {
  it.each(["lut", "stamp"])("imports and lists a %s in the exact selected folder", async (kind) => {
    const root = tempRoot();
    const bundled = path.join(root, "bundled");
    const selected = path.join(root, " $UNSET_LIBRARY %literal% ");
    fs.mkdirSync(bundled);
    fs.mkdirSync(selected);
    fs.writeFileSync(path.join(bundled, "catalog.json"), JSON.stringify({ ...header("stamp-catalog"), stamps: [] }));
    const fileName = kind === "lut" ? "warm.cube" : "mark.svg";
    const source = path.join(root, fileName);
    fs.writeFileSync(source, kind === "lut" ? "LUT_3D_SIZE 2" : "<svg />");
    const importAssets = kind === "lut" ? importLuts : importStamps;
    const listAssets = kind === "lut" ? listLuts : listStamps;
    await importAssets([source], selected, path.join(root, "unused"), bundled);
    expect(await listAssets(selected, path.join(root, "unused"), bundled)).toEqual([
      expect.objectContaining({ path: path.join(selected, fileName), builtin: false })
    ]);
    expect(fs.existsSync(selected.trim())).toBe(false);
  });
});

describe("listStamps", () => {
  it("joins packaged files to catalog metadata and assigns imports automatically", async () => {
    const root = tempRoot();
    const bundled = path.join(root, "bundled");
    const imported = path.join(root, "imported");
    fs.mkdirSync(bundled);
    fs.mkdirSync(imported);
    fs.writeFileSync(path.join(bundled, "cover-blob.png"), "png");
    fs.writeFileSync(path.join(bundled, "heart.png"), "png");
    fs.writeFileSync(path.join(bundled, "catalog.json"), JSON.stringify({
      ...header("stamp-catalog"),
      stamps: [
        { slug: "cover-blob", file: "cover-blob.png", group: "cover", label: "Cover blob" },
        { slug: "heart", file: "heart.png", group: "marks", label: "Heart" }
      ]
    }));
    fs.writeFileSync(path.join(imported, "my-stamp.svg"), "<svg />");

    await expect(listStamps("", imported, bundled)).resolves.toEqual([
      {
        slug: "cover-blob",
        builtin: true,
        format: "png",
        groupId: "cover",
        name: "Cover blob",
        path: path.join(bundled, "cover-blob.png")
      },
      {
        slug: "heart",
        builtin: true,
        format: "png",
        groupId: "marks",
        name: "Heart",
        path: path.join(bundled, "heart.png")
      },
      {
        slug: "my-stamp",
        builtin: false,
        format: "svg",
        groupId: "imported",
        name: "my-stamp.svg",
        path: path.join(imported, "my-stamp.svg")
      }
    ]);
  });

  it("fails closed when a packaged file is absent from the catalog", async () => {
    const root = tempRoot();
    const bundled = path.join(root, "bundled");
    const imported = path.join(root, "imported");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "orphan.png"), "png");
    fs.writeFileSync(path.join(bundled, "catalog.json"), JSON.stringify({ ...header("stamp-catalog"), stamps: [] }));

    await expect(listStamps("", imported, bundled)).rejects.toThrow(/uncatalogued assets: orphan\.png/i);
  });

  it("lists WebP built-ins and imports, and imports a WebP stamp", async () => {
    const root = tempRoot();
    const bundled = path.join(root, "bundled");
    const imported = path.join(root, "imported");
    const source = path.join(root, "source");
    fs.mkdirSync(bundled);
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(bundled, "heart.webp"), "webp");
    fs.writeFileSync(path.join(bundled, "catalog.json"), JSON.stringify({
      ...header("stamp-catalog"),
      stamps: [{ slug: "heart", file: "heart.webp", group: "marks", label: "Heart" }]
    }));
    fs.writeFileSync(path.join(source, "sticker.webp"), "webp");

    await expect(importStamps([path.join(source, "sticker.webp")], "", imported, bundled)).resolves.toEqual([{
      fileName: "sticker.webp",
      path: path.join(imported, "sticker.webp"),
      status: "imported"
    }]);
    await expect(listStamps("", imported, bundled)).resolves.toEqual([
      { slug: "heart", builtin: true, format: "webp", groupId: "marks", name: "Heart", path: path.join(bundled, "heart.webp") },
      { slug: "sticker", builtin: false, format: "webp", groupId: "imported", name: "sticker.webp", path: path.join(imported, "sticker.webp") }
    ]);
  });

  it("keeps built-in filenames reserved for imports", async () => {
    const root = tempRoot();
    const bundled = path.join(root, "bundled");
    const imported = path.join(root, "imported");
    const source = path.join(root, "source");
    fs.mkdirSync(bundled);
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(bundled, "heart.png"), "built-in");
    fs.writeFileSync(path.join(bundled, "catalog.json"), JSON.stringify({
      ...header("stamp-catalog"),
      stamps: [{ slug: "heart", file: "heart.png", group: "marks", label: "Heart" }]
    }));
    fs.writeFileSync(path.join(source, "HEART.PNG"), "import");

    await expect(importStamps([path.join(source, "HEART.PNG")], "", imported, bundled)).resolves.toEqual([{
      fileName: "heart.png",
      path: path.join(bundled, "heart.png"),
      status: "skipped-name-conflict"
    }]);
    expect(fs.existsSync(path.join(imported, "HEART.PNG"))).toBe(false);
  });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-stamps-"));
  roots.push(root);
  return root;
}
