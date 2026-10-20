// The value ranges an operation accepts. Core validation rejects a value outside them, and each
// card's slider spans the same range, so a control can never offer what a save would refuse.

export type Limits = { readonly min: number; readonly max: number };

/** A rotation in degrees: rotate, watermarks, stamps and HSL hue shifts. */
export const ANGLE_LIMITS: Limits = { min: -180, max: 180 };

export const WHITE_BALANCE_LIMITS: Limits = { min: -100, max: 100 };

/** Auto tone's shadow and highlight clipping, in percent of pixels. */
export const AUTO_TONE_CLIP_LIMITS: Limits = { min: 0, max: 10 };

/** An 8-bit channel value: curve points and levels' black and white points. */
export const CHANNEL_LIMITS: Limits = { min: 0, max: 255 };

/** Levels keeps the white point at least this far above the black point. */
export const MIN_LEVEL_SPAN = 1;

export const LEVELS_GAMMA_LIMITS: Limits = { min: 0.25, max: 4 };

/** HSL saturation and lightness shifts, as a fraction of the full range. */
export const HSL_AMOUNT_LIMITS: Limits = { min: -1, max: 1 };

export const HSL_RANGES = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type HslRange = (typeof HSL_RANGES)[number];

export const OUTPUT_QUALITY_LIMITS: Limits = { min: 1, max: 100 };

/** The smallest Gaussian sigma libvips blurs with; blur and sharpen radii below it act at it. */
export const MIN_BLUR_SIGMA = 0.3;
