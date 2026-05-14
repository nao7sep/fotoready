import React, { useMemo, useState } from "react";
import type { CacheSizes, SystemInfo } from "@shared/types/ipc";
import type { FilenameTemplate, GlobalSettings } from "@shared/types/settings";
import { validateFilenameTemplates, type FilenameTemplateValidationIssue } from "@shared/validation/filename-template";

type SettingsTab = "general" | "encoding" | "vision" | "metadata" | "naming" | "paths" | "performance" | "caches";

export function AppSettingsModal({
  apiKeyDraft,
  cacheSizes,
  onApiKeyDraftChange,
  onClearCaches,
  onClose,
  onSaveApiKey,
  onSaveSettings,
  settingsDraft,
  setSettingsDraft,
  systemInfo
}: {
  apiKeyDraft: string;
  cacheSizes: CacheSizes | null;
  onApiKeyDraftChange(value: string): void;
  onClearCaches(): void;
  onClose(): void;
  onSaveApiKey(): void;
  onSaveSettings(): void;
  settingsDraft: GlobalSettings | null;
  setSettingsDraft(settings: GlobalSettings): void;
  systemInfo: SystemInfo | null;
}): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>("general");
  const templateIssues = useMemo(
    () => settingsDraft ? validateFilenameTemplates(settingsDraft.filenameTemplates, settingsDraft.defaultTemplateId) : [],
    [settingsDraft]
  );

  function updateTemplate(templateId: string, patch: Partial<FilenameTemplate>): void {
    if (!settingsDraft) return;
    setSettingsDraft({
      ...settingsDraft,
      filenameTemplates: settingsDraft.filenameTemplates.map((template) => (
        template.id === templateId ? { ...template, ...patch } : template
      ))
    });
  }

  function addTemplate(): void {
    if (!settingsDraft) return;
    const id = `template-${crypto.randomUUID()}`;
    setSettingsDraft({
      ...settingsDraft,
      defaultTemplateId: id,
      filenameTemplates: [
        ...settingsDraft.filenameTemplates,
        { id, name: "Custom template", pattern: "{slug}-{date:saved|local|yyyymmdd}.{ext}" }
      ]
    });
  }

  function deleteTemplate(templateId: string): void {
    if (!settingsDraft) return;
    const nextTemplates = settingsDraft.filenameTemplates.filter((template) => template.id !== templateId || template.builtin);
    const fallbackTemplateId = nextTemplates[0]?.id ?? settingsDraft.defaultTemplateId;
    setSettingsDraft({
      ...settingsDraft,
      filenameTemplates: nextTemplates,
      defaultTemplateId: settingsDraft.defaultTemplateId === templateId ? fallbackTemplateId : settingsDraft.defaultTemplateId
    });
  }

  return (
    <div className="modal-backdrop">
      <section className="modal settings-modal">
        <header className="modal-header">
          <h2>Settings</h2>
          <button className="toolbar-button" type="button" onClick={onClose}>Close</button>
        </header>

        <div className="settings-tabs">
          {(["general", "encoding", "vision", "metadata", "naming", "paths", "performance", "caches"] as const).map((item) => (
            <button className={tab === item ? "active" : ""} key={item} type="button" onClick={() => setTab(item)}>{tabLabel(item)}</button>
          ))}
        </div>

        {settingsDraft ? (
          <div className="settings-page">
            {tab === "general" ? <GeneralSettings settings={settingsDraft} setSettings={setSettingsDraft} systemInfo={systemInfo} /> : null}
            {tab === "encoding" ? <EncodingSettings settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
            {tab === "vision" ? (
              <VisionSettings
                apiKeyDraft={apiKeyDraft}
                onApiKeyDraftChange={onApiKeyDraftChange}
                settings={settingsDraft}
                setSettings={setSettingsDraft}
              />
            ) : null}
            {tab === "metadata" ? <MetadataSettings settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
            {tab === "naming" ? (
              <NamingSettings
                addTemplate={addTemplate}
                deleteTemplate={deleteTemplate}
                settings={settingsDraft}
                setSettings={setSettingsDraft}
                templateIssues={templateIssues}
                updateTemplate={updateTemplate}
              />
            ) : null}
            {tab === "paths" ? <PathSettings settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
            {tab === "performance" ? <PerformanceSettings settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
            {tab === "caches" ? <CacheSettings cacheSizes={cacheSizes} onClearCaches={onClearCaches} /> : null}
          </div>
        ) : null}

        {templateIssues.length > 0 ? <div className="modal-error">Fix filename template issues before saving settings.</div> : null}

        <footer className="modal-actions">
          <button className="toolbar-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="button" disabled={!apiKeyDraft.trim()} onClick={onSaveApiKey}>Save key</button>
          <button className="primary-action" type="button" disabled={!settingsDraft || templateIssues.length > 0} onClick={onSaveSettings}>Save settings</button>
        </footer>
      </section>
    </div>
  );
}

function GeneralSettings({ settings, setSettings, systemInfo }: SettingsProps & { systemInfo: SystemInfo | null }): React.JSX.Element {
  return (
    <>
      <div className="settings-summary">
        <span>Data directory</span>
        <code>{systemInfo?.dataDir ?? "~/.fotoready"}</code>
      </div>
      <div className="settings-grid">
        <label className="toggle-row">
          <input type="checkbox" checked={settings.confirmDeleteOriginalWithTasks} onChange={(event) => setSettings({ ...settings, confirmDeleteOriginalWithTasks: event.currentTarget.checked })} />
          Confirm original deletes
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={settings.confirmDeleteOutputFiles} onChange={(event) => setSettings({ ...settings, confirmDeleteOutputFiles: event.currentTarget.checked })} />
          Confirm output deletes
        </label>
      </div>
    </>
  );
}

function EncodingSettings({ settings, setSettings }: SettingsProps): React.JSX.Element {
  return (
    <div className="settings-grid">
      <SelectField label="Default format" value={settings.defaultOutputFormat} values={["jpeg", "webp", "avif", "png"]} onChange={(value) => setSettings({ ...settings, defaultOutputFormat: value as GlobalSettings["defaultOutputFormat"] })} />
      <NumberField label="WebP quality" max={100} min={1} value={settings.defaultWebpQuality} onChange={(value) => setSettings({ ...settings, defaultWebpQuality: value })} />
      <SelectField label="JPEG strategy" value={settings.jpegStrategy} values={["match-source-size", "match-source-quality", "fixed", "prompt-per-task"]} onChange={(value) => setSettings({ ...settings, jpegStrategy: value as GlobalSettings["jpegStrategy"] })} />
      <NumberField label="JPEG fixed quality" max={100} min={1} value={settings.jpegFixedQuality} onChange={(value) => setSettings({ ...settings, jpegFixedQuality: value })} />
      <NumberField label="JPEG fallback quality" max={100} min={1} value={settings.jpegQualityOnDetectionFailure} onChange={(value) => setSettings({ ...settings, jpegQualityOnDetectionFailure: value })} />
      <SelectField label="JPEG chroma" value={settings.jpegChromaSubsampling} values={["4:2:0", "4:2:2", "4:4:4"]} onChange={(value) => setSettings({ ...settings, jpegChromaSubsampling: value as GlobalSettings["jpegChromaSubsampling"] })} />
      <NumberField label="WebP method" max={6} min={0} value={settings.webpMethod} onChange={(value) => setSettings({ ...settings, webpMethod: value })} />
      <NumberField label="AVIF quality" max={100} min={1} value={settings.defaultAvifQuality} onChange={(value) => setSettings({ ...settings, defaultAvifQuality: value })} />
      <NumberField label="AVIF effort" max={9} min={0} value={settings.avifEffort} onChange={(value) => setSettings({ ...settings, avifEffort: value })} />
      <label className="toggle-row">
        <input type="checkbox" checked={settings.defaultPngPalette} onChange={(event) => setSettings({ ...settings, defaultPngPalette: event.currentTarget.checked })} />
        PNG palette
      </label>
    </div>
  );
}

function VisionSettings({ apiKeyDraft, onApiKeyDraftChange, settings, setSettings }: SettingsProps & { apiKeyDraft: string; onApiKeyDraftChange(value: string): void }): React.JSX.Element {
  return (
    <div className="settings-grid">
      <label className="stacked-field span-two">
        Gemini API key
        <input autoFocus type="password" value={apiKeyDraft} onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)} />
      </label>
      <label className="stacked-field">
        Vision model
        <input type="text" value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.currentTarget.value })} />
      </label>
      <NumberField label="Vision long edge" max={4096} min={128} value={settings.preResizeLongEdge} onChange={(value) => setSettings({ ...settings, preResizeLongEdge: value })} />
      <label className="toggle-row">
        <input type="checkbox" checked={settings.defaultAnalyzeContent} onChange={(event) => setSettings({ ...settings, defaultAnalyzeContent: event.currentTarget.checked })} />
        Describe by default
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={settings.cacheResults} onChange={(event) => setSettings({ ...settings, cacheResults: event.currentTarget.checked })} />
        Cache vision
      </label>
      <label className="stacked-field span-two">
        Prompt addendum
        <input type="text" value={settings.customPromptAddendum} onChange={(event) => setSettings({ ...settings, customPromptAddendum: event.currentTarget.value })} />
      </label>
      <label className="stacked-field span-two">
        Project context
        <input type="text" placeholder="Optional context shared with every vision request" value={settings.visionProjectContext} onChange={(event) => setSettings({ ...settings, visionProjectContext: event.currentTarget.value })} />
      </label>
    </div>
  );
}

function MetadataSettings({ settings, setSettings }: SettingsProps): React.JSX.Element {
  const fields = ["author", "authorRole", "copyright", "webStatement", "usageTerms", "credit", "source", "contactEmail", "contactUrl"] as const;
  return (
    <div className="settings-grid">
      <label className="toggle-row span-two">
        <input type="checkbox" checked={settings.injectAuthorCopyright} onChange={(event) => setSettings({ ...settings, injectAuthorCopyright: event.currentTarget.checked })} />
        Inject metadata
      </label>
      <label className="toggle-row span-two">
        <input type="checkbox" checked={settings.preserveSourceDates} onChange={(event) => setSettings({ ...settings, preserveSourceDates: event.currentTarget.checked })} />
        Preserve source dates
      </label>
      {fields.map((field) => (
        <label className="stacked-field" key={field}>
          {fieldLabel(field)}
          <input type="text" value={settings.injectFields[field] ?? ""} onChange={(event) => setSettings({ ...settings, injectFields: { ...settings.injectFields, [field]: event.currentTarget.value } })} />
        </label>
      ))}
    </div>
  );
}

function NamingSettings({ addTemplate, deleteTemplate, settings, setSettings, templateIssues, updateTemplate }: SettingsProps & {
  addTemplate(): void;
  deleteTemplate(templateId: string): void;
  templateIssues: FilenameTemplateValidationIssue[];
  updateTemplate(templateId: string, patch: Partial<FilenameTemplate>): void;
}): React.JSX.Element {
  const generalIssues = templateIssues.filter((issue) => issue.templateId === null);
  const issuesByTemplateId = templateIssues.reduce<Record<string, string[]>>((result, issue) => {
    if (!issue.templateId) return result;
    result[issue.templateId] = [...(result[issue.templateId] ?? []), issue.message];
    return result;
  }, {});

  return (
    <section className="template-settings">
      <div className="settings-section-header">
        <h3>Filename templates</h3>
        <button className="toolbar-button" type="button" onClick={addTemplate}>Add template</button>
      </div>
      <div className="settings-summary">
        <span>Supported placeholders</span>
        <code>{"{slug} {w} {h} {ext} {index} {index:03} {hash:8} {date:saved|local|yyyymmdd}"}</code>
      </div>
      <label className="stacked-field">
        Default template
        <select value={settings.defaultTemplateId} onChange={(event) => setSettings({ ...settings, defaultTemplateId: event.currentTarget.value })}>
          {settings.filenameTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
      </label>
      {generalIssues.map((issue, index) => (
        <div className="modal-error" key={`${issue.message}-${index}`}>{issue.message}</div>
      ))}
      <div className="template-settings-list">
        {settings.filenameTemplates.map((template) => (
          <div className="template-settings-item" key={template.id}>
            <div className="template-settings-row">
              <input aria-label="Template name" disabled={template.builtin} type="text" value={template.name} onChange={(event) => updateTemplate(template.id, { name: event.currentTarget.value })} />
              <input aria-label="Template pattern" disabled={template.builtin} type="text" value={template.pattern} onChange={(event) => updateTemplate(template.id, { pattern: event.currentTarget.value })} />
              <button className="toolbar-button" disabled={template.builtin} type="button" onClick={() => deleteTemplate(template.id)}>Delete</button>
            </div>
            {(issuesByTemplateId[template.id] ?? []).map((message, index) => (
              <div className="modal-error" key={`${template.id}-${index}`}>{message}</div>
            ))}
          </div>
        ))}
      </div>
      <div className="settings-grid">
        <NumberField label="Slug min words" max={12} min={1} value={settings.slugMinWords} onChange={(value) => setSettings({ ...settings, slugMinWords: value })} />
        <NumberField label="Slug max words" max={16} min={1} value={settings.slugMaxWords} onChange={(value) => setSettings({ ...settings, slugMaxWords: value })} />
        <NumberField label="Hash suffix length" max={16} min={2} value={settings.hashSuffixLength} onChange={(value) => setSettings({ ...settings, hashSuffixLength: value })} />
      </div>
    </section>
  );
}

function PathSettings({ settings, setSettings }: SettingsProps): React.JSX.Element {
  return (
    <div className="settings-grid">
      <label className="stacked-field span-two">
        Default output directory
        <input type="text" value={settings.defaultOutputDirectory} onChange={(event) => setSettings({ ...settings, defaultOutputDirectory: event.currentTarget.value })} />
      </label>
      <label className="stacked-field span-two">
        LUT folder
        <input type="text" value={settings.lutFolder} onChange={(event) => setSettings({ ...settings, lutFolder: event.currentTarget.value })} />
      </label>
      <label className="stacked-field span-two">
        Default watermark image
        <input type="text" value={settings.defaultWatermarkImage} onChange={(event) => setSettings({ ...settings, defaultWatermarkImage: event.currentTarget.value })} />
      </label>
    </div>
  );
}

function PerformanceSettings({ settings, setSettings }: SettingsProps): React.JSX.Element {
  return (
    <div className="settings-grid">
      <NumberField label="Worker pool" max={16} min={1} value={settings.workerPoolSize} onChange={(value) => setSettings({ ...settings, workerPoolSize: value })} />
      <NumberField label="Preview long edge" max={4096} min={320} value={settings.previewLongEdge} onChange={(value) => setSettings({ ...settings, previewLongEdge: value })} />
      <NumberField label="Preview debounce" max={2000} min={0} value={settings.previewDebounceMs} onChange={(value) => setSettings({ ...settings, previewDebounceMs: value })} />
    </div>
  );
}

function CacheSettings({ cacheSizes, onClearCaches }: { cacheSizes: CacheSizes | null; onClearCaches(): void }): React.JSX.Element {
  return (
    <>
      <div className="settings-summary">
        <span>Caches</span>
        <code>source {formatBytes(cacheSizes?.sourceFactsBytes ?? 0)} · vision {formatBytes(cacheSizes?.visionFactsBytes ?? 0)}</code>
      </div>
      <button className="toolbar-button fit-content" type="button" onClick={onClearCaches}>Clear caches</button>
    </>
  );
}

type SettingsProps = {
  settings: GlobalSettings;
  setSettings(settings: GlobalSettings): void;
};

function NumberField({ label, max, min, onChange, value }: { label: string; max: number; min: number; onChange(value: number): void; value: number }): React.JSX.Element {
  return (
    <label className="stacked-field">
      {label}
      <input max={max} min={min} type="number" value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    </label>
  );
}

function SelectField({ label, onChange, value, values }: { label: string; onChange(value: string): void; value: string; values: string[] }): React.JSX.Element {
  return (
    <label className="stacked-field">
      {label}
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {values.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
  );
}

function tabLabel(tab: SettingsTab): string {
  return tab[0].toUpperCase() + tab.slice(1);
}

function fieldLabel(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`).replace(/^./, (letter) => letter.toUpperCase());
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
