/** 기관 규정 근거 찾기 — 예산집행지침·회계규정 같은 파일을 조항으로 나눠 이 PC 에 두고,
 *  고른 과목·공문 글과 맞는 조항을 찾아 "근거 조항"으로 보인다 (AI 없이, 밖으로 보내지 않음)
 *
 * 저장: 앱 데이터 budget/guides/index.json(목록) + budget/guides/<id>.json(조항). 원본 파일은 고치지 않는다.
 * 근거를 찾아 보이는 데까지만 한다. 회계처리 가능 여부를 정하지 않는다(판단은 담당자·재무 부서).
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { BudgetGuide, BudgetGuideMatch } from '../../types/rpc-contract.js';
import type { Settings } from '../../types/index.js';
import { parseDoc } from '../converter/index.js';
import { formatOf, PARSEABLE, TEXT_FORMATS } from '../files/format.js';
import { budgetDir } from './store.js';
import { readHwx } from './read-doc.js';
import { rankClauses, splitClauses, squash, type GuideClause, type GuideQuery } from './guide-match.js';

export { amountRules, splitClauses, rankClauses, type GuideClause, type GuideQuery } from './guide-match.js';

interface GuideFile { version: 1; guide: BudgetGuide; clauses: GuideClause[] }

const dir = () => join(budgetDir(), 'guides');
const indexFile = () => join(dir(), 'index.json');
const clauseFile = (id: string) => join(dir(), `${id}.json`);

/** 확장자를 모르는 파일은 글자 파일로 읽어 본다. 이보다 크면 글자 파일로 보지 않는다 */
const MAX_PLAIN = 20 * 1024 * 1024;

/** 확장자를 모르는 파일(.htm·.law·.log 등): UTF-8 글이면 읽고(웹 문서는 태그를 걷음), 바이너리면 까닭과 함께 거절 */
const BAD_PLAIN = '글자로 읽을 수 없는 파일입니다. HWP·HWPX·HWX·PDF·DOCX·XLSX·PPTX·그림·TXT·MD 파일로 저장해 넣으세요.';
const tooBig = () => new Error(`파일이 너무 큽니다(${MAX_PLAIN / 1024 / 1024}MB 넘음). 규정 본문만 TXT·HWPX·PDF로 저장해 넣으세요.`);

/** 깨진 글자(U+FFFD)가 많으면 그 인코딩이 아니다 */
const decodes = (text: string) => (text.match(/\uFFFD/g) ?? []).length <= Math.max(8, text.length / 200);

/** UTF-8(BOM 포함)·UTF-16(BOM)·CP949(EUC-KR, 예전 Windows 한글 파일) 차례로 풀어 본다 */
function decodeText(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  if (buf.subarray(0, 8192).includes(0)) return null;
  const utf8 = buf.toString('utf-8').replace(/^\uFEFF/, '');
  if (decodes(utf8)) return utf8;
  try {
    const cp949 = new TextDecoder('euc-kr').decode(buf);
    if (decodes(cp949)) return cp949;
  } catch { /* euc-kr 디코더가 없는 Node */ }
  return null;
}

const ENTITY: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

/** 확장자를 모르는 파일(.htm·.law·.log 등): 글자 파일이면 읽고(웹 문서는 태그를 걷음), 바이너리면 까닭과 함께 거절 */
async function readPlain(buf: Buffer): Promise<string> {
  if (buf.length > MAX_PLAIN) throw tooBig();
  const text = decodeText(buf);
  if (text === null) throw new Error(BAD_PLAIN);
  if (!/<(html|body|p|div|table)[\s>]/i.test(text)) return text;
  return text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(nbsp|lt|gt|quot|apos|amp);/g, (_, n: string) => ENTITY[n])
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n');
}

/* ───────── 저장 ───────── */

async function loadIndex(): Promise<BudgetGuide[]> {
  if (!existsSync(indexFile())) return [];
  try {
    const v = JSON.parse(await readFile(indexFile(), 'utf-8'));
    return Array.isArray(v?.guides) ? v.guides : [];
  } catch {
    return [];
  }
}

async function saveIndex(guides: BudgetGuide[]): Promise<void> {
  await mkdir(dir(), { recursive: true });
  await writeFile(indexFile(), JSON.stringify({ version: 1, guides }, null, 2), 'utf-8');
}

async function loadClauses(id: string): Promise<GuideClause[]> {
  try {
    const v = JSON.parse(await readFile(clauseFile(id), 'utf-8')) as GuideFile;
    return Array.isArray(v.clauses) ? v.clauses : [];
  } catch {
    return [];
  }
}

async function readGuideText(path: string, buf: Buffer, signal?: AbortSignal): Promise<string> {
  if (extname(path).toLowerCase() === '.hwx') return (await readHwx(path, signal)).markdown;
  const fmt = formatOf(path);
  if (!PARSEABLE.has(fmt) && !TEXT_FORMATS.has(fmt)) return readPlain(buf);
  const r = await parseDoc(path, { images: false, plain: true, pages: fmt === 'pdf' ? '1-300' : undefined, signal });
  return r.markdown;
}

export async function guideList(): Promise<BudgetGuide[]> {
  return loadIndex();
}

/** 파일을 읽어 조항으로 나눠 둔다. 같은 내용 파일을 다시 넣으면 새로 읽어 바꾼다 */
export async function guideAdd(paths: string[], signal?: AbortSignal): Promise<{ added: BudgetGuide[]; failed: Array<{ path: string; error: string }> }> {
  if (!paths.length) throw new Error('규정 파일을 하나 이상 고르세요.');
  const guides = await loadIndex();
  const added: BudgetGuide[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  for (const path of paths) {
    signal?.throwIfAborted();
    try {
      // 모르는 확장자는 읽기 전에 크기부터 본다 ("모든 파일"로 큰 동영상을 골라도 통째로 읽지 않게)
      const known = extname(path).toLowerCase() === '.hwx' || PARSEABLE.has(formatOf(path)) || TEXT_FORMATS.has(formatOf(path));
      if (!known && (await stat(path)).size > MAX_PLAIN) throw tooBig();
      const buf = await readFile(path);
      const id = createHash('sha256').update(buf).digest('hex').slice(0, 16);
      const text = await readGuideText(path, buf, signal);
      const clauses = splitClauses(text);
      if (!clauses.length || squash(text).length < 30) throw new Error('글을 읽지 못했습니다. 스캔 파일이면 글자 읽기(OCR) 모델이 깔려 있는지 설정 › 시스템의 엔진 점검으로 확인한 뒤 다시 넣으세요.');
      const guide: BudgetGuide = {
        id, name: basename(path), added_at: new Date().toISOString(), clauses: clauses.length,
        articles: clauses.filter((c) => c.no.startsWith('제')).length, chars: squash(text).length, size: buf.length,
      };
      await mkdir(dir(), { recursive: true });
      await writeFile(clauseFile(id), JSON.stringify({ version: 1, guide, clauses } satisfies GuideFile), 'utf-8');
      const at = guides.findIndex((g) => g.id === id);
      if (at >= 0) guides[at] = guide; else guides.push(guide);
      added.push(guide);
    } catch (err) {
      if (signal?.aborted) throw err;
      failed.push({ path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await saveIndex(guides);
  return { added, failed };
}

export async function guideRemove(id: string): Promise<boolean> {
  const guides = await loadIndex();
  const next = guides.filter((g) => g.id !== id);
  if (next.length === guides.length) return false;
  await saveIndex(next);
  await rm(clauseFile(id), { force: true });
  return true;
}

/* ───────── 찾기 ───────── */

/** 고른 과목·공문과 맞는 조항 (점수 높은 차례). 점수는 차례를 정할 뿐이다 */
export async function guideFind(q: GuideQuery, rules: Settings['budget']['rules']): Promise<BudgetGuideMatch[]> {
  const guides = await loadIndex();
  if (!guides.length) return [];
  const all: Array<{ g: BudgetGuide; c: GuideClause }> = [];
  for (const g of guides) for (const c of await loadClauses(g.id)) all.push({ g, c });
  if (!all.length) return [];
  return rankClauses(all, q, rules).slice(0, Math.min(20, Math.max(1, q.limit ?? 5)));
}

/** 조항 하나의 전문 */
export async function guideClause(id: string, no: string): Promise<GuideClause> {
  const c = (await loadClauses(id)).find((x) => x.no === no);
  if (!c) throw new Error('조항을 찾지 못했습니다. 설정의 "기관 규정·지침"에서 그 파일을 다시 넣어 보세요.');
  return c;
}
