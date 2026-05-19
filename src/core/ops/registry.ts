import type { OpDefinition } from "@shared/types/op";
import type { OpModule } from "./op-module";

const modules = new Map<string, OpModule>();

export function registerOp<P extends Record<string, unknown>>(module: OpModule<P>): void {
  if (modules.has(module.type)) {
    throw new Error(`Duplicate op registration: ${module.type}`);
  }
  modules.set(module.type, module as OpModule);
}

export function getOpModule(type: string): OpModule | undefined {
  return modules.get(type);
}

export function requireOpModule(type: string): OpModule {
  const module = modules.get(type);
  if (!module) {
    throw new Error(`Unknown op type "${type}".`);
  }
  return module;
}

export function getOpDefinition(type: string): OpDefinition | undefined {
  return modules.get(type);
}

export function listOpModules(): OpModule[] {
  return [...modules.values()];
}

export function listOpDefinitions(): OpDefinition[] {
  return [...modules.values()].map(({ type, label, pickerLabel, category, defaultParams, previewBehavior }) => ({
    type,
    label,
    pickerLabel,
    category,
    defaultParams,
    previewBehavior
  }));
}
