/** 집행 전 점검표 실행 (budget_precheck) — 고른 과목의 잔액과 근거 조항을 읽어 precheck.ts 의 규칙으로 점검한다 */

import type { BudgetPrecheck, BudgetPrecheckBundle, BudgetPrecheckRecord } from '../../types/rpc-contract.js';
import { budgetSettings, yearOf } from './settings.js';
import { loadBook } from './store.js';
import { viewOf } from './tally.js';
import { guideFind, guideList } from './guide.js';
import { buildPrecheck } from './precheck.js';
import { buildRecord } from './precheck-record.js';
import { newRecordId, saveRecord } from './precheck-store.js';

type Params = { bundle: BudgetPrecheckBundle; item_id?: string; amount?: number; year?: number };

async function run(p: Params): Promise<{ precheck: BudgetPrecheck; item?: { id: string; name: string }; amount?: number }> {
  const s = budgetSettings();
  const book = p.item_id ? await loadBook(yearOf(p.year)) : undefined;
  const raw = book?.items.find((x) => x.id === p.item_id);
  const item = raw && book ? viewOf(raw, book.entries) : undefined;
  const guides = await guideList();
  const a = p.bundle.analysis;
  const clauses = guides.length && item
    ? await guideFind({ text: (a.basis ?? '').slice(0, 8000), item: raw, nature: a.nature, limit: 5 }, s.rules)
    : [];
  const amount = p.amount && p.amount > 0 ? Math.round(p.amount) : undefined;
  const precheck = buildPrecheck({
    bundle: p.bundle,
    amount,
    item: item ? { name: item.name, budget: item.budget, paid: item.paid, commit: item.commit, avail: item.avail } : undefined,
    warnAt: s.warn_at,
    rules: s.rules,
    clauses,
    hasGuides: guides.length > 0,
  });
  return { precheck, ...(raw ? { item: { id: raw.id, name: raw.name } } : {}), amount };
}

export async function budgetPrecheck(p: Params): Promise<BudgetPrecheck> {
  return (await run(p)).precheck;
}

/** 점검을 다시 해 계좌번호를 가린 기록으로 (저장하지 않음) */
export async function budgetPrecheckRecord(p: Params & { memo?: string }): Promise<BudgetPrecheckRecord> {
  const r = await run(p);
  return buildRecord({ bundle: p.bundle, precheck: r.precheck, year: yearOf(p.year), item: r.item, amount: r.amount, memo: p.memo });
}

/** 같은 기록을 이 PC 앱 데이터에 보관 */
export async function budgetPrecheckSave(p: Params & { memo?: string }): Promise<BudgetPrecheckRecord> {
  const r = await run(p);
  const at = new Date();
  const rec = buildRecord({ bundle: p.bundle, precheck: r.precheck, year: yearOf(p.year), item: r.item, amount: r.amount, memo: p.memo, id: newRecordId(at), at });
  await saveRecord(rec);
  return rec;
}
