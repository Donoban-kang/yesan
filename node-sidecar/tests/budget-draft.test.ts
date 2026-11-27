/** 결의서 입력 초안 — 실제 표본의 적요 꼴을 따른 여비·물품 구매 글, 한글 금액, 증빙 확인표 (가상 값) */

import { describe, it, expect } from 'vitest';
import { buildDraft, draftKindOf, koreanAmount, stripDateTail, subjectName } from '../src/core/budget/draft.js';

describe('결의서 입력 초안', () => {
  it('한글 금액 (회계 서류처럼 1 도 "일")', () => {
    expect(koreanAmount(68_900)).toBe('육만팔천구백');
    expect(koreanAmount(300_000)).toBe('삼십만');
    expect(koreanAmount(1_303_440)).toBe('일백삼십만삼천사백사십');
    expect(koreanAmount(110_000_000)).toBe('일억일천만');
  });

  it('여비 정산: 관련·내용·일시 및 출장지·지급금액', () => {
    const d = buildDraft({ kind: 'travel', title: '『가온 시스템』 구축 착수보고회 참석 안내', related: '가온지원과-1234(2026.11.04.)', period: '2026.11.06. (09:00~18:00)', place: '가온캠퍼스', amount: 68_900, date: '2026-11-10' });
    expect(d.title).toBe('출장여비 정산 결의 요청(11.10)');
    expect(d.memo).toBe('1. 관련: 가온지원과-1234(2026.11.04.) 2. 내용: 가온 시스템 구축 착수보고회 참석 3. 일시 및 출장지: 2026.11.06. (09:00~18:00), 가온캠퍼스 4. 지급금액: 금68,900원(금육만팔천구백원)');
    expect(d.checklist.map((c) => c.item)).toContain('교통비 영수증 (승차권·카드)');
  });

  it('물품 구매: 건명·구입품목·지출금액 이내·지출과목', () => {
    const d = buildDraft({ kind: 'purchase', items: '진행문서화일 및 각종 문구류 77개', amount: 300_000, account: '대학회계', subject: subjectName('물건비-운영비-일반수용비 (사무용품 구입)') });
    expect(d.memo).toBe('1. 건 명: 부서 운영을 위한 물품 구매 결의 2. 구입품목: 진행문서화일 및 각종 문구류 77개 물품 3. 지출금액: 금 300,000원 이내 4. 지출과목: 대학회계-일반수용비. 끝.');
    expect(d.checklist.find((c) => c.item === '견적서')?.check).toContain('사업자번호');
  });

  it('행사가 아닌 내용에는 "참석"을 붙이지 않는다', () => {
    expect(buildDraft({ kind: 'travel', title: '현장 점검 협조 요청', amount: 10_000 }).memo).toContain('2. 내용: 현장 점검 3.');
  });

  it('거래 성격 → 갈래', () => {
    expect(draftKindOf('여비')).toBe('travel');
    expect(draftKindOf('구입')).toBe('purchase');
    expect(draftKindOf('행사')).toBe('general');
  });
});

describe('품의서 기안문 초안 (F-10)', () => {
  it('여비·물품·일반: 기안문 꼴(# 제목, 1. 가.), 금액은 숫자와 한글, 모르는 값은 ○○, 끝 표시', async () => {
    const { buildProposalMarkdown } = await import('../src/core/budget/draft.js');
    const t = buildProposalMarkdown({ kind: 'travel', title: '2026 가온 교육혁신 포럼 개최 안내', related: '가온지원과-1234(2026. 11. 4.)', period: '2026. 11. 20.', amount: 103_440, account: '대학회계', subject: '국내여비' });
    expect(t.split('\n')[0]).toBe('# 2026 가온 교육혁신 포럼 출장여비 지급 품의');
    expect(t).toContain('1. 관련: 가온지원과-1234(2026. 11. 4.)');
    expect(t).toContain('  가. 출장 내용: 2026 가온 교육혁신 포럼 참석');
    expect(t).toContain('  다. 지급금액: 금103,440원(금일십만삼천사백사십원)');
    expect(t).toContain('  라. 예산과목: 대학회계-국내여비');
    expect(t.trim().endsWith('끝.')).toBe(true);

    const b = buildProposalMarkdown({ kind: 'purchase', title: '사무용품 구매', amount: 250_000, subject: '일반수용비' });
    expect(b).toContain('# 사무용품 구매 품의');
    expect(b).not.toContain('관련:');
    expect(b).toMatch(/^1\. 부서 운영에/m);
    expect(b).toContain('  나. 구입품목: ○○');
    expect(b).toContain('  라. 예산과목: ○○회계-일반수용비');

    const g = buildProposalMarkdown({ kind: 'general', amount: 1_000 });
    expect(g).toContain('  다. 소요금액: 금1,000원(금일천원)');
    expect(g.trim().endsWith('끝.')).toBe(true);
  });

  it('만든 글이 기안문 HWPX 로 만들어진다 (generate_hwpx)', async () => {
    const { buildProposalMarkdown } = await import('../src/core/budget/draft.js');
    const { call, setupEnv } = await import('./doc-helpers.js');
    const env = setupEnv();
    const md = buildProposalMarkdown({ kind: 'purchase', title: '사무용품 구매', amount: 250_000, account: '대학회계', subject: '일반수용비' });
    const { join } = await import('node:path');
    const out = join(env.work, '사무용품 구매 품의.hwpx');
    const r = await call('generate_hwpx', { markdown: md, preset: 'official', output_path: out, no_usage: true });
    expect(r.output_path).toBe(out);
    const { parse } = await import('kordoc');
    const { readFileSync } = await import('node:fs');
    const back = await parse(readFileSync(out));
    expect(back.success && back.markdown).toContain('일반수용비');
  }, 30_000);

  it('고친 건명에서 끝의 지출일 표시만 뗀다', () => {
    expect(stripDateTail('가온 행사 지출(11.23)')).toBe('가온 행사 지출');
    expect(stripDateTail('가온 행사 지출')).toBe('가온 행사 지출');
    expect(stripDateTail('1차 (2026) 계획')).toBe('1차 (2026) 계획');
  });
});
