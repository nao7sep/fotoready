import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CopyPlus, Menu, Pause, Play, RotateCcw, Save, Settings, Trash2 } from "lucide-react";
import { api } from "./ipc/client";
import type { GlobalSettings } from "@shared/types/settings";
import type { CacheSizes, LutEntry, OpCatalogItem, ProjectSnapshot, QueueSnapshot, SystemInfo } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";
import type { OpInstance } from "@shared/types/op";
import { EditorCanvas } from "./components/canvas/editor-canvas";
import { RenameModal } from "./components/modals/rename-modal";
import { AppSettingsModal } from "./components/modals/settings-modal";
import { OriginalsPanel } from "./components/panels/originals-panel";
import { TasksPanel } from "./components/panels/tasks-panel";
import { useWorkspaceLayout } from "./layout/workspace-layout";
import "./styles/app.css";

function App(): React.JSX.Element {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectSnapshot | null>(null);
  const [opCatalog, setOpCatalog] = useState<OpCatalogItem[]>([]);
  const [lutEntries, setLutEntries] = useState<LutEntry[]>([]);
  const [preview, setPreview] = useState<{ taskId: string; dataUrl: string; width: number; height: number } | null>(null);
  const [originalThumbnails, setOriginalThumbnails] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [renameOpen, setRenameOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showOriginals, setShowOriginals] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [showOps, setShowOps] = useState(true);
  const [selectedRenameTaskIds, setSelectedRenameTaskIds] = useState<string[]>([]);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<GlobalSettings | null>(null);
  const [cacheSizes, setCacheSizes] = useState<CacheSizes | null>(null);
  const [queue, setQueue] = useState<QueueSnapshot>({ done: 0, total: 0, processing: 0, errors: 0, paused: false });
  const workspaceLayout = useWorkspaceLayout({ showOps, showOriginals, showTasks });

  const project = projectSnapshot?.project;
  const activeTask = project?.tasks.find((task) => task.id === projectSnapshot?.activeTaskId) ?? null;
  const activeOriginal = activeTask ? project?.originals.find((original) => original.id === activeTask.originalId) ?? null : null;
  const activePreview = preview?.taskId === activeTask?.id ? preview : null;
  const erroredTasks = project?.tasks.filter((task) => task.error) ?? [];

  useEffect(() => {
    void Promise.all([api.system.getInfo(), api.settings.get(), api.project.current(), api.ops.list(), api.queues.snapshot(), api.luts.list()]).then(
      ([info, loadedSettings, loadedProject, loadedOps, snapshot, loadedLuts]) => {
        setSystemInfo(info);
        setSettings(loadedSettings);
        setProjectSnapshot(loadedProject);
        setOpCatalog(loadedOps);
        setQueue(snapshot);
        setLutEntries(loadedLuts);
      }
    );
  }, []);

  useEffect(() => {
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      void api.system.log("warn", stringifyLogArgs(args));
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      void api.system.log("error", stringifyLogArgs(args));
    };
    const onError = (event: ErrorEvent) => void api.system.log("error", event.message, event.error instanceof Error ? event.error.stack ?? null : null);
    const onRejection = (event: PromiseRejectionEvent) => void api.system.log("error", "Unhandled renderer rejection", stringifyLogArgs([event.reason]));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      console.warn = originalWarn;
      console.error = originalError;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === "1") {
        event.preventDefault();
        setShowOriginals((value) => !value);
      } else if (mod && event.key === "2") {
        event.preventDefault();
        setShowTasks((value) => !value);
      } else if (mod && event.key === "3") {
        event.preventDefault();
        setShowOps((value) => !value);
      } else if (mod && event.key.toLowerCase() === "s" && event.shiftKey) {
        event.preventDefault();
        void saveAll();
      } else if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (activeTask?.status === "pending") void saveTask(activeTask.id);
      } else if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        if (activeTask?.status === "pending") void undoTask(activeTask.id);
      } else if (mod && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (project?.tasks.some((task) => task.status === "done")) setRenameOpen(true);
      } else if (mod && event.key === ",") {
        event.preventDefault();
        void openSettings();
      } else if (event.key === "?" && !mod) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTask?.id, activeTask?.status, project?.tasks]);

  useEffect(() => {
    const offProject = api.events.onProjectSnapshot((snapshot) => {
      setProjectSnapshot(snapshot);
    });
    const offQueue = api.events.onQueueSnapshot((snapshot) => {
      setQueue(snapshot);
    });
    return () => {
      offProject();
      offQueue();
    };
  }, []);

  useEffect(() => {
    if (!activeTask) {
      setPreview(null);
      setPreviewState("idle");
      return;
    }

    let cancelled = false;
    setPreviewState("loading");
    void api.preview.render(activeTask.id)
      .then((result) => {
        if (!cancelled) {
          setPreview(result);
          setPreviewState("idle");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(null);
          setPreviewState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTask?.id, activeTask?.updatedAt, activeTask?.pipeline.ops.length]);

  useEffect(() => {
    const originals = project?.originals ?? [];
    const missing = originals.filter((original) => !originalThumbnails[original.id]);
    if (missing.length === 0) return;

    let cancelled = false;
    for (const original of missing) {
      void api.preview.originalThumbnail(original.id)
        .then((thumbnail) => {
          if (!cancelled) {
            setOriginalThumbnails((current) => ({ ...current, [thumbnail.originalId]: thumbnail.dataUrl }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setOriginalThumbnails((current) => ({ ...current, [original.id]: "" }));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [project?.originals, originalThumbnails]);

  async function addOriginals(): Promise<void> {
    await refreshProject(await api.project.addOriginalsFromDialog());
  }

  async function addOriginalPaths(sourcePaths: string[]): Promise<void> {
    if (sourcePaths.length === 0) return;
    await refreshProject(await api.project.addOriginals(sourcePaths));
  }

  async function openProject(): Promise<void> {
    await refreshProject(await api.project.openFromDialog());
  }

  async function newProject(): Promise<void> {
    await refreshProject(await api.project.newProject());
  }

  async function saveProjectAs(): Promise<void> {
    await refreshProject(await api.project.saveAsFromDialog());
  }

  async function setOutputDir(): Promise<void> {
    await refreshProject(await api.project.setOutputDirFromDialog());
  }

  async function selectOriginal(originalId: string): Promise<void> {
    await refreshProject(await api.project.selectOriginal(originalId));
  }

  async function selectTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.select(taskId));
  }

  async function forkTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.fork(taskId));
  }

  async function deleteTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.delete(taskId));
    setSelectedRenameTaskIds((current) => current.filter((id) => id !== taskId));
  }

  async function retryTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.retry(taskId));
  }

  async function dismissError(taskId: string): Promise<void> {
    await refreshProject(await api.task.dismissError(taskId));
  }

  async function revealSource(): Promise<void> {
    if (activeOriginal) await api.system.revealInFolder(activeOriginal.sourcePath);
  }

  async function revealTaskSource(task: Task): Promise<void> {
    const original = project?.originals.find((item) => item.id === task.originalId);
    if (original) await api.system.revealInFolder(original.sourcePath);
  }

  async function editErroredTask(task: Task): Promise<void> {
    if (task.error) await refreshProject(await api.task.dismissError(task.id));
    await refreshProject(await api.task.select(task.id));
    setErrorsOpen(false);
  }

  async function undoTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.undo(taskId));
  }

  async function saveTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.save(taskId));
  }

  async function saveAll(): Promise<void> {
    await refreshProject(await api.task.saveAll());
  }

  async function addOp(opType: string): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.addOp(activeTask.id, opType));
  }

  async function removeOp(opIndex: number): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.removeOp(activeTask.id, opIndex));
  }

  async function setOpEnabled(opIndex: number, enabled: boolean): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setOpEnabled(activeTask.id, opIndex, enabled));
  }

  async function updateOpParam(opIndex: number, key: string, value: unknown): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOpParam(activeTask.id, opIndex, key, value));
  }

  async function setAnalyzeContent(analyzeContent: boolean): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setAnalyzeContent(activeTask.id, analyzeContent));
  }

  async function setCustomSlug(customSlug: string | null): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setCustomSlug(activeTask.id, customSlug));
  }

  async function runVision(taskId: string): Promise<void> {
    await refreshProject(await api.vision.runForTask(taskId));
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKeyDraft.trim()) return;
    await api.settings.setGeminiApiKey(apiKeyDraft.trim());
    setApiKeyDraft("");
    setApiKeyOpen(false);
  }

  async function openSettings(): Promise<void> {
    setCacheSizes(await api.caches.sizes());
    setSettingsDraft(settings);
    setApiKeyOpen(true);
  }

  async function clearCaches(): Promise<void> {
    setCacheSizes(await api.caches.clear());
  }

  async function saveSettingsDraft(): Promise<void> {
    if (!settingsDraft) return;
    setSettings(await api.settings.update(settingsDraft));
    setLutEntries(await api.luts.list());
    setApiKeyOpen(false);
  }

  async function updateOutput(key: string, value: unknown): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOutput(activeTask.id, key, value));
  }

  async function refreshProject(snapshot: ProjectSnapshot): Promise<void> {
    setProjectSnapshot(snapshot);
    const doneTaskIds = new Set(snapshot.project.tasks.filter((task) => task.status === "done").map((task) => task.id));
    setSelectedRenameTaskIds((current) => current.filter((taskId) => doneTaskIds.has(taskId)));
    setQueue(await api.queues.snapshot());
  }

  function toggleRenameSelection(taskId: string, selected: boolean): void {
    setSelectedRenameTaskIds((current) => {
      if (selected) return current.includes(taskId) ? current : [...current, taskId];
      return current.filter((id) => id !== taskId);
    });
  }

  async function pauseQueues(): Promise<void> {
    setQueue(await api.queues.pause());
  }

  async function resumeQueues(): Promise<void> {
    setQueue(await api.queues.resume());
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <button className="project-button" type="button">
          {project?.name ?? "Untitled Project"}
        </button>
        <button className="toolbar-button" type="button" onClick={() => void newProject()}>New</button>
        <button className="toolbar-button" type="button" onClick={() => void openProject()}>Open</button>
        <button className="toolbar-button" type="button" onClick={() => void saveProjectAs()}>Save as</button>
        <button className="output-path" type="button" onClick={() => void setOutputDir()}>Output: {project?.outputDir ?? settings?.defaultOutputDirectory ?? "./out"}</button>
        <button className="icon-button" type="button" title="Settings" onClick={() => void openSettings()}>
          <Settings size={18} />
        </button>
        <button className="icon-button" type="button" title="Menu" onClick={() => setMenuOpen((value) => !value)}>
          <Menu size={18} />
        </button>
        {menuOpen ? (
          <div className="app-menu">
            <button type="button" onClick={() => {
              setMenuOpen(false);
              void openSettings();
            }}>Settings</button>
            <button type="button" onClick={() => {
              setMenuOpen(false);
              setShortcutsOpen(true);
            }}>Keyboard shortcuts</button>
            <button type="button" onClick={() => {
              setMenuOpen(false);
              setAboutOpen(true);
            }}>About FotoReady</button>
          </div>
        ) : null}
      </header>

      <section className="workspace" style={{ gridTemplateColumns: workspaceLayout.gridTemplateColumns }}>
        {showOriginals ? (
          <OriginalsPanel
            activeOriginalId={activeOriginal?.id ?? null}
            originals={project?.originals ?? []}
            thumbnails={originalThumbnails}
            onAdd={() => void addOriginals()}
            onDropFiles={(sourcePaths) => void addOriginalPaths(sourcePaths)}
            onSelect={(originalId) => void selectOriginal(originalId)}
          />
        ) : null}
        {showOriginals ? <WorkspaceSplitter label="Resize Originals panel" onPointerDown={workspaceLayout.startResize("originals")} /> : null}

        {showTasks ? (
          <TasksPanel
            activeTaskId={activeTask?.id ?? null}
            originals={project?.originals ?? []}
            selectedRenameTaskIds={selectedRenameTaskIds}
            tasks={project?.tasks ?? []}
            onRename={() => setRenameOpen(true)}
            onSaveAll={() => void saveAll()}
            onSelect={(taskId) => void selectTask(taskId)}
            onToggleRenameSelection={toggleRenameSelection}
          />
        ) : null}
        {showTasks ? <WorkspaceSplitter label="Resize Tasks panel" onPointerDown={workspaceLayout.startResize("tasks")} /> : null}

        <section className="editor-panel">
          <div className="canvas-frame">
            <EditorCanvas
              fallbackLabel={activeOriginal ? basename(activeOriginal.sourcePath) : "Import an original to begin editing"}
              originalDataUrl={activeOriginal ? originalThumbnails[activeOriginal.id] || null : null}
              preview={activePreview}
              previewState={previewState}
              task={activeTask}
            />
          </div>
          <div className="pipeline-strip">
            Pipeline: {activeTask?.pipeline.ops.length ? `${activeTask.pipeline.ops.length} ops` : "empty"}
            {activeTask?.status === "pending" ? (
              <button className="inline-action" type="button" onClick={() => void saveTask(activeTask.id)}>
                <Save size={14} /> Save task
              </button>
            ) : null}
            {activeTask && activeTask.status !== "pending" ? (
              <button className="inline-action" type="button" onClick={() => void forkTask(activeTask.id)}>
                <CopyPlus size={14} /> Fork as new task
              </button>
            ) : null}
            {activeTask?.error ? (
              <button className="inline-action" type="button" onClick={() => void retryTask(activeTask.id)}>
                <RotateCcw size={14} /> Retry
              </button>
            ) : null}
            {activeTask ? (
              <button className="inline-action danger" type="button" onClick={() => void deleteTask(activeTask.id)}>
                <Trash2 size={14} /> Delete
              </button>
            ) : null}
            {activeTask?.status === "done" && !activeTask.output?.vision ? (
              <button className="inline-action" type="button" onClick={() => void runVision(activeTask.id)}>
                Generate description
              </button>
            ) : null}
          </div>
          {activeTask?.error ? (
            <div className="error-strip">
              <strong>{activeTask.error.stage}</strong>
              <span>{activeTask.error.message}</span>
              <button className="inline-action" type="button" onClick={() => void retryTask(activeTask.id)}>Retry</button>
              <button className="inline-action" disabled={!activeOriginal} type="button" onClick={() => void revealSource()}>Reveal source</button>
              <button className="inline-action" type="button" onClick={() => void dismissError(activeTask.id)}>Dismiss</button>
            </div>
          ) : null}
          <div className="histogram-placeholder" />
        </section>

        {showOps ? <WorkspaceSplitter label="Resize Ops panel" onPointerDown={workspaceLayout.startResize("ops")} /> : null}

        {showOps ? <aside className="panel ops-panel">
          <PanelHeader title="Ops" />
          {activeTask ? (
            <div className="current-ops">
              {activeTask.pipeline.ops.length ? activeTask.pipeline.ops.map((op, index) => (
                <PipelineOpCard
                  catalogItem={opCatalog.find((item) => item.type === op.type) ?? null}
                  disabled={activeTask.status !== "pending"}
                  index={index}
                  luts={lutEntries}
                  key={`${op.type}-${index}`}
                  op={op}
                  onEnabledChange={(enabled) => void setOpEnabled(index, enabled)}
                  onParamChange={(key, value) => void updateOpParam(index, key, value)}
                  onRemove={() => void removeOp(index)}
                />
              )) : (
                <div className="ops-empty">No ops in this task</div>
              )}
            </div>
          ) : null}
          {["Geometry", "Tone", "Effects", "Redaction", "Metadata", "Output"].map((section) => (
            <section className="op-section" key={section}>
              <h3>{section}</h3>
              {section === "Output" ? (
                <OutputControls
                  disabled={!activeTask || activeTask.status !== "pending"}
                  task={activeTask}
                  onAnalyzeContentChange={(value) => void setAnalyzeContent(value)}
                  onCustomSlugChange={(value) => void setCustomSlug(value)}
                  onOutputChange={(key, value) => void updateOutput(key, value)}
                />
              ) : (
                <div className="op-buttons">
                  {opCatalog.filter((op) => op.category === section).map((op) => (
                    <button className="toolbar-button full-width" disabled={!activeTask || activeTask.status !== "pending"} key={op.type} type="button" onClick={() => void addOp(op.type)}>
                      Add {op.label}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </aside> : null}
      </section>

      {renameOpen && settings ? (
        <RenameModal
          defaultTemplateId={project?.settings.defaultTemplateId ?? settings.defaultTemplateId}
          doneTasks={(project?.tasks ?? []).filter((task) => task.status === "done").map((task) => ({
            id: task.id,
            label: taskLabel(task, project?.originals ?? []),
            selected: selectedRenameTaskIds.includes(task.id)
          }))}
          onClose={() => setRenameOpen(false)}
          onGenerateMissing={async (taskIds, onProgress) => {
            for (const [index, taskId] of taskIds.entries()) {
              await refreshProject(await api.vision.runForTask(taskId));
              onProgress(index + 1, taskIds.length);
            }
          }}
          onPreview={(templateId, taskIds) => api.rename.preview(templateId, taskIds)}
          onRun={async (templateId, taskIds) => {
            await refreshProject(await api.rename.run(templateId, taskIds));
            setRenameOpen(false);
          }}
          onTaskSelected={toggleRenameSelection}
          selectedTaskIds={selectedRenameTaskIds}
          templates={settings.filenameTemplates}
        />
      ) : null}

      {apiKeyOpen ? (
        <AppSettingsModal
          apiKeyDraft={apiKeyDraft}
          cacheSizes={cacheSizes}
          onApiKeyDraftChange={setApiKeyDraft}
          onClearCaches={() => void clearCaches()}
          onClose={() => setApiKeyOpen(false)}
          onSaveApiKey={() => void saveApiKey()}
          onSaveSettings={() => void saveSettingsDraft()}
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
          systemInfo={systemInfo}
        />
      ) : null}

      {shortcutsOpen ? (
        <div className="modal-backdrop">
          <section className="modal small-modal">
            <header className="modal-header">
              <h2>Keyboard Shortcuts</h2>
              <button className="toolbar-button" type="button" onClick={() => setShortcutsOpen(false)}>Close</button>
            </header>
            <div className="shortcut-list">
              {[
                ["Cmd/Ctrl+1", "Toggle Originals"],
                ["Cmd/Ctrl+2", "Toggle Tasks"],
                ["Cmd/Ctrl+3", "Toggle Ops"],
                ["Cmd/Ctrl+S", "Save current task"],
                ["Cmd/Ctrl+Shift+S", "Save all"],
                ["Cmd/Ctrl+R", "Rename"],
                ["Cmd/Ctrl+,", "Settings"],
                ["?", "Keyboard shortcuts"]
              ].map(([keys, action]) => (
                <div className="shortcut-row" key={keys}>
                  <kbd>{keys}</kbd>
                  <span>{action}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {aboutOpen ? (
        <div className="modal-backdrop">
          <section className="modal small-modal">
            <header className="modal-header">
              <h2>About FotoReady</h2>
              <button className="toolbar-button" type="button" onClick={() => setAboutOpen(false)}>Close</button>
            </header>
            <div className="settings-summary">
              <span>Application</span>
              <code>{systemInfo ? `${systemInfo.appName} ${systemInfo.version}` : "FotoReady"}</code>
            </div>
            <div className="settings-summary">
              <span>Data directory</span>
              <code>{systemInfo?.dataDir ?? "~/.fotoready"}</code>
            </div>
            <div className="settings-summary">
              <span>License</span>
              <code>MIT</code>
            </div>
          </section>
        </div>
      ) : null}

      <footer className="status-bar">
        <span>
          Queue: {queue.done}/{queue.total} done
          {queue.processing > 0 ? ` · ${queue.processing} processing` : ""}
          {queue.errors > 0 ? ` · ${queue.errors} errors` : ""}
          {queue.paused ? " · paused" : ""}
        </span>
        {erroredTasks.length ? (
          <button className="toolbar-button compact-text" type="button" onClick={() => setErrorsOpen(true)}>
            Errors
          </button>
        ) : null}
        <button className="icon-button compact" type="button" title="Pause queues" onClick={() => void pauseQueues()} disabled={queue.paused}>
          <Pause size={15} />
        </button>
        <button className="icon-button compact" type="button" title="Resume queues" onClick={() => void resumeQueues()} disabled={!queue.paused}>
          <Play size={15} />
        </button>
        <span className="version">{systemInfo ? `${systemInfo.appName} ${systemInfo.version}` : "FotoReady"}</span>
      </footer>

      {errorsOpen ? (
        <div className="modal-backdrop">
          <section className="modal">
            <header className="modal-header">
              <h2>Errors</h2>
              <button className="toolbar-button" type="button" onClick={() => setErrorsOpen(false)}>Close</button>
            </header>
            <div className="error-center-list">
              {erroredTasks.length ? erroredTasks.map((task) => (
                <div className="error-center-row" key={task.id}>
                  <div>
                    <strong>{taskLabel(task, project?.originals ?? [])}</strong>
                    <span>{task.error?.stage}: {task.error?.message}</span>
                  </div>
                  <button className="toolbar-button" type="button" onClick={() => void retryTask(task.id)}>Retry</button>
                  <button className="toolbar-button" type="button" onClick={() => void editErroredTask(task)}>Edit task</button>
                  <button className="toolbar-button" type="button" onClick={() => void revealTaskSource(task)}>Reveal source</button>
                  <button className="toolbar-button" type="button" onClick={() => void dismissError(task.id)}>Dismiss</button>
                </div>
              )) : <div className="ops-empty">No current task errors</div>}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function PipelineOpCard({
  catalogItem,
  disabled,
  index,
  op,
  onEnabledChange,
  luts,
  onParamChange,
  onRemove
}: {
  catalogItem: OpCatalogItem | null;
  disabled: boolean;
  index: number;
  luts: LutEntry[];
  op: OpInstance;
  onEnabledChange(enabled: boolean): void;
  onParamChange(key: string, value: unknown): void;
  onRemove(): void;
}): React.JSX.Element {
  return (
    <section className="pipeline-op-card">
      <div className="op-card-header">
        <label className="toggle-row">
          <input type="checkbox" checked={op.enabled} disabled={disabled} onChange={(event) => onEnabledChange(event.currentTarget.checked)} />
          {index + 1}. {catalogItem?.label ?? op.type}
        </label>
        <button className="icon-button compact" type="button" title="Remove op" disabled={disabled} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      <OpParams op={op} disabled={disabled} luts={luts} onParamChange={onParamChange} />
    </section>
  );
}

function OpParams({
  disabled,
  luts,
  op,
  onParamChange
}: {
  disabled: boolean;
  luts: LutEntry[];
  op: OpInstance;
  onParamChange(key: string, value: unknown): void;
}): React.JSX.Element {
  if (op.type === "resize") {
    return (
      <div className="field-grid">
        <label>
          Mode
          <select disabled={disabled} value={stringValue(op.params.mode, "long-edge")} onChange={(event) => onParamChange("mode", event.currentTarget.value)}>
            {["fit", "fill", "width", "height", "long-edge", "short-edge"].map((mode) => <option key={mode}>{mode}</option>)}
          </select>
        </label>
        <label>
          Pixels
          <input disabled={disabled} min={1} type="number" value={numberValue(op.params.value, 1920)} onChange={(event) => onParamChange("value", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "rotate") {
    return (
      <div className="field-grid">
        <label>
          Degrees
          <input disabled={disabled} max={180} min={-180} type="number" value={numberValue(op.params.degrees, 0)} onChange={(event) => onParamChange("degrees", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Fill
          <input disabled={disabled} type="color" value={stringValue(op.params.fillColor, "#ffffff")} onChange={(event) => onParamChange("fillColor", event.currentTarget.value)} />
        </label>
      </div>
    );
  }

  if (op.type === "crop") {
    return (
      <div className="field-grid four">
        {["x", "y", "w", "h"].map((key) => (
          <label key={key}>
            {key}
            <input disabled={disabled} max={1} min={0} step={0.01} type="number" value={numberValue(op.params[key], key === "w" || key === "h" ? 1 : 0)} onChange={(event) => onParamChange(key, event.currentTarget.valueAsNumber)} />
          </label>
        ))}
      </div>
    );
  }

  if (op.type === "levels") {
    return (
      <div className="field-grid">
        <label>
          Black
          <input disabled={disabled} max={254} min={0} type="number" value={numberValue(op.params.blackPoint, 0)} onChange={(event) => onParamChange("blackPoint", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          White
          <input disabled={disabled} max={255} min={1} type="number" value={numberValue(op.params.whitePoint, 255)} onChange={(event) => onParamChange("whitePoint", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Gamma
          <input disabled={disabled} max={5} min={0.1} step={0.05} type="number" value={numberValue(op.params.gamma, 1)} onChange={(event) => onParamChange("gamma", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "white-balance") {
    return (
      <div className="field-grid">
        <label>
          Temperature
          <input disabled={disabled} max={100} min={-100} type="number" value={numberValue(op.params.temperature, 0)} onChange={(event) => onParamChange("temperature", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Tint
          <input disabled={disabled} max={100} min={-100} type="number" value={numberValue(op.params.tint, 0)} onChange={(event) => onParamChange("tint", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "auto-tone") {
    return (
      <div className="field-grid">
        <label className="toggle-row span-two">
          <input disabled={disabled} type="checkbox" checked={op.params.enabled !== false} onChange={(event) => onParamChange("enabled", event.currentTarget.checked)} />
          Enabled
        </label>
        <label className="span-two">
          Strength
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={numberValue(op.params.strength, 0.7)} onChange={(event) => onParamChange("strength", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "curves") {
    const points = curvePointsValue(op.params.rgb);
    return (
      <div className="field-grid">
        {points.map((point, index) => (
          <React.Fragment key={index}>
            <label>
              In {index + 1}
              <input disabled={disabled} max={255} min={0} type="number" value={point[0]} onChange={(event) => onParamChange("rgb", points.map((item, itemIndex) => itemIndex === index ? [event.currentTarget.valueAsNumber, item[1]] : item))} />
            </label>
            <label>
              Out {index + 1}
              <input disabled={disabled} max={255} min={0} type="number" value={point[1]} onChange={(event) => onParamChange("rgb", points.map((item, itemIndex) => itemIndex === index ? [item[0], event.currentTarget.valueAsNumber] : item))} />
            </label>
          </React.Fragment>
        ))}
      </div>
    );
  }

  if (op.type === "hsl") {
    return (
      <div className="hsl-grid">
        {hslRanges.map((range) => {
          const params = hslRangeValue(op.params[range]);
          return (
            <div className="hsl-row" key={range}>
              <span>{range}</span>
              {(["hue", "sat", "lum"] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    disabled={disabled}
                    max={key === "hue" ? 180 : 1}
                    min={key === "hue" ? -180 : -1}
                    step={key === "hue" ? 1 : 0.05}
                    type="number"
                    value={params[key]}
                    onChange={(event) => onParamChange(range, { ...params, [key]: event.currentTarget.valueAsNumber })}
                  />
                </label>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  if (op.type === "unsharp-mask") {
    return (
      <div className="field-grid">
        <label>
          Radius
          <input disabled={disabled} min={0.3} step={0.1} type="number" value={numberValue(op.params.radius, 1)} onChange={(event) => onParamChange("radius", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Amount
          <input disabled={disabled} min={0} step={0.1} type="number" value={numberValue(op.params.amount, 1)} onChange={(event) => onParamChange("amount", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="toggle-row span-two">
          <input disabled={disabled} type="checkbox" checked={op.params.outputSharpen === true} onChange={(event) => onParamChange("outputSharpen", event.currentTarget.checked)} />
          Output sharpen
        </label>
      </div>
    );
  }

  if (op.type === "denoise") {
    return (
      <label className="stacked-field">
        Strength
        <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={numberValue(op.params.strength, 0.3)} onChange={(event) => onParamChange("strength", event.currentTarget.valueAsNumber)} />
      </label>
    );
  }

  if (op.type === "lut") {
    return (
      <div className="field-grid">
        <label className="span-two">
          Saved LUT
          <select disabled={disabled || luts.length === 0} value={stringValue(op.params.cubePath, "")} onChange={(event) => onParamChange("cubePath", event.currentTarget.value)}>
            <option value="">Choose a LUT</option>
            {luts.map((lut) => <option key={lut.path} value={lut.path}>{lut.builtin ? "Built-in: " : ""}{lut.name}</option>)}
          </select>
        </label>
        <label className="span-two">
          .cube path
          <input disabled={disabled} type="text" value={stringValue(op.params.cubePath, "")} onChange={(event) => onParamChange("cubePath", event.currentTarget.value)} />
        </label>
        <button className="toolbar-button span-two" disabled={disabled} type="button" onClick={async () => {
          const picked = await api.system.pickFile({ title: "Choose Cube LUT", extensions: ["cube"] });
          if (picked) onParamChange("cubePath", picked);
        }}>Browse LUT...</button>
        <label className="span-two">
          Strength
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={numberValue(op.params.strength, 1)} onChange={(event) => onParamChange("strength", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "redact-fill") {
    const rect = firstRect(op.params.rects);
    return (
      <div className="field-grid four">
        {["x", "y", "w", "h"].map((key) => (
          <label key={key}>
            {key}
            <input
              disabled={disabled}
              max={1}
              min={0}
              step={0.01}
              type="number"
              value={numberValue(rect[key as keyof typeof rect], key === "w" || key === "h" ? 0.25 : 0)}
              onChange={(event) => onParamChange("rects", [{ ...rect, [key]: event.currentTarget.valueAsNumber }])}
            />
          </label>
        ))}
        <label className="span-two">
          Color
          <input disabled={disabled} type="color" value={stringValue(op.params.color, "#000000")} onChange={(event) => onParamChange("color", event.currentTarget.value)} />
        </label>
      </div>
    );
  }

  if (op.type === "redact-blur" || op.type === "redact-pixelate") {
    const rect = firstRect(op.params.rects);
    const sizeKey = op.type === "redact-blur" ? "radius" : "blockSize";
    return (
      <div className="field-grid four">
        {["x", "y", "w", "h"].map((key) => (
          <label key={key}>
            {key}
            <input
              disabled={disabled}
              max={1}
              min={0}
              step={0.01}
              type="number"
              value={numberValue(rect[key as keyof typeof rect], key === "w" || key === "h" ? 0.25 : 0)}
              onChange={(event) => onParamChange("rects", [{ ...rect, [key]: event.currentTarget.valueAsNumber }])}
            />
          </label>
        ))}
        <label className="span-two">
          {op.type === "redact-blur" ? "Radius" : "Block size"}
          <input disabled={disabled} min={0.001} step={0.005} type="number" value={numberValue(op.params[sizeKey], op.type === "redact-blur" ? 0.02 : 0.015)} onChange={(event) => onParamChange(sizeKey, event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "watermark-text") {
    return (
      <div className="field-grid">
        <label className="span-two">
          Text
          <input disabled={disabled} type="text" value={stringValue(op.params.text, "")} onChange={(event) => onParamChange("text", event.currentTarget.value)} />
        </label>
        <label>
          Anchor
          <select disabled={disabled} value={stringValue(op.params.anchor, "bottom-right")} onChange={(event) => onParamChange("anchor", event.currentTarget.value)}>
            {["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"].map((anchor) => <option key={anchor}>{anchor}</option>)}
          </select>
        </label>
        <label>
          Size
          <input disabled={disabled} max={0.2} min={0.005} step={0.005} type="number" value={numberValue(op.params.size, 0.03)} onChange={(event) => onParamChange("size", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Opacity
          <input disabled={disabled} max={1} min={0} step={0.05} type="number" value={numberValue(op.params.opacity, 0.7)} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Color
          <input disabled={disabled} type="color" value={stringValue(op.params.color, "#ffffff")} onChange={(event) => onParamChange("color", event.currentTarget.value)} />
        </label>
      </div>
    );
  }

  if (op.type === "watermark-image") {
    return (
      <div className="field-grid">
        <label className="span-two">
          PNG path
          <input disabled={disabled} type="text" value={stringValue(op.params.pngPath, "")} onChange={(event) => onParamChange("pngPath", event.currentTarget.value)} />
        </label>
        <button className="toolbar-button span-two" disabled={disabled} type="button" onClick={async () => {
          const picked = await api.system.pickFile({ title: "Choose Watermark PNG", extensions: ["png"] });
          if (picked) onParamChange("pngPath", picked);
        }}>Browse PNG...</button>
        <label>
          Anchor
          <select disabled={disabled} value={stringValue(op.params.anchor, "bottom-right")} onChange={(event) => onParamChange("anchor", event.currentTarget.value)}>
            {["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"].map((anchor) => <option key={anchor}>{anchor}</option>)}
          </select>
        </label>
        <label>
          Scale
          <input disabled={disabled} max={1} min={0.01} step={0.01} type="number" value={numberValue(op.params.scale, 0.15)} onChange={(event) => onParamChange("scale", event.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Opacity
          <input disabled={disabled} max={1} min={0} step={0.05} type="number" value={numberValue(op.params.opacity, 0.7)} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }

  if (op.type === "strip-metadata") {
    const keep = metadataKeepValue(op.params.keep);
    return (
      <div className="field-grid">
        {(["author", "copyright", "orientation", "colorspace"] as const).map((field) => (
          <label className="toggle-row" key={field}>
            <input
              disabled={disabled}
              type="checkbox"
              checked={keep.includes(field)}
              onChange={(event) => onParamChange("keep", event.currentTarget.checked ? [...keep, field] : keep.filter((item) => item !== field))}
            />
            Keep {field}
          </label>
        ))}
      </div>
    );
  }

  if (op.type === "inject-metadata") {
    const fields = metadataFieldsValue(op.params.fields);
    return (
      <div className="field-grid">
        {(["author", "copyright", "description", "credit"] as const).map((field) => (
          <label className="stacked-field" key={field}>
            {field}
            <input disabled={disabled} type="text" value={fields[field] ?? ""} onChange={(event) => onParamChange("fields", { ...fields, [field]: event.currentTarget.value })} />
          </label>
        ))}
      </div>
    );
  }

  return <div className="row-detail">No editable parameters.</div>;
}

function OutputControls({
  disabled,
  task,
  onAnalyzeContentChange,
  onCustomSlugChange,
  onOutputChange
}: {
  disabled: boolean;
  task: Task | null;
  onAnalyzeContentChange(value: boolean): void;
  onCustomSlugChange(value: string | null): void;
  onOutputChange(key: string, value: unknown): void;
}): React.JSX.Element {
  return (
    <div className="output-controls">
      <label className="toggle-row" title="When this task is saved, use AI to generate a description of the image. Used for alt text, slugs, and notes.">
        <input type="checkbox" disabled={disabled || !task} checked={task?.analyzeContent ?? true} onChange={(event) => onAnalyzeContentChange(event.currentTarget.checked)} />
        Describe contents
      </label>
      {task?.output?.vision ? (
        <div className="vision-description">
          <span>Generated description</span>
          <p>{task.output.vision.description}</p>
        </div>
      ) : task?.error?.stage === "vision" ? (
        <div className="modal-error">{task.error.message}</div>
      ) : null}
      <label className="stacked-field">
        Custom slug
        <input disabled={disabled || !task} placeholder="manual-descriptive-slug" type="text" value={task?.customSlug ?? ""} onChange={(event) => onCustomSlugChange(event.currentTarget.value || null)} />
      </label>
      <label className="stacked-field">
        Format
        <select disabled={disabled || !task} value={task?.pipeline.output.format ?? "webp"} onChange={(event) => onOutputChange("format", event.currentTarget.value)}>
          {["jpeg", "webp", "avif", "png"].map((format) => <option key={format}>{format}</option>)}
        </select>
      </label>
      <label className="stacked-field">
        Quality
        <input disabled={disabled || !task || typeof task?.pipeline.output.quality !== "number"} max={100} min={1} type="number" value={typeof task?.pipeline.output.quality === "number" ? task.pipeline.output.quality : 82} onChange={(event) => onOutputChange("quality", event.currentTarget.valueAsNumber)} />
      </label>
      {task?.pipeline.output.format === "jpeg" ? (
        <label className="stacked-field">
          JPEG strategy
          <select
            disabled={disabled || !task}
            value={typeof task.pipeline.output.quality === "number" ? "fixed" : task.pipeline.output.quality}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onOutputChange("quality", value === "fixed" ? 85 : value);
            }}
          >
            <option value="fixed">fixed</option>
            <option value="match-source-quality">match-source-quality</option>
            <option value="match-source-size">match-source-size</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}

function PanelHeader({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
    </div>
  );
}

function WorkspaceSplitter({
  label,
  onPointerDown
}: {
  label: string;
  onPointerDown(event: React.PointerEvent<HTMLButtonElement>): void;
}): React.JSX.Element {
  return <button aria-label={label} className="workspace-splitter" type="button" onPointerDown={onPointerDown} />;
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}

function statusIndicator(task: Task): string {
  if (task.status === "processing") return "◐";
  if (task.status === "error") return "x";
  return "●";
}

function taskLabel(task: Task, originals: { id: string; sourcePath: string }[]): string {
  const original = originals.find((item) => item.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function stringifyLogArgs(args: unknown[]): string {
  return args.map((arg) => {
    if (arg instanceof Error) return arg.stack ?? arg.message;
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(" ");
}

const hslRanges = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;

function curvePointsValue(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]];
  const points = value.filter((point): point is [number, number] =>
    Array.isArray(point) &&
    typeof point[0] === "number" &&
    typeof point[1] === "number"
  );
  return points.length ? points : [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]];
}

function hslRangeValue(value: unknown): { hue: number; sat: number; lum: number } {
  const params = value && typeof value === "object" ? value as Partial<{ hue: number; sat: number; lum: number }> : {};
  return {
    hue: numberValue(params.hue, 0),
    sat: numberValue(params.sat, 0),
    lum: numberValue(params.lum, 0)
  };
}

function metadataKeepValue(value: unknown): Array<"author" | "copyright" | "orientation" | "colorspace"> {
  const allowed = ["author", "copyright", "orientation", "colorspace"] as const;
  if (!Array.isArray(value)) return [...allowed];
  return value.filter((item): item is typeof allowed[number] => allowed.some((field) => field === item));
}

function metadataFieldsValue(value: unknown): Record<string, string> {
  return value && typeof value === "object" ? value as Record<string, string> : {};
}

function firstRect(value: unknown): { x: number; y: number; w: number; h: number } {
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
    const rect = value[0] as Partial<{ x: number; y: number; w: number; h: number }>;
    return {
      x: numberValue(rect.x, 0),
      y: numberValue(rect.y, 0),
      w: numberValue(rect.w, 0.25),
      h: numberValue(rect.h, 0.25)
    };
  }
  return { x: 0, y: 0, w: 0.25, h: 0.25 };
}

createRoot(document.getElementById("root")!).render(<App />);
