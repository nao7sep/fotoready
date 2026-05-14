export type OpInstance = {
  type: string;
  params: Record<string, unknown>;
  enabled: boolean;
};

export type OpDefinition<TParams extends Record<string, unknown> = Record<string, unknown>> = {
  type: string;
  label: string;
  category: "Geometry" | "Tone" | "Effects" | "Redaction" | "Watermark" | "Metadata" | "Output";
  defaultParams: TParams;
};
