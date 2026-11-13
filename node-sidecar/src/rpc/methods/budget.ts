/** RPC 메서드 — 예산 지출 도우미 (core/budget) */

import type { RpcRouter } from '../router.js';
import type { BudgetMapping } from '../../types/rpc-contract.js';
import {
  budgetAnalyze, budgetApply, budgetEvidence, budgetBook, budgetExport, budgetImport, budgetItemAdd, budgetItemUpdate, budgetReverse, budgetSettle, budgetSuggest,
} from '../../core/budget/index.js';
import { bool, num, oneOf, optPath, registrar, reqPath, str, strList } from './params.js';

const MAP_KEYS = ['account', 'program', 'unit', 'detail', 'name', 'code', 'budget', 'spent'] as const;

function mapping(v: unknown): BudgetMapping | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: BudgetMapping = {};
  for (const k of MAP_KEYS) if (Number.isInteger(o[k])) out[k] = o[k] as number;
  return out;
}

const year = (p: Record<string, unknown>) => num(p.year);
const id = (v: unknown) => {
  const s = str(v);
  if (!s) throw new Error('기록을 고르세요.');
  return s;
};

export function registerBudget(router: RpcRouter): void {
  const reg = registrar(router);
  reg('budget_book', (p) => budgetBook({ year: year(p) }));
  reg('budget_import', (p, signal) => budgetImport({
    path: reqPath(p.path), year: year(p), account: str(p.account), mapping: mapping(p.mapping), unit: num(p.unit), dry_run: bool(p.dry_run),
  }, signal), { heavy: true });
  reg('budget_item_add', (p) => budgetItemAdd({
    year: year(p), account: str(p.account) ?? '', program: str(p.program), unit: str(p.unit), detail: str(p.detail), name: str(p.name) ?? '', code: str(p.code),
    budget: num(p.budget) ?? 0, spent_before: num(p.spent_before), keywords: strList(p.keywords),
  }));
  reg('budget_item_update', (p) => budgetItemUpdate({ year: year(p), id: id(p.id), keywords: strList(p.keywords), budget: num(p.budget), spent_before: num(p.spent_before) }));
  reg('budget_analyze', (p, signal) => budgetAnalyze({ path: reqPath(p.path), year: year(p) }, signal), { heavy: true });
  reg('budget_suggest', (p) => budgetSuggest({
    year: year(p), text: str(p.text) ?? '', nature: str(p.nature), account: str(p.account), amount: num(p.amount), sender: str(p.sender), limit: num(p.limit), subjects: strList(p.subjects),
  }));
  reg('budget_apply', (p) => {
    const stage = oneOf(p.stage, ['commit', 'paid'] as const);
    if (!stage) throw new Error('반영 단계(품의 또는 지출 완료)를 고르세요.');
    return budgetApply({
      year: year(p), item_id: id(p.item_id), amount: num(p.amount) ?? 0, stage, date: str(p.date),
      doc_path: optPath(p.doc_path), doc_title: str(p.doc_title), doc_number: str(p.doc_number), sender: str(p.sender), memo: str(p.memo), again: bool(p.again),
    });
  });
  reg('budget_settle', (p) => budgetSettle({ year: year(p), id: id(p.id), amount: num(p.amount), date: str(p.date), memo: str(p.memo) }));
  reg('budget_reverse', (p) => budgetReverse({ year: year(p), id: id(p.id), reason: str(p.reason) }));
  reg('budget_evidence', (p, signal) => {
    const v = (p.voucher && typeof p.voucher === 'object' ? p.voucher : {}) as Record<string, unknown>;
    return budgetEvidence({
      path: reqPath(p.path),
      voucher: { amount: num(v.amount), vendor_no: str(v.vendor_no), memo: str(v.memo), related: str(v.related), date: str(v.date), kind: oneOf(v.kind, ['travel', 'purchase', 'general'] as const) },
    }, signal);
  }, { heavy: true });
  reg('budget_export', (p) => budgetExport({ year: year(p), output_path: optPath(p.output_path) }));
}
