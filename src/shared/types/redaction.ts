export const REDACTION_SHAPES = ["rectangle", "ellipse"] as const;

export type RedactionShape = (typeof REDACTION_SHAPES)[number];

export type RedactionRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  shape: RedactionShape;
};

export const DEFAULT_REDACTION_REGION: RedactionRegion = {
  x: 0.1,
  y: 0.1,
  w: 0.25,
  h: 0.25,
  rotation: 0,
  shape: "rectangle"
};
