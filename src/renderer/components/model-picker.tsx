import React, { useEffect, useId, useRef, useState } from "react";
import { modelsFor, type AiKind } from "@shared/ai-models";
import { useI18n } from "@renderer/i18n/I18nContext";

export function ModelPicker({ label, kind, value, fetchedIds, extraIds, onChange, onAddExtra }: {
  label: string;
  kind: AiKind;
  value: string;
  fetchedIds: readonly string[];
  extraIds: readonly string[];
  onChange(id: string): void;
  onAddExtra(id: string): void;
}): React.JSX.Element {
  const { t } = useI18n();
  const id = useId();
  const typed = useRef(false);
  const suggestions = modelsFor("gemini", kind).map((model) => model.id);
  const fetched = fetchedIds.filter((model) => !suggestions.includes(model));
  const extras = extraIds.filter((model) => !suggestions.includes(model) && !fetched.includes(model));
  const known = [...suggestions, ...fetched, ...extras];
  const outside = value && !known.includes(value);
  return (
    <div className="stacked-field span-two">
      <label htmlFor={id}>{label}</label>
      <div className="settings-path-row">
        <input id={id} type="text" value={value} onChange={(event) => { typed.current = true; onChange(event.currentTarget.value); }}
          onBlur={() => { if (typed.current && value.trim() && outside) onAddExtra(value); typed.current = false; }} />
        <select aria-label={label} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
          <optgroup label={t("settings.suggestedModels")}>
            {suggestions.map((model) => <option key={model} value={model}>{model}</option>)}
          </optgroup>
          {fetched.length ? <optgroup label={t("settings.fetchedModels")}>
            {fetched.map((model) => <option key={model} value={model}>{model}</option>)}
          </optgroup> : null}
          {extras.length ? <optgroup label={t("settings.extraModels")}>
            {extras.map((model) => <option key={model} value={model}>{model}</option>)}
          </optgroup> : null}
          {outside ? <option value={value}>{t("settings.modelOutOfList", { model: value })}</option> : null}
          {!value ? <option value="" /> : null}
        </select>
      </div>
    </div>
  );
}

/** Keep the user's complete textarea text while the config holds only non-empty ids. */
export function ExtraModelIdsEditor({ ids, onChange }: { ids: readonly string[]; onChange(ids: string[]): void }): React.JSX.Element {
  const { t } = useI18n();
  const normalized = ids.join("\n");
  const [text, setText] = useState(normalized);
  const lastEmitted = useRef(normalized);
  useEffect(() => {
    if (normalized !== lastEmitted.current) setText(normalized);
    lastEmitted.current = normalized;
  }, [normalized]);
  return <label className="stacked-field span-two">
    {t("settings.extraModels")}
    <textarea rows={3} value={text} onChange={(event) => {
      const next = event.currentTarget.value;
      setText(next);
      const values = next.split(/\r?\n/).filter((value) => value.trim());
      lastEmitted.current = values.join("\n");
      onChange(values);
    }} />
  </label>;
}
