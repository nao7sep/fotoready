export function sliderLongEdge(originalSize: { width: number; height: number } | null): number {
  return originalSize ? Math.max(originalSize.width, originalSize.height) : 1000;
}

const PERCENT_STEPS = 1000;

export function fractionToPercentSteps(value: number): number {
  return Math.round(value * PERCENT_STEPS);
}

export function percentStepsToFraction(value: number): number {
  return value / PERCENT_STEPS;
}

export function formatPercent(value: number): string {
  const percentage = Math.round(value * 1000) / 10;
  return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}
