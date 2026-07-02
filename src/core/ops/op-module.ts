import type * as sharp from "sharp";
import type { CubeLut } from "@runtime/lut-cube";
import type { OpDefinition } from "@shared/types/op";
import type { MetadataFields, MetadataStripMode } from "@shared/types/settings";

export type OpApplyContext = {
  sourceWidth: number;
  sourceHeight: number;
  resolveLut?: (cubePath: string) => Promise<CubeLut>;
};

export type ImageFrame = {
  image: sharp.Sharp;
  width: number;
  height: number;
};

/**
 * The unit of plug-and-play for an op. Everything the pipeline runner and the validator
 * need lives here. The renderer-side companion (card + overlay) lives at
 * `@renderer/ops/<name>.tsx` and is bridged via the shared `type` string.
 *
 * Metadata-only ops (strip-metadata, inject-metadata) skip `apply` — they participate in
 * the post-render metadata stage instead, via the helpers each module exports.
 */
export type OpModule<P extends Record<string, unknown> = Record<string, unknown>> = OpDefinition<P> & {
  /** Metadata-only ops (strip-metadata, inject-metadata) skip `apply`. */
  metadataOnly?: boolean;
  validate(params: unknown): P;
  apply?: (image: sharp.Sharp, params: P, ctx: OpApplyContext) => Promise<sharp.Sharp | ImageFrame> | sharp.Sharp | ImageFrame;
  /** Metadata-only ops mutate the running decision instead of touching pixels. */
  contributeMetadata?: (params: P, decision: MetadataDecision) => void;
};

/** Aggregated outcome of the metadata-only ops, consumed by processing.ts. */
export type MetadataDecision = {
  /** Set to true when any strip-metadata card is present and enabled. */
  stripActive: boolean;
  /** Groups to retain when stripActive is true. */
  keep: MetadataStripMode;
  inject: MetadataFields;
};
