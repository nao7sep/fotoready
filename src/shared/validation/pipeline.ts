import { PIPELINE_SPEC_VERSION } from "../constants";
import type { OutputSettings, Pipeline } from "../types/pipeline";
import { assertArray, assertBoolean, assertFiniteNumber, assertNonEmptyString, assertOneOf, assertRecord } from "./common";
import type { OpDefinitionResolver } from "./ops";
import { validateOpInstance } from "./ops";

const outputFormats = ["jpeg", "webp", "avif", "png"] as const;
const qualityKeywords = ["match-source-size", "match-source-quality"] as const;
const chromaSubsamplingModes = ["4:4:4", "4:2:2", "4:2:0"] as const;
const iccOutputModes = ["tag-srgb", "embed-srgb", "untagged"] as const;
const detectedColorSpaceTags = ["srgb", "adobe-rgb", "uncalibrated"] as const;
const assumedColorSpaces = ["srgb", "adobe-rgb"] as const;

export function validatePipeline(value: unknown, resolveDefinition: OpDefinitionResolver, path = "pipeline"): Pipeline {
  const record = assertRecord(value, path);
  const specVersion = assertFiniteNumber(record.specVersion, `${path}.specVersion`, { integer: true });
  if (specVersion !== PIPELINE_SPEC_VERSION) {
    throw new Error(`${path}.specVersion must equal ${PIPELINE_SPEC_VERSION}.`);
  }

  return {
    specVersion: PIPELINE_SPEC_VERSION,
    ops: assertArray(record.ops, `${path}.ops`).map((op, index) => validateOpInstance(op, resolveDefinition, `${path}.ops[${index}]`)),
    output: validateOutputSettings(record.output, `${path}.output`),
    appliedColorNormalization: record.appliedColorNormalization === null
      ? null
      : validateAppliedColorNormalization(record.appliedColorNormalization, `${path}.appliedColorNormalization`),
    sourceSnapshot: record.sourceSnapshot === null
      ? null
      : validateSourceSnapshot(record.sourceSnapshot, `${path}.sourceSnapshot`),
    toolVersions: record.toolVersions === null
      ? null
      : validateToolVersions(record.toolVersions, `${path}.toolVersions`)
  };
}

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

  return validateOutputSettings(
    {
      ...output,
      [key]: value
    },
    "output"
  );
}

function validateOutputQuality(value: unknown, path: string): OutputSettings["quality"] {
  if (typeof value === "string") {
    return assertOneOf(value, path, qualityKeywords);
  }
  return assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 });
}

function validateAppliedColorNormalization(
  value: unknown,
  path: string
): NonNullable<Pipeline["appliedColorNormalization"]> {
  const record = assertRecord(value, path);
  return {
    detectedProfile: record.detectedProfile === null ? null : assertNonEmptyString(record.detectedProfile, `${path}.detectedProfile`),
    detectedColorSpaceTag: record.detectedColorSpaceTag === null
      ? null
      : assertOneOf(record.detectedColorSpaceTag, `${path}.detectedColorSpaceTag`, detectedColorSpaceTags),
    assumed: record.assumed === null
      ? null
      : assertOneOf(record.assumed, `${path}.assumed`, assumedColorSpaces),
    iccBakedIntoPixels: assertBoolean(record.iccBakedIntoPixels, `${path}.iccBakedIntoPixels`)
  };
}

function validateSourceSnapshot(value: unknown, path: string): NonNullable<Pipeline["sourceSnapshot"]> {
  const record = assertRecord(value, path);
  return {
    sha256: assertNonEmptyString(record.sha256, `${path}.sha256`),
    width: assertFiniteNumber(record.width, `${path}.width`, { integer: true, min: 1 }),
    height: assertFiniteNumber(record.height, `${path}.height`, { integer: true, min: 1 }),
    format: assertNonEmptyString(record.format, `${path}.format`),
    jpegQualityEstimate: record.jpegQualityEstimate === null
      ? null
      : validateJpegQualityEstimate(record.jpegQualityEstimate, `${path}.jpegQualityEstimate`)
  };
}

function validateJpegQualityEstimate(
  value: unknown,
  path: string
): NonNullable<NonNullable<Pipeline["sourceSnapshot"]>["jpegQualityEstimate"]> {
  const record = assertRecord(value, path);
  return {
    value: assertFiniteNumber(record.value, `${path}.value`, { integer: true, min: 1, max: 100 }),
    method: assertOneOf(record.method, `${path}.method`, ["metadata", "dqt-match", "binary-search"])
  };
}

function validateToolVersions(value: unknown, path: string): NonNullable<Pipeline["toolVersions"]> {
  const record = assertRecord(value, path);
  return {
    fotoready: assertNonEmptyString(record.fotoready, `${path}.fotoready`),
    sharp: assertNonEmptyString(record.sharp, `${path}.sharp`),
    libvips: assertNonEmptyString(record.libvips, `${path}.libvips`),
    exiftool: assertNonEmptyString(record.exiftool, `${path}.exiftool`)
  };
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
