export const CONCEAL_SHAPES = ["rectangle", "ellipse"] as const;

export type ConcealShape = (typeof CONCEAL_SHAPES)[number];

export type ConcealRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  shape: ConcealShape;
};

export const DEFAULT_CONCEAL_REGION: ConcealRegion = {
  x: 0.1,
  y: 0.1,
  w: 0.25,
  h: 0.25,
  rotation: 0,
  shape: "rectangle"
};
