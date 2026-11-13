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
const NOT_NAME = new Set(['합계', '소계', '총계', '공무', '관외', '관내', '일시불', '해당', '없음', '해당없음', '이하', '기타', '구분', '금액', '일비', '식비', '운임', '숙박비', '성명', '직급', '부서', '비고', '정산', '지급', '은행', '우체국', '국내', '국외', '출장', '연수', '회의', '교육', '행사', '신청', '승인', '완료', '예정', '진행', '결재', '기안', '검토', '협조', '전결', '대결', '시행', '접수', '공개', '비공개', '정상', '미정', '아니오', '예', '현금', '계좌', '이체', '카드', '전액', '일부', '부가세', '공급가', '수수료', '공제액', '실지급액', '거래처', '상호', '사업자', '주소', '연락처', '전화', '서명', '날인', '인', '직인', '확인', '담당', '주무관', '팀장', '과장', '국장', '처장', '원장', '총장', '교수', '연구원', '강사', '조교', '교사', '대리', '주임', '선생', '위원', '이사', '대표', '도민', '시민', '구민', '학생', '교원', '직원', '전체', '본인', '가족', '배우자', '자녀', '부모', '상동', '동일', '유효', '무효', '주간', '야간', '오전', '오후', '정오', '자정', '당일', '익일', '전일', '도착', '출발', '왕복', '편도']);
/** 이렇게 끝나면 이름이 아니다 (기관·장소·돈) */
const NOT_NAME_END = /(과|팀|처|실|국|청|소|센터|학교|대학|위원회|은행|도|시|군|구|읍|면|리|역|관|비|료|액|세|권|증|서|표|부서|사업|지원|예산|회계|방법|일자|번호|내용|사유|기간|장소|목적|구분|여부|계획|결과|현황|명세|내역|조건|방식|기준|단위|분류|종류|형태|상태|요청|신청|승인|자료|서류|일시|지불|지급|계약|금액|합계)$/;
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

const LABEL_RE = new RegExp(`(?:${LABELS.join('|')})\\s*[:：]\\s*([가-힣]{2,4})(?![가-힣])`, 'g');
const NAME_POS = new RegExp(`(?<![가-힣])([가-힣]{2,4})\\s*(?:\\(\\s*)?(?:${POSITIONS})(?![가-힣])`, 'g');
const POS_NAME = new RegExp(`(?<![가-힣])(?:${POSITIONS})\\s+([가-힣]{2,4})(?![가-힣])`, 'g');

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
  for (const m of text.matchAll(LABEL_RE)) push(m, 1, true);
  for (const m of text.matchAll(NAME_POS)) push(m);
  for (const m of text.matchAll(POS_NAME)) push(m);
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
