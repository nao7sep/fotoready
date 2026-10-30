import React from "react";
import { Pencil, Save, X } from "lucide-react";
import type { PrivacyWarning, QueueSnapshot } from "@shared/types/ipc";
import type { Original, Task } from "@shared/types/project";
import { taskStateLabel, taskVisualState } from "@renderer/task-visual-state";
import { useListbox } from "@renderer/components/useListbox";
import { OwnedFailureList } from "@renderer/components/owned-failure-list";
import type { OwnedFailures } from "@renderer/owned-failures";
import { useI18n } from "@renderer/i18n/I18nContext";
import type { MessageKey } from "@shared/i18n/catalogues";

export function TasksPanel({
  activeTaskId,
  originals,
  queue,
  tasks,
  privacyWarnings,
  failures,
  saveBlockedTaskIds,
  onRename,
  onDismissFailure,
  onSaveAll,
  onCancelAll,
  onSelect
}: {
  activeTaskId: string | null;
  originals: Original[];
  queue: QueueSnapshot;
  tasks: Task[];
  privacyWarnings: Record<string, PrivacyWarning>;
  failures: OwnedFailures;
  saveBlockedTaskIds: ReadonlySet<string>;
  onDismissFailure(key: string): void;
  onRename(): void;
  onSaveAll(): void;
  onCancelAll(): void;
  onSelect(taskId: string): void;
}): React.JSX.Element {
  const { t } = useI18n();
  const originalsById = React.useMemo(() => new Map(originals.map((original) => [original.id, original])), [originals]);
  const hasPending = tasks.some((task) => task.status === "not-saved");
  const saveBlockedTask = tasks.find((task) => saveBlockedTaskIds.has(task.id)) ?? null;
  const hasQueued = queue.queued > 0;
  const listbox = useListbox({
    ids: tasks.map((task) => task.id),
    selectedId: activeTaskId,
    onSelect
  });

  return (
    <aside className="panel tasks-panel">
      <PanelHeader title={t("tasks.title")} />
      <OwnedFailureList className="panel-owned-failures" failures={failures} onDismiss={onDismissFailure} />
      <div className="list" aria-label={t("tasks.title")} {...listbox.listboxProps}>
        {tasks.length === 0 ? (
          <div className="empty-state">{t("tasks.empty")}</div>
        ) : tasks.map((task) => (
          <button
            className={`list-row task-row state-${taskVisualState(task)} ${activeTaskId === task.id ? "active" : ""}`}
            key={task.id}
            type="button"
            onClick={() => onSelect(task.id)}
            {...listbox.getOptionProps(task.id)}
          >
            <span className="task-copy">
              <span className="row-title">{taskLabel(task, originalsById)}</span>
              {/* The state is told in words, coloured by kind; no icon repeats it. */}
              <span className="row-detail">
                {t("tasks.opCount", { count: task.pipeline.ops.length })} · <span className={`task-state state-${taskVisualState(task)}`}>{t(taskStateLabel(task, queue))}</span>
              </span>
            </span>
            {privacyWarnings[task.id] ? <PrivacyPill warning={privacyWarnings[task.id]} /> : null}
          </button>
        ))}
      </div>
      <div className="panel-footer">
        {saveBlockedTask ? <span className="blocked-reason">{t("tasks.fixToSaveAll", { name: taskLabel(saveBlockedTask, originalsById) })}</span> : null}
        <button className="toolbar-button" type="button" onClick={onSaveAll} disabled={!hasPending || saveBlockedTask !== null}>
          <Save size={14} /> {t("tasks.saveAll")}
        </button>
        <button className="toolbar-button" type="button" onClick={onCancelAll} disabled={!hasQueued}>
          <X size={14} /> {t("tasks.cancelAll")}
        </button>
        <button className="toolbar-button" type="button" disabled={tasks.length === 0} onClick={onRename}>
          <Pencil size={14} /> {t("tasks.renameAll")}
        </button>
      </div>
    </aside>
  );
}

const PRIVACY_GROUP_LETTER: Record<PrivacyWarning["kept"][number], string> = {
  editorial: "E",
  dates: "T",
  gps: "G"
};

const PRIVACY_GROUP_LABEL: Record<PrivacyWarning["kept"][number], MessageKey> = {
  editorial: "privacy.editorial",
  dates: "privacy.dates",
  gps: "privacy.gps"
};

// The pill's letters are a code, the same in every language; the tooltip names each group.
function PrivacyPill({ warning }: { warning: PrivacyWarning }): React.JSX.Element {
  const { t, list } = useI18n();
  if (warning.inspectionFailed) {
    return <span className="task-privacy-pill" title={t("privacy.uncheckedDetail")}>{t("privacy.unchecked")}</span>;
  }
  const letters = warning.kept.map((group) => PRIVACY_GROUP_LETTER[group]).join("·");
  const tooltip = t("tasks.privacyKept", {
    groups: list(warning.kept.map((group) => t(PRIVACY_GROUP_LABEL[group], { letter: PRIVACY_GROUP_LETTER[group] })))
  });
  return (
    <span className="task-privacy-pill" title={tooltip}>
      {letters}
    </span>
  );
}

function PanelHeader({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
    </div>
  );
}

function taskLabel(task: Task, originals: ReadonlyMap<string, Original>): string {
  const original = originals.get(task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}
