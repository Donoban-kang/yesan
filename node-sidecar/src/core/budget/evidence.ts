/** 증빙 자동 대조 — 스캔 증빙(PDF·그림)을 쪽마다 OCR 로 읽어 서류 종류를 가르고, 칸 이름으로 값을 뽑아 결의서와 맞춰 본다
 *
 * 서류 종류와 칸 이름은 실제 증빙 묶음 2건(여비: 정산 신청서·승차권 영수증·출장 신청서·안내 공문,
 * 물품: 검사·검수서·사진·카드 영수증·일반지출품의서·일반명세서·견적서, 2026-11-13 확인)의 OCR 줄에서 정했다.
 * 원본 영수증 판독기(core/receipt)는 영수증 한 장용이라 검수서 수량·카드 단말기 번호를 금액으로 고르는 일이 있어, 종류별 칸을 먼저 본다.
 * 값은 이 PC 안에서만 다루고 결과에 사람 이름은 넣지 않는다.
 */

import { readFile } from 'node:fs/promises';
import type { OcrPageLines } from 'kordoc';
import { parseBytes } from '../converter/index.js';
import { parseFailure } from '../errors.js';
import { formatOf } from '../files/format.js';
import { linesFromMarkdown, linesFromOcr } from '../receipt/parse.js';
import { ocrModelsReady } from '../system/index.js';

import type { BudgetEvidencePage, BudgetVoucherFacts } from '../../types/rpc-contract.js';

export type EvidenceKind = BudgetEvidencePage['kind'];

export const KIND_LABEL: Record<EvidenceKind, string> = {
  travel_claim: '여비 정산 신청서', ticket: '교통비 영수증', trip_request: '출장 신청서', notice: '관련 공문',
  quote: '견적서', purchase_request: '지출 품의서', item_list: '명세서', card_receipt: '카드 영수증', inspection: '검사·검수서', photo: '사진', other: '기타',
};

export type EvidencePage = BudgetEvidencePage;

export interface EvidenceCheck { label: string; ok: boolean; detail: string }

export type VoucherFacts = BudgetVoucherFacts;

const squash = (s: string) => s.replace(/\s/g, '');

/** "272. 728원" "300,000" "18.900" → 수 */
export function numOf(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/\d{1,3}(?:\s?[,.]\s?\d{3})+|\d+/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/[\s,.]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** 줄의 마지막 금액 꼴 수 (천 단위 쉼표가 있는 것) */
function lastMoney(line: string): number | undefined {
  const all = line.match(/\d{1,3}(?:\s?[,.]\s?\d{3})+/g);
  return all?.length ? numOf(all[all.length - 1]) : undefined;
}

export function dateOf(s: string): string | undefined {
  const m = s.match(/(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 사업자 등록번호: "000-00-00000" "0000000000" (주민번호 꼴 6-7 은 아니다) */
export function brnOf(s: string): string | undefined {
  const m = s.match(/(?<!\d)(\d{3})\s?-?\s?(\d{2})\s?-?\s?(\d{5})(?!\d)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** 쪽 글 → 서류 종류 (앞 것이 우선: 견적서 안에 "합계"가 있어도 견적서) */
export function classify(lines: string[]): EvidenceKind {
  const t = squash(lines.join('\n'));
  if (t.includes('견적서') && /견적/.test(t)) return 'quote';
  if (/검사[·.ㆍ]?검수서|검수서/.test(t)) return 'inspection';
  if (t.includes('여비정산신청서') || (t.includes('일비정산금') && t.includes('식비'))) return 'travel_claim';
  if (/지출품의서|품의서/.test(t) && !t.includes('원인행위서')) return 'purchase_request';
  if (/일반명세서|품명및규격/.test(t)) return 'item_list';
  if (t.includes('출장신청서')) return 'trip_request';
  if (/승차권|영수증첨부철|승인금액/.test(t)) return 'ticket';
  if (/승인번호/.test(t) && /(합계|합\d|거래금액|부가세)/.test(t)) return 'card_receipt';
  if (/수신/.test(t) && /(제목|시행)/.test(t)) return 'notice';
  if (t.includes('사진') && (t.match(/\d/g)?.length ?? 0) < 15) return 'photo';
  return 'other';
}

const find = (lines: string[], re: RegExp) => lines.find((l) => re.test(squash(l)));

export function extractPage(page: number, lines: string[]): EvidencePage {
  const kind = classify(lines);
  const p: EvidencePage = { page, kind, label: KIND_LABEL[kind] };
  const text = lines.join('\n');
  const firstDate = () => lines.map(dateOf).find(Boolean);
  switch (kind) {
    case 'travel_claim': {
      p.amount = lastMoney(find(lines, /^합계/) ?? '');
      // 운임 줄: 날짜와 교통편이 있고 금액으로 끝나는 줄
      const fare = lines.find((l) => /20\d{2}-\d{2}-\d{2}/.test(l) && /(버스|열차|KTX|SRT|항공|선박|택시|자가용|철도)/.test(l));
      p.fare = fare ? lastMoney(fare) : undefined;
      p.date = dateOf(find(lines, /신청합|^20\d{2}년\d{1,2}월\d{1,2}일$/) ?? '') ?? lines.map(dateOf).filter(Boolean).pop();
      break;
    }
    case 'ticket': {
      p.amount = numOf(find(lines, /^승인금액/)?.split(/[:：]/).pop()) ?? lastMoney(find(lines, /^금액/) ?? '');
      p.brn = brnOf(find(lines, /사업자번호/) ?? '');
      p.date = dateOf(find(lines, /^출발일|^일시/) ?? '') ?? firstDate();
      break;
    }
    case 'card_receipt': {
      // "합 300,000원" · "합계: 300,000원" (단말기 번호·카드번호는 금액이 아니다)
      const sum = lines.find((l) => /^합\s*(계)?\s*[:：]?\s*\d/.test(l.trim()) || /합\s*계\s*[:：]/.test(l));
      p.amount = sum ? lastMoney(sum) ?? numOf(sum.replace(/^[^\d]*/, '')) : undefined;
      p.brn = brnOf(text);
      p.date = firstDate();
      break;
    }
    case 'quote': {
      const w = text.match(/[W₩]\s*([\d,]+)/);
      p.amount = numOf(w?.[1]);
      p.brn = brnOf(find(lines, /등록번호/) ?? '') ?? brnOf(text);
      p.date = firstDate();
      // 끝 줄 "수량합 공급가 세액 합계": 넷째 수가 합계와 같으면 첫째 수가 수량
      for (const l of lines) {
        const nums = l.trim().split(/\s+/).map(numOf);
        if (nums.length === 4 && nums.every((n) => n !== undefined) && nums[3] === p.amount) p.qty = nums[0];
      }
      break;
    }
    case 'purchase_request': {
      p.amount = lastMoney(find(lines, /^합계/) ?? '') ?? lastMoney(find(lines, /품의/) ?? '');
      p.brn = brnOf(text.replace(/\d{8}BD\w+/g, ''));
      p.date = dateOf(text.slice(text.search(/발의\s*일자/))) ?? firstDate();
      p.count = numOf(text.match(/(\d+)\s*개\s*물/)?.[1]);
      p.doc_no = text.match(/문서\s*번호\s*[:：]\s*([가-힣]+-\d+)/)?.[1];
      break;
    }
    case 'item_list':
      p.amount = lastMoney(find(lines, /^합계/) ?? '');
      break;
    case 'inspection': {
      const sum = find(lines, /^계\d/);
      p.qty = numOf(sum?.replace(/^\s*계/, ''));
      p.date = firstDate();
      break;
    }
    case 'trip_request':
      p.doc_no = text.match(/시행\s*([가-힣]+-\d+)/)?.[1];
      p.date = dateOf(text.match(/결\s*재[\s\S]{0,60}?(20\d{2}\.\s*\d{1,2}\.\s*\d{1,2})/)?.[1] ?? '') ?? firstDate();
      break;
    case 'notice':
      p.doc_no = text.match(/시행\s*([가-힣]+-\d+)/)?.[1];
      p.date = firstDate();
      break;
    default:
      break;
  }
  for (const k of Object.keys(p) as Array<keyof EvidencePage>) if (p[k] === undefined) delete p[k];
  return p;
}

/** 갈래마다 있어야 할 서류 (실제 묶음 기준, 기관 규정이 우선) */
const NEEDED: Record<'travel' | 'purchase', EvidenceKind[]> = {
  travel: ['travel_claim', 'ticket', 'trip_request'],
  purchase: ['quote', 'purchase_request', 'card_receipt', 'inspection'],
};

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const digits = (s?: string) => (s ?? '').replace(/[^\d]/g, '');

export function compareEvidence(pages: EvidencePage[], v: VoucherFacts): { checks: EvidenceCheck[]; missing: string[] } {
  const checks: EvidenceCheck[] = [];
  const first = (k: EvidenceKind) => pages.find((p) => p.kind === k);
  // 금액: 정산서·견적서·품의서·명세서·카드 영수증 합계 = 결의 금액
  if (v.amount) {
    for (const k of ['travel_claim', 'quote', 'purchase_request', 'item_list', 'card_receipt'] as EvidenceKind[]) {
      const p = first(k);
      if (p?.amount !== undefined) checks.push({ label: `${p.label}(${p.page}쪽) 금액 = 결의 금액`, ok: p.amount === v.amount, detail: `${won(p.amount)} / ${won(v.amount)}` });
    }
  }
  // 운임: 교통비 영수증 = 정산서 운임
  const claim = first('travel_claim');
  const tickets = pages.filter((p) => p.kind === 'ticket' && p.amount !== undefined);
  if (claim?.fare !== undefined && tickets.length) {
    const sum = tickets.reduce((n, p) => n + (p.amount ?? 0), 0);
    checks.push({ label: `교통비 영수증 합계 = 정산서 운임`, ok: sum === claim.fare, detail: `${won(sum)} / ${won(claim.fare)}` });
  }
  // 사업자번호: 견적서·카드 영수증 공급자 = 결의서 거래처 (결의서 번호가 가려졌으면 보이는 자리만)
  const vNo = digits(v.vendor_no);
  for (const k of ['quote', 'card_receipt', 'purchase_request'] as EvidenceKind[]) {
    const p = first(k);
    if (!p?.brn || !vNo) continue;
    const seen = digits(p.brn).slice(0, vNo.length);
    checks.push({ label: `${p.label}(${p.page}쪽) 사업자번호 = 결의서 거래처`, ok: seen === vNo, detail: `${p.brn} / ${v.vendor_no}` });
  }
  const quote = first('quote');
  const card = first('card_receipt');
  if (quote?.brn && card?.brn) checks.push({ label: '카드 영수증 가맹점 = 견적서 공급자', ok: quote.brn === card.brn, detail: `${card.brn} / ${quote.brn}` });
  // 수량·품목 수
  const insp = first('inspection');
  if (insp?.qty !== undefined && quote?.qty !== undefined) checks.push({ label: '검수 수량 = 견적 수량', ok: insp.qty === quote.qty, detail: `${insp.qty} / ${quote.qty}` });
  const memoCount = numOf(v.memo?.match(/(\d+)\s*개\s*물/)?.[1]);
  const req = first('purchase_request');
  if (req?.count !== undefined && memoCount !== undefined) checks.push({ label: '품의서 적요 품목 수 = 결의서 적요 품목 수', ok: req.count === memoCount, detail: `${req.count}개 / ${memoCount}개` });
  if (insp?.qty !== undefined && memoCount !== undefined) checks.push({ label: '검수 수량 = 결의서 적요 품목 수', ok: insp.qty === memoCount, detail: `${insp.qty} / ${memoCount}` });
  // 날짜 차례
  if (quote?.date && req?.date) checks.push({ label: '견적일이 품의 발의일보다 앞서거나 같음', ok: quote.date <= req.date, detail: `견적 ${quote.date} / 발의 ${req.date}` });
  if (card?.date && insp?.date) checks.push({ label: '검수일이 결제일보다 앞서지 않음', ok: insp.date >= card.date, detail: `검수 ${insp.date} / 결제 ${card.date}` });
  // 관련 문서: 출장 신청서 문서번호 = 결의서 적요 "관련"
  const trip = first('trip_request');
  if (trip?.doc_no && v.related) checks.push({ label: '출장 신청서 문서번호 = 결의서 적요 "관련"', ok: squash(v.related).startsWith(squash(trip.doc_no)), detail: `${trip.doc_no} / ${v.related}` });
  // 빠진 서류
  const kind = v.kind ?? (claim ? 'travel' : quote || req ? 'purchase' : undefined);
  const missing = kind && kind !== 'general' ? NEEDED[kind].filter((k) => !pages.some((p) => p.kind === k)).map((k) => KIND_LABEL[k]) : [];
  return { checks, missing };
}

/** 스캔 PDF·그림을 쪽마다 줄 글로 읽는다 (스캔 쪽은 OCR 줄 좌표로 한 줄씩, 글자층 쪽은 그대로). ocr = 글자 읽기 모델을 썼는가 */
export async function readPageLines(path: string, signal?: AbortSignal): Promise<{ pages: Array<{ page: number; lines: string[]; markdown: string }>; ocr: boolean }> {
  const fmt = formatOf(path);
  if (fmt !== 'pdf' && fmt !== 'image') throw new Error('스캔한 PDF나 그림(PNG·JPG) 파일로 넣으세요.');
  const ready = ocrModelsReady();
  const buf = await readFile(path);
  const r = await parseBytes(buf, { filePath: path, ocr: ready ? true : false, ocrLines: true, ...(fmt === 'pdf' ? { pages: '1-30' } : {}) }, undefined, signal);
  if (!r.success) throw parseFailure(r);
  const ocr = new Map<number, OcrPageLines>((r.ocrLines ?? []).map((p) => [p.pageNumber, p]));
  const pages = r.pages?.length ? r.pages : [{ pageNumber: 1, markdown: r.markdown }];
  return {
    ocr: ready,
    pages: pages.map((pg) => {
      const o = ocr.get(pg.pageNumber);
      const lines = (o && !o.regionsOnly ? linesFromOcr(o) : linesFromMarkdown(pg.markdown)).map((l) => l.text);
      return { page: pg.pageNumber, lines, markdown: o && !o.regionsOnly ? lines.join('\n') : pg.markdown };
    }),
  };
}

/** 증빙 파일을 쪽마다 읽는다 (스캔 쪽은 OCR, 글자층 쪽은 그대로) */
export async function readEvidence(path: string, signal?: AbortSignal): Promise<EvidencePage[]> {
  const fmt = formatOf(path);
  if (fmt !== 'pdf' && fmt !== 'image') throw new Error('증빙은 스캔한 PDF나 그림(PNG·JPG) 파일로 넣으세요.');
  const r = await readPageLines(path, signal);
  const out = r.pages.map((pg) => extractPage(pg.page, pg.lines));
  if (!r.ocr && out.every((p) => p.kind === 'other')) throw new Error('스캔한 증빙을 읽으려면 글자 읽기(OCR) 모델이 필요합니다. 설정 › 엔진과 모델에서 모델을 넣은 뒤 다시 하세요.');
  return out;
}
