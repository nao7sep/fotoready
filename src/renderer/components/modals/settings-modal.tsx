import React, { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import type { SystemInfo } from "@shared/types/ipc";
import type { FilenameTemplate, GlobalSettings, MetadataFields } from "@shared/types/settings";
import { availableOutputFormats, formatLabel } from "@shared/output-format";
import { DEFAULT_LUT_FOLDER } from "@shared/constants";
import { validateFilenameTemplates } from "@shared/validation/filename-template";
import { ModalShell } from "./modal-shell";

type SettingsTab = "save" | "naming" | "metadata" | "vision" | "assets" | "app";

const tabs: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "save", label: "Save" },
  { id: "naming", label: "Naming" },
  { id: "metadata", label: "Metadata" },
  { id: "vision", label: "Vision" },
  { id: "assets", label: "Assets" },
  { id: "app", label: "App" }
];

const metadataFieldOrder: ReadonlyArray<keyof MetadataFields> = [
  "author",
  "credit",
  "source",
  "copyright",
  "webStatement",
  "usageTerms",
  "contactEmail",
  "contactUrl",
  "description"
];

const metadataFieldHelp: Record<keyof MetadataFields, string> = {
  author: "Person or organization publishing the saved image.",
  credit: "How downstream users should credit the image in captions or acknowledgements.",
  source: "Origin of the image or the collection it came from.",
  copyright: "Copyright notice, rights owner, or copyright line for the saved output.",
  webStatement: "Public URL that explains rights, licensing, or reuse terms.",
  usageTerms: "Plain-language reuse terms, restrictions, or required attribution wording.",
  contactEmail: "Email address for licensing, takedown, or reuse questions.",
  contactUrl: "Contact page or profile for image-rights questions.",
  description: "Reusable image description for search, databases, alt-like summaries, or later slug generation."
};

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
  const [tab, setTab] = useState<SettingsTab>("save");
  const templateIssues = useMemo(
    () => settingsDraft ? validateFilenameTemplates(settingsDraft.filenameTemplates, settingsDraft.defaultTemplateId) : [],
    [settingsDraft]
  );

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
        {tabs.map((entry) => (
          <button className={tab === entry.id ? "active" : ""} key={entry.id} type="button" onClick={() => setTab(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {settingsDraft ? (
        <div className="settings-page">
          {tab === "save" ? <SaveTab settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
          {tab === "naming" ? <NamingTab settings={settingsDraft} setSettings={setSettingsDraft} templateIssues={templateIssues} /> : null}
          {tab === "metadata" ? <MetadataTab settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
          {tab === "vision" ? (
            <VisionTab
              apiKeyDraft={apiKeyDraft}
              onApiKeyDraftChange={onApiKeyDraftChange}
              settings={settingsDraft}
              setSettings={setSettingsDraft}
            />
          ) : null}
          {tab === "assets" ? <AssetsTab settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
          {tab === "app" ? <AppTab settings={settingsDraft} setSettings={setSettingsDraft} systemInfo={systemInfo} /> : null}
        </div>
      ) : null}
    </ModalShell>
  );
}

function SaveTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  const outputFormatOptions = useMemo(
    () => availableOutputFormats().map((format) => ({ value: format, label: formatLabel(format) })),
    []
  );

  return (
    <div className="settings-section-stack">
      <section>
        <h3>Default save location</h3>
        <PathField
          allowClear
          buttonLabel="Choose folder…"
          emptyLabel="Same folder as original"
          label="Default output directory"
          pick={async () => window.api.system.pickDirectory({ title: "Choose Default Output Directory" })}
          value={settings.defaultOutputDirectory}
          onChange={(value) => setSettings({ ...settings, defaultOutputDirectory: value })}
        />
      </section>

      <section>
        <h3>Default format</h3>
        <div className="settings-grid">
          <SelectField
            label="Format"
            options={outputFormatOptions}
            value={settings.defaultOutputFormat}
            onChange={(value) => setSettings({ ...settings, defaultOutputFormat: value as GlobalSettings["defaultOutputFormat"] })}
          />
          <label className="toggle-row settings-toggle-card">
            <input type="checkbox" checked={settings.defaultFlattenTransparency} onChange={(event) => setSettings({ ...settings, defaultFlattenTransparency: event.currentTarget.checked })} />
            Flatten transparency by default for formats that support alpha
          </label>
          <label className="stacked-field">
            Background color when transparency is flattened
            <input type="color" value={settings.defaultBackgroundForTransparency} onChange={(event) => setSettings({ ...settings, defaultBackgroundForTransparency: event.currentTarget.value })} />
          </label>
          <div className="row-detail">
            JPEG always needs a background fill. PNG, WebP, and AVIF keep transparency unless this default or a task-level override turns flattening on.
          </div>
        </div>
      </section>

      <section>
        <h3>JPEG defaults</h3>
        <div className="settings-grid">
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.enableJpegQualityEstimate} onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setSettings({
                ...settings,
                enableJpegQualityEstimate: enabled,
                jpegQualityMode: enabled ? settings.jpegQualityMode : "fixed"
              });
            }} />
            Estimate source JPEG quality from loaded image bytes
          </label>
          <label className="stacked-field">
            Quality mode
            <select value={settings.jpegQualityMode} onChange={(event) => setSettings({ ...settings, jpegQualityMode: event.currentTarget.value as GlobalSettings["jpegQualityMode"] })}>
              <option disabled={!settings.enableJpegQualityEstimate} value="auto">Assume source JPEG quality</option>
              <option value="fixed">Use fixed quality</option>
            </select>
          </label>
          <NumberField label="Fixed quality" max={100} min={1} value={settings.jpegFixedQuality} onChange={(value) => setSettings({ ...settings, jpegFixedQuality: value })} />
          <div className="settings-inline-row span-two">
            <SelectField
              label="Chroma subsampling"
              options={[
                { value: "4:2:0", label: "4:2:0" },
                { value: "4:2:2", label: "4:2:2" },
                { value: "4:4:4", label: "4:4:4" }
              ]}
              value={settings.jpegChromaSubsampling}
              onChange={(value) => setSettings({ ...settings, jpegChromaSubsampling: value as GlobalSettings["jpegChromaSubsampling"] })}
            />
            <label className="toggle-row settings-inline-toggle">
              <input type="checkbox" checked={settings.jpegProgressive} onChange={(event) => setSettings({ ...settings, jpegProgressive: event.currentTarget.checked })} />
              Progressive JPEG
            </label>
          </div>
          <div className="row-detail">
            Quality estimation is only used for confirmed JPEG inputs and only while the file is being loaded into memory.
          </div>
        </div>
      </section>

      <section>
        <h3>PNG defaults</h3>
        <label className="toggle-row settings-toggle-card">
          <input type="checkbox" checked={settings.defaultPngPalette} onChange={(event) => setSettings({ ...settings, defaultPngPalette: event.currentTarget.checked })} />
          Use indexed palette PNG when possible (256-color style, smaller files)
        </label>
      </section>

      <section>
        <h3>WebP defaults</h3>
        <div className="settings-grid">
          <NumberField label="Quality" max={100} min={1} value={settings.defaultWebpQuality} onChange={(value) => setSettings({ ...settings, defaultWebpQuality: value })} />
          <NumberField label="Method" max={6} min={0} value={settings.webpMethod} onChange={(value) => setSettings({ ...settings, webpMethod: value })} />
        </div>
      </section>

      <section>
        <h3>AVIF defaults</h3>
        <div className="settings-grid">
          <NumberField label="Quality" max={100} min={1} value={settings.defaultAvifQuality} onChange={(value) => setSettings({ ...settings, defaultAvifQuality: value })} />
          <NumberField label="Effort" max={9} min={0} value={settings.avifEffort} onChange={(value) => setSettings({ ...settings, avifEffort: value })} />
        </div>
      </section>
    </div>
  );
}

function NamingTab({
  settings,
  setSettings,
  templateIssues
}: SettingsProps & { templateIssues: ReturnType<typeof validateFilenameTemplates> }): React.JSX.Element {
  function updateTemplate(templateId: string, patch: Partial<FilenameTemplate>): void {
    setSettings({
      ...settings,
      filenameTemplates: settings.filenameTemplates.map((template) => template.id === templateId ? { ...template, ...patch } : template)
    });
  }

  function addTemplate(): void {
    setSettings({
      ...settings,
      filenameTemplates: [
        ...settings.filenameTemplates,
        { id: `custom-${nanoid(6)}`, name: "Custom template", pattern: "{slug}{ext}" }
      ]
    });
  }

  function removeTemplate(templateId: string): void {
    const nextTemplates = settings.filenameTemplates.filter((template) => template.id !== templateId);
    const nextDefaultTemplateId = settings.defaultTemplateId === templateId ? nextTemplates[0]?.id ?? settings.defaultTemplateId : settings.defaultTemplateId;
    setSettings({ ...settings, filenameTemplates: nextTemplates, defaultTemplateId: nextDefaultTemplateId });
  }

  return (
    <div className="settings-section-stack">
      <section>
        <div className="settings-section-header">
          <h3>Filename templates</h3>
          <button className="toolbar-button" type="button" onClick={addTemplate}>Add template</button>
        </div>
        <div className="settings-summary">
          <span>Supported placeholders</span>
          <code>{"{slug} {original} {w} {h} {ext}"}</code>
        </div>
        <div className="template-settings-list">
          {settings.filenameTemplates.map((template) => {
            const selected = settings.defaultTemplateId === template.id;
            const issues = templateIssues.filter((issue) => issue.templateId === template.id);
            return (
              <div className={`template-settings-card ${selected ? "active" : ""}`} key={template.id}>
                <div className="template-settings-card-header">
                  <strong>{template.builtin ? "Built-in" : "Custom"}</strong>
                  <div className="template-settings-actions">
                    <button className="toolbar-button" type="button" disabled={selected} onClick={() => setSettings({ ...settings, defaultTemplateId: template.id })}>
                      {selected ? "Default" : "Use as default"}
                    </button>
                    {!template.builtin ? <button className="toolbar-button" type="button" onClick={() => removeTemplate(template.id)}>Delete</button> : null}
                  </div>
                </div>
                <div className="template-settings-row">
                  <label className="stacked-field">
                    Template name
                    <input
                      disabled={template.builtin}
                      type="text"
                      value={template.name}
                      onChange={(event) => updateTemplate(template.id, { name: event.currentTarget.value })}
                    />
                  </label>
                  <label className="stacked-field">
                    Filename pattern
                    <input
                      disabled={template.builtin}
                      type="text"
                      value={template.pattern}
                      onChange={(event) => updateTemplate(template.id, { pattern: event.currentTarget.value })}
                    />
                  </label>
                </div>
                {issues.length > 0 ? (
                  <div className="template-settings-errors">
                    {issues.map((issue) => <div className="modal-error" key={issue.message}>{issue.message}</div>)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {templateIssues.filter((issue) => issue.templateId === null).map((issue) => (
          <div className="modal-error" key={issue.message}>{issue.message}</div>
        ))}
      </section>
    </div>
  );
}

function MetadataTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  return (
    <div className="settings-section-stack">
      <section>
        <h3>Behavior</h3>
        <div className="settings-grid">
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.injectAuthorCopyright} onChange={(event) => setSettings({ ...settings, injectAuthorCopyright: event.currentTarget.checked })} />
            Write metadata fields into saved files when the format supports them
          </label>
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.preserveSourceDates} onChange={(event) => setSettings({ ...settings, preserveSourceDates: event.currentTarget.checked })} />
            Preserve original capture and creation timestamps when possible
          </label>
        </div>
      </section>

      <section>
        <h3>Fields</h3>
        <div className="settings-grid">
          {metadataFieldOrder.map((field) => (
            <label className={`stacked-field metadata-field ${field === "usageTerms" || field === "description" ? "span-two" : ""}`} key={field}>
              {fieldLabel(field)}
              {field === "usageTerms" || field === "description" ? (
                <AutoTextarea
                  value={settings.injectFields[field] ?? ""}
                  onChange={(value) => setSettings({ ...settings, injectFields: { ...settings.injectFields, [field]: value } })}
                />
              ) : (
                <input
                  type={field === "contactEmail" ? "email" : field === "contactUrl" || field === "webStatement" ? "url" : "text"}
                  value={settings.injectFields[field] ?? ""}
                  onChange={(event) => setSettings({ ...settings, injectFields: { ...settings.injectFields, [field]: event.currentTarget.value } })}
                />
              )}
              <span className="field-help">{metadataFieldHelp[field]}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function VisionTab({
  apiKeyDraft,
  onApiKeyDraftChange,
  settings,
  setSettings
}: SettingsProps & { apiKeyDraft: string; onApiKeyDraftChange(value: string): void }): React.JSX.Element {
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
          <NumberField label="Vision image long edge" max={4096} min={128} value={settings.preResizeLongEdge} onChange={(value) => setSettings({ ...settings, preResizeLongEdge: value })} />
          <label className="toggle-row settings-toggle-card span-two">
            <input
              type="checkbox"
              checked={settings.defaultGenerateDescription || settings.defaultGenerateSlug}
              disabled={settings.defaultGenerateSlug}
              onChange={(event) => setSettings({ ...settings, defaultGenerateDescription: event.currentTarget.checked })}
            />
            Generate description for new tasks after save
          </label>
          <label className="toggle-row settings-toggle-card span-two">
            <input
              type="checkbox"
              checked={settings.defaultGenerateSlug}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setSettings({
                  ...settings,
                  defaultGenerateSlug: checked,
                  defaultGenerateDescription: checked ? true : settings.defaultGenerateDescription
                });
              }}
            />
            Generate slug for new tasks after save
          </label>
        </div>
      </section>

      <section>
        <h3>Description prompt</h3>
        <label className="stacked-field">
          Prompt
          <textarea rows={5} value={settings.visionDescriptionPrompt} onChange={(event) => setSettings({ ...settings, visionDescriptionPrompt: event.currentTarget.value })} />
        </label>
      </section>

      <section>
        <h3>Slug prompt</h3>
        <label className="stacked-field">
          Prompt
          <textarea rows={5} value={settings.visionSlugPrompt} onChange={(event) => setSettings({ ...settings, visionSlugPrompt: event.currentTarget.value })} />
        </label>
      </section>
    </div>
  );
}

function AssetsTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  return (
    <div className="settings-section-stack">
      <section>
        <h3>LUTs</h3>
        <PathField
          allowClear
          buttonLabel="Choose folder…"
          emptyLabel={`Default (${DEFAULT_LUT_FOLDER})`}
          label="LUT folder"
          pick={async () => window.api.system.pickDirectory({ title: "Choose LUT Folder" })}
          value={settings.lutFolder}
          onChange={(value) => setSettings({ ...settings, lutFolder: value })}
        />
      </section>

      <section>
        <h3>Watermark</h3>
        <PathField
          allowClear
          buttonLabel="Choose image…"
          emptyLabel="No default watermark image"
          label="Default watermark image"
          pick={async () => window.api.system.pickFile({ title: "Choose Default Watermark Image", extensions: ["png"] })}
          value={settings.defaultWatermarkImage}
          onChange={(value) => setSettings({ ...settings, defaultWatermarkImage: value })}
        />
      </section>
    </div>
  );
}

function AppTab({ settings, setSettings, systemInfo }: SettingsProps & { systemInfo: SystemInfo | null }): React.JSX.Element {
  const cpuCount = systemInfo?.cpuCount ?? 8;
  const concurrencyOptions = useMemo(() => buildConcurrencyOptions(cpuCount), [cpuCount]);

  return (
    <div className="settings-section-stack">
      <section>
        <h3>Performance</h3>
        <div className="settings-grid">
          <SelectField
            label="Concurrent saves"
            options={concurrencyOptions}
            value={settings.workerPoolSize === null ? "auto" : String(settings.workerPoolSize)}
            onChange={(value) => setSettings({ ...settings, workerPoolSize: value === "auto" ? null : Number(value) })}
          />
          <NumberField label="Preview image long edge" max={4096} min={320} value={settings.previewLongEdge} onChange={(value) => setSettings({ ...settings, previewLongEdge: value })} />
          <NumberField label="Preview update debounce (ms)" max={2000} min={0} value={settings.previewDebounceMs} onChange={(value) => setSettings({ ...settings, previewDebounceMs: value })} />
          <div className="row-detail">
            Automatic uses this machine&apos;s CPU count to choose a sensible worker count at runtime. This Mac currently reports {cpuCount} logical cores.
          </div>
        </div>
      </section>

      <section>
        <h3>Confirmations</h3>
        <div className="settings-grid">
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.confirmDeleteOriginals} onChange={(event) => setSettings({ ...settings, confirmDeleteOriginals: event.currentTarget.checked })} />
            Confirm before removing originals from the app
          </label>
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.confirmDeleteTasks} onChange={(event) => setSettings({ ...settings, confirmDeleteTasks: event.currentTarget.checked })} />
            Confirm before deleting tasks from the app
          </label>
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.confirmDeleteOutputFiles} onChange={(event) => setSettings({ ...settings, confirmDeleteOutputFiles: event.currentTarget.checked })} />
            Confirm before deleting saved files from disk
          </label>
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

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange(value: string): void;
  options: Array<{ value: string; label: string }>;
  value: string;
}): React.JSX.Element {
  return (
    <label className="stacked-field">
      {label}
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function PathField({
  allowClear,
  buttonLabel,
  emptyLabel,
  label,
  pick,
  value,
  onChange
}: {
  allowClear?: boolean;
  buttonLabel: string;
  emptyLabel: string;
  label: string;
  pick(): Promise<string | null>;
  value: string;
  onChange(value: string): void;
}): React.JSX.Element {
  return (
    <label className="stacked-field span-two">
      {label}
      <div className="settings-path-row">
        <input type="text" placeholder={emptyLabel} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
        <button className="toolbar-button" type="button" onClick={() => void pick().then((picked) => picked !== null ? onChange(picked) : undefined)}>{buttonLabel}</button>
        {allowClear ? <button className="toolbar-button" type="button" onClick={() => onChange("")}>Clear</button> : null}
      </div>
    </label>
  );
}

function AutoTextarea({ value, onChange }: { value: string; onChange(value: string): void }): React.JSX.Element {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.max(node.scrollHeight, 28)}px`;
  }, [value]);

  return <textarea ref={ref} rows={1} value={value} onChange={(event) => onChange(event.currentTarget.value)} />;
}

function fieldLabel(field: keyof MetadataFields): string {
  if (field === "webStatement") return "Rights URL";
  if (field === "usageTerms") return "Usage terms";
  if (field === "contactEmail") return "Contact email";
  if (field === "contactUrl") return "Contact URL";
  return field.replace(/^./, (letter) => letter.toUpperCase());
}

function buildConcurrencyOptions(cpuCount: number): Array<{ value: string; label: string }> {
  const values = new Set<number>([1]);
  let current = 1;
  while (current < cpuCount) {
    current *= 2;
    values.add(Math.min(current, cpuCount));
  }
  if (cpuCount > 2) values.add(cpuCount);
  return [
    { value: "auto", label: `Automatic (recommended, based on ${cpuCount} cores)` },
    ...Array.from(values).sort((left, right) => left - right).map((value) => ({ value: String(value), label: String(value) }))
  ];
}
