/** 원인행위서·지출결의서 읽기 (순수 함수) — 회계 시스템이 내는 결의 문서는 칸이 정해져 있어 공문보다 정확히 읽는다
 *
 * 실제 표본(한솔 전자결재 HWX 속 HWP "원인행위서 + 여비명세서")의 칸 이름으로 맞췄다:
 * 머리 "YYYY회계연도 기관 회계" · 결의번호 · 건명 · 금액(숫자·한글) · 예산 표(예산부서·계정구분·재원구분·세부사업·예산과목·금액).
 * 사람 이름·계좌가 든 명세서 표(여비명세서 등)는 읽지 않는다.
 */

export interface VoucherLine {
  dept?: string;
  /** 계정구분 (예: 자체수입) */
  ledger?: string;
  /** 재원구분 (예: 지원금(보조금)) */
  source?: string;
  detail: string;
  subject: string;
  amount: number;
}

export interface Voucher {
  /** 원인행위서 · 지출결의서 · 결의서 */
  kind: string;
  fiscal_year?: number;
  resolution_no?: string;
  /** 건명 */
  title?: string;
  /** 발의일자 YYYY-MM-DD */
  date?: string;
  dept?: string;
  total?: number;
  lines: VoucherLine[];
  /** 적요 칸 글 */
  memo?: string;
  /** 적요의 "관련: 문서번호(날짜)" */
  related?: string;
  /** 여비명세서 합계 (있으면) */
  travel_total?: number;
  /** 칸끼리 맞춰 본 결과 (금액·적요·명세서) */
  checks: Array<{ label: string; ok: boolean; detail: string }>;
  /** 거래처 상호·사업자번호 (거래처 칸이 비면 없음) */
  vendor?: string;
  vendor_no?: string;
  /** 일반명세서 등 품명·금액 명세 합계 (여비명세서 제외) */
  detail_total?: number;
}

const KIND = /(지출\s*원인\s*행위서|원인\s*행위서|지출\s*결의서|수입\s*결의서|결의서)/;

/** 마크다운 속 표 → 줄마다 칸 글. 병합 칸이 있는 표는 HTML(<table>), 단순한 표는 "| 칸 | 칸 |" 줄로 나온다 */
export function htmlTables(md: string): string[][][] {
  const clean = (c: string) => c.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\\([\[\]_*|])/g, '$1').replace(/\s+/g, ' ').trim();
  const html = (md.match(/<table[\s\S]*?<\/table>/gi) ?? []).map((t) => (t.match(/<tr[\s\S]*?<\/tr>/gi) ?? [])
    .map((tr) => (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map(clean)));
  const pipe: string[][][] = [];
  let cur: string[][] = [];
  for (const line of md.replace(/<table[\s\S]*?<\/table>/gi, '').split('\n')) {
    const t = line.trim();
    if (t.startsWith('|') && t.endsWith('|')) {
      if (/^\|(\s*:?-{2,}:?\s*\|)+$/.test(t)) continue;
      cur.push(t.slice(1, -1).split(/(?<!\\)\|/).map(clean));
    } else if (cur.length) { pipe.push(cur); cur = []; }
  }
  if (cur.length) pipe.push(cur);
  return [...html, ...pipe];
}

const squash = (s: string) => s.replace(/\s/g, '');
const money = (s: string | undefined) => {
  const m = (s ?? '').match(/-?\d{1,3}(?:,\d{3})+|-?\d+/);
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
};

/** 칸 이름 다음 칸의 글 (같은 줄) */
function after(tables: string[][][], label: RegExp): string | undefined {
  for (const t of tables) for (const row of t) {
    const i = row.findIndex((c) => label.test(squash(c)));
    if (i >= 0 && row[i + 1]) return row[i + 1];
  }
  return undefined;
}

export function extractVoucher(md: string): Voucher | null {
  const head = md.slice(0, 3000);
  const k = head.match(KIND);
  if (!k) return null;
  const tables = htmlTables(md);
  const lines: VoucherLine[] = [];
  for (const t of tables) {
    const hi = t.findIndex((row) => row.some((c) => squash(c) === '예산과목') && row.some((c) => squash(c) === '금액'));
    if (hi < 0) continue;
    const h = t[hi].map(squash);
    const col = (name: string) => h.indexOf(name);
    const [cDept, cLedger, cSource, cDetail, cSubject, cAmount] = ['예산부서', '계정구분', '재원구분', '세부사업', '예산과목', '금액'].map(col);
    for (const row of t.slice(hi + 1)) {
      // 합계 줄(칸이 합쳐져 칸 수가 모자람)은 뺀다
      if (row.length < h.length || /^합계$/.test(squash(row[0] ?? ''))) continue;
      const amount = money(row[cAmount]);
      if (!Number.isFinite(amount)) continue;
      lines.push({
        ...(cDept >= 0 && row[cDept] ? { dept: row[cDept] } : {}),
        ...(cLedger >= 0 && row[cLedger] ? { ledger: row[cLedger] } : {}),
        ...(cSource >= 0 && row[cSource] ? { source: row[cSource] } : {}),
        detail: cDetail >= 0 ? row[cDetail] ?? '' : '',
        subject: row[cSubject] ?? '',
        amount,
      });
    }
  }
  const title = after(tables, /^건명$/);
  const totalCell = after(tables, /^금액$/);
  const fy = head.match(/(\d{4})\s*회계\s*연도/);
  const no = md.match(/결의\s*번호\s*[:：]\s*([A-Za-z0-9-]+)/);
  const dept = md.match(/예산\s*부서\s*[:：]\s*([^\s:：]+)/);
  const date = md.match(/발의\s*일자[\s\S]{0,600}?(\d{4}-\d{2}-\d{2})/);
  const sum = lines.reduce((n, l) => n + l.amount, 0);
  const total = Number.isFinite(money(totalCell)) && money(totalCell) > 0 ? money(totalCell) : sum || undefined;
  // 결의서 낱말만 있고 칸이 하나도 없으면 결의서로 보지 않는다 (공문 본문에 "지출결의서를 제출" 같은 말)
  if (!lines.length && !title) return null;
  const memo = after(tables, /^적요$/);
  const related = memo?.match(/관련\s*[:：]\s*([^\s,]+?-\d+\s*\(\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*\))/)?.[1]?.replace(/\s+/g, '');
  // 적요의 금액: "지급금액: 금68,900원" · "지출금액: 금 300,000원 이내" (이내면 상한)
  const mm = memo?.match(/(지급|지출|집행|구매|계약)\s*금액\s*[:：]\s*금?\s*([\d,]+)\s*원\s*(이내)?/);
  const memoAmount = money(mm?.[2]);
  const memoCap = !!mm?.[3];
  const travel = travelTotal(tables);
  const detailTotal = itemListTotal(tables);
  const vendor = after(tables, /^상호$/);
  const vendorNo = after(tables, /^사업자번호/);
  const checks: Voucher['checks'] = [];
  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
  if (total && lines.length) checks.push({ label: '금액 칸 = 예산 줄 합계', ok: total === sum, detail: `${won(total)} / ${won(sum)}` });
  if (total && Number.isFinite(memoAmount)) {
    checks.push(memoCap
      ? { label: `금액 칸 ≤ 적요의 ${mm![1]}금액(이내)`, ok: total <= memoAmount, detail: `${won(total)} / ${won(memoAmount)} 이내` }
      : { label: `금액 칸 = 적요의 ${mm![1]}금액`, ok: total === memoAmount, detail: `${won(total)} / ${won(memoAmount)}` });
  }
  if (total && detailTotal !== undefined) checks.push({ label: '금액 칸 = 명세서 합계', ok: total === detailTotal, detail: `${won(total)} / ${won(detailTotal)}` });
  if (total && travel !== undefined) checks.push({ label: '금액 칸 = 여비명세서 합계', ok: total === travel, detail: `${won(total)} / ${won(travel)}` });
  return {
    kind: squash(k[1]),
    ...(fy ? { fiscal_year: Number(fy[1]) } : {}),
    ...(no ? { resolution_no: no[1] } : {}),
    ...(title ? { title } : {}),
    ...(date ? { date: date[1] } : {}),
    ...(dept ? { dept: dept[1] } : {}),
    ...(total ? { total } : {}),
    lines,
    ...(memo ? { memo } : {}),
    ...(related ? { related } : {}),
    ...(travel !== undefined ? { travel_total: travel } : {}),
    ...(detailTotal !== undefined ? { detail_total: detailTotal } : {}),
    ...(vendor ? { vendor } : {}),
    ...(vendorNo && /\d/.test(vendorNo) ? { vendor_no: vendorNo } : {}),
    checks,
  };
}

/** 품명·금액 명세 표(일반명세서 등: "품명" 칸과 "금액" 칸이 있는 표)의 합계 줄 금액 */
function itemListTotal(tables: string[][][]): number | undefined {
  for (const t of tables) {
    const hi = t.findIndex((row) => row.some((c) => /^품명/.test(squash(c))) && row.some((c) => squash(c) === '금액'));
    if (hi < 0) continue;
    const sumRow = t.slice(hi + 1).find((row) => /^합계$/.test(squash(row[0] ?? '')));
    const v = money(sumRow?.[sumRow.length - 1]);
    if (Number.isFinite(v)) return v;
  }
  return undefined;
}

/** 여비명세서 표(일비·식비 칸이 있는 표)의 합계 줄 금액 */
function travelTotal(tables: string[][][]): number | undefined {
  for (const t of tables) {
    if (!t.some((row) => row.some((c) => /^일비/.test(squash(c))) && row.some((c) => /^식비/.test(squash(c))))) continue;
    const sumRow = t.find((row) => /^합계$/.test(squash(row[0] ?? '')));
    const v = money(sumRow?.[sumRow.length - 1]);
    if (Number.isFinite(v)) return v;
  }
  return undefined;
}
