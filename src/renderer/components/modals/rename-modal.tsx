import React, { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot, RenamePreview, RenamePreviewItem, RenameRunResult } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";
import { builtinRenameTemplates, DEFAULT_RENAME_TEMPLATE_ID, type RenameTemplateId } from "@shared/rename-template";
import { missingSlugLabel, missingSlugVisualState, renameIssueLabel, renameItemStateLabel, renameItemVisualState } from "@renderer/task-visual-state";
import { useImeGuard } from "@renderer/utils/ime-guard";
import { OperationResult } from "@renderer/components/operation-result";
import { presentFailure } from "@renderer/present-failure";
import type { OwnedActionOutcome } from "@renderer/owned-failures";
import { ModalShell } from "./modal-shell";
import { useI18n } from "@renderer/i18n/I18nContext";
import type { MessageKey } from "@shared/i18n/catalogues";
import { message, type Message } from "@shared/i18n/translate";
import { normalizeSlugCandidate } from "@shared/slug-rules";
import { useConfirmer } from "./confirmer";

type SlugDraft = { value: string; committed: string };
const normalizedSlug = (value: string): string => normalizeSlugCandidate(value.trim());
const slugDraftDirty = (draft: SlugDraft): boolean => normalizedSlug(draft.value) !== normalizedSlug(draft.committed);

export type RenameRunSummary = {
  renamed: Array<{ from: string; to: string }>;
  skipped: string[];
};

type RenameFailure = {
  message: Message;
  settingsRecovery?: boolean;
  warning?: boolean;
};

const TEMPLATE_NAMES: Record<RenameTemplateId, MessageKey> = {
  "builtin-slug-size": "rename.templateName.slugSize",
  "builtin-slug": "rename.templateName.slug",
  "builtin-original-size": "rename.templateName.originalSize",
  "builtin-original": "rename.templateName.original"
};

export function RenameModal({
  projectSnapshot,
  outputDirLabel,
  outputDirPath,
  onClearOutputDir,
  onClose,
  onOpenSettings,
  onPreview,
  onRegenerateSlug,
  onRun,
  onSetRenameSlug,
  onSetOutputDir
}: {
  projectSnapshot: ProjectSnapshot;
  outputDirLabel: string;
  outputDirPath: string | null;
  onClearOutputDir(): Promise<void | OwnedActionOutcome>;
  onClose(): void;
  onOpenSettings(): void;
  onPreview(templateId: RenameTemplateId): Promise<RenamePreview>;
  onRegenerateSlug(taskId: string): Promise<boolean>;
  onRun(templateId: RenameTemplateId, summary: RenameRunSummary): Promise<Pick<RenameRunResult, "status" | "warnings">>;
  onSetRenameSlug(taskId: string, customSlug: string | null): Promise<void>;
  onSetOutputDir(): Promise<void | OwnedActionOutcome>;
}): React.JSX.Element {
  const { t } = useI18n();
  const confirmer = useConfirmer();
  // Text belongs to this editing session, including while rows refresh or a template hides them.
  const [slugDrafts, setSlugDrafts] = useState<Record<string, SlugDraft>>({});
  const [templateId, setTemplateId] = useState<RenameTemplateId>(DEFAULT_RENAME_TEMPLATE_ID);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewCurrent, setPreviewCurrent] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const runBusyRef = useRef(false);
  const [actionTaskIds, setActionTaskIds] = useState<string[]>([]);
  const pendingActions = useRef(new Set<string>());
  const closing = useRef(false);
  const [failures, setFailures] = useState<Record<string, RenameFailure>>({});
  const modalBusy = runBusy;
  const hasPendingSlugDrafts = Object.values(slugDrafts).some(slugDraftDirty);
  const tasksById = new Map(projectSnapshot.project.tasks.map((task) => [task.id, task]));
  // A file being described is read by the description while it runs, so Run waits for it, as its row does.
  const describing = Boolean(preview?.items.some((item) => tasksById.get(item.taskId)?.visionRunning));
  const canRun = Boolean(
    previewCurrent && preview?.items.some((item) => item.status === "ready")
    && preview.blockedCount === 0
    && !hasPendingSlugDrafts
    && !describing
  );
  const globalFailures = Object.entries(failures).filter(([key]) => !key.includes("\0"));

  function clearFailure(key: string): void {
    setFailures((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function retainFailure(key: string, failure: RenameFailure): void {
    setFailures((current) => ({ ...current, [key]: failure }));
  }

  useEffect(() => {
    if (!preview) return;
    setSlugDrafts((current) => {
      const next: Record<string, SlugDraft> = {};
      for (const item of preview.items) {
        const draft = current[item.taskId];
        if (!draft) continue;
        const committed = item.customSlug ?? "";
        // Snapshots can expose an optimistic write that later fails. Only this row's
        // successful action acknowledges its draft; clean idle rows follow previews.
        next[item.taskId] = slugDraftDirty(draft) || pendingActions.current.has(item.taskId)
          ? draft : { value: committed, committed };
      }
      return next;
    });
  }, [preview]);

  async function requestClose(close: () => void = onClose): Promise<void> {
    if (runBusyRef.current || pendingActions.current.size > 0 || closing.current) return;
    closing.current = true;
    try {
      if (Object.values(slugDrafts).some(slugDraftDirty) && !await confirmer.confirm({
        title: t("confirm.discardSettings.title"), message: t("confirm.discardSettings.message"),
        confirmLabel: t("common.discard"), cancelLabel: t("common.keepEditing"), danger: true
      })) return;
      close();
    } finally { closing.current = false; }
  }

  function startAction(taskId: string): void {
    pendingActions.current.add(taskId);
    setActionTaskIds([...pendingActions.current]);
  }
  function finishAction(taskId: string): void {
    pendingActions.current.delete(taskId);
    setActionTaskIds([...pendingActions.current]);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadPreview(): Promise<void> {
      setPreviewBusy(true);
      setPreviewCurrent(false);
      clearFailure("preview");
      await onPreview(templateId)
      .then((result) => {
        if (!cancelled) { setPreview(result); setPreviewCurrent(true); }
      })
      .catch((caught: unknown) => {
        if (!cancelled) retainFailure("preview", {
          message: presentFailure(caught, message("failure.renamePreview"), "renderer rename preview failed")
        });
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [projectSnapshot, templateId, outputDirPath]);

  async function confirm(): Promise<void> {
    if (runBusyRef.current) return;
    runBusyRef.current = true;
    setRunBusy(true);
    clearFailure("run");
    try {
      const outcome = await onRun(templateId, preview ? renameRunSummary(preview) : { renamed: [], skipped: [] });
      if (outcome.status === "stopped") {
        retainFailure("run", { message: message("failure.renameStopped") });
        for (const [index, warning] of outcome.warnings.entries()) retainFailure(`cleanup:${index}`, { message: warning, warning: true });
        runBusyRef.current = false;
        setRunBusy(false);
      }
    } catch (caught) {
      retainFailure("run", {
        message: presentFailure(caught, message("failure.renameStopped"), "renderer rename failed")
      });
      runBusyRef.current = false;
      setRunBusy(false);
    }
  }

  async function updateOutputDirectory(
    action: () => Promise<void | OwnedActionOutcome>,
    operation: string,
    userMessage: Message
  ): Promise<void> {
    try {
      const outcome = await action();
      if (outcome !== "cancelled") clearFailure("output-directory");
    } catch (caught) {
      retainFailure("output-directory", { message: presentFailure(caught, userMessage, operation) });
    }
  }

  return (
    <ModalShell
      title={t("rename.title")}
      size="wide"
      tall
      closeDisabled={runBusy || actionTaskIds.length > 0}
      onClose={() => void requestClose()}
      footer={
        <>
          <button className="toolbar-button" type="button" disabled={runBusy || actionTaskIds.length > 0} onClick={() => void requestClose()}>{t("common.cancel")}</button>
          <button className="primary-action" type="button" disabled={modalBusy || previewBusy || actionTaskIds.length > 0 || !canRun} onClick={() => void confirm()}>
            {t("rename.run")}
          </button>
        </>
      }
    >
      <div className="rename-output-dir">
        <div className="rename-output-dir-copy">
          <span className="rename-output-dir-label">{t("rename.outputFolder")}</span>
          <span className="rename-output-dir-value" title={outputDirPath ?? ""}>{outputDirLabel}</span>
        </div>
        <button className="toolbar-button compact-text" disabled={modalBusy} type="button" onClick={() => void updateOutputDirectory(
          onSetOutputDir,
          "renderer rename output folder selection failed",
          message("failure.outputFolderChange")
        )}>{outputDirPath ? t("common.change") : t("common.choose")}</button>
        {outputDirPath ? <button className="toolbar-button compact-text" disabled={modalBusy} type="button" onClick={() => void updateOutputDirectory(
          onClearOutputDir,
          "renderer rename output folder clear failed",
          message("failure.outputFolderClear")
        )}>{t("common.clear")}</button> : null}
      </div>

      <label className="stacked-field">
        {t("rename.template")}
        <select disabled={modalBusy} value={templateId} onChange={(event) => setTemplateId(event.currentTarget.value as RenameTemplateId)}>
          {builtinRenameTemplates.map((template) => (
            <option key={template.id} value={template.id}>{t(TEMPLATE_NAMES[template.id])}</option>
          ))}
        </select>
      </label>

      {preview?.blockedCount ? (
        <OperationResult className="modal-warning" severity="warning">
          {t("rename.blocked", { count: preview.blockedCount })}
        </OperationResult>
      ) : null}

      {globalFailures.map(([key, failure]) => (
        <RenameFailureNotice
          disabled={runBusy}
          failure={failure}
          key={key}
          onDismiss={() => clearFailure(key)}
          onOpenSettings={() => void requestClose(onOpenSettings)}
        />
      ))}

      <div className="rename-preview-list">
        {preview?.items.length ? preview.items.map((item) => (
          <RenamePreviewRow
            actionBusy={actionTaskIds.includes(item.taskId)}
            disabled={modalBusy}
            item={item}
            slugDraft={slugDrafts[item.taskId]?.value ?? item.customSlug ?? ""}
            draftDirty={Boolean(slugDrafts[item.taskId] && slugDraftDirty(slugDrafts[item.taskId]))}
            onChangeSlug={(value) => setSlugDrafts((current) => ({ ...current, [item.taskId]: { value, committed: current[item.taskId]?.committed ?? item.customSlug ?? "" } }))}
            key={item.taskId}
            task={tasksById.get(item.taskId)}
            failures={Object.entries(failures).filter(([key]) => key.startsWith(`${item.taskId}\0`))}
            onDismissFailure={clearFailure}
            onOpenSettings={() => void requestClose(onOpenSettings)}
            onRegenerateSlug={async (taskId) => {
              const key = renameTaskFailureKey(taskId, "generate");
              const submittedDraft = slugDrafts[taskId];
              startAction(taskId);
              clearFailure(key);
              try {
                const completed = await onRegenerateSlug(taskId);
                if (completed) setSlugDrafts((current) => {
                  if (!submittedDraft || current[taskId] !== submittedDraft) return current;
                  const next = { ...current };
                  delete next[taskId];
                  return next;
                });
              } catch (caught) {
                retainFailure(key, {
                  message: presentFailure(caught, message("failure.regenerateSlug"), "renderer rename slug generation failed", { taskId }),
                  settingsRecovery: true
                });
              } finally {
                finishAction(taskId);
              }
            }}
            onSetRenameSlug={async (taskId, customSlug) => {
              const key = renameTaskFailureKey(taskId, "save");
              startAction(taskId);
              clearFailure(key);
              try {
                await onSetRenameSlug(taskId, customSlug);
                setSlugDrafts((current) => {
                  const draft = current[taskId];
                  if (!draft) return current;
                  const committed = normalizedSlug(customSlug ?? "");
                  return { ...current, [taskId]: { value: normalizedSlug(draft.value) === committed ? committed : draft.value, committed } };
                });
              } catch (caught) {
                retainFailure(key, {
                  message: presentFailure(caught, message("failure.renameSlugSave"), "renderer rename slug save failed", { taskId })
                });
              } finally {
                finishAction(taskId);
              }
            }}
            showSlugEditor={Boolean(preview.usesSlug && item.currentPath)}
          />
        )) : (
          <div className="ops-empty">{previewBusy ? t("rename.preparing") : t("rename.noTasks")}</div>
        )}
      </div>
    </ModalShell>
  );
}

function RenamePreviewRow({
  actionBusy,
  disabled,
  failures,
  item,
  onDismissFailure,
  onOpenSettings,
  task,
  slugDraft,
  draftDirty,
  onChangeSlug,
  onRegenerateSlug,
  onSetRenameSlug,
  showSlugEditor
}: {
  actionBusy: boolean;
  disabled: boolean;
  failures: Array<[string, RenameFailure]>;
  item: RenamePreviewItem;
  onDismissFailure(key: string): void;
  onOpenSettings(): void;
  task: Task | undefined;
  slugDraft: string;
  draftDirty: boolean;
  onChangeSlug(value: string): void;
  onRegenerateSlug(taskId: string): Promise<void>;
  onSetRenameSlug(taskId: string, customSlug: string | null): Promise<void>;
  showSlugEditor: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const skipBlurCommitRef = useRef(false);
  const ime = useImeGuard();

  const draftSlug = slugDraft.trim();
  const draftEmpty = showSlugEditor && draftSlug.length === 0;
  const previewVisualState = renameItemVisualState(task, item);
  const visualState = draftEmpty ? missingSlugVisualState(task) : previewVisualState;
  const stateText = t(draftEmpty
    ? missingSlugLabel(visualState)
    : draftDirty
      ? "rename.editingSlug"
      : renameItemStateLabel(previewVisualState, item));
  const rowDisabled = disabled || actionBusy || Boolean(task?.visionRunning);

  async function commitSlugDraft(): Promise<void> {
    if (!draftDirty) return;
    await onSetRenameSlug(item.taskId, draftSlug.length > 0 ? draftSlug : null);
  }

  return (
    <div className={`rename-preview-row ${item.status}${showSlugEditor ? "" : " no-side"}`} key={item.taskId}>
      <div className="rename-preview-main">
        {/* The state is told in words, coloured by kind; no mark repeats it. */}
        <span className={`rename-preview-state state-${visualState}`}>{stateText}</span>
        <span className="rename-preview-title" title={item.proposedPath ?? ""}>{item.proposedName ?? (item.status === "not-saved" ? t("rename.notSavedYet") : t(item.issue ? renameIssueLabel(item.issue) : "rename.unavailable"))}</span>
        <span className="rename-preview-meta" title={item.currentPath ?? ""}>
          <span className="rename-preview-meta-label">{t("rename.current")}</span>
          <span>{item.currentName ?? t("taskState.notSaved")}</span>
        </span>
        <span className="rename-preview-meta" title={item.originalName}>
          <span className="rename-preview-meta-label">{t("rename.original")}</span>
          <span>{item.originalName}</span>
        </span>
      </div>
      <div className={`rename-preview-side${showSlugEditor ? "" : " hidden"}`}>
        {showSlugEditor ? (
          <div className="rename-preview-slug-editor">
            <input
              className="rename-preview-slug-input"
              disabled={rowDisabled}
              placeholder={t("output.slugPlaceholder")}
              type="text"
              value={slugDraft}
              {...ime.compositionProps}
              onBlur={() => {
                if (skipBlurCommitRef.current) {
                  skipBlurCommitRef.current = false;
                  return;
                }
                void commitSlugDraft();
              }}
              onChange={(event) => onChangeSlug(event.currentTarget.value)}
              onKeyDown={(event) => {
                // Enter that ends an IME composition accepts the candidate; it must not commit.
                if (event.key !== "Enter" || ime.isComposing(event)) return;
                event.preventDefault();
                void commitSlugDraft();
              }}
            />
            <button
              className="inline-action rename-preview-slug-action"
              disabled={rowDisabled}
              type="button"
              onMouseDown={() => {
                skipBlurCommitRef.current = true;
              }}
              onClick={() => void onRegenerateSlug(item.taskId)}
            >
              {t(actionBusy ? (item.generatedSlug ? "rename.regenerating" : "rename.generating") : item.generatedSlug ? "rename.regenerate" : "rename.generate")}
            </button>
            {failures.map(([key, failure]) => (
              <RenameFailureNotice
                disabled={disabled}
                failure={failure}
                key={key}
                onDismiss={() => onDismissFailure(key)}
                onOpenSettings={onOpenSettings}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RenameFailureNotice({
  disabled,
  failure,
  onDismiss,
  onOpenSettings
}: {
  disabled: boolean;
  failure: RenameFailure;
  onDismiss(): void;
  onOpenSettings(): void;
}): React.JSX.Element {
  const { t, text } = useI18n();
  return (
    <OperationResult className="modal-error" dismissLabel={t("rename.closeResult")} severity={failure.warning ? "warning" : "error"} onDismiss={onDismiss}>
      <span>{text(failure.message)}</span>
      {failure.settingsRecovery ? (
        <button className="toolbar-button compact-text" type="button" disabled={disabled} onClick={onOpenSettings}>
          {t("common.openSettings")}
        </button>
      ) : null}
    </OperationResult>
  );
}

function renameTaskFailureKey(taskId: string, action: "generate" | "save"): string {
  return `${taskId}\0${action}`;
}

function renameRunSummary(preview: RenamePreview): RenameRunSummary {
  return {
    renamed: preview.items
      .flatMap((item) => item.status === "ready" && item.currentName && item.proposedName
        ? [{ from: item.currentName, to: item.proposedName }]
        : []),
    skipped: preview.items
      .flatMap((item) => {
        if (item.status !== "unchanged") return [];
        const name = item.proposedName ?? item.currentName;
        return name ? [name] : [];
      })
  };
}
