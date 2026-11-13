/** 예산 과목 추천 (AI 없이) — 거래 성격 규칙 + 낱말 일치 + 회계 구분 단서 + 잔액 + 같은 보낸 곳 이력
 *
 * 점수는 순서를 정하는 데만 쓴다(확률이 아니다). 근거(reasons)를 함께 내서 사람이 고르게 한다.
 */

import type { BudgetEntry, BudgetItemView, BudgetSuggestion } from '../../types/rpc-contract.js';
import type { Settings } from '../../types/index.js';

/** 설정 budget 구획 (settings.ts 를 부르면 엔진 설정 모듈까지 딸려 와 화면 미리보기에서 못 쓴다) */
type BudgetSettings = Settings['budget'];

/** 과목 이름에서 흔해서 근거가 못 되는 낱말 */
const STOP = new Set(['사업', '운영', '지원', '관리', '기타', '일반', '경비', '비용', '활동', '프로그램', '대학', '학교', '추진', '계획', '및', '등']);

/** 이름 → 두 글자 이상 낱말 (괄호·기호로 가름) */
export function wordsOf(s: string): string[] {
  return [...new Set(s.split(/[^가-힣A-Za-z0-9]+/).map((w) => w.trim()).filter((w) => w.length >= 2 && !STOP.has(w)))];
}

/** 글에 나온 거래 성격 (제목에 나온 낱말은 세 번 센다) */
export function natureOf(text: string, title: string, rules: BudgetSettings['rules']): { nature?: string; words: string[] } {
  let best: { nature?: string; words: string[]; score: number } = { words: [], score: 0 };
  for (const r of rules) {
    const hit = r.words.filter((w) => text.includes(w) || title.includes(w));
    if (!hit.length) continue;
    const score = hit.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + countOf(text, w), 0);
    if (score > best.score) best = { nature: r.nature, words: hit, score };
  }
  return { nature: best.nature, words: best.words };
}

function countOf(text: string, w: string): number {
  let n = 0;
  for (let i = text.indexOf(w); i >= 0 && n < 20; i = text.indexOf(w, i + w.length)) n++;
  return n;
}

/** 글에 나온 회계 구분 단서 (가장 많이 나온 것) */
export function accountHintOf(text: string, accounts: BudgetSettings['accounts']): string | undefined {
  let best: { id?: string; n: number } = { n: 0 };
  for (const a of accounts) {
    const n = [a.label, ...a.words].filter((w) => w.length >= 2).reduce((s, w) => s + countOf(text, w), 0);
    if (n > best.n) best = { id: a.id, n };
  }
  return best.id;
}

export interface SuggestInput {
  text: string;
  nature?: string;
  account?: string;
  amount?: number;
  sender?: string;
  limit?: number;
}

export function suggestItems(items: BudgetItemView[], entries: BudgetEntry[], s: BudgetSettings, input: SuggestInput): BudgetSuggestion[] {
  const text = input.text;
  const rule = input.nature ? s.rules.find((r) => r.nature === input.nature) : undefined;
  const amount = input.amount && input.amount > 0 ? input.amount : 0;
  const label = (id: string) => s.accounts.find((a) => a.id === id)?.label ?? id;
  // 같은 보낸 곳 공문에 썼던 과목
  const usedBySender = new Set(input.sender ? entries.filter((e) => e.kind === 'apply' && e.sender === input.sender).map((e) => e.item_id) : []);

  const scored = items.filter((it) => !it.retired).map((it) => {
    const reasons: string[] = [];
    let score = 0;
    if (rule && rule.hints.some((h) => it.name.includes(h) || it.detail.includes(h))) {
      score += 35;
      reasons.push(`거래 성격: ${rule.nature}`);
    }
    const hits: string[] = [];
    const weigh = (words: string[], w: number) => {
      for (const word of words) {
        if (hits.includes(word) || !text.includes(word)) continue;
        hits.push(word);
        score += w;
      }
    };
    weigh(it.keywords.filter((k) => k.length >= 2), 12);
    weigh(wordsOf(it.name), 12);
    weigh(wordsOf(it.detail), 9);
    weigh(wordsOf(it.unit), 6);
    weigh(wordsOf(it.program), 4);
    for (const h of hits.slice(0, 3)) reasons.push(`"${h}" 일치`);
    if (input.account) {
      if (it.account === input.account) { score += 15; reasons.push(`회계: ${label(it.account)}`); } else score -= 12;
    }
    if (usedBySender.has(it.id)) { score += 10; reasons.push('같은 보낸 곳 공문에 쓴 과목'); }
    const enough = it.avail >= amount;
    if (!enough) score -= 20;
    return { item: it, score, reasons, enough, hits: hits.length };
  });
  return scored
    .filter((x) => x.score > 0 && (x.hits > 0 || x.reasons.some((r) => r.startsWith('거래 성격'))))
    .sort((a, b) => b.score - a.score || b.item.avail - a.item.avail)
    .slice(0, Math.max(1, Math.min(20, input.limit ?? 5)))
    .map(({ item, score, reasons, enough }) => ({ item, score: Math.min(99, Math.round(score)), reasons: enough ? [...reasons, '잔액 충분'] : [...reasons, '잔액 부족'], enough }));
}
