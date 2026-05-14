import type sharp from "sharp";
import type { CubeLut } from "@runtime/lut/cube";
import type { OpDefinition, OpInstance } from "@shared/types/op";
import type { MetadataFields, MetadataStripMode } from "@shared/types/settings";

export type OpApplyContext = {
  sourceWidth: number;
  sourceHeight: number;
  resolveLut?: (cubePath: string) => Promise<CubeLut>;
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
  apply?: (image: sharp.Sharp, params: P, ctx: OpApplyContext) => Promise<sharp.Sharp> | sharp.Sharp;
  /** Metadata-only ops mutate the running decision instead of touching pixels. */
  contributeMetadata?: (params: P, decision: MetadataDecision) => void;
};

/**
 * Reorder hook: ops can ask to run after resize even if they appear before it in the pipeline.
 * Today only `unsharp-mask` with `outputSharpen: true` uses this. If more uses appear,
 * consider whether the user should just place the op where they want it instead.
 */
export type OpReorderHint = "after-resize";

export function reorderHintFor(op: OpInstance): OpReorderHint | null {
  if (op.type === "unsharp-mask" && op.params.outputSharpen === true) {
    return "after-resize";
  }
  return null;
}

/** Aggregated outcome of the metadata-only ops, consumed by processing.ts. */
export type MetadataDecision = {
  keep: MetadataStripMode | null;
  inject: MetadataFields;
};
