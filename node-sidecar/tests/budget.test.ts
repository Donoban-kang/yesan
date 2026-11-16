/** 예산 지출 도우미 — 금액 읽기, 과목표 머리 알아보기, 추천, 잔액 계산, 반영·정산·취소, 다시 불러오기, HWX 읽기, 엑셀 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { markdownToHwpx } from 'kordoc';
import { call, setupEnv } from './doc-helpers.js';
import { amountsInLine, findAmounts, koreanNumber, tableUnitOf } from '../src/core/budget/amount.js';
import { accountOf, detectHeader, moneyOf, rowsToItems } from '../src/core/budget/mapping.js';
import { normalizeBudgetSettings } from '../src/core/budget/settings.js';
import { accountHintOf, natureOf } from '../src/core/budget/suggest.js';
import { sniff } from '../src/core/budget/read-doc.js';
import { tallyOf } from '../src/core/budget/tally.js';
import type { BudgetBookView, BudgetEntry } from '../src/types/rpc-contract.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const S = normalizeBudgetSettings(undefined);
let env: ReturnType<typeof setupEnv>;
beforeAll(() => { env = setupEnv(); });

describe('금액 읽기', () => {
  it('한글 금액', () => {
    expect(koreanNumber('일백구십팔만')).toBe(1_980_000);
    expect(koreanNumber('삼백만')).toBe(3_000_000);
    expect(koreanNumber('일억이천삼백사십오만육천칠백팔십구')).toBe(123_456_789);
    expect(koreanNumber('천이백')).toBe(1200);
    expect(koreanNumber('1980')).toBeNull();
  });

  it('여러 꼴: 원·천원·만원·한글·점 꼴, 날짜·전화·인원은 아님', () => {
    expect(amountsInLine('라. 소요 예산: 금1,980,000원(45인승 버스 3대, 부가세 포함)').map((a) => a.value)).toEqual([1_980_000]);
    expect(amountsInLine('나. 학교당 지원액: 3,450천원').map((a) => a.value)).toEqual([3_450_000]);
    expect(amountsInLine('사업비 120만원').map((a) => a.value)).toEqual([1_200_000]);
    expect(amountsInLine('금일백구십팔만원정').map((a) => a.value)).toEqual([1_980_000]);
    expect(amountsInLine('계약 금액 1.980.000원').map((a) => a.value)).toEqual([1_980_000]);
    expect(amountsInLine('일시: 2026. 11. 27.(금) 08:30~15:30')).toEqual([]);
    expect(amountsInLine('전화 031-000-0000 금액 문의')).toEqual([]);
    expect(amountsInLine('대상: 학생 1,420명')).toEqual([]);
  });

  it('표 단위(천원)를 단위 없는 표 칸 숫자에 곱한다', () => {
    expect(tableUnitOf('(단위: 천원)')).toBe(1000);
    const found = findAmounts(['(단위: 천원)', '| 구분 | 금액 |', '| 합계 | 3,450 |']);
    expect(found[0]).toMatchObject({ value: 3_450_000 });
  });

  it('예산·합계 줄의 금액을 먼저 고른다', () => {
    const found = findAmounts([
      '1. 관련: 가온대학교 학생처-1234(2026. 10. 30.)',
      '가. 1인당 식비 15,000원',
      '나. 총 소요 예산: 금2,400,000원',
    ]);
    expect(found[0].value).toBe(2_400_000);
    expect(found[0].confidence).toBeGreaterThan(found.find((a) => a.value === 15_000)!.confidence);
  });
});

describe('과목표 표', () => {
  const grid = [
    ['2026년 예산 현황', '', '', '', '', ''],
    ['(단위: 천원)', '', '', '', '', ''],
    ['회계구분', '단위사업', '세부사업', '과목', '예산액', '집행액'],
    ['대학회계', '학생지원', '진로체험 운영', '임차료', '6,000', '2,150'],
    ['', '', '', '강사수당', '3,000', '1,200'],
    ['', '', '', '소계', '9,000', '3,350'],
    ['글로컬', 'RISE 연계', '지역 협업 포럼', '행사운영비', '12,000', '-'],
    ['육성사업', '교육혁신', '교수 연수', '국내여비', '2,400', '1,980'],
    ['합계', '', '', '', '23,400', '5,330'],
  ];

  it('머리 줄·칸·단위를 알아보고 병합 칸은 위 값을 이어 받는다, 소계·합계는 뺀다', () => {
    const h = detectHeader(grid)!;
    expect(h.row).toBe(2);
    expect(h.mapping).toMatchObject({ account: 0, unit: 1, detail: 2, name: 3, budget: 4, spent: 5 });
    expect(h.unit).toBe(1000);
    const { items, skipped } = rowsToItems(grid, h.row, h.mapping, h.unit, S.accounts, 'univ');
    expect(skipped).toBe(2);
    expect(items).toHaveLength(4);
    expect(items[1]).toMatchObject({ account: 'univ', unit: '학생지원', detail: '진로체험 운영', name: '강사수당', budget: 3_000_000, spent_before: 1_200_000 });
    expect(items[2]).toMatchObject({ account: 'glocal', name: '행사운영비', budget: 12_000_000, spent_before: 0 });
    expect(items[3]).toMatchObject({ account: 'growth', name: '국내여비' });
  });

  it('금액 칸·회계 구분 글', () => {
    expect(moneyOf('1,234,000')).toBe(1_234_000);
    expect(moneyOf('(1,000)')).toBe(-1000);
    expect(moneyOf('-')).toBeNull();
    expect(accountOf('글로컬대학30', S.accounts, 'univ')).toBe('glocal');
    expect(accountOf('국립대학육성사업', S.accounts, 'univ')).toBe('growth');
    expect(accountOf('', S.accounts, 'univ')).toBe('univ');
  });
});

describe('거래 성격·회계 단서', () => {
  it('제목 낱말을 무겁게 센다', () => {
    expect(natureOf('버스 임차를 협조 요청', '진로체험 버스 임차 협조', S.rules).nature).toBe('임차');
    expect(natureOf('참가 교원은 출장 처리하며 여비는 소속에서', '직무연수 참가 안내', S.rules).nature).toBe('여비');
  });
  it('회계 구분 단서', () => {
    expect(accountHintOf('2026 글로컬대학 사업비로 집행', S.accounts)).toBe('glocal');
    expect(accountHintOf('국립대학육성사업 성과 관리', S.accounts)).toBe('growth');
    expect(accountHintOf('일반 공문', S.accounts)).toBeUndefined();
  });
});

describe('잔액 계산', () => {
  const item = { id: 'a', account: 'univ', program: '', unit: '', detail: '', name: '임차료', budget: 1_000_000, spent_before: 100_000, keywords: [] };
  const e = (o: Partial<BudgetEntry>): BudgetEntry => ({ id: Math.random().toString(36), group: 'g', at: '', date: '2026-11-13', item_id: 'a', amount: 0, stage: 'paid', kind: 'apply', ...o });
  it('가용 잔액 = 예산 − 집행 − 품의 중, 공식 집행액으로 넘어간 줄은 뺀다', () => {
    expect(tallyOf(item, [e({ amount: 200_000 }), e({ amount: 300_000, stage: 'commit' }), e({ amount: 50_000, synced_at: 'x' })]))
      .toEqual({ paid: 300_000, commit: 300_000, avail: 400_000, rate: 60 });
  });
});

describe('장부 흐름 (RPC)', () => {
  const csv = () => {
    const p = join(env.work, '예산현황.csv');
    writeFileSync(p, [
      '회계구분,단위사업,세부사업,과목,예산액,집행액',
      '대학회계,학생지원,진로체험 운영,체험활동 임차료,"6,000,000","2,150,000"',
      '대학회계,학생지원,진로체험 운영,외부강사 수당,"3,000,000","1,200,000"',
      '글로컬,지역협업,지역 협업 포럼,행사운영비,"12,000,000",0',
      '육성사업,교육혁신,교원 연수,국내여비,"2,400,000","1,980,000"',
    ].join('\n'), 'utf-8');
    return p;
  };
  let letter = '';

  beforeAll(async () => {
    letter = join(env.work, '진로체험 버스 임차.hwpx');
    const md = [
      '가온대학교', '수신 학생처장', '제목 2026 진로체험 버스 임차 협조 요청',
      '1. 2026학년도 진로체험활동과 관련하여 아래와 같이 버스 임차를 협조 요청하오니 2026. 11. 20.까지 계약 절차를 마쳐 주시기 바랍니다.',
      '가. 일시: 2026. 11. 27.(금) 08:30~15:30', '나. 대상: 학생 142명, 인솔 8명', '다. 소요 예산: 금1,980,000원(45인승 버스 3대, 부가세 포함)',
      '가온대학교총장', '시행 학생처-4021 (2026. 11. 10.)',
    ].join('\n\n');
    writeFileSync(letter, Buffer.from(await markdownToHwpx(md)));
  });

  it('미리보기(dry_run)는 저장하지 않고, 불러오면 회계 구분별 합계가 맞다', async () => {
    const dry = await call('budget_import', { path: csv(), dry_run: true, year: 2026 });
    expect(dry.saved).toBe(false);
    expect(dry.preview).toHaveLength(4);
    expect((await call<BudgetBookView>('budget_book', { year: 2026 })).items).toHaveLength(0);

    const r = await call('budget_import', { path: csv(), year: 2026 });
    expect(r).toMatchObject({ saved: true, added: 4, total_budget: 23_400_000 });
    const book = await call<BudgetBookView>('budget_book', { year: 2026 });
    expect(book.accounts.map((a) => [a.label, a.items, a.budget])).toEqual([['대학회계', 2, 9_000_000], ['글로컬', 1, 12_000_000], ['육성사업', 1, 2_400_000]]);
    expect(book.totals).toMatchObject({ budget: 23_400_000, paid: 5_330_000, avail: 18_070_000 });
  });

  it('공문을 읽어 금액·성격·추천, 반영하면 잔액이 줄고 넘치면 막는다', async () => {
    const a = await call('budget_analyze', { path: letter, year: 2026 });
    expect(a.amount).toBe(1_980_000);
    expect(a.nature).toBe('임차');
    expect(a.title).toContain('버스 임차');
    expect(a.suggestions[0].item.name).toBe('체험활동 임차료');
    expect(a.suggestions[0].reasons).toContain('거래 성격: 임차');

    const item = a.suggestions[0].item;
    const r = await call('budget_apply', { year: 2026, item_id: item.id, amount: a.amount, stage: 'commit', doc_path: letter, doc_title: a.title, sender: a.sender });
    expect(r.item).toMatchObject({ commit: 1_980_000, avail: 6_000_000 - 2_150_000 - 1_980_000 });
    await expect(call('budget_apply', { year: 2026, item_id: item.id, amount: 5_000_000, stage: 'paid' })).rejects.toThrow(/가용 잔액/);
    const book = await call<BudgetBookView>('budget_book', { year: 2026 });
    expect(book.linked_docs).toEqual([letter]);
  }, 30_000);

  it('품의를 지출 완료로(금액이 달라도), 취소는 반대 기록으로 되돌린다', async () => {
    let book = await call<BudgetBookView>('budget_book', { year: 2026 });
    const commit = book.entries.find((e) => e.stage === 'commit')!;
    const s = await call('budget_settle', { year: 2026, id: commit.id, amount: 1_900_000 });
    expect(s.item).toMatchObject({ commit: 0, paid: 2_150_000 + 1_900_000 });
    await expect(call('budget_reverse', { year: 2026, id: commit.id })).rejects.toThrow(/먼저 취소/);
    await expect(call('budget_settle', { year: 2026, id: commit.id })).rejects.toThrow(/이미/);

    const pay = s.entries.find((e: BudgetEntry) => e.stage === 'paid');
    const r = await call('budget_reverse', { year: 2026, id: pay.id, reason: '금액 잘못' });
    expect(r.entries).toHaveLength(2);
    expect(r.item).toMatchObject({ commit: 1_980_000, paid: 2_150_000 });
    // 이제 품의를 취소할 수 있다
    const c = await call('budget_reverse', { year: 2026, id: commit.id });
    expect(c.item).toMatchObject({ commit: 0, avail: 6_000_000 - 2_150_000 });
    book = await call<BudgetBookView>('budget_book', { year: 2026 });
    expect(book.linked_docs).toEqual([]);
    expect(book.reversible).toEqual([]);
    expect(book.entries.length).toBe(6);
  });

  it('다시 불러오면 기록을 잇고, 집행액 칸이 있으면 그 전 지출은 공식 집행액에 넣는다', async () => {
    let book = await call<BudgetBookView>('budget_book', { year: 2026 });
    const travel = book.items.find((x) => x.name === '국내여비')!;
    await call('budget_apply', { year: 2026, item_id: travel.id, amount: 300_000, stage: 'paid' });
    const p = join(env.work, '예산현황2.csv');
    writeFileSync(p, [
      '회계구분,단위사업,세부사업,과목,예산액,집행액',
      '육성사업,교육혁신,교원 연수,국내여비,"2,400,000","2,280,000"',
      '대학회계,학생지원,진로체험 운영,외부강사 수당,"3,000,000","1,200,000"',
    ].join('\n'), 'utf-8');
    const r = await call('budget_import', { path: p, year: 2026 });
    expect(r).toMatchObject({ added: 0, updated: 2, retired: 1, synced: 1 });
    book = await call<BudgetBookView>('budget_book', { year: 2026 });
    expect(book.items.find((x) => x.id === travel.id)).toMatchObject({ paid: 2_280_000, avail: 120_000 });
    expect(book.items.find((x) => x.name === '체험활동 임차료')?.retired).toBe(true);
    expect(book.items.some((x) => x.name === '행사운영비')).toBe(false);
  });

  it('손으로 과목 더하기·추천 낱말, 엑셀 두 시트', async () => {
    const it = await call('budget_item_add', { year: 2026, account: 'glocal', detail: '지역 협업 포럼', name: '행사운영비', budget: 5_000_000, keywords: ['포럼'] });
    expect(it).toMatchObject({ account: 'glocal', avail: 5_000_000 });
    await expect(call('budget_item_add', { year: 2026, account: 'glocal', detail: '지역 협업 포럼', name: '행사운영비', budget: 1 })).rejects.toThrow(/이미/);
    const sug = await call('budget_suggest', { year: 2026, text: '지역 협업 포럼 개최 안내', account: 'glocal', amount: 1_000_000 });
    expect(sug[0].item.id).toBe(it.id);
    const x = await call('budget_export', { year: 2026 });
    expect(existsSync(x.output_path)).toBe(true);
    const zip = await JSZip.loadAsync(require('node:fs').readFileSync(x.output_path));
    expect(Object.keys(zip.files).filter((n) => n.startsWith('xl/worksheets/sheet'))).toHaveLength(2);
  });
});

describe('HWX (전자결재 공문서 파일)', () => {
  const body = ['가온대학교', '제목 글로컬 포럼 행사 운영 협조', '1. 글로컬대학 사업 포럼을 아래와 같이 개최합니다.', '가. 소요 예산: 금3,000,000원', '가온대학교총장', '시행 기획처-77 (2026. 11. 3.)'].join('\n\n');

  it('머리 바이트로 가른다', () => {
    expect(sniff(Buffer.from('%PDF-1.7'))).toBe('pdf');
    expect(sniff(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
    expect(sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('ole');
    expect(sniff(Buffer.from('<?xml version="1.0"?><a/>'))).toBe('xml');
    expect(sniff(Buffer.from('hello'))).toBe('unknown');
  });

  it('확장자만 HWX 인 HWPX, 묶음 안 HWPX + 결재 정보 XML 을 읽는다', async () => {
    const hwpx = Buffer.from(await markdownToHwpx(body));
    const renamed = join(env.work, '포럼.hwx');
    writeFileSync(renamed, hwpx);
    const a = await call('budget_analyze', { path: renamed, year: 2026 });
    expect(a).toMatchObject({ format: 'hwx', amount: 3_000_000, account_hint: 'glocal' });

    const zip = new JSZip();
    zip.file('approval.xml', '<?xml version="1.0"?><approval><docNo>기획처-77</docNo><drafter>김예산</drafter></approval>');
    zip.file('body/본문.hwpx', hwpx);
    const packed = join(env.work, '결재.hwx');
    writeFileSync(packed, await zip.generateAsync({ type: 'nodebuffer' }));
    const b = await call('budget_analyze', { path: packed, year: 2026 });
    expect(b.amount).toBe(3_000_000);
    expect(b.notes.join(' ')).toContain('본문.hwpx');
  }, 30_000);

  it('알아보지 못하면 무엇을 하면 되는지 알린다', async () => {
    const bad = join(env.work, '이상한.hwx');
    writeFileSync(bad, Buffer.from('this is not a document'));
    await expect(call('budget_analyze', { path: bad })).rejects.toThrow(/HWP·HWPX·PDF 로 내려받아/);
  });
});

describe('한솔 전자결재 HWX · 원인행위서 (가상 표본, 실제 문서와 같은 짜임)', () => {
  // 실제 표본에서 확인한 칸 이름과 짜임만 따르고 값·기관·사람은 모두 지어낸 것
  const VOUCHER_HTML = [
    '2025회계연도 가온대학교 대학회계', '원인행위서', 'FIAEM000000000000000000000000001',
    '[원인행위] 20250110\\_[육성]출장여비 정산 결의 요청(가온혁신과/김*온외 1명)',
    '예산부서 : 가온혁신과 결의번호 : 20251BD0000E40000001',
    '<table><tr><th rowspan="2">원<br>인<br>행<br>위</th><th>발의일자</th><th>발의부서</th></tr><tr><td>2025-01-10</td><td>가온혁신과</td></tr>',
    '<tr><td>건<br><br>명</td><td colspan="7">[육성]출장여비 정산 결의 요청(가온혁신과/김*온외 1명)</td></tr>',
    '<tr><td rowspan="4">금<br><br>액</td><td colspan="4" rowspan="2">250,000 원</td></tr></table>',
    '예산',
    '<table><tr><th>예산부서</th><th>계정구분</th><th>재원구분</th><th>세부사업</th><th>예산과목</th><th>금액</th></tr>',
    '<tr><td>가온혁신과</td><td>자체수입</td><td>지원금(보조금)</td><td>[국립대학육성사업]지원금</td><td>물건비-여비-국내여비 (국립대학 육성사업 국내여비)</td><td>250,000 원</td></tr>',
    '<tr><td colspan="5">합 계</td><td>250,000 원</td></tr></table>',
    '여비명세서', '<table><tr><th>출장자</th><th>계좌번호</th></tr><tr><td>홍길동</td><td>(가온은행)●●●●1234</td></tr></table>',
  ].join('\n');

  it('원인행위서 칸: 회계연도·결의번호·건명·발의일자·금액·예산 줄, 명세서 표는 읽지 않는다', async () => {
    const { extractVoucher } = await import('../src/core/budget/voucher.js');
    const v = extractVoucher(VOUCHER_HTML)!;
    expect(v).toMatchObject({
      kind: '원인행위서', fiscal_year: 2025, resolution_no: '20251BD0000E40000001', date: '2025-01-10', dept: '가온혁신과', total: 250_000,
      title: '[육성]출장여비 정산 결의 요청(가온혁신과/김*온외 1명)',
    });
    expect(v.lines).toEqual([{ dept: '가온혁신과', ledger: '자체수입', source: '지원금(보조금)', detail: '[국립대학육성사업]지원금', subject: '물건비-여비-국내여비 (국립대학 육성사업 국내여비)', amount: 250_000 }]);
    expect(JSON.stringify(v)).not.toContain('홍길동');
    expect(v.checks).toEqual([{ label: '금액 칸 = 예산 줄 합계', ok: true, detail: '250,000원 / 250,000원' }]);
    // 공문 본문에 "결의서" 낱말만 있으면 결의서가 아니다
    expect(extractVoucher('제목 지출결의서 제출 안내\n\n지출결의서를 붙임과 같이 제출하여 주시기 바랍니다.')).toBeNull();
  });

  it('머리 칸의 [길이][위치] 짝으로 본문을 찾는다', async () => {
    const { handysoftEntries, sniff, HANDYSOFT_MAGIC } = await import('../src/core/budget/read-doc.js');
    const body = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(1000, 7)]);
    const head = Buffer.alloc(200);
    head.write(HANDYSOFT_MAGIC, 0, 'latin1');
    head.writeUInt32LE(body.length, 38);
    head.writeUInt32LE(head.length, 42);
    head.write('JHOMS000000000000000', 60, 'latin1');
    const buf = Buffer.concat([head, body]);
    expect(sniff(buf)).toBe('handysoft');
    expect(handysoftEntries(buf)).toEqual([{ offset: 200, length: body.length, kind: 'zip' }]);
    // 짝이 없으면 문서 머리 바이트로
    const noPair = Buffer.from(buf);
    noPair.fill(0, 38, 46);
    expect(handysoftEntries(noPair)).toEqual([{ offset: 200, length: body.length, kind: 'zip' }]);
  });

  it('HWX 를 읽어 결의서 예산과목으로 회계·과목을 맞춘다', async () => {
    const csvPath = join(env.work, '예산2025.csv');
    writeFileSync(csvPath, [
      '회계구분,단위사업,세부사업,과목,예산액,집행액',
      '대학회계,교육혁신,교원 연수,국내여비,"2,400,000","100,000"',
      '육성사업,국립대학육성사업,지원금,국내여비,"3,600,000","1,100,000"',
      '육성사업,국립대학육성사업,지원금,외부강사 수당,"2,000,000",0',
    ].join('\n'), 'utf-8');
    await call('budget_import', { path: csvPath, year: 2025 });
    const md = VOUCHER_HTML.replace(/<table>/g, '\n<table>');
    // 엔진이 HWPX 로 다시 읽으면 표가 "| 칸 |" 꼴로 나온다: 그 꼴로 HWX 를 만든다
    const plain = md.replace(/<table>[\s\S]*?<\/table>/g, (t) => {
      const rows = (t.match(/<tr[\s\S]*?<\/tr>/g) ?? []).map((tr) => (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) ?? []).map((c) => c.replace(/<[^>]+>/g, '').trim()));
      const w = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${[...r, ...Array(w - r.length).fill('')].join(' | ')} |`;
      return [line(rows[0]), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(line)].join('\n');
    });
    const hwpx = Buffer.from(await markdownToHwpx(plain));
    const head = Buffer.alloc(429);
    head.write('Handysoft Approval Document File', 0, 'latin1');
    head.writeUInt32LE(hwpx.length, 38);
    head.writeUInt32LE(429, 42);
    const hwx = join(env.work, '원인행위서.hwx');
    writeFileSync(hwx, Buffer.concat([head, hwpx]));

    const a = await call('budget_analyze', { path: hwx, year: 2025 });
    expect(a).toMatchObject({ format: 'hwx', doc_kind: '원인행위서', fiscal_year: 2025, amount: 250_000, account_hint: 'growth', nature: '여비' });
    expect(a.notes.join(' ')).toContain('한솔 전자결재');
    expect(a.basis).not.toContain('홍길동');
    expect(a.suggestions[0].item).toMatchObject({ account: 'growth', name: '국내여비' });
    expect(a.suggestions[0].reasons[0]).toBe('결의서 예산과목 일치');
  }, 30_000);
});

describe('원인행위서 적요·여비명세서 대조 (가상 값)', () => {
  it('적요의 관련 문서·지급금액과 여비명세서 합계를 금액 칸과 맞춰 본다, 다르면 알린다', async () => {
    const { extractVoucher } = await import('../src/core/budget/voucher.js');
    const md = (memoAmount: string) => [
      '2026회계연도 가온대학교 대학회계', '원인행위서', '예산부서 : 가온지원과 결의번호 : 20261BD0000E40000009',
      '<table><tr><td>건 명</td><td colspan="5">출장여비 정산 결의 요청(김*온 11.06)</td><td>적 요</td><td colspan="4">1. 관련: 가온지원과-1234(2026.11.04.) 2. 내용: 착수보고회 참석 3. 일시 및 출장지: 2026.11.06. 가온캠퍼스 4. 지급금액: 금' + memoAmount + '원</td></tr>',
      '<tr><td rowspan="4">금 액</td><td colspan="3" rowspan="2">68,900 원</td><td rowspan="7">수 령 정 보</td><td colspan="4">김가온 (가온은행) ●●●●1234 68,900원</td></tr></table>',
      '<table><tr><th>예산부서</th><th>계정구분</th><th>재원구분</th><th>세부사업</th><th>예산과목</th><th>금액</th></tr>',
      '<tr><td>가온지원과</td><td>자체수입</td><td>일반재원</td><td>부서운영비</td><td>물건비-여비-국내여비</td><td>68,900 원</td></tr></table>',
      '여비명세서', '<table><tr><td>출장자</td><td>구분</td><td>일비(A)</td><td>식비(B)</td></tr><tr><td>김가온</td><td>관외</td><td>25,000 원</td><td>25,000 원</td></tr><tr><td colspan="3">합 계</td><td>68,900 원</td></tr></table>',
    ].join('\n');
    const ok = extractVoucher(md('68,900'))!;
    expect(ok).toMatchObject({ related: '가온지원과-1234(2026.11.04.)', travel_total: 68_900 });
    expect(ok.checks.map((c) => [c.label, c.ok])).toEqual([['금액 칸 = 예산 줄 합계', true], ['금액 칸 = 적요의 지급금액', true], ['금액 칸 = 여비명세서 합계', true]]);
    const bad = extractVoucher(md('86,900'))!;
    expect(bad.checks.find((c) => c.label.includes('적요'))).toMatchObject({ ok: false, detail: '68,900원 / 86,900원' });

    const { maskNames } = await import('../src/core/redact/names.js');
    const masked = maskNames(md('68,900')).text;
    expect(masked).not.toContain('김가온');
    expect(masked).toContain('김○○ (가온은행)');
  });
});

describe('물품 구매 원인행위서 (가상 값): 적요 "지출금액 … 이내", 일반명세서, 거래처', () => {
  it('상한(이내)·명세서 합계·거래처를 읽고, 넘으면 알린다', async () => {
    const { extractVoucher } = await import('../src/core/budget/voucher.js');
    const md = (cap: string, item2: string) => [
      '2026회계연도 가온대학교 대학회계', '원인행위서', '예산부서 : 가온지원과 결의번호 : 20261BD0000E10000001',
      '<table><tr><td>건 명</td><td>부서 운영을 위한 물품 구매 결의</td><td>적 요</td><td>1. 건 명: 부서 운영을 위한 물품 구매 결의 2. 구입품목: 문구류 10개 물품 3. 지출금액: 금 ' + cap + '원 이내 4. 지출과목: 대학회계-일반수용비. 끝.</td></tr>',
      '<tr><td rowspan="4">금 액</td><td>200,000 원</td></tr>',
      '<tr><td rowspan="3">거 래 처</td><td>상 호</td><td>가온생활협동조합</td></tr><tr><td>사업자번호 (주민등록번호)</td><td>000-00-00000</td></tr></table>',
      '<table><tr><th>예산부서</th><th>계정구분</th><th>재원구분</th><th>세부사업</th><th>예산과목</th><th>금액</th></tr>',
      '<tr><td>가온지원과</td><td>자체수입</td><td>일반재원</td><td>부서운영비</td><td>물건비-운영비-일반수용비 (사무용품 구입)</td><td>100,000 원</td></tr>',
      '<tr><td>가온지원과</td><td>자체수입</td><td>일반재원</td><td>부서운영비</td><td>물건비-운영비-일반수용비 (소모품 구입)</td><td>100,000 원</td></tr></table>',
      '일반명세서', '<table><tr><td>순번</td><td>품명및규격</td><td>금액</td></tr><tr><td>1</td><td>물품 구매</td><td>100,000 원</td></tr><tr><td>2</td><td>물품 구매</td><td>' + item2 + ' 원</td></tr><tr><td colspan="2">합 계</td><td>' + (item2 === '100,000' ? '200,000' : '190,000') + ' 원</td></tr></table>',
    ].join('\n');
    const ok = extractVoucher(md('200,000', '100,000'))!;
    expect(ok).toMatchObject({ total: 200_000, detail_total: 200_000, vendor: '가온생활협동조합', vendor_no: '000-00-00000' });
    expect(ok.checks.map((c) => [c.label, c.ok])).toEqual([['금액 칸 = 예산 줄 합계', true], ['금액 칸 ≤ 적요의 지출금액(이내)', true], ['금액 칸 = 명세서 합계', true]]);
    const bad = extractVoucher(md('150,000', '90,000'))!;
    expect(bad.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(['금액 칸 ≤ 적요의 지출금액(이내)', '금액 칸 = 명세서 합계']);
  });
});

describe('같은 결의서 중복 반영', () => {
  it('결의번호가 같으면 다른 파일 이름이어도 막고, 나눠 반영(again)·취소 뒤에는 받는다', async () => {
    const it0 = await call('budget_item_add', { year: 2031, account: 'univ', name: '일반수용비', budget: 1_000_000 });
    const first = await call('budget_apply', { year: 2031, item_id: it0.id, amount: 100_000, stage: 'commit', doc_path: '/x/가.hwx', doc_number: '20311BD0000E10000001' });
    await expect(call('budget_apply', { year: 2031, item_id: it0.id, amount: 100_000, stage: 'commit', doc_path: '/x/가 (2).hwx', doc_number: '20311BD0000E10000001' })).rejects.toThrow(/이미 반영/);
    await call('budget_apply', { year: 2031, item_id: it0.id, amount: 50_000, stage: 'commit', doc_number: '20311BD0000E10000001', again: true });
    let book = await call<BudgetBookView>('budget_book', { year: 2031 });
    expect(book.linked_numbers).toEqual(['20311BD0000E10000001']);
    await call('budget_reverse', { year: 2031, id: first.entries[0].id });
    book = await call<BudgetBookView>('budget_book', { year: 2031 });
    expect(book.linked_numbers).toEqual(['20311BD0000E10000001']); // 나눠 넣은 줄이 남아 있다
  });
});
