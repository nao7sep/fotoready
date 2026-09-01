import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertBuiltinStampCatalogCompleteness,
  parseBuiltinStampCatalog,
  readBuiltinStampCatalog
} from "@main/builtin-stamp-catalog";

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
    const assetFiles = fs.readdirSync(stampsDir).filter((fileName) => /\.(?:png|svg)$/i.test(fileName));
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
