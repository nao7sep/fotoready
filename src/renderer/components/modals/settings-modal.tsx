import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SystemInfo } from "@shared/types/ipc";
import { MAX_ASSET_PICKER_PREVIEW_LONG_EDGE, MAX_PREVIEW_LONG_EDGE, MAX_VISION_IMAGE_LONG_EDGE, MIN_ASSET_PICKER_PREVIEW_LONG_EDGE } from "@shared/constants";
import { EDITABLE_METADATA_FIELDS, type GlobalSettings, type MetadataFields, type ThemePreference } from "@shared/types/settings";
import { cleanMetadataField } from "@shared/text-cleanup";
import { availableOutputFormats } from "@shared/output-format";
import { outputFormatName } from "@renderer/output-format-name";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY, TEXT_WATERMARK_FONT_OPTIONS } from "@shared/watermark-text-layout";
import { GEMINI_MODELS, defaultVisionDescriptionPrompt, defaultVisionSlugPrompt } from "@shared/defaults";
import { metadataFieldLabel } from "@renderer/metadata-field-label";
import { ModalShell } from "./modal-shell";
import { OperationResult } from "../operation-result";
import { presentFailure } from "../../present-failure";
import { useI18n } from "@renderer/i18n/I18nContext";
import { CATALOGUES, type MessageKey } from "@shared/i18n/catalogues";
import { LANGUAGES, normalizeLanguagePreference } from "@shared/i18n/languages";
import { message, type Message, type Translator } from "@shared/i18n/translate";

export type SettingsTab = "save" | "metadata" | "vision" | "assets" | "app";

const tabs: ReadonlyArray<{ id: SettingsTab; label: MessageKey }> = [
  { id: "save", label: "settings.tab.save" },
  { id: "metadata", label: "settings.tab.metadata" },
  { id: "vision", label: "settings.tab.vision" },
  { id: "assets", label: "settings.tab.assets" },
  { id: "app", label: "settings.tab.app" }
];

const themeOptions: ReadonlyArray<{ value: ThemePreference; label: MessageKey }> = [
  { value: "system", label: "settings.themeSystem" },
  { value: "light", label: "settings.themeLight" },
  { value: "dark", label: "settings.themeDark" }
];

const metadataFieldHelp: Record<keyof MetadataFields, MessageKey> = {
  author: "metadataHelp.author",
  credit: "metadataHelp.credit",
  source: "metadataHelp.source",
  copyright: "metadataHelp.copyright",
  webStatement: "metadataHelp.webStatement",
  usageTerms: "metadataHelp.usageTerms",
  contactEmail: "metadataHelp.contactEmail",
  contactUrl: "metadataHelp.contactUrl",
  description: "metadataHelp.description"
};

const fontOptionLabels: Record<(typeof TEXT_WATERMARK_FONT_OPTIONS)[number]["id"], MessageKey> = {
  "system-ui": "settings.fontOption.systemUi",
  serif: "settings.fontOption.serif",
  monospace: "settings.fontOption.monospace",
  rounded: "settings.fontOption.rounded"
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
  onSaveSettings(): Promise<void>;
  settingsDraft: GlobalSettings | null;
  setSettingsDraft(settings: GlobalSettings): void;
  systemInfo: SystemInfo | null;
}): React.JSX.Element {
  const { t, text } = useI18n();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [saveFailure, setSaveFailure] = useState<Message | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function save(): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveFailure(null);
    try {
      await onSaveSettings();
    } catch (error) {
      setSaveFailure(presentFailure(error, message("failure.settingsSave"), "settings save failed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function updateSettingsDraft(next: GlobalSettings): void {
    setSaveFailure(null);
    setSettingsDraft(next);
  }

  function updateApiKeyDraft(next: string): void {
    setSaveFailure(null);
    onApiKeyDraftChange(next);
  }

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
      title={t("settings.title")}
      size="default"
      tall
      closeDisabled={saving}
      onClose={onClose}
      footer={
        <>
          <button className="toolbar-button" type="button" disabled={saving} onClick={onClose}>{t("common.cancel")}</button>
          <button className="primary-action" type="button" disabled={saving || !settingsDraft || !hasChanges} onClick={() => void save()}>{saving ? t("common.saving") : t("common.save")}</button>
        </>
      }
    >
      <fieldset className="settings-busy-fieldset" disabled={saving} aria-busy={saving ? "true" : undefined}>
      <div
        ref={tablistRef}
        role="tablist"
        aria-label={t("settings.sections")}
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
            {t(entry.label)}
          </button>
        ))}
      </div>
      {saveFailure ? (
        <OperationResult
          className="modal-error"
          dismissLabel={t("settings.closeResult")}
          severity="error"
          onDismiss={() => setSaveFailure(null)}
        >
          {text(saveFailure)}
        </OperationResult>
      ) : null}
      {settingsDraft ? (
        <div className="settings-page">
          {tab === "save" ? <SaveTab settings={settingsDraft} setSettings={updateSettingsDraft} /> : null}
          {tab === "metadata" ? <MetadataTab settings={settingsDraft} setSettings={updateSettingsDraft} /> : null}
          {tab === "vision" ? (
            <VisionTab
              apiKeyDraft={apiKeyDraft}
              apiKeyClearRequested={apiKeyClearRequested}
              hasGeminiApiKey={hasGeminiApiKey}
              onApiKeyDraftChange={updateApiKeyDraft}
              onClearApiKey={() => { setSaveFailure(null); onClearApiKey(); }}
              onKeepApiKey={() => { setSaveFailure(null); onKeepApiKey(); }}
              settings={settingsDraft}
              setSettings={updateSettingsDraft}
            />
          ) : null}
          {tab === "assets" ? <AssetsTab settings={settingsDraft} setSettings={updateSettingsDraft} systemInfo={systemInfo} /> : null}
          {tab === "app" ? <AppTab settings={settingsDraft} setSettings={updateSettingsDraft} systemInfo={systemInfo} /> : null}
        </div>
      ) : null}
      </fieldset>
    </ModalShell>
  );
}

function SaveTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  const { t } = useI18n();
  const outputFormatOptions = useMemo(
    () => availableOutputFormats().map((format) => ({ value: format, label: outputFormatName(t, format) })),
    [t]
  );

  return (
    <div className="settings-section-stack">
      <section>
        <h3>{t("settings.outputFolder")}</h3>
        <div className="settings-grid">
          <PathField
            allowClear
            buttonLabel={t("settings.chooseFolder")}
            emptyLabel={t("settings.sameFolderAsOriginal")}
            label={t("settings.folder")}
            pick={async () => window.api.system.pickDirectory({ title: t("dialog.chooseOutputFolder") })}
            value={settings.defaultOutputDirectory}
            onChange={(value) => setSettings({ ...settings, defaultOutputDirectory: value })}
          />
          <div className="row-detail">{t("settings.outputFolderDetail")}</div>
        </div>
      </section>

      <section>
        <h3>{t("settings.outputFormat")}</h3>
        <div className="settings-grid">
          <SelectField
            className="span-two"
            label={t("settings.defaultFormat")}
            options={outputFormatOptions}
            value={settings.defaultOutputFormat}
            onChange={(value) => setSettings({ ...settings, defaultOutputFormat: value as GlobalSettings["defaultOutputFormat"] })}
          />
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.defaultFlattenTransparency} onChange={(event) => setSettings({ ...settings, defaultFlattenTransparency: event.currentTarget.checked })} />
            {t("settings.flattenDefault")}
          </label>
          {/* The caption is its own label rather than a wrapper around the row: a
              label covers everything inside it, so wrapping the row made the empty
              space beside the chip a click on the control — which shut the colour
              picker and reopened it in one gesture. */}
          <div className="stacked-field span-two">
            <label htmlFor="default-background-color">{t("settings.backgroundColor")}</label>
            <input id="default-background-color" type="color" value={settings.defaultBackgroundForTransparency} onChange={(event) => setSettings({ ...settings, defaultBackgroundForTransparency: event.currentTarget.value })} />
          </div>
          <div className="row-detail">{t("settings.formatDetail")}</div>
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
            {t("settings.jpegEstimate")}
          </label>
          <label className="stacked-field">
            {t("settings.qualityMode")}
            <select value={settings.jpegQualityMode} onChange={(event) => setSettings({ ...settings, jpegQualityMode: event.currentTarget.value as GlobalSettings["jpegQualityMode"] })}>
              <option disabled={!settings.enableJpegQualityEstimate} value="auto">{t("settings.assumeSourceQuality")}</option>
              <option value="fixed">{t("settings.useFixedQuality")}</option>
            </select>
          </label>
          <NumberField label={t("settings.fixedQuality")} max={100} min={1} value={settings.jpegFixedQuality} onChange={(value) => setSettings({ ...settings, jpegFixedQuality: value })} />
          <SelectField
            className="span-two"
            label={t("settings.chromaSubsampling")}
            options={[
              { value: "4:2:0", label: "4:2:0" },
              { value: "4:2:2", label: "4:2:2" },
              { value: "4:4:4", label: "4:4:4" }
            ]}
            value={settings.jpegChromaSubsampling}
            onChange={(value) => setSettings({ ...settings, jpegChromaSubsampling: value as GlobalSettings["jpegChromaSubsampling"] })}
          />
          <div className="row-detail">{t("settings.chromaDetail")}</div>
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.jpegProgressive} onChange={(event) => setSettings({ ...settings, jpegProgressive: event.currentTarget.checked })} />
            {t("settings.progressive")}
          </label>
          <div className="row-detail">{t("settings.estimateDetail")}</div>
        </div>
      </section>

      <section>
        <h3>PNG</h3>
        <label className="toggle-row settings-toggle-card">
          <input type="checkbox" checked={settings.defaultPngPalette} onChange={(event) => setSettings({ ...settings, defaultPngPalette: event.currentTarget.checked })} />
          {t("settings.pngPalette")}
        </label>
      </section>

      <section>
        <h3>WebP</h3>
        <div className="settings-grid">
          <NumberField label={t("settings.quality")} max={100} min={1} value={settings.defaultWebpQuality} onChange={(value) => setSettings({ ...settings, defaultWebpQuality: value })} />
          <NumberField label={t("settings.webpMethod")} max={6} min={0} value={settings.webpMethod} onChange={(value) => setSettings({ ...settings, webpMethod: value })} />
        </div>
      </section>

      <section>
        <h3>AVIF</h3>
        <div className="settings-grid">
          <NumberField label={t("settings.quality")} max={100} min={1} value={settings.defaultAvifQuality} onChange={(value) => setSettings({ ...settings, defaultAvifQuality: value })} />
          <NumberField label={t("settings.avifEffort")} max={9} min={0} value={settings.avifEffort} onChange={(value) => setSettings({ ...settings, avifEffort: value })} />
        </div>
      </section>
    </div>
  );
}

function MetadataTab({ settings, setSettings }: SettingsProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="settings-section-stack">
      <section>
        <h3>{t("settings.outputStamps")}</h3>
        <div className="settings-grid">
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.writeSoftwareTag} onChange={(event) => setSettings({ ...settings, writeSoftwareTag: event.currentTarget.checked })} />
            {t("settings.writeSoftwareTag")}
          </label>
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.writeModifyDate} onChange={(event) => setSettings({ ...settings, writeModifyDate: event.currentTarget.checked })} />
            {t("settings.writeModifyDate")}
          </label>
        </div>
      </section>
      <section>
        <h3>{t("settings.metadataDefaults")}</h3>
        <p className="row-detail">{t("settings.metadataDefaultsDetail")}</p>
        <div className="settings-grid">
          {EDITABLE_METADATA_FIELDS.map((field) => (
            <label className="stacked-field metadata-field span-two" key={field}>
              {t(metadataFieldLabel(field))}
              <AutoTextarea
                minRows={field === "description" ? 3 : 1}
                value={settings.injectFields[field] ?? ""}
                onChange={(value) => setSettings({ ...settings, injectFields: { ...settings.injectFields, [field]: value } })}
                onCommit={(value) => setSettings({ ...settings, injectFields: { ...settings.injectFields, [field]: cleanMetadataField(field, value) } })}
              />
              <span className="field-help">{t(metadataFieldHelp[field])}</span>
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
  const { t } = useI18n();
  return (
    <div className="settings-section-stack">
      <section>
        <h3>Gemini</h3>
        <div className="settings-grid">
          <label className="stacked-field span-two">
            {t("settings.apiKey")}
            {hasGeminiApiKey && !apiKeyClearRequested ? (
              <>
                <span className="field-help">{t("settings.apiKeySaved")}</span>
                <div className="settings-path-row">
                  <input
                    placeholder={t("settings.apiKeyReplacePlaceholder")}
                    type="password"
                    value={apiKeyDraft}
                    onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)}
                  />
                  <button className="toolbar-button" type="button" onClick={onClearApiKey}>{t("common.clear")}</button>
                </div>
                <span className="field-help">{t("settings.apiKeyKeepHint")}</span>
              </>
            ) : hasGeminiApiKey && apiKeyClearRequested ? (
              <>
                <div className="settings-path-row">
                  <input type="password" value={apiKeyDraft} onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)} />
                  <button className="toolbar-button" type="button" onClick={onKeepApiKey}>{t("settings.keepKey")}</button>
                </div>
                <span className="field-help">{t("settings.apiKeyWillClear")}</span>
              </>
            ) : (
              <>
                <input type="password" value={apiKeyDraft} onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)} />
                <span className="field-help">{t("settings.noApiKey")}</span>
              </>
            )}
          </label>
          <label className="stacked-field">
            {t("settings.model")}
            <select value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.currentTarget.value })}>
              {GEMINI_MODELS.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
              {/*
                Only reachable from a config written by an older build (when the list was editable) or a
                hand-edited settings file — never from anything the user can do here now. Rendered rather
                than dropped because a <select> whose value matches no <option> renders BLANK: the choice
                is between naming the stale id and showing an empty picker with no explanation.
                "No longer offered" is about THIS list, not about Gemini: such a model often still runs
                (gemini-2.5-pro does), so the label must not imply it is broken.
              */}
              {settings.model && !GEMINI_MODELS.some((id) => id === settings.model) ? (
                <option value={settings.model}>{t("settings.modelNoLongerOffered", { model: settings.model })}</option>
              ) : null}
            </select>
          </label>
          <NumberField label={t("settings.visionLongEdge")} max={MAX_VISION_IMAGE_LONG_EDGE} min={128} value={settings.preResizeLongEdge} onChange={(value) => setSettings({ ...settings, preResizeLongEdge: value })} />
          <NumberField label={t("settings.visionConcurrency")} max={32} min={1} value={settings.visionConcurrency} onChange={(value) => setSettings({ ...settings, visionConcurrency: value })} />
          <NumberField label={t("settings.visionTimeout")} max={600000} min={1000} value={settings.visionTimeoutMs} onChange={(value) => setSettings({ ...settings, visionTimeoutMs: value })} />
          <NumberField label={t("settings.visionMaxRetries")} max={10} min={0} value={settings.visionMaxRetries} onChange={(value) => setSettings({ ...settings, visionMaxRetries: value })} />
          <NumberField label={t("settings.visionBackoff")} max={30000} min={0} value={settings.visionInitialBackoffMs} onChange={(value) => setSettings({ ...settings, visionInitialBackoffMs: value })} />
          <label className="toggle-row settings-toggle-card span-two">
            <input
              type="checkbox"
              checked={settings.defaultGenerateDescription || settings.defaultGenerateSlug}
              disabled={settings.defaultGenerateSlug}
              onChange={(event) => setSettings({ ...settings, defaultGenerateDescription: event.currentTarget.checked })}
            />
            {t("settings.generateDescriptionDefault")}
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
            {t("settings.generateSlugDefault")}
          </label>
        </div>
      </section>

      <section>
        <h3>{t("settings.prompts")}</h3>
        <label className="stacked-field">
          {t("settings.descriptionPrompt")}
          <textarea rows={5} value={settings.visionDescriptionPrompt} onChange={(event) => setSettings({ ...settings, visionDescriptionPrompt: event.currentTarget.value })} />
          <button
            className="toolbar-button"
            type="button"
            style={{ justifySelf: "start" }}
            disabled={settings.visionDescriptionPrompt === defaultVisionDescriptionPrompt}
            onClick={() => setSettings({ ...settings, visionDescriptionPrompt: defaultVisionDescriptionPrompt })}
          >
            {t("settings.resetDescriptionPrompt")}
          </button>
        </label>
        <label className="stacked-field">
          {t("settings.slugPrompt")}
          <textarea rows={5} value={settings.visionSlugPrompt} onChange={(event) => setSettings({ ...settings, visionSlugPrompt: event.currentTarget.value })} />
          <button
            className="toolbar-button"
            type="button"
            style={{ justifySelf: "start" }}
            disabled={settings.visionSlugPrompt === defaultVisionSlugPrompt}
            onClick={() => setSettings({ ...settings, visionSlugPrompt: defaultVisionSlugPrompt })}
          >
            {t("settings.resetSlugPrompt")}
          </button>
        </label>
      </section>
    </div>
  );
}

function AssetsTab({ settings, setSettings, systemInfo }: SettingsProps & { systemInfo: SystemInfo | null }): React.JSX.Element {
  const { t } = useI18n();
  const fontFamilyListId = useId();
  // Reflect the REAL resolved default (which relocates with FOTOREADY_HOME)
  // rather than a hardcoded ~/.fotoready path. Fall back to a generic label
  // until app info has loaded.
  const lutEmptyLabel = systemInfo ? t("settings.defaultFolder", { path: systemInfo.lutsDir }) : t("settings.defaultAppDataFolder");
  const stampEmptyLabel = systemInfo ? t("settings.defaultFolder", { path: systemInfo.stampsDir }) : t("settings.defaultAppDataFolder");

  return (
    <div className="settings-section-stack">
      <section>
        <h3>{t("settings.assetFolders")}</h3>
        <PathField
          allowClear
          buttonLabel={t("settings.chooseFolder")}
          emptyLabel={lutEmptyLabel}
          label={t("settings.lutFolder")}
          pick={async () => window.api.system.pickDirectory({ title: t("dialog.chooseLutFolder") })}
          value={settings.lutFolder}
          onChange={(value) => setSettings({ ...settings, lutFolder: value })}
        />
        <PathField
          allowClear
          buttonLabel={t("settings.chooseFolder")}
          emptyLabel={stampEmptyLabel}
          label={t("settings.stampFolder")}
          pick={async () => window.api.system.pickDirectory({ title: t("dialog.chooseStampFolder") })}
          value={settings.stampFolder}
          onChange={(value) => setSettings({ ...settings, stampFolder: value })}
        />
      </section>

      <section>
        <h3>{t("settings.watermark")}</h3>
        <div className="settings-grid">
          <PathField
            allowClear
            buttonLabel={t("settings.chooseFile")}
            emptyLabel={t("settings.noDefaultWatermark")}
            label={t("settings.defaultWatermark")}
            pick={async () => window.api.system.pickFile({ title: t("dialog.chooseDefaultWatermark"), extensions: ["png", "svg"] })}
            value={settings.defaultWatermarkImage}
            onChange={(value) => setSettings({ ...settings, defaultWatermarkImage: value })}
          />
          <label className="stacked-field span-two">
            {t("settings.defaultWatermarkFont")}
            <input
              list={fontFamilyListId}
              placeholder={DEFAULT_TEXT_WATERMARK_FONT_FAMILY}
              type="text"
              value={settings.defaultWatermarkTextFontFamily}
              onChange={(event) => setSettings({ ...settings, defaultWatermarkTextFontFamily: event.currentTarget.value })}
            />
            <datalist id={fontFamilyListId}>
              {TEXT_WATERMARK_FONT_OPTIONS.map((option) => (
                <option key={option.id} label={t(fontOptionLabels[option.id])} value={option.value} />
              ))}
            </datalist>
          </label>
          <div className="row-detail">{t("settings.defaultWatermarkFontDetail")}</div>
        </div>
      </section>
    </div>
  );
}

function AppTab({ settings, setSettings, systemInfo }: SettingsProps & { systemInfo: SystemInfo | null }): React.JSX.Element {
  const { t } = useI18n();
  const cpuCount = systemInfo?.cpuCount ?? 8;
  const concurrencyOptions = useMemo(() => buildConcurrencyOptions(cpuCount, t), [cpuCount, t]);
  const themeName = useId();
  const languageId = useId();

  return (
    <div className="settings-section-stack">
      <section>
        <h3>{t("settings.language")}</h3>
        <div className="settings-grid">
          {/* System first, then each language in its own name and its own glyphs; applied on Save
              with the rest of Settings (localization-conventions). */}
          <div className="stacked-field span-two">
            <label htmlFor={languageId}>{t("settings.language")}</label>
            <select
              id={languageId}
              value={settings.language}
              onChange={(event) => setSettings({ ...settings, language: normalizeLanguagePreference(event.currentTarget.value) })}
            >
              <option value="system">{t("settings.languageSystem")}</option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language} lang={language}>
                  {CATALOGUES[language]["language.name"] as string}
                </option>
              ))}
            </select>
          </div>
          <div className="row-detail">{t("settings.languageDetail")}</div>
        </div>
      </section>

      <section>
        <h3>{t("settings.appearance")}</h3>
        <div className="settings-grid">
          {/* A native radio group: one tab stop, arrow keys move and select. Applied on Save with
              the rest of Settings, never on its own. */}
          <fieldset className="radio-field span-two">
            <legend>{t("settings.theme")}</legend>
            <div className="radio-field-options">
              {themeOptions.map((option) => (
                <label key={option.value} className="toggle-row">
                  <input
                    type="radio"
                    name={themeName}
                    value={option.value}
                    checked={settings.theme === option.value}
                    onChange={() => setSettings({ ...settings, theme: option.value })}
                  />
                  {t(option.label)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="row-detail">{t("settings.themeDetail")}</div>
          <label className="stacked-field span-two">
            {t("settings.uiFont")}
            <input
              type="text"
              placeholder="Inter"
              value={settings.uiFontFamily}
              onChange={(event) => setSettings({ ...settings, uiFontFamily: event.currentTarget.value })}
            />
          </label>
          <div className="row-detail">{t("settings.uiFontDetail")}</div>
        </div>
      </section>

      <section>
        <h3>{t("settings.performance")}</h3>
        <div className="settings-grid">
          <NumberField
            className="span-two"
            label={t("settings.previewLongEdge")}
            max={MAX_PREVIEW_LONG_EDGE}
            min={320}
            value={settings.previewLongEdge}
            onChange={(value) => setSettings({ ...settings, previewLongEdge: value })}
          />
          <div className="row-detail">{t("settings.previewLongEdgeDetail")}</div>
          <NumberField
            className="span-two"
            label={t("settings.assetPreviewSize")}
            max={MAX_ASSET_PICKER_PREVIEW_LONG_EDGE}
            min={MIN_ASSET_PICKER_PREVIEW_LONG_EDGE}
            value={settings.assetPickerPreviewLongEdge}
            onChange={(value) => setSettings({ ...settings, assetPickerPreviewLongEdge: value })}
          />
          <div className="row-detail">{t("settings.assetPreviewSizeDetail")}</div>
          <NumberField
            className="span-two"
            label={t("settings.previewDebounce")}
            max={2000}
            min={0}
            value={settings.previewDebounceMs}
            onChange={(value) => setSettings({ ...settings, previewDebounceMs: value })}
          />
          <div className="row-detail">{t("settings.previewDebounceDetail")}</div>
          <SelectField
            className="span-two"
            label={t("settings.concurrentSaves")}
            options={concurrencyOptions}
            value={settings.workerPoolSize === null ? "auto" : String(settings.workerPoolSize)}
            onChange={(value) => setSettings({ ...settings, workerPoolSize: value === "auto" ? null : Number(value) })}
          />
          <div className="row-detail">{t("settings.concurrentSavesDetail", { count: cpuCount })}</div>
        </div>
      </section>

      <section>
        <h3>{t("settings.confirmations")}</h3>
        <div className="settings-grid">
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.confirmDeleteOriginals} onChange={(event) => setSettings({ ...settings, confirmDeleteOriginals: event.currentTarget.checked })} />
            {t("settings.confirmRemoveOriginals")}
          </label>
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.confirmDeleteTasks} onChange={(event) => setSettings({ ...settings, confirmDeleteTasks: event.currentTarget.checked })} />
            {t("settings.confirmDeleteTasks")}
          </label>
          <label className="toggle-row settings-toggle-card span-two">
            <input type="checkbox" checked={settings.confirmDeleteOutputFiles} onChange={(event) => setSettings({ ...settings, confirmDeleteOutputFiles: event.currentTarget.checked })} />
            {t("settings.confirmTrashOutput")}
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
  const { t, number } = useI18n();
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const issue = getNumberFieldIssue(draftValue, min, max);
  const issueText = issue === "whole-number"
    ? t("settings.wholeNumber")
    : issue === "out-of-range"
      ? t("settings.numberRange", { min: number(min), max: number(max) })
      : null;

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
      {issueText ? <span className="field-help">{issueText}</span> : null}
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
  const { t, text } = useI18n();
  const [pickFailure, setPickFailure] = useState<Message | null>(null);
  const inputId = useId();

  function change(next: string): void {
    setPickFailure(null);
    onChange(next);
  }

  async function choose(): Promise<void> {
    try {
      const picked = await pick();
      if (picked !== null) change(picked);
    } catch (error) {
      setPickFailure(presentFailure(error, message("failure.pathPick"), "settings path picker failed", { field: label }));
    }
  }

  return (
    <div className="stacked-field span-two">
      <label htmlFor={inputId}>{label}</label>
      <div className="settings-path-row">
        <input id={inputId} type="text" placeholder={emptyLabel} value={value} onChange={(event) => change(event.currentTarget.value)} />
        <button className="toolbar-button" type="button" onClick={() => void choose()}>{buttonLabel}</button>
        {allowClear ? <button className="toolbar-button" type="button" onClick={() => change("")}>{t("common.clear")}</button> : null}
      </div>
      {pickFailure ? (
        <OperationResult
          className="modal-error"
          dismissLabel={t("settings.closePathResult")}
          severity="error"
          onDismiss={() => setPickFailure(null)}
        >
          {text(pickFailure)}
        </OperationResult>
      ) : null}
    </div>
  );
}

/** `minRows` is what the field usually holds: one line for a name or a URL,
 * a few for a value people write in sentences, so the box looks like what it
 * takes before anything is typed. It grows past that with the content. */
function AutoTextarea({ value, onChange, onCommit, minRows = 1 }: { value: string; onChange(value: string): void; onCommit(value: string): void; minRows?: number }): React.JSX.Element {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Measure at the field's natural height, not zero: at zero the content is
    // all that is measured, and a field asking for several rows would collapse
    // to the one line its value happens to occupy.
    node.style.height = "auto";
    node.style.height = `${Math.max(node.scrollHeight, 28)}px`;
  }, [value, minRows]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      // Whitespace cleanup runs at commit (blur), never on each keystroke, so
      // typing and IME composition are never reformatted mid-edit.
      onBlur={(event) => onCommit(event.currentTarget.value)}
    />
  );
}

function cleanIntegerDraft(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function parseIntegerDraft(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNumberFieldIssue(value: string, min: number, max: number): "whole-number" | "out-of-range" | null {
  if (value.length === 0) return null;
  const parsed = parseIntegerDraft(value);
  if (parsed === null) return "whole-number";
  if (parsed < min || parsed > max) return "out-of-range";
  return null;
}

function buildConcurrencyOptions(cpuCount: number, t: Translator["t"]): Array<{ value: string; label: string }> {
  const values = new Set<number>([1]);
  let current = 1;
  while (current < cpuCount) {
    current *= 2;
    values.add(Math.min(current, cpuCount));
  }
  if (cpuCount > 2) values.add(cpuCount);
  return [
    { value: "auto", label: t("settings.concurrentSavesAutomatic", { count: cpuCount }) },
    ...Array.from(values).sort((left, right) => left - right).map((value) => ({ value: String(value), label: String(value) }))
  ];
}
