/** 집행 전 점검표의 필요 서류 기본값 (순수 데이터, 화면 설정에서도 쓴다)
 *
 * 일반적인 공공기관 지출 관행을 가정한 **추정**이다. 기관의 실제 지출 규정과 다를 수 있어
 * 설정 › 예산과 회계의 "필요 서류"에서 기관 기준으로 고친다. 집행 전 검토라서 영수증처럼 지급 뒤에 생기는 서류는 기본에 넣지 않는다.
 */

import type { BudgetBundleKind } from '../../types/rpc-contract.js';

/** 필요 서류로 고를 수 있는 종류 (기타·품의서·계획서는 갈래마다 달라 뺀다. 영수증 요구는 거래명세서·세금계산서도 채운다) */
export const REQUIRED_DOC_KINDS = ['letter', 'quote', 'receipt', 'bank', 'claim', 'inspection'] as const satisfies readonly BudgetBundleKind[];

export const REQUIRED_DOC_LABEL: Record<(typeof REQUIRED_DOC_KINDS)[number], string> = {
  letter: '공문', quote: '견적서', receipt: '영수증', bank: '계좌 사본', claim: '여비 정산 신청서', inspection: '검사·검수서',
};

/** 거래 성격별 기본 필요 서류 (정본). 성격을 모르거나 목록에 없으면 공문만 본다 */
export const DEFAULT_REQUIRED_DOCS: Readonly<Record<string, readonly BudgetBundleKind[]>> = {
  임차: ['letter', 'quote', 'bank'],
  구입: ['letter', 'quote', 'bank'],
  여비: ['letter'],
  수당: ['letter', 'bank'],
  회의: ['letter'],
  용역: ['letter', 'quote', 'bank'],
  행사: ['letter', 'quote', 'bank'],
  인쇄: ['letter', 'quote', 'bank'],
  장학: ['letter', 'bank'],
  수선: ['letter', 'quote', 'bank'],
};

/** 성격을 모르거나 목록에 없을 때 최소로 보는 서류 */
export const GENERIC_REQUIRED_DOCS: readonly BudgetBundleKind[] = ['letter'];

export const defaultDocsOf = (nature: string | undefined): BudgetBundleKind[] => [...((nature && DEFAULT_REQUIRED_DOCS[nature]) || GENERIC_REQUIRED_DOCS)];
