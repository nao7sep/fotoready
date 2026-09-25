import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { exiftool } from "exiftool-vendored";
import { applyMetadataToOutput, metadataCopyArgs } from "@adapters/exiftool";

const baseInput = {
  sourcePath: "/source/photo.jpg",
  stripActive: true,
  keep: [] as ("editorial" | "dates" | "gps")[],
  savedAt: new Date(2026, 8, 26, 7, 0, 0),
  writeSoftwareTag: true,
  writeModifyDate: false
};

describe("metadataCopyArgs", () => {
  it("copies the source first, so every clear and stamp after it overrides a copied value", () => {
    const args = metadataCopyArgs(baseInput);

    expect(args.slice(0, 3)).toEqual(["-TagsFromFile", "/source/photo.jpg", "-all:all"]);
    expect(args).toEqual(expect.arrayContaining(["-GPS:all=", "-XMP-exif:GPS*=", "-DateTimeOriginal=", "-EXIF:Artist=", "-Software=FotoReady", "-ModifyDate="]));
    expect(args.at(-1)).toBe("-overwrite_original");
  });

  it("keeps the groups the task keeps", () => {
    const args = metadataCopyArgs({ ...baseInput, keep: ["gps", "dates", "editorial"] });

    expect(args).not.toContain("-GPS:all=");
    expect(args).not.toContain("-DateTimeOriginal=");
    expect(args).not.toContain("-EXIF:Artist=");
  });
});

describe("applyMetadataToOutput with ExifTool", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-exiftool-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await exiftool.end();
  });

  it("writes a file with no GPS in any group when the task strips GPS", async () => {
    const sourcePath = path.join(dir, "source.jpg");
    const outputPath = path.join(dir, "output.tmp");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#884422" } }).jpeg().toFile(sourcePath);
    await exiftool.write(sourcePath, {
      GPSLatitude: 35.1,
      GPSLongitude: 139.2,
      "XMP-exif:GPSLatitude": "35.1 N",
      DateTimeOriginal: "2020:01:02 03:04:05",
      Make: "Canon"
    } as never, ["-overwrite_original"]);
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#224488" } }).jpeg().toFile(outputPath);

    await applyMetadataToOutput({ ...baseInput, sourcePath, outputPath, keep: ["dates"], injectFields: {} });

    const tags = await exiftool.read(outputPath, ["-G1", "-a"]) as unknown as Record<string, unknown>;
    expect(Object.keys(tags).filter((key) => /GPS/.test(key) && !/^Composite/.test(key))).toEqual([]);
    expect(tags["IFD0:Make"] ?? tags.Make).toBe("Canon");
    expect(tags["IFD0:Software"] ?? tags.Software).toBe("FotoReady");
    expect(Object.keys(tags).some((key) => key.endsWith("DateTimeOriginal"))).toBe(true);
    expect(await fs.readdir(dir)).toEqual(["output.tmp", "source.jpg"]);
  });
});
