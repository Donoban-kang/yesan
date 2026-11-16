/** 증빙 자동 대조 — 결의서(원인행위서 등)를 넣은 뒤 스캔 증빙 PDF 를 고르면 쪽마다 서류 종류·값을 읽어 결의서와 맞춰 본다 (budget_evidence) */

import { FileSearch } from "lucide-react";
import type { BudgetAnalysis, BudgetEvidenceResult } from "../../lib/contract";
import { rpc } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { draftKindOf } from "../../../node-sidecar/src/core/budget/draft";
import { Button } from "../ui/Button";
import { ErrorLine, Note, Working } from "../common/Status";
import { won } from "./useBudget";

const FILTER = [{ name: "스캔 증빙", extensions: ["pdf", "png", "jpg", "jpeg", "webp"] }];

export function EvidenceCheck({ analysis, onResult }: { analysis: BudgetAnalysis; onResult?: (note: string) => void }) {
  const task = useTask<BudgetEvidenceResult & { path: string }>({ keepOnFail: true });
  const run = (path: string) => void task.run(async ({ signal, onProgress }) => {
    const r = await rpc("budget_evidence", {
      path,
      voucher: {
        amount: analysis.amount, vendor_no: analysis.vendor_no, memo: analysis.memo, related: analysis.related, date: analysis.sent_date,
        kind: draftKindOf(analysis.nature),
      },
    }, { signal, onProgress });
    const ok = r.checks.filter((c) => c.ok).length;
    // 대장 메모: 반영할 때 함께 남긴다 (감사 대응)
    onResult?.(`증빙 대조 ${baseName(path)}: 맞음 ${ok}·다름 ${r.checks.length - ok}${r.missing.length ? `·빠진 서류 ${r.missing.join("·")}` : ""}`);
    return { ...r, path };
  });
  const pick = () => void pickFiles({ filters: FILTER, multiple: false }).then((p) => { if (p[0]) run(p[0]); });
  const r = task.result;
  const bad = r?.checks.filter((c) => !c.ok).length ?? 0;

  return (
    <div className="flex flex-col gap-2" aria-label="증빙 자동 대조">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="kd-label">증빙 자동 대조</span>
        <Button size="sm" variant="secondary" onClick={pick} disabled={task.busy}><FileSearch size={13} /> 증빙 PDF 고르기</Button>
      </div>
      {!r && !task.busy && <p className="kd-small kd-muted">스캔한 증빙 묶음(정산서·영수증·견적서·검수서 등)을 고르면 쪽마다 서류를 알아보고 결의서 금액·거래처·적요와 맞춰 봅니다. 이 PC 안에서만 읽습니다.</p>}
      {task.busy && <Working label="증빙을 쪽마다 읽는 중 (쪽당 몇 초)" progress={task.progress} onCancel={task.cancel} />}
      <ErrorLine message={task.error} />
      {r && (
        <>
          <span className="kd-small kd-muted">{baseName(r.path)} · {r.pages.length}쪽{!r.ocr && " · 글자 읽기(OCR) 모델이 없어 스캔 쪽은 읽지 못했습니다"}</span>
          <ul className="kd-small flex flex-col gap-1">
            {r.pages.map((p) => (
              <li key={p.page} className="flex flex-wrap items-center gap-2">
                <span className="kd-badge" data-tone={p.kind === "other" ? undefined : "info"}>{p.page}쪽 {p.label}</span>
                <span className="kd-muted kd-num">
                  {[p.amount !== undefined && `${won(p.amount)}원`, p.fare !== undefined && `운임 ${won(p.fare)}원`, p.qty !== undefined && `수량 ${p.qty}`, p.count !== undefined && `품목 ${p.count}개`, p.brn, p.date, p.doc_no].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          {r.checks.length > 0 && (
            <div className="flex flex-col gap-1">
              {r.checks.map((c) => (
                <span key={c.label} className="kd-small flex flex-wrap items-center gap-2">
                  <span className="kd-badge" data-tone={c.ok ? "ok" : "err"}>{c.ok ? "맞음" : "다름"}</span>{c.label}<span className="kd-muted kd-num">{c.detail}</span>
                </span>
              ))}
            </div>
          )}
          {r.missing.length > 0 && <Note tone="warn">찾지 못한 서류: {r.missing.join(", ")}. 묶음에 빠졌거나 글자를 읽지 못한 쪽일 수 있습니다.</Note>}
          {bad > 0 ? <Note tone="warn">다른 곳 {bad}가지를 결재 전에 확인하세요. OCR 로 읽은 값이라 원본과 견줘 보세요.</Note>
            : r.checks.length > 0 && <Note tone="ok">읽은 증빙이 결의서와 맞습니다. OCR 로 읽은 값이니 원본과 한 번 더 견줘 보세요.</Note>}
        </>
      )}
    </div>
  );
}
