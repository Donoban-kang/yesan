/** 나눠 반영 (F-09) — 결의서 예산 줄이 여럿이면 줄마다 과목을 골라 한 번에 반영 (budget_apply_split)
 *  줄마다 그 줄의 과목·금액으로 추천한 1순위를 미리 골라 둔다. 모두 되거나 하나도 안 되고, 지출 대장에서 한 번 취소하면 함께 취소된다 */

import { useEffect, useMemo, useState } from "react";
import { Check, Split } from "lucide-react";
import type { BudgetAnalysis, BudgetItemView } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { Button } from "../ui/Button";
import { Note } from "../common/Status";
import { budgetChanged, itemPath, won } from "./useBudget";

type Line = NonNullable<BudgetAnalysis["budget_lines"]>[number];
type Stage = "commit" | "paid";

export function SplitApply({ analysis, items, label, already, onAgain, again }: {
  analysis: BudgetAnalysis;
  items: BudgetItemView[];
  label: (id: string) => string;
  /** 이 결의서를 이미 반영했는가 (경로·결의번호) */
  already: boolean;
  /** "다른 과목에 나눠 더 반영하기"가 켜져 있는가 */
  again: boolean;
  onAgain: (v: boolean) => void;
}) {
  const lines: Line[] = useMemo(() => analysis.budget_lines ?? [], [analysis]);
  const [pick, setPick] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>("commit");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const live = useMemo(() => items.filter((x) => !x.retired), [items]);

  // 줄마다 그 줄로 추천한 1순위를 미리 고른다
  useEffect(() => {
    let alive = true;
    setDone(null); setError(""); setConfirming(false);
    // 결의서 전체 글로 찾으면 다른 줄의 낱말(사업명 등)에 끌려 줄마다 같은 과목이 뽑힌다 → 그 줄의 글만
    void Promise.all(lines.map((l) => rpc("budget_suggest", {
      text: [l.source, l.ledger, l.detail, l.subject].filter(Boolean).join(" "), nature: analysis.nature, amount: l.amount, sender: analysis.sender, subjects: [[l.detail, l.subject].filter(Boolean).join(" ")], limit: 1,
    }).then((s) => s[0]?.item.id ?? "").catch(() => ""))).then((ids) => { if (alive) setPick(ids); });
    return () => { alive = false; };
  }, [analysis, lines]);

  if (lines.length < 2) return null;
  const total = lines.reduce((n, l) => n + l.amount, 0);
  const ready = pick.length === lines.length && pick.every(Boolean);
  const blocked = already && !again && !done;

  const apply = async () => {
    setBusy(true); setError("");
    try {
      const r = await rpc("budget_apply_split", {
        parts: lines.map((l, i) => ({ item_id: pick[i], amount: l.amount, memo: l.detail || undefined })),
        stage, doc_path: analysis.path, doc_title: analysis.title, doc_number: analysis.doc_number, sender: analysis.sender, again,
      });
      budgetChanged();
      setDone(`${r.entries.length}줄을 과목 ${r.items.length}개에 합계 ${won(total)}원 ${stage === "commit" ? "품의" : "지출 완료"}로 반영했습니다.${r.warnings.length ? ` ${r.warnings.join(" ")}` : ""}`);
      setConfirming(false);
      onAgain(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kd-bcard flex flex-col gap-2" aria-label="줄마다 나눠 반영">
      <span className="kd-label flex items-center gap-1"><Split size={14} aria-hidden="true" /> 줄마다 나눠 한 번에 반영 · {lines.length}줄 합계 {won(total)}원</span>
      {lines.map((l, i) => (
        <label key={i} className="kd-field">
          <span className="kd-small"><b className="kd-num">{won(l.amount)}원</b> · {l.subject}{l.detail ? ` (${l.detail})` : ""}</span>
          <select className="kd-input" value={pick[i] ?? ""} onChange={(e) => { const v = [...pick]; v[i] = e.target.value; setPick(v); setConfirming(false); }}>
            <option value="">과목 고르기</option>
            {live.map((x) => (
              <option key={x.id} value={x.id}>{label(x.account)} · {itemPath(x) || "사업 없음"} · {x.name} (잔액 {won(x.avail)}원)</option>
            ))}
          </select>
        </label>
      ))}
      <div className="kd-stage" role="group" aria-label="나눠 반영 단계">
        <button type="button" aria-pressed={stage === "commit"} onClick={() => { setStage("commit"); setConfirming(false); }}>품의로 반영<small>집행 예정</small></button>
        <button type="button" aria-pressed={stage === "paid"} onClick={() => { setStage("paid"); setConfirming(false); }}>지출 완료로 반영<small>실제 지급 끝남</small></button>
      </div>
      {blocked && (
        <Note tone="warn">
          이 결의서는 이미 반영했습니다. 더 나눠 넣는 것이면 켜세요.{" "}
          <button type="button" className="kd-link kd-small" onClick={() => onAgain(true)}>다른 과목에 나눠 더 반영하기</button>
        </Note>
      )}
      {error && <Note tone="err">{error}</Note>}
      {done && <Note tone="ok">{done}</Note>}
      {!done && !blocked && (confirming ? (
        <div className="flex flex-col gap-2">
          <span className="kd-small">과목 {new Set(pick).size}개에 합계 <b className="kd-num">{won(total)}원</b>을 <b>{stage === "commit" ? "품의(집행 예정)" : "지출 완료"}</b>로 기록합니다. 한 묶음이라 지출 대장에서 한 번 취소하면 함께 취소됩니다.</span>
          <div className="flex gap-2">
            <Button onClick={() => void apply()} disabled={busy}><Check size={14} /> {busy ? "반영하는 중" : "확인하고 반영"}</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>취소</Button>
          </div>
        </div>
      ) : (
        <div><Button variant="secondary" onClick={() => setConfirming(true)} disabled={!ready}><Split size={14} /> {lines.length}줄 나눠 반영</Button></div>
      ))}
      {!ready && !done && <p className="kd-small kd-muted">줄마다 과목을 고르면 반영할 수 있습니다.</p>}
    </div>
  );
}
