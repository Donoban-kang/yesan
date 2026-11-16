/** 지출 대장 — 반영한 기록(새 것 먼저). 품의는 지출 완료로 정산하고, 잘못 넣은 것은 취소 기록으로 되돌린다(지우지 않음) */

import { useMemo, useState } from "react";
import { CheckCheck, ExternalLink, Sheet, Undo2, Wallet } from "lucide-react";
import type { BudgetEntry } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { useTask } from "../../hooks/useTask";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Seg } from "../common/Field";
import { Empty, ErrorLine, SavedFile } from "../common/Status";
import { budgetChanged, parseWon, useBudgetBook, won } from "./useBudget";
import "./budget.css";

type Act = { id: string; kind: "settle" | "reverse" } | null;
const KIND = { apply: "반영", settle: "정산", reverse: "취소" } as const;

export function LedgerScreen({ active }: { active: boolean }) {
  const { toast, go } = useApp();
  const { book, error } = useBudgetBook(active);
  const [account, setAccount] = useState("");
  const [stage, setStage] = useState<"" | "commit" | "paid">("");
  const [act, setAct] = useState<Act>(null);
  const [actText, setActText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState("");
  const exporting = useTask<{ output_path: string; items: number; entries: number }>();

  const items = useMemo(() => new Map((book?.items ?? []).map((it) => [it.id, it])), [book]);
  const label = (id: string) => book?.accounts.find((a) => a.id === id)?.label ?? id;
  const reversible = new Set(book?.reversible ?? []);
  // 정산된 품의 (다시 정산하지 않게)
  const settled = new Set((book?.entries ?? []).filter((e) => e.kind === "settle" && e.settles && reversible.has(e.group)).map((e) => e.settles!));
  const reversedIds = new Set((book?.entries ?? []).filter((e) => e.kind === "reverse" && e.reverses).map((e) => e.reverses!));

  const rows = [...(book?.entries ?? [])].reverse().filter((e) => {
    const it = items.get(e.item_id);
    return (!account || it?.account === account) && (!stage || e.stage === stage);
  });
  // 묶음마다 동작 단추는 첫 줄(보이는 차례로 위)에만
  const actRow = new Map<string, string>();
  for (const e of rows) if (!actRow.has(e.group)) actRow.set(e.group, e.id);

  const open = (a: Act, initial = "") => { setAct(a); setActText(initial); setActError(""); };
  const run = async (e: BudgetEntry) => {
    if (!act) return;
    setBusy(true); setActError("");
    try {
      if (act.kind === "settle") {
        const r = await rpc("budget_settle", { id: e.id, amount: parseWon(actText) || undefined });
        toast(`지출 완료로 바꿨습니다. ${r.item.name} 남은 예산 ${won(r.item.avail)}원`, "success");
      } else {
        const r = await rpc("budget_reverse", { id: e.id, reason: actText.trim() || undefined });
        toast(`반영을 취소했습니다. ${r.item.name} 남은 예산 ${won(r.item.avail)}원`, "success");
      }
      setAct(null);
      budgetChanged();
    } catch (err) {
      setActError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="지출 대장" sub="반영한 기록입니다. 기록은 지우지 않고, 되돌릴 때는 취소 기록을 새로 남깁니다."
        actions={!!book?.entries.length && <Button variant="ghost" onClick={() => void exporting.run(() => rpc("budget_export", {}))} disabled={exporting.busy}><Sheet size={15} /> 대장 엑셀</Button>} />
      <div className="kd-body">
        <div className="kd-budget">
          <ErrorLine message={error || exporting.error} />
          {exporting.result && <SavedFile path={exporting.result.output_path} label={`예산 현황·지출 대장을 엑셀로 저장했습니다 (기록 ${exporting.result.entries}줄)`} />}
          {book && book.entries.length === 0 ? (
            <Empty icon={<Wallet size={28} />} title="반영한 기록 없음" action={<Button onClick={() => go("spend")}><Wallet size={14} /> 지출 도우미로</Button>}>
              지출 도우미에서 공문을 예산에 반영하면 여기에 쌓입니다.
            </Empty>
          ) : book && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Seg label="회계 구분" value={account} onChange={setAccount} options={[{ value: "", label: "전체" }, ...book.accounts.map((a) => ({ value: a.id, label: a.label }))]} />
                <Seg label="단계" value={stage} onChange={setStage} options={[{ value: "", label: "모든 단계" }, { value: "commit", label: "품의" }, { value: "paid", label: "지출" }]} />
              </div>
              <div className="kd-table-wrap">
                <table className="kd-table kd-budget-table" aria-label="지출 대장 (새 기록 먼저)">
                  <thead><tr><th>집행일</th><th>근거 공문</th><th>과목</th><th className="kd-r">금액</th><th>단계</th><th>담당</th><th aria-label="동작" /></tr></thead>
                  <tbody>
                    {rows.map((e) => {
                      const it = items.get(e.item_id);
                      const dead = reversedIds.has(e.id) || e.kind === "reverse";
                      const canReverse = actRow.get(e.group) === e.id && reversible.has(e.group) && e.kind !== "reverse" && !reversedIds.has(e.id);
                      const canSettle = e.kind === "apply" && e.stage === "commit" && reversible.has(e.group) && !settled.has(e.id) && !reversedIds.has(e.id);
                      const editing = act && act.id === e.id;
                      return (
                        <tr key={e.id} data-reversed={dead}>
                          <td className="kd-num">{e.date}</td>
                          <td className="min-w-0">
                            {e.doc_title ?? <span className="kd-muted">공문 없음</span>}
                            {(e.doc_number || e.sender) && <span className="kd-small kd-muted block">{[e.sender, e.doc_number].filter(Boolean).join(" · ")}</span>}
                            {e.memo && <span className="kd-small kd-muted block">{e.memo}</span>}
                            {e.doc_path && <button type="button" className="kd-link kd-small" onClick={() => void rpc("open_file", { path: e.doc_path! }).catch((x) => toast(errorText(x), "error"))}><ExternalLink size={12} className="inline" /> 공문 열기</button>}
                          </td>
                          <td>{it ? <><span className="kd-small kd-muted block">{label(it.account)}{it.detail ? ` · ${it.detail}` : ""}</span>{it.name}</> : e.item_id}</td>
                          <td className="kd-r" style={e.amount < 0 ? { color: "var(--color-error)" } : undefined}>{e.amount < 0 ? "−" : ""}{won(Math.abs(e.amount))}</td>
                          <td>
                            <span className="kd-badge" data-tone={e.kind === "reverse" ? undefined : e.stage === "paid" ? "ok" : "info"}>{KIND[e.kind]} · {e.stage === "paid" ? "지출" : "품의"}</span>
                            {e.synced_at && <span className="kd-small kd-muted block">공식 집행액에 반영됨</span>}
                            {reversedIds.has(e.id) && <span className="kd-small kd-muted block">취소됨</span>}
                          </td>
                          <td className="kd-small">{e.by ?? ""}</td>
                          <td style={{ minWidth: 150 }}>
                            {editing ? (
                              <div className="flex flex-col gap-1.5">
                                <input className="kd-input" value={actText} onChange={(x) => setActText(x.target.value)} aria-label={act.kind === "settle" ? "실제 지출 금액" : "취소 까닭"}
                                  placeholder={act.kind === "settle" ? `지출 금액 (비우면 ${won(e.amount)})` : "취소 까닭 (선택)"} />
                                <div className="flex gap-1">
                                  <Button size="sm" variant={act.kind === "reverse" ? "danger" : "primary"} onClick={() => void run(e)} isLoading={busy}>{act.kind === "settle" ? "지출 완료로" : "취소 기록 남기기"}</Button>
                                  <Button size="sm" variant="ghost" onClick={() => setAct(null)} disabled={busy}>닫기</Button>
                                </div>
                                <ErrorLine message={actError} />
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {canSettle && <Button size="sm" variant="secondary" onClick={() => open({ id: e.id, kind: "settle" })}><CheckCheck size={13} /> 지출 완료로</Button>}
                                {canReverse && <Button size="sm" variant="ghost" onClick={() => open({ id: e.id, kind: "reverse" })}><Undo2 size={13} /> 반영 취소</Button>}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="kd-small kd-muted">정산은 품의 줄을 닫는 줄(−)과 지출 줄 두 줄로 남습니다. 지출 완료로 바꾼 품의를 되돌리려면 정산 기록을 먼저 취소하세요.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
