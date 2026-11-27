/** 지출 서류 묶음 — 서류 종류 가르기·계좌 가리기 (순수 함수, 화면 모의에서도 쓴다)
 *
 * 공문·계획서·영수증·견적서·거래명세서·세금계산서·계좌 사본 등을 쪽(또는 파일) 글로 가른다.
 * 스캔 증빙 종류는 증빙 대조(evidence.ts)의 실측 규칙을 그대로 쓰고, 계좌 사본·계획서·세금계산서만 여기서 더한다.
 * 계좌 사본의 은행·계좌번호·예금주는 "지급할 곳"으로 화면에 그대로 보인다(이 PC 안에서만, 외부 AI 로 보내지 않음).
 * 사업자번호·전화와 헷갈리지 않게 계좌 말이 있는 줄에서만 계좌번호를 찾는다.
 */

import type { BudgetBundleKind } from '../../types/rpc-contract.js';
import { classify, type EvidenceKind } from './evidence.js';

export const BUNDLE_LABEL: Record<BudgetBundleKind, string> = {
  letter: '공문', plan: '계획서', receipt: '영수증', quote: '견적서', invoice: '거래명세서·세금계산서', bank: '계좌 사본',
  request: '품의서·신청서', claim: '여비 정산 신청서', inspection: '검사·검수서', other: '기타',
};

const squash = (s: string) => s.replace(/\s/g, '');

const BANKS = ['카카오뱅크', '토스뱅크', '케이뱅크', '국민', 'KB', '신한', '우리', '하나', 'KEB', '농협', 'NH', '기업', 'IBK', '제일', 'SC', '씨티', '우체국', '새마을', '신협', '수협', '산업', '대구', 'iM', '부산', '경남', '광주', '전북', '제주'];
const BANK_RE = new RegExp(`(${BANKS.join('|')})(은행|뱅크)?`);

/** 계좌번호 꼴: 숫자 묶음 3~4개를 붙임표로 (날짜·전화와 겹치지 않게 계좌 말이 있는 줄에서만 쓴다) */
const ACCOUNT_RE = /(?<!\d)\d{2,6}(?:-\d{2,8}){2,3}(?!\d)|(?<![\d-])\d{10,14}(?![\d-])/g;
const ACCOUNT_LINE = /계좌|예금주|입금|통장|은행|뱅크/;

/** 계좌 사본·입금 계좌 정보: 은행, 계좌번호, 예금주 (지급할 곳) */
export function bankInfo(lines: string[]): { bank?: string; account?: string; holder?: string } {
  const acct = lines.filter((l) => ACCOUNT_LINE.test(l)).flatMap((l) => l.match(ACCOUNT_RE) ?? [])[0];
  const bank = lines.map((l) => l.match(BANK_RE)).find(Boolean);
  // "예금주: 가온상사" · "예금주 가온상사" (같은 줄 뒤 글, 없으면 다음 줄)
  const at = lines.findIndex((l) => /예\s*금\s*주/.test(l));
  const after = at >= 0 ? lines[at].replace(/^.*?예\s*금\s*주\s*(명)?\s*[:：]?\s*/, '').trim() || (lines[at + 1] ?? '').trim() : '';
  const holder = after.split(/\s{2,}|\s*(?:계좌|은행|번호)/)[0].trim().slice(0, 40);
  return {
    ...(bank ? { bank: bank[2] ? bank[0] : `${bank[1]}은행` } : {}),
    ...(acct ? { account: acct } : {}),
    ...(holder ? { holder } : {}),
  };
}

const FROM_EVIDENCE: Record<EvidenceKind, BudgetBundleKind> = {
  notice: 'letter', card_receipt: 'receipt', ticket: 'receipt', quote: 'quote', item_list: 'invoice', purchase_request: 'request',
  trip_request: 'request', travel_claim: 'claim', inspection: 'inspection', photo: 'other', other: 'other',
};

/** 쪽(또는 파일) 글 → 서류 종류 */
export function classifyDoc(lines: string[]): BudgetBundleKind {
  const t = squash(lines.join('\n'));
  // 계좌 사본: "통장 사본"이라 적혔거나, 공문 꼴(수신·제목)이 아니면서 예금주·계좌 말이 있는 짧은 쪽 (공문 안의 "입금 계좌" 한 줄은 공문으로)
  const letterLike = /수신/.test(t) && /제목/.test(t);
  if (/통장사본|계좌사본|통장표지/.test(t) && t.length < 1500) return 'bank';
  if (!letterLike && t.includes('예금주') && /계좌/.test(t) && t.length < 800) return 'bank';
  if (/전자세금계산서|세금계산서|거래명세서|거래명세표/.test(t)) return 'invoice';
  const ev = FROM_EVIDENCE[classify(lines)];
  if (ev !== 'other') return ev;
  if (/(추진|운영|시행|개최|사업)?계획\(?안?\)?/.test(t.slice(0, 200)) && /(목적|개요|추진)/.test(t)) return 'plan';
  // 글자층 공문(HWP·HWPX): 수신·제목 줄 또는 "관련" 항목과 "끝."
  if (/수신/.test(t) && /제목/.test(t)) return 'letter';
  if (/^1\.관련/m.test(lines.map(squash).join('\n')) || (/끝\.$/.test(t) && /\d\.\S/.test(t))) return 'letter';
  return 'other';
}
