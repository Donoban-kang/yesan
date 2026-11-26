/** 기관 규정 근거 찾기 — 조항 나누기, 단락 나누기, 금액 기준, 넣기·찾기·전문·빼기 (가상의 가온대학교 규정, 실제 규정 아님) */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, setupEnv } from './doc-helpers.js';
import { amountRules, splitClauses } from '../src/core/budget/guide.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let env: ReturnType<typeof setupEnv>;
beforeAll(() => { env = setupEnv(); });

/** 시험용 CP949 인코더: Node 에는 euc-kr 인코더가 없어 디코더로 완성형 표를 거꾸로 만든다 */
function encodeCp949(text: string): Buffer {
  const map = new Map<string, number[]>();
  const dec = new TextDecoder('euc-kr');
  for (let a = 0xb0; a <= 0xc8; a++) for (let b = 0xa1; b <= 0xfe; b++) map.set(dec.decode(Buffer.from([a, b])), [a, b]);
  return Buffer.from([...text].flatMap((ch) => (ch.charCodeAt(0) < 0x80 ? [ch.charCodeAt(0)] : map.get(ch) ?? [0x3f])));
}

const RULE = [
  '가온대학교 예산집행 지침 (시험용 가상 규정)',
  '',
  '제1장 총칙',
  '제1조(목적) 이 지침은 가온대학교 예산의 집행에 필요한 사항을 정함을 목적으로 한다.',
  '제2조(정의) 이 지침에서 "집행"이란 예산을 지출원인행위와 지출로 쓰는 것을 말한다.',
  '제2장 경비별 집행 기준',
  '제10조(국내여비) ① 국내 출장 여비는 운임·일비·숙박비·식비로 나눈다.',
  '② 숙박비는 1박당 70,000원 이내에서 실비로 지급한다.',
  '제11조(업무추진비) ① 업무추진비는 기관 운영을 위한 간담회·회의 경비로 쓴다.',
  '② 간담회 식대는 1인당 30,000원 이내로 한다. 제10조에 따른 여비와 함께 받을 수 없다.',
  '제12조(일반수용비) 소모품·사무용품 구입과 인쇄비는 일반수용비로 집행한다. 1건당 500만원 이상은 계약 절차를 따른다.',
  '제12조의2(자산취득비) 내용연수 1년 이상이고 1건 50만원 이상인 물품은 자산취득비로 구입한다.',
  '제13조(강사수당) 외부 강사 수당은 시간당 지급 기준표에 따른다.',
].join('\n');

describe('조항 나누기', () => {
  it('제N조(제목)을 조항으로, 장 제목을 붙이고, 본문 속 "제10조에 따른"은 새 조로 보지 않는다', () => {
    const c = splitClauses(RULE);
    expect(c.map((x) => x.no)).toEqual(['제1조', '제2조', '제10조', '제11조', '제12조', '제12조의2', '제13조']);
    const c11 = c.find((x) => x.no === '제11조')!;
    expect(c11.title).toBe('업무추진비');
    expect(c11.chapter).toBe('제2장 경비별 집행 기준');
    expect(c11.text).toContain('1인당 30,000원 이내');
    expect(c11.text).toContain('제10조에 따른 여비');
    expect(c.find((x) => x.no === '제1조')!.chapter).toBe('제1장 총칙');
  });

  it('조가 없는 안내문은 머리말·빈 줄로 단락을 나눈다', () => {
    const t = ['□ 출장 여비 집행 안내', '출장은 사전에 출장 신청서를 결재받고, 정산은 출장 후 5일 안에 증빙과 함께 한다. 숙박은 실비로 정산한다. '.repeat(2), '',
      '□ 회의비 집행 안내', '회의 식대는 참석자 명단과 영수증을 붙인다. 1인당 30,000원 이내에서 집행한다. '.repeat(2)].join('\n');
    const c = splitClauses(t);
    expect(c).toHaveLength(2);
    expect(c[0].no).toBe('1번째 단락');
    expect(c[1].title).toBe('□ 회의비 집행 안내');
  });

  it('금액 기준만 뽑는다 (기준 말이 없는 그냥 금액은 뺌)', () => {
    expect(amountRules('간담회 식대는 1인당 30,000원 이내로 한다. 총액 120,000원을 썼다.')).toEqual(['1인당 30,000원 이내']);
    expect(amountRules('1건당 500만원 이상은 계약 절차를 따른다.')).toEqual(['1건당 500만원 이상']);
  });
});

describe('규정 넣기·근거 찾기 (RPC)', () => {
  it('넣은 규정에서 고른 과목·공문과 맞는 조항을 찾고, 전문을 보이고, 뺀다', async () => {
    const file = join(env.work, '가온대 예산집행 지침.txt');
    writeFileSync(file, RULE);
    const add = await call('budget_guide_add', { paths: [file] });
    expect(add.failed).toEqual([]);
    expect(add.added[0]).toMatchObject({ name: '가온대 예산집행 지침.txt', clauses: 7, articles: 7 });
    expect(await call('budget_guide_list', {})).toHaveLength(1);

    const item = await call('budget_item_add', { year: 2026, account: 'univ', detail: '학과 운영', name: '업무추진비', budget: 3_000_000 });
    const found = await call('budget_guide_find', { year: 2026, item_id: item.id, nature: '회의', text: '학과 교수 간담회를 열고 식대 240,000원을 지출하고자 합니다.' });
    expect(found[0]).toMatchObject({ no: '제11조', title: '업무추진비', guide: '가온대 예산집행 지침.txt', amounts: ['1인당 30,000원 이내'], score: 99 });
    expect(found[0].terms).toContain('업무추진비');
    expect(found.map((m: { no: string }) => m.no)).not.toContain('제1조');

    // 과목 없이 공문 글·거래 성격만으로도
    const buy = await call('budget_guide_find', { text: '사무용품 소모품 구입', nature: '구입' });
    expect(buy[0].no).toBe('제12조');

    const full = await call('budget_guide_clause', { id: add.added[0].id, no: '제10조' });
    expect(full.text).toContain('1박당 70,000원 이내');

    // 같은 파일을 다시 넣으면 하나로
    await call('budget_guide_add', { paths: [file] });
    expect(await call('budget_guide_list', {})).toHaveLength(1);

    expect(await call('budget_guide_remove', { id: add.added[0].id })).toBe(true);
    expect(await call('budget_guide_list', {})).toHaveLength(0);
    expect(await call('budget_guide_find', { text: '간담회', nature: '회의' })).toEqual([]);
    await expect(call('budget_guide_clause', { id: add.added[0].id, no: '제10조' })).rejects.toThrow(/다시 넣어/);
  }, 30_000);

  it('읽지 못한 파일은 실패 목록에 까닭과 함께', async () => {
    const file = join(env.work, '빈 규정.txt');
    writeFileSync(file, '  ');
    const r = await call('budget_guide_add', { paths: [file] });
    expect(r.added).toEqual([]);
    expect(r.failed[0].error).toMatch(/글을 읽지 못했습니다|읽지 못/);
  }, 30_000);

  it('목록에 없는 확장자도 글자면 읽고(웹 문서는 태그를 걷음), 바이너리는 까닭과 함께 거절', async () => {
    const html = join(env.work, '여비 규정.htm');
    writeFileSync(html, '<html><body><p>제1조(목적) 이 규정은 여비 지급 기준을 정한다.</p><p>제2조(숙박비) 숙박비는 1박당 70,000원 이내로 한다.</p><p>제3조(정산) 출장 뒤 5일 안에 정산한다.</p></body></html>');
    const md = join(env.work, '회의비 안내.md');
    writeFileSync(md, '# 회의비 안내\n\n제1조(회의비) 회의 식대는 1인당 30,000원 이내로 집행한다.\n제2조(증빙) 참석자 명단과 영수증을 붙인다.\n제3조(한도) 같은 날 두 번 집행하지 않는다.');
    const bin = join(env.work, '그림 묶음.dat');
    writeFileSync(bin, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2, 3, 0, 255, 254]));
    const r = await call('budget_guide_add', { paths: [html, md, bin] });
    expect(r.added.map((g: { name: string; articles: number }) => [g.name, g.articles])).toEqual([['여비 규정.htm', 3], ['회의비 안내.md', 3]]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toMatch(/글자로 읽을 수 없는 파일/);
    const c = await call('budget_guide_clause', { id: r.added[0].id, no: '제2조' });
    expect(c.text).toContain('1박당 70,000원 이내');
    expect(c.text).not.toContain('<p>');
    for (const g of r.added) await call('budget_guide_remove', { id: g.id });
  }, 30_000);

  it('예전 한글 인코딩(CP949)·UTF-16·숫자 엔티티도 읽고, 너무 큰 모르는 파일은 읽기 전에 거절', async () => {
    const body = ['제1조(목적) 이 지침은 업무추진비 집행 기준을 정한다.', '제2조(한도) 간담회 식대는 1인당 30,000원 이내로 한다.', '제3조(증빙) 참석자 명단을 붙인다.'].join('\n');
    const cp949 = join(env.work, '업무추진비.law');
    writeFileSync(cp949, encodeCp949(body));
    const u16 = join(env.work, '업무추진비2.log');
    writeFileSync(u16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]));
    const ent = join(env.work, '업무추진비3.htm');
    writeFileSync(ent, `<html><body>${body.split('\n').map((l) => `<p>${[...l].map((ch) => (/[가-힣]/.test(ch) ? `&#${ch.codePointAt(0)};` : ch)).join('')}</p>`).join('')}</body></html>`);
    const big = join(env.work, '큰 파일.bin');
    writeFileSync(big, Buffer.alloc(21 * 1024 * 1024, 0x41));
    const r = await call('budget_guide_add', { paths: [cp949, u16, ent, big] });
    expect(r.added.map((g: { articles: number }) => g.articles)).toEqual([3, 3, 3]);
    for (const g of r.added) expect((await call('budget_guide_clause', { id: g.id, no: '제2조' })).text).toContain('1인당 30,000원 이내');
    expect(r.failed.map((f: { error: string }) => f.error)).toEqual([expect.stringMatching(/너무 큽니다/)]);
    for (const g of r.added) await call('budget_guide_remove', { id: g.id });
  }, 30_000);
});

describe('추천 점수', () => {
  it('99 를 넘는 후보가 둘이어도 같은 99 로 뭉개지 않고 차이를 남긴다', async () => {
    await call('budget_item_add', { year: 2027, account: 'growth', unit: '교육혁신', detail: '교수법 연수', name: '물건비-여비-국내여비', budget: 3_000_000 });
    await call('budget_item_add', { year: 2027, account: 'univ', unit: '교직원 역량', detail: '직무연수 지원', name: '물건비-여비-국내여비', budget: 3_000_000 });
    const s = await call('budget_suggest', { year: 2027, text: '교수법 연수 국내 출장 여비 국내여비 정산', nature: '여비', amount: 100_000, subjects: ['물건비-여비-국내여비 (교수법 연수)'] });
    expect(s).toHaveLength(2);
    expect(s[0].item.detail).toBe('교수법 연수');
    expect(s[0].score).toBe(99);
    expect(s[1].score).toBeLessThan(99);
  });
});

describe('나눠 반영 (F-09)', () => {
  it('결의서 한 건을 여러 과목에 한 번에, 하나라도 막히면 아무것도 쓰지 않고, 한 번 취소로 함께 취소', async () => {
    const y = 2028;
    const a = await call('budget_item_add', { year: y, account: 'univ', detail: '교육혁신과 운영', name: '일반수용비', budget: 1_000_000 });
    const b = await call('budget_item_add', { year: y, account: 'univ', detail: '교무과 운영', name: '일반수용비', budget: 200_000 });
    const doc = { year: y, stage: 'commit', doc_number: '가온대-시험-0001', doc_title: '[원인행위서] 사무용품 구입' };

    // b 는 잔액 200,000 → 250,000 은 막히고, a 몫도 쓰이지 않는다
    await expect(call('budget_apply_split', { ...doc, parts: [{ item_id: a.id, amount: 150_000 }, { item_id: b.id, amount: 250_000 }] })).rejects.toThrow(/가용 잔액/);
    let book = await call('budget_book', { year: y });
    expect(book.entries).toHaveLength(0);

    const r = await call('budget_apply_split', { ...doc, parts: [{ item_id: a.id, amount: 150_000, memo: '교육혁신과' }, { item_id: b.id, amount: 150_000, memo: '교무과' }] });
    expect(r.entries).toHaveLength(2);
    expect(new Set(r.entries.map((e: { group: string }) => e.group)).size).toBe(1);
    expect(r.items.map((i: { avail: number }) => i.avail).sort()).toEqual([50_000, 850_000]);
    expect(r.entries[0].memo).toBe('교육혁신과');

    // 같은 결의번호 다시는 막힘
    await expect(call('budget_apply_split', { ...doc, parts: [{ item_id: a.id, amount: 1_000 }] })).rejects.toThrow(/이미 반영/);

    // 한 번 취소로 두 줄 모두
    await call('budget_reverse', { year: y, id: r.entries[0].id });
    book = await call('budget_book', { year: y });
    expect(book.items.map((i: { avail: number }) => i.avail).sort()).toEqual([1_000_000, 200_000]);
    expect(book.linked_numbers).not.toContain('가온대-시험-0001');

    // 같은 과목에 두 줄이면 합쳐서 잔액을 본다
    await expect(call('budget_apply_split', { ...doc, parts: [{ item_id: b.id, amount: 120_000 }, { item_id: b.id, amount: 120_000 }] })).rejects.toThrow(/가용 잔액/);
  });
});

describe('AI 대화 도구 (F-12)', () => {
  it('budget_status·budget_suggest_item: 잔액 조회, 추천과 근거 조항, 반영은 하지 않음, MCP 목록에도 있음', async () => {
    const { runWorkTool, workToolDefs } = await import('../src/core/agent-tools/index.js');
    const dispatch = ((m: string, p: Record<string, unknown>) => call(m, p)) as never;
    expect(workToolDefs().map((t) => t.name)).toEqual(expect.arrayContaining(['budget_status', 'budget_suggest_item']));

    const y = new Date().getFullYear();
    await call('budget_item_add', { year: y, account: 'growth', unit: '교육혁신', detail: '교수법 연수', name: '국내여비', budget: 2_000_000, spent_before: 500_000 });
    await call('budget_item_add', { year: y, account: 'univ', unit: '교직원 역량', detail: '직무연수 지원', name: '일반수용비', budget: 1_000_000 });
    const rule = join(env.work, '여비 지침.txt');
    writeFileSync(rule, ['제1조(목적) 예산 집행 기준을 정한다.', '제2조(국내여비) 숙박비는 1박당 70,000원 이내로 한다.', '제3조(일반수용비) 사무용품은 일반수용비로 산다.'].join('\n'));
    await call('budget_guide_add', { paths: [rule] });

    const st = await runWorkTool('budget_status', { query: '국내여비' }, dispatch);
    expect(st.isError).toBeFalsy();
    expect(st.output).toMatch(/국내여비: 예산 2,000,000원 · 집행 500,000원 · 품의 중 0원 · 가용 1,500,000원/);

    const before = (await call('budget_book', { year: y })).entries.length;
    const sg = await runWorkTool('budget_suggest_item', { text: '교수법 연수 국내 출장 여비 정산', amount: 300_000 }, dispatch);
    expect(sg.output).toMatch(/1\. \[[^\]]+\] 교육혁신 › 교수법 연수 › 국내여비/);
    expect(sg.output).toMatch(/제2조\(국내여비\)/);
    expect(sg.output).toMatch(/반영은 하지 않았습니다/);
    expect((await call('budget_book', { year: y })).entries.length).toBe(before);

    expect((await runWorkTool('budget_suggest_item', {}, dispatch)).isError).toBe(true);
  }, 30_000);
});
