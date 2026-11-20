/** 기관 규정·지침 — 예산집행지침·회계규정 파일을 조항으로 나눠 이 PC 에 둔다 (budget_guide_*). 지출 도우미가 고른 과목의 근거 조항을 여기서 찾는다 */

import { useCallback, useEffect, useState } from "react";
import { BookOpenCheck, FilePlus2, Trash2 } from "lucide-react";
import type { BudgetGuide } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName } from "../../lib/format";
import { useApp } from "../../state/app";
import { Button } from "../ui/Button";
import { Note, Working } from "../common/Status";

/** 첫 줄이 기본(읽을 수 있는 형식 전부). 형식별로 좁히거나 "모든 파일"로 넓힐 수 있게 함께 둔다 */
const FILTER = [
  { name: "규정·지침 (읽을 수 있는 형식 전부)", extensions: ["hwp", "hwpx", "hwx", "hml", "pdf", "docx", "xlsx", "xls", "pptx", "txt", "md", "csv", "htm", "html", "png", "jpg", "jpeg"] },
  { name: "한글 문서 (HWP·HWPX·HWX)", extensions: ["hwp", "hwpx", "hwx", "hml"] },
  { name: "PDF", extensions: ["pdf"] },
  { name: "워드·엑셀·파워포인트", extensions: ["docx", "xlsx", "xls", "pptx"] },
  { name: "글자 파일 (TXT·MD·CSV·HTML)", extensions: ["txt", "md", "csv", "htm", "html"] },
  { name: "스캔 그림 (PNG·JPG)", extensions: ["png", "jpg", "jpeg"] },
  { name: "모든 파일", extensions: ["*"] },
];

export function GuideList() {
  const { toast } = useApp();
  const [guides, setGuides] = useState<BudgetGuide[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => { void rpc("budget_guide_list", {}).then(setGuides).catch((e) => setError(errorText(e))); }, []);
  useEffect(load, [load]);

  const add = async () => {
    const paths = await pickFiles({ filters: FILTER, multiple: true });
    if (!paths.length) return;
    setBusy(true);
    setError("");
    try {
      const r = await rpc("budget_guide_add", { paths });
      if (r.added.length) toast(`규정 ${r.added.length}개를 넣었습니다 (조항 ${r.added.reduce((n, g) => n + g.clauses, 0)}개)`, "success");
      if (r.failed.length) setError(r.failed.map((f) => `${baseName(f.path)}: ${f.error}`).join("\n"));
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (g: BudgetGuide) => {
    if (!window.confirm(`"${g.name}"을(를) 목록에서 뺄까요? 원본 파일은 지우지 않습니다.`)) return;
    try {
      await rpc("budget_guide_remove", { id: g.id });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="kd-label flex items-center gap-1"><BookOpenCheck size={14} aria-hidden="true" /> 기관 규정·지침</span>
      <p className="kd-small kd-muted">예산집행지침·회계규정 파일을 넣으면 지출 도우미에서 고른 과목과 맞는 조항을 "근거 조항"으로 함께 보여 줍니다. 조항으로 나눠 이 PC에만 두고 밖으로 보내지 않습니다. 원본 파일은 고치지 않습니다.</p>
      {guides && guides.length > 0 && (
        <ul className="flex flex-col gap-1">
          {guides.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 kd-small">
              <span className="min-w-0">
                <span className="font-semibold">{g.name}</span>
                <span className="kd-muted"> · {g.articles ? `조항 ${g.articles}개` : `단락 ${g.clauses}개 (조 번호 없음)`} · {g.added_at.slice(0, 10)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void remove(g)} aria-label={`${g.name} 빼기`}><Trash2 size={13} /> 빼기</Button>
            </li>
          ))}
        </ul>
      )}
      {guides && guides.length === 0 && <p className="kd-small kd-muted">아직 넣은 규정이 없습니다.</p>}
      {busy && <Working label="규정을 읽어 조항으로 나누는 중" />}
      {error && <Note tone="err"><span style={{ whiteSpace: "pre-wrap" }}>{error}</span></Note>}
      <div><Button size="sm" variant="secondary" onClick={() => void add()} disabled={busy}><FilePlus2 size={13} /> 규정 파일 넣기</Button></div>
      <p className="kd-small kd-muted">HWP·HWPX·HWX·PDF·워드·엑셀·파워포인트·그림·TXT·MD를 넣을 수 있고, 그 밖의 파일은 "모든 파일"로 골라 글자 파일로 읽어 봅니다. 스캔한 PDF는 내장 글자 읽기(OCR)로 읽어 시간이 걸릴 수 있습니다. 법령은 국가법령정보센터에서 받은 파일을 넣으면 같은 방식으로 찾습니다.</p>
    </div>
  );
}
