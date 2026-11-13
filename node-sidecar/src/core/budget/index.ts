/** 예산 지출 도우미 — 과목표 불러오기·공문 분석·추천·반영·정산·취소·엑셀 (budget_* RPC)
 *
 * 금액은 원 단위 정수. 기록은 지우지 않는다(취소·정산은 새 줄). 잔액은 업무 참고용이며 공식 집행·결산은 기관 회계 시스템 기준.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  BudgetAnalysis, BudgetApplyResult, BudgetBookView, BudgetEntry, BudgetImportResult, BudgetItem, BudgetItemView, BudgetMapping, BudgetSuggestion,
} from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
import { parseDoc } from '../converter/index.js';
import { tableGrid } from '../excel/index.js';
import { buildXlsx } from '../excel/xlsx.js';
import { formatOf } from '../files/format.js';
import { cleanLines, extractInbox } from '../inbox/extract.js';
import { isIsoDate, todayIso } from '../inbox/dates.js';
import { outputFile } from '../output/index.js';
import { findAmounts } from './amount.js';
import { detectHeader, itemKey, rowsToItems, type ParsedItem } from './mapping.js';
import { readBudgetDoc } from './read-doc.js';
import { extractVoucher } from './voucher.js';
import { budgetSettings, yearOf } from './settings.js';
import { loadBook, saveBook, serial, type BudgetFile } from './store.js';
import { accountHintOf, natureOf, suggestItems } from './suggest.js';
import { linkedDocs, reversedGroups, reversibleGroups, settledCommits, viewOf, won } from './tally.js';

const MAX_AMOUNT = 1e13;
const newId = () => randomUUID().replace(/-/g, '').slice(0, 12);
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

function amountOk(n: unknown, what = '금액'): number {
  const v = typeof n === 'number' ? Math.round(n) : NaN;
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${what}을 1원 이상으로 적으세요.`);
  if (v > MAX_AMOUNT) throw new Error(`${what}이 너무 큽니다. 원 단위로 적었는지 확인하세요.`);
  return v;
}

function viewBook(book: BudgetFile): BudgetBookView {
  const s = budgetSettings();
  const items = book.items.map((it) => viewOf(it, book.entries));
  const sum = (list: BudgetItemView[]) => {
    const budget = list.reduce((n, x) => n + x.budget, 0);
    const paid = list.reduce((n, x) => n + x.paid, 0);
    const commit = list.reduce((n, x) => n + x.commit, 0);
    return { budget, paid, commit, avail: budget - paid - commit, rate: budget > 0 ? Math.round(((paid + commit) / budget) * 1000) / 10 : 0 };
  };
  // 설정에 없는 회계 id 로 들어온 과목도 보이게
  const ids = [...s.accounts.map((a) => a.id), ...items.map((x) => x.account).filter((id) => !s.accounts.some((a) => a.id === id))];
  const accounts = [...new Set(ids)].map((id) => {
    const list = items.filter((x) => x.account === id);
    return { id, label: s.accounts.find((a) => a.id === id)?.label ?? id, items: list.length, ...sum(list) };
  });
  return {
    year: book.year,
    accounts,
    items,
    entries: book.entries,
    reversible: reversibleGroups(book.entries),
    linked_docs: linkedDocs(book.entries),
    imports: book.imports,
    totals: sum(items.filter((x) => !x.retired)),
  };
}

export async function budgetBook(p: { year?: number }): Promise<BudgetBookView> {
  return viewBook(await loadBook(yearOf(p.year)));
}

// ── 과목표 불러오기 ──

async function readGrid(path: string, signal?: AbortSignal): Promise<string[][]> {
  const f = formatOf(path);
  if (!['xlsx', 'xls', 'csv'].includes(f)) throw new Error('예산 과목표는 엑셀(XLSX·XLS) 또는 CSV 파일로 넣으세요.');
  const r = await parseDoc(path, { images: false, signal });
  const tables = r.blocks.filter((b) => b.type === 'table' && b.table).map((b) => tableGrid(b.table!));
  if (!tables.length) throw new Error('파일에서 표를 찾지 못했습니다. 첫 시트에 과목·예산액 칸이 있는 표를 두세요.');
  // 과목 머리를 알아보는 표 가운데 가장 큰 것
  const ok = tables.filter((g) => detectHeader(g)).sort((a, b) => b.length - a.length);
  return ok[0] ?? tables.sort((a, b) => b.length - a.length)[0];
}

export async function budgetImport(
  p: { path: string; year?: number; account?: string; mapping?: BudgetMapping; unit?: number; dry_run?: boolean },
  signal?: AbortSignal,
): Promise<BudgetImportResult> {
  const s = budgetSettings();
  const year = yearOf(p.year);
  const fallback = p.account && s.accounts.some((a) => a.id === p.account) ? p.account : s.accounts[0].id;
  sendProgress({ current: 0, total: 2, message: '과목표 읽는 중' });
  const grid = await readGrid(p.path, signal);
  const found = detectHeader(grid);
  const headerRow = found?.row ?? 0;
  const mapping = p.mapping && Object.keys(p.mapping).length ? cleanMapping(p.mapping, grid[headerRow]?.length ?? 0) : found?.mapping;
  const header = grid[headerRow] ?? [];
  const warnings: string[] = [];
  if (!mapping || (mapping.name === undefined && mapping.detail === undefined) || mapping.budget === undefined) {
    return { header, mapping: mapping ?? {}, unit: 1, preview: [], added: 0, updated: 0, retired: 0, synced: 0, total_budget: 0, warnings: ['과목 이름 칸과 예산액 칸을 알아보지 못했습니다. 칸을 직접 고르세요.'], saved: false };
  }
  const unit = p.unit && [1, 1e3, 1e4, 1e6].includes(p.unit) ? p.unit : found?.unit ?? 1;
  const { items: parsed, skipped } = rowsToItems(grid, headerRow, mapping, unit, s.accounts, fallback);
  if (!parsed.length) warnings.push('머리 줄 아래에서 과목을 하나도 읽지 못했습니다. 칸 고르기를 확인하세요.');
  if (skipped) warnings.push(`합계·소계·빈 금액 줄 ${skipped}개는 뺐습니다.`);
  if (mapping.spent === undefined) warnings.push('집행액 칸이 없어 기집행액을 0으로 두었습니다.');
  const dupes = parsed.length - new Set(parsed.map(itemKey)).size;
  if (dupes) warnings.push(`같은 과목이 ${dupes}번 더 나와 금액을 더했습니다.`);
  const merged = mergeDupes(parsed);
  const total = merged.reduce((n, x) => n + x.budget, 0);
  const preview = merged.slice(0, 20);
  if (p.dry_run) return { header, mapping, unit, preview, added: merged.length, updated: 0, retired: 0, synced: 0, total_budget: total, warnings, saved: false };

  sendProgress({ current: 1, total: 2, message: '장부에 넣는 중' });
  const sha256 = createHash('sha256').update(await readFile(p.path)).digest('hex');
  return serial(async () => {
    const book = await loadBook(year);
    const at = new Date().toISOString();
    const old = new Map(book.items.map((it) => [itemKey(it), it]));
    const used = new Set(book.entries.map((e) => e.item_id));
    let added = 0;
    let updated = 0;
    const next: BudgetItem[] = merged.map((it) => {
      const prev = old.get(itemKey(it));
      if (prev) { old.delete(itemKey(it)); updated++; return { ...prev, ...it, keywords: prev.keywords, retired: undefined }; }
      added++;
      return { id: newId(), ...it, keywords: [] };
    });
    // 새 과목표에서 빠진 과목: 기록이 있으면 남기고(retired) 없으면 뺀다
    let retired = 0;
    for (const it of old.values()) if (used.has(it.id)) { next.push({ ...it, retired: true }); retired++; }
    // 새 과목표에 집행액 칸이 있으면 그때까지의 지출 완료 기록은 공식 기집행액에 들어간 것으로 본다(두 번 세지 않게)
    let synced = 0;
    if (mapping.spent !== undefined) {
      // 취소한 묶음(지출 + 그 취소)은 더해서 0 이라 건드리지 않는다. 살아 있는 지출만 넘긴다
      const reversed = reversedGroups(book.entries);
      for (const e of book.entries) {
        if (e.stage !== 'paid' || e.synced_at || e.kind === 'reverse' || reversed.has(e.group)) continue;
        e.synced_at = at;
        synced++;
      }
      if (synced) warnings.push(`지출 대장의 지출 완료 ${synced}줄은 새 과목표의 집행액에 들어간 것으로 보고 잔액 계산에서 뺐습니다.`);
    }
    book.items = next;
    book.imports.push({ at, file: basename(p.path), sha256, items: merged.length });
    await saveBook(book);
    return { header, mapping, unit, preview, added, updated, retired, synced, total_budget: total, warnings, saved: true };
  });
}

function cleanMapping(m: BudgetMapping, cols: number): BudgetMapping {
  const out: BudgetMapping = {};
  for (const [k, v] of Object.entries(m)) if (Number.isInteger(v) && v >= 0 && v < Math.max(cols, 1)) out[k as keyof BudgetMapping] = v;
  return out;
}

function mergeDupes(list: ParsedItem[]): ParsedItem[] {
  const by = new Map<string, ParsedItem>();
  for (const it of list) {
    const k = itemKey(it);
    const prev = by.get(k);
    if (prev) { prev.budget += it.budget; prev.spent_before += it.spent_before; } else by.set(k, { ...it });
  }
  return [...by.values()];
}

export async function budgetItemAdd(p: { year?: number; account: string; program?: string; unit?: string; detail?: string; name: string; code?: string; budget: number; spent_before?: number; keywords?: string[] }): Promise<BudgetItemView> {
  const s = budgetSettings();
  if (!s.accounts.some((a) => a.id === p.account)) throw new Error('회계 구분을 고르세요.');
  const name = clip(p.name, 80);
  if (!name) throw new Error('과목 이름을 적으세요.');
  const budget = amountOk(p.budget, '예산액');
  const spent = Math.max(0, won(p.spent_before ?? 0));
  return serial(async () => {
    const book = await loadBook(yearOf(p.year));
    const it: BudgetItem = {
      id: newId(), account: p.account, program: clip(p.program, 80), unit: clip(p.unit, 80), detail: clip(p.detail, 80), name,
      ...(clip(p.code, 40) ? { code: clip(p.code, 40) } : {}), budget, spent_before: spent, keywords: (p.keywords ?? []).map((k) => clip(k, 20)).filter(Boolean),
    };
    if (book.items.some((x) => itemKey(x) === itemKey(it))) throw new Error('같은 과목이 이미 있습니다.');
    book.items.push(it);
    await saveBook(book);
    return viewOf(it, book.entries);
  });
}

export async function budgetItemUpdate(p: { year?: number; id: string; keywords?: string[]; budget?: number; spent_before?: number }): Promise<BudgetItemView> {
  return serial(async () => {
    const book = await loadBook(yearOf(p.year));
    const it = book.items.find((x) => x.id === p.id);
    if (!it) throw new Error('과목을 찾지 못했습니다. 화면을 새로 고친 뒤 다시 하세요.');
    if (p.keywords) it.keywords = [...new Set(p.keywords.map((k) => clip(k, 20)).filter(Boolean))].slice(0, 30);
    if (p.budget !== undefined) it.budget = amountOk(p.budget, '예산액');
    if (p.spent_before !== undefined) it.spent_before = Math.max(0, won(p.spent_before));
    await saveBook(book);
    return viewOf(it, book.entries);
  });
}

// ── 공문 분석·추천 ──

const PERIOD = /^(?:[가-하]\.\s*|\d+\)\s*)?(?:일\s*시|기\s*간|일\s*정|행사\s*일|집행\s*기한|사업\s*기간|운영\s*기간)\s*[:：]?\s*(.+)$/;
const PEOPLE = /^(?:[가-하]\.\s*|\d+\)\s*)?(?:대\s*상|인\s*원|참\s*가\s*자|참석\s*대상)\s*[:：]?\s*(.+)$/;

export async function budgetAnalyze(p: { path: string; year?: number }, signal?: AbortSignal): Promise<BudgetAnalysis> {
  sendProgress({ current: 0, total: 2, message: '공문 읽는 중' });
  const doc = await readBudgetDoc(p.path, signal);
  if (doc.markdown.replace(/\s/g, '').length < 10) throw new Error('공문 글자를 읽지 못했습니다. 스캔한 공문이면 설정 › 저장과 연결에서 스캔한 쪽 글자 읽기를 켜고 다시 넣으세요.');
  sendProgress({ current: 1, total: 2, message: '금액·과목 찾는 중' });
  const s = budgetSettings();
  const book = await loadBook(yearOf(p.year));
  const items = book.items.map((it) => viewOf(it, book.entries));
  const base = { path: p.path, name: basename(p.path), format: doc.format, notes: doc.notes };

  // 회계 시스템의 원인행위서·지출결의서: 칸에서 바로 읽는다
  const v = extractVoucher(doc.markdown);
  if (v) {
    const subjects = v.lines.map((l) => [l.detail, l.subject].filter(Boolean).join(' '));
    const title = v.title ?? '';
    // 추천 글은 건명과 예산 줄만 (명세서 표의 이름·계좌는 넣지 않는다)
    const basis = [title, ...v.lines.map((l) => [l.source, l.detail, l.subject].filter(Boolean).join(' '))].join('\n').slice(0, 4000);
    const nat = natureOf(basis, title, s.rules);
    const account = accountHintOf(v.lines.map((l) => `${l.source ?? ''} ${l.detail} ${l.subject}`).join('\n'), s.accounts) ?? accountHintOf(title, s.accounts);
    const amounts = v.total ? [{ value: v.total, source: `${v.kind} 금액 칸`, confidence: 0.97, form: '결의서' }] : [];
    for (const l of v.lines) if (l.amount !== v.total && !amounts.some((x) => x.value === l.amount)) amounts.push({ value: l.amount, source: `예산 줄: ${l.subject}`, confidence: 0.9, form: '결의서' });
    return {
      ...base,
      doc_kind: v.kind,
      ...(v.fiscal_year ? { fiscal_year: v.fiscal_year } : {}),
      ...(v.resolution_no ? { resolution_no: v.resolution_no, doc_number: v.resolution_no } : {}),
      ...(title ? { title } : {}),
      ...(v.dept ? { sender: v.dept } : {}),
      ...(v.date ? { sent_date: v.date } : {}),
      purpose: title || undefined,
      ...(v.total ? { amount: v.total } : {}),
      amounts,
      ...(nat.nature ? { nature: nat.nature } : {}),
      nature_words: nat.words,
      ...(account ? { account_hint: account } : {}),
      budget_lines: v.lines,
      ...(v.memo ? { memo: v.memo.slice(0, 600) } : {}),
      ...(v.related ? { related: v.related } : {}),
      checks: v.checks,
      basis,
      subjects,
      suggestions: suggestItems(items, book.entries, s, { text: basis, nature: nat.nature, account, amount: v.total, sender: v.dept, subjects }),
    };
  }

  const lines = cleanLines(doc.markdown);
  const ex = extractInbox(doc.markdown, todayIso());
  const title = ex.title ?? '';
  const text = lines.join('\n');
  const amounts = findAmounts(lines);
  const nat = natureOf(text, title, s.rules);
  const account = accountHintOf(text, s.accounts);
  const find = (re: RegExp) => lines.map((l) => l.match(re)?.[1]?.trim()).find((x) => x && x.length >= 2)?.slice(0, 120);
  const basis = `${title}\n${text}`.slice(0, 4000);
  const due = ex.requests.map((r) => r.due).filter((d): d is string => Boolean(d)).sort()[0];
  const fy = doc.markdown.slice(0, 3000).match(/(\d{4})\s*회계\s*연도/);
  const amount = amounts[0]?.value;
  return {
    ...base,
    doc_kind: '공문',
    ...(fy ? { fiscal_year: Number(fy[1]) } : {}),
    ...(title ? { title } : {}),
    ...(ex.sender ? { sender: ex.sender } : {}),
    ...(ex.doc_number ? { doc_number: ex.doc_number } : {}),
    ...(ex.sent_date ? { sent_date: ex.sent_date } : {}),
    ...(due ? { due } : {}),
    purpose: title || ex.requests[0]?.text,
    period: find(PERIOD),
    people: find(PEOPLE),
    ...(amount ? { amount } : {}),
    amounts,
    ...(nat.nature ? { nature: nat.nature } : {}),
    nature_words: nat.words,
    ...(account ? { account_hint: account } : {}),
    basis,
    suggestions: suggestItems(items, book.entries, s, { text: basis, nature: nat.nature, account, amount, sender: ex.sender }),
  };
}

export async function budgetSuggest(p: { year?: number; text: string; nature?: string; account?: string; amount?: number; sender?: string; limit?: number; subjects?: string[] }): Promise<BudgetSuggestion[]> {
  const book = await loadBook(yearOf(p.year));
  const items = book.items.map((it) => viewOf(it, book.entries));
  return suggestItems(items, book.entries, budgetSettings(), { ...p, text: p.text.slice(0, 8000), account: p.account || undefined, subjects: p.subjects?.slice(0, 20).map((x) => x.slice(0, 300)) });
}

// ── 반영·정산·취소 ──

function warnFor(it: BudgetItemView): string | undefined {
  const s = budgetSettings();
  return it.rate >= s.warn_at ? `${it.name} 집행률(품의 포함)이 ${it.rate}%로 경고 기준 ${s.warn_at}%를 넘었습니다.` : undefined;
}

function overCheck(it: BudgetItemView, extra: number): void {
  if (extra <= 0 || it.avail - extra >= 0) return;
  const short = extra - it.avail;
  const msg = `${it.name} 가용 잔액(${it.avail.toLocaleString('ko-KR')}원)보다 ${short.toLocaleString('ko-KR')}원 많습니다. 다른 과목을 고르거나 예산 변경(전용·추경) 여부를 회계 담당과 확인하세요.`;
  if (budgetSettings().over_block) throw new Error(`${msg} (설정 › 예산과 회계에서 "잔액을 넘는 반영 막기"를 끄면 경고만 합니다)`);
}

const by = () => getSettings().org.person || undefined;
const dateOk = (d?: string) => (d && isIsoDate(d) ? d : todayIso());

export async function budgetApply(p: {
  year?: number; item_id: string; amount: number; stage: 'commit' | 'paid'; date?: string;
  doc_path?: string; doc_title?: string; doc_number?: string; sender?: string; memo?: string;
}): Promise<BudgetApplyResult> {
  const amount = amountOk(p.amount);
  return serial(async () => {
    const book = await loadBook(yearOf(p.year));
    const item = book.items.find((x) => x.id === p.item_id);
    if (!item) throw new Error('예산 과목을 찾지 못했습니다. 과목표를 다시 불러왔다면 과목을 다시 고르세요.');
    if (item.retired) throw new Error('지금 과목표에 없는 과목입니다. 다른 과목을 고르세요.');
    overCheck(viewOf(item, book.entries), amount);
    const group = newId();
    const e: BudgetEntry = {
      id: newId(), group, at: new Date().toISOString(), date: dateOk(p.date), item_id: item.id, amount, stage: p.stage, kind: 'apply',
      ...(p.doc_path ? { doc_path: p.doc_path } : {}),
      ...(clip(p.doc_title, 200) ? { doc_title: clip(p.doc_title, 200) } : {}),
      ...(clip(p.doc_number, 80) ? { doc_number: clip(p.doc_number, 80) } : {}),
      ...(clip(p.sender, 80) ? { sender: clip(p.sender, 80) } : {}),
      ...(clip(p.memo, 300) ? { memo: clip(p.memo, 300) } : {}),
      ...(by() ? { by: by() } : {}),
    };
    book.entries.push(e);
    await saveBook(book);
    const view = viewOf(item, book.entries);
    return { entries: [e], item: view, warning: warnFor(view) };
  });
}

export async function budgetSettle(p: { year?: number; id: string; amount?: number; date?: string; memo?: string }): Promise<BudgetApplyResult> {
  return serial(async () => {
    const book = await loadBook(yearOf(p.year));
    const c = book.entries.find((e) => e.id === p.id);
    if (!c || c.stage !== 'commit' || c.kind !== 'apply') throw new Error('품의 중인 기록만 지출 완료로 바꿀 수 있습니다.');
    const reversed = reversedGroups(book.entries);
    if (reversed.has(c.group)) throw new Error('취소한 품의입니다.');
    if (settledCommits(book.entries, reversed).has(c.id)) throw new Error('이미 지출 완료로 바꾼 품의입니다.');
    const item = book.items.find((x) => x.id === c.item_id);
    if (!item) throw new Error('예산 과목을 찾지 못했습니다.');
    const paid = p.amount === undefined ? c.amount : amountOk(p.amount, '지출 금액');
    overCheck(viewOf(item, book.entries), paid - c.amount);
    const group = newId();
    const at = new Date().toISOString();
    const base = { group, at, date: dateOk(p.date), item_id: c.item_id, kind: 'settle' as const, settles: c.id, doc_path: c.doc_path, doc_title: c.doc_title, doc_number: c.doc_number, sender: c.sender, ...(by() ? { by: by() } : {}) };
    const close: BudgetEntry = { ...base, id: newId(), amount: -c.amount, stage: 'commit', memo: '품의 정산' };
    const pay: BudgetEntry = { ...base, id: newId(), amount: paid, stage: 'paid', ...(clip(p.memo, 300) ? { memo: clip(p.memo, 300) } : {}) };
    book.entries.push(close, pay);
    await saveBook(book);
    const view = viewOf(item, book.entries);
    return { entries: [close, pay], item: view, warning: warnFor(view) };
  });
}

export async function budgetReverse(p: { year?: number; id: string; reason?: string }): Promise<BudgetApplyResult> {
  return serial(async () => {
    const book = await loadBook(yearOf(p.year));
    const target = book.entries.find((e) => e.id === p.id);
    if (!target) throw new Error('기록을 찾지 못했습니다. 화면을 새로 고친 뒤 다시 하세요.');
    if (!reversibleGroups(book.entries).includes(target.group)) {
      const settled = settledCommits(book.entries, reversedGroups(book.entries)).has(target.id);
      throw new Error(settled ? '지출 완료로 바꾼 품의입니다. 지출 완료 기록을 먼저 취소하세요.' : '이미 취소했거나 취소할 수 없는 기록입니다.');
    }
    const at = new Date().toISOString();
    const group = newId();
    const reason = clip(p.reason, 200);
    const made: BudgetEntry[] = book.entries.filter((e) => e.group === target.group).map((e) => ({
      id: newId(), group, at, date: todayIso(), item_id: e.item_id, amount: -e.amount, stage: e.stage, kind: 'reverse', reverses: e.id,
      doc_path: e.doc_path, doc_title: e.doc_title, doc_number: e.doc_number, sender: e.sender,
      // 공식 기집행액에 넘어간 지출의 취소는 잔액 계산에서도 빼야 맞다(원래 줄이 빠져 있으므로)
      ...(e.synced_at ? { synced_at: e.synced_at } : {}),
      memo: reason ? `취소: ${reason}` : '취소', ...(by() ? { by: by() } : {}),
    }));
    book.entries.push(...made);
    await saveBook(book);
    const item = book.items.find((x) => x.id === target.item_id)!;
    return { entries: made, item: viewOf(item, book.entries) };
  });
}

// ── 엑셀 ──

const STAGE: Record<BudgetEntry['stage'], string> = { commit: '품의(집행 예정)', paid: '지출 완료' };
const KIND: Record<BudgetEntry['kind'], string> = { apply: '반영', settle: '정산', reverse: '취소' };

export async function budgetExport(p: { year?: number; output_path?: string }): Promise<{ output_path: string; items: number; entries: number }> {
  const book = await loadBook(yearOf(p.year));
  if (!book.items.length) throw new Error('예산 과목이 없습니다. 과목표를 먼저 불러오세요.');
  const v = viewBook(book);
  const label = new Map(v.accounts.map((a) => [a.id, a.label]));
  const status = [
    ['회계 구분', '정책사업', '단위사업', '세부사업', '과목', '코드', '예산액', '집행액', '품의 중', '가용 잔액', '집행률(%)', '비고'],
    ...v.items.map((it) => [label.get(it.account) ?? it.account, it.program, it.unit, it.detail, it.name, it.code ?? '', String(it.budget), String(it.paid), String(it.commit), String(it.avail), String(it.rate), it.retired ? '과목표에 없음' : '']),
    ['합계', '', '', '', '', '', String(v.totals.budget), String(v.totals.paid), String(v.totals.commit), String(v.totals.avail), String(v.totals.rate), ''],
  ];
  const name = new Map(v.items.map((it) => [it.id, it]));
  const ledger = [
    ['집행일', '기록 시각', '구분', '단계', '회계 구분', '과목', '금액', '근거 공문', '문서번호', '보낸 곳', '메모', '담당', '비고'],
    ...book.entries.map((e) => {
      const it = name.get(e.item_id);
      return [e.date, e.at.replace('T', ' ').slice(0, 19), KIND[e.kind], STAGE[e.stage], it ? label.get(it.account) ?? it.account : '', it ? `${it.detail ? `${it.detail} › ` : ''}${it.name}` : e.item_id, String(e.amount), e.doc_title ?? '', e.doc_number ?? '', e.sender ?? '', e.memo ?? '', e.by ?? '', e.synced_at ? '공식 집행액에 반영됨' : ''];
    }),
  ];
  const data = await buildXlsx([
    { name: '예산 현황', header: true, rows: status },
    { name: '지출 대장', header: true, rows: ledger },
  ]);
  const out = outputFile({ output_path: p.output_path, name: `예산현황_${book.year}_${todayIso().replace(/-/g, '')}.xlsx` });
  await writeFile(out, data);
  return { output_path: out, items: v.items.length, entries: book.entries.length };
}


