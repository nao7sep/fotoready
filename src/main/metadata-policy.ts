import { getOpModule, type MetadataDecision } from "@core/ops/catalog";
import type { Task } from "@shared/types/project";
import type { GlobalSettings, MetadataFields, MetadataStripMode } from "@shared/types/settings";

export type MetadataPolicy = {
  /** When true, output is stripped to only the groups listed in `keep`. When false, source metadata is preserved (stale fields aside). */
  stripActive: boolean;
  keep: MetadataStripMode;
  injectFields: MetadataFields;
};

export function metadataPolicy(task: Task, settings: GlobalSettings): MetadataPolicy {
  const decision: MetadataDecision = {
    stripActive: false,
    keep: [],
    inject: {}
  };

  for (const op of task.pipeline.ops) {
    if (!op.enabled) continue;
    const module = getOpModule(op.type);
    module?.contributeMetadata?.(op.params, decision);
  }

  return {
    stripActive: decision.stripActive,
    keep: decision.keep,
    injectFields: decision.inject
  };
}
