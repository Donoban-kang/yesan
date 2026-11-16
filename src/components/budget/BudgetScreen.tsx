/** 예산 현황 — 회계 구분(대학회계·글로컬·육성사업 등)별 합계, 과목마다 예산·집행·품의 중·가용 잔액·집행률.
 *  과목표 엑셀 불러오기(칸 맞춰 보기 → 불러오기), 과목 직접 더하기, 추천 낱말 고치기, 현황 엑셀 */

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Plus, Sheet, Tags, Upload } from "lucide-react";
import type { BudgetImportResult, BudgetItemView, BudgetMapping } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Field, SelectField, TextField } from "../common/Field";
import { Empty, ErrorLine, Note, SavedFile, Working } from "../common/Status";
import { BUDGET_FILTER, budgetChanged, itemPath, parseWon, useBudgetBook, won } from "./useBudget";
import "./budget.css";

const MAP_FIELDS: Array<{ key: keyof BudgetMapping; label: string; need?: boolean }> = [
  { key: "name", label: "과목", need: true }, { key: "budget", label: "예산액", need: true }, { key: "spent", label: "집행액" },
  { key: "account", label: "회계 구분" }, { key: "program", label: "정책사업" }, { key: "unit", label: "단위사업" }, { key: "detail", label: "세부사업" }, { key: "code", label: "과목 코드" },
];
const UNITS = [{ value: "1", label: "원" }, { value: "1000", label: "천원" }, { value: "10000", label: "만원" }, { value: "1000000", label: "백만원" }];

export function BudgetScreen({ active }: { active: boolean }) {
  const { toast, settings, go } = useApp();
  const { book, error, reload } = useBudgetBook(active);
  const [filter, setFilter] = useState("");
  const [importPath, setImportPath] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BudgetItemView | null>(null);
  const exporting = useTask<{ output_path: string; items: number; entries: number }>();
  const warnAt = settings?.budget?.warn_at ?? 90;

  const accounts = book?.accounts ?? [];
  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? id;
  // 회계 구분은 설정에 적은 차례로, 그 안에서는 사업·과목 이름 차례로
  const items = useMemo(() => {
    const order = new Map((book?.accounts ?? []).map((a, i) => [a.id, i]));
    return (book?.items ?? []).filter((x) => !filter || x.account === filter)
      .sort((a, b) => (order.get(a.account) ?? 99) - (order.get(b.account) ?? 99) || itemPath(a).localeCompare(itemPath(b), "ko") || a.name.localeCompare(b.name, "ko"));
  }, [book, filter]);

  const pickImport = () => void pickFiles({ filters: BUDGET_FILTER, multiple: false }).then((p) => { if (p[0]) setImportPath(p[0]); });
  const shownTotals = filter ? accounts.find((a) => a.id === filter) : book?.totals;

  let lastGroup = "";
  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="예산 현황" sub={`회계연도 ${book?.year ?? ""} · 회계 구분과 과목마다 예산, 집행, 품의 중, 가용 잔액을 봅니다.`}
        actions={(
          <>
            {!!book?.items.length && <Button variant="ghost" onClick={() => void exporting.run(() => rpc("budget_export", {}))} disabled={exporting.busy}><Sheet size={15} /> 현황 엑셀</Button>}
            <Button variant="ghost" onClick={() => setAdding(true)}><Plus size={15} /> 과목 더하기</Button>
            <Button variant="secondary" onClick={pickImport}><Upload size={15} /> 과목표 불러오기</Button>
          </>
        )} />
      <div className="kd-body">
        <div className="kd-budget">
          <ErrorLine message={error || exporting.error} />
          {exporting.result && <SavedFile path={exporting.result.output_path} label={`예산 현황·지출 대장을 엑셀로 저장했습니다 (과목 ${exporting.result.items}개, 기록 ${exporting.result.entries}줄)`} />}
          {book && book.items.length === 0 ? (
            <div className="kd-dropzone">
              <Empty icon={<FileSpreadsheet size={30} />} title="예산 과목표 없음"
                action={(
                  <>
                    <Button onClick={pickImport}><Upload size={14} /> 과목표 엑셀 불러오기</Button>
                    <Button variant="secondary" onClick={() => setAdding(true)}><Plus size={14} /> 과목 직접 더하기</Button>
                  </>
                )}>
                회계 시스템에서 내려받은 예산 현황 엑셀(XLSX·XLS·CSV)을 불러오면 과목·예산액·집행액 칸을 알아봅니다.
              </Empty>
            </div>
          ) : book && (
            <>
              <div className="kd-tiles" role="group" aria-label="회계 구분 거르기">
                <button type="button" className="kd-tile" aria-pressed={!filter} onClick={() => setFilter("")}>
                  <span className="kd-tile-k">전체</span>
                  <span className="kd-tile-v">{won(book.totals.avail)}원</span>
                  <span className="kd-small kd-muted">예산 {won(book.totals.budget)}원 · 집행률 {book.totals.rate}%</span>
                </button>
                {accounts.map((a) => (
                  <button key={a.id} type="button" className="kd-tile" aria-pressed={filter === a.id} onClick={() => setFilter(filter === a.id ? "" : a.id)}>
                    <span className="kd-tile-k">{a.label} · 과목 {a.items}개</span>
                    <span className="kd-tile-v">{won(a.avail)}원</span>
                    <span className="kd-small kd-muted">예산 {won(a.budget)}원 · 집행률 {a.rate}%</span>
                  </button>
                ))}
              </div>
              {shownTotals && <p className="kd-small kd-muted">큰 숫자는 가용 잔액(예산 − 집행 − 품의 중)입니다. 집행률은 품의를 포함합니다.</p>}
              <div className="kd-table-wrap">
                <table className="kd-table kd-budget-table" aria-label="과목별 예산 현황">
                  <thead>
                    <tr><th>과목</th><th className="kd-r">예산액</th><th className="kd-r">집행액</th><th className="kd-r">품의 중</th><th className="kd-r">가용 잔액</th><th style={{ minWidth: 140 }}>집행률</th><th>상태</th><th aria-label="동작" /></tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const g = `${label(it.account)} › ${itemPath(it) || "사업 없음"}`;
                      const head = g !== lastGroup;
                      lastGroup = g;
                      const tone = it.avail < 0 ? "err" : it.rate >= warnAt ? "warn" : "ok";
                      return [
                        head && <tr key={`g-${g}`} className="kd-group"><td colSpan={8}>{g}</td></tr>,
                        <tr key={it.id} data-retired={!!it.retired}>
                          <td><span className="font-semibold">{it.name}</span>{it.code && <span className="kd-small kd-muted"> ({it.code})</span>}
                            {it.keywords.length > 0 && <span className="kd-small kd-muted block">추천 낱말: {it.keywords.join(", ")}</span>}</td>
                          <td className="kd-r">{won(it.budget)}</td><td className="kd-r">{won(it.paid)}</td><td className="kd-r">{won(it.commit)}</td>
                          <td className="kd-r"><b>{won(it.avail)}</b></td>
                          <td>
                            <div className="kd-bar"><span className="kd-bar-paid" style={{ width: `${Math.min(100, (it.paid / Math.max(1, it.budget)) * 100)}%` }} /><span className="kd-bar-commit" style={{ width: `${Math.min(100, (it.commit / Math.max(1, it.budget)) * 100)}%` }} /></div>
                            <span className="kd-small kd-num">{it.rate.toFixed(1)}%</span>
                          </td>
                          <td>{it.retired ? <span className="kd-badge">과목표에 없음</span> : <span className="kd-badge" data-tone={tone}>{tone === "err" ? "초과" : tone === "warn" ? "경고" : "여유"}</span>}</td>
                          <td><Button size="sm" variant="ghost" onClick={() => setEditing(it)} data-tip="추천 낱말·예산액 고치기"><Tags size={13} /> 고치기</Button></td>
                        </tr>,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              <p className="kd-small kd-muted">
                {book.imports.length ? `마지막 불러오기: ${book.imports[book.imports.length - 1].file} (${book.imports[book.imports.length - 1].at.slice(0, 10)}). ` : ""}
                잔액은 업무 참고용 추정치입니다. 공식 집행·결산은 기관 회계 시스템 기준입니다.
                <button type="button" className="kd-link ml-1" onClick={() => go("spend")}>지출 도우미로</button>
              </p>
            </>
          )}
        </div>
      </div>
      {importPath && <ImportDialog path={importPath} onClose={() => setImportPath(null)} onDone={(r) => { setImportPath(null); budgetChanged(); void reload(); toast(`과목표를 불러왔습니다: 새 과목 ${r.added}개, 이어 받은 과목 ${r.updated}개`, "success"); }} />}
      {adding && <AddItemDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); budgetChanged(); toast("과목을 더했습니다", "success"); }} />}
      {editing && <EditItemDialog item={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); budgetChanged(); toast("과목을 고쳤습니다", "success"); }} />}
    </div>
  );
}

/** 과목표 불러오기: 먼저 저장하지 않고 읽어(dry_run) 칸·단위·미리보기를 보인 뒤 불러온다 */
function ImportDialog({ path, onClose, onDone }: { path: string; onClose: () => void; onDone: (r: BudgetImportResult) => void }) {
  const { settings } = useApp();
  const accounts = settings?.budget?.accounts ?? [];
  const [mapping, setMapping] = useState<BudgetMapping | null>(null);
  const [unit, setUnit] = useState<string>("");
  const [account, setAccount] = useState(accounts[0]?.id ?? "univ");
  const preview = useTask<BudgetImportResult>({ keepOnFail: true });
  const saving = useTask<BudgetImportResult>();

  const params = () => ({ path, account, mapping: mapping ?? undefined, unit: unit ? Number(unit) : undefined });
  const look = () => void preview.run(async ({ signal, onProgress }) => {
    const r = await rpc("budget_import", { ...params(), dry_run: true }, { signal, onProgress });
    if (!mapping) setMapping(r.mapping);
    if (!unit) setUnit(String(r.unit));
    return r;
  });
  // 처음 열 때 한 번 읽는다 (path 가 바뀌면 새 대화상자로 다시 연다)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { look(); }, []);

  const r = preview.result;
  const ok = !!mapping && mapping.budget !== undefined && (mapping.name !== undefined || mapping.detail !== undefined);
  const save = async () => {
    const done = await saving.run(() => rpc("budget_import", params()));
    if (done) onDone(done);
  };

  return (
    <Modal isOpen onClose={onClose} title="예산 과목표 불러오기" size="lg"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>닫기</Button>
          <Button variant="secondary" onClick={look} disabled={preview.busy}>다시 읽어 보기</Button>
          <Button onClick={() => void save()} disabled={!ok || !r?.preview.length || saving.busy} isLoading={saving.busy}>불러오기</Button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className="kd-small kd-muted">{baseName(path)} · 원본 파일은 고치지 않습니다. 같은 과목을 다시 불러오면 지출 기록을 이어 갑니다.</p>
        {preview.busy && <Working label="과목표를 읽는 중" progress={preview.progress} />}
        <ErrorLine message={preview.error || saving.error} />
        {r && (
          <>
            <div className="kd-mapgrid">
              {MAP_FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label}${f.need ? " (꼭)" : ""}`}>
                  <select className="kd-select" value={mapping?.[f.key] ?? ""} onChange={(e) => setMapping({ ...(mapping ?? {}), [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                    <option value="">없음</option>
                    {r.header.map((h, i) => <option key={i} value={i}>{h || `${i + 1}번째 칸`}</option>)}
                  </select>
                </Field>
              ))}
              <SelectField label="금액 단위" value={unit || "1"} onChange={setUnit} options={UNITS} />
              <SelectField label="회계 구분 칸이 비면" value={account} onChange={setAccount} options={accounts.map((a) => ({ value: a.id, label: a.label }))} />
            </div>
            {r.warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
            {r.preview.length > 0 && (
              <div className="kd-table-wrap" style={{ maxHeight: 260 }}>
                <table className="kd-table kd-budget-table">
                  <thead><tr><th>회계</th><th>사업</th><th>과목</th><th className="kd-r">예산액(원)</th><th className="kd-r">집행액(원)</th></tr></thead>
                  <tbody>
                    {r.preview.map((p, i) => (
                      <tr key={i}><td>{accounts.find((a) => a.id === p.account)?.label ?? p.account}</td><td className="kd-small">{itemPath(p)}</td><td>{p.name}</td><td className="kd-r">{won(p.budget)}</td><td className="kd-r">{won(p.spent_before)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="kd-small">과목 {r.added}개 · 예산 합계 <b className="kd-num">{won(r.total_budget)}원</b>{r.added > r.preview.length ? ` (앞 ${r.preview.length}개만 보임)` : ""}. 칸·단위를 바꿨으면 "다시 읽어 보기"를 누르세요.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

function AddItemDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { settings } = useApp();
  const accounts = settings?.budget?.accounts ?? [];
  const [f, setF] = useState({ account: accounts[0]?.id ?? "univ", program: "", unit: "", detail: "", name: "", code: "", budget: "", spent: "", keywords: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await rpc("budget_item_add", {
        account: f.account, program: f.program, unit: f.unit, detail: f.detail, name: f.name, code: f.code || undefined,
        budget: parseWon(f.budget), spent_before: parseWon(f.spent), keywords: f.keywords.split(/[,，\s]+/).filter(Boolean),
      });
      onDone();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="과목 더하기"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>취소</Button><Button onClick={() => void save()} isLoading={busy} disabled={!f.name.trim() || !parseWon(f.budget)}>더하기</Button></div>}>
      <div className="kd-fieldgrid">
        <SelectField label="회계 구분" value={f.account} onChange={set("account")} options={accounts.map((a) => ({ value: a.id, label: a.label }))} />
        <TextField label="정책사업" value={f.program} onChange={set("program")} />
        <TextField label="단위사업" value={f.unit} onChange={set("unit")} />
        <TextField label="세부사업" value={f.detail} onChange={set("detail")} />
        <TextField label="과목 (꼭)" value={f.name} onChange={set("name")} placeholder="예: 국내여비" />
        <TextField label="과목 코드" value={f.code} onChange={set("code")} />
        <TextField label="예산액 (원, 꼭)" value={f.budget} onChange={set("budget")} placeholder="예: 2,400,000" />
        <TextField label="기집행액 (원)" value={f.spent} onChange={set("spent")} />
        <TextField label="추천 낱말" hint="쉼표로 나눔. 공문에 이 낱말이 나오면 이 과목을 추천합니다" value={f.keywords} onChange={set("keywords")} />
      </div>
      <ErrorLine message={err} />
    </Modal>
  );
}

function EditItemDialog({ item, onClose, onDone }: { item: BudgetItemView; onClose: () => void; onDone: () => void }) {
  const [keywords, setKeywords] = useState(item.keywords.join(", "));
  const [budget, setBudget] = useState(won(item.budget));
  const [spent, setSpent] = useState(won(item.spent_before));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await rpc("budget_item_update", { id: item.id, keywords: keywords.split(/[,，]+/).map((k) => k.trim()).filter(Boolean), budget: parseWon(budget), spent_before: parseWon(spent) });
      onDone();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`과목 고치기: ${item.name}`}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>취소</Button><Button onClick={() => void save()} isLoading={busy}>저장</Button></div>}>
      <div className="flex flex-col gap-3">
        <p className="kd-small kd-muted">{itemPath(item) || "사업 없음"}</p>
        <TextField label="추천 낱말" hint="쉼표로 나눔. 공문 제목·본문에 나오면 이 과목을 먼저 추천합니다" value={keywords} onChange={setKeywords} placeholder="예: 버스, 대절, 현장체험" />
        <div className="kd-fieldgrid">
          <TextField label="예산액 (원)" value={budget} onChange={setBudget} />
          <TextField label="기집행액 (원)" hint="과목표를 다시 불러오면 그 값으로 바뀝니다" value={spent} onChange={setSpent} />
        </div>
        <ErrorLine message={err} />
      </div>
    </Modal>
  );
}
