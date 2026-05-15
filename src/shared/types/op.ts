export type OpInstance = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  enabled: boolean;
};

export type OpCategory = "Geometry" | "Tone" | "Effects" | "Redaction" | "Watermark" | "Metadata";

/** The renderer-safe description of an op. Lives in the IPC catalog. */
export type OpDefinition<TParams extends Record<string, unknown> = Record<string, unknown>> = {
  type: string;
  label: string;
  category: OpCategory;
  defaultParams: TParams;
  /**
   * "show-input" if the op exposes a canvas overlay that the user drags directly. The
   * preview shows the image *before* this op so the overlay rect lines up. Used today by
   * crop, redact-*, watermark-*, white-balance.
   *
   * "show-output" includes the op in the preview so slider changes appear live.
   */
  previewBehavior: "show-input" | "show-output";
};
