import React, { useMemo, useState } from "react";
import type { SystemInfo } from "@shared/types/ipc";
import type { FilenameTemplate, GlobalSettings } from "@shared/types/settings";
import { validateFilenameTemplates, type FilenameTemplateValidationIssue } from "@shared/validation/filename-template";
import { ModalShell } from "./modal-shell";

type SettingsTab = "output" | "naming" | "metadata" | "vision" | "performance" | "safety";

const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "output", label: "Output" },
  { id: "naming", label: "Naming" },
  { id: "metadata", label: "Metadata" },
  { id: "vision", label: "Vision" },
  { id: "performance", label: "Performance" },
  { id: "safety", label: "Safety" }
];

export function AppSettingsModal({
  apiKeyDraft,
  hasChanges,
  onApiKeyDraftChange,
  onClose,
  onSaveSettings,
  settingsDraft,
  setSettingsDraft,
  systemInfo
}: {
  apiKeyDraft: string;
  hasChanges: boolean;
  onApiKeyDraftChange(value: string): void;
  onClose(): void;
  onSaveSettings(): void;
  settingsDraft: GlobalSettings | null;
  setSettingsDraft(settings: GlobalSettings): void;
  systemInfo: SystemInfo | null;
}): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>("output");
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
    <ModalShell
      title="Settings"
      size="default"
      onClose={onClose}
      footer={
        <>
          <button className="toolbar-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="button" disabled={!settingsDraft || !hasChanges || templateIssues.length > 0} onClick={onSaveSettings}>Save</button>
        </>
      }
    >
      <div className="settings-tabs">
        {TABS.map((entry) => (
          <button className={tab === entry.id ? "active" : ""} key={entry.id} type="button" onClick={() => setTab(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {settingsDraft ? (
        <div className="settings-page">
          {tab === "output" ? <OutputTab settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
          {tab === "naming" ? (
            <NamingTab
              addTemplate={addTemplate}
              deleteTemplate={deleteTemplate}
              settings={settingsDraft}
              setSettings={setSettingsDraft}
              templateIssues={templateIssues}
              updateTemplate={updateTemplate}
            />
          ) : null}
          {tab === "metadata" ? <MetadataTab settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
          {tab === "vision" ? (
            <VisionTab
              apiKeyDraft={apiKeyDraft}
              onApiKeyDraftChange={onApiKeyDraftChange}
              settings={settingsDraft}
              setSettings={setSettingsDraft}
            />
          ) : null}
          {tab === "performance" ? <PerformanceTab settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
          {tab === "safety" ? <SafetyTab settings={settingsDraft} setSettings={setSettingsDraft} systemInfo={systemInfo} /> : null}
        </div>
      ) : null}

      {templateIssues.length > 0 ? <div className="modal-error">Fix filename template issues before saving settings.</div> : null}
    </ModalShell>
  );
}

function OutputTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  return (
    <div className="settings-section-stack">
      <section>
        <h3>Locations</h3>
        <div className="settings-grid">
          <label className="stacked-field span-two">
            Default output directory
            <input type="text" placeholder="(empty = save next to source)" value={settings.defaultOutputDirectory} onChange={(event) => setSettings({ ...settings, defaultOutputDirectory: event.currentTarget.value })} />
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
      </section>

      <section>
        <h3>Format</h3>
        <div className="settings-grid">
          <SelectField label="Format" value={settings.defaultOutputFormat} values={["jpeg", "webp", "avif", "png"]} onChange={(value) => setSettings({ ...settings, defaultOutputFormat: value as GlobalSettings["defaultOutputFormat"] })} />
          <label className="stacked-field">
            Flatten transparency against
            <input type="color" value={settings.defaultBackgroundForTransparency} onChange={(event) => setSettings({ ...settings, defaultBackgroundForTransparency: event.currentTarget.value })} />
          </label>
        </div>
      </section>

      <section>
        <h3>JPEG</h3>
        <div className="settings-grid">
          <SelectField label="Strategy" value={settings.jpegStrategy} values={["match-source-size", "match-source-quality", "fixed", "prompt-per-task"]} onChange={(value) => setSettings({ ...settings, jpegStrategy: value as GlobalSettings["jpegStrategy"] })} />
          <NumberField label="Fixed quality" max={100} min={1} value={settings.jpegFixedQuality} onChange={(value) => setSettings({ ...settings, jpegFixedQuality: value })} />
          <NumberField label="Detection fallback quality" max={100} min={1} value={settings.jpegQualityOnDetectionFailure} onChange={(value) => setSettings({ ...settings, jpegQualityOnDetectionFailure: value })} />
          <SelectField label="Chroma subsampling" value={settings.jpegChromaSubsampling} values={["4:2:0", "4:2:2", "4:4:4"]} onChange={(value) => setSettings({ ...settings, jpegChromaSubsampling: value as GlobalSettings["jpegChromaSubsampling"] })} />
          <label className="toggle-row">
            <input type="checkbox" checked={settings.jpegProgressive} onChange={(event) => setSettings({ ...settings, jpegProgressive: event.currentTarget.checked })} />
            Progressive
          </label>
        </div>
      </section>

      <section>
        <h3>WebP</h3>
        <div className="settings-grid">
          <NumberField label="Quality" max={100} min={1} value={settings.defaultWebpQuality} onChange={(value) => setSettings({ ...settings, defaultWebpQuality: value })} />
          <NumberField label="Method" max={6} min={0} value={settings.webpMethod} onChange={(value) => setSettings({ ...settings, webpMethod: value })} />
        </div>
      </section>

      <section>
        <h3>AVIF</h3>
        <div className="settings-grid">
          <NumberField label="Quality" max={100} min={1} value={settings.defaultAvifQuality} onChange={(value) => setSettings({ ...settings, defaultAvifQuality: value })} />
          <NumberField label="Effort" max={9} min={0} value={settings.avifEffort} onChange={(value) => setSettings({ ...settings, avifEffort: value })} />
        </div>
      </section>

      <section>
        <h3>PNG</h3>
        <div className="settings-grid">
          <label className="toggle-row">
            <input type="checkbox" checked={settings.defaultPngPalette} onChange={(event) => setSettings({ ...settings, defaultPngPalette: event.currentTarget.checked })} />
            Indexed palette (smaller files)
          </label>
        </div>
      </section>
    </div>
  );
}

function NamingTab({ addTemplate, deleteTemplate, settings, setSettings, templateIssues, updateTemplate }: SettingsProps & {
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
    <div className="settings-section-stack">
      <section>
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
      </section>

      <section>
        <h3>Slug rules</h3>
        <div className="settings-grid">
          <NumberField label="Min words" max={12} min={1} value={settings.slugMinWords} onChange={(value) => setSettings({ ...settings, slugMinWords: value })} />
          <NumberField label="Max words" max={16} min={1} value={settings.slugMaxWords} onChange={(value) => setSettings({ ...settings, slugMaxWords: value })} />
          <NumberField label="Hash suffix length" max={16} min={2} value={settings.hashSuffixLength} onChange={(value) => setSettings({ ...settings, hashSuffixLength: value })} />
        </div>
      </section>
    </div>
  );
}

function MetadataTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  const fields = ["author", "authorRole", "copyright", "webStatement", "usageTerms", "credit", "source", "contactEmail", "contactUrl"] as const;
  return (
    <div className="settings-section-stack">
      <section>
        <h3>Behavior</h3>
        <div className="settings-grid">
          <label className="toggle-row span-two">
            <input type="checkbox" checked={settings.injectAuthorCopyright} onChange={(event) => setSettings({ ...settings, injectAuthorCopyright: event.currentTarget.checked })} />
            Inject author/copyright metadata into saved files
          </label>
          <label className="toggle-row span-two">
            <input type="checkbox" checked={settings.preserveSourceDates} onChange={(event) => setSettings({ ...settings, preserveSourceDates: event.currentTarget.checked })} />
            Preserve source file dates
          </label>
        </div>
      </section>

      <section>
        <h3>Metadata fields</h3>
        <div className="settings-grid">
          {fields.map((field) => (
            <label className="stacked-field" key={field}>
              {fieldLabel(field)}
              <input type="text" value={settings.injectFields[field] ?? ""} onChange={(event) => setSettings({ ...settings, injectFields: { ...settings.injectFields, [field]: event.currentTarget.value } })} />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function VisionTab({ apiKeyDraft, onApiKeyDraftChange, settings, setSettings }: SettingsProps & { apiKeyDraft: string; onApiKeyDraftChange(value: string): void }): React.JSX.Element {
  return (
    <div className="settings-section-stack">
      <section>
        <h3>Gemini</h3>
        <div className="settings-grid">
          <label className="stacked-field span-two">
            API key
            <input autoFocus type="password" value={apiKeyDraft} onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)} />
          </label>
          <label className="stacked-field">
            Model
            <input type="text" value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.currentTarget.value })} />
          </label>
          <NumberField label="Image long edge" max={4096} min={128} value={settings.preResizeLongEdge} onChange={(value) => setSettings({ ...settings, preResizeLongEdge: value })} />
        </div>
      </section>

      <section>
        <h3>Prompt</h3>
        <div className="settings-grid">
          <label className="toggle-row span-two">
            <input type="checkbox" checked={settings.defaultAnalyzeContent} onChange={(event) => setSettings({ ...settings, defaultAnalyzeContent: event.currentTarget.checked })} />
            Describe new tasks by default
          </label>
          <label className="stacked-field span-two">
            Project context
            <input type="text" placeholder="Optional context shared with every vision request" value={settings.visionProjectContext} onChange={(event) => setSettings({ ...settings, visionProjectContext: event.currentTarget.value })} />
          </label>
          <label className="stacked-field span-two">
            Prompt addendum
            <input type="text" value={settings.customPromptAddendum} onChange={(event) => setSettings({ ...settings, customPromptAddendum: event.currentTarget.value })} />
          </label>
        </div>
      </section>
    </div>
  );
}

function PerformanceTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  return (
    <div className="settings-section-stack">
      <section>
        <h3>Throughput</h3>
        <div className="settings-grid">
          <NumberField label="Concurrent saves" max={16} min={1} value={settings.workerPoolSize} onChange={(value) => setSettings({ ...settings, workerPoolSize: value })} />
        </div>
      </section>

      <section>
        <h3>Preview</h3>
        <div className="settings-grid">
          <NumberField label="Preview long edge" max={4096} min={320} value={settings.previewLongEdge} onChange={(value) => setSettings({ ...settings, previewLongEdge: value })} />
          <NumberField label="Preview debounce (ms)" max={2000} min={0} value={settings.previewDebounceMs} onChange={(value) => setSettings({ ...settings, previewDebounceMs: value })} />
        </div>
      </section>
    </div>
  );
}

function SafetyTab({ settings, setSettings, systemInfo }: SettingsProps & { systemInfo: SystemInfo | null }): React.JSX.Element {
  return (
    <div className="settings-section-stack">
      <section>
        <h3>Confirmations</h3>
        <div className="settings-grid">
          <label className="toggle-row span-two">
            <input type="checkbox" checked={settings.confirmDeleteOriginalWithTasks} onChange={(event) => setSettings({ ...settings, confirmDeleteOriginalWithTasks: event.currentTarget.checked })} />
            Confirm before removing an original that has saved tasks
          </label>
          <label className="toggle-row span-two">
            <input type="checkbox" checked={settings.confirmDeleteOutputFiles} onChange={(event) => setSettings({ ...settings, confirmDeleteOutputFiles: event.currentTarget.checked })} />
            Confirm before deleting output files from disk
          </label>
        </div>
      </section>

      <section>
        <h3>Data location</h3>
        <div className="settings-summary">
          <span>Settings & state</span>
          <code>{systemInfo?.dataDir ?? "~/.fotoready"}</code>
        </div>
      </section>
    </div>
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

function fieldLabel(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`).replace(/^./, (letter) => letter.toUpperCase());
}
