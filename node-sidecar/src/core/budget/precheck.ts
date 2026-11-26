/** 집행 전 점검표 (budget_precheck) — 지출 서류 묶음을 AI 없이 정해진 규칙으로 점검한다.
 *  서류 구비 · 금액 일치 · 사업자번호·계좌·날짜 · 예산 잔액 · 규정 금액 기준 대조.
 *  결과는 "이상 없음 / 확인 필요 / 점검 못함" 셋뿐이고, 집행 가능 여부·규정 적합 여부는 판정하지 않는다.
 *  필요 서류 목록은 일반적인 공공기관 관행의 기본값(추정)이며 설정(거래 성격 규칙)에서 기관 기준으로 고친다. */

import type { BudgetBundleKind, BudgetGuideMatch, BudgetPrecheck, BudgetPrecheckBundle, BudgetPrecheckClause, BudgetPrecheckItem, BudgetPrecheckStatus } from '../../types/rpc-contract.js';
import type { Settings } from '../../types/index.js';
import { DEFAULT_SETTINGS } from '../../infra/config.js';
import { brnValid } from '../receipt/parse.js';
import { BUNDLE_LABEL, REQUIRED_DOC_KINDS } from './bundle-kinds.js';

const won = (n: number) => n.toLocaleString('ko-KR');

/** 거래 성격을 모를 때 최소로 보는 서류 */
const GENERIC_DOCS: BudgetBundleKind[] = ['letter'];

export interface PrecheckInput {
  bundle: BudgetPrecheckBundle;
  /** 이번 지출 금액 (화면에서 고친 값, 없으면 공문에서 읽은 금액) */
  amount?: number;
  /** 고른 예산 과목 (없으면 잔액 점검은 하지 않음) */
  item?: { name: string; budget: number; paid: number; commit: number; avail: number };
  warnAt: number;
  rules: Settings['budget']['rules'];
  /** 근거 조항 후보 (budget_guide_find 결과, 규정 파일이 없으면 빈 배열) */
  clauses: BudgetGuideMatch[];
  /** 규정 파일을 하나라도 넣었는가 */
  hasGuides: boolean;
}

/* ───────── 필요 서류 ───────── */

/** 서류 종류가 요구를 채우는가: 영수증 요구는 거래명세서·세금계산서도, 공문 요구는 계획서·품의서도 채운다 */
function satisfies(need: BudgetBundleKind, has: Set<BudgetBundleKind>): boolean {
  if (need === 'receipt') return has.has('receipt') || has.has('invoice');
  if (need === 'letter') return has.has('letter') || has.has('plan') || has.has('request');
  return has.has(need);
}

/** 거래 성격의 필요 서류 (설정의 docs → 기본값의 같은 성격 → 공문만). source 는 기본값에서 고쳤는지 */
export function requiredDocs(nature: string | undefined, rules: Settings['budget']['rules']): { kinds: BudgetBundleKind[]; source: 'default' | 'settings' } {
  const valid = (list?: string[]) => (list ?? []).filter((k): k is BudgetBundleKind => (REQUIRED_DOC_KINDS as readonly string[]).includes(k));
  const mine = nature ? rules.find((r) => r.nature === nature) : undefined;
  const base = nature ? DEFAULT_SETTINGS.budget.rules.find((r) => r.nature === nature) : undefined;
  const set = mine?.docs ? valid(mine.docs) : undefined;
  if (set) {
    const def = valid(base?.docs);
    const same = def.length === set.length && def.every((k) => set.includes(k));
    return { kinds: set, source: base && same ? 'default' : 'settings' };
  }
  const def = valid(base?.docs);
  return { kinds: def.length ? def : GENERIC_DOCS, source: 'default' };
}

function docsItem(input: PrecheckInput): { item: BudgetPrecheckItem; source: 'default' | 'settings' } {
  const nature = input.bundle.analysis.nature;
  const { kinds, source } = requiredDocs(nature, input.rules);
  const has = new Set(input.bundle.docs.map((d) => d.kind));
  const missing = kinds.filter((k) => !satisfies(k, has));
  const where = nature ? `거래 성격 "${nature}"` : '거래 성격을 읽지 못해 공문만';
  const details = [`${where} 기준 필요 서류: ${kinds.map((k) => BUNDLE_LABEL[k]).join(' · ')} (${source === 'settings' ? '설정' : '일반 기본값, 추정'})`];
  if (!nature) details.push('공문에서 거래 성격을 읽지 못했습니다. 성격을 알면 더 정확히 점검합니다.');
  if (missing.length) details.push(`빠진 서류: ${missing.map((k) => BUNDLE_LABEL[k]).join(' · ')}`);
  return {
    source,
    item: {
      id: 'docs', label: '서류 구비', status: missing.length ? 'check' : 'ok',
      summary: missing.length ? `${missing.map((k) => BUNDLE_LABEL[k]).join('·')}이(가) 없습니다` : '필요한 서류가 모두 있습니다',
      details,
    },
  };
}

/* ───────── 금액 일치 ───────── */

function amountItem(input: PrecheckInput, amount: number | undefined): BudgetPrecheckItem {
  const { receipts_total: rec, quotes_total: quo, docs } = input.bundle;
  const details: string[] = [];
  let bad = false; let compared = 0;
  const unread = docs.filter((d) => ['receipt', 'invoice', 'quote'].includes(d.kind) && d.amount === undefined);
  if (amount && rec) {
    compared++;
    if (rec !== amount) { bad = true; details.push(`영수증·명세서 합계 ${won(rec)}원이 지출 금액 ${won(amount)}원과 다릅니다 (차이 ${won(Math.abs(rec - amount))}원).`); }
    else details.push(`영수증·명세서 합계가 지출 금액 ${won(amount)}원과 같습니다.`);
  }
  if (amount && quo) {
    compared++;
    if (quo !== amount) { bad = true; details.push(`견적 합계 ${won(quo)}원이 지출 금액 ${won(amount)}원과 다릅니다 (차이 ${won(Math.abs(quo - amount))}원).`); }
    else details.push(`견적 합계가 지출 금액 ${won(amount)}원과 같습니다.`);
  }
  if (rec && quo) {
    compared++;
    if (rec > quo) { bad = true; details.push(`영수증·명세서 합계 ${won(rec)}원이 견적 합계 ${won(quo)}원보다 ${won(rec - quo)}원 많습니다.`); }
  }
  if (unread.length) { bad = true; details.push(`금액을 읽지 못한 서류 ${unread.length}개: ${unread.slice(0, 3).map((d) => d.name + (d.page ? ` ${d.page}쪽` : '')).join(', ')}${unread.length > 3 ? ' 등' : ''}. 원본을 확인하세요.`); }
  if (!amount) details.push('지출 금액이 비어 있어 서류 금액과 견주지 못했습니다.');
  if (!compared && !unread.length) {
    return { id: 'amount', label: '금액 일치', status: 'na', summary: '견줄 영수증·견적 금액이 없습니다', details: details.length ? details : ['영수증·견적서·세금계산서를 함께 넣으면 지출 금액과 견줍니다.'] };
  }
  return { id: 'amount', label: '금액 일치', status: bad ? 'check' : 'ok', summary: bad ? '서류 금액이 서로 다르거나 읽지 못한 것이 있습니다' : '서류 금액이 서로 맞습니다', details };
}

/* ───────── 사업자·계좌·날짜 ───────── */

const dateKey = (s?: string): string | undefined => {
  const m = s?.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined;
};

function partyItem(input: PrecheckInput, docsNeed: BudgetBundleKind[]): BudgetPrecheckItem {
  const docs = input.bundle.docs;
  const details: string[] = [];
  let bad = false; let checked = 0;
  for (const d of docs) {
    if (!d.brn) continue;
    checked++;
    const digits = d.brn.replace(/\D/g, '');
    if (digits.length !== 10 || !brnValid(digits)) { bad = true; details.push(`${d.name}${d.page ? ` ${d.page}쪽` : ''}: 사업자등록번호 ${d.brn}의 검증 숫자가 맞지 않습니다. 읽기 오류이거나 잘못된 번호일 수 있습니다.`); }
  }
  if (checked && !bad) details.push(`사업자등록번호 ${checked}건의 검증 숫자가 맞습니다 (등록 여부·휴폐업은 확인하지 않음).`);
  const brns = new Set(docs.filter((d) => d.brn).map((d) => d.brn!.replace(/\D/g, '')));
  if (brns.size > 1) details.push(`서로 다른 사업자번호 ${brns.size}개가 있습니다. 거래처가 여럿이면 정상입니다.`);
  const banks = docs.filter((d) => d.kind === 'bank');
  if (banks.length) {
    checked++;
    const noAcct = banks.filter((d) => !d.account);
    if (noAcct.length) { bad = true; details.push(`계좌번호를 읽지 못한 계좌 사본 ${noAcct.length}개. 원본을 보고 지급할 곳을 확인하세요.`); }
    const noHolder = banks.filter((d) => d.account && !d.holder);
    if (noHolder.length) { bad = true; details.push(`예금주를 읽지 못한 계좌 사본 ${noHolder.length}개. 예금주가 거래처와 같은지 확인하세요.`); }
    if (!noAcct.length && !noHolder.length) details.push('계좌 사본의 계좌번호·예금주를 읽었습니다. 예금주가 거래처와 같은지는 직접 확인하세요.');
  } else if (docsNeed.includes('bank')) {
    details.push('지급할 곳을 확인할 계좌 사본이 없습니다 (서류 구비 점검에 표시).');
  }
  const sent = dateKey(input.bundle.analysis.sent_date);
  if (sent) {
    for (const d of docs) {
      const k = dateKey(d.date);
      if (k && ['receipt', 'invoice', 'quote'].includes(d.kind) && k < sent) { checked++; bad = true; details.push(`${d.name}${d.page ? ` ${d.page}쪽` : ''}: 날짜 ${k}가 공문 시행일 ${sent}보다 앞섭니다. 사전 집행 여부를 확인하세요.`); }
    }
  }
  if (!checked) return { id: 'party', label: '사업자·계좌·날짜', status: 'na', summary: '점검할 사업자번호·계좌·날짜를 읽지 못했습니다', details: details.length ? details : ['영수증·세금계산서·계좌 사본을 함께 넣으면 점검합니다.'] };
  return { id: 'party', label: '사업자·계좌·날짜', status: bad ? 'check' : 'ok', summary: bad ? '확인할 값이 있습니다' : '읽은 값에서 이상한 점이 없습니다', details };
}

/* ───────── 예산 잔액 ───────── */

function balanceItem(input: PrecheckInput, amount: number | undefined): BudgetPrecheckItem {
  const it = input.item;
  if (!it) return { id: 'balance', label: '예산 잔액', status: 'na', summary: '예산 과목을 고르면 점검합니다', details: [] };
  if (!amount) return { id: 'balance', label: '예산 잔액', status: 'na', summary: '지출 금액을 적으면 점검합니다', details: [`${it.name} 가용 잔액 ${won(it.avail)}원`] };
  const after = it.avail - amount;
  const rate = it.budget > 0 ? ((it.paid + it.commit + amount) / it.budget) * 100 : 0;
  const details = [`${it.name}: 가용 잔액 ${won(it.avail)}원, 이번 ${won(amount)}원 → 반영 뒤 ${won(after)}원 (집행률 ${rate.toFixed(1)}%)`];
  if (after < 0) { details.push('잔액을 넘습니다. 다른 과목을 고르거나 예산 변경(전용·추경) 여부를 회계 담당과 확인하세요.'); return { id: 'balance', label: '예산 잔액', status: 'check', summary: `잔액이 ${won(-after)}원 모자랍니다`, details }; }
  if (rate >= input.warnAt) { details.push(`집행률이 경고 기준 ${input.warnAt}% 이상입니다. 남은 사업 일정을 확인하세요.`); return { id: 'balance', label: '예산 잔액', status: 'check', summary: `반영하면 집행률 ${rate.toFixed(1)}%`, details }; }
  return { id: 'balance', label: '예산 잔액', status: 'ok', summary: '잔액이 충분합니다', details };
}

/* ───────── 규정 금액 기준 대조 ───────── */

const UNIT: Record<string, number> = { 천: 1e3, 만: 1e4, 백만: 1e6, 천만: 1e7, 억: 1e8 };
const RULE_RE = /^(1인당|1회당|1건당|건당|회당|연간|월)?\s*(\d[\d,]*(?:\.\d+)?)\s*(천|만|백만|천만|억)?\s*원\s*(이내|이하|이상|초과|미만|까지|한도)?$/;

/** 조항의 금액 기준 글 → 기준값. 읽을 수 없으면 undefined */
export function parseRule(text: string): { scope: 'person' | 'once' | 'period' | 'total'; limit: number; op?: string } | undefined {
  const m = RULE_RE.exec(text.trim());
  if (!m) return undefined;
  const limit = Math.round(Number(m[2].replace(/,/g, '')) * (m[3] ? UNIT[m[3]] : 1));
  if (!Number.isFinite(limit) || limit <= 0) return undefined;
  const scope = m[1] === '1인당' ? 'person' : m[1] === '연간' || m[1] === '월' ? 'period' : m[1] ? 'once' : 'total';
  return { scope, limit, op: m[4] };
}

/** "20명"·"약 30명 내외" 의 인원 (명 앞 숫자, 없으면 첫 숫자) */
export function peopleOf(text?: string): number | undefined {
  if (!text) return undefined;
  const m = text.match(/(\d[\d,]*)\s*명/) ?? text.match(/(\d[\d,]*)/);
  const n = m ? Number(m[1].replace(/,/g, '')) : 0;
  return n > 0 ? n : undefined;
}

export function judgeRule(rule: string, amount: number | undefined, people: number | undefined): Pick<BudgetPrecheckClause, 'verdict' | 'note'> {
  const r = parseRule(rule);
  if (!r) return { verdict: 'unknown', note: '기준 글을 읽지 못해 견주지 않았습니다. 조항 원문을 보세요.' };
  if (!amount) return { verdict: 'unknown', note: '지출 금액이 없어 견주지 못했습니다.' };
  if (r.scope === 'period') return { verdict: 'unknown', note: '연간·월 한도는 누적 지출을 알아야 해 견주지 않았습니다.' };
  let value = amount;
  let what = `이번 금액 ${won(amount)}원`;
  if (r.scope === 'person') {
    if (!people) return { verdict: 'unknown', note: '대상 인원을 읽지 못해 1인당 금액을 견주지 못했습니다. 인원을 확인하세요.' };
    value = Math.round(amount / people);
    what = `1인당 ${won(value)}원 (${won(amount)}원 ÷ ${people}명)`;
  }
  const op = r.op;
  if (op === '이내' || op === '이하' || op === '까지' || op === '한도') {
    return value <= r.limit ? { verdict: 'ok', note: `${what}: 기준 ${won(r.limit)}원 안입니다.` } : { verdict: 'over', note: `${what}: 기준 ${won(r.limit)}원을 ${won(value - r.limit)}원 넘습니다.` };
  }
  if (op === '이상' || op === '초과' || op === '미만') {
    const hit = op === '이상' ? value >= r.limit : op === '초과' ? value > r.limit : value < r.limit;
    return hit ? { verdict: 'applies', note: `${what}: "${op}" 기준 ${won(r.limit)}원에 해당합니다. 조항에 정한 절차·제한을 확인하세요.` } : { verdict: 'ok', note: `${what}: "${op}" 기준 ${won(r.limit)}원에 해당하지 않습니다.` };
  }
  return { verdict: 'unknown', note: `${what}, 기준 ${won(r.limit)}원 (상한인지 하한인지 글에 없어 견주지 않았습니다).` };
}

function ruleItem(input: PrecheckInput, amount: number | undefined): BudgetPrecheckItem {
  const label = '규정 금액 기준';
  if (!input.hasGuides) return { id: 'rule', label, status: 'na', summary: '규정 파일이 없어 대조하지 못했습니다', details: ['설정 › 예산과 회계에서 기관 규정·지침 파일을 넣으면 맞는 조항의 금액 기준을 견줍니다.'] };
  const people = peopleOf(input.bundle.analysis.people);
  const clauses: BudgetPrecheckClause[] = [];
  for (const m of input.clauses) {
    for (const rule of m.amounts) clauses.push({ guide: m.guide, no: m.no, title: m.title, rule, ...judgeRule(rule, amount, people) });
  }
  if (!clauses.length) return { id: 'rule', label, status: 'na', summary: input.clauses.length ? '맞는 조항에서 금액 기준을 찾지 못했습니다' : '맞는 조항을 찾지 못했습니다', details: ['과목을 고르면 그 과목에 맞는 조항을 찾습니다. 조항 원문은 "근거 조항"에서 보세요.'] };
  const flagged = clauses.filter((c) => c.verdict === 'over' || c.verdict === 'applies' || c.verdict === 'unknown');
  return {
    id: 'rule', label,
    status: flagged.length ? 'check' : 'ok',
    summary: flagged.length ? `확인할 기준 ${flagged.length}건 (조항 ${clauses.length}건 대조)` : `찾은 금액 기준 ${clauses.length}건 안입니다`,
    details: ['낱말이 맞은 조항 후보의 금액 기준입니다. 이 조항이 이번 지출에 실제로 적용되는지는 원문을 읽고 담당자가 판단하세요.'],
    clauses,
  };
}

/* ───────── 묶음 ───────── */

export function buildPrecheck(input: PrecheckInput): BudgetPrecheck {
  const amount = input.amount ?? input.bundle.analysis.amount;
  const docs = docsItem(input);
  const need = requiredDocs(input.bundle.analysis.nature, input.rules).kinds;
  const items = [docs.item, amountItem(input, amount), partyItem(input, need), balanceItem(input, amount), ruleItem(input, amount)];
  return {
    ...(input.bundle.analysis.nature ? { nature: input.bundle.analysis.nature } : {}),
    docs_source: docs.source,
    items,
    caveat: '정해진 규칙으로 읽은 값만 견준 참고용 점검표입니다. 집행 가능 여부와 규정 적합 여부는 기관 규정 원문과 회계 담당 확인으로 정하세요.',
  };
}

export const statusCount = (p: BudgetPrecheck): Record<BudgetPrecheckStatus, number> => p.items.reduce((c, i) => ({ ...c, [i.status]: c[i.status] + 1 }), { ok: 0, check: 0, na: 0 });
