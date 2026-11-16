/** 공문 속 금액 읽기 — "금1,980,000원", "3,450천원", "120만원", "금일백구십팔만원정", 표 단위 "(단위: 천원)"
 *
 * 줄마다 금액 후보를 뽑고, 예산·소요액·지원액 같은 낱말이 있는 줄을 믿을 만한 것으로 친다.
 * 날짜·전화·문서번호·인원(명)·쪽수 같은 숫자는 금액으로 보지 않는다.
 */

import type { BudgetAmount } from '../../types/rpc-contract.js';

/** 이 낱말이 든 줄의 금액을 먼저 본다 (뒤로 갈수록 약함) */
const STRONG = /(소요\s*예산|소요액|사업비|총\s*사업비|지원\s*액|지원\s*금|예산\s*액|집행\s*액|교부\s*액|배정\s*액|계약\s*금액|추정\s*가격|총\s*액|합\s*계|금\s*액|예\s*산|비\s*용|단\s*가)/;
/** 금액처럼 보여도 아닌 줄 */
const NOT_MONEY_LINE = /(전화|팩스|FAX|TEL|☎|사업자\s*등록\s*번호|계좌|우편\s*번호)/i;

const KOR_DIGIT: Record<string, number> = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const KOR_SMALL: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const KOR_BIG: Record<string, number> = { 만: 1e4, 억: 1e8, 조: 1e12 };

/** "일백구십팔만" → 1980000. 한글 숫자가 아니면 null */
export function koreanNumber(s: string): number | null {
  const t = s.replace(/\s/g, '');
  if (!t || /[^영공일이삼사오육칠팔구십백천만억조]/.test(t)) return null;
  let total = 0;
  let section = 0;
  let digit = -1;
  for (const ch of t) {
    if (ch in KOR_DIGIT) {
      digit = KOR_DIGIT[ch];
    } else if (ch in KOR_SMALL) {
      section += (digit < 0 ? 1 : digit) * KOR_SMALL[ch];
      digit = -1;
    } else if (ch in KOR_BIG) {
      const part = section + (digit < 0 ? 0 : digit);
      total += (part || 1) * KOR_BIG[ch];
      section = 0;
      digit = -1;
    }
  }
  total += section + (digit < 0 ? 0 : digit);
  return total > 0 ? total : null;
}

const UNIT: Record<string, number> = { '원': 1, '천원': 1e3, '만원': 1e4, '백만원': 1e6, '천만원': 1e7, '억원': 1e8, '억': 1e8 };

/** 숫자 글 → 수 ("1,980,000" "3,450.5" "1.980.000") */
function numberOf(raw: string): number | null {
  let t = raw.replace(/\s/g, '');
  // 점을 천 단위로 쓴 꼴 (1.980.000)
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(t)) t = t.replace(/\./g, '');
  t = t.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 줄 하나의 금액 후보 */
export function amountsInLine(line: string, tableUnit = 1): Array<{ value: number; form: string }> {
  if (NOT_MONEY_LINE.test(line)) return [];
  const out: Array<{ value: number; form: string }> = [];
  const seen = new Set<string>();
  const push = (value: number, form: string, at: string) => {
    const v = Math.round(value);
    if (v < 1000 || v > 1e13 || seen.has(at)) return;
    seen.add(at);
    out.push({ value: v, form });
  };
  // 한글 금액: 금일백구십팔만원정, 일금 삼백만 원
  for (const m of line.matchAll(/(?:일금|금)\s*([영공일이삼사오육칠팔구십백천만억조\s]{2,})\s*원/g)) {
    const v = koreanNumber(m[1]);
    if (v) push(v, '한글', `k${m.index}`);
  }
  // 숫자 + 단위: 1,980,000원 · 3,450천원 · 120만원 · 1.5억원 (뒤의 "(부가세 포함)" 은 상관없음)
  for (const m of line.matchAll(/(?<![\d.,\-/])(\d{1,3}(?:[,]\d{3})+(?:\.\d+)?|\d{1,3}(?:\.\d{3}){2,}|\d+(?:\.\d+)?)\s*(백만원|천만원|천원|만원|억원|억|원)(?![가-힣]*[일월년])/g)) {
    const n = numberOf(m[1]);
    if (n === null) continue;
    push(n * UNIT[m[2]], m[2] === '원' ? '원' : m[2], `n${m.index}`);
  }
  // 단위 없는 쉼표 숫자: 표 칸("| 1,980,000 |")이나 "금액: 1,980,000" — 표 단위를 곱한다
  if (STRONG.test(line) || line.includes('|')) {
    for (const m of line.matchAll(/(?<![\d.,\-/:])(\d{1,3}(?:,\d{3})+)(?![\d,]*\s*(?:원|천원|만원|명|개|건|쪽|회|대|%|년|월|일))/g)) {
      const n = numberOf(m[1]);
      if (n === null) continue;
      push(n * tableUnit, tableUnit === 1000 ? '천원(표 단위)' : tableUnit === 1 ? '숫자' : '표 단위', `t${m.index}`);
    }
  }
  return out;
}

/** "(단위: 천원)" 같은 표 단위 */
export function tableUnitOf(text: string): number {
  const m = text.match(/단\s*위\s*[:：]?\s*(백만원|천원|만원|원)/);
  return m ? UNIT[m[1]] : 1;
}

/** 공문 줄들 → 금액 후보 (믿을 만한 것 먼저, 같은 값은 하나로) */
export function findAmounts(lines: string[]): BudgetAmount[] {
  const unit = tableUnitOf(lines.join('\n'));
  const best = new Map<number, BudgetAmount>();
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    for (const a of amountsInLine(line, unit)) {
      const strong = STRONG.test(line);
      const total = /(합\s*계|총\s*액|총\s*사업비|소요\s*예산|소요액|계\s*\|)/.test(line);
      let confidence = strong ? 0.75 : 0.45;
      if (total) confidence += 0.15;
      if (a.form === '원' || a.form === '한글') confidence += 0.05;
      if (a.form.includes('표 단위') || a.form === '숫자') confidence -= 0.15;
      // 앞쪽 본문 줄을 조금 더 (붙임 표 끝의 작은 값보다)
      confidence -= Math.min(0.1, i / 2000);
      const c = Math.max(0.05, Math.min(0.98, confidence));
      const prev = best.get(a.value);
      const source = line.length > 140 ? `${line.slice(0, 137)}…` : line;
      if (!prev || prev.confidence < c) best.set(a.value, { value: a.value, source, confidence: Math.round(c * 100) / 100, form: a.form });
    }
  });
  return [...best.values()].sort((a, b) => b.confidence - a.confidence || b.value - a.value).slice(0, 8);
}
