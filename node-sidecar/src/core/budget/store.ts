/** 예산 장부 저장 — 앱 데이터 budget/<회계연도>.json { version: 1, year, items, entries, imports } (이 PC 에만)
 *
 * 읽고 고쳐 쓰기는 한 줄로 세운다(반영 두 번이 겹쳐도 서로 덮지 않게). 깨진 파일은 옆에 남기고 새로 시작한다.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { BudgetEntry, BudgetItem } from '../../types/rpc-contract.js';
import { dataDir, renameRetry } from '../../infra/config.js';
import { logger } from '../../infra/logger.js';

export interface BudgetFile {
  version: 1;
  year: number;
  items: BudgetItem[];
  entries: BudgetEntry[];
  imports: Array<{ at: string; file: string; sha256: string; items: number }>;
}

export const budgetDir = () => join(dataDir(), 'budget');
const fileOf = (year: number) => join(budgetDir(), `${year}.json`);

let chain: Promise<unknown> = Promise.resolve();
/** 장부 읽고 고쳐 쓰기를 차례로 */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

const empty = (year: number): BudgetFile => ({ version: 1, year, items: [], entries: [], imports: [] });

export async function loadBook(year: number): Promise<BudgetFile> {
  const f = fileOf(year);
  if (!existsSync(f)) return empty(year);
  const text = await readFile(f, 'utf-8').catch((err: NodeJS.ErrnoException) => {
    // 잠깐 못 읽은 것(백신이 쥠)을 깨진 것으로 보고 새로 시작하면 지출 기록이 사라진다
    throw new Error(`예산 장부 파일을 읽지 못했습니다(${err.code ?? err}). 잠시 뒤 다시 시도하세요.`);
  });
  try {
    const j = JSON.parse(text) as Partial<BudgetFile>;
    return {
      version: 1,
      year,
      items: Array.isArray(j.items) ? j.items.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string').map(fixItem) : [],
      entries: Array.isArray(j.entries) ? j.entries.filter((x) => x && typeof x.id === 'string' && typeof x.item_id === 'string' && Number.isFinite(x.amount)) : [],
      imports: Array.isArray(j.imports) ? j.imports : [],
    };
  } catch (err) {
    const keep = `${f}.broken-${Date.now()}`;
    await rename(f, keep).catch(() => undefined);
    logger.warn(`[budget] 장부 파일을 못 읽어 ${basename(keep)} 로 옮기고 새로 시작: ${err}`);
    return empty(year);
  }
}

function fixItem(it: BudgetItem): BudgetItem {
  return {
    ...it,
    program: it.program ?? '', unit: it.unit ?? '', detail: it.detail ?? '',
    budget: Math.round(Number(it.budget) || 0), spent_before: Math.round(Number(it.spent_before) || 0),
    keywords: Array.isArray(it.keywords) ? it.keywords.filter((k) => typeof k === 'string') : [],
  };
}

export async function saveBook(book: BudgetFile): Promise<void> {
  await mkdir(budgetDir(), { recursive: true });
  const f = fileOf(book.year);
  const tmp = `${f}.tmp`;
  await writeFile(tmp, JSON.stringify(book, null, 2), 'utf-8');
  await renameRetry(tmp, f);
}
