/** 공문 건명 뽑기 — 스캔 결의서의 예산 과목 나열이 건명으로 뽑히지 않는다 */

import { describe, it, expect } from 'vitest';
import { extractInbox, looksLikeAccountPath } from '../src/core/inbox/extract.js';

describe('예산 과목 나열 거르기', () => {
  it('쉼표로 이은 과목 이름은 과목 나열로 본다', () => {
    expect(looksLikeAccountPath('대학회계,물건비,업무추진비,관서업무추진비')).toBe(true);
    expect(looksLikeAccountPath('대학회계, 물건비, 업무추진비')).toBe(true);
  });
  it('문장·제목은 과목 나열이 아니다', () => {
    expect(looksLikeAccountPath('2026년 가온시 한마음 체육대회 참가 협조 요청')).toBe(false);
    expect(looksLikeAccountPath('회의, 교육, 행사 운영에 협조하여 주시기 바랍니다.')).toBe(false);
  });
  it('제목 줄이 없을 때 과목 나열 줄을 건명으로 뽑지 않는다', () => {
    const md = '가온대학교\n\n대학회계,물건비,업무추진비,관서업무추진비\n\n1. 관련 문서 지출 건입니다.\n';
    expect(extractInbox(md, '2026-11-23').title ?? '').not.toContain('물건비');
  });
  it('"제목:" 줄이 있으면 그대로 쓴다', () => {
    const md = '제목: 가온 행사 운영비 지출 요청\n\n대학회계,물건비,업무추진비,관서업무추진비\n';
    expect(extractInbox(md, '2026-11-23').title).toBe('가온 행사 운영비 지출 요청');
  });
});
