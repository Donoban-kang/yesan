/** 결의서 입력 초안 — 고른 과목·금액으로 회계 시스템에 옮겨 적을 건명·적요와 증빙 확인표 (core/budget/draft 의 순수 함수) */

import { useMemo, useState } from "react";
import { ClipboardCopy, FileDown, ListChecks } from "lucide-react";
import type { BudgetAnalysis, BudgetItemView } from "../../lib/contract";
import { buildDraft, buildProposalMarkdown, draftKindOf, subjectName, type DraftKind } from "../../../node-sidecar/src/core/budget/draft";
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

  const proposal = useTask<string>();
  const saveProposal = () => void proposal.run(async () => {
    const markdown = buildProposalMarkdown({ kind, title: analysis.title, related, period: analysis.period, place, items, amount, account: accountLabel, subject: subjectName(item.name), date: today });
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
        <div className="flex items-center justify-between gap-2"><span className="kd-label">건명</span><Button size="sm" variant="ghost" onClick={() => void copy(d.title, "건명")}><ClipboardCopy size={13} /> 복사</Button></div>
        <p className="kd-inset kd-small p-2" style={{ userSelect: "text" }}>{d.title}</p>
        <div className="flex items-center justify-between gap-2"><span className="kd-label">적요</span><Button size="sm" variant="ghost" onClick={() => void copy(d.memo, "적요")}><ClipboardCopy size={13} /> 복사</Button></div>
        <p className="kd-inset kd-small p-2" style={{ userSelect: "text", whiteSpace: "pre-wrap" }}>{d.memo}</p>
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
