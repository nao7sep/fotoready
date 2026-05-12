import { PROJECT_VERSION } from "../constants";
import type { Project, Task, TaskError, TaskOutput, VisionResult } from "../types/project";
import type { ProjectSettings } from "../types/settings";
import { validatePipeline } from "./pipeline";
import type { OpDefinitionResolver } from "./ops";
import { assertArray, assertBoolean, assertFiniteNumber, assertIsoTimestamp, assertNonEmptyString, assertNullableString, assertOneOf, assertRecord, assertString, isRecord } from "./common";

const metadataFields = ["author", "copyright", "orientation", "colorspace"] as const;
const outputFormats = ["jpeg", "webp", "avif", "png"] as const;
const qualityKeywords = ["match-source-size", "match-source-quality"] as const;
const taskStatuses = ["draft", "pending", "processing", "done", "error"] as const;
const taskErrorStages = ["processing", "vision", "rename"] as const;
const descriptionSources = ["vision-then-none"] as const;
const sidecarLocations = ["in-project-file"] as const;

export function validateProjectData(value: unknown, resolveDefinition: OpDefinitionResolver, path = "project"): Project {
  const record = assertRecord(value, path);
  const version = assertFiniteNumber(record.version, `${path}.version`, { integer: true });
  if (version !== PROJECT_VERSION) {
    throw new Error(`${path}.version must equal ${PROJECT_VERSION}.`);
  }

  const originals = assertArray(record.originals, `${path}.originals`).map((entry, index) => validateOriginal(entry, `${path}.originals[${index}]`));
  const originalIds = new Set(originals.map((original) => original.id));
  const tasks = assertArray(record.tasks, `${path}.tasks`).map((entry, index) =>
    validateTask(entry, resolveDefinition, originalIds, `${path}.tasks[${index}]`)
  );

  return {
    version: PROJECT_VERSION,
    name: assertNonEmptyString(record.name, `${path}.name`),
    outputDir: assertNonEmptyString(record.outputDir, `${path}.outputDir`),
    settings: record.settings === undefined ? {} : validateProjectSettings(record.settings, `${path}.settings`),
    originals,
    tasks
  };
}

function validateOriginal(value: unknown, path: string): Project["originals"][number] {
  const record = assertRecord(value, path);
  return {
    id: assertNonEmptyString(record.id, `${path}.id`),
    sourcePath: assertNonEmptyString(record.sourcePath, `${path}.sourcePath`),
    sourceHash: assertNonEmptyString(record.sourceHash, `${path}.sourceHash`),
    size: assertFiniteNumber(record.size, `${path}.size`, { integer: true, min: 1 }),
    format: assertNonEmptyString(record.format, `${path}.format`),
    width: assertFiniteNumber(record.width, `${path}.width`, { integer: true, min: 1 }),
    height: assertFiniteNumber(record.height, `${path}.height`, { integer: true, min: 1 }),
    addedAt: assertIsoTimestamp(record.addedAt, `${path}.addedAt`)
  };
}

function validateTask(
  value: unknown,
  resolveDefinition: OpDefinitionResolver,
  originalIds: Set<string>,
  path: string
): Task {
  const record = assertRecord(value, path);
  const originalId = assertNonEmptyString(record.originalId, `${path}.originalId`);
  if (!originalIds.has(originalId)) {
    throw new Error(`${path}.originalId must reference an existing original.`);
  }

  const status = assertOneOf(record.status, `${path}.status`, taskStatuses);
  const output = record.output === null ? null : validateTaskOutput(record.output, `${path}.output`);
  if (status === "done" && output === null) {
    throw new Error(`${path}.output must be present when ${path}.status is "done".`);
  }

  const error = record.error === null ? null : validateTaskError(record.error, `${path}.error`);
  if (status === "error" && error === null) {
    throw new Error(`${path}.error must be present when ${path}.status is "error".`);
  }

  return {
    id: assertNonEmptyString(record.id, `${path}.id`),
    originalId,
    analyzeContent: assertBoolean(record.analyzeContent, `${path}.analyzeContent`),
    outputFormatOverride: record.outputFormatOverride === null
      ? null
      : assertOneOf(record.outputFormatOverride, `${path}.outputFormatOverride`, outputFormats),
    outputQualityOverride: record.outputQualityOverride === null
      ? null
      : validateQuality(record.outputQualityOverride, `${path}.outputQualityOverride`),
    metadataStripOverride: record.metadataStripOverride === null
      ? null
      : validateMetadataStrip(record.metadataStripOverride, `${path}.metadataStripOverride`),
    customSlug: record.customSlug === null ? null : assertString(record.customSlug, `${path}.customSlug`),
    pipeline: validatePipeline(record.pipeline, resolveDefinition, `${path}.pipeline`),
    status,
    output,
    error,
    createdAt: assertIsoTimestamp(record.createdAt, `${path}.createdAt`),
    updatedAt: assertIsoTimestamp(record.updatedAt, `${path}.updatedAt`)
  };
}

function validateTaskOutput(value: unknown, path: string): TaskOutput {
  const record = assertRecord(value, path);
  return {
    stagedPath: assertNonEmptyString(record.stagedPath, `${path}.stagedPath`),
    stagedAt: assertIsoTimestamp(record.stagedAt, `${path}.stagedAt`),
    outputHash: assertNonEmptyString(record.outputHash, `${path}.outputHash`),
    vision: record.vision === null ? null : validateVisionResult(record.vision, `${path}.vision`),
    finalPath: assertNullableString(record.finalPath, `${path}.finalPath`),
    renamedAt: assertNullableString(record.renamedAt, `${path}.renamedAt`)
  };
}

function validateVisionResult(value: unknown, path: string): VisionResult {
  const record = assertRecord(value, path);
  return {
    description: assertNonEmptyString(record.description, `${path}.description`),
    slugCandidates: assertArray(record.slugCandidates, `${path}.slugCandidates`).map((entry, index) =>
      assertNonEmptyString(entry, `${path}.slugCandidates[${index}]`)
    ),
    model: assertNonEmptyString(record.model, `${path}.model`),
    ranAt: assertIsoTimestamp(record.ranAt, `${path}.ranAt`)
  };
}

function validateTaskError(value: unknown, path: string): TaskError {
  const record = assertRecord(value, path);
  return {
    stage: assertOneOf(record.stage, `${path}.stage`, taskErrorStages),
    message: assertNonEmptyString(record.message, `${path}.message`),
    detail: assertNullableString(record.detail, `${path}.detail`),
    occurredAt: assertIsoTimestamp(record.occurredAt, `${path}.occurredAt`),
    retryable: assertBoolean(record.retryable, `${path}.retryable`)
  };
}

function validateProjectSettings(value: unknown, path: string): ProjectSettings {
  const record = assertRecord(value, path);
  const settings: ProjectSettings = {};

  if (record.defaultOutputFormat !== undefined) {
    settings.defaultOutputFormat = assertOneOf(record.defaultOutputFormat, `${path}.defaultOutputFormat`, outputFormats);
  }
  if (record.defaultWebpQuality !== undefined) {
    settings.defaultWebpQuality = assertFiniteNumber(record.defaultWebpQuality, `${path}.defaultWebpQuality`, { integer: true, min: 1, max: 100 });
  }
  if (record.defaultAvifQuality !== undefined) {
    settings.defaultAvifQuality = assertFiniteNumber(record.defaultAvifQuality, `${path}.defaultAvifQuality`, { integer: true, min: 1, max: 100 });
  }
  if (record.defaultPngPalette !== undefined) {
    settings.defaultPngPalette = assertBoolean(record.defaultPngPalette, `${path}.defaultPngPalette`);
  }
  if (record.defaultMetadataStrip !== undefined) {
    settings.defaultMetadataStrip = validateMetadataStrip(record.defaultMetadataStrip, `${path}.defaultMetadataStrip`);
  }
  if (record.defaultAnalyzeContent !== undefined) {
    settings.defaultAnalyzeContent = assertBoolean(record.defaultAnalyzeContent, `${path}.defaultAnalyzeContent`);
  }
  if (record.defaultBackgroundForTransparency !== undefined) {
    settings.defaultBackgroundForTransparency = assertNonEmptyString(record.defaultBackgroundForTransparency, `${path}.defaultBackgroundForTransparency`);
  }
  if (record.injectAuthorCopyright !== undefined) {
    settings.injectAuthorCopyright = assertBoolean(record.injectAuthorCopyright, `${path}.injectAuthorCopyright`);
  }
  if (record.preserveSourceDates !== undefined) {
    settings.preserveSourceDates = assertBoolean(record.preserveSourceDates, `${path}.preserveSourceDates`);
  }
  if (record.descriptionSource !== undefined) {
    settings.descriptionSource = assertOneOf(record.descriptionSource, `${path}.descriptionSource`, descriptionSources);
  }
  if (record.injectFields !== undefined) {
    settings.injectFields = validateStringMap(record.injectFields, `${path}.injectFields`);
  }
  if (record.defaultTemplateId !== undefined) {
    settings.defaultTemplateId = assertNonEmptyString(record.defaultTemplateId, `${path}.defaultTemplateId`);
  }
  if (record.defaultOutputDirectory !== undefined) {
    settings.defaultOutputDirectory = assertNonEmptyString(record.defaultOutputDirectory, `${path}.defaultOutputDirectory`);
  }
  if (record.sidecarLocation !== undefined) {
    settings.sidecarLocation = assertOneOf(record.sidecarLocation, `${path}.sidecarLocation`, sidecarLocations);
  }
  if (record.lutFolder !== undefined) {
    settings.lutFolder = assertNonEmptyString(record.lutFolder, `${path}.lutFolder`);
  }
  if (record.defaultWatermarkImage !== undefined) {
    settings.defaultWatermarkImage = assertString(record.defaultWatermarkImage, `${path}.defaultWatermarkImage`);
  }
  if (record.projectContext !== undefined) {
    settings.projectContext = assertString(record.projectContext, `${path}.projectContext`);
  }
  if (record.lastProjectPath !== undefined) {
    settings.lastProjectPath = assertNullableString(record.lastProjectPath, `${path}.lastProjectPath`);
  }

  return settings;
}

function validateMetadataStrip(value: unknown, path: string): Array<typeof metadataFields[number]> {
  return [...new Set(assertArray(value, path).map((field, index) => assertOneOf(field, `${path}[${index}]`, metadataFields)))];
}

function validateQuality(value: unknown, path: string): number | typeof qualityKeywords[number] {
  if (typeof value === "string") {
    return assertOneOf(value, path, qualityKeywords);
  }
  return assertFiniteNumber(value, path, { integer: true, min: 1, max: 100 });
}

function validateStringMap(value: unknown, path: string): Record<string, string> {
  const record = assertRecord(value, path);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, assertString(entry, `${path}.${key}`)])
  );
}
