import { clamp } from "@shared/numeric";
import type { GlobalSettings } from "@shared/types/settings";
import type { Original, Task } from "@shared/types/project";
import { applyOutputSettingChange } from "@shared/validation/pipeline";
import { resolveOutputFormat } from "@shared/output-format";
import { DEFAULT_ASSET_OVERLAY_WIDTH, clampAssetOverlay, type AssetOverlayParams } from "@shared/asset-overlay";
import type { BoxBounds } from "@shared/box-geometry";
import { readAssetAspectRatio } from "@core/ops/_asset-overlay";

/**
 * The pure output-settings and op-parameter defaulting that `ProjectSession`
 * threads through its task edits, lifted out of the session so the interacting
 * format/quality branches can be exercised directly. Nothing here touches the
 * session's mutable state; `initializeOpParamsForOriginal` is the one async
 * member, reading an overlay asset's aspect ratio off disk.
 */

export type TaskOutput = Task["pipeline"]["output"];

export function defaultTaskOutput(
  settings: GlobalSettings,
  originalFormat: string,
  fallback: TaskOutput
): TaskOutput {
  const format = settings.defaultOutputFormat;
  return {
    ...fallback,
    format,
    quality: defaultQualityForFormat(format, settings, originalFormat, fallback.quality),
    flattenTransparency: settings.defaultFlattenTransparency,
    jpegProgressive: settings.jpegProgressive,
    jpegChromaSubsampling: settings.jpegChromaSubsampling,
    webpMethod: settings.webpMethod,
    avifEffort: settings.avifEffort,
    pngPalette: settings.defaultPngPalette,
    backgroundForTransparency: settings.defaultBackgroundForTransparency
  };
}

export function nextTaskOutput(
  current: TaskOutput,
  key: string,
  value: unknown,
  settings: GlobalSettings,
  originalFormat: string
): TaskOutput {
  const nextOutput = applyOutputSettingChange(current, key, value);
  const resolvedFormat = resolveOutputFormat(nextOutput.format, originalFormat);
  if (key === "format") {
    return {
      ...nextOutput,
      quality: defaultQualityForFormat(nextOutput.format, settings, originalFormat, current.quality),
      flattenTransparency: resolvedFormat === "jpeg" ? true : nextOutput.flattenTransparency
    };
  }
  if (resolvedFormat !== "jpeg" || (nextOutput.quality === "auto" && originalFormat !== "jpeg")) {
    return {
      ...nextOutput,
      quality: defaultQualityForFormat(nextOutput.format, settings, originalFormat, current.quality),
      flattenTransparency: resolvedFormat === "jpeg" ? true : nextOutput.flattenTransparency
    };
  }
  return {
    ...nextOutput,
    flattenTransparency: resolvedFormat === "jpeg" ? true : nextOutput.flattenTransparency
  };
}

export function defaultQualityForFormat(
  format: TaskOutput["format"],
  settings: GlobalSettings,
  originalFormat: string,
  fallback: TaskOutput["quality"]
): TaskOutput["quality"] {
  const resolvedFormat = resolveOutputFormat(format, originalFormat);
  if (resolvedFormat === "webp") return settings.defaultWebpQuality;
  if (resolvedFormat === "avif") return settings.defaultAvifQuality;
  // png and tiff are lossless here, so quality never reaches the encoder — it is carried
  // only so switching back to a lossy format restores a sane number rather than a blank.
  // Named explicitly: without a tiff branch it fell into the JPEG path below and could
  // hand back "auto" for a jpeg source, a value that means nothing for a lossless format.
  if (resolvedFormat === "png" || resolvedFormat === "tiff") return typeof fallback === "number" ? fallback : 82;
  if (settings.enableJpegQualityEstimate && settings.jpegQualityMode === "auto" && originalFormat === "jpeg") return "auto";
  return settings.jpegFixedQuality;
}

export async function initializeOpParamsForOriginal(opType: string, params: Record<string, unknown>, original: Original): Promise<void> {
  const imageBounds = imageBoundsForOriginal(original);
  if (opType === "watermark-text") {
    if (
      typeof params.x !== "number"
      || typeof params.y !== "number"
      || typeof params.w !== "number"
      || typeof params.h !== "number"
    ) {
      return;
    }
    const w = clamp(params.w, 0.02, Math.max(0.02, imageBounds.maxX));
    const h = clamp(params.h, 0.02, Math.max(0.02, imageBounds.maxY));
    params.w = w;
    params.h = h;
    params.x = clamp(params.x, 0, Math.max(0, imageBounds.maxX - w));
    params.y = clamp(params.y, 0, Math.max(0, imageBounds.maxY - h));
    return;
  }
  if (opType !== "watermark-image" && opType !== "stamp") return;
  if (
    typeof params.assetPath !== "string"
    || typeof params.x !== "number"
    || typeof params.y !== "number"
    || typeof params.width !== "number"
    || typeof params.height !== "number"
    || typeof params.lockAspectRatio !== "boolean"
    || typeof params.opacity !== "number"
    || typeof params.rotation !== "number"
  ) {
    return;
  }
  const ar = params.assetPath ? await readAssetAspectRatio(params.assetPath as string) : 1;
  const width = DEFAULT_ASSET_OVERLAY_WIDTH;
  const height = width / Math.max(0.01, ar);
  Object.assign(params, clampAssetOverlay({ ...(params as unknown as AssetOverlayParams), width, height }, imageBounds));
}

export function imageBoundsForOriginal(original: Original): BoxBounds {
  const longEdge = Math.max(original.width, original.height, 1);
  return { maxX: original.width / longEdge, maxY: original.height / longEdge };
}
