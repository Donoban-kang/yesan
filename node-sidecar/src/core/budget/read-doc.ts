/** 공문 글 읽기 — HWP·HWPX·HML·PDF·DOCX 는 문서 엔진 그대로, HWX(전자결재 공문서 파일)는 속을 들여다보고 읽는다
 *
 * HWX 는 공개 명세를 확인하지 못한 형식이라 확장자를 믿지 않고 머리 바이트로 가른다.
 * - HWP(OLE 복합 문서)·HWPX(ZIP)·PDF 가 확장자만 바뀐 것 → 그대로 엔진에
 * - ZIP 묶음 안에 공문(.hwp·.hwpx·.pdf·.hml) 이 들어 있는 것 → 가장 그럴듯한 본문을 꺼내 엔진에 (결재 정보 XML 은 글만 덧붙임)
 * - XML(HWPML) → 엔진에, 다른 XML 은 태그를 걷은 글로
 * 알아보지 못하면 무엇을 하면 되는지 알린다. 원본 파일은 고치지 않는다.
 */

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import JSZip from 'jszip';
import type { DocFormat } from '../../types/rpc-contract.js';
import { parseBytes, parseDoc } from '../converter/index.js';
import { formatOf } from '../files/format.js';
import { getSettings } from '../../infra/config.js';
import { parseFailure } from '../errors.js';

export interface ReadDoc {
  markdown: string;
  format: DocFormat | 'hwx';
  notes: string[];
}

const READABLE = new Set<DocFormat>(['hwp', 'hwp3', 'hwpx', 'hwpml', 'pdf', 'docx', 'image', 'txt', 'md']);

export type Sniffed = 'ole' | 'zip' | 'pdf' | 'xml' | 'hwp3' | 'unknown';

export function sniff(buf: Uint8Array): Sniffed {
  const head = Buffer.from(buf.subarray(0, 32));
  if (head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'ole';
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'zip';
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head.subarray(0, 17).toString('latin1') === 'HWP Document File') return 'hwp3';
  const text = head.toString('utf-8').replace(/^﻿/, '').trimStart();
  if (text.startsWith('<?xml') || text.startsWith('<')) return 'xml';
  return 'unknown';
}

const SNIFF_LABEL: Record<Sniffed, string> = { ole: 'HWP', zip: 'HWPX(ZIP)', pdf: 'PDF', xml: 'XML', hwp3: 'HWP 3.0', unknown: '알 수 없음' };

/** ZIP 안 본문 후보의 차례 (앞이 우선) */
const INNER_ORDER = ['.hwpx', '.hwp', '.pdf', '.hml', '.docx'];

const stripXml = (xml: string) => xml.replace(/<\?[\s\S]*?\?>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

async function parseBuf(buf: Buffer, path: string, signal?: AbortSignal): Promise<string> {
  const ocr = getSettings().convert.ocr;
  const r = await parseBytes(buf, { filePath: path, plain: true, images: false, ocr: ocr === 'force' ? 'force' : ocr === 'off' ? false : undefined }, undefined, signal);
  if (!r.success) throw parseFailure(r);
  return r.markdown;
}

export async function readHwx(path: string, signal?: AbortSignal): Promise<ReadDoc> {
  const buf = await readFile(path);
  const kind = sniff(buf);
  const notes = [`HWX 파일 속 형식: ${SNIFF_LABEL[kind]}`];
  if (kind === 'ole' || kind === 'pdf' || kind === 'hwp3') return { markdown: await parseBuf(buf, path, signal), format: 'hwx', notes };
  if (kind === 'xml') {
    const text = buf.toString('utf-8');
    if (/<HWPML\b/i.test(text)) return { markdown: await parseBuf(buf, path, signal), format: 'hwx', notes };
    notes.push('XML 글만 읽었습니다 (표·서식은 빠짐)');
    return { markdown: stripXml(text), format: 'hwx', notes };
  }
  if (kind === 'zip') {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    // 한글 문서(HWPX) 그 자체
    if (names.some((n) => /^Contents\/section\d+\.xml$/i.test(n))) return { markdown: await parseBuf(buf, path, signal), format: 'hwx', notes };
    const inner = names
      .filter((n) => INNER_ORDER.includes(extname(n).toLowerCase()))
      .sort((a, b) => INNER_ORDER.indexOf(extname(a).toLowerCase()) - INNER_ORDER.indexOf(extname(b).toLowerCase()));
    // 결재 정보(XML)는 글로 덧붙인다: 문서번호·시행일이 여기에만 있을 수 있다
    const meta: string[] = [];
    for (const n of names.filter((x) => /\.xml$/i.test(x)).slice(0, 5)) {
      const t = stripXml(await zip.files[n].async('string'));
      if (t) meta.push(t.slice(0, 4000));
    }
    if (inner.length) {
      // 같은 순위면 큰 것(붙임보다 본문이 크지 않을 수도 있어 첫 번째 순위 형식 안에서 가장 큰 것)
      const ext = extname(inner[0]).toLowerCase();
      const same = inner.filter((n) => extname(n).toLowerCase() === ext);
      const sizes = await Promise.all(same.map(async (n) => ({ n, b: await zip.files[n].async('nodebuffer') })));
      sizes.sort((a, b) => b.b.length - a.b.length);
      const main = sizes[0];
      notes.push(`묶음 안 문서 ${inner.length}개 가운데 "${basename(main.n)}"을(를) 본문으로 읽었습니다`);
      const md = await parseBuf(main.b, path, signal);
      return { markdown: meta.length ? `${md}\n\n${meta.join('\n')}` : md, format: 'hwx', notes };
    }
    if (meta.length) {
      notes.push('묶음 안에 한글·PDF 문서가 없어 XML 글만 읽었습니다');
      return { markdown: meta.join('\n'), format: 'hwx', notes };
    }
  }
  throw new Error('HWX 파일의 속 형식을 알아보지 못했습니다. 전자결재 시스템에서 HWP·HWPX·PDF 로 내려받아 넣거나, 이 HWX 파일 표본을 개발 담당에게 보내 주세요.');
}

/** 공문 글 (앞 10쪽까지) */
export async function readBudgetDoc(path: string, signal?: AbortSignal): Promise<ReadDoc> {
  if (extname(path).toLowerCase() === '.hwx') return readHwx(path, signal);
  const format = formatOf(path);
  if (!READABLE.has(format)) throw new Error('공문으로 읽을 수 없는 형식입니다. HWP·HWPX·HWX·HML·PDF·DOCX 파일을 넣으세요.');
  const r = await parseDoc(path, { images: false, plain: true, pages: format === 'pdf' ? '1-10' : undefined, signal });
  return { markdown: r.markdown, format, notes: [] };
}
