import type { OpDefinition } from "@shared/types/op";

const definitions = new Map<string, OpDefinition>();

export function registerOp(definition: OpDefinition): void {
  if (definitions.has(definition.type)) {
    throw new Error(`Duplicate op registration: ${definition.type}`);
  }

  definitions.set(definition.type, definition);
}

export function getOpDefinition(type: string): OpDefinition | undefined {
  return definitions.get(type);
}

export function listOpDefinitions(): OpDefinition[] {
  return [...definitions.values()];
}
