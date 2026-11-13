/** 결의서 입력 초안 (순수 함수) — 회계 시스템에 옮겨 적을 건명·적요 글과 증빙 확인표
 *
 * 적요 꼴은 실제 원인행위서 표본 3건(여비 정산 2·물품 구매 1, 2026-11-13 확인)의 짜임을 따른다:
 *  - 여비: "1. 관련: 문서번호(날짜) 2. 내용: … 3. 일시 및 출장지: … 4. 지급금액: 금N원(금한글원)"
 *  - 물품 구매: "1. 건 명: … 2. 구입품목: … 3. 지출금액: 금 N원 이내 4. 지출과목: 회계-과목. 끝."
 * 증빙 확인표는 같은 표본의 증빙 묶음과, 검증 때 실제로 어긋났던 자리(사업자번호·품목 수·날짜 차례·왕복 운임)를 담는다.
 * 기관 회계 규정이 우선이며 이 글은 초안이다. 사람 이름은 넣지 않는다.
 */

export type DraftKind = 'travel' | 'purchase' | 'general';

export interface DraftInput {
  kind: DraftKind;
  /** 공문 제목 또는 사업 이름 */
  title?: string;
  /** 관련 문서 "부서-번호(YYYY.MM.DD.)" */
  related?: string;
  /** 내용 (행사·출장 목적) */
  content?: string;
  /** 일시 */
  period?: string;
  /** 출장지·장소 */
  place?: string;
  /** 구입품목 요약 (예: "진행문서화일 및 각종 문구류 77개") */
  items?: string;
  amount: number;
  /** 회계 구분 이름 (예: 대학회계) */
  account?: string;
  /** 과목 이름 (예: 국내여비, 일반수용비) */
  subject?: string;
  /** 지출일 (건명 끝 "(MM.DD)") */
  date?: string;
}

export interface Draft {
  title: string;
  memo: string;
  checklist: Array<{ item: string; check: string }>;
}

const DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL = ['', '십', '백', '천'];
const BIG = ['', '만', '억', '조'];

/** 1303440 → "일백삼십만삼천사백사십" (회계 서류 관례대로 1 도 "일"로 적는다) */
export function koreanAmount(n: number): string {
  let v = Math.floor(Math.abs(n));
  if (!v) return '영';
  const parts: string[] = [];
  for (let g = 0; v > 0; g++, v = Math.floor(v / 10000)) {
    const chunk = v % 10000;
    if (!chunk) continue;
    let s = '';
    for (let i = 3; i >= 0; i--) {
      const d = Math.floor(chunk / 10 ** i) % 10;
      if (d) s += DIGIT[d] + SMALL[i];
    }
    parts.unshift(s + BIG[g]);
  }
  return parts.join('');
}

/** 참석하는 자리 (내용 끝에 "참석"을 붙인다) */
const EVENT = /(회의|보고회|설명회|포럼|세미나|연수|교육|행사|워크숍|간담회|협의회|토론회|발표회|대회|박람회)$/;
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const mmdd = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : '');
const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim();
/** 공문 제목 끝의 "안내·알림·협조 요청" 을 걷어 내용으로 */
const contentOf = (title?: string) => clean(title).replace(/^[『「"']|[』」"']/g, '').replace(/\s*(개최\s*)?(참석\s*)?(안내|알림|협조\s*요청|요청|계획)$/, '').trim();

export function buildDraft(p: DraftInput): Draft {
  const amount = Math.round(p.amount);
  const tail = mmdd(p.date) ? `(${mmdd(p.date)})` : '';
  const account = clean(p.account) || '대학회계';
  const subject = clean(p.subject);
  if (p.kind === 'travel') {
    const content = clean(p.content) || contentOf(p.title);
    const when = [clean(p.period), clean(p.place)].filter(Boolean).join(', ');
    const memo = [
      `1. 관련: ${clean(p.related) || '(출장 신청 문서번호와 날짜)'}`,
      `2. 내용: ${content ? (EVENT.test(content) && !/참석$/.test(content) ? `${content} 참석` : content) : '(출장 내용)'}`,
      `3. 일시 및 출장지: ${when || '(일시, 출장지)'}`,
      `4. 지급금액: 금${won(amount)}원(금${koreanAmount(amount)}원)`,
    ].join(' ');
    return {
      title: `출장여비 정산 결의 요청${tail}`,
      memo,
      checklist: [
        { item: '국내 출장신청서 (내부결재)', check: '문서번호·결재일이 적요 "1. 관련"과 같은지, 출장일·출장지·목적이 같은지' },
        { item: '여비 정산 신청서', check: '일비 + 식비 + 숙박비 + 운임 합계가 지급금액과 같은지' },
        { item: '교통비 영수증 (승차권·카드)', check: '운임과 같은지, 가는 편·오는 편이 모두 있는지 (한쪽만 있으면 까닭 확인)' },
        { item: '숙박 영수증 (숙박한 경우)', check: '숙박비와 같은지, 기관 여비 규정의 상한 안인지' },
        { item: '관련 안내 공문 (행사·회의)', check: '행사 일시가 출장 일시 안에 드는지, 사업(재원)과 고른 예산과목이 맞는지' },
      ],
    };
  }
  if (p.kind === 'purchase') {
    const title = clean(p.title) || '부서 운영을 위한 물품 구매 결의';
    const memo = [
      `1. 건 명: ${title}`,
      `2. 구입품목: ${clean(p.items) || '(품목 요약과 수량)'} 물품`,
      `3. 지출금액: 금 ${won(amount)}원 이내`,
      `4. 지출과목: ${account}-${subject || '(과목)'}. 끝.`,
    ].join(' ');
    return {
      title: `${title}${tail}`,
      memo,
      checklist: [
        { item: '견적서', check: '공급자 사업자번호·상호가 결의서 거래처와 같은지, 견적일이 품의 발의일보다 앞서는지, 합계(공급가 + 세액)' },
        { item: '일반지출품의서', check: '건명·금액·예산 줄이 결의서와 같은지, 적요의 품목 수가 견적서와 같은지' },
        { item: '카드 영수증', check: '결제일·합계가 맞는지, 가맹점 사업자번호가 견적서 공급자와 같은지' },
        { item: '검사·검수서', check: '품목·수량이 견적서와 같은지, 검사자와 검수자가 다른 사람인지, 날짜가 결제일 이후인지' },
        { item: '물품 사진', check: '검수한 물품이 보이는지' },
      ],
    };
  }
  const title = clean(p.title) || '(건명)';
  return {
    title: `${title}${tail}`,
    memo: [
      `1. 건 명: ${title}`,
      `2. 내용: ${clean(p.content) || contentOf(p.title) || '(내용)'}`,
      `3. 지출금액: 금 ${won(amount)}원`,
      `4. 지출과목: ${account}-${subject || '(과목)'}. 끝.`,
    ].join(' '),
    checklist: [
      { item: '근거 문서 (공문·품의서)', check: '문서번호·금액이 적요와 같은지' },
      { item: '지출 증빙 (영수증·세금계산서·청구서)', check: '거래처·금액·날짜가 결의서와 같은지' },
    ],
  };
}

/** 거래 성격 → 초안 갈래 */
export function draftKindOf(nature?: string): DraftKind {
  if (nature === '여비') return 'travel';
  if (nature === '구입' || nature === '인쇄') return 'purchase';
  return 'general';
}

/** 과목 이름의 끝 갈래 ("물건비-여비-국내여비 (설명)" → "국내여비") */
export function subjectName(name: string): string {
  const head = name.replace(/\s*\(.*$/, '');
  return head.split('-').pop()?.trim() || head;
}
