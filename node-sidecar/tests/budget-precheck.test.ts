/** 집행 전 점검표 — 필요 서류·금액 일치·사업자·계좌·잔액·규정 금액 기준 (규칙 판정, 가상 값만) */

import { describe, it, expect } from 'vitest';
import type { BudgetBundleDoc, BudgetGuideMatch, BudgetPrecheckBundle } from '../src/types/rpc-contract.js';
import { DEFAULT_SETTINGS } from '../src/infra/config.js';
import { normalizeBudgetSettings } from '../src/core/budget/settings.js';
import { buildPrecheck, judgeRule, parseRule, peopleOf, requiredDocs, type PrecheckInput } from '../src/core/budget/precheck.js';

const RULES = DEFAULT_SETTINGS.budget.rules;

/** 앞 아홉 자리로 검증 숫자가 맞는 사업자번호 만들기 (국세청 공개 규칙) */
function brnOf9(d9: string): string {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(d9[i]) * w[i];
  s += Math.floor((Number(d9[8]) * 5) / 10);
  const all = `${d9}${(10 - (s % 10)) % 10}`;
  return `${all.slice(0, 3)}-${all.slice(3, 5)}-${all.slice(5)}`;
}
const GOOD_BRN = brnOf9('123456789');

const doc = (kind: BudgetBundleDoc['kind'], extra: Partial<BudgetBundleDoc> = {}): BudgetBundleDoc => ({ path: `/x/${kind}`, name: `${kind}.pdf`, kind, label: kind, ...extra });
const make = (docs: BudgetBundleDoc[], over: Partial<PrecheckInput> = {}, a: Partial<BudgetPrecheckBundle['analysis']> = {}, totals: { receipts?: number; quotes?: number } = {}): PrecheckInput => ({
  bundle: { docs, receipts_total: totals.receipts ?? 0, quotes_total: totals.quotes ?? 0, analysis: { amount: 1_980_000, nature: '임차', basis: '', ...a } },
  warnAt: 90, rules: RULES, clauses: [], hasGuides: false, ...over,
});
const byId = (p: ReturnType<typeof buildPrecheck>, id: string) => p.items.find((i) => i.id === id)!;

describe('필요 서류', () => {
  it('거래 성격의 기본 목록을 쓰고 빠진 서류를 알린다', () => {
    const p = buildPrecheck(make([doc('letter'), doc('quote')]));
    const d = byId(p, 'docs');
    expect(d.status).toBe('check');
    expect(d.summary).toContain('계좌 사본');
    expect(p.docs_source).toBe('default');
  });
  it('모두 있으면 이상 없음, 영수증 요구는 명세서가, 공문 요구는 계획서가 채운다', () => {
    const rules = RULES.map((r) => (r.nature === '임차' ? { ...r, docs: ['letter', 'receipt'] } : r));
    const p = buildPrecheck(make([doc('plan'), doc('invoice')], { rules }));
    expect(byId(p, 'docs').status).toBe('ok');
  });
  it('설정에서 고친 목록은 출처가 설정이고, 기본값과 같으면 기본값이다', () => {
    expect(requiredDocs('임차', RULES.map((r) => (r.nature === '임차' ? { ...r, docs: ['letter'] } : r))).source).toBe('settings');
    expect(requiredDocs('임차', RULES).source).toBe('default');
  });
  it('성격을 모르면 공문만 본다', () => {
    const p = buildPrecheck(make([doc('letter')], {}, { nature: undefined }));
    expect(byId(p, 'docs').status).toBe('ok');
    expect(byId(p, 'docs').details.join(' ')).toContain('거래 성격을 읽지 못했습니다');
  });
  it('설정에 docs 가 없는 옛 규칙은 기본값을 따르고, 모르는 종류는 걸러낸다', () => {
    const s = normalizeBudgetSettings({ rules: [{ nature: '임차', words: ['임차'], hints: [] }, { nature: '구입', words: ['구입'], hints: [], docs: ['quote', 'bogus', 'quote'] }] });
    expect(s.rules[0].docs).toBeUndefined();
    expect(s.rules[1].docs).toEqual(['quote']);
    expect(requiredDocs('임차', s.rules).kinds).toEqual(['letter', 'quote', 'bank']);
  });
});

describe('금액 일치', () => {
  it('영수증·견적 합계가 지출 금액과 같으면 이상 없음', () => {
    const p = buildPrecheck(make([doc('letter'), doc('quote', { amount: 1_980_000 }), doc('receipt', { amount: 1_980_000 })], {}, {}, { receipts: 1_980_000, quotes: 1_980_000 }));
    expect(byId(p, 'amount').status).toBe('ok');
  });
  it('다르면 차이를 적고, 영수증이 견적보다 크면 알린다', () => {
    const p = buildPrecheck(make([doc('receipt', { amount: 2_100_000 }), doc('quote', { amount: 1_980_000 })], {}, {}, { receipts: 2_100_000, quotes: 1_980_000 }));
    const a = byId(p, 'amount');
    expect(a.status).toBe('check');
    expect(a.details.join(' ')).toContain('120,000원');
  });
  it('금액을 못 읽은 서류가 있으면 확인 필요, 견줄 것이 없으면 점검 못함', () => {
    expect(byId(buildPrecheck(make([doc('receipt')])), 'amount').status).toBe('check');
    expect(byId(buildPrecheck(make([doc('letter')])), 'amount').status).toBe('na');
  });
});

describe('사업자·계좌·날짜', () => {
  it('검증 숫자가 틀린 사업자번호를 알린다', () => {
    const bad = buildPrecheck(make([doc('receipt', { amount: 1, brn: '123-45-67890' })]));
    expect(byId(bad, 'party').status).toBe('check');
    const good = buildPrecheck(make([doc('receipt', { amount: 1, brn: GOOD_BRN })]));
    expect(byId(good, 'party').status).toBe('ok');
  });
  it('계좌번호·예금주를 못 읽은 계좌 사본을 알린다', () => {
    expect(byId(buildPrecheck(make([doc('bank')])), 'party').status).toBe('check');
    expect(byId(buildPrecheck(make([doc('bank', { account: '1002-345-678901', holder: '가온관광' })])), 'party').status).toBe('ok');
  });
  it('공문 시행일보다 앞선 증빙 날짜를 알린다', () => {
    const p = buildPrecheck(make([doc('receipt', { amount: 1, date: '2026-11-01' })], {}, { sent_date: '2026. 11. 10.' }));
    expect(byId(p, 'party').status).toBe('check');
    expect(byId(p, 'party').details.join(' ')).toContain('공문 시행일');
  });
  it('읽은 값이 없으면 점검 못함', () => {
    expect(byId(buildPrecheck(make([doc('letter')])), 'party').status).toBe('na');
  });
});

describe('예산 잔액', () => {
  const item = { name: '임차료', budget: 10_000_000, paid: 3_000_000, commit: 2_000_000, avail: 5_000_000 };
  it('과목이 없으면 점검 못함', () => expect(byId(buildPrecheck(make([doc('letter')])), 'balance').status).toBe('na'));
  it('충분하면 이상 없음, 넘으면 전용·추경 안내, 경고 기준 이상이면 확인 필요', () => {
    expect(byId(buildPrecheck(make([doc('letter')], { item })), 'balance').status).toBe('ok');
    const over = byId(buildPrecheck(make([doc('letter')], { item, amount: 6_000_000 })), 'balance');
    expect(over.status).toBe('check');
    expect(over.details.join(' ')).toContain('전용·추경');
    expect(byId(buildPrecheck(make([doc('letter')], { item, amount: 4_800_000 })), 'balance').status).toBe('check');
  });
});

describe('규정 금액 기준', () => {
  it('금액 기준 글을 읽는다', () => {
    expect(parseRule('1인당 30,000원 이내')).toEqual({ scope: 'person', limit: 30_000, op: '이내' });
    expect(parseRule('500만원 이상')).toEqual({ scope: 'total', limit: 5_000_000, op: '이상' });
    expect(parseRule('1.5억원 이하')?.limit).toBe(150_000_000);
    expect(parseRule('연간 3천만원 한도')?.scope).toBe('period');
    expect(parseRule('금액 미정')).toBeUndefined();
  });
  it('인원을 읽는다', () => {
    expect(peopleOf('학생 20명, 교사 2명')).toBe(20);
    expect(peopleOf('약 1,200명')).toBe(1200);
    expect(peopleOf(undefined)).toBeUndefined();
  });
  it('1인당 기준은 인원으로 나눠 견주고, 인원을 모르면 견주지 않는다', () => {
    expect(judgeRule('1인당 30,000원 이내', 900_000, 20).verdict).toBe('over');
    expect(judgeRule('1인당 30,000원 이내', 500_000, 20).verdict).toBe('ok');
    expect(judgeRule('1인당 30,000원 이내', 500_000, undefined).verdict).toBe('unknown');
  });
  it('이상·초과 기준은 해당 여부만 알리고 상한 없는 기준은 견주지 않는다', () => {
    expect(judgeRule('500만원 이상', 6_000_000, undefined).verdict).toBe('applies');
    expect(judgeRule('500만원 이상', 1_000_000, undefined).verdict).toBe('ok');
    expect(judgeRule('1인당 30,000원', 100, 2).verdict).toBe('unknown');
    expect(judgeRule('연간 3천만원 한도', 100, 2).verdict).toBe('unknown');
  });
  const match = (amounts: string[]): BudgetGuideMatch => ({ guide_id: 'g', guide: '시험 지침', no: '제12조', title: '회의비', snippet: '', terms: [], amounts, score: 99 });
  it('규정 파일이 없으면 점검 못함, 있으면 조항별로 견준다', () => {
    expect(byId(buildPrecheck(make([doc('letter')])), 'rule').status).toBe('na');
    const p = buildPrecheck(make([doc('letter')], { hasGuides: true, clauses: [match(['1인당 30,000원 이내'])] }, { people: '20명' }));
    const r = byId(p, 'rule');
    expect(r.status).toBe('check');
    expect(r.clauses?.[0]).toMatchObject({ no: '제12조', verdict: 'over' });
    const ok = byId(buildPrecheck(make([doc('letter')], { hasGuides: true, clauses: [match(['1인당 100,000원 이내'])] }, { people: '20명' })), 'rule');
    expect(ok.status).toBe('ok');
  });
  it('조항을 찾았지만 금액 기준이 없으면 점검 못함', () => {
    expect(byId(buildPrecheck(make([doc('letter')], { hasGuides: true, clauses: [match([])] })), 'rule').status).toBe('na');
  });
});

describe('한계 문구', () => {
  it('집행 가능 여부를 판정하지 않는다고 밝힌다', () => {
    expect(buildPrecheck(make([doc('letter')])).caveat).toContain('규정 원문');
  });
});

describe('RPC budget_precheck', () => {
  it('모양이 틀린 입력도 걸러서 점검하고, 과목을 고르면 잔액을 본다', async () => {
    const { call, setupEnv } = await import('./doc-helpers.js');
    setupEnv();
    await call('budget_item_add', { year: 2026, account: 'univ', name: '점검시험 임차료', budget: 5_000_000 });
    const book = await call('budget_book', { year: 2026 }) as { items: Array<{ id: string; name: string }> };
    const id = book.items.find((x) => x.name === '점검시험 임차료')!.id;
    const r = await call('budget_precheck', {
      year: 2026, item_id: id, amount: 6_000_000,
      bundle: { docs: [{ kind: 'letter', name: 'a.hwpx', path: '/a' }, { nope: 1 }, 'x'], receipts_total: 'abc', analysis: { amount: 6_000_000, nature: '임차' } },
    }) as import('../src/types/rpc-contract.js').BudgetPrecheck;
    expect(r.items.map((i) => i.id)).toEqual(['docs', 'amount', 'party', 'balance', 'rule']);
    expect(r.items.find((i) => i.id === 'balance')).toMatchObject({ status: 'check' });
    expect(r.items.find((i) => i.id === 'rule')?.status).toBe('na');
  });
});
