/** 받은 공문 내용 — 지출 도우미 ① 아래에 읽은 공문의 본문을 보여 준다.
 *  "글로 보기"는 엔진이 이미 읽은 본문(budget_analyze content, HWX·스캔 포함 모든 형식), "쪽 그림"은 쪽 배치가 있는 형식(HWP·HWPX·PDF)만 render_pages 로 앞 몇 쪽.
 *  이 PC 화면에만 보이고 어디에도 보내지 않는다 */

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import type { BudgetAnalysis, PagePreview } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { Seg } from "../common/Field";
import { Working } from "../common/Status";

const LAYOUT = new Set(["hwp", "hwpx", "pdf"]);
/** 쪽 그림은 앞 몇 쪽만 (공문은 대개 1~2쪽, 결의서 묶음은 길어서) */
const MAX_PAGES = 5;

type View = "text" | "pages";

export function DocContent({ analysis }: { analysis: BudgetAnalysis }) {
  const canPages = LAYOUT.has(analysis.format);
  const [view, setView] = useState<View>("text");
  const [pages, setPages] = useState<{ count: number; list: PagePreview[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 다른 공문으로 바뀌면 글로 보기부터, 쪽 그림은 다시 그린다
  useEffect(() => { setView("text"); setPages(null); setError(""); }, [analysis.path]);

  useEffect(() => {
    if (view !== "pages" || !canPages || pages) return;
    let alive = true;
    setBusy(true);
    rpc("render_pages", { path: analysis.path, pages: `1-${MAX_PAGES}`, max_width: 720 })
      .then((r) => { if (alive) setPages({ count: r.page_count, list: r.pages }); })
      .catch((e) => { if (alive) setError(`쪽 그림을 그리지 못했습니다. 글로 보기에서 내용을 확인하세요. (${errorText(e)})`); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [view, canPages, pages, analysis.path]);

  const text = analysis.content?.trim();

  return (
    <div className="kd-bcard kd-doc-content" aria-label="받은 공문 내용">
      <div className="flex items-center justify-between gap-2">
        <span className="kd-label flex min-w-0 items-center gap-1"><FileText size={14} aria-hidden="true" /> <span className="truncate">공문 내용 · {analysis.name}</span></span>
      </div>
      {canPages && <Seg label="보는 방법" value={view} onChange={setView} options={[{ value: "text", label: "글로 보기" }, { value: "pages", label: "쪽 그림" }]} />}
      <div className="kd-doc-scroll">
        {view === "text" ? (
          text
            ? <div className="kd-doc-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>
            : <p className="kd-small kd-muted p-3">본문 글을 받지 못했습니다. 공문을 다시 넣어 보세요.</p>
        ) : busy ? (
          <Working label="쪽 그림을 그리는 중" />
        ) : error ? (
          <p className="kd-small kd-muted p-3">{error}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {pages?.list.map((p) => <img key={p.page} src={p.data_url} alt={`${p.page}쪽`} className="kd-doc-page" />)}
            {pages && pages.count > pages.list.length && <p className="kd-small kd-muted">앞 {pages.list.length}쪽만 보입니다 (모두 {pages.count}쪽). 전체는 문서 보기에서 여세요.</p>}
          </div>
        )}
      </div>
      <p className="kd-small kd-muted">이 PC 화면에만 보이고 어디에도 보내지 않습니다.</p>
    </div>
  );
}
