import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SystemInfo } from "@shared/types/ipc";
import { DEFAULT_LUT_FOLDER, DEFAULT_STAMP_FOLDER, MAX_ASSET_PICKER_PREVIEW_LONG_EDGE, MAX_PREVIEW_LONG_EDGE, MAX_VISION_IMAGE_LONG_EDGE, MIN_ASSET_PICKER_PREVIEW_LONG_EDGE } from "@shared/constants";
import { EDITABLE_METADATA_FIELDS, type GlobalSettings, type MetadataFields } from "@shared/types/settings";
import { availableOutputFormats, formatLabel } from "@shared/output-format";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY, TEXT_WATERMARK_FONT_OPTIONS } from "@shared/watermark-text-layout";
import { defaultVisionDescriptionPrompt, defaultVisionSlugPrompt } from "@shared/defaults";
import { metadataFieldLabel } from "@renderer/metadata-field-label";
import { ModalShell } from "./modal-shell";

export type SettingsTab = "save" | "metadata" | "vision" | "assets" | "app";

const tabs: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "save", label: "Save" },
  { id: "metadata", label: "Metadata" },
  { id: "vision", label: "Vision" },
  { id: "assets", label: "Assets" },
  { id: "app", label: "App" }
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
  apiKeyClearRequested,
  apiKeyDraft,
  hasChanges,
  hasGeminiApiKey,
  initialTab,
  onApiKeyDraftChange,
  onClearApiKey,
  onKeepApiKey,
  onClose,
  onSaveSettings,
  settingsDraft,
  setSettingsDraft,
  systemInfo
}: {
  apiKeyClearRequested: boolean;
  apiKeyDraft: string;
  hasChanges: boolean;
  hasGeminiApiKey: boolean;
  initialTab: SettingsTab;
  onApiKeyDraftChange(value: string): void;
  onClearApiKey(): void;
  onKeepApiKey(): void;
  onClose(): void;
  onSaveSettings(): void;
  settingsDraft: GlobalSettings | null;
  setSettingsDraft(settings: GlobalSettings): void;
  systemInfo: SystemInfo | null;
}): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // The settings tabs are a tablist: one tab stop (roving tabindex), Left/Right
  // move and activate immediately (switching a settings page is cheap), Home/End
  // jump, and the arrows stop at the ends.
  const tablistRef = useRef<HTMLDivElement>(null);
  const activeTabIndex = tabs.findIndex((entry) => entry.id === tab);
  const focusTabAt = (index: number) => {
    (
      tablistRef.current?.querySelector(
        `[data-tab-index="${index}"]`,
      ) as HTMLElement | null
    )?.focus();
  };
  const onTablistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let target: number | null = null;
    if (e.key === "ArrowRight") target = Math.min(activeTabIndex + 1, tabs.length - 1);
    else if (e.key === "ArrowLeft") target = Math.max(activeTabIndex - 1, 0);
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = tabs.length - 1;
    else return;
    e.preventDefault();
    setTab(tabs[target].id);
    focusTabAt(target);
  };

  return (
    <ModalShell
      title="Settings"
      size="default"
      tall
      onClose={onClose}
      footer={
        <>
          <button className="toolbar-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="button" disabled={!settingsDraft || !hasChanges} onClick={onSaveSettings}>Save</button>
        </>
      }
    >
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Settings sections"
        className="settings-tabs"
        onKeyDown={onTablistKeyDown}
      >
        {tabs.map((entry, index) => (
          <button
            className={tab === entry.id ? "active" : ""}
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            tabIndex={tab === entry.id ? 0 : -1}
            data-tab-index={index}
            type="button"
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {settingsDraft ? (
        <div className="settings-page">
          {tab === "save" ? <SaveTab settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
          {tab === "metadata" ? <MetadataTab settings={settingsDraft} setSettings={setSettingsDraft} /> : null}
          {tab === "vision" ? (
            <VisionTab
              apiKeyDraft={apiKeyDraft}
              apiKeyClearRequested={apiKeyClearRequested}
              hasGeminiApiKey={hasGeminiApiKey}
              onApiKeyDraftChange={onApiKeyDraftChange}
              onClearApiKey={onClearApiKey}
              onKeepApiKey={onKeepApiKey}
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
        <h3>Output folder</h3>
        <div className="settings-grid">
          <PathField
            allowClear
            buttonLabel="Choose folder"
            emptyLabel="Same folder as original"
            label="Folder"
            pick={async () => window.api.system.pickDirectory({ title: "Choose Output Folder" })}
            value={settings.defaultOutputDirectory}
            onChange={(value) => setSettings({ ...settings, defaultOutputDirectory: value })}
          />
          <div className="row-detail">
            New tasks start with this folder. Leave it blank to save beside each source image until you choose a different output folder for the current session.
          </div>
        </div>
      </section>

      <section>
        <h3>Output format</h3>
        <div className="settings-grid">
          <SelectField
            className="span-two"
            label="Default format"
            options={outputFormatOptions}
            value={settings.defaultOutputFormat}
            onChange={(value) => setSettings({ ...settings, defaultOutputFormat: value as GlobalSettings["defaultOutputFormat"] })}
          />
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.defaultFlattenTransparency} onChange={(event) => setSettings({ ...settings, defaultFlattenTransparency: event.currentTarget.checked })} />
            Flatten transparency by default
          </label>
          <label className="stacked-field span-two">
            Background color for flattened exports
            <input type="color" value={settings.defaultBackgroundForTransparency} onChange={(event) => setSettings({ ...settings, defaultBackgroundForTransparency: event.currentTarget.value })} />
          </label>
          <div className="row-detail">
            JPEG always needs a background fill. PNG, WebP, and AVIF keep transparency unless flattening is enabled here or on the task.
          </div>
        </div>
      </section>

      <section>
        <h3>JPEG</h3>
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
          <SelectField
            className="span-two"
            label="Chroma subsampling"
            options={[
              { value: "4:2:0", label: "4:2:0" },
              { value: "4:2:2", label: "4:2:2" },
              { value: "4:4:4", label: "4:4:4" }
            ]}
            value={settings.jpegChromaSubsampling}
            onChange={(value) => setSettings({ ...settings, jpegChromaSubsampling: value as GlobalSettings["jpegChromaSubsampling"] })}
          />
          <div className="row-detail">
            4:4:4 keeps the most color detail. 4:2:0 makes smaller files and stays the safest default for broad web compatibility.
          </div>
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.jpegProgressive} onChange={(event) => setSettings({ ...settings, jpegProgressive: event.currentTarget.checked })} />
            Write progressive JPEGs
          </label>
          <div className="row-detail">
            Quality estimation is only used for confirmed JPEG inputs and only while the file is being loaded into memory.
          </div>
        </div>
      </section>

      <section>
        <h3>PNG</h3>
        <label className="toggle-row settings-toggle-card">
          <input type="checkbox" checked={settings.defaultPngPalette} onChange={(event) => setSettings({ ...settings, defaultPngPalette: event.currentTarget.checked })} />
          Use indexed palette PNG when possible (256-color style, smaller files)
        </label>
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
    </div>
  );
}

function MetadataTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  return (
    <div className="settings-section-stack">
      <section>
        <h3>Output stamps</h3>
        <div className="settings-grid">
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.writeSoftwareTag} onChange={(event) => setSettings({ ...settings, writeSoftwareTag: event.currentTarget.checked })} />
            Write Software tag (FotoReady)
          </label>
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.writeModifyDate} onChange={(event) => setSettings({ ...settings, writeModifyDate: event.currentTarget.checked })} />
            Write ModifyDate (save time, local clock)
          </label>
        </div>
      </section>
      <section>
        <h3>Defaults</h3>
        <p className="row-detail">Used by the Inject metadata op.</p>
        <div className="settings-grid">
          {EDITABLE_METADATA_FIELDS.map((field) => (
            <label className="stacked-field metadata-field span-two" key={field}>
              {metadataFieldLabel(field)}
              <AutoTextarea
                value={settings.injectFields[field] ?? ""}
                onChange={(value) => setSettings({ ...settings, injectFields: { ...settings.injectFields, [field]: value } })}
              />
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
  apiKeyClearRequested,
  hasGeminiApiKey,
  onApiKeyDraftChange,
  onClearApiKey,
  onKeepApiKey,
  settings,
  setSettings
}: SettingsProps & {
  apiKeyDraft: string;
  apiKeyClearRequested: boolean;
  hasGeminiApiKey: boolean;
  onApiKeyDraftChange(value: string): void;
  onClearApiKey(): void;
  onKeepApiKey(): void;
}): React.JSX.Element {
  return (
    <div className="settings-section-stack">
      <section>
        <h3>Gemini</h3>
        <div className="settings-grid">
          <label className="stacked-field span-two">
            API key
            {hasGeminiApiKey && !apiKeyClearRequested ? (
              <>
                <span className="field-help">Gemini API key is saved.</span>
                <div className="settings-path-row">
                  <input
                    placeholder="Type a new key to replace it"
                    type="password"
                    value={apiKeyDraft}
                    onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)}
                  />
                  <button className="toolbar-button" type="button" onClick={onClearApiKey}>Clear</button>
                </div>
                <span className="field-help">Leave this blank to keep the saved key. Type a new key to replace it.</span>
              </>
            ) : hasGeminiApiKey && apiKeyClearRequested ? (
              <>
                <div className="settings-path-row">
                  <input type="password" value={apiKeyDraft} onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)} />
                  <button className="toolbar-button" type="button" onClick={onKeepApiKey}>Keep key</button>
                </div>
                <span className="field-help">Gemini API key will be cleared when you save. Type a new key to replace it instead.</span>
              </>
            ) : (
              <>
                <input type="password" value={apiKeyDraft} onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)} />
                <span className="field-help">No Gemini API key is saved.</span>
              </>
            )}
          </label>
          <label className="stacked-field">
            Model
            <input
              type="text"
              value={settings.model}
              onChange={(event) => setSettings({ ...settings, model: event.currentTarget.value })}
            />
          </label>
          <NumberField label="Vision image long edge" max={MAX_VISION_IMAGE_LONG_EDGE} min={128} value={settings.preResizeLongEdge} onChange={(value) => setSettings({ ...settings, preResizeLongEdge: value })} />
          <NumberField label="Concurrent vision requests" max={32} min={1} value={settings.visionConcurrency} onChange={(value) => setSettings({ ...settings, visionConcurrency: value })} />
          <NumberField label="Request timeout (ms)" max={600000} min={1000} value={settings.visionTimeoutMs} onChange={(value) => setSettings({ ...settings, visionTimeoutMs: value })} />
          <NumberField label="Max retries on failure" max={10} min={0} value={settings.visionMaxRetries} onChange={(value) => setSettings({ ...settings, visionMaxRetries: value })} />
          <NumberField label="Initial retry backoff (ms)" max={30000} min={0} value={settings.visionInitialBackoffMs} onChange={(value) => setSettings({ ...settings, visionInitialBackoffMs: value })} />
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
        <h3>Prompts</h3>
        <label className="stacked-field">
          Description prompt
          <textarea rows={5} value={settings.visionDescriptionPrompt} onChange={(event) => setSettings({ ...settings, visionDescriptionPrompt: event.currentTarget.value })} />
          <button
            className="toolbar-button"
            type="button"
            style={{ justifySelf: "start" }}
            disabled={settings.visionDescriptionPrompt === defaultVisionDescriptionPrompt}
            onClick={() => setSettings({ ...settings, visionDescriptionPrompt: defaultVisionDescriptionPrompt })}
          >
            Reset to default
          </button>
        </label>
        <label className="stacked-field">
          Slug prompt
          <textarea rows={5} value={settings.visionSlugPrompt} onChange={(event) => setSettings({ ...settings, visionSlugPrompt: event.currentTarget.value })} />
          <button
            className="toolbar-button"
            type="button"
            style={{ justifySelf: "start" }}
            disabled={settings.visionSlugPrompt === defaultVisionSlugPrompt}
            onClick={() => setSettings({ ...settings, visionSlugPrompt: defaultVisionSlugPrompt })}
          >
            Reset to default
          </button>
        </label>
      </section>
    </div>
  );
}

function AssetsTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  const fontFamilyListId = useId();

  return (
    <div className="settings-section-stack">
      <section>
        <h3>Imported asset folders</h3>
        <PathField
          allowClear
          buttonLabel="Choose folder"
          emptyLabel={`Default (${DEFAULT_LUT_FOLDER})`}
          label="Imported LUT folder"
          pick={async () => window.api.system.pickDirectory({ title: "Choose LUT Folder" })}
          value={settings.lutFolder}
          onChange={(value) => setSettings({ ...settings, lutFolder: value })}
        />
        <PathField
          allowClear
          buttonLabel="Choose folder"
          emptyLabel={`Default (${DEFAULT_STAMP_FOLDER})`}
          label="Imported stamp folder"
          pick={async () => window.api.system.pickDirectory({ title: "Choose Stamp Folder" })}
          value={settings.stampFolder}
          onChange={(value) => setSettings({ ...settings, stampFolder: value })}
        />
      </section>

      <section>
        <h3>Watermark</h3>
        <div className="settings-grid">
          <PathField
            allowClear
            buttonLabel="Choose file"
            emptyLabel="No default image watermark"
            label="Default image watermark"
            pick={async () => window.api.system.pickFile({ title: "Choose default image watermark", extensions: ["png", "svg"] })}
            value={settings.defaultWatermarkImage}
            onChange={(value) => setSettings({ ...settings, defaultWatermarkImage: value })}
          />
          <label className="stacked-field span-two">
            Default text watermark font family
            <input
              list={fontFamilyListId}
              placeholder={DEFAULT_TEXT_WATERMARK_FONT_FAMILY}
              type="text"
              value={settings.defaultWatermarkTextFontFamily}
              onChange={(event) => setSettings({ ...settings, defaultWatermarkTextFontFamily: event.currentTarget.value })}
            />
            <datalist id={fontFamilyListId}>
              {TEXT_WATERMARK_FONT_OPTIONS.map((option) => (
                <option key={option.label} label={option.label} value={option.value} />
              ))}
            </datalist>
          </label>
          <div className="row-detail">
            New text watermark ops start with this CSS font-family string. Choose a preset or type your own stack.
          </div>
        </div>
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
          <NumberField
            className="span-two"
            label="Preview image long edge"
            max={MAX_PREVIEW_LONG_EDGE}
            min={320}
            value={settings.previewLongEdge}
            onChange={(value) => setSettings({ ...settings, previewLongEdge: value })}
          />
          <div className="row-detail">
            Sets the working size for live previews and the histogram. Lower values feel lighter; higher values make inspection more faithful.
          </div>
          <NumberField
            className="span-two"
            label="Asset picker preview size"
            max={MAX_ASSET_PICKER_PREVIEW_LONG_EDGE}
            min={MIN_ASSET_PICKER_PREVIEW_LONG_EDGE}
            value={settings.assetPickerPreviewLongEdge}
            onChange={(value) => setSettings({ ...settings, assetPickerPreviewLongEdge: value })}
          />
          <div className="row-detail">
            Sets the thumbnail size for LUT and stamp picker modals. Smaller values fit more choices on compact screens.
          </div>
          <NumberField
            className="span-two"
            label="Preview update debounce (ms)"
            max={2000}
            min={0}
            value={settings.previewDebounceMs}
            onChange={(value) => setSettings({ ...settings, previewDebounceMs: value })}
          />
          <div className="row-detail">
            Wait this long after the latest edit before re-rendering the preview. Higher values reduce churn while dragging sliders; lower values feel more immediate.
          </div>
          <SelectField
            className="span-two"
            label="Concurrent saves"
            options={concurrencyOptions}
            value={settings.workerPoolSize === null ? "auto" : String(settings.workerPoolSize)}
            onChange={(value) => setSettings({ ...settings, workerPoolSize: value === "auto" ? null : Number(value) })}
          />
          <div className="row-detail">
            Automatic uses this machine&apos;s CPU count to choose a sensible worker count at runtime. This Mac currently reports {cpuCount} logical cores.
          </div>
        </div>
      </section>

      <section>
        <h3>Window</h3>
        <div className="settings-grid">
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.maximizeOnStartup} onChange={(event) => setSettings({ ...settings, maximizeOnStartup: event.currentTarget.checked })} />
            Maximize window on startup
          </label>
          <div className="row-detail">
            Opens the app at the size of a manual window maximize (no fullscreen). The menu bar and dock stay visible.
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
            Confirm before moving saved files to the trash
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

function NumberField({
  className,
  label,
  max,
  min,
  onChange,
  value
}: {
  className?: string;
  label: string;
  max: number;
  min: number;
  onChange(value: number): void;
  value: number;
}): React.JSX.Element {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const issue = getNumberFieldIssue(draftValue, min, max);

  return (
    <label className={`stacked-field${className ? ` ${className}` : ""}`}>
      {label}
      <input
        aria-invalid={issue ? true : undefined}
        inputMode="numeric"
        type="text"
        value={draftValue}
        onBlur={() => {
          if (issue || draftValue.length === 0) setDraftValue(String(value));
        }}
        onChange={(event) => {
          const nextValue = cleanIntegerDraft(event.currentTarget.value);
          setDraftValue(nextValue);
          const parsed = parseIntegerDraft(nextValue);
          if (parsed !== null && parsed >= min && parsed <= max) onChange(parsed);
        }}
      />
      {issue ? <span className="field-help">{issue}</span> : null}
    </label>
  );
}

function SelectField({
  className,
  label,
  onChange,
  options,
  value
}: {
  className?: string;
  label: string;
  onChange(value: string): void;
  options: Array<{ value: string; label: string }>;
  value: string;
}): React.JSX.Element {
  return (
    <label className={`stacked-field${className ? ` ${className}` : ""}`}>
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

function cleanIntegerDraft(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function parseIntegerDraft(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNumberFieldIssue(value: string, min: number, max: number): string | null {
  if (value.length === 0) return null;
  const parsed = parseIntegerDraft(value);
  if (parsed === null) return "Enter a whole number.";
  if (parsed < min || parsed > max) return `Must be between ${min.toLocaleString()} and ${max.toLocaleString()}.`;
  return null;
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
