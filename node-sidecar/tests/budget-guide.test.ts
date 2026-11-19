/** 기관 규정 근거 찾기 — 조항 나누기, 단락 나누기, 금액 기준, 넣기·찾기·전문·빼기 (가상의 가온대학교 규정, 실제 규정 아님) */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, setupEnv } from './doc-helpers.js';
import { amountRules, splitClauses } from '../src/core/budget/guide.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let env: ReturnType<typeof setupEnv>;
beforeAll(() => { env = setupEnv(); });

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
