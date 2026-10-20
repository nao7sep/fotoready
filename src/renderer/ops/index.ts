import { autoToneRenderer } from "./auto-tone";
import { cropRenderer } from "./crop";
import { curvesRenderer } from "./curves";
import { denoiseRenderer } from "./denoise";
import { flipRenderer } from "./flip";
import { hslRenderer } from "./hsl";
import { injectMetadataRenderer } from "./inject-metadata";
import { levelsRenderer } from "./levels";
import { lutRenderer } from "./lut";
import { blurRenderer } from "./blur";
import { coverRenderer } from "./cover";
import { mosaicRenderer } from "./mosaic";
import { resizeRenderer } from "./resize";
import { rotateRenderer } from "./rotate";
import { stampRenderer } from "./stamp";
import { stripMetadataRenderer } from "./strip-metadata";
import { unsharpMaskRenderer } from "./unsharp-mask";
import { watermarkImageRenderer } from "./watermark-image";
import { watermarkTextRenderer } from "./watermark-text";
import { whiteBalanceRenderer } from "./white-balance";
import { isOpType, type OpType } from "@shared/op-types";
import type { OpRenderer } from "./op-renderer";

const renderers: Readonly<Record<OpType, OpRenderer>> = {
  crop: cropRenderer as OpRenderer,
  rotate: rotateRenderer as OpRenderer,
  flip: flipRenderer as OpRenderer,
  resize: resizeRenderer as OpRenderer,
  levels: levelsRenderer as OpRenderer,
  "white-balance": whiteBalanceRenderer as OpRenderer,
  "auto-tone": autoToneRenderer as OpRenderer,
  curves: curvesRenderer as OpRenderer,
  hsl: hslRenderer as OpRenderer,
  "unsharp-mask": unsharpMaskRenderer as OpRenderer,
  denoise: denoiseRenderer as OpRenderer,
  lut: lutRenderer as OpRenderer,
  cover: coverRenderer as OpRenderer,
  blur: blurRenderer as OpRenderer,
  mosaic: mosaicRenderer as OpRenderer,
  stamp: stampRenderer as OpRenderer,
  "watermark-text": watermarkTextRenderer as OpRenderer,
  "watermark-image": watermarkImageRenderer as OpRenderer,
  "strip-metadata": stripMetadataRenderer as OpRenderer,
  "inject-metadata": injectMetadataRenderer as OpRenderer
};

export function getOpRenderer(type: string): OpRenderer | undefined {
  return isOpType(type) ? renderers[type] : undefined;
}

export type { OpRenderer, OpCardProps, OpOverlayProps, OverlayContext, OpCardContext } from "./op-renderer";
