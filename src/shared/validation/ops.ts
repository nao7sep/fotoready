import type { OpDefinition, OpInstance } from "../types/op";
import { assertBoolean, assertNonEmptyString, assertRecord } from "./common";

/**
 * A minimal capability the main side passes in so this shared validator can look up
 * each op's per-type validate() without depending on the registry directly. The renderer
 * never validates ops on its own; the main side calls these helpers as part of
 * `task.updateOpParam` / `updateOpParams`.
 */
export type OpValidatorLookup = (type: string) => OpValidator | undefined;

export type OpValidator = Pick<OpDefinition, "defaultParams"> & {
  validate(params: unknown): Record<string, unknown>;
};

export function validateOpInstance(value: unknown, lookup: OpValidatorLookup, path = "op"): OpInstance {
  const record = assertRecord(value, path);
  const type = assertNonEmptyString(record.type, `${path}.type`);
  const validator = lookup(type);
  if (!validator) {
    throw new Error(`${path}.type must reference a registered op. Received "${type}".`);
  }
  return {
    type,
    enabled: assertBoolean(record.enabled, `${path}.enabled`),
    params: validator.validate(record.params)
  };
}

export function applyOpParamChange(op: OpInstance, key: string, value: unknown, lookup: OpValidatorLookup): OpInstance {
  const validator = requireValidator(op.type, lookup);
  if (!Object.prototype.hasOwnProperty.call(validator.defaultParams, key)) {
    throw new Error(`Unknown ${op.type} param "${key}".`);
  }
  return validateOpInstance({ ...op, params: { ...op.params, [key]: value } }, lookup, `op "${op.type}"`);
}

export function applyOpParamPatch(op: OpInstance, patch: Record<string, unknown>, lookup: OpValidatorLookup): OpInstance {
  requireValidator(op.type, lookup);
  return validateOpInstance({ ...op, params: { ...op.params, ...patch } }, lookup, `op "${op.type}"`);
}

function requireValidator(type: string, lookup: OpValidatorLookup): OpValidator {
  const validator = lookup(type);
  if (!validator) {
    throw new Error(`Unknown op type "${type}".`);
  }
  return validator;
}
