import type React from "react";
import type { LutEntry } from "@shared/types/ipc";

export type OverlayPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export type OverlayContext = {
  imageSize: { width: number; height: number };
  longEdge: number;
  imageBounds: { maxX: number; maxY: number };
  placement: OverlayPlacement;
  stageSize: { width: number; height: number };
  originalAspectRatio: number | null;
  samplePixel(localX: number, localY: number): { r: number; g: number; b: number } | null;
};

export type OpCardContext = {
  luts: LutEntry[];
  originalSize: { width: number; height: number } | null;
};

export type OpCardProps<P extends Record<string, unknown>> = {
  params: P;
  disabled: boolean;
  ctx: OpCardContext;
  onParamChange<K extends keyof P>(key: K, value: P[K]): void;
  onParamsChange(patch: Partial<P>): void;
};

export type OpOverlayProps<P extends Record<string, unknown>> = {
  params: P;
  opId: string;
  selected: boolean;
  ctx: OverlayContext;
  onParamsChange(patch: Partial<P>): void;
};

export type ImageClickHandler<P extends Record<string, unknown>> = (
  localX: number,
  localY: number,
  params: P,
  ctx: OverlayContext,
  onParamsChange: (patch: Partial<P>) => void
) => void;

/**
 * Renderer-side companion to the main-side OpModule. Each op type owns one of these,
 * colocated in `@renderer/ops/<type>.tsx`. The catalog (`@renderer/ops/index.tsx`)
 * imports all renderers; ops-panel and editor-canvas look them up by op.type.
 */
export type OpRenderer<P extends Record<string, unknown> = Record<string, unknown>> = {
  type: string;
  Card: React.FC<OpCardProps<P>>;
  Overlay?: React.FC<OpOverlayProps<P>>;
  /** True if this op handles raw image clicks (e.g. white-balance sample point). */
  consumesImageClick?: boolean;
  onImageClick?: ImageClickHandler<P>;
};
