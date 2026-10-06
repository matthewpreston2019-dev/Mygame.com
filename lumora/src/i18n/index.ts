import { useApp } from '@/state/app';
import { en, type Dict } from './en';
import { de, es, fr, ja, pt, zh } from './locales';

export const UI_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
];

export const REPLY_LANGUAGES: { code: string; label: string }[] = [
  ...UI_LANGUAGES,
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ko', label: '한국어' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'pl', label: 'Polski' },
  { code: 'sv', label: 'Svenska' },
  { code: 'uk', label: 'Українська' },
];

const DICTS: Record<string, Partial<Dict>> = { en, es, fr, de, pt, ja, zh };

export function resolveUiLanguage(setting: string): string {
  if (setting && setting !== 'auto' && DICTS[setting]) return setting;
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return DICTS[nav] ? nav : 'en';
}

export type TKey = keyof Dict;

export function translate(lang: string, key: TKey, vars?: Record<string, string>): string {
  let s = DICTS[lang]?.[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export function useT() {
  const lang = useApp((s) => resolveUiLanguage(s.settings.uiLanguage));
  return (key: TKey, vars?: Record<string, string>) => translate(lang, key, vars);
}
