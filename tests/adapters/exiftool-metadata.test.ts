import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { exiftool } from "exiftool-vendored";
import { applyMetadataToOutput, metadataCopyArgs, readSourceMetadataSummary } from "@adapters/exiftool";

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

  it("strips every capture time, in EXIF, IPTC, XMP and GPS, when the task strips time", async () => {
    const sourcePath = await capturedTimeSource(dir);
    const outputPath = path.join(dir, "output.tmp");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#224488" } }).jpeg().toFile(outputPath);

    await applyMetadataToOutput({ ...baseInput, sourcePath, outputPath, keep: ["gps", "editorial"], injectFields: {} });

    const times = await exiftool.read(outputPath, ["-time:all", "-G1", "-a"]) as unknown as Record<string, unknown>;
    expect(Object.keys(times).filter((key) => /Date|Time/.test(key) && !/^(System|File):/.test(key))).toEqual([]);
    const kept = await exiftool.read(outputPath, ["-G1", "-a"]) as unknown as Record<string, unknown>;
    expect(kept["IFD0:Make"] ?? kept.Make).toBe("Canon");
    expect(Object.keys(kept).some((key) => key.endsWith("GPSLatitude"))).toBe(true);
  });

  it("flags a capture time carried only in IPTC and XMP", async () => {
    const sourcePath = path.join(dir, "source.jpg");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#884422" } }).jpeg().toFile(sourcePath);
    await exiftool.write(sourcePath, {
      "IPTC:DateCreated": "2024:05:01",
      "IPTC:TimeCreated": "10:00:00+09:00",
      "XMP-photoshop:DateCreated": "2024:05:01 10:00:00+09:00"
    } as never, ["-overwrite_original"]);

    const summary = await readSourceMetadataSummary(sourcePath);

    expect(summary.dates).toMatchObject({ "Date created": expect.stringContaining("2024:05:01"), "Time created": expect.stringContaining("10:00:00") });
  });

  it("strips every place name, in IPTC and XMP, when the task strips GPS", async () => {
    const sourcePath = await placedSource(dir);
    const outputPath = path.join(dir, "output.tmp");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#224488" } }).jpeg().toFile(outputPath);

    await applyMetadataToOutput({ ...baseInput, sourcePath, outputPath, keep: ["dates", "editorial"], injectFields: {} });

    const tags = await exiftool.read(outputPath, ["-G1", "-a"]) as unknown as Record<string, unknown>;
    const placeKeys = ["City", "Province-State", "State", "Country-PrimaryLocationName", "Country", "Country-PrimaryLocationCode", "CountryCode", "Sub-location", "Location", "LocationShown", "LocationCreated"];
    expect(Object.keys(tags).filter((key) => placeKeys.some((placeKey) => key.endsWith(placeKey)))).toEqual([]);
    expect(Object.keys(tags).filter((key) => /GPS/.test(key) && !/^Composite/.test(key))).toEqual([]);
    expect(tags["IFD0:Make"] ?? tags.Make).toBe("Canon");
  });

  it("flags a place name carried only in IPTC and XMP", async () => {
    const sourcePath = path.join(dir, "source.jpg");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#884422" } }).jpeg().toFile(sourcePath);
    await exiftool.write(sourcePath, {
      "IPTC:City": "Kyoto",
      "IPTC:Province-State": "Kyoto Prefecture",
      "IPTC:Country-PrimaryLocationName": "Japan",
      "XMP-photoshop:Country": "Japan",
      "XMP-iptcCore:CountryCode": "JP"
    } as never, ["-overwrite_original"]);

    const summary = await readSourceMetadataSummary(sourcePath);

    expect(summary.gps).toMatchObject({ City: "Kyoto", "Province/state": "Kyoto Prefecture", Country: "Japan", "Country code": "JP" });
  });
});

/** A JPEG that records a place name in every group photo tools write it, plus a GPS position and a camera make. */
async function placedSource(dir: string): Promise<string> {
  const sourcePath = path.join(dir, "source.jpg");
  await sharp({ create: { width: 16, height: 16, channels: 3, background: "#884422" } }).jpeg().toFile(sourcePath);
  await exiftool.write(sourcePath, {
    "IPTC:City": "Kyoto",
    "IPTC:Sub-location": "Gion",
    "IPTC:Province-State": "Kyoto Prefecture",
    "IPTC:Country-PrimaryLocationName": "Japan",
    "IPTC:Country-PrimaryLocationCode": "JPN",
    "XMP-photoshop:City": "Kyoto",
    "XMP-photoshop:State": "Kyoto Prefecture",
    "XMP-photoshop:Country": "Japan",
    "XMP-iptcCore:Location": "Gion",
    "XMP-iptcCore:CountryCode": "JP",
    GPSLatitude: 35.1,
    GPSLongitude: 139.2,
    Make: "Canon"
  } as never, ["-overwrite_original"]);
  return sourcePath;
}

/** A JPEG that records its capture time everywhere photo tools write it, plus a GPS position and a camera make. */
async function capturedTimeSource(dir: string): Promise<string> {
  const sourcePath = path.join(dir, "source.jpg");
  await sharp({ create: { width: 16, height: 16, channels: 3, background: "#884422" } }).jpeg().toFile(sourcePath);
  await exiftool.write(sourcePath, {
    DateTimeOriginal: "2024:05:01 10:00:00",
    CreateDate: "2024:05:01 10:00:00",
    SubSecTimeOriginal: "123",
    SubSecTimeDigitized: "456",
    SubSecTime: "789",
    OffsetTimeOriginal: "+09:00",
    OffsetTimeDigitized: "+09:00",
    OffsetTime: "+09:00",
    "IPTC:DateCreated": "2024:05:01",
    "IPTC:TimeCreated": "10:00:00+09:00",
    "IPTC:DigitalCreationDate": "2024:05:01",
    "IPTC:DigitalCreationTime": "10:00:00+09:00",
    "XMP-photoshop:DateCreated": "2024:05:01 10:00:00+09:00",
    "XMP-xmp:CreateDate": "2024:05:01 10:00:00+09:00",
    "XMP-exif:DateTimeOriginal": "2024:05:01 10:00:00+09:00",
    "XMP-exif:DateTimeDigitized": "2024:05:01 10:00:00+09:00",
    GPSLatitude: 35.1,
    GPSLongitude: 139.2,
    GPSDateStamp: "2024:05:01",
    GPSTimeStamp: "01:00:00",
    Make: "Canon"
  } as never, ["-overwrite_original"]);
  return sourcePath;
}
