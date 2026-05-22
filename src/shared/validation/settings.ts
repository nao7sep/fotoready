import { MAX_PREVIEW_LONG_EDGE, MAX_VISION_IMAGE_LONG_EDGE } from "../constants";
import { EDITABLE_METADATA_FIELDS, METADATA_KEEP_GROUPS, type GlobalSettings, type MetadataKeepGroup, type MetadataFields } from "../types/settings";
import { assertArray, assertBoolean, assertFiniteNumber, assertNonEmptyString, assertOneOf, assertRecord, assertString, isRecord } from "./common";

const outputFormats = ["original", "jpeg", "webp", "avif", "png"] as const;
const jpegQualityModes = ["auto", "fixed"] as const;
const chromaSubsamplingModes = ["4:4:4", "4:2:2", "4:2:0"] as const;

export type SettingsNormalizationResult = {
  settings: GlobalSettings;
  issues: string[];
};

export function normalizeGlobalSettings(input: unknown, fallback: GlobalSettings): SettingsNormalizationResult {
  const issues: string[] = [];
  const source = isRecord(input)
    ? input
    : (issues.push("settings must be a JSON object."), {});

  const settings: GlobalSettings = {
    confirmDeleteOriginals: readValue(source, "confirmDeleteOriginals", fallback.confirmDeleteOriginals, issues, assertBoolean),
    confirmDeleteTasks: readValue(source, "confirmDeleteTasks", fallback.confirmDeleteTasks, issues, assertBoolean),
    confirmDeleteOutputFiles: readValue(source, "confirmDeleteOutputFiles", fallback.confirmDeleteOutputFiles, issues, assertBoolean),
    defaultOutputFormat: readValue(source, "defaultOutputFormat", fallback.defaultOutputFormat, issues, (value, path) => assertOneOf(value, path, outputFormats)),
    defaultWebpQuality: readValue(source, "defaultWebpQuality", fallback.defaultWebpQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    defaultAvifQuality: readValue(source, "defaultAvifQuality", fallback.defaultAvifQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    defaultPngPalette: readValue(source, "defaultPngPalette", fallback.defaultPngPalette, issues, assertBoolean),
    defaultMetadataStrip: readValue(source, "defaultMetadataStrip", fallback.defaultMetadataStrip, issues, validateMetadataStrip),
    defaultGenerateDescription: readValue(source, "defaultGenerateDescription", fallback.defaultGenerateDescription, issues, assertBoolean),
    defaultGenerateSlug: readValue(source, "defaultGenerateSlug", fallback.defaultGenerateSlug, issues, assertBoolean),
    enableJpegQualityEstimate: readValue(source, "enableJpegQualityEstimate", fallback.enableJpegQualityEstimate, issues, assertBoolean),
    defaultFlattenTransparency: readValue(source, "defaultFlattenTransparency", fallback.defaultFlattenTransparency, issues, assertBoolean),
    defaultBackgroundForTransparency: readValue(source, "defaultBackgroundForTransparency", fallback.defaultBackgroundForTransparency, issues, assertNonEmptyString),
    injectAuthorCopyright: readValue(source, "injectAuthorCopyright", fallback.injectAuthorCopyright, issues, assertBoolean),
    preserveSourceDates: readValue(source, "preserveSourceDates", fallback.preserveSourceDates, issues, assertBoolean),
    injectFields: readValue(source, "injectFields", fallback.injectFields, issues, validateMetadataFields),
    defaultOutputDirectory: readValue(source, "defaultOutputDirectory", fallback.defaultOutputDirectory, issues, assertString),
    lutFolder: readValue(source, "lutFolder", fallback.lutFolder, issues, assertString),
    defaultWatermarkImage: readValue(source, "defaultWatermarkImage", fallback.defaultWatermarkImage, issues, assertString),
    defaultWatermarkTextFontFamily: readValue(source, "defaultWatermarkTextFontFamily", fallback.defaultWatermarkTextFontFamily, issues, assertNonEmptyString),
    jpegQualityMode: readValue(source, "jpegQualityMode", fallback.jpegQualityMode, issues, (value, path) => assertOneOf(value, path, jpegQualityModes)),
    jpegFixedQuality: readValue(source, "jpegFixedQuality", fallback.jpegFixedQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    jpegChromaSubsampling: readValue(source, "jpegChromaSubsampling", fallback.jpegChromaSubsampling, issues, (value, path) => assertOneOf(value, path, chromaSubsamplingModes)),
    jpegProgressive: readValue(source, "jpegProgressive", fallback.jpegProgressive, issues, assertBoolean),
    webpMethod: readValue(source, "webpMethod", fallback.webpMethod, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 6 })),
    avifEffort: readValue(source, "avifEffort", fallback.avifEffort, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 9 })),
    model: readValue(source, "model", fallback.model, issues, assertNonEmptyString),
    preResizeLongEdge: readValue(source, "preResizeLongEdge", fallback.preResizeLongEdge, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 128, max: MAX_VISION_IMAGE_LONG_EDGE })),
    visionDescriptionPrompt: readValue(source, "visionDescriptionPrompt", fallback.visionDescriptionPrompt, issues, assertNonEmptyString),
    visionSlugPrompt: readValue(source, "visionSlugPrompt", fallback.visionSlugPrompt, issues, assertNonEmptyString),
    visionConcurrency: readValue(source, "visionConcurrency", fallback.visionConcurrency, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 32 })),
    visionTimeoutMs: readValue(source, "visionTimeoutMs", fallback.visionTimeoutMs, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1000, max: 600000 })),
    visionMaxRetries: readValue(source, "visionMaxRetries", fallback.visionMaxRetries, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 10 })),
    visionInitialBackoffMs: readValue(source, "visionInitialBackoffMs", fallback.visionInitialBackoffMs, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 30000 })),
    workerPoolSize: readValue(source, "workerPoolSize", fallback.workerPoolSize, issues, validateWorkerPoolSize),
    previewLongEdge: readValue(source, "previewLongEdge", fallback.previewLongEdge, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 64, max: MAX_PREVIEW_LONG_EDGE })),
    previewDebounceMs: readValue(source, "previewDebounceMs", fallback.previewDebounceMs, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 5000 }))
  };
  if (settings.defaultGenerateSlug) {
    settings.defaultGenerateDescription = true;
  }
  if (!settings.enableJpegQualityEstimate && settings.jpegQualityMode === "auto") {
    settings.jpegQualityMode = "fixed";
  }

  return { settings, issues };
}

function readValue<T>(
  source: Record<string, unknown>,
  key: string,
  fallback: T,
  issues: string[],
  parser: (value: unknown, path: string) => T
): T {
  const value = source[key];
  if (value === undefined) {
    return cloneValue(fallback);
  }

  try {
    return parser(value, `settings.${key}`);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return cloneValue(fallback);
  }
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return structuredClone(value);
  }
  return value;
}

function validateMetadataStrip(value: unknown, path: string): MetadataKeepGroup[] {
  const fields = assertArray(value, path).flatMap((item, index) => {
    const migrated = migrateLegacyMetadataKeepGroup(item);
    if (migrated) return [migrated];
    if (item === "orientation" || item === "colorspace") return [];
    return [assertOneOf(item, `${path}[${index}]`, METADATA_KEEP_GROUPS)];
  });
  return [...new Set(fields)];
}

function migrateLegacyMetadataKeepGroup(value: unknown): MetadataKeepGroup | null {
  if (value === "author" || value === "copyright") return "editorial";
  return null;
}

function validateMetadataFields(value: unknown, path: string): MetadataFields {
  const record = assertRecord(value, path);
  const fields: MetadataFields = {};
  for (const key of EDITABLE_METADATA_FIELDS) {
    if (record[key] === undefined) continue;
    fields[key] = assertString(record[key], `${path}.${key}`);
  }
  return fields;
}

function validateWorkerPoolSize(value: unknown, path: string): number | null {
  if (value === null) return null;
  return assertFiniteNumber(value, path, { integer: true, min: 1, max: 512 });
}
