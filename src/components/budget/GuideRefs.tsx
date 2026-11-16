/** 근거 조항 — 고른 예산 과목·공문과 맞는 기관 규정·지침 조항을 보인다 (budget_guide_find, 이 PC 안에서만 찾음)
 *  근거를 찾아 보이는 데까지만 한다. 집행 가능 여부는 담당자가 원문과 회계 담당 확인으로 정한다 */

import { useEffect, useState } from "react";
import { BookOpenCheck, ChevronDown, ChevronUp } from "lucide-react";
import type { BudgetAnalysis, BudgetGuideMatch, BudgetItemView } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { useApp } from "../../state/app";
import { Note } from "../common/Status";

/** 글 속 낱말을 굵게 */
function Marked({ text, terms }: { text: string; terms: string[] }) {
  const ts = terms.filter((t) => t.length >= 2).sort((a, b) => b.length - a.length);
  if (!ts.length) return <>{text}</>;
  const esc = ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${esc.join("|")})`, "g"));
  return <>{parts.map((p, i) => (ts.includes(p) ? <mark key={i} className="kd-guide-mark">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

export function GuideRefs({ analysis, item, year }: { analysis: BudgetAnalysis | null; item?: BudgetItemView; year?: number }) {
  const { openSettings } = useApp();
  const [guides, setGuides] = useState<number | null>(null);
  const [matches, setMatches] = useState<BudgetGuideMatch[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void rpc("budget_guide_list", {}).then((g) => { if (alive) setGuides(g.length); }).catch(() => { if (alive) setGuides(0); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!guides || !item) { setMatches([]); return; }
    let alive = true;
    setError("");
    const t = window.setTimeout(() => {
      void rpc("budget_guide_find", { text: analysis?.basis ?? "", item_id: item.id, year, nature: analysis?.nature, limit: 4 })
        .then((m) => { if (alive) { setMatches(m); setOpen(null); } })
        .catch((e) => { if (alive) setError(errorText(e)); });
    }, 150);
    return () => { alive = false; window.clearTimeout(t); };
  }, [guides, item, analysis, year]);

  const toggle = async (m: BudgetGuideMatch) => {
    const key = `${m.guide_id}|${m.no}`;
    if (open === key) { setOpen(null); return; }
    setOpen(key);
    if (!full[key]) {
      try {
        const c = await rpc("budget_guide_clause", { id: m.guide_id, no: m.no });
        setFull((f) => ({ ...f, [key]: c.text }));
      } catch (e) { setError(errorText(e)); }
    }
  };

  if (guides === null || !item) return null;
  if (guides === 0) {
    return (
      <p className="kd-small kd-muted flex flex-wrap items-center gap-1">
        <BookOpenCheck size={13} aria-hidden="true" /> 기관 예산집행지침·회계규정을 넣으면 고른 과목의 근거 조항을 함께 보여 줍니다.
        <button type="button" className="kd-link kd-small" onClick={() => openSettings("set-budget")}>규정 넣기</button>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" aria-label="근거 조항">
      <span className="kd-label flex items-center gap-1"><BookOpenCheck size={14} aria-hidden="true" /> 근거 조항 · {item.name}</span>
      {error && <Note tone="err">{error}</Note>}
      {!error && matches.length === 0 && <p className="kd-small kd-muted">넣어 둔 규정에서 이 과목과 맞는 조항을 찾지 못했습니다. 과목 이름이 규정의 말과 다르면 예산 현황에서 과목에 추천 낱말을 더하세요.</p>}
      {matches.map((m) => {
        const key = `${m.guide_id}|${m.no}`;
        const isOpen = open === key;
        return (
          <div key={key} className="kd-guide">
            <button type="button" className="kd-guide-head" aria-expanded={isOpen} onClick={() => void toggle(m)}>
              <span className="min-w-0">
                <span className="kd-sug-path block">{m.guide}{m.chapter ? ` · ${m.chapter}` : ""}</span>
                <span className="font-semibold">{m.no}{m.title ? ` (${m.title})` : ""}</span>
              </span>
              {isOpen ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
            </button>
            <p className="kd-small kd-guide-text"><Marked text={isOpen && full[key] ? full[key] : m.snippet} terms={m.terms} /></p>
            {m.amounts.length > 0 && (
              <span className="kd-chips">{m.amounts.map((a) => <span key={a} className="kd-badge" data-tone="warn">금액 기준 {a}</span>)}</span>
            )}
          </div>
        );
      })}
      {matches.length > 0 && <p className="kd-small kd-muted">낱말이 맞는 조항을 찾아 보인 것입니다. 집행할 수 있는지는 규정 원문을 읽고 회계 담당과 확인하세요.</p>}
    </div>
  );
}
