export type ScalingKind = "absolute_px" | "fraction_of_long_edge" | "scale_invariant";

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
  paramScaling: Record<keyof TParams & string, ScalingKind>;
  schema: JsonSchema;
  visible: boolean;
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};
