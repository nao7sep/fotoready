import { autoToneRenderer } from "./auto-tone";
import { cropRenderer } from "./crop";
import { curvesRenderer } from "./curves";
import { denoiseRenderer } from "./denoise";
import { flipRenderer } from "./flip";
import { hslRenderer } from "./hsl";
import { injectMetadataRenderer } from "./inject-metadata";
import { levelsRenderer } from "./levels";
import { lutRenderer } from "./lut";
import { redactBlurRenderer } from "./redact-blur";
import { redactFillRenderer } from "./redact-fill";
import { redactPixelateRenderer } from "./redact-pixelate";
import { resizeRenderer } from "./resize";
import { rotateRenderer } from "./rotate";
import { stripMetadataRenderer } from "./strip-metadata";
import { unsharpMaskRenderer } from "./unsharp-mask";
import { watermarkImageRenderer } from "./watermark-image";
import { watermarkTextRenderer } from "./watermark-text";
import { whiteBalanceRenderer } from "./white-balance";
import type { OpRenderer } from "./op-renderer";

const allRenderers: OpRenderer[] = [
  cropRenderer as OpRenderer,
  rotateRenderer as OpRenderer,
  flipRenderer as OpRenderer,
  resizeRenderer as OpRenderer,
  levelsRenderer as OpRenderer,
  whiteBalanceRenderer as OpRenderer,
  autoToneRenderer as OpRenderer,
  curvesRenderer as OpRenderer,
  hslRenderer as OpRenderer,
  unsharpMaskRenderer as OpRenderer,
  denoiseRenderer as OpRenderer,
  lutRenderer as OpRenderer,
  redactFillRenderer as OpRenderer,
  redactBlurRenderer as OpRenderer,
  redactPixelateRenderer as OpRenderer,
  watermarkTextRenderer as OpRenderer,
  watermarkImageRenderer as OpRenderer,
  stripMetadataRenderer as OpRenderer,
  injectMetadataRenderer as OpRenderer
];

const byType: Map<string, OpRenderer> = new Map(allRenderers.map((renderer) => [renderer.type, renderer]));

export function getOpRenderer(type: string): OpRenderer | undefined {
  return byType.get(type);
}

export function listOpRenderers(): OpRenderer[] {
  return [...allRenderers];
}

export type { OpRenderer, OpCardProps, OpOverlayProps, OverlayContext, OpCardContext } from "./op-renderer";
