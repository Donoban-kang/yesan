/** 지출 서류 묶음 읽기 (budget_bundle) — 지출할 공문, 영수증, 견적서, 거래명세서, 지급 대상 계좌 사본 등을 함께 넣으면
 *  파일(스캔 PDF 는 쪽)마다 서류 종류를 가르고 값을 뽑아, 중심 공문으로 금액·성격·과목 추천을 낸다.
 *  원인행위서·결의서 칸 읽기는 하지 않는다(집행 전 검토). 모든 값은 이 PC 안에서만 다룬다. */

import { basename } from 'node:path';
import type { BudgetBundle, BudgetBundleDoc, BudgetBundleKind } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { formatOf } from '../files/format.js';
import { analyzeDoc } from './index.js';
import { readBudgetDoc } from './read-doc.js';
import { extractPage, numOf, readPageLines, brnOf, dateOf } from './evidence.js';
import { BUNDLE_LABEL, bankInfo, classifyDoc } from './bundle-kinds.js';

/** 한 번에 넣는 파일 수 (스캔 PDF 는 파일마다 30쪽까지) */
export const MAX_BUNDLE_FILES = 20;

interface Unit { path: string; page?: number; lines: string[]; markdown: string; format: string; notes: string[]; ocr: boolean; kind: BudgetBundleKind }

const won = (n: number) => n.toLocaleString('ko-KR');

/** 영수증·견적·명세서의 합계 (증빙 대조 규칙 먼저, 없으면 합계·총액 줄의 마지막 금액) */
function amountOf(lines: string[], page: number): { amount?: number; date?: string; brn?: string } {
  const e = extractPage(page, lines);
  const sum = lines.filter((l) => /합\s*계|총\s*액|청구\s*금액|결제\s*금액|공급\s*대가/.test(l)).map((l) => l.match(/\d{1,3}(?:,\d{3})+/g)?.pop()).find(Boolean);
  const text = lines.join('\n');
  return {
    ...(e.amount ?? numOf(sum ?? undefined) ? { amount: e.amount ?? numOf(sum ?? undefined) } : {}),
    ...(e.date ?? lines.map(dateOf).find(Boolean) ? { date: e.date ?? lines.map(dateOf).find(Boolean) } : {}),
    ...(e.brn ?? brnOf(text) ? { brn: e.brn ?? brnOf(text) } : {}),
  };
}

async function readUnits(path: string, signal?: AbortSignal): Promise<Unit[]> {
  const fmt = formatOf(path);
  if (fmt === 'pdf' || fmt === 'image') {
    const r = await readPageLines(path, signal);
    const units: Unit[] = [];
    for (const pg of r.pages) {
      const kind = classifyDoc(pg.lines);
      const prev = units[units.length - 1];
      // 여러 쪽 공문·계획서의 뒤쪽(종류를 못 가른 쪽)은 앞 쪽에 붙인다
      if (kind === 'other' && prev && (prev.kind === 'letter' || prev.kind === 'plan')) {
        prev.lines.push(...pg.lines); prev.markdown += `\n\n${pg.markdown}`;
        continue;
      }
      units.push({ path, page: r.pages.length > 1 ? pg.page : undefined, lines: [...pg.lines], markdown: pg.markdown, format: fmt, notes: [], ocr: r.ocr && pg.lines.length > 0, kind });
    }
    return units;
  }
  const doc = await readBudgetDoc(path, signal);
  const lines = doc.markdown.split('\n').map((l) => l.replace(/[|#*]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [{ path, lines, markdown: doc.markdown, format: doc.format, notes: doc.notes, ocr: false, kind: classifyDoc(lines) }];
}

export async function budgetBundle(p: { paths: string[]; year?: number }, signal?: AbortSignal): Promise<BudgetBundle> {
  const paths = [...new Set(p.paths)];
  if (!paths.length) throw new Error('지출 서류를 하나 이상 넣으세요.');
  if (paths.length > MAX_BUNDLE_FILES) throw new Error(`한 번에 ${MAX_BUNDLE_FILES}개까지 넣을 수 있습니다. 나눠서 넣으세요.`);
  const units: Unit[] = [];
  const failed: BudgetBundle['failed'] = [];
  for (let i = 0; i < paths.length; i++) {
    signal?.throwIfAborted();
    sendProgress({ current: i, total: paths.length + 1, message: `${basename(paths[i])} 읽는 중` });
    try {
      units.push(...await readUnits(paths[i], signal));
    } catch (err) {
      if (signal?.aborted) throw err;
      failed.push({ path: paths[i], error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (!units.length) throw new Error(failed[0]?.error ?? '서류 글자를 읽지 못했습니다. 스캔 서류면 설정 › 엔진과 모델에서 글자 읽기 모델을 확인하세요.');

  sendProgress({ current: paths.length, total: paths.length + 1, message: '서류 종류·금액 찾는 중' });
  const docs: BudgetBundleDoc[] = units.map((u) => {
    const d: BudgetBundleDoc = { path: u.path, name: basename(u.path), ...(u.page ? { page: u.page } : {}), kind: u.kind, label: BUNDLE_LABEL[u.kind], ...(u.ocr ? { ocr: true } : {}) };
    if (u.kind === 'bank') Object.assign(d, bankInfo(u.lines));
    else if (['receipt', 'quote', 'invoice', 'claim', 'inspection'].includes(u.kind)) Object.assign(d, amountOf(u.lines, u.page ?? 1));
    return d;
  });

  // 중심 서류: 공문 → 계획서 → 품의서·신청서 → 계좌 사본이 아닌 첫 서류
  const main = (['letter', 'plan', 'request'] as const).map((k) => units.find((u) => u.kind === k)).find(Boolean) ?? units.find((u) => u.kind !== 'bank') ?? units[0];
  const analysis = await analyzeDoc(main.path, { markdown: main.markdown, format: main.format as never, notes: main.notes }, p.year, { voucher: false });
  if (main.page) analysis.name = `${analysis.name} (${main.page}쪽)`;

  const sum = (k: BudgetBundleKind) => docs.filter((d) => d.kind === k).reduce((n, d) => n + (d.amount ?? 0), 0);
  const receipts_total = sum('receipt') + sum('invoice');
  const quotes_total = sum('quote');
  const notes: string[] = [];
  if (main.kind !== 'letter' && main.kind !== 'plan') notes.push('공문이나 계획서를 찾지 못해, 첫 서류로 금액·목적을 읽었습니다. 지출할 공문을 함께 넣으면 더 정확합니다.');
  if (analysis.amount && receipts_total && receipts_total !== analysis.amount) notes.push(`영수증·명세서 합계 ${won(receipts_total)}원이 공문 금액 ${won(analysis.amount)}원과 다릅니다. 금액을 확인하세요.`);
  if (docs.some((d) => d.ocr)) notes.push('스캔 서류는 글자 읽기(OCR)로 읽어 틀릴 수 있습니다. 원본과 견줘 확인하세요.');
  const payees = docs.filter((d) => d.kind === 'bank' && (d.account || d.holder)).map((d) => ({ ...(d.bank ? { bank: d.bank } : {}), ...(d.account ? { account: d.account } : {}), ...(d.holder ? { holder: d.holder } : {}), from: d.page ? `${d.name} ${d.page}쪽` : d.name }));
  if (docs.some((d) => d.kind === 'bank') && !payees.length) notes.push('계좌 사본에서 계좌번호를 읽지 못했습니다. 원본을 보고 지급할 곳을 확인하세요.');
  return { analysis, docs, receipts_total, quotes_total, failed, notes, payees };
}
