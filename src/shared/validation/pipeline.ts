import type { OutputSettings } from "../types/pipeline";
import { assertBoolean, assertFiniteNumber, assertNonEmptyString, assertOneOf, assertRecord } from "./common";

const outputFormats = ["jpeg", "webp", "avif", "png"] as const;
const qualityKeywords = ["match-source-size", "match-source-quality"] as const;
const chromaSubsamplingModes = ["4:4:4", "4:2:2", "4:2:0"] as const;
const iccOutputModes = ["tag-srgb", "embed-srgb", "untagged"] as const;

export function validateOutputSettings(value: unknown, path = "output"): OutputSettings {
  const record = assertRecord(value, path);
  return {
    format: assertOneOf(record.format, `${path}.format`, outputFormats),
    quality: validateOutputQuality(record.quality, `${path}.quality`),
    jpegProgressive: assertBoolean(record.jpegProgressive, `${path}.jpegProgressive`),
    jpegChromaSubsampling: assertOneOf(record.jpegChromaSubsampling, `${path}.jpegChromaSubsampling`, chromaSubsamplingModes),
    webpMethod: assertFiniteNumber(record.webpMethod, `${path}.webpMethod`, { integer: true, min: 0, max: 6 }),
    avifEffort: assertFiniteNumber(record.avifEffort, `${path}.avifEffort`, { integer: true, min: 0, max: 9 }),
    pngPalette: assertBoolean(record.pngPalette, `${path}.pngPalette`),
    backgroundForTransparency: assertNonEmptyString(record.backgroundForTransparency, `${path}.backgroundForTransparency`),
    iccOutput: assertOneOf(record.iccOutput, `${path}.iccOutput`, iccOutputModes)
  };
}

export function applyOutputSettingChange(output: OutputSettings, key: string, value: unknown): OutputSettings {
  if (!isOutputSettingKey(key)) {
    throw new Error(`Unknown output setting "${key}".`);
  }
  return validateOutputSettings({ ...output, [key]: value }, "output");
}

function validateOutputQuality(value: unknown, path: string): OutputSettings["quality"] {
  if (typeof value === "string") {
    return assertOneOf(value, path, qualityKeywords);
  }
  return assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 });
}

function isOutputSettingKey(key: string): key is keyof OutputSettings {
  return key === "format"
    || key === "quality"
    || key === "jpegProgressive"
    || key === "jpegChromaSubsampling"
    || key === "webpMethod"
    || key === "avifEffort"
    || key === "pngPalette"
    || key === "backgroundForTransparency"
    || key === "iccOutput";
}
