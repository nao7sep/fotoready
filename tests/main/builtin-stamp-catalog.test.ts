import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertBuiltinStampCatalogCompleteness,
  builtinStampPathFor,
  parseBuiltinStampCatalog,
  readBuiltinStampCatalog,
  relinkMissingBuiltinStamps
} from "@main/builtin-stamp-catalog";
import { defaultOutputSettings } from "@shared/defaults";
import type { Pipeline } from "@shared/types/pipeline";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("built-in stamp catalog", () => {
  it("accepts an alphabetized, complete catalog", () => {
    const entries = parseBuiltinStampCatalog({
      version: 1,
      stamps: [
        { slug: "cover-blob", file: "cover-blob.png", group: "cover", label: "Cover blob" },
        { slug: "heart", file: "heart.png", group: "marks", label: "Heart" }
      ]
    });

    expect(entries).toHaveLength(2);
    expect(() => assertBuiltinStampCatalogCompleteness(entries, ["cover-blob.png", "heart.png"])).not.toThrow();
  });

  it("accepts a WebP built-in", () => {
    const entries = parseBuiltinStampCatalog({
      version: 1,
      stamps: [{ slug: "heart", file: "heart.webp", group: "marks", label: "Heart" }]
    });

    expect(entries.map((entry) => entry.file)).toEqual(["heart.webp"]);
    expect(() => assertBuiltinStampCatalogCompleteness(entries, ["heart.webp"])).not.toThrow();
    expect(() => parseBuiltinStampCatalog({
      version: 1,
      stamps: [{ slug: "heart", file: "heart.gif", group: "marks", label: "Heart" }]
    })).toThrow(/slug plus \.png, \.svg or \.webp/i);
  });

  it("rejects duplicate identities and invalid groups", () => {
    expect(() => parseBuiltinStampCatalog({
      version: 1,
      stamps: [
        { slug: "heart", file: "heart.png", group: "marks", label: "Heart" },
        { slug: "heart", file: "heart.svg", group: "marks", label: "Other heart" }
      ]
    })).toThrow(/duplicates slug/i);

    expect(() => parseBuiltinStampCatalog({
      version: 1,
      stamps: [{ slug: "heart", file: "heart.png", group: "objects", label: "Heart" }]
    })).toThrow(/not a built-in stamp group/i);
  });

  it("rejects unstable filenames and non-alphabetical entries", () => {
    expect(() => parseBuiltinStampCatalog({
      version: 1,
      stamps: [{ slug: "heart", file: "heart-red.png", group: "marks", label: "Heart" }]
    })).toThrow(/slug plus/i);

    expect(() => parseBuiltinStampCatalog({
      version: 1,
      stamps: [
        { slug: "heart", file: "heart.png", group: "marks", label: "Heart" },
        { slug: "cover-blob", file: "cover-blob.png", group: "cover", label: "Cover blob" }
      ]
    })).toThrow(/sorted alphabetically/i);
  });

  it("rejects missing and uncatalogued packaged assets", () => {
    const entries = parseBuiltinStampCatalog({
      version: 1,
      stamps: [{ slug: "heart", file: "heart.png", group: "marks", label: "Heart" }]
    });

    expect(() => assertBuiltinStampCatalogCompleteness(entries, ["orphan.png"]))
      .toThrow(/missing assets: heart\.png; uncatalogued assets: orphan\.png/i);
  });

  it("matches the repository's packaged stamp resources", async () => {
    const stampsDir = path.resolve("resources/stamps");
    const assetFiles = fs.readdirSync(stampsDir).filter((fileName) => /\.(?:png|svg|webp)$/i.test(fileName));
    const entries = await readBuiltinStampCatalog(stampsDir, assetFiles);

    expect(entries.map((entry) => entry.slug)).toEqual(expect.arrayContaining([
      "censor-bar",
      "check",
      "cover-blob",
      "exclamation-comic",
      "heart"
    ]));
  });
});

describe("saved stamp paths", () => {
  const entries = parseBuiltinStampCatalog({
    version: 1,
    stamps: [{ slug: "heart", file: "heart.webp", group: "marks", label: "Heart" }]
  });

  it("names the current built-in for a catalogued slug in any stamp format", () => {
    for (const fileName of ["heart.png", "heart.svg", "heart.webp"]) {
      expect(builtinStampPathFor(fileName, entries, "/app/stamps"), fileName).toBe(path.join("/app/stamps", "heart.webp"));
    }
    expect(builtinStampPathFor("heart.gif", entries, "/app/stamps")).toBeNull();
    expect(builtinStampPathFor("HEART.PNG", entries, "/app/stamps")).toBeNull();
    expect(builtinStampPathFor("my-heart.png", entries, "/app/stamps")).toBeNull();
  });

  it("relinks a missing built-in path to the current built-in and leaves every other path as saved", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-relink-"));
    roots.push(root);
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "heart.webp"), "webp");
    fs.writeFileSync(path.join(bundled, "catalog.json"), JSON.stringify({
      version: 1,
      stamps: [{ slug: "heart", file: "heart.webp", group: "marks", label: "Heart" }]
    }));
    const kept = path.join(root, "heart.png");
    fs.writeFileSync(kept, "a user's own file that still exists");

    const op = (id: string, type: string, assetPath: string) => ({ id, type, enabled: true, params: { assetPath, x: 0.5, y: 0.5 } });
    const pipeline: Pipeline = {
      ops: [
        op("moved", "stamp", "/Applications/Old.app/Contents/Resources/stamps/heart.png"),
        op("windows", "stamp", "C:\\Program Files\\FotoReady\\resources\\stamps\\heart.png"),
        op("existing", "stamp", kept),
        op("imported", "stamp", "/gone/stamps/my-own.png"),
        op("watermark", "watermark-image", "/gone/stamps/heart.png"),
        op("empty", "stamp", "")
      ],
      output: defaultOutputSettings()
    };

    const relinked = await relinkMissingBuiltinStamps(pipeline, bundled);

    expect(relinked.ops.map((entry) => entry.params.assetPath)).toEqual([
      path.join(bundled, "heart.webp"),
      path.join(bundled, "heart.webp"),
      kept,
      "/gone/stamps/my-own.png",
      "/gone/stamps/heart.png",
      ""
    ]);
    expect(relinked.ops[0]!.params).toEqual({ ...pipeline.ops[0]!.params, assetPath: path.join(bundled, "heart.webp") });
    expect(pipeline.ops[0]!.params.assetPath).toBe("/Applications/Old.app/Contents/Resources/stamps/heart.png");
  });
});
