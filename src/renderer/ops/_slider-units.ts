import type { Translator } from "@shared/i18n/translate";

const PERCENT_STEPS = 1000;

export function fractionToPercentSteps(value: number): number {
  return Math.round(value * PERCENT_STEPS);
}

export function percentStepsToFraction(value: number): number {
  return value / PERCENT_STEPS;
}

/** A fraction as a percentage to one decimal, formatted for the reader's locale. */
export function formatPercent(value: number, percent: Translator["percent"]): string {
  return percent(value, 1);
}
