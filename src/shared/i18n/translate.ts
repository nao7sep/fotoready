import { Fragment, createElement, type ReactNode } from "react";
import { CATALOGUES, type Catalogue, type MessageKey } from "./catalogues";
import type { Language } from "./languages";

// Text held in state (failures, import results, task errors, anything the main
// process sends) is a key plus values, never a finished string, so it renders
// in whatever language is current when it is shown. A value may itself be a
// message, rendered in the same language.
export type Message = {
  key: MessageKey;
  values?: MessageValues;
};

export type MessageValue = string | number | Message;

export type MessageValues = Record<string, MessageValue>;

export function message(key: MessageKey, values?: MessageValues): Message {
  return values === undefined ? { key } : { key, values };
}

export function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && typeof (value as { key?: unknown }).key === "string";
}

const PLACEHOLDER = /\{(\w+)\}/g;

export type Translator = {
  language: Language;
  locale: string;
  t: (key: MessageKey, values?: MessageValues) => string;
  // Like t, but a placeholder may be filled with markup (a <code> path, say).
  rich: (key: MessageKey, values: Record<string, ReactNode>) => ReactNode;
  text: (message: Message) => string;
  number: (value: number) => string;
  // A ratio (0.25) as a percentage, with at most `fractionDigits` decimals.
  percent: (ratio: number, fractionDigits?: number) => string;
  dateTime: (date: Date) => string;
  // Names joined the way the language lists them ("a, b and c").
  list: (items: readonly string[]) => string;
  // Sorts labels the way the language orders them.
  compare: (left: string, right: string) => number;
};

export function createTranslator(language: Language, locale: string = language): Translator {
  const catalogue: Catalogue = CATALOGUES[language];
  const numberFormat = new Intl.NumberFormat(locale);
  const percentFormats = new Map<number, Intl.NumberFormat>();
  const dateTimeFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const listFormat = new Intl.ListFormat(language, { style: "narrow", type: "conjunction" });
  const collator = new Intl.Collator(language);
  const pluralRules = new Intl.PluralRules(language);

  function percentFormat(fractionDigits: number): Intl.NumberFormat {
    let format = percentFormats.get(fractionDigits);
    if (!format) {
      format = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: fractionDigits });
      percentFormats.set(fractionDigits, format);
    }
    return format;
  }

  function template(key: MessageKey, values: MessageValues | undefined): string {
    const entry = catalogue[key];
    if (typeof entry === "string") {
      return entry;
    }
    // A key the catalogue does not carry shows as itself rather than taking the
    // window down; the catalogue gate and the on-screen-key check both fail on
    // it, so it cannot reach a release unnoticed.
    if (entry === undefined || entry === null) {
      return key;
    }
    // A plural entry holds one form per CLDR category the language uses; the
    // catalogue gate guarantees the category the rules select is present.
    const count = typeof values?.count === "number" ? values.count : 0;
    const forms = entry as Record<string, string>;
    return forms[pluralRules.select(count)] ?? forms.other;
  }

  function format(value: MessageValue): string {
    if (typeof value === "number") return numberFormat.format(value);
    if (typeof value === "string") return value;
    return t(value.key, value.values);
  }

  function t(key: MessageKey, values?: MessageValues): string {
    return template(key, values).replace(PLACEHOLDER, (whole, name: string) =>
      values !== undefined && name in values ? format(values[name]) : whole,
    );
  }

  function rich(key: MessageKey, values: Record<string, ReactNode>): ReactNode {
    const parts = template(key, undefined).split(PLACEHOLDER);
    // split with a capture group alternates literal text and placeholder names.
    return parts.map((part, index) =>
      index % 2 === 0
        ? part
        : createElement(Fragment, { key: index }, part in values ? values[part] : `{${part}}`),
    );
  }

  return {
    language,
    locale,
    t,
    rich,
    text: (message) => t(message.key, message.values),
    number: (value) => numberFormat.format(value),
    percent: (ratio, fractionDigits = 0) => percentFormat(fractionDigits).format(ratio),
    dateTime: (date) => dateTimeFormat.format(date),
    list: (items) => listFormat.format(items),
    compare: (left, right) => collator.compare(left, right),
  };
}
