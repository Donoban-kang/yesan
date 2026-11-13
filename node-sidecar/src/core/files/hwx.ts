/** HWX(전자결재 공문서 파일) 머리 벗기기 — 안에 든 문서(HWP·HWPX·PDF)를 꺼내 문서 엔진에 넘긴다
 *
 * 한솔(Handysoft) 전자결재 HWX 표본(2026-11-13 확인): 32바이트 머리 글 "Handysoft Approval Document File" + 머리 칸
 * (문서 관리번호, [본문 길이 u32][시작 위치 u32]) + HWP(OLE) 본문. 표본 하나에서 얻은 해석이라 짝을 못 찾으면 문서 머리 바이트를 훑는다.
 * 속이 바로 HWP·HWPX·PDF 인 HWX(확장자만 다른 것)는 그대로 넘긴다. 원본 파일은 고치지 않는다.
 */

export const HANDYSOFT_MAGIC = 'Handysoft Approval Document File';
const OLE_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export type Sniffed = 'ole' | 'zip' | 'pdf' | 'xml' | 'hwp3' | 'handysoft' | 'unknown';
export interface Embedded { offset: number; length: number; kind: 'ole' | 'zip' | 'pdf' | 'hwp3' }

/** 그 자리에서 시작하는 문서 형식 (머리 바이트) */
export function sigAt(buf: Buffer, at: number): Embedded['kind'] | null {
  if (at < 0 || at + 8 > buf.length) return null;
  if (buf.subarray(at, at + 8).equals(OLE_SIG)) return 'ole';
  if (buf[at] === 0x50 && buf[at + 1] === 0x4b && buf[at + 2] === 0x03 && buf[at + 3] === 0x04) return 'zip';
  if (buf.subarray(at, at + 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.subarray(at, at + 17).toString('latin1') === 'HWP Document File') return 'hwp3';
  return null;
}

export function sniff(buf: Uint8Array): Sniffed {
  const b = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.byteLength, 64));
  const at0 = sigAt(Buffer.concat([b, Buffer.alloc(8)]), 0);
  if (at0) return at0;
  if (b.subarray(0, HANDYSOFT_MAGIC.length).toString('latin1') === HANDYSOFT_MAGIC) return 'handysoft';
  const text = b.toString('utf-8').replace(/^﻿/, '').trimStart();
  if (text.startsWith('<?xml') || text.startsWith('<')) return 'xml';
  return 'unknown';
}

/** 한솔 전자결재 HWX 안의 문서들 (앞 것이 본문) */
export function handysoftEntries(buf: Buffer): Embedded[] {
  const out: Embedded[] = [];
  const seen = new Set<number>();
  let firstSig = buf.length;
  for (let i = HANDYSOFT_MAGIC.length; i < buf.length - 8; i++) if (sigAt(buf, i)) { firstSig = i; break; }
  // 1) 머리 칸의 [길이][위치] 짝
  for (let i = HANDYSOFT_MAGIC.length; i + 8 <= Math.min(firstSig, 64 * 1024); i++) {
    const length = buf.readUInt32LE(i);
    const offset = buf.readUInt32LE(i + 4);
    if (offset < HANDYSOFT_MAGIC.length || length < 512 || offset + length > buf.length || seen.has(offset)) continue;
    const kind = sigAt(buf, offset);
    if (!kind) continue;
    seen.add(offset);
    out.push({ offset, length, kind });
  }
  if (out.length) return out.sort((a, b) => a.offset - b.offset);
  // 2) 짝이 없으면 첫 문서 머리 바이트부터 끝까지 (HWP 속 "HWP Document File" 글은 OLE 안이라 그 뒤는 보지 않는다)
  return firstSig < buf.length ? [{ offset: firstSig, length: buf.length - firstSig, kind: sigAt(buf, firstSig)! }] : [];
}

const KIND_LABEL: Record<Embedded['kind'], string> = { ole: 'HWP', zip: 'HWPX', pdf: 'PDF', hwp3: 'HWP 3.0' };

/** HWX 바이트 → 문서 엔진이 읽을 바이트. 속이 묶음(ZIP 안의 여러 파일)·XML 이면 null (부르는 쪽이 따로 읽는다) */
export function unwrapHwx(buf: Buffer): { bytes: Buffer; note: string } | null {
  const kind = sniff(buf);
  if (kind === 'ole' || kind === 'pdf' || kind === 'hwp3') return { bytes: buf, note: `HWX 파일 속 형식: ${KIND_LABEL[kind]}` };
  if (kind !== 'handysoft') return null;
  const docs = handysoftEntries(buf);
  if (!docs.length) throw new Error('한솔 전자결재 HWX 안에서 본문 문서를 찾지 못했습니다. 전자결재 시스템에서 HWP·PDF 로 내려받아 넣으세요.');
  const main = docs[0];
  return {
    bytes: buf.subarray(main.offset, main.offset + main.length),
    note: `HWX 파일 속 형식: 한솔 전자결재 문서 · 본문 ${KIND_LABEL[main.kind]}을(를) 꺼내 읽었습니다${docs.length > 1 ? ` (안에 문서 ${docs.length}개, 첫 문서를 본문으로)` : ''}`,
  };
}
