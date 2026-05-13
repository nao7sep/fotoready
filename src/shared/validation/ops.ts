import type { OpDefinition, OpInstance } from "../types/op";
import { assertArray, assertBoolean, assertFiniteNumber, assertNonEmptyString, assertOneOf, assertRecord, assertString, isRecord } from "./common";

const anchors = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
const cropKeys = ["x", "y", "w", "h", "aspectLock"] as const;
const resizeModes = ["fit", "fill", "width", "height", "long-edge", "short-edge"] as const;
const hslRanges = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
const metadataFields = ["author", "copyright", "orientation", "colorspace"] as const;

type ResolvedOpDefinition = Pick<OpDefinition, "defaultParams">;

export type OpDefinitionResolver = (type: string) => ResolvedOpDefinition | undefined;

export function validateOpInstance(value: unknown, resolveDefinition: OpDefinitionResolver, path = "op"): OpInstance {
  const record = assertRecord(value, path);
  const type = assertNonEmptyString(record.type, `${path}.type`);
  const definition = resolveDefinition(type);
  if (!definition) {
    throw new Error(`${path}.type must reference a registered op. Received "${type}".`);
  }

  return {
    type,
    enabled: assertBoolean(record.enabled, `${path}.enabled`),
    params: validateOpParams(type, record.params, definition.defaultParams, `${path}.params`)
  };
}

export function applyOpParamChange(
  op: OpInstance,
  key: string,
  value: unknown,
  resolveDefinition: OpDefinitionResolver
): OpInstance {
  const definition = resolveDefinition(op.type);
  if (!definition) {
    throw new Error(`Unknown op type "${op.type}".`);
  }
  if (!Object.prototype.hasOwnProperty.call(definition.defaultParams, key)) {
    throw new Error(`Unknown ${op.type} param "${key}".`);
  }

  return validateOpInstance(
    {
      ...op,
      params: {
        ...op.params,
        [key]: value
      }
    },
    resolveDefinition,
    `op "${op.type}"`
  );
}

export function applyOpParamPatch(
  op: OpInstance,
  patch: Record<string, unknown>,
  resolveDefinition: OpDefinitionResolver
): OpInstance {
  return validateOpInstance(
    {
      ...op,
      params: {
        ...op.params,
        ...patch
      }
    },
    resolveDefinition,
    `op "${op.type}"`
  );
}

function validateOpParams(
  type: string,
  value: unknown,
  defaultParams: Record<string, unknown>,
  path: string
): Record<string, unknown> {
  const record = assertRecord(value, path);
  for (const key of Object.keys(record)) {
    if (!Object.prototype.hasOwnProperty.call(defaultParams, key)) {
      throw new Error(`${path}.${key} is not a recognized ${type} param.`);
    }
  }

  switch (type) {
    case "crop":
      return {
        x: assertFiniteNumber(record.x, `${path}.x`, { min: 0, max: 1 }),
        y: assertFiniteNumber(record.y, `${path}.y`, { min: 0, max: 1 }),
        w: assertFiniteNumber(record.w, `${path}.w`, { min: 0, max: 1, minExclusive: true }),
        h: assertFiniteNumber(record.h, `${path}.h`, { min: 0, max: 1, minExclusive: true }),
        aspectLock: validateAspectLock(record.aspectLock, `${path}.aspectLock`)
      };
    case "rotate":
      return {
        degrees: assertFiniteNumber(record.degrees, `${path}.degrees`, { min: -180, max: 180 }),
        fillColor: assertNonEmptyString(record.fillColor, `${path}.fillColor`)
      };
    case "resize":
      return {
        mode: assertOneOf(record.mode, `${path}.mode`, resizeModes),
        value: assertFiniteNumber(record.value, `${path}.value`, { integer: true, min: 1 }),
        interpolation: assertNonEmptyString(record.interpolation, `${path}.interpolation`)
      };
    case "levels":
      return validateLevels(record, path);
    case "white-balance":
      return {
        temperature: assertFiniteNumber(record.temperature, `${path}.temperature`, { min: -100, max: 100 }),
        tint: assertFiniteNumber(record.tint, `${path}.tint`, { min: -100, max: 100 })
      };
    case "auto-tone":
      return {
        enabled: assertBoolean(record.enabled, `${path}.enabled`),
        strength: assertFiniteNumber(record.strength, `${path}.strength`, { min: 0, max: 1 })
      };
    case "curves":
      return {
        rgb: validateCurvePoints(record.rgb, `${path}.rgb`)
      };
    case "hsl":
      return Object.fromEntries(
        hslRanges.map((range) => [range, validateHslRange(record[range], `${path}.${range}`)])
      );
    case "unsharp-mask":
      return {
        radius: assertFiniteNumber(record.radius, `${path}.radius`, { min: 0, minExclusive: true }),
        amount: assertFiniteNumber(record.amount, `${path}.amount`, { min: 0 }),
        threshold: assertFiniteNumber(record.threshold, `${path}.threshold`, { min: 0 }),
        outputSharpen: assertBoolean(record.outputSharpen, `${path}.outputSharpen`)
      };
    case "denoise":
      return {
        strength: assertFiniteNumber(record.strength, `${path}.strength`, { min: 0, max: 1 })
      };
    case "lut":
      return {
        cubePath: assertString(record.cubePath, `${path}.cubePath`),
        strength: assertFiniteNumber(record.strength, `${path}.strength`, { min: 0, max: 1 })
      };
    case "redact-fill":
      return {
        rects: validateRects(record.rects, `${path}.rects`),
        color: assertNonEmptyString(record.color, `${path}.color`)
      };
    case "redact-blur":
      return {
        rects: validateRects(record.rects, `${path}.rects`),
        radius: assertFiniteNumber(record.radius, `${path}.radius`, { min: 0, minExclusive: true })
      };
    case "redact-pixelate":
      return {
        rects: validateRects(record.rects, `${path}.rects`),
        blockSize: assertFiniteNumber(record.blockSize, `${path}.blockSize`, { min: 0, minExclusive: true })
      };
    case "watermark-text":
      return {
        text: assertString(record.text, `${path}.text`),
        anchor: assertOneOf(record.anchor, `${path}.anchor`, anchors),
        marginX: assertFiniteNumber(record.marginX, `${path}.marginX`, { min: 0, max: 1 }),
        marginY: assertFiniteNumber(record.marginY, `${path}.marginY`, { min: 0, max: 1 }),
        opacity: assertFiniteNumber(record.opacity, `${path}.opacity`, { min: 0, max: 1 }),
        font: assertNonEmptyString(record.font, `${path}.font`),
        size: assertFiniteNumber(record.size, `${path}.size`, { min: 0, max: 1, minExclusive: true }),
        color: assertNonEmptyString(record.color, `${path}.color`)
      };
    case "watermark-image":
      return {
        pngPath: assertString(record.pngPath, `${path}.pngPath`),
        anchor: assertOneOf(record.anchor, `${path}.anchor`, anchors),
        marginX: assertFiniteNumber(record.marginX, `${path}.marginX`, { min: 0, max: 1 }),
        marginY: assertFiniteNumber(record.marginY, `${path}.marginY`, { min: 0, max: 1 }),
        opacity: assertFiniteNumber(record.opacity, `${path}.opacity`, { min: 0, max: 1 }),
        scale: assertFiniteNumber(record.scale, `${path}.scale`, { min: 0, max: 1, minExclusive: true })
      };
    case "strip-metadata":
      return {
        keep: validateMetadataKeep(record.keep, `${path}.keep`)
      };
    case "inject-metadata":
      return {
        fields: validateStringMap(record.fields, `${path}.fields`)
      };
    default:
      throw new Error(`${path} has unsupported op type "${type}".`);
  }
}

function validateLevels(record: Record<string, unknown>, path: string): Record<string, unknown> {
  const blackPoint = assertFiniteNumber(record.blackPoint, `${path}.blackPoint`, { integer: true, min: 0, max: 254 });
  const whitePoint = assertFiniteNumber(record.whitePoint, `${path}.whitePoint`, { integer: true, min: 1, max: 255 });
  if (whitePoint <= blackPoint) {
    throw new Error(`${path}.whitePoint must be greater than ${path}.blackPoint.`);
  }
  return {
    blackPoint,
    whitePoint,
    gamma: assertFiniteNumber(record.gamma, `${path}.gamma`, { min: 0.1, max: 5 })
  };
}

function validateAspectLock(value: unknown, path: string): number | string | null {
  if (value === null) return null;
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  throw new Error(`${path} must be null, a non-empty string, or a positive number.`);
}

function validateCurvePoints(value: unknown, path: string): Array<[number, number]> {
  const points = assertArray(value, path).map((point, index) => {
    const tuple = assertArray(point, `${path}[${index}]`);
    if (tuple.length < 2) {
      throw new Error(`${path}[${index}] must contain two numeric values.`);
    }
    return [
      assertFiniteNumber(tuple[0], `${path}[${index}][0]`, { min: 0, max: 255 }),
      assertFiniteNumber(tuple[1], `${path}[${index}][1]`, { min: 0, max: 255 })
    ] as [number, number];
  });

  if (points.length < 2) {
    throw new Error(`${path} must contain at least two control points.`);
  }

  return points;
}

function validateHslRange(value: unknown, path: string): { hue: number; sat: number; lum: number } {
  const record = assertRecord(value, path);
  return {
    hue: assertFiniteNumber(record.hue, `${path}.hue`, { min: -180, max: 180 }),
    sat: assertFiniteNumber(record.sat, `${path}.sat`, { min: -1, max: 1 }),
    lum: assertFiniteNumber(record.lum, `${path}.lum`, { min: -1, max: 1 })
  };
}

function validateRects(value: unknown, path: string): Array<{ x: number; y: number; w: number; h: number }> {
  return assertArray(value, path).map((entry, index) => {
    const record = assertRecord(entry, `${path}[${index}]`);
    return {
      x: assertFiniteNumber(record.x, `${path}[${index}].x`, { min: 0, max: 1 }),
      y: assertFiniteNumber(record.y, `${path}[${index}].y`, { min: 0, max: 1 }),
      w: assertFiniteNumber(record.w, `${path}[${index}].w`, { min: 0, max: 1, minExclusive: true }),
      h: assertFiniteNumber(record.h, `${path}[${index}].h`, { min: 0, max: 1, minExclusive: true })
    };
  });
}

function validateMetadataKeep(value: unknown, path: string): Array<typeof metadataFields[number]> {
  return [...new Set(assertArray(value, path).map((field, index) => assertOneOf(field, `${path}[${index}]`, metadataFields)))];
}

function validateStringMap(value: unknown, path: string): Record<string, string> {
  const record = assertRecord(value, path);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, assertString(entry, `${path}.${key}`)])
  );
}
