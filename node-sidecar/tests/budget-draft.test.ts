/** 결의서 입력 초안 — 실제 표본의 적요 꼴을 따른 여비·물품 구매 글, 한글 금액, 증빙 확인표 (가상 값) */

import { describe, it, expect } from 'vitest';
import { buildDraft, draftKindOf, koreanAmount, subjectName } from '../src/core/budget/draft.js';

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
