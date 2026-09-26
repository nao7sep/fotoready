import React from "react";
import { AlignLeft, Circle, CircleCheck, Clock, LoaderCircle, Pencil, Save, Tag, TriangleAlert, X } from "lucide-react";
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
  onDismissFailure(key: string): void;
  onRename(): void;
  onSaveAll(): void;
  onCancelAll(): void;
  onSelect(taskId: string): void;
}): React.JSX.Element {
  const { t } = useI18n();
  const hasPending = tasks.some((task) => task.status === "not-saved");
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
            <span className={`status-dot state-${taskVisualState(task)}`} aria-hidden="true"><StatusIndicator task={task} /></span>
            <span className="task-copy">
              <span className="row-title">{taskLabel(task, originals)}</span>
              <span className="row-detail">{t("tasks.opCount", { count: task.pipeline.ops.length })} · {t(taskStateLabel(task, queue))}</span>
            </span>
            {privacyWarnings[task.id] ? <PrivacyPill warning={privacyWarnings[task.id]} /> : null}
          </button>
        ))}
      </div>
      <div className="panel-footer">
        <button className="toolbar-button" type="button" onClick={onSaveAll} disabled={!hasPending}>
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

/**
 * The mark on a task row says what the task IS, in a shape that can be named without
 * a legend: nothing written yet, written, written with a description, written with a
 * slug, waiting, working, or wrong. It previously drew one circled dot for all four
 * result states and left the colour to tell them apart, which at this size read as a
 * clock face and said nothing; the row's own wording ("4 ops · Saved") stays the
 * spoken truth, and the colour still reinforces the shape.
 */
function StatusIndicator({ task }: { task: Task }): React.JSX.Element {
  const size = 14;
  if (task.error) return <TriangleAlert size={size} />;
  if (task.visionRunning || task.status === "processing") return <LoaderCircle size={size} />;
  if (task.status === "queued") return <Clock size={size} />;
  switch (taskVisualState(task)) {
    case "slug-generated":
      return <Tag size={size} />;
    case "description-generated":
      return <AlignLeft size={size} />;
    case "saved":
      return <CircleCheck size={size} />;
    default:
      return <Circle size={size} />;
  }
}

function taskLabel(task: Task, originals: Array<{ id: string; sourcePath: string }>): string {
  const original = originals.find((item) => item.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}
