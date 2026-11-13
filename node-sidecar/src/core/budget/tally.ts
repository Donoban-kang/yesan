/** 잔액 계산 — 지출 대장 줄을 더해 과목마다 집행·품의 중·가용 잔액 (순수 함수, 저장과 무관) */

import type { BudgetEntry, BudgetItem, BudgetItemView, BudgetTally } from '../../types/rpc-contract.js';

/** 원 단위 정수로 */
export const won = (n: number): number => Math.round(Number.isFinite(n) ? n : 0);

export function tallyOf(item: BudgetItem, entries: BudgetEntry[]): BudgetTally {
  let paid = won(item.spent_before);
  let commit = 0;
  for (const e of entries) {
    if (e.item_id !== item.id || e.synced_at) continue;
    if (e.stage === 'paid') paid += e.amount;
    else commit += e.amount;
  }
  const avail = won(item.budget) - paid - commit;
  const rate = item.budget > 0 ? Math.round(((paid + commit) / item.budget) * 1000) / 10 : paid + commit > 0 ? 100 : 0;
  return { paid, commit, avail, rate };
}

export function viewOf(item: BudgetItem, entries: BudgetEntry[]): BudgetItemView {
  return { ...item, ...tallyOf(item, entries) };
}

/** 이미 취소된 묶음 (취소 줄이 가리키는 줄의 묶음) */
export function reversedGroups(entries: BudgetEntry[]): Set<string> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out = new Set<string>();
  for (const e of entries) if (e.kind === 'reverse' && e.reverses) { const t = byId.get(e.reverses); if (t) out.add(t.group); }
  return out;
}

/** 정산(지출 완료로 넘김)된 품의 줄 */
export function settledCommits(entries: BudgetEntry[], reversed: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (e.kind === 'settle' && e.settles && !reversed.has(e.group)) out.add(e.settles);
  return out;
}

/** 취소할 수 있는 묶음: 취소 줄이 아니고, 아직 취소 안 했고, 정산된 품의(정산 묶음을 먼저 취소)가 아닌 것 */
export function reversibleGroups(entries: BudgetEntry[]): string[] {
  const reversed = reversedGroups(entries);
  const settled = settledCommits(entries, reversed);
  const groups = new Set<string>();
  for (const e of entries) {
    if (e.kind === 'reverse' || reversed.has(e.group)) continue;
    if (e.stage === 'commit' && e.kind === 'apply' && settled.has(e.id)) continue;
    groups.add(e.group);
  }
  return [...groups];
}

/** 반영된 채로 남은 공문 경로 */
export function linkedDocs(entries: BudgetEntry[]): string[] {
  const reversed = reversedGroups(entries);
  const out = new Set<string>();
  for (const e of entries) if (e.doc_path && e.kind !== 'reverse' && !reversed.has(e.group)) out.add(e.doc_path);
  return [...out];
}
