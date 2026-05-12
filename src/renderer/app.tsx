import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CopyPlus, ImagePlus, Menu, Pause, Play, RotateCcw, Save, Settings, Trash2 } from "lucide-react";
import { api } from "./ipc/client";
import type { GlobalSettings } from "@shared/types/settings";
import type { CacheSizes, OpCatalogItem, ProjectSnapshot, QueueSnapshot, SystemInfo } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";
import type { OpInstance } from "@shared/types/op";
import { RenameModal } from "./components/modals/rename-modal";
import "./styles/app.css";

function App(): React.JSX.Element {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectSnapshot | null>(null);
  const [opCatalog, setOpCatalog] = useState<OpCatalogItem[]>([]);
  const [preview, setPreview] = useState<{ taskId: string; dataUrl: string; width: number; height: number } | null>(null);
  const [originalThumbnails, setOriginalThumbnails] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [renameOpen, setRenameOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showOriginals, setShowOriginals] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [showOps, setShowOps] = useState(true);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [cacheSizes, setCacheSizes] = useState<CacheSizes | null>(null);
  const [queue, setQueue] = useState<QueueSnapshot>({ done: 0, total: 0, processing: 0, errors: 0 });

  const project = projectSnapshot?.project;
  const activeTask = project?.tasks.find((task) => task.id === projectSnapshot?.activeTaskId) ?? null;
  const activeOriginal = activeTask ? project?.originals.find((original) => original.id === activeTask.originalId) ?? null : null;
  const activePreview = preview?.taskId === activeTask?.id ? preview : null;

  useEffect(() => {
    void Promise.all([api.system.getInfo(), api.settings.get(), api.project.current(), api.ops.list(), api.queues.snapshot()]).then(
      ([info, loadedSettings, loadedProject, loadedOps, snapshot]) => {
        setSystemInfo(info);
        setSettings(loadedSettings);
        setProjectSnapshot(loadedProject);
        setOpCatalog(loadedOps);
        setQueue(snapshot);
      }
    );
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
  }

  async function retryTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.retry(taskId));
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
    setApiKeyOpen(true);
  }

  async function clearCaches(): Promise<void> {
    setCacheSizes(await api.caches.clear());
  }

  async function updateOutput(key: string, value: unknown): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOutput(activeTask.id, key, value));
  }

  async function refreshProject(snapshot: ProjectSnapshot): Promise<void> {
    setProjectSnapshot(snapshot);
    setQueue(await api.queues.snapshot());
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
        <button className="icon-button" type="button" title="Menu">
          <Menu size={18} />
        </button>
      </header>

      <section className={`workspace ${!showOriginals ? "hide-originals" : ""} ${!showTasks ? "hide-tasks" : ""} ${!showOps ? "hide-ops" : ""}`}>
        {showOriginals ? <aside className="panel originals-panel">
          <PanelHeader title="Originals" />
          <button className="drop-target" type="button" onClick={addOriginals}>
            <ImagePlus size={18} />
            Add originals
          </button>
          <div className="list">
            {project?.originals.map((original) => (
              <button
                className={`list-row ${activeOriginal?.id === original.id ? "active" : ""}`}
                key={original.id}
                type="button"
                onClick={() => void selectOriginal(original.id)}
              >
                <span className="thumb">
                  {originalThumbnails[original.id] ? <img src={originalThumbnails[original.id]} alt="" /> : null}
                </span>
                <span className="row-copy">
                  <span className="row-title">{basename(original.sourcePath)}</span>
                  <span className="row-detail">{original.width}x{original.height} · {original.format}</span>
                </span>
              </button>
            ))}
          </div>
        </aside> : null}

        {showTasks ? <aside className="panel tasks-panel">
          <PanelHeader title="Tasks" />
          {project?.tasks.length ? (
            <div className="list">
              {project.tasks.map((task) => (
                <button
                  className={`list-row task-row ${activeTask?.id === task.id ? "active" : ""}`}
                  key={task.id}
                  type="button"
                  onClick={() => void selectTask(task.id)}
                >
                  <span className={`status-dot ${task.status}`} aria-hidden="true">{statusIndicator(task)}</span>
                  <span className="task-copy">
                    <span className="row-title">{taskLabel(task, projectSnapshot?.project.originals ?? [])}</span>
                    <span className="row-detail">{task.status} · {task.pipeline.ops.length} ops</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">No tasks yet</div>
          )}
          <div className="panel-actions">
            <button className="primary-action" type="button" onClick={() => void saveAll()} disabled={!project?.tasks.some((task) => task.status === "pending")}>
              <Save size={16} /> Save all
            </button>
            <button className="toolbar-button" type="button" disabled={!project?.tasks.some((task) => task.status === "done")} onClick={() => setRenameOpen(true)}>
              Rename...
            </button>
          </div>
        </aside> : null}

        <section className="editor-panel">
          <div className="canvas-frame">
            {activePreview ? (
              <img className="preview-image" src={activePreview.dataUrl} width={activePreview.width} height={activePreview.height} alt="" />
            ) : (
              <div className="canvas-placeholder">
                {previewState === "loading" ? "Rendering preview..." : activeOriginal ? basename(activeOriginal.sourcePath) : "Import an original to begin editing"}
                {previewState === "error" ? <span className="preview-error">Preview failed</span> : null}
              </div>
            )}
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
            </div>
          ) : null}
          <div className="histogram-placeholder" />
        </section>

        {showOps ? <aside className="panel ops-panel">
          <PanelHeader title="Ops" />
          {activeTask ? (
            <div className="current-ops">
              {activeTask.pipeline.ops.length ? activeTask.pipeline.ops.map((op, index) => (
                <PipelineOpCard
                  catalogItem={opCatalog.find((item) => item.type === op.type) ?? null}
                  disabled={activeTask.status !== "pending"}
                  index={index}
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
          onClose={() => setRenameOpen(false)}
          onPreview={(templateId) => api.rename.preview(templateId)}
          onRun={async (templateId) => {
            await refreshProject(await api.rename.run(templateId));
            setRenameOpen(false);
          }}
          templates={settings.filenameTemplates}
        />
      ) : null}

      {apiKeyOpen ? (
        <div className="modal-backdrop">
          <section className="modal small-modal">
            <header className="modal-header">
              <h2>Settings</h2>
              <button className="toolbar-button" type="button" onClick={() => setApiKeyOpen(false)}>Close</button>
            </header>
            <div className="settings-summary">
              <span>Data directory</span>
              <code>{systemInfo?.dataDir ?? "~/.fotoready"}</code>
            </div>
            <label className="stacked-field">
              Gemini API key
              <input autoFocus type="password" value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.currentTarget.value)} />
            </label>
            <div className="settings-summary">
              <span>Caches</span>
              <code>source {formatBytes(cacheSizes?.sourceFactsBytes ?? 0)} · vision {formatBytes(cacheSizes?.visionFactsBytes ?? 0)}</code>
            </div>
            <footer className="modal-actions">
              <button className="toolbar-button" type="button" onClick={() => void clearCaches()}>Clear caches</button>
              <button className="toolbar-button" type="button" onClick={() => setApiKeyOpen(false)}>Cancel</button>
              <button className="primary-action" type="button" disabled={!apiKeyDraft.trim()} onClick={() => void saveApiKey()}>Save key</button>
            </footer>
          </section>
        </div>
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

      <footer className="status-bar">
        <span>
          Queue: {queue.done}/{queue.total} done
          {queue.processing > 0 ? ` · ${queue.processing} processing` : ""}
          {queue.errors > 0 ? ` · ${queue.errors} errors` : ""}
        </span>
        <button className="icon-button compact" type="button" title="Pause queues">
          <Pause size={15} />
        </button>
        <button className="icon-button compact" type="button" title="Resume queues">
          <Play size={15} />
        </button>
        <span className="version">{systemInfo ? `${systemInfo.appName} ${systemInfo.version}` : "FotoReady"}</span>
      </footer>
    </main>
  );
}

function PipelineOpCard({
  catalogItem,
  disabled,
  index,
  op,
  onEnabledChange,
  onParamChange,
  onRemove
}: {
  catalogItem: OpCatalogItem | null;
  disabled: boolean;
  index: number;
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
      <OpParams op={op} disabled={disabled} onParamChange={onParamChange} />
    </section>
  );
}

function OpParams({
  disabled,
  op,
  onParamChange
}: {
  disabled: boolean;
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

  return <div className="row-detail">Parameters will be available in a later phase.</div>;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

createRoot(document.getElementById("root")!).render(<App />);
