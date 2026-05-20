export function sliderLongEdge(originalSize: { width: number; height: number } | null): number {
  return originalSize ? Math.max(originalSize.width, originalSize.height) : 1000;
}

export function fractionToPixels(value: number, longEdge: number): number {
  return Math.round(value * longEdge);
}

export function pixelsToFraction(value: number, longEdge: number): number {
  return value / longEdge;
}

export function onePixelStep(longEdge: number): number {
  return 1 / longEdge;
}

export function formatPixels(value: number, longEdge: number): string {
  return `${fractionToPixels(value, longEdge)}px`;
}
