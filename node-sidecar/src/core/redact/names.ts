/** 사람 이름 가리기 — kordoc 가리기 규칙은 주민번호·연락처·계좌는 잡지만 표 칸 속 이름(출장자·발의자 명단)은 놓친다
 *  (실제 원인행위서·여비명세서 표본에서 확인, 2026-11-13). 외부 AI 로 보내기 전에 이름만 더 가린다.
 *
 * 넓게 가리면 보내는 글의 뜻이 바뀌므로 세 경우만:
 *  1) 이름 칸(성명·출장자·발의자 …)이 있는 표에서, 흔한 성씨로 시작하고 칸 글 전체가 이름인 칸
 *  2) 이름 칸 바로 뒤의 이름 ("성명: 홍길동", 표에서 "성명" 칸 오른쪽 칸)
 *  3) 직위·직급과 붙은 이름 ("홍길동 주무관", "홍길동(팀장)", "행정주사 홍길동")
 * 가린 꼴은 성만 두고 나머지를 ○ 로 ("홍○○"). 두 글자 성(남궁·황보 …)도 첫 글자만 둔다.
 */

/** 흔한 성씨 (통계청 인구주택총조사 상위 성씨 위주, 일반적 경향) */
const SURNAME1 = new Set('김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부가복태목형피두감음빈동온호범좌갈곡'.split(''));
const SURNAME2 = ['남궁', '황보', '제갈', '선우', '독고', '사공', '서문'];

/** 이름 칸 이름표 */
const LABELS = ['성명', '이름', '출장자', '발의자', '기안자', '담당자', '신청자', '신청인', '수령인', '수령자', '예금주', '대표자', '작성자', '확인자', '결재자', '강사명', '강사', '참석자', '대상자', '학생명', '보호자', '민원인', '청구인', '수강자', '수상자', '피해자', '참가자', '연구자', '책임자'];

/** 직위·직급 (이름 앞이나 뒤에 붙는 말) */
const POSITIONS = '주무관|사무관|서기관|이사관|행정주사보|행정주사|행정서기보|행정서기|전산주사보|전산주사|전산서기|사서주사|기술주사|주사보|주사|서기보|서기|과장|팀장|계장|국장|실장|처장|부장|원장|총장|부총장|학장|교수|부교수|조교수|명예교수|겸임교수|초빙교수|강사|연구원|연구교수|조교|선생님|선생|교사|교감|교장|대리|주임|사원|위원장|위원|이사장|이사|대표|담당관|담당';

/** 이름처럼 보여도 아닌 말 (표 칸에 홀로 자주 나오는 행정 낱말) */
const NOT_NAME = new Set(['합계', '소계', '총계', '공무', '관외', '관내', '일시불', '해당', '없음', '해당없음', '이하', '기타', '구분', '금액', '일비', '식비', '운임', '숙박비', '성명', '직급', '부서', '비고', '정산', '지급', '은행', '우체국', '국내', '국외', '출장', '연수', '회의', '교육', '행사', '신청', '승인', '완료', '예정', '진행', '결재', '기안', '검토', '협조', '전결', '대결', '시행', '접수', '공개', '비공개', '정상', '미정', '아니오', '예', '현금', '계좌', '이체', '카드', '전액', '일부', '부가세', '공급가', '수수료', '공제액', '실지급액', '거래처', '상호', '사업자', '주소', '연락처', '전화', '서명', '날인', '인', '직인', '확인', '담당', '주무관', '팀장', '과장', '국장', '처장', '원장', '총장', '교수', '연구원', '강사', '조교', '교사', '대리', '주임', '선생', '위원', '이사', '대표', '도민', '시민', '구민', '학생', '교원', '직원', '전체', '본인', '가족', '배우자', '자녀', '부모', '상동', '동일', '유효', '무효', '주간', '야간', '오전', '오후', '정오', '자정', '당일', '익일', '전일', '도착', '출발', '왕복', '편도', '경유', '부서명', '한함', '수신', '참조', '내부결재', '소속', '직위', '직급', '발의', '품의', '검사', '검수', '결의', '이내', '이상', '이하', '사진', '붙임', '단위', '수량', '규격', '품명', '비용', '정산', '신청', '금일', '공급', '세액', '단가', '견적', '상기', '정히', '사용', '위치', '부임', '일정', '출발', '도착', '교통편', '등급', '구분', '주소', '주소는', '주소지', '연락처']);
/** 이렇게 끝나면 이름이 아니다 (기관·장소·돈) */
const NOT_NAME_END = /(과|팀|처|실|국|청|소|센터|학교|대학|위원회|은행|도|시|군|구|읍|면|리|역|관|비|료|액|세|권|증|서|표|부서|사업|지원|예산|회계|방법|일자|번호|내용|사유|기간|장소|목적|구분|여부|계획|결과|현황|명세|내역|조건|방식|기준|단위|분류|종류|형태|상태|요청|신청|승인|자료|서류|일시|지불|지급|계약|금액|합계|팀장|과장|부장|처장|원장|국장|실장|학장|총장|센터장|관장)$/;
/** 직렬 이름 ("전산"+"주사" 처럼 직급 앞에 붙는 말은 이름이 아니다) */
const SERIES = new Set(['행정', '전산', '사서', '기술', '시설', '공업', '농업', '보건', '간호', '의료', '기능', '교무', '학생', '연구', '예산', '회계', '기록', '방송', '운전', '조리', '위생', '환경', '토목', '건축', '전기', '기계', '통신', '사무', '관리', '총무', '기획', '평가', '입학', '학사', '교육', '산학', '국제', '홍보', '재무', '인사', '감사', '안전', '시설관리', '일반', '보조', '책임', '선임', '수석', '전임', '전문', '객원', '외래', '시간', '명예', '초빙', '겸임', '특임', '대표', '부', '총']);

const squash = (s: string) => s.replace(/\s/g, '');

/** 칸 글 전체가 사람 이름인가 */
export function looksLikeName(raw: string): boolean {
  const s = squash(raw);
  if (!/^[가-힣]{2,5}$/.test(s) || NOT_NAME.has(s)) return false;
  const two = SURNAME2.some((x) => s.startsWith(x));
  if (!two && (s.length > 4 || !SURNAME1.has(s[0]))) return false;
  if (two && s.length < 3) return false;
  return !NOT_NAME_END.test(s);
}

/** "홍길동" → "홍○○" */
export function maskName(s: string): string {
  return s[0] + '○'.repeat(Math.max(1, s.length - 1));
}

const isLabel = (cell: string) => LABELS.includes(squash(cell).replace(/[:：]/g, ''));

export interface NameHit { index: number; length: number; masked: string }

/** 표 칸 하나의 글 자리를 찾아 가린 자리 목록 */
function tableHits(text: string): NameHit[] {
  const out: NameHit[] = [];
  // HTML 표
  for (const t of text.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const tbl = t[0];
    const base = t.index!;
    const cells = [...tbl.matchAll(/(<t[hd][^>]*>)([\s\S]*?)(<\/t[hd]>)/gi)].map((m) => ({ open: m[1], inner: m[2], at: base + m.index! + m[1].length, head: /^<th/i.test(m[1]) }));
    if (!cells.some((c) => isLabel(c.inner.replace(/<[^>]+>/g, '')))) continue;
    cells.forEach((c, i) => {
      const plain = c.inner.replace(/<br\s*\/?>/gi, '').replace(/<[^>]+>/g, '').trim();
      const prevLabel = i > 0 && isLabel(cells[i - 1].inner.replace(/<[^>]+>/g, ''));
      // 머리 칸(th)과 칸 이름(예금주·성명 …)은 사람이 아니다
      if (c.head || isLabel(plain)) return;
      if (!plain || (!looksLikeName(plain) && !(prevLabel && /^[가-힣]{2,4}$/.test(squash(plain)) && !NOT_NAME.has(squash(plain))))) return;
      const k = c.inner.indexOf(plain);
      if (k >= 0) out.push({ index: c.at + k, length: plain.length, masked: maskName(plain) });
    });
  }
  // "| 칸 | 칸 |" 표 (연속 줄 묶음)
  const lines = text.split('\n');
  let pos = 0;
  let block: Array<{ line: string; at: number }> = [];
  const flush = () => {
    if (block.length && block.some((b) => b.line.split('|').some(isLabel))) {
      for (const b of block) {
        let off = 0;
        const parts = b.line.split('|');
        parts.forEach((p, i) => {
          const plain = p.trim();
          const prevLabel = i > 0 && isLabel(parts[i - 1]);
          if (plain && !isLabel(plain) && (looksLikeName(plain) || (prevLabel && /^[가-힣]{2,4}$/.test(plain) && !NOT_NAME.has(plain)))) {
            out.push({ index: b.at + off + p.indexOf(plain), length: plain.length, masked: maskName(plain) });
          }
          off += p.length + 1;
        });
      }
    }
    block = [];
  };
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('|') && t.endsWith('|')) block.push({ line, at: pos });
    else flush();
    pos += line.length + 1;
  }
  flush();
  return out;
}

/** 이름 칸 이름표 뒤의 이름. 쌍점은 없어도 되고(OCR 글 "성명 홍길동"), 글자 사이가 띄어져도 된다("성 명: 홍 길 동") */
const LABEL_RE = new RegExp(`(${LABELS.map((l) => l.split('').join('[ \\t]?')).join('|')})[ \\t]*([:：])?[ \\t]*([가-힣](?:[ \\t]?[가-힣]){1,3})(?![가-힣])`, 'g');
/** 쌍점 없이 이름이 바로 오는 칸 (OCR 서식 "성명 홍길동"). 신청인·청구인 등은 문장에서 "청구인 주소는"처럼 낱말이 이어 와서 뺀다 */
const BARE_LABELS = new Set(['성명', '이름']);
const NAME_POS = new RegExp(`(?<![가-힣])([가-힣]{2,4})\\s*(?:\\(\\s*)?(?:${POSITIONS})(?![가-힣])`, 'g');
const POS_NAME = new RegExp(`(?<![가-힣])(?:${POSITIONS})\\s+([가-힣]{2,4})(?![가-힣])`, 'g');
/** 이름 바로 뒤에 "(○○은행)" 같은 금융기관이 오는 꼴 (원인행위서 수령 정보 칸: "이름 (은행) 계좌 금액") */
/** 서명·결재가 드는 줄 (그 줄의 이름 꼴 낱말은 사람으로 본다) */
const SIGN_LINE = /(결재|발의자|기안자|검사자|검수자|신청인|품의자|담당자|확인자|협조자)/;
const NAME_BANK = /(?<![가-힣])([가-힣]{2,4})\s*\(\s*[가-힣A-Za-z]{0,12}(?:은행|금고|우체국|조합|뱅크|증권|저축)\s*\)/g;

/** 글 줄의 이름 (이름 칸 뒤, 직위와 붙은 이름) */
function inlineHits(text: string): NameHit[] {
  const out: NameHit[] = [];
  const push = (m: RegExpMatchArray, group = 1, loose = false) => {
    let name = m[group];
    // 조사가 붙은 이름("최바다가 확인함")은 조사를 남긴다
    if (name.length >= 3 && /[이가은는을를의와과께]$/.test(name) && looksLikeName(name.slice(0, -1))) name = name.slice(0, -1);
    if (SERIES.has(name)) return;
    const ok = loose ? !NOT_NAME.has(name) && !NOT_NAME_END.test(name) : looksLikeName(name);
    if (!ok) return;
    const index = m.index! + m[0].indexOf(name);
    out.push({ index, length: name.length, masked: maskName(name) });
  };
  for (const m of text.matchAll(LABEL_RE)) {
    const spaced = m[3];
    const name = spaced.replace(/\s/g, '');
    // 쌍점 뒤는 칸 값: OCR 이 이름 일부만 읽어도("이세") 가린다. 행정 낱말·칸 이름만 뺀다.
    // 쌍점이 없으면 "성명·이름" 칸에서 이름 꼴일 때만 (머리 줄 "성명 출장내용"은 둔다)
    const ok = m[2]
      ? !NOT_NAME.has(name) && !isLabel(name) && !/(과|팀|처|실|국|청|센터|학교|대학)$/.test(name)
      : BARE_LABELS.has(m[1].replace(/\s/g, '')) && looksLikeName(name) && !isLabel(name);
    if (!ok || SERIES.has(name)) continue;
    let k = 0;
    const masked = spaced.replace(/[가-힣]/g, (c) => (k++ === 0 ? c : '○'));
    out.push({ index: m.index! + m[0].lastIndexOf(spaced), length: spaced.length, masked });
  }
  for (const m of text.matchAll(NAME_POS)) push(m);
  for (const m of text.matchAll(POS_NAME)) push(m);
  for (const m of text.matchAll(NAME_BANK)) push(m, 1, true);
  // 결재란·발의자·검사자 줄 (OCR 글은 표가 줄로 풀려 "결 재 홍길동 김가온 2026.11.04." 꼴이 된다): 그 줄의 이름 꼴 낱말
  let at = 0;
  /** 서명 칸 머리 줄 뒤로 몇 줄까지 값 줄로 볼지 (OCR 은 머리 줄과 값 줄 사이에 ":" 같은 조각 줄이 낀다) */
  let after = 0;
  for (const line of text.split('\n')) {
    const sign = SIGN_LINE.test(line.replace(/\s/g, ''));
    // 머리 줄("… 발의자 지급구분") 다음 한두 줄에 값("2026-10-06 가온지원과 홍길동 일시불")이 온다
    if (sign || after > 0) {
      for (const m of line.matchAll(/(?<![가-힣])[가-힣]{2,4}(?![가-힣])/g)) {
        const name = m[0];
        if (!looksLikeName(name) || isLabel(name) || SERIES.has(name)) continue;
        out.push({ index: at + m.index!, length: name.length, masked: maskName(name) });
      }
    }
    after = sign ? 2 : after - 1;
    at += line.length + 1;
  }
  return out;
}

/** 이름을 가린 글과 가린 자리 */
export function maskNames(text: string): { text: string; hits: NameHit[] } {
  const all = [...tableHits(text), ...inlineHits(text)].sort((a, b) => a.index - b.index);
  const hits: NameHit[] = [];
  for (const h of all) if (!hits.some((x) => h.index < x.index + x.length && x.index < h.index + h.length)) hits.push(h);
  let out = text;
  for (const h of [...hits].reverse()) out = out.slice(0, h.index) + h.masked + out.slice(h.index + h.length);
  return { text: out, hits };
}
