/** 예산 과목표 표 → 과목 (순수 함수) — 머리 칸 알아보기, 금액·단위, 합계·소계 줄 거르기, 회계 구분 */

import type { BudgetItem, BudgetMapping } from '../../types/rpc-contract.js';
import type { BudgetSettings } from './settings.js';

type Field = keyof BudgetMapping;

/** 머리 칸 이름 (띄어쓰기·괄호 뺀 뒤 같으면 우선, 그다음 포함) */
const LABELS: Record<Field, string[]> = {
  account: ['회계구분', '회계', '재원', '재원구분', '사업구분', '예산구분'],
  program: ['정책사업', '사업명', '대사업', '프로그램', '사업'],
  unit: ['단위사업', '중사업', '단위과제'],
  detail: ['세부사업', '세부사업명', '소사업', '내역사업', '세부과제', '세부내역'],
  name: ['과목', '과목명', '세목', '통계목', '편성목', '비목', '세세목', '지출항목', '항목', '목', '예산과목'],
  code: ['과목코드', '예산코드', '코드', '사업코드'],
  budget: ['예산액', '예산현액', '배정액', '편성액', '예산금액', '예산', '최종예산', '현예산'],
  spent: ['집행액', '지출액', '기집행액', '집행누계', '지출누계', '누계집행액', '집행'],
};
const FIELDS = Object.keys(LABELS) as Field[];

const norm = (s: string) => s.replace(/\s|\(.*?\)|\[.*?\]|[:：·]/g, '');

/** 머리 줄 찾기: 앞 15줄 가운데 알아본 칸이 가장 많은 줄 (과목·예산액이 있어야) */
export function detectHeader(grid: string[][]): { row: number; mapping: BudgetMapping; unit: number } | null {
  let best: { row: number; mapping: BudgetMapping; n: number; unit: number } | null = null;
  for (let r = 0; r < Math.min(15, grid.length); r++) {
    const mapping = mapRow(grid[r]);
    const n = Object.keys(mapping).length;
    if ((mapping.name === undefined && mapping.detail === undefined) || mapping.budget === undefined) continue;
    if (!best || n > best.n) best = { row: r, mapping, n, unit: unitOf(grid, r, mapping) };
  }
  return best ? { row: best.row, mapping: best.mapping, unit: best.unit } : null;
}

function mapRow(row: string[]): BudgetMapping {
  const cells = row.map((c) => norm(c ?? ''));
  const m: BudgetMapping = {};
  const used = new Set<number>();
  // 같은 이름 먼저, 다음에 포함 (예: "세부사업명"이 "사업"에 먼저 잡히지 않게)
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of FIELDS) {
      if (m[f] !== undefined) continue;
      for (const label of LABELS[f]) {
        const i = cells.findIndex((c, idx) => !used.has(idx) && c !== '' && (pass === 'exact' ? c === label : c.includes(label) && label.length >= 2));
        if (i >= 0) { m[f] = i; used.add(i); break; }
      }
    }
  }
  return m;
}

/** 금액 단위: 머리 칸이나 표 위 줄의 "(단위: 천원)"·"예산액(천원)" */
function unitOf(grid: string[][], headerRow: number, m: BudgetMapping): number {
  const head = [m.budget, m.spent].filter((i): i is number => i !== undefined).map((i) => grid[headerRow][i] ?? '').join(' ');
  const above = grid.slice(0, headerRow).flat().join(' ');
  const t = `${head} ${above}`;
  if (/백만\s*원/.test(t)) return 1e6;
  if (/천\s*원/.test(t)) return 1e3;
  if (/만\s*원/.test(t)) return 1e4;
  return 1;
}

/** "1,234,000" "(1,000)" "-" → 수 */
export function moneyOf(s: string | undefined): number | null {
  const t = (s ?? '').replace(/[\s원₩]/g, '');
  if (!t || t === '-' || t === '0') return t === '0' ? 0 : null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = Number(t.replace(/[(),-]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const SUBTOTAL = /^(합\s*계|소\s*계|총\s*계|누\s*계|계|합|총액|total|subtotal)$/i;

/** 회계 구분 칸 글 → 회계 id (이름·단서 낱말) */
export function accountOf(cell: string, accounts: BudgetSettings['accounts'], fallback: string): string {
  const t = cell.replace(/\s/g, '');
  if (!t) return fallback;
  const direct = accounts.find((a) => a.id === t || a.label.replace(/\s/g, '') === t);
  if (direct) return direct.id;
  const loose = accounts.find((a) => [a.label, ...a.words].some((w) => w.length >= 2 && (t.includes(w.replace(/\s/g, '')) || w.replace(/\s/g, '').includes(t))));
  return loose?.id ?? fallback;
}

export type ParsedItem = Pick<BudgetItem, 'account' | 'program' | 'unit' | 'detail' | 'name' | 'code' | 'budget' | 'spent_before'>;

/** 머리 줄 아래를 과목으로. 위 칸이 비면(병합 칸) 앞 줄 사업 이름을 이어 받는다 */
export function rowsToItems(grid: string[][], headerRow: number, m: BudgetMapping, unit: number, accounts: BudgetSettings['accounts'], fallback: string): { items: ParsedItem[]; skipped: number } {
  const items: ParsedItem[] = [];
  let skipped = 0;
  const carry = { account: '', program: '', unit: '', detail: '' };
  const cell = (row: string[], i: number | undefined) => (i === undefined ? '' : (row[i] ?? '').replace(/\s+/g, ' ').trim());
  for (const row of grid.slice(headerRow + 1)) {
    if (!row.some((c) => (c ?? '').trim())) continue;
    for (const k of ['account', 'program', 'unit', 'detail'] as const) {
      const v = cell(row, m[k]);
      if (v) {
        carry[k] = v;
        // 윗 단계가 바뀌면 아랫 단계 이어받기를 끊는다
        if (k === 'program') { carry.unit = ''; carry.detail = ''; }
        if (k === 'unit') carry.detail = '';
      }
    }
    const name = cell(row, m.name) || (m.name === undefined ? cell(row, m.detail) : '');
    const budget = moneyOf(cell(row, m.budget));
    const words = [name, cell(row, m.detail), cell(row, m.unit), cell(row, m.program)];
    if (!name || budget === null || words.some((w) => SUBTOTAL.test(w.replace(/\s/g, '')))) { skipped++; continue; }
    const spent = moneyOf(cell(row, m.spent));
    items.push({
      account: accountOf(carry.account, accounts, fallback),
      program: carry.program,
      unit: carry.unit,
      detail: m.name === undefined ? '' : carry.detail,
      name,
      ...(cell(row, m.code) ? { code: cell(row, m.code) } : {}),
      budget: Math.round(budget * unit),
      spent_before: Math.round((spent ?? 0) * unit),
    });
  }
  return { items, skipped };
}

/** 같은 과목을 알아보는 열쇠 (코드가 있으면 코드) */
export function itemKey(it: Pick<BudgetItem, 'account' | 'program' | 'unit' | 'detail' | 'name' | 'code'>): string {
  return it.code ? `${it.account}#code#${it.code}` : [it.account, it.program, it.unit, it.detail, it.name].map((s) => s.replace(/\s/g, '')).join('#');
}
