/** 점검 기록 (순수 함수, 화면에서도 쓴다) — 계좌번호 가리기, 기록 만들기, 문서(HWPX)로 낼 글
 *
 * 보관·내보내는 기록에는 계좌번호 중간 3자리를 가려 담는다(예금주·은행은 그대로). 파일 경로는 담지 않는다.
 * 화면에 보이는 지급할 곳(원본 그대로)과 달리, 이 기록은 파일로 남아 다른 사람에게 갈 수 있기 때문이다.
 */

import type { BudgetPrecheck, BudgetPrecheckBundle, BudgetPrecheckRecord, BudgetPrecheckRecordSummary, BudgetPrecheckStatus } from '../../types/rpc-contract.js';

const won = (n: number) => n.toLocaleString('ko-KR');

/** 계좌번호의 숫자 가운데 중간 3자리를 *로 (붙임표·공백은 그대로). 숫자가 3자리 이하면 모두 가린다
 *  예: 1002-345-678901 → 1002-3**-*78901 */
export function maskAccount(account: string): string {
  const total = (account.match(/\d/g) ?? []).length;
  if (!total) return account;
  const start = total <= 3 ? 0 : Math.floor((total - 3) / 2);
  let i = 0;
  return account.replace(/\d/g, (d) => { const at = i++; return at >= start && at < start + 3 ? '*' : d; });
}

export interface RecordInput {
  bundle: BudgetPrecheckBundle;
  precheck: BudgetPrecheck;
  year: number;
  item?: { id: string; name: string };
  amount?: number;
  memo?: string;
  /** 보관할 때만 */
  id?: string;
  at?: Date;
}

export function buildRecord(p: RecordInput): BudgetPrecheckRecord {
  const a = p.bundle.analysis;
  const title = (a.title ?? '').replace(/\s+/g, ' ').trim() || p.bundle.docs[0]?.name || '지출 서류';
  const amount = p.amount ?? a.amount;
  const memo = (p.memo ?? '').trim().slice(0, 500);
  return {
    id: p.id ?? '',
    saved_at: (p.at ?? new Date()).toISOString(),
    year: p.year,
    title,
    ...(a.nature ? { nature: a.nature } : {}),
    ...(amount ? { amount } : {}),
    ...(p.item ? { item: p.item } : {}),
    ...(memo ? { memo } : {}),
    docs: p.bundle.docs.slice(0, 60).map((d) => ({
      name: d.name, ...(d.page ? { page: d.page } : {}), kind: d.kind, label: d.label,
      ...(d.amount !== undefined ? { amount: d.amount } : {}), ...(d.date ? { date: d.date } : {}), ...(d.brn ? { brn: d.brn } : {}),
      ...(d.bank ? { bank: d.bank } : {}), ...(d.account ? { account: maskAccount(d.account) } : {}), ...(d.holder ? { holder: d.holder } : {}),
    })),
    receipts_total: p.bundle.receipts_total,
    quotes_total: p.bundle.quotes_total,
    precheck: p.precheck,
  };
}

export function summaryOf(r: BudgetPrecheckRecord): BudgetPrecheckRecordSummary {
  const n = (s: BudgetPrecheckStatus) => r.precheck.items.filter((i) => i.status === s).length;
  return { id: r.id, saved_at: r.saved_at, title: r.title, ...(r.amount ? { amount: r.amount } : {}), ...(r.item ? { item_name: r.item.name } : {}), ok: n('ok'), check: n('check'), na: n('na') };
}

const STATUS: Record<BudgetPrecheckStatus, string> = { ok: '이상 없음', check: '확인 필요', na: '점검 못함' };
const VERDICT = { ok: '기준 안', over: '기준 넘음', applies: '기준 해당', unknown: '견주지 못함' } as const;
/** 표 칸 안에 넣을 글: 줄바꿈·세로선 정리 */
const cell = (s: string | number | undefined) => String(s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim() || '-';
const dateText = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };

/** 기록 → generate_hwpx 에 넣을 마크다운 (내부 검토용 보고 꼴) */
export function precheckMarkdown(r: BudgetPrecheckRecord): string {
  const L: string[] = [];
  L.push(`# 집행 전 점검표`, '', `작성일 ${dateText(r.saved_at)} · ${r.year}회계연도`, '');
  L.push('## 1. 지출 개요', '');
  L.push(`- 건명: ${cell(r.title)}`);
  if (r.nature) L.push(`- 거래 성격: ${r.nature}`);
  L.push(`- 지출 금액: ${r.amount ? `금${won(r.amount)}원` : '미정'}`);
  L.push(`- 예산 과목: ${r.item ? cell(r.item.name) : '미정'}`);
  if (r.memo) L.push(`- 메모: ${cell(r.memo)}`);
  L.push('', '## 2. 넣은 서류', '', '| 서류 | 종류 | 금액 | 날짜 |', '| --- | --- | --- | --- |');
  for (const d of r.docs) L.push(`| ${cell(d.name + (d.page ? ` ${d.page}쪽` : ''))} | ${cell(d.label)} | ${d.amount !== undefined ? `${won(d.amount)}원` : '-'} | ${cell(d.date)} |`);
  if (r.receipts_total || r.quotes_total) L.push('', `영수증·명세서 합계 ${won(r.receipts_total)}원 · 견적 합계 ${won(r.quotes_total)}원`);
  const banks = r.docs.filter((d) => d.kind === 'bank' && (d.account || d.holder));
  if (banks.length) {
    L.push('', '## 3. 지급할 곳 (계좌번호 중간 3자리를 가림)', '');
    for (const b of banks) L.push(`- ${[b.bank, b.account].filter(Boolean).join(' ') || '계좌번호 미확인'}${b.holder ? `, 예금주 ${cell(b.holder)}` : ''}`);
  }
  L.push('', `## ${banks.length ? 4 : 3}. 점검 결과`, '', '| 항목 | 결과 | 내용 |', '| --- | --- | --- |');
  for (const it of r.precheck.items) L.push(`| ${cell(it.label)} | ${STATUS[it.status]} | ${cell([it.summary, ...it.details].join(' '))} |`);
  const clauses = r.precheck.items.flatMap((i) => i.clauses ?? []);
  if (clauses.length) {
    L.push('', '규정 금액 기준 대조 (낱말이 맞은 조항 후보, 적용 여부는 원문으로 판단)', '');
    for (const c of clauses) L.push(`- ${cell(c.guide)} ${cell(c.no)}${c.title ? `(${cell(c.title)})` : ''}, "${cell(c.rule)}": ${VERDICT[c.verdict]}. ${cell(c.note)}`);
  }
  L.push('', `※ ${r.precheck.caveat}`, `※ 필요 서류 목록은 ${r.precheck.docs_source === 'settings' ? '설정에서 정한 기준' : '일반적인 관행의 기본값(추정)'}입니다.`);
  return L.join('\n');
}
