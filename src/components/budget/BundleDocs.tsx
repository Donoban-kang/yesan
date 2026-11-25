/** 지출 서류 묶음 — 넣은 서류마다 종류·금액·날짜, 지급할 곳(계좌), 합계와 알림 (budget_bundle 결과)
 *  지급할 곳은 계좌 사본에서 읽은 그대로 보인다. 이 PC 화면에만 보이고 외부로 보내지 않는다 */

import { ClipboardCopy, Landmark } from "lucide-react";
import type { BudgetBundle } from "../../lib/contract";
import { useApp } from "../../state/app";
import { Button } from "../ui/Button";
import { Note } from "../common/Status";
import { won } from "./useBudget";

const TONE: Partial<Record<BudgetBundle["docs"][number]["kind"], string>> = { letter: "accent", plan: "accent", bank: "warn", receipt: "ok", invoice: "ok", quote: "info" };

/** ① 칸: 넣은 서류 목록 */
export function BundleDocs({ bundle }: { bundle: BudgetBundle }) {
  return (
    <div className="kd-bcard" aria-label="넣은 지출 서류">
      <span className="kd-label">넣은 서류 {bundle.docs.length}개{bundle.failed.length ? ` · 읽지 못함 ${bundle.failed.length}개` : ""}</span>
      <ul className="flex flex-col gap-1.5">
        {bundle.docs.map((d, i) => (
          <li key={`${d.path}#${d.page ?? 0}#${i}`} className="kd-small flex flex-wrap items-center gap-2">
            <span className="kd-badge" data-tone={TONE[d.kind]}>{d.label}</span>
            <span className="min-w-0 flex-1 truncate">{d.name}{d.page ? ` · ${d.page}쪽` : ""}{d.path === bundle.analysis.path && (d.kind === "letter" || d.kind === "plan" || !d.page) && bundle.analysis.name.startsWith(d.name) ? " · 중심 서류" : ""}</span>
            {d.amount !== undefined && <span className="kd-num font-semibold">{won(d.amount)}원</span>}
            {d.date && <span className="kd-muted kd-num">{d.date}</span>}
            {d.ocr && <span className="kd-muted" data-tip="글자 읽기(OCR)로 읽어 틀릴 수 있습니다">OCR</span>}
          </li>
        ))}
      </ul>
      {bundle.failed.map((f) => <Note key={f.path} tone="err">{f.path.split(/[\\/]/).pop()}: {f.error}</Note>)}
    </div>
  );
}

/** ② 칸: 지급할 곳 · 합계 · 알림 */
export function BundleSummary({ bundle }: { bundle: BudgetBundle }) {
  const { toast } = useApp();
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast("계좌번호를 복사했습니다.", "success"), () => toast("복사하지 못했습니다. 글을 직접 골라 복사하세요.", "error"));
  return (
    <>
      {bundle.payees.length > 0 && (
        <div className="kd-inset flex flex-col gap-1.5 p-3" aria-label="지급할 곳">
          <span className="kd-label flex items-center gap-1"><Landmark size={14} aria-hidden="true" /> 지급할 곳</span>
          {bundle.payees.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <b>{[p.bank, p.account].filter(Boolean).join(" ") || "계좌번호를 읽지 못함"}</b>
                {p.holder && <span> · 예금주 {p.holder}</span>}
                <span className="kd-small kd-muted block">{p.from}에서 읽음</span>
              </span>
              {p.account && <Button size="sm" variant="ghost" onClick={() => void copy(p.account!)}><ClipboardCopy size={13} /> 복사</Button>}
            </div>
          ))}
          <p className="kd-small kd-muted">계좌 사본에서 읽은 값입니다. 지급 전에 원본과 견줘 확인하세요. 이 PC 화면에만 보이고 외부로 보내지 않습니다.</p>
        </div>
      )}
      {(bundle.receipts_total > 0 || bundle.quotes_total > 0) && (
        <dl className="kd-dl">
          {bundle.receipts_total > 0 && <div><dt>영수증·명세서 합계</dt><dd className="kd-num">{won(bundle.receipts_total)}원</dd></div>}
          {bundle.quotes_total > 0 && <div><dt>견적 합계</dt><dd className="kd-num">{won(bundle.quotes_total)}원</dd></div>}
        </dl>
      )}
      {bundle.notes.map((n) => <Note key={n} tone="warn">{n}</Note>)}
    </>
  );
}
