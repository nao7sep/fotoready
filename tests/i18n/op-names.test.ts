import { describe, expect, it } from "vitest";
import { listOpDefinitions } from "@core/ops/catalog";
import { OP_NAME_LABELS, OP_PICKER_LABELS } from "@renderer/op-names";

// An op's name is looked up by its type, which the type checker cannot tie to the registry.
describe("op names", () => {
  const types = listOpDefinitions().map((definition) => definition.type).sort();

  it("names every registered op, and only those", () => {
    expect(Object.keys(OP_NAME_LABELS).sort()).toEqual(types);
  });

  it("gives short picker names only to registered ops", () => {
    expect(Object.keys(OP_PICKER_LABELS).filter((type) => !types.includes(type))).toEqual([]);
  });
});
