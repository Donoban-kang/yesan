/** 점검 기록 보관 — 앱 데이터 budget/precheck/<id>.json (이 PC 에만, 자동 삭제 없음, 사용자가 지운다) */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { BudgetPrecheckRecord, BudgetPrecheckRecordSummary } from '../../types/rpc-contract.js';
import { renameRetry } from '../../infra/config.js';
import { budgetDir } from './store.js';
import { summaryOf } from './precheck-record.js';

const dir = () => join(budgetDir(), 'precheck');
const ID = /^pc-[0-9]{13}-[0-9a-f]{6}$/;
/** 경로로 쓰기 전에 모양을 확인한다 (화면이 보낸 값이 폴더 밖을 가리키지 못하게) */
const fileOf = (id: string) => {
  if (!ID.test(id)) throw new Error('점검 기록을 고르세요.');
  return join(dir(), `${id}.json`);
};

export const newRecordId = (at = new Date()) => `pc-${at.getTime()}-${randomBytes(3).toString('hex')}`;

export async function saveRecord(r: BudgetPrecheckRecord): Promise<void> {
  const f = fileOf(r.id);
  await mkdir(dir(), { recursive: true });
  const tmp = `${f}.tmp`;
  await writeFile(tmp, JSON.stringify(r, null, 2), 'utf-8');
  await renameRetry(tmp, f);
}

export async function getRecord(id: string): Promise<BudgetPrecheckRecord> {
  const f = fileOf(id);
  if (!existsSync(f)) throw new Error('점검 기록을 찾지 못했습니다. 이미 지웠거나 다른 PC의 기록일 수 있습니다.');
  try {
    const r = JSON.parse(await readFile(f, 'utf-8')) as BudgetPrecheckRecord;
    if (r?.id !== id || !r.precheck || !Array.isArray(r.docs)) throw new Error('모양이 다릅니다');
    return r;
  } catch (err) {
    throw new Error(`점검 기록 파일을 읽지 못했습니다(${err instanceof Error ? err.message : err}). 지우고 다시 보관하세요.`);
  }
}

/** 새것부터. 못 읽는 파일은 건너뛴다 */
export async function listRecords(): Promise<BudgetPrecheckRecordSummary[]> {
  if (!existsSync(dir())) return [];
  const out: BudgetPrecheckRecordSummary[] = [];
  for (const name of await readdir(dir())) {
    const id = name.replace(/\.json$/, '');
    if (!name.endsWith('.json') || !ID.test(id)) continue;
    try { out.push(summaryOf(await getRecord(id))); } catch { /* 깨진 파일은 목록에서 뺀다 */ }
  }
  return out.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

export async function deleteRecord(id: string): Promise<boolean> {
  const f = fileOf(id);
  if (!existsSync(f)) return false;
  await rm(f, { force: true });
  return true;
}
