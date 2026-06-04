import { describe, expect, it } from "vitest";
import {
  assertArray,
  assertBoolean,
  assertFiniteNumber,
  assertIsoTimestamp,
  assertNonEmptyString,
  assertNullableString,
  assertOneOf,
  assertRecord,
  assertString,
  isRecord
} from "@shared/validation/common";

describe("isRecord", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});

describe("assertRecord / assertArray", () => {
  it("returns the value when the shape matches", () => {
    const obj = { a: 1 };
    expect(assertRecord(obj, "x")).toBe(obj);
    const arr = [1, 2];
    expect(assertArray(arr, "x")).toBe(arr);
  });

  it("throws with the path on a mismatch", () => {
    expect(() => assertRecord([], "cfg")).toThrow(/cfg must be an object/);
    expect(() => assertArray({}, "cfg")).toThrow(/cfg must be an array/);
  });
});

describe("string assertions", () => {
  it("assertString / assertNonEmptyString", () => {
    expect(assertString("hi", "x")).toBe("hi");
    expect(() => assertString(3, "x")).toThrow(/must be a string/);
    expect(assertNonEmptyString("hi", "x")).toBe("hi");
    expect(() => assertNonEmptyString("   ", "x")).toThrow(/must not be empty/);
  });

  it("assertNullableString permits null", () => {
    expect(assertNullableString(null, "x")).toBeNull();
    expect(assertNullableString("hi", "x")).toBe("hi");
    expect(() => assertNullableString(3, "x")).toThrow(/must be a string/);
  });
});

describe("assertBoolean / assertOneOf", () => {
  it("assertBoolean", () => {
    expect(assertBoolean(true, "x")).toBe(true);
    expect(() => assertBoolean("true", "x")).toThrow(/must be a boolean/);
  });

  it("assertOneOf", () => {
    expect(assertOneOf("a", "x", ["a", "b"] as const)).toBe("a");
    expect(() => assertOneOf("c", "x", ["a", "b"] as const)).toThrow(/must be one of: a, b/);
  });
});

describe("assertFiniteNumber", () => {
  it("rejects non-finite values", () => {
    expect(() => assertFiniteNumber(NaN, "x")).toThrow(/finite number/);
    expect(() => assertFiniteNumber(Infinity, "x")).toThrow(/finite number/);
    expect(() => assertFiniteNumber("3", "x")).toThrow(/finite number/);
  });

  it("enforces integer", () => {
    expect(assertFiniteNumber(3, "x", { integer: true })).toBe(3);
    expect(() => assertFiniteNumber(3.5, "x", { integer: true })).toThrow(/must be an integer/);
  });

  it("enforces inclusive min/max", () => {
    expect(assertFiniteNumber(0, "x", { min: 0, max: 10 })).toBe(0);
    expect(assertFiniteNumber(10, "x", { min: 0, max: 10 })).toBe(10);
    expect(() => assertFiniteNumber(-1, "x", { min: 0 })).toThrow(/at least 0/);
    expect(() => assertFiniteNumber(11, "x", { max: 10 })).toThrow(/at most 10/);
  });

  it("enforces exclusive bounds", () => {
    expect(() => assertFiniteNumber(0, "x", { min: 0, minExclusive: true })).toThrow(/greater than 0/);
    expect(() => assertFiniteNumber(10, "x", { max: 10, maxExclusive: true })).toThrow(/less than 10/);
    expect(assertFiniteNumber(1, "x", { min: 0, minExclusive: true })).toBe(1);
  });
});

describe("assertIsoTimestamp", () => {
  it("accepts parseable timestamps and rejects junk", () => {
    expect(assertIsoTimestamp("2026-06-04T00:00:00.000Z", "x")).toBe("2026-06-04T00:00:00.000Z");
    expect(() => assertIsoTimestamp("not-a-date", "x")).toThrow(/ISO-8601/);
  });
});
