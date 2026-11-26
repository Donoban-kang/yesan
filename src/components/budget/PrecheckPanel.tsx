/** 집행 전 점검표 — 넣은 서류를 서류 구비·금액·사업자·계좌·잔액·규정 금액 기준으로 점검한 결과 (budget_precheck)
 *  AI 없이 정해진 규칙으로만 견준다. 이상 없음·확인 필요·점검 못함만 보이고, 집행 가능 여부는 판정하지 않는다. */

import { useEffect, useState } from "react";
import { Archive, CheckCircle2, CircleAlert, CircleDashed, ClipboardCheck, FileDown } from "lucide-react";
import type { BudgetBundle, BudgetPrecheck, BudgetPrecheckStatus } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { useApp } from "../../state/app";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { ErrorLine, Note, SavedFile } from "../common/Status";
import { exportPrecheck, precheckChanged } from "./PrecheckHistory";

const ICON: Record<BudgetPrecheckStatus, typeof CheckCircle2> = { ok: CheckCircle2, check: CircleAlert, na: CircleDashed };
const NAME: Record<BudgetPrecheckStatus, string> = { ok: "이상 없음", check: "확인 필요", na: "점검 못함" };
const TONE: Record<BudgetPrecheckStatus, string | undefined> = { ok: "ok", check: "warn", na: undefined };
const VERDICT = { ok: "기준 안", over: "기준 넘음", applies: "기준 해당", unknown: "견주지 못함" } as const;

export function PrecheckPanel({ bundle, itemId, amount, year }: { bundle: BudgetBundle; itemId: string | null; amount: number; year?: number }) {
  const { openSettings } = useApp();
  const [res, setRes] = useState<BudgetPrecheck | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setError("");
    // 금액을 적는 동안 매 글자마다 부르지 않는다
    const t = window.setTimeout(() => {
      void rpc("budget_precheck", { bundle, item_id: itemId ?? undefined, amount: amount > 0 ? amount : undefined, year })
        .then((r) => { if (alive) setRes(r); })
        .catch((e) => { if (alive) { setRes(null); setError(errorText(e)); } });
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [bundle, itemId, amount, year]);

  const [memo, setMemo] = useState("");
  const args = () => ({ bundle, item_id: itemId ?? undefined, amount: amount > 0 ? amount : undefined, year, memo: memo.trim() || undefined });
  const keep = useTask<string>();
  const out = useTask<string>();
  const keepRecord = () => void keep.run(async () => {
    const r = await rpc("budget_precheck_save", args());
    precheckChanged();
    return r.id;
  });
  const exportDoc = () => void out.run(async () => exportPrecheck(await rpc("budget_precheck_record", args())));

  const count = (s: BudgetPrecheckStatus) => res?.items.filter((i) => i.status === s).length ?? 0;
  return (
    <section className="kd-bcard" aria-label="집행 전 점검표">
      <span className="kd-label flex items-center gap-1"><ClipboardCheck size={14} aria-hidden="true" /> 집행 전 점검표</span>
      {error && <Note tone="err">{error}</Note>}
      {res && (
        <>
          <p className="kd-small kd-muted">이상 없음 {count("ok")} · 확인 필요 {count("check")} · 점검 못함 {count("na")}</p>
          <ul className="flex flex-col gap-2">
            {res.items.map((it) => {
              const Icon = ICON[it.status];
              return (
                <li key={it.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon size={15} aria-hidden="true" />
                    <b className="kd-small">{it.label}</b>
                    <span className="kd-badge" data-tone={TONE[it.status]}>{NAME[it.status]}</span>
                    <span className="kd-small min-w-0 flex-1">{it.summary}</span>
                  </div>
                  {it.details.length > 0 && <ul className="kd-small kd-muted pl-6">{it.details.map((d) => <li key={d}>{d}</li>)}</ul>}
                  {it.clauses && it.clauses.length > 0 && (
                    <ul className="kd-small flex flex-col gap-1 pl-6">
                      {it.clauses.map((c, i) => (
                        <li key={`${c.guide}#${c.no}#${c.rule}#${i}`}>
                          <span className="kd-badge" data-tone={c.verdict === "ok" ? "ok" : c.verdict === "unknown" ? undefined : "warn"}>{VERDICT[c.verdict]}</span>{" "}
                          <b>{c.no}</b>{c.title ? `(${c.title})` : ""} · "{c.rule}" <span className="kd-muted">· {c.guide}</span>
                          <span className="kd-muted block">{c.note}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {it.id === "docs" && (
                    <span className="kd-small kd-muted pl-6">
                      {res.docs_source === "default" ? "필요 서류 목록은 일반적인 관행의 기본값(추정)입니다. " : "필요 서류 목록은 설정에서 정한 기준입니다. "}
                      <button type="button" className="kd-link" onClick={() => openSettings("set-budget")}>설정에서 고치기</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="kd-small kd-muted">{res.caveat}</p>
          <label className="kd-field">
            <span className="kd-label">메모 (선택)</span>
            <input className="kd-input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 1차 점검, 견적서 보완 요청 예정" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={keepRecord} isLoading={keep.busy}><Archive size={13} /> 점검 기록 보관</Button>
            <Button size="sm" variant="secondary" onClick={exportDoc} isLoading={out.busy}><FileDown size={13} /> 점검표 HWPX로 저장</Button>
          </div>
          <ErrorLine message={keep.error || out.error} />
          {keep.result && !keep.busy && <Note tone="ok">점검 기록을 이 PC에 보관했습니다. 아래 "보관한 점검 기록"에서 다시 열 수 있습니다.</Note>}
          {out.result && !out.busy && <SavedFile path={out.result} label="점검표를 저장했습니다" />}
          <p className="kd-small kd-muted">보관·저장하는 기록에는 계좌번호 중간 3자리를 가리고, 파일 경로는 넣지 않습니다. 화면의 지급할 곳은 원본 그대로입니다.</p>
        </>
      )}
    </section>
  );
}
