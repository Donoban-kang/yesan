/** 증빙 자동 대조 — 서류 종류 가르기·칸 값 뽑기·결의서와 맞추기 (실제 OCR 줄 짜임을 본뜬 가상 값) */

import { describe, it, expect } from 'vitest';
import { brnOf, classify, compareEvidence, dateOf, extractPage, numOf } from '../src/core/budget/evidence.js';

const TRAVEL = [
  ['여비 정산 신청서', '소속 가온지원과 직급 연구원 성명 ○○○', '합계 68,900', '식비 기간 26/11/06 식비정산금 25,000', '일비 기간 26/11/06 일비정산금 25,000',
    '운입 일자 출발지 도착지 교통편 금액', '2026-11-06 가온터미널 나래터미널 버스 개인카드 18,900', '2026년11월09일', '신청인성명 ○○○'],
  ['영수증첨부철', '일시 2026.11.6.', '금액 18,900', '승차권거래영수증', '사업자번호:000-00-11111', '승인일자:2026-11-04', '승인금액: 18,900원', '출발일: 2026-11-06'],
  ['수신 내부결재', '결 재 ○○○ 2026.11.04.', '국내 출장신청서', '시행 가온지원과-1234 ( ) 접수'],
];
const PURCHASE = [
  ['검사·검수서', '품 명 규격 단위 수량', '문구류 ea 77 가온지원과', '계 77', '상기와 같이 검사 함', '2026년 10월 13일'],
  ['※ 붙임: 사진 1매'],
  ['000-00-22222/ TID: 1234567/ Tel: 000-000-0000', 'NH카드 가맹No:12345678 (일시불)', '0000-****-00*/2026/10/13 10:00:00', '거래금액 272. 728원', ': 27,272원', '합 300,000원', '승인번호: 11112222'],
  ['일반지출품의서', '문서번호:가온지원과-1111', '발의일자 발의부서 발의자 지급구분', '2026-10-06 가온지원과 ○○○ 일시불', '2. 구입품목: 진행문서화일 및 A4 용지 등6개 물', '품 의 300,000원 사업자번호 상호 가온생협', '0008533333', '합계 300,000원'],
  ['일반명세서', '순번 품명및규격 금액', '1 물품 구매 150,000원', '2 물품 구매 150,000원', '합계 300,000원'],
  ['견적서', '2026년10월07일 등록번호 000-00-22222', '합계금액 (공급가액+세액) 금삼십만원정 (W300,000)', '19 1000000 진행문서화일 EA 10 2,400 21,818 2,182 24,000', '77 272,729 27,271 300,000'],
];

describe('값 꼴', () => {
  it('금액·날짜·사업자번호', () => {
    expect(numOf('272. 728원')).toBe(272_728);
    expect(numOf('18.900')).toBe(18_900);
    expect(dateOf('2026년 10월 13일')).toBe('2026-10-13');
    expect(dateOf('0000/2026/10/13 10:00')).toBe('2026-10-13');
    expect(brnOf('0008533333')).toBe('000-85-33333');
    expect(brnOf('TID: 1234567')).toBeUndefined();
  });
});

describe('서류 종류 가르기', () => {
  it('여비·물품 묶음의 쪽마다', () => {
    expect(TRAVEL.map(classify)).toEqual(['travel_claim', 'ticket', 'trip_request']);
    expect(PURCHASE.map(classify)).toEqual(['inspection', 'photo', 'card_receipt', 'purchase_request', 'item_list', 'quote']);
  });
});

describe('칸 값과 결의서 대조', () => {
  it('여비: 정산서 합계·운임, 승차권, 출장 신청서 문서번호', () => {
    const pages = TRAVEL.map((l, i) => extractPage(i + 1, l));
    expect(pages[0]).toMatchObject({ amount: 68_900, fare: 18_900, date: '2026-11-09' });
    expect(pages[1]).toMatchObject({ amount: 18_900, brn: '000-00-11111', date: '2026-11-06' });
    expect(pages[2]).toMatchObject({ doc_no: '가온지원과-1234' });
    const r = compareEvidence(pages, { amount: 68_900, related: '가온지원과-1234(2026.11.04.)', kind: 'travel' });
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.checks).toHaveLength(3);
    expect(r.missing).toEqual([]);
  });

  it('물품: 카드 단말기 번호·검수 수량을 금액으로 고르지 않는다, 사업자번호·품목 수·날짜 차례가 다르면 알린다', () => {
    const pages = PURCHASE.map((l, i) => extractPage(i + 1, l));
    expect(pages[0]).toMatchObject({ kind: 'inspection', qty: 77, date: '2026-10-13' });
    expect(pages[0].amount).toBeUndefined();
    expect(pages[2]).toMatchObject({ kind: 'card_receipt', amount: 300_000, brn: '000-00-22222', date: '2026-10-13' });
    expect(pages[3]).toMatchObject({ amount: 300_000, brn: '000-85-33333', date: '2026-10-06', count: 6, doc_no: '가온지원과-1111' });
    expect(pages[5]).toMatchObject({ amount: 300_000, brn: '000-00-22222', date: '2026-10-07', qty: 77 });
    const r = compareEvidence(pages, { amount: 300_000, vendor_no: '000-85-33333', memo: '2. 구입품목: 문구류 77개 물품', kind: 'purchase' });
    const bad = r.checks.filter((c) => !c.ok).map((c) => c.label);
    expect(bad).toEqual([
      '견적서(6쪽) 사업자번호 = 결의서 거래처',
      '카드 영수증(3쪽) 사업자번호 = 결의서 거래처',
      '품의서 적요 품목 수 = 결의서 적요 품목 수',
      '견적일이 품의 발의일보다 앞서거나 같음',
    ]);
    expect(r.checks.find((c) => c.label === '검수 수량 = 견적 수량')?.ok).toBe(true);
  });

  it('빠진 서류를 알린다, 결의서 번호가 가려졌으면 보이는 자리만 맞춘다', () => {
    const pages = [extractPage(1, PURCHASE[5])];
    const r = compareEvidence(pages, { amount: 300_000, vendor_no: '000-00-●●●●●', kind: 'purchase' });
    expect(r.missing).toEqual(['지출 품의서', '카드 영수증', '검사·검수서']);
    expect(r.checks.find((c) => c.label.includes('사업자번호'))?.ok).toBe(true);
  });
});
