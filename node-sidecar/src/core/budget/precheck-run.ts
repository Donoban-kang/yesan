/** 집행 전 점검표 실행 (budget_precheck) — 고른 과목의 잔액과 근거 조항을 읽어 precheck.ts 의 규칙으로 점검한다 */

import type { BudgetPrecheck, BudgetPrecheckBundle } from '../../types/rpc-contract.js';
import { budgetSettings, yearOf } from './settings.js';
import { loadBook } from './store.js';
import { viewOf } from './tally.js';
import { guideFind, guideList } from './guide.js';
import { buildPrecheck } from './precheck.js';

export async function budgetPrecheck(p: { bundle: BudgetPrecheckBundle; item_id?: string; amount?: number; year?: number }): Promise<BudgetPrecheck> {
  const s = budgetSettings();
  const book = p.item_id ? await loadBook(yearOf(p.year)) : undefined;
  const raw = book?.items.find((x) => x.id === p.item_id);
  const item = raw && book ? viewOf(raw, book.entries) : undefined;
  const guides = await guideList();
  const a = p.bundle.analysis;
  const clauses = guides.length && item
    ? await guideFind({ text: (a.basis ?? '').slice(0, 8000), item: raw, nature: a.nature, limit: 5 }, s.rules)
    : [];
  return buildPrecheck({
    bundle: p.bundle,
    amount: p.amount && p.amount > 0 ? Math.round(p.amount) : undefined,
    item: item ? { name: item.name, budget: item.budget, paid: item.paid, commit: item.commit, avail: item.avail } : undefined,
    warnAt: s.warn_at,
    rules: s.rules,
    clauses,
    hasGuides: guides.length > 0,
  });
}
