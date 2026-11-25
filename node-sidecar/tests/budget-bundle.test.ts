/** 지출 서류 묶음 — 서류 종류 가르기, 지급할 곳(계좌) 읽기, 묶음 읽기 RPC (가상의 가온대학교 서류, 계좌·사업자번호는 지어낸 값) */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, setupEnv } from './doc-helpers.js';
import { bankInfo, classifyDoc } from '../src/core/budget/bundle-kinds.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let env: ReturnType<typeof setupEnv>;
beforeAll(() => { env = setupEnv(); });

const LETTER = ['가온대학교', '수신 교무처장', '제목 2026 교수법 특강 개최', '1. 교수법 역량 강화를 위하여 특강을 아래와 같이 개최하고자 합니다.', '가. 일시: 2026. 12. 3.(목) 14:00', '나. 대상: 교원 30명', '다. 소요 예산: 금900,000원(강사료 및 다과)', '붙임 1. 계획서 1부. 끝.'];
const RECEIPT = ['가온베이커리', '사업자번호 0000000000', '2026-12-03 15:20', '다과 세트 30개', '합계: 300,000원', '승인번호 00000000'];
const BANK = ['통장 사본', '은행명 가온은행', '국민은행', '계좌번호 1002-345-678901', '예금주 가온강연연구소'];
const INVOICE = ['전자세금계산서', '공급자 가온인쇄', '공급가액 90,000', '세액 9,000', '합계금액 99,000'];
const QUOTE = ['견 적 서', '견적일 2026-11-20', '합계 W 300,000', '품명 다과 세트'];
const PLAN = ['2026 교수법 특강 운영 계획(안)', '1. 목적', '교원 교수법 역량 강화', '2. 추진 개요'];

describe('서류 종류 가르기', () => {
  it('공문·영수증·계좌 사본·세금계산서·견적서·계획서', () => {
    expect(classifyDoc(LETTER)).toBe('letter');
    expect(classifyDoc(RECEIPT)).toBe('receipt');
    expect(classifyDoc(BANK)).toBe('bank');
    expect(classifyDoc(INVOICE)).toBe('invoice');
    expect(classifyDoc(QUOTE)).toBe('quote');
    expect(classifyDoc(PLAN)).toBe('plan');
  });

  it('공문 안의 "입금 계좌" 한 줄은 계좌 사본이 아니라 공문', () => {
    expect(classifyDoc([...LETTER, '라. 입금 계좌: 국민은행 1002-345-678901 예금주 가온강연연구소', ...Array(30).fill('세부 운영 내용을 붙임 계획서와 같이 진행합니다.')])).toBe('letter');
  });

  it('지급할 곳: 은행·계좌번호·예금주를 그대로, 사업자번호는 계좌로 보지 않는다', () => {
    expect(bankInfo(BANK)).toEqual({ bank: '국민은행', account: '1002-345-678901', holder: '가온강연연구소' });
    expect(bankInfo(['예금주:', '가온상사', '농협 계좌 3020000000000'])).toEqual({ bank: '농협은행', account: '3020000000000', holder: '가온상사' });
    expect(bankInfo(RECEIPT).account).toBeUndefined();
  });
});

describe('묶음 읽기 (RPC)', () => {
  it('공문으로 금액·성격을 읽고, 서류마다 종류·금액, 지급할 곳, 합계가 다르면 알린다', async () => {
    const put = (name: string, lines: string[]) => { const f = join(env.work, name); writeFileSync(f, lines.join('\n')); return f; };
    const paths = [put('영수증.txt', RECEIPT), put('계좌.txt', BANK), put('특강 공문.txt', LETTER), put('견적.txt', QUOTE)];
    const r = await call('budget_bundle', { paths, year: 2026 });
    expect(r.failed).toEqual([]);
    expect(r.docs.map((d: { name: string; kind: string }) => [d.name, d.kind])).toEqual([['영수증.txt', 'receipt'], ['계좌.txt', 'bank'], ['특강 공문.txt', 'letter'], ['견적.txt', 'quote']]);
    expect(r.analysis.name).toBe('특강 공문.txt');
    expect(r.analysis.amount).toBe(900_000);
    expect(r.analysis.doc_kind).toBe('공문');
    expect(r.docs[0]).toMatchObject({ amount: 300_000, date: '2026-12-03' });
    expect(r.docs[0].brn).toMatch(/^0{3}-0{2}-0{5}$/); // 붙임표 없는 번호도 사업자번호 꼴로
    expect(r.receipts_total).toBe(300_000);
    expect(r.quotes_total).toBe(300_000);
    expect(r.payees).toEqual([{ bank: '국민은행', account: '1002-345-678901', holder: '가온강연연구소', from: '계좌.txt' }]);
    expect(r.notes.join(' ')).toMatch(/영수증·명세서 합계 300,000원이 공문 금액 900,000원과 다릅니다/);
  }, 30_000);

  it('원인행위서 꼴이어도 결의서 칸 읽기는 하지 않는다, 읽지 못한 파일은 실패 목록에', async () => {
    const v = join(env.work, '원인행위서.txt');
    writeFileSync(v, ['원인행위서', '회계연도 2026', '건명 사무용품 구입', '금액 100,000'].join('\n'));
    const r = await call('budget_bundle', { paths: [v, join(env.work, '없는 파일.pdf')], year: 2026 });
    expect(r.analysis.doc_kind).toBe('공문');
    expect(r.analysis.budget_lines).toBeUndefined();
    expect(r.failed).toHaveLength(1);
  }, 30_000);

  it('파일이 없으면·너무 많으면 까닭과 함께 거절', async () => {
    await expect(call('budget_bundle', { paths: [] })).rejects.toThrow();
    await expect(call('budget_bundle', { paths: Array.from({ length: 21 }, (_, i) => join(env.work, `${i}.txt`)) })).rejects.toThrow(/20개까지/);
  });
});
