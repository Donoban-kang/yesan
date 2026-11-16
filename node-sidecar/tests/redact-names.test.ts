/** 사람 이름 가리기 — 표 칸 속 명단·이름 칸 뒤·직위와 붙은 이름. 행정 낱말·칸 이름·직렬+직급은 가리지 않는다 (가상 이름만) */

import { describe, it, expect } from 'vitest';
import { looksLikeName, maskName, maskNames } from '../src/core/redact/names.js';

describe('사람 이름 가리기', () => {
  it('이름처럼 보이는 칸', () => {
    expect(looksLikeName('홍길동')).toBe(true);
    expect(looksLikeName('남궁가온')).toBe(true);
    expect(looksLikeName('김온')).toBe(true);
    for (const w of ['합계', '관외', '공무', '일시불', '지급방법', '제주도', '교육혁신과', '부가세', '공제액', '출장일자', '가온시']) expect(looksLikeName(w)).toBe(false);
    expect(maskName('홍길동')).toBe('홍○○');
  });

  it('이름 칸이 있는 표: 명단 칸만 가리고, 머리 칸·칸 이름·행정 낱말은 둔다', () => {
    const md = [
      '<table><tr><th>출장자</th><th>구분</th><th>직급/부서</th><th>지급방법</th></tr>',
      '<tr><td>홍길동</td><td>관외</td><td>전산주사/가온과</td><td>일시불</td></tr>',
      '<tr><td>남궁가온</td><td>관내</td><td>연구원/가온과</td><td>일시불</td></tr>',
      '<tr><td>예금주</td><td>홍길동</td><td>합계</td><td>12,000 원</td></tr></table>',
    ].join('\n');
    const r = maskNames(md);
    expect(r.text).not.toMatch(/홍길동|남궁가온/);
    expect(r.text).toContain('홍○○');
    expect(r.text).toContain('남○○○');
    for (const keep of ['지급방법', '관외', '일시불', '예금주', '합계', '전산주사/가온과']) expect(r.text).toContain(keep);
    expect(r.hits).toHaveLength(3);
  });

  it('이름 칸이 없는 표의 낱말은 건드리지 않는다', () => {
    const md = '<table><tr><th>구분</th><th>장소</th></tr><tr><td>기타</td><td>정문</td></tr></table>';
    expect(maskNames(md).hits).toHaveLength(0);
  });

  it('"| 칸 |" 표, 이름 칸 뒤, 직위와 붙은 이름', () => {
    const md = ['| 성명 | 직급 |', '| --- | --- |', '| 김가온 | 주무관 |', '', '담당자: 이나래', '문의: 박하늘 주무관(031-000-0000)', '행정주사 최바다가 확인함', '전산주사 직렬 안내'].join('\n');
    const r = maskNames(md);
    for (const name of ['김가온', '이나래', '박하늘', '최바다']) expect(r.text).not.toContain(name);
    expect(r.text).toContain('전산주사 직렬 안내');
    expect(r.text).toContain('행정주사 최○○가 확인함');
  });
});

describe('OCR 줄 (표가 줄로 풀린 꼴)', () => {
  it('결재란·발의자 줄의 이름을 가리고, 같은 줄의 부서·날짜·행정 낱말은 둔다', () => {
    const md = ['결 재 홍길동 김나래 2026.11.04. 박하늘', '품 발의일자 발의부서 발의자 지급구분', '2026-10-06 가온지원과 최바다 일시불', '발의자 최바다 일시불', '합계 300,000원'].join('\n');
    const r = maskNames(md).text;
    for (const n of ['홍길동', '김나래', '박하늘']) expect(r).not.toContain(n);
    expect(r).toContain('발의자 최○○ 일시불');
    expect(r).toContain('2026-10-06 가온지원과 최○○ 일시불');
    expect(r).toContain('가온지원과');
    expect(r).toContain('합계 300,000원');
  });
});

describe('OCR 이름 칸 꼴', () => {
  it('쌍점 없는 이름 칸, 글자 사이가 띄어진 이름, 머리 줄 낱말은 두기', () => {
    const md = ['소속 가온지원과 직급 연구원 성명 홍길동', '소속 직급 성명 출장내용 출장기간', '부서명:가온지원과 직 위:팀장 성 명: 김 나 래', '(경유) 결 재 박하늘 2026.11.04.'].join('\n');
    const r = maskNames(md).text;
    expect(r).toContain('성명 홍○○');
    expect(r).toContain('성명 출장내용');
    expect(r).toContain('성 명: 김 ○ ○');
    expect(r).toContain('부서명:가온지원과');
    expect(r).toContain('(경유) 결 재 박○○');
    // 줄을 넘어 다음 줄 낱말까지 묶지 않는다, 쌍점 뒤 이름 일부("이세")도 가린다
    const two = maskNames('검사자\n부서명:가온과 성명:강 돈\n상기 물품을 정히 검수 함\n성명:이세').text;
    expect(two).toContain('\n상기 물품을');
    expect(two).toContain('성명:강 ○');
    expect(two).toContain('성명:이○');
    expect(maskNames('품 발의일자 발의부서 발의자 지급구분\n:\n2026-10-06 가온지원과 최바다 일시불\n가. 일시: 2026.11.06.').text).toContain('가온지원과 최○○ 일시불\n가. 일시');
  });
});

describe('외부 AI 답의 가린 이름 되돌리기', () => {
  it('보낸 글에서 하나뿐인 이름이면 원래 이름으로, 같은 모양이 둘이면 그대로', async () => {
    const { restoreMasked } = await import('../src/infra/llm/index.js');
    expect(restoreMasked('담당자: 김가온\n내용 확인', '김○○ 담당자에게 알립니다')).toBe('김가온 담당자에게 알립니다');
    expect(restoreMasked('담당자: 김가온\n확인자: 김나래', '김○○ 확인')).toBe('김○○ 확인');
  });
});
