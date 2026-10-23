import { getOpModule } from "@core/ops/registry";
import type { OpModule } from "@core/ops/op-module";

/** Returns a registered op for a test fixture, failing clearly when its type is misspelled. */
export function requireOpModule(type: string): OpModule {
  const module = getOpModule(type);
  if (!module) {
    throw new Error(`Unknown op type "${type}".`);
  }
  return module;
}
