/** 접수함·문서 엔진의 HWX — 한솔 전자결재 머리를 벗겨 읽고, 원인행위서는 결의서 칸으로 제목·부서·번호·날짜 (가상 문서) */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx } from 'kordoc';
import { call, setupEnv } from './doc-helpers.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let env: ReturnType<typeof setupEnv>;
beforeAll(() => { env = setupEnv(); });

/** 한솔 전자결재 HWX 꼴로 감싼다: 머리 글 + [길이][위치] 짝 + 본문 */
async function hwx(name: string, md: string): Promise<string> {
  const body = Buffer.from(await markdownToHwpx(md));
  const head = Buffer.alloc(300);
  head.write('Handysoft Approval Document File', 0, 'latin1');
  head.writeUInt32LE(body.length, 38);
  head.writeUInt32LE(head.length, 42);
  const p = join(env.work, name);
  writeFileSync(p, Buffer.concat([head, body]));
  return p;
}

describe('접수함 HWX', () => {
  it('폴더에서 HWX 를 찾고, 공문 HWX 는 공문 칸으로 읽는다', async () => {
    const p = await hwx('협조 요청.hwx', ['가온도', '수신 가온대학교총장', '제목 2026 협업 포럼 참가 협조 요청', '1. 참가 신청서를 2026. 11. 20.까지 제출하여 주시기 바랍니다.', '가온도지사', '시행 협력과-12 (2026. 11. 3.)'].join('\n\n'));
    const scan = await call('scan_paths', { paths: [env.work] });
    expect(scan.files.map((f: { name: string; format: string }) => [f.name, f.format])).toContainEqual(['협조 요청.hwx', 'hwx']);
    const r = await call('inbox_add', { paths: [p] });
    expect(r.failed).toEqual([]);
    expect(r.items[0]).toMatchObject({ title: '2026 협업 포럼 참가 협조 요청', doc_number: '가온도 협력과-12', sent_date: '2026-11-03' });
    expect(r.items[0].requests[0]?.due).toBe('2026-11-20');
  }, 30_000);

  it('원인행위서 HWX 는 결의서 칸으로 제목·부서·결의번호·발의일', async () => {
    const md = [
      '2025회계연도 가온대학교 대학회계', '원인행위서', '예산부서 : 가온혁신과 결의번호 : 20251BD0000E40000002',
      '| 발의일자 | 발의부서 |', '| --- | --- |', '| 2025-02-03 | 가온혁신과 |', '',
      '| 건명 | [육성]회의 다과 구입 결의 |', '| --- | --- |', '| 금액 | 90,000 원 |', '',
      '| 예산부서 | 계정구분 | 재원구분 | 세부사업 | 예산과목 | 금액 |', '| --- | --- | --- | --- | --- | --- |',
      '| 가온혁신과 | 자체수입 | 지원금(보조금) | [국립대학육성사업]지원금 | 물건비-업무추진비-회의비 | 90,000 원 |',
    ].join('\n');
    const p = await hwx('원인행위서.hwx', md);
    const r = await call('inbox_add', { paths: [p] });
    expect(r.failed).toEqual([]);
    expect(r.items[0]).toMatchObject({ title: '[원인행위서] [육성]회의 다과 구입 결의', sender: '가온혁신과', doc_number: '20251BD0000E40000002', sent_date: '2025-02-03' });
  }, 30_000);

  it('문서 엔진(convert)도 HWX 속 문서를 읽는다', async () => {
    const p = await hwx('보고.hwx', '# 시험 보고\n\n본문 글입니다. 다섯 글자 이상.');
    const r = await call('convert', { path: p, format: 'markdown', save: false });
    expect(JSON.stringify(r)).toContain('시험 보고');
  }, 30_000);
});
