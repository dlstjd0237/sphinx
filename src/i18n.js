import { KO } from './i18n-ko.js';

export const LANGUAGES = Object.freeze(['en', 'ko']);

/** The English message catalog: flat keys, {name} placeholders, and plurals as { one, other } chosen by a raw count. */
export const EN = {
  'common.language.en': 'English',
  'common.language.ko': '한국어',
};

/** The language a new install pre-selects: SPHINX_SYSTEM_LANGUAGE when it is en or ko, otherwise Korean only for a Korean locale. */
export function systemLanguage({ env = process.env, locale = Intl.DateTimeFormat().resolvedOptions().locale } = {}) {
  if (LANGUAGES.includes(env.SPHINX_SYSTEM_LANGUAGE)) return env.SPHINX_SYSTEM_LANGUAGE;
  try { return new Intl.Locale(locale).language === 'ko' ? 'ko' : 'en'; } catch { return 'en'; }
}

/** Fills each {name} once with String(params[name]); filled values are never rescanned, and names params lacks stay as written. */
export function format(text, params) {
  return text.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/** A plural entry { one, other } gives one only when the raw count is exactly 1. */
export function pick(entry, params) {
  return entry !== null && typeof entry === 'object' ? (params.count === 1 ? entry.one : entry.other) : entry;
}

export function lookup(language, key, catalogs = { en: EN, ko: KO }) {
  return catalogs[language]?.[key] ?? catalogs.en[key];
}

/** Never throws: a key Korean lacks falls back to English, and a key English lacks comes back as itself. */
export function t(language, key, params = {}) {
  const values = params ?? {}; // a hand-made or stored ref can carry $p: null
  const text = pick(lookup(language, key), values);
  return typeof text === 'string' ? format(text, values) : key;
}

export function msg(key, params) {
  return params === undefined ? { $t: key } : { $t: key, $p: params };
}

export function join(parts, separator) {
  return { $join: parts, $sep: separator };
}

export function isRef(value) {
  return value !== null && typeof value === 'object' && (typeof value.$t === 'string' || Array.isArray(value.$join));
}

const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Draws every ref as text, depth first, into new copies of the arrays and plain objects around it; everything else passes through. */
export function localize(value, language) {
  // ponytail: assumes acyclic, JSON-shaped values, which every caller serializes next; track visited objects if one ever is not.
  if (isRef(value)) {
    return typeof value.$t === 'string'
      ? t(language, value.$t, localize(value.$p, language))
      : value.$join.map(part => localize(part, language)).join(value.$sep);
  }
  if (Array.isArray(value)) return value.map(item => localize(item, language));
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item, language)]));
  return value;
}

const pageOnly = catalog => Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith('page.')));

/** The part of both catalogs the questionnaire page's own script needs. */
export function pageCatalog() {
  return { en: pageOnly(EN), ko: pageOnly(KO) };
}
