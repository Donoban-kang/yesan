/** 예산 설정 읽기 — settings.json 을 손으로 고쳐 모양이 틀려도 엔진이 멈추지 않게 걸러서 쓴다 */

import type { Settings } from '../../types/index.js';
import { DEFAULT_SETTINGS, getSettings } from '../../infra/config.js';
import { REQUIRED_DOC_KINDS } from './bundle-kinds.js';

export type BudgetSettings = Settings['budget'];

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []);

export function normalizeBudgetSettings(raw: unknown): BudgetSettings {
  const d = DEFAULT_SETTINGS.budget;
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const year = Number(b.year);
  const warn = Number(b.warn_at);
  const keep = Number(b.precheck_keep_years);
  const accounts = Array.isArray(b.accounts)
    ? b.accounts.flatMap((a) => {
      const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      const id = typeof o.id === 'string' ? o.id.trim() : '';
      if (!/^[a-z0-9_-]{1,32}$/i.test(id)) return [];
      return [{ id, label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : id, words: strs(o.words) }];
    })
    : [];
  const rules = Array.isArray(b.rules)
    ? b.rules.flatMap((r) => {
      const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      const nature = typeof o.nature === 'string' ? o.nature.trim().slice(0, 20) : '';
      const words = strs(o.words);
      const docs = Array.isArray(o.docs) ? strs(o.docs).filter((k) => (REQUIRED_DOC_KINDS as readonly string[]).includes(k)) : undefined;
      return nature && words.length ? [{ nature, words, hints: strs(o.hints), ...(docs ? { docs: [...new Set(docs)] } : {}) }] : [];
    })
    : [];
  return {
    year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : 0,
    warn_at: Number.isFinite(warn) && warn >= 1 && warn <= 100 ? warn : d.warn_at,
    over_block: typeof b.over_block === 'boolean' ? b.over_block : d.over_block,
    precheck_keep_years: Number.isInteger(keep) && keep >= 1 && keep <= 50 ? keep : 0,
    accounts: accounts.length ? dedupe(accounts) : d.accounts.map((a) => ({ ...a, words: [...a.words] })),
    rules: rules.length ? rules : d.rules.map((r) => ({ ...r, words: [...r.words], hints: [...r.hints], ...(r.docs ? { docs: [...r.docs] } : {}) })),
  };
}

function dedupe<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

export function budgetSettings(): BudgetSettings {
  return normalizeBudgetSettings(getSettings().budget);
}

/** 쓸 회계연도 (요청 → 설정 → 올해) */
export function yearOf(year?: number): number {
  if (Number.isInteger(year) && (year as number) >= 2000 && (year as number) <= 2100) return year as number;
  return budgetSettings().year || new Date().getFullYear();
}
