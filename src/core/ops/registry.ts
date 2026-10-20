import type { OpDefinition } from "@shared/types/op";
import { isOpType, OP_TYPES, type OpType } from "@shared/op-types";
import type { OpModule } from "./op-module";
import { autoToneModule } from "./auto-tone";
import { blurModule } from "./blur";
import { coverModule } from "./cover";
import { cropModule } from "./crop";
import { curvesModule } from "./curves";
import { denoiseModule } from "./denoise";
import { flipModule } from "./flip";
import { hslModule } from "./hsl";
import { injectMetadataModule } from "./inject-metadata";
import { levelsModule } from "./levels";
import { lutModule } from "./lut";
import { mosaicModule } from "./mosaic";
import { resizeModule } from "./resize";
import { rotateModule } from "./rotate";
import { stampModule } from "./stamp";
import { stripMetadataModule } from "./strip-metadata";
import { unsharpMaskModule } from "./unsharp-mask";
import { watermarkImageModule } from "./watermark-image";
import { watermarkTextModule } from "./watermark-text";
import { whiteBalanceModule } from "./white-balance";

const modules: Readonly<Record<OpType, OpModule>> = {
  crop: cropModule as OpModule,
  rotate: rotateModule as OpModule,
  flip: flipModule as OpModule,
  resize: resizeModule as OpModule,
  levels: levelsModule as OpModule,
  "white-balance": whiteBalanceModule as OpModule,
  "auto-tone": autoToneModule as OpModule,
  curves: curvesModule as OpModule,
  hsl: hslModule as OpModule,
  "unsharp-mask": unsharpMaskModule as OpModule,
  denoise: denoiseModule as OpModule,
  lut: lutModule as OpModule,
  cover: coverModule as OpModule,
  blur: blurModule as OpModule,
  mosaic: mosaicModule as OpModule,
  stamp: stampModule as OpModule,
  "watermark-text": watermarkTextModule as OpModule,
  "watermark-image": watermarkImageModule as OpModule,
  "strip-metadata": stripMetadataModule as OpModule,
  "inject-metadata": injectMetadataModule as OpModule
};

export function getOpModule(type: string): OpModule | undefined {
  return isOpType(type) ? modules[type] : undefined;
}

export function requireOpModule(type: string): OpModule {
  const module = getOpModule(type);
  if (!module) {
    throw new Error(`Unknown op type "${type}".`);
  }
  return module;
}

export function getOpDefinition(type: string): OpDefinition | undefined {
  return getOpModule(type);
}

export function listOpModules(): OpModule[] {
  return OP_TYPES.map((type) => modules[type]);
}

export function listOpDefinitions(): OpDefinition[] {
  return listOpModules().map(({ type, category, defaultParams, previewBehavior, metadataOnly }) => ({
    type,
    category,
    defaultParams,
    previewBehavior,
    metadataOnly
  }));
}
