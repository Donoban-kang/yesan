/** 기관 규정 근거 찾기의 순수 계산 — 조항 나누기·금액 기준·조항 순위 (파일·설정을 읽지 않아 화면 미리보기에서도 쓴다) */

import type { BudgetGuide, BudgetGuideMatch } from '../../types/rpc-contract.js';
import type { Settings } from '../../types/index.js';
import { wordsOf } from './suggest.js';

export interface GuideClause {
  /** 조 번호("제12조", "제3조의2") 또는 문단 차례("12번째 단락") */
  no: string;
  title: string;
  /** 장·절 제목 (있으면) */
  chapter?: string;
  text: string;
}

export interface GuideQuery {
  /** 공문·결의서 글 (budget_analyze 의 basis) */
  text: string;
  /** 고른 과목 */
  item?: { name: string; detail?: string; unit?: string; program?: string };
  /** 거래 성격 (규칙의 nature) */
  nature?: string;
  /** 더 볼 낱말 (사람이 적은 것) */
  words?: string[];
  limit?: number;
}

/* ───────── 조항 나누기 ───────── */

const CLAUSE_MAX = 3000;

/** 줄 머리의 "제12조(목적)"·"제3조의2【예외】"·"제 5 조 (정의)" */
const ARTICLE = /^\s*(?:#+\s*)?(제\s*\d+\s*조(?:\s*의\s*\d+)?)\s*(?:[(（【[]\s*([^)）】\]]{1,40})\s*[)）】\]])?\s*(.*)$/;
/** 줄 머리의 "제2장 예산의 집행"·"제1절 통칙" */
const CHAPTER = /^\s*(?:#+\s*)?(제\s*\d+\s*[장절관]\s*.{0,40})$/;

export const clean = (s: string) => s.replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
export const squash = (s: string) => s.replace(/\s+/g, '');

/** 글 → 조항. 조(제N조)가 셋 이상이면 조로, 아니면 머리말·빈 줄로 나눈 단락으로 */
export function splitClauses(text: string): GuideClause[] {
  const lines = clean(text).split('\n');
  const out: GuideClause[] = [];
  let chapter: string | undefined;
  let cur: GuideClause | null = null;
  for (const raw of lines) {
    const line = raw.replace(/^\|\s*|\s*\|$/g, '').trim();
    const ch = CHAPTER.exec(line);
    if (ch && !ARTICLE.test(line)) { chapter = ch[1].replace(/\s+/g, ' ').trim(); continue; }
    const m = ARTICLE.exec(line);
    // 본문 안에서 다른 조를 가리키는 줄("제5조에 따라 …")은 새 조가 아니다: 괄호 제목이 있거나 줄이 짧을 때만 조 머리로
    if (m && (m[2] || m[3].length < 60)) {
      if (cur) out.push(cur);
      cur = { no: squash(m[1]), title: (m[2] ?? '').trim(), chapter, text: m[3].trim() };
      continue;
    }
    if (cur) cur.text += (cur.text ? '\n' : '') + line;
  }
  if (cur) out.push(cur);
  const articles = out.filter((c) => c.text || c.title);
  if (articles.length >= 3) return articles.map((c) => ({ ...c, text: c.text.slice(0, CLAUSE_MAX) }));
  return paragraphs(text);
}

/** 조가 없는 지침·안내문: 머리말(#, 1., 가., □, ○ 등)이나 빈 줄로 나눈 단락 (짧은 것은 다음 것과 합침) */
function paragraphs(text: string): GuideClause[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  const flush = () => { const t = buf.join('\n').trim(); if (t) blocks.push(t); buf = []; };
  for (const raw of clean(text).split('\n')) {
    const line = raw.trim();
    if (!line) { if (buf.join('').length > 200) flush(); continue; }
    if (/^(#+\s|[0-9]{1,2}\.\s|[가-하]\.\s|□|■|◆|Ⅰ|Ⅱ|Ⅲ|Ⅳ|Ⅴ)/.test(line) && buf.join('').length > 80) flush();
    buf.push(line);
  }
  flush();
  return blocks.map((b, i) => {
    const first = b.split('\n')[0].replace(/^#+\s*/, '').trim();
    return { no: `${i + 1}번째 단락`, title: first.length <= 40 ? first : '', text: b.slice(0, CLAUSE_MAX) };
  });
}

/** 조항 안의 금액 기준 ("1인당 30,000원 이내", "500만원 이상") */
export function amountRules(text: string): string[] {
  const out: string[] = [];
  const re = /((?:1인당|1회당|1건당|건당|회당|연간|월)\s*)?(\d[\d,]*(?:\.\d+)?\s*(?:천|만|백만|천만|억)?\s*원)\s*(이내|이하|이상|초과|미만|까지|한도)?/g;
  for (const m of text.matchAll(re)) {
    const s = m[0].replace(/\s+/g, ' ').trim();
    if (!m[1] && !m[3]) continue; // 기준 말이 없는 그냥 금액은 뺀다
    if (!out.includes(s)) out.push(s);
    if (out.length >= 3) break;
  }
  return out;
}

/** 첫 맞은 낱말 둘레의 문장 (220자 안) */
function snippetOf(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ');
  let at = -1;
  for (const t of terms) { const i = flat.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return flat.slice(0, 220);
  const start = Math.max(0, flat.lastIndexOf('.', at - 1) + 1, at - 100);
  const s = flat.slice(start, start + 220).trim();
  return (start > 0 ? '… ' : '') + s + (start + 220 < flat.length ? ' …' : '');
}

export function rankClauses(all: Array<{ g: BudgetGuide; c: GuideClause }>, q: GuideQuery, rules: Settings['budget']['rules']): BudgetGuideMatch[] {
  // 찾을 낱말과 무게: 과목 이름 > 거래 성격 > 과목 단서·세부사업 > 공문 속 성격 낱말 > 사람이 적은 낱말
  const weights = new Map<string, number>();
  const put = (w: string, n: number) => { if (w.length >= 2) weights.set(w, Math.max(weights.get(w) ?? 0, n)); };
  if (q.item) {
    for (const w of wordsOf(q.item.name)) put(w, 6);
    put(squash(q.item.name), 8);
    for (const w of wordsOf(q.item.detail ?? '')) put(w, 3);
    for (const w of wordsOf(q.item.unit ?? '')) put(w, 2);
  }
  const rule = rules.find((r) => r.nature === q.nature);
  if (q.nature) put(q.nature, 5);
  if (rule) {
    for (const h of rule.hints) put(h, 4);
    for (const w of rule.words) if (q.text.includes(w)) put(w, 3);
  }
  for (const w of q.words ?? []) put(w.trim(), 5);
  // 공문 글의 낱말은 조항 몇 곳에만 나오는 드문 것만 (흔한 낱말은 근거가 못 된다)
  const docWords = wordsOf(q.text.slice(0, 4000)).slice(0, 300);
  const n = all.length;
  const df = (w: string) => all.reduce((k, x) => k + ((x.c.title + x.c.text).includes(w) ? 1 : 0), 0);
  for (const w of docWords) {
    if (weights.has(w) || w.length < 2) continue;
    const d = df(w);
    if (d > 0 && d <= Math.max(1, Math.floor(n * 0.08))) put(w, 1);
  }
  if (!weights.size) return [];
  const idf = new Map<string, number>();
  for (const w of weights.keys()) idf.set(w, Math.log(1 + n / (1 + df(w))));

  const scored: BudgetGuideMatch[] = [];
  for (const { g, c } of all) {
    const body = c.text;
    let score = 0;
    const terms: string[] = [];
    for (const [w, wt] of weights) {
      const inTitle = c.title.includes(w);
      let cnt = 0;
      for (let i = body.indexOf(w); i >= 0 && cnt < 3; i = body.indexOf(w, i + w.length)) cnt++;
      if (!inTitle && !cnt) continue;
      score += wt * (idf.get(w) ?? 1) * (cnt + (inTitle ? 3 : 0));
      terms.push(w);
    }
    // 낱말 하나만 맞은 조항은 무게가 큰 낱말(과목 이름·성격)일 때만
    if (!terms.length || (terms.length === 1 && (weights.get(terms[0]) ?? 0) < 4)) continue;
    scored.push({
      guide_id: g.id, guide: g.name, no: c.no, title: c.title, chapter: c.chapter,
      snippet: snippetOf(body || c.title, terms), terms: terms.sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0)).slice(0, 6),
      amounts: amountRules(body), score: Math.round(score * 10) / 10,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  // 점수를 0~99 차례 값으로 (확률 아님)
  const top = scored[0]?.score || 1;
  return scored.map((m) => ({ ...m, score: Math.max(1, Math.min(99, Math.round((m.score / top) * 99))) }));
}
