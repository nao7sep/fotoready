export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

export function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }
  return value;
}

export function assertString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  return value;
}

export function assertNonEmptyString(value: unknown, path: string): string {
  const string = assertString(value, path);
  if (string.trim().length === 0) {
    throw new Error(`${path} must not be empty.`);
  }
  return string;
}

export function assertNullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return assertString(value, path);
}

export function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }
  return value;
}

export function assertOneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${path} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function assertFiniteNumber(
  value: unknown,
  path: string,
  options: {
    min?: number;
    max?: number;
    minExclusive?: boolean;
    maxExclusive?: boolean;
    integer?: boolean;
  } = {}
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }

  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${path} must be an integer.`);
  }

  if (options.min !== undefined) {
    const valid = options.minExclusive ? value > options.min : value >= options.min;
    if (!valid) {
      throw new Error(`${path} must be ${options.minExclusive ? "greater than" : "at least"} ${options.min}.`);
    }
  }

  if (options.max !== undefined) {
    const valid = options.maxExclusive ? value < options.max : value <= options.max;
    if (!valid) {
      throw new Error(`${path} must be ${options.maxExclusive ? "less than" : "at most"} ${options.max}.`);
    }
  }

  return value;
}

export function assertIsoTimestamp(value: unknown, path: string): string {
  const timestamp = assertString(value, path);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${path} must be an ISO-8601 timestamp string.`);
  }
  return timestamp;
}
