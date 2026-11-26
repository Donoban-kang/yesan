/** 보관한 점검 기록 — 이 PC 앱 데이터에 둔 집행 전 점검 기록 목록, 문서(HWPX)로 다시 저장, 지우기
 *  자동으로 지우지 않는다. 계좌번호는 중간 3자리를 가려 보관돼 있다 */

import { useCallback, useEffect, useState } from "react";
import { Archive, FileDown, Trash2 } from "lucide-react";
import type { BudgetPrecheckRecord, BudgetPrecheckRecordSummary } from "../../lib/contract";
import { precheckMarkdown } from "../../../node-sidecar/src/core/budget/precheck-record";
import { rpc, errorText } from "../../lib/rpc";
import { useApp } from "../../state/app";
import { Button } from "../ui/Button";
import { Note } from "../common/Status";
import { won } from "./useBudget";

export const precheckChanged = () => window.dispatchEvent(new Event("kordoc:precheck"));

/** 점검 기록 → 점검표 HWPX (저장한 경로를 돌려준다) */
export async function exportPrecheck(rec: BudgetPrecheckRecord): Promise<string> {
  const r = await rpc("generate_hwpx", { markdown: precheckMarkdown(rec), preset: "report", no_usage: true });
  if (!r.output_path) throw new Error("점검표를 저장하지 못했습니다. 다시 눌러 보세요.");
  return r.output_path;
}

const dateText = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };

export function PrecheckHistory() {
  const { toast } = useApp();
  const [list, setList] = useState<BudgetPrecheckRecordSummary[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [confirmId, setConfirmId] = useState("");

  const load = useCallback(() => {
    rpc("budget_precheck_list", {}).then((l) => { setList(l); setError(""); }, (e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("kordoc:precheck", load);
    return () => window.removeEventListener("kordoc:precheck", load);
  }, [load]);

  const save = async (id: string) => {
    setBusyId(id);
    try {
      const path = await exportPrecheck(await rpc("budget_precheck_get", { id }));
      toast(`점검표를 저장했습니다: ${path}`, "success");
    } catch (e) {
      toast(`점검표를 저장하지 못했습니다: ${errorText(e)}`, "error");
    } finally { setBusyId(""); }
  };
  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await rpc("budget_precheck_delete", { id });
      setConfirmId("");
      precheckChanged();
      toast("점검 기록을 지웠습니다.", "success");
    } catch (e) {
      toast(`지우지 못했습니다: ${errorText(e)}`, "error");
    } finally { setBusyId(""); }
  };

  if (!list?.length && !error) return null;
  return (
    <details className="kd-bcard">
      <summary className="kd-label flex cursor-pointer items-center gap-1"><Archive size={14} aria-hidden="true" /> 보관한 점검 기록 ({list?.length ?? 0})</summary>
      {error && <Note tone="err">{error}</Note>}
      <ul className="mt-2 flex flex-col gap-2">
        {(list ?? []).map((r) => (
          <li key={r.id} className="kd-small flex flex-col gap-1">
            <span className="min-w-0"><b className="block truncate">{r.title}</b>
              <span className="kd-muted">{dateText(r.saved_at)}{r.amount ? ` · ${won(r.amount)}원` : ""}{r.item_name ? ` · ${r.item_name}` : ""} · 확인 필요 {r.check} · 점검 못함 {r.na}</span></span>
            {confirmId === r.id ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>이 기록을 지울까요? 되돌릴 수 없습니다.</span>
                <Button size="sm" variant="secondary" onClick={() => void remove(r.id)} isLoading={busyId === r.id}><Trash2 size={13} /> 지우기</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmId("")} disabled={busyId === r.id}>취소</Button>
              </span>
            ) : (
              <span className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void save(r.id)} isLoading={busyId === r.id}><FileDown size={13} /> HWPX로 저장</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmId(r.id)} disabled={!!busyId}><Trash2 size={13} /> 지우기</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="kd-small kd-muted mt-2">이 PC 앱 데이터에만 있고 자동으로 지우지 않습니다. 계좌번호는 중간 3자리를 가려 보관합니다.</p>
    </details>
  );
}
