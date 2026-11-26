/** RPC 메서드 — 예산 지출 도우미 (core/budget) */

import type { RpcRouter } from '../router.js';
import type { BudgetMapping } from '../../types/rpc-contract.js';
import {
  budgetAnalyze, budgetApply, budgetApplySplit, budgetEvidence, budgetBook, budgetExport, budgetImport, budgetItemAdd, budgetItemUpdate, budgetReverse, budgetSettle, budgetSuggest,
} from '../../core/budget/index.js';
import { guideAdd, guideClause, guideFind, guideList, guideRemove } from '../../core/budget/guide.js';
import { budgetSettings, yearOf } from '../../core/budget/settings.js';
import { loadBook } from '../../core/budget/store.js';
import { budgetBundle } from '../../core/budget/bundle.js';
import { budgetPrecheck, budgetPrecheckRecord, budgetPrecheckSave } from '../../core/budget/precheck-run.js';
import { deleteRecord, getRecord, listRecords } from '../../core/budget/precheck-store.js';
import type { BudgetBundleDoc, BudgetPrecheckBundle } from '../../types/rpc-contract.js';
import { bool, num, oneOf, optPath, registrar, reqPath, reqPaths, str, strList } from './params.js';

const MAP_KEYS = ['account', 'program', 'unit', 'detail', 'name', 'code', 'budget', 'spent'] as const;

function mapping(v: unknown): BudgetMapping | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: BudgetMapping = {};
  for (const k of MAP_KEYS) if (Number.isInteger(o[k])) out[k] = o[k] as number;
  return out;
}

const year = (p: Record<string, unknown>) => num(p.year);

/** 점검표에 넘어온 묶음 읽기 결과를 필요한 값만 남겨 모양을 맞춘다 (화면이 보낸 값이라도 믿지 않는다) */
function precheckBundle(v: unknown): BudgetPrecheckBundle {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const a = (o.analysis && typeof o.analysis === 'object' ? o.analysis : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  const docs = (Array.isArray(o.docs) ? o.docs : []).slice(0, 60).flatMap((d): BudgetBundleDoc[] => {
    const r = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    if (typeof r.kind !== 'string' || typeof r.name !== 'string') return [];
    return [{
      path: str(r.path) ?? '', name: r.name, kind: r.kind as BudgetBundleDoc['kind'], label: str(r.label) ?? '',
      ...(num(r.page) ? { page: num(r.page) } : {}), ...(num(r.amount) !== undefined ? { amount: num(r.amount) } : {}),
      ...(str(r.date) ? { date: str(r.date) } : {}), ...(str(r.brn) ? { brn: str(r.brn) } : {}),
      ...(str(r.bank) ? { bank: str(r.bank) } : {}), ...(str(r.account) ? { account: str(r.account) } : {}), ...(str(r.holder) ? { holder: str(r.holder) } : {}),
    }];
  });
  return {
    docs, receipts_total: n(o.receipts_total), quotes_total: n(o.quotes_total),
    analysis: { amount: num(a.amount), title: str(a.title), people: str(a.people), nature: str(a.nature), sent_date: str(a.sent_date), basis: str(a.basis) ?? '' },
  };
}
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
  reg('budget_bundle', (p, signal) => budgetBundle({ paths: reqPaths(p.paths), year: year(p) }, signal), { heavy: true });
  reg('budget_precheck', (p) => budgetPrecheck({ bundle: precheckBundle(p.bundle), item_id: str(p.item_id), amount: num(p.amount), year: year(p) }));
  const precheckArgs = (p: Record<string, unknown>) => ({ bundle: precheckBundle(p.bundle), item_id: str(p.item_id), amount: num(p.amount), year: year(p), memo: str(p.memo) });
  reg('budget_precheck_record', (p) => budgetPrecheckRecord(precheckArgs(p)));
  reg('budget_precheck_save', (p) => budgetPrecheckSave(precheckArgs(p)));
  reg('budget_precheck_list', () => listRecords());
  reg('budget_precheck_get', (p) => getRecord(id(p.id)));
  reg('budget_precheck_delete', (p) => deleteRecord(id(p.id)));
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
  reg('budget_apply_split', (p) => {
    const stage = oneOf(p.stage, ['commit', 'paid'] as const);
    if (!stage) throw new Error('반영 단계(품의 또는 지출 완료)를 고르세요.');
    const parts = (Array.isArray(p.parts) ? p.parts : []).map((x) => {
      const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      return { item_id: id(o.item_id), amount: num(o.amount) ?? 0, memo: str(o.memo) };
    });
    return budgetApplySplit({
      year: year(p), parts, stage, date: str(p.date),
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
  reg('budget_guide_list', () => guideList());
  reg('budget_guide_add', (p, signal) => guideAdd(reqPaths(p.paths), signal), { heavy: true });
  reg('budget_guide_remove', (p) => guideRemove(id(p.id)));
  reg('budget_guide_find', async (p) => {
    const s = budgetSettings();
    const itemId = str(p.item_id);
    const item = itemId ? (await loadBook(yearOf(year(p)))).items.find((x) => x.id === itemId) : undefined;
    return guideFind({ text: (str(p.text) ?? '').slice(0, 8000), item, nature: str(p.nature), words: strList(p.words), limit: num(p.limit) }, s.rules);
  });
  reg('budget_guide_clause', (p) => guideClause(id(p.id), str(p.no) ?? ''));
}
