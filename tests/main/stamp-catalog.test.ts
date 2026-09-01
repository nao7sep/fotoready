import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));

import { importStamps, listStamps } from "@main/stamp-catalog";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
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
      version: 1,
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
    fs.writeFileSync(path.join(bundled, "catalog.json"), JSON.stringify({ version: 1, stamps: [] }));

    await expect(listStamps("", imported, bundled)).rejects.toThrow(/uncatalogued assets: orphan\.png/i);
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
      version: 1,
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
