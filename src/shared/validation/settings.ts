import { MAX_ASSET_PICKER_PREVIEW_LONG_EDGE, MAX_PREVIEW_LONG_EDGE, MAX_VISION_IMAGE_LONG_EDGE, MIN_ASSET_PICKER_PREVIEW_LONG_EDGE } from "../constants";
import { EDITABLE_METADATA_FIELDS, THEME_PREFERENCES, type GlobalSettings, type MetadataFields } from "../types/settings";
import { LANGUAGES } from "../i18n/languages";
import { assertBoolean, assertFiniteNumber, assertNonEmptyString, assertOneOf, assertRecord, assertString, isRecord } from "./common";

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
    // An invalid language affects only this set.
    language: readValue(source, "language", fallback.language, issues, (value, path) => assertOneOf(value, path, ["system", ...LANGUAGES] as const)),
    theme: readValue(source, "theme", fallback.theme, issues, (value, path) => assertOneOf(value, path, THEME_PREFERENCES)),
    // UI font is free text; blank is allowed and resolves to the built-in default stack at apply time.
    uiFontFamily: readValue(source, "uiFontFamily", fallback.uiFontFamily, issues, assertString),
    confirmDeleteOriginals: readValue(source, "confirmDeleteOriginals", fallback.confirmDeleteOriginals, issues, assertBoolean),
    confirmDeleteTasks: readValue(source, "confirmDeleteTasks", fallback.confirmDeleteTasks, issues, assertBoolean),
    confirmDeleteOutputFiles: readValue(source, "confirmDeleteOutputFiles", fallback.confirmDeleteOutputFiles, issues, assertBoolean),
    defaultOutputFormat: readValue(source, "defaultOutputFormat", fallback.defaultOutputFormat, issues, (value, path) => assertOneOf(value, path, outputFormats)),
    defaultWebpQuality: readValue(source, "defaultWebpQuality", fallback.defaultWebpQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    defaultAvifQuality: readValue(source, "defaultAvifQuality", fallback.defaultAvifQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    defaultPngPalette: readValue(source, "defaultPngPalette", fallback.defaultPngPalette, issues, assertBoolean),
    defaultGenerateDescription: readValue(source, "defaultGenerateDescription", fallback.defaultGenerateDescription, issues, assertBoolean),
    defaultGenerateSlug: readValue(source, "defaultGenerateSlug", fallback.defaultGenerateSlug, issues, assertBoolean),
    enableJpegQualityEstimate: readValue(source, "enableJpegQualityEstimate", fallback.enableJpegQualityEstimate, issues, assertBoolean),
    defaultFlattenTransparency: readValue(source, "defaultFlattenTransparency", fallback.defaultFlattenTransparency, issues, assertBoolean),
    defaultBackgroundForTransparency: readValue(source, "defaultBackgroundForTransparency", fallback.defaultBackgroundForTransparency, issues, assertNonEmptyString),
    injectFields: readValue(source, "injectFields", fallback.injectFields, issues, validateMetadataFields),
    defaultOutputDirectory: readValue(source, "defaultOutputDirectory", fallback.defaultOutputDirectory, issues, assertString),
    lutFolder: readValue(source, "lutFolder", fallback.lutFolder, issues, assertString),
    stampFolder: readValue(source, "stampFolder", fallback.stampFolder, issues, assertString),
    defaultWatermarkImage: readValue(source, "defaultWatermarkImage", fallback.defaultWatermarkImage, issues, assertString),
    defaultWatermarkTextFontFamily: readValue(source, "defaultWatermarkTextFontFamily", fallback.defaultWatermarkTextFontFamily, issues, assertNonEmptyString),
    jpegQualityMode: readValue(source, "jpegQualityMode", fallback.jpegQualityMode, issues, (value, path) => assertOneOf(value, path, jpegQualityModes)),
    jpegFixedQuality: readValue(source, "jpegFixedQuality", fallback.jpegFixedQuality, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 })),
    jpegChromaSubsampling: readValue(source, "jpegChromaSubsampling", fallback.jpegChromaSubsampling, issues, (value, path) => assertOneOf(value, path, chromaSubsamplingModes)),
    jpegProgressive: readValue(source, "jpegProgressive", fallback.jpegProgressive, issues, assertBoolean),
    webpMethod: readValue(source, "webpMethod", fallback.webpMethod, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 6 })),
    avifEffort: readValue(source, "avifEffort", fallback.avifEffort, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 9 })),
    provider: readValue(source, "provider", fallback.provider, issues, (value, path) => assertOneOf(value, path, ["gemini"])),
    "gemini.endpoint": readValue(source, "gemini.endpoint", fallback["gemini.endpoint"], issues, assertModelEndpoint),
    "gemini.description": readValue(source, "gemini.description", fallback["gemini.description"], issues, assertNonEmptyString),
    "gemini.slug": readValue(source, "gemini.slug", fallback["gemini.slug"], issues, assertNonEmptyString),
    extraModelIds: readValue(source, "extraModelIds", fallback.extraModelIds, issues, validateExtraModelIds),
    preResizeLongEdge: readValue(source, "preResizeLongEdge", fallback.preResizeLongEdge, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 128, max: MAX_VISION_IMAGE_LONG_EDGE })),
    visionDescriptionPrompt: readValue(source, "visionDescriptionPrompt", fallback.visionDescriptionPrompt, issues, assertNonEmptyString),
    visionSlugPrompt: readValue(source, "visionSlugPrompt", fallback.visionSlugPrompt, issues, assertNonEmptyString),
    visionConcurrency: readValue(source, "visionConcurrency", fallback.visionConcurrency, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1, max: 32 })),
    visionTimeoutMs: readValue(source, "visionTimeoutMs", fallback.visionTimeoutMs, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 1000, max: 600000 })),
    visionMaxRetries: readValue(source, "visionMaxRetries", fallback.visionMaxRetries, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 10 })),
    visionInitialBackoffMs: readValue(source, "visionInitialBackoffMs", fallback.visionInitialBackoffMs, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 30000 })),
    writeSoftwareTag: readValue(source, "writeSoftwareTag", fallback.writeSoftwareTag, issues, assertBoolean),
    writeModifyDate: readValue(source, "writeModifyDate", fallback.writeModifyDate, issues, assertBoolean),
    workerPoolSize: readValue(source, "workerPoolSize", fallback.workerPoolSize, issues, validateWorkerPoolSize),
    previewLongEdge: readValue(source, "previewLongEdge", fallback.previewLongEdge, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 64, max: MAX_PREVIEW_LONG_EDGE })),
    assetPickerPreviewLongEdge: readValue(source, "assetPickerPreviewLongEdge", fallback.assetPickerPreviewLongEdge, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: MIN_ASSET_PICKER_PREVIEW_LONG_EDGE, max: MAX_ASSET_PICKER_PREVIEW_LONG_EDGE })),
    previewDebounceMs: readValue(source, "previewDebounceMs", fallback.previewDebounceMs, issues, (value, path) => assertFiniteNumber(value, path, { integer: true, min: 0, max: 5000 }))
  };

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

export function assertModelEndpoint(value: unknown, field: string): string {
  const endpoint = assertNonEmptyString(value, field);
  let url: URL;
  try { url = new URL(endpoint); }
  catch (error) { throw new Error(`${field} must be an HTTP(S) endpoint.`, { cause: error }); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must be an HTTP(S) endpoint without credentials, a query, or a fragment.`);
  }
  return endpoint;
}

function validateExtraModelIds(value: unknown, field: string): GlobalSettings["extraModelIds"] {
  const record = assertRecord(value, field);
  if (record.gemini === undefined) return {};
  if (!Array.isArray(record.gemini)) throw new Error(`${field}.gemini must be an array.`);
  return { gemini: record.gemini.map((id, index) => assertNonEmptyString(id, `${field}.gemini[${index}]`)) };
}
