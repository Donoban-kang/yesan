/** 홈 예산 요약 (F-11) — 회계 구분별 집행률·가용 잔액, 아직 예산에 반영하지 않은 공문 수. 과목표를 불러오기 전에는 자리도 없다 */

import { useEffect, useState } from "react";
import { ChevronRight, Wallet } from "lucide-react";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { useBudgetBook, won } from "../budget/useBudget";
import type { InboxItem } from "../inbox/dday";
import "../budget/budget.css";

const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

export function HomeBudget({ active }: { active: boolean }) {
  const { ready, go, settings } = useApp();
  const { book } = useBudgetBook(active);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  useEffect(() => {
    if (!ready || !active) return;
    rpc("inbox_list", {}).then((r) => setInbox(r.items)).catch(() => setInbox([]));
  }, [ready, active]);

  if (!book || !book.items.length) return null;
  const warnAt = settings?.budget?.warn_at ?? 90;
  const linkedDocs = new Set(book.linked_docs);
  const linkedNos = new Set(book.linked_numbers);
  // 할 일로 남은 접수함 공문 가운데 경로·문서번호 어느 쪽으로도 반영 기록이 없는 것
  const pending = inbox.filter((it) => it.status === "todo" && !linkedDocs.has(it.path) && !(it.doc_number && linkedNos.has(it.doc_number))).length;
  const accounts = book.accounts.filter((a) => a.items > 0);

  return (
    <section className="kd-home-block" aria-labelledby="budget-t">
      <div className="kd-block-head">
        <h2 id="budget-t" className="kd-h2 flex items-center gap-2"><Wallet size={16} className="kd-muted" /> {book.year}회계연도 예산</h2>
        <button type="button" className="kd-link kd-small" onClick={() => go("budget")}>예산 현황 보기</button>
      </div>
      <div className="kd-rows">
        {accounts.map((a) => {
          const over = a.rate >= warnAt;
          return (
            <button key={a.id} type="button" className="kd-row" onClick={() => go("budget")}>
              <span className="kd-row-main">
                <span className="kd-row-title flex flex-wrap items-center gap-2">
                  {a.label}
                  <span className="kd-badge kd-num" data-tone={over ? "warn" : undefined}>집행률 {a.rate.toFixed(1)}%{over ? " · 기준 넘음" : ""}</span>
                </span>
                <span className="kd-bar block" style={{ margin: "6px 0 4px" }} role="img" aria-label={`집행 ${won(a.paid)}원, 품의 중 ${won(a.commit)}원, 예산 ${won(a.budget)}원`}>
                  <span className="kd-bar-paid" style={{ width: `${pct(a.paid, a.budget)}%` }} />
                  <span className="kd-bar-commit" style={{ width: `${pct(a.commit, a.budget)}%` }} />
                </span>
                <span className="kd-row-desc block kd-num">가용 잔액 {won(a.avail)}원 · 예산 {won(a.budget)}원</span>
              </span>
            </button>
          );
        })}
        {pending > 0 && (
          <button type="button" className="kd-row" onClick={() => go("spend")}>
            <span className="kd-row-main">
              <span className="kd-row-title block">아직 예산에 반영하지 않은 공문 <b className="kd-num">{pending}</b>건</span>
              <span className="kd-row-desc block">접수함에서 할 일로 남은 공문입니다. 지출 도우미에서 과목을 골라 반영하세요.</span>
            </span>
            <ChevronRight size={14} className="kd-muted" />
          </button>
        )}
      </div>
    </section>
  );
}
