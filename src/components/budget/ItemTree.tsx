/** 과목표에서 직접 찾기 — ① 세부사업(과목 수·가용 잔액 합계)을 고르면 ② 그 세부사업의 과목만, 이름·코드로도 찾는다.
 *  고르는 값(세부사업·찾는 말)은 부모가 들고 있어 추천 탭에 다녀와도 남는다 */

import { useMemo } from "react";
import { Search } from "lucide-react";
import type { BudgetItemView } from "../../lib/contract";
import { itemPath, won } from "./useBudget";

/** 세부사업 열쇠 (회계 구분 + 정책 › 단위 › 세부 경로) */
export const projectOf = (x: BudgetItemView) => `${x.account}|${itemPath(x)}`;

interface Project { key: string; label: string; count: number; avail: number }

export function ItemTree({ items, account, label, itemId, onPick, project, onProject, search, onSearch }: {
  items: BudgetItemView[];
  /** 회계 구분 id, 빈 글이면 전체 */
  account: string;
  label: (id: string) => string;
  itemId: string | null;
  onPick: (id: string) => void;
  project: string;
  onProject: (key: string) => void;
  search: string;
  onSearch: (q: string) => void;
}) {
  const inAccount = useMemo(() => items.filter((x) => !account || x.account === account), [items, account]);
  /** 세부사업마다 과목 수·가용 잔액 합계 (과목표 차례 그대로). 다시 불러온 과목표에서 빠진 과목은 세지 않는다 */
  const projects = useMemo(() => [...inAccount.reduce((m, x) => {
    const k = projectOf(x);
    const p = m.get(k) ?? { key: k, label: `${label(x.account)} › ${itemPath(x) || "사업 없음"}`, count: 0, avail: 0 };
    if (!x.retired) { p.count++; p.avail += x.avail; }
    return m.set(k, p);
  }, new Map<string, Project>()).values()], [inAccount, label]);
  // 회계 구분을 바꿔 고른 세부사업이 목록에 없으면 전체로 본다 (보이는 값과 거르는 값을 같게)
  const current = projects.some((p) => p.key === project) ? project : "";
  const q = search.trim();
  const shown = useMemo(
    () => inAccount.filter((x) => (!current || projectOf(x) === current) && (!q || `${itemPath(x)} ${x.name} ${x.code ?? ""}`.includes(q))),
    [inAccount, current, q],
  );

  return (
    <div className="flex flex-col gap-2">
      <label className="kd-field">
        <span className="kd-label">① 세부사업</span>
        <select className="kd-input" value={current} onChange={(e) => onProject(e.target.value)}>
          <option value="">전체 세부사업 ({projects.length}개)</option>
          {projects.map((p) => <option key={p.key} value={p.key}>{p.label} · 과목 {p.count}개 · 잔액 {won(p.avail)}원</option>)}
        </select>
      </label>
      <span className="kd-label">② 과목</span>
      <label className="relative block">
        <span className="sr-only">과목 찾기</span>
        <Search size={15} className="kd-muted absolute left-2.5 top-2.5" aria-hidden="true" />
        <input className="kd-input" style={{ paddingLeft: 32 }} value={search} onChange={(e) => onSearch(e.target.value)} placeholder="사업명·과목명·코드로 찾기 (예: 여비)" />
      </label>
      <div className="kd-tree">
        {shown.length === 0 ? <p className="kd-small kd-muted p-3">찾는 과목이 없습니다.</p> : shown.map((x, i) => {
          const g = `${label(x.account)} › ${itemPath(x) || "사업 없음"}`;
          const prev = shown[i - 1];
          const head = !prev || `${label(prev.account)} › ${itemPath(prev) || "사업 없음"}` !== g;
          return (
            <div key={x.id}>
              {head && <div className="kd-tree-g">{g}</div>}
              <button type="button" className="kd-tree-row" aria-pressed={itemId === x.id} onClick={() => onPick(x.id)}>
                <span className="font-semibold">{x.name}{x.code && <span className="kd-small kd-muted"> ({x.code})</span>}</span>
                <span className="kd-small kd-muted kd-num">잔액 {won(x.avail)}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
