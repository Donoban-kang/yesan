/** 결의서 입력 초안 — 고른 과목·금액으로 회계 시스템에 옮겨 적을 건명·적요와 증빙 확인표 (core/budget/draft 의 순수 함수) */

import { useMemo, useState } from "react";
import { ClipboardCopy, FileDown, ListChecks, Undo2 } from "lucide-react";
import type { BudgetAnalysis, BudgetItemView } from "../../lib/contract";
import { buildDraft, buildProposalMarkdown, draftKindOf, stripDateTail, subjectName, type DraftKind } from "../../../node-sidecar/src/core/budget/draft";
import { rpc } from "../../lib/rpc";
import { useTask } from "../../hooks/useTask";
import { ErrorLine, SavedFile, Working } from "../common/Status";
import { useApp } from "../../state/app";
import { Button } from "../ui/Button";
import { Seg } from "../common/Field";

const KINDS: Array<{ value: DraftKind; label: string }> = [{ value: "travel", label: "여비 정산" }, { value: "purchase", label: "물품 구매" }, { value: "general", label: "일반 지출" }];

export function VoucherDraft({ analysis, item, amount, accountLabel }: { analysis: BudgetAnalysis; item: BudgetItemView; amount: number; accountLabel: string }) {
  const { toast } = useApp();
  const [kind, setKind] = useState<DraftKind>(() => draftKindOf(analysis.nature));
  const [related, setRelated] = useState("");
  const [place, setPlace] = useState("");
  const [items, setItems] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const d = useMemo(() => buildDraft({
    kind, title: analysis.title, related, period: analysis.period, place, items, amount, account: accountLabel, subject: subjectName(item.name), date: today,
  }), [kind, analysis.title, analysis.period, related, place, items, amount, accountLabel, item.name, today]);

  // 사용자가 고친 건명·적요 (null 이면 자동 초안을 그대로 따라간다. 갈래·금액을 바꿔도 고친 값은 유지)
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [memoEdit, setMemoEdit] = useState<string | null>(null);
  const title = titleEdit ?? d.title;
  const memo = memoEdit ?? d.memo;
  const noTitle = !analysis.title?.trim();

  const proposal = useTask<string>();
  const saveProposal = () => void proposal.run(async () => {
    // 여비 정산은 건명이 정해진 글이라 품의서 제목에 쓰지 않는다. 그 밖에는 고친 건명을 쓴다(끝의 지출일 표시는 뗀다)
    const proposalTitle = kind !== "travel" && titleEdit != null ? stripDateTail(titleEdit) : analysis.title;
    const markdown = buildProposalMarkdown({ kind, title: proposalTitle, related, period: analysis.period, place, items, amount, account: accountLabel, subject: subjectName(item.name), date: today });
    const r = await rpc("generate_hwpx", { markdown, preset: "official" });
    if (!r.output_path) throw new Error("품의서 초안을 저장하지 못했습니다. 다시 눌러 보세요.");
    return r.output_path;
  });

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what}을(를) 복사했습니다. 회계 시스템에 붙여 넣으세요.`, "success");
    } catch {
      toast("복사하지 못했습니다. 글을 직접 골라 복사하세요.", "error");
    }
  };

  return (
    <div className="kd-bcard" aria-label="결의서 입력 초안">
      <div className="flex items-center justify-between gap-2">
        <b>결의서 입력 초안</b>
        <span className="kd-small kd-muted">회계 시스템에 옮겨 적을 글</span>
      </div>
      <Seg label="지출 갈래" value={kind} onChange={setKind} options={KINDS} />
      {kind === "travel" && (
        <div className="kd-fieldgrid">
          <label className="kd-field"><span className="kd-label">관련 문서 (출장 신청)</span><input className="kd-input" value={related} onChange={(e) => setRelated(e.target.value)} placeholder="예: 가온지원과-1234(2026.11.04.)" /></label>
          <label className="kd-field"><span className="kd-label">출장지</span><input className="kd-input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="예: 가온캠퍼스" /></label>
        </div>
      )}
      {kind === "purchase" && (
        <label className="kd-field"><span className="kd-label">구입품목 요약</span><input className="kd-input" value={items} onChange={(e) => setItems(e.target.value)} placeholder="예: 진행문서화일 및 각종 문구류 77개" /></label>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="kd-label" htmlFor="vd-title">건명{titleEdit != null && <span className="kd-small kd-muted"> · 직접 고침</span>}</label>
          <span className="flex items-center gap-1">
            {titleEdit != null && <Button size="sm" variant="ghost" onClick={() => setTitleEdit(null)}><Undo2 size={13} /> 자동 초안으로</Button>}
            <Button size="sm" variant="ghost" onClick={() => void copy(title, "건명")}><ClipboardCopy size={13} /> 복사</Button>
          </span>
        </div>
        <input id="vd-title" className="kd-input" value={title} onChange={(e) => setTitleEdit(e.target.value)} />
        {noTitle && titleEdit == null && <p className="kd-small kd-muted">공문에서 건명을 읽지 못했습니다. 위 칸에 직접 적어 주세요.</p>}
        <div className="flex items-center justify-between gap-2">
          <label className="kd-label" htmlFor="vd-memo">적요{memoEdit != null && <span className="kd-small kd-muted"> · 직접 고침</span>}</label>
          <span className="flex items-center gap-1">
            {memoEdit != null && <Button size="sm" variant="ghost" onClick={() => setMemoEdit(null)}><Undo2 size={13} /> 자동 초안으로</Button>}
            <Button size="sm" variant="ghost" onClick={() => void copy(memo, "적요")}><ClipboardCopy size={13} /> 복사</Button>
          </span>
        </div>
        <textarea id="vd-memo" className="kd-input" rows={4} value={memo} onChange={(e) => setMemoEdit(e.target.value)} style={{ resize: "vertical" }} />
        <p className="kd-small kd-muted">건명과 적요는 직접 고칠 수 있습니다. 고친 값은 복사와 품의서 초안에 그대로 쓰이고, 금액·갈래를 바꿔도 유지됩니다.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {proposal.busy ? <Working label="품의서 초안을 만드는 중" /> : (
          <div><Button size="sm" variant="secondary" onClick={saveProposal}><FileDown size={13} /> 품의서 초안 HWPX로 저장</Button></div>
        )}
        <ErrorLine message={proposal.error} />
        {proposal.result && <SavedFile path={proposal.result} label="품의서 초안을 저장했습니다. 기관 서식에 옮기거나 편집기에서 다듬으세요" />}
        <p className="kd-small kd-muted">기안문 꼴(1. 가.)로 건명·금액(숫자와 한글)·예산과목을 채우고, 모르는 값은 ○○로 비워 둡니다.</p>
      </div>
      <details>
        <summary className="kd-label flex cursor-pointer items-center gap-1"><ListChecks size={14} aria-hidden="true" /> 증빙 확인표 ({d.checklist.length})</summary>
        <ul className="kd-small mt-2 flex flex-col gap-1.5 pl-1">
          {d.checklist.map((c) => <li key={c.item}><b>{c.item}</b>: <span className="kd-muted">{c.check}</span></li>)}
        </ul>
        <p className="kd-small kd-muted mt-2">기관 회계·여비 규정이 우선합니다. 이 확인표는 일반적인 점검 항목입니다.</p>
      </details>
    </div>
  );
}
