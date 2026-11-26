/** 지출 도우미 — 받은 공문을 읽어 금액·거래 성격을 뽑고 예산 과목을 추천, 고른 과목에 반영하면 남은 예산을 바로 보인다
 *  ① 공문 ② 읽은 값 확인 ③ 과목 고르기 ④ 반영 전 잔액 확인. 반영은 늘 사람이 누르고 한 번 더 확인한다 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChartColumn, FilePlus2, NotebookPen, Sparkles, Wallet } from "lucide-react";
import type { BudgetBundle, BudgetItemView, BudgetSuggestion, RpcResult } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Seg } from "../common/Field";
import { Empty, ErrorLine, Note, Working } from "../common/Status";
import { budgetChanged, itemPath, BUNDLE_FILTER, parseWon, useBudgetBook, won } from "./useBudget";
import { VoucherDraft } from "./VoucherDraft";
import { GuideRefs } from "./GuideRefs";
import { ItemTree, projectOf } from "./ItemTree";
import { DocContent } from "./DocContent";
import { BundleDocs, BundleSummary } from "./BundleDocs";
import "./budget.css";

type InboxItem = RpcResult<"inbox_list">["items"][number];
type Stage = "commit" | "paid";

export function SpendScreen({ active }: { active: boolean }) {
  const { ready, registerDrop, dragTarget, spendIntent, go, toast, settings } = useApp();
  const { book, error: bookError } = useBudgetBook(active);
  const analysis = useTask<BudgetBundle>({ keepOnFail: true });
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [amountText, setAmountText] = useState("");
  const [account, setAccount] = useState("");
  const [suggestions, setSuggestions] = useState<BudgetSuggestion[]>([]);
  const [itemId, setItemId] = useState<string | null>(null);
  /** 사람이 과목표·같은 세부사업 목록에서 직접 고른 과목이면 금액·회계 구분을 바꿔 다시 추천해도 바꾸지 않는다 */
  const manualPick = useRef(false);
  const [pickMode, setPickMode] = useState<"suggest" | "tree">("suggest");
  const [search, setSearch] = useState("");
  /** 과목표에서 직접 찾기: 먼저 고른 세부사업(회계 › 정책 › 단위 › 세부 경로). 빈 글이면 전체 */
  const [project, setProject] = useState("");
  const [stage, setStage] = useState<Stage>("commit");
  const [memo, setMemo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [done, setDone] = useState<{ name: string; amount: number; avail: number; warning?: string } | null>(null);
  const [again, setAgain] = useState(false);

  const bundle = analysis.result;
  const a = bundle?.analysis;
  const amount = parseWon(amountText);
  const warnAt = settings?.budget?.warn_at ?? 90;
  const overBlock = settings?.budget?.over_block ?? true;
  const accounts = book?.accounts ?? [];
  const label = useCallback((id: string) => accounts.find((x) => x.id === id)?.label ?? id, [accounts]);

  // 받은 공문 목록 (할 일 먼저) — 공문을 고르는 가장 빠른 길
  useEffect(() => {
    if (!ready || !active) return;
    rpc("inbox_list", {}).then((r) => setInbox(r.items.slice(0, 6)), () => setInbox([]));
  }, [ready, active]);

  const busyRef = useRef(false);
  busyRef.current = analysis.busy;
  // 결의서 예산 줄을 하나 골랐으면 그 줄만으로 추천
  const subjectsRef = useRef<string[] | undefined>(undefined);
  const analyze = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    if (busyRef.current) { toast("앞 서류를 읽는 중입니다. 다 읽은 뒤 다시 넣으세요.", "info"); return; }
    setConfirming(false); setDone(null); setApplyError(""); setMemo(""); setAgain(false); subjectsRef.current = undefined;
    const b = await analysis.run(({ signal, onProgress }) => rpc("budget_bundle", { paths }, { signal, onProgress }));
    if (!b) return;
    const r = b.analysis;
    setAmountText(r.amount ? won(r.amount) : "");
    setStage("commit");
    setEvidenceNote("");
    setAccount(r.account_hint ?? "");
    setSuggestions(r.suggestions);
    manualPick.current = false;
    setItemId(r.suggestions[0]?.item.id ?? null);
    setPickMode(r.suggestions.length ? "suggest" : "tree");
  }, [analysis, toast]);

  // 접수함·문서 보기에서 넘겨받은 공문
  const handled = useRef(0);
  useEffect(() => {
    if (!spendIntent || !ready || spendIntent.nonce === handled.current) return;
    handled.current = spendIntent.nonce;
    void analyze([spendIntent.value.path]);
  }, [spendIntent, ready, analyze]);

  useEffect(() => registerDrop("spend", (p) => { void analyze(p); }), [registerDrop, analyze]);

  // 회계 구분·금액을 바꾸면 다시 추천 (글은 처음 읽은 것 그대로)
  const resuggest = useCallback(async (acc: string, amt: number) => {
    if (!a) return;
    try {
      const list = await rpc("budget_suggest", { text: a.basis, nature: a.nature, account: acc || undefined, amount: amt || undefined, sender: a.sender, subjects: subjectsRef.current ?? a.subjects });
      setSuggestions(list);
      setItemId((cur) => (cur && (manualPick.current || list.some((s) => s.item.id === cur)) ? cur : list[0]?.item.id ?? cur));
    } catch (e) {
      toast(`다시 추천하지 못했습니다: ${errorText(e)}`, "error");
    }
  }, [a, toast]);

  const linked = new Set(book?.linked_docs ?? []);
  // 이미 반영한 공문은 잔액에서 다시 빼 보이지 않는다 (다른 과목에 나눠 더 반영할 때만 "again")
  const linkedNos = new Set(book?.linked_numbers ?? []);
  const appliedBefore = !!a && (linked.has(a.path) || (!!a.doc_number && linkedNos.has(a.doc_number)));
  const already = appliedBefore && !again;
  /** 증빙 대조를 했으면 대장 메모에 남길 한 줄 */
  const [evidenceNote, setEvidenceNote] = useState("");
  const items = useMemo(() => (book?.items ?? []).filter((x) => !x.retired), [book]);
  const item: BudgetItemView | undefined = items.find((x) => x.id === itemId);
  const shown = already ? 0 : amount;
  const after = item ? item.avail - shown : 0;
  const over = !!item && after < 0;
  const rateAfter = item && item.budget > 0 ? ((item.paid + item.commit + shown) / item.budget) * 100 : 0;
  const warn = !!item && !over && rateAfter >= warnAt;

  const apply = async () => {
    if (!item || !a) return;
    setApplying(true); setApplyError("");
    try {
      const r = await rpc("budget_apply", {
        item_id: item.id, amount, stage, doc_path: a.path, doc_title: a.title ?? baseName(a.path), doc_number: a.doc_number, sender: a.sender,
        memo: [memo.trim(), evidenceNote].filter(Boolean).join(" / ") || undefined, again,
      });
      setDone({ name: r.item.name, amount, avail: r.item.avail, warning: r.warning });
      setConfirming(false);
      setAgain(false);
      budgetChanged();
      toast(`${r.item.name}에 ${won(amount)}원을 반영했습니다. 남은 예산 ${won(r.item.avail)}원`, "success");
    } catch (e) {
      setApplyError(errorText(e));
    } finally {
      setApplying(false);
    }
  };

  const pick = () => void pickFiles({ filters: BUNDLE_FILTER, multiple: true }).then((p) => { void analyze(p); });
  const noItems = !!book && items.length === 0;

  /** 고른 과목과 같은 세부사업의 다른 과목 (바꿔 고르기) */
  const siblings = item ? items.filter((x) => !x.retired && x.id !== item.id && projectOf(x) === projectOf(item)) : [];

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="지출 도우미" sub="지출할 공문·영수증·계좌 사본 등 서류를 함께 넣으면 서류마다 읽고, 맞는 예산 과목을 추천하고, 반영하면 남은 예산을 보여 줍니다."
        actions={(
          <>
            <Button variant="ghost" onClick={() => go("ledger")}><NotebookPen size={15} /> 지출 대장</Button>
            <Button variant="secondary" onClick={pick} disabled={analysis.busy}><FilePlus2 size={15} /> 서류 고르기</Button>
          </>
        )} />
      <div className="kd-body kd-budget-drop" data-drop="spend" data-over={dragTarget === "spend"}>
        <div className="kd-budget">
          <ErrorLine message={bookError} />
          {noItems && (
            <Note tone="warn">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>예산 과목표가 아직 없습니다. 예산 현황에서 과목표 엑셀을 불러오거나 과목을 직접 더한 뒤 추천을 받을 수 있습니다.</span>
                <Button size="sm" onClick={() => go("budget")}><ChartColumn size={14} /> 예산 현황으로</Button>
              </div>
            </Note>
          )}
          <div className="kd-spend">
            {/* ① 지출 서류 */}
            <div className="kd-spend-col">
              <div className="kd-step" data-on="true"><b>1</b>지출 서류 넣기</div>
              <button type="button" className="kd-dropzone" data-over={dragTarget === "spend"} onClick={pick} disabled={analysis.busy}>
                <FilePlus2 size={22} aria-hidden="true" />
                <span className="kd-row-title block">서류를 끌어다 놓거나 눌러서 고르기 (여러 개 함께)</span>
                <span className="kd-small kd-muted block">지출할 공문 · 영수증 · 견적서 · 세금계산서 · 계좌 사본 (HWP · HWPX · HWX · PDF · 사진)</span>
              </button>
              {inbox.length > 0 && (
                <div className="kd-docpick" aria-label="접수함의 공문">
                  <span className="kd-label">접수함에서 고르기</span>
                  {inbox.map((it) => (
                    <button key={it.id} type="button" className="kd-docopt" aria-pressed={a?.path === it.path} onClick={() => void analyze([it.path])} disabled={analysis.busy}>
                      <Wallet size={15} aria-hidden="true" className="kd-muted" />
                      <span className="min-w-0"><span className="kd-docopt-name">{it.title ?? it.name}</span><span className="kd-small kd-muted">{it.sender ?? baseName(it.path)}</span></span>
                      <span className="kd-badge" data-tone={linked.has(it.path) ? "ok" : undefined}>{linked.has(it.path) ? "반영됨" : "미연결"}</span>
                    </button>
                  ))}
                </div>
              )}
              {analysis.busy && <Working label="서류를 읽는 중" progress={analysis.progress} onCancel={analysis.cancel} />}
              <ErrorLine message={analysis.error} />
              {bundle && !analysis.busy && <BundleDocs bundle={bundle} />}
              {a && !analysis.busy && <DocContent analysis={a} />}
            </div>

            {/* ② 읽은 값 · ③ 과목 */}
            <div className="kd-spend-col">
              <div className="kd-step" data-on={!!a}><b>2</b>읽은 값 확인</div>
              {!a ? (
                <Empty icon={<Wallet size={28} />} title="서류를 넣으면 여기에 금액·목적·지급할 곳이 보입니다">AI 없이 정해진 규칙으로 읽습니다.</Empty>
              ) : (
                <div className="kd-bcard">
                  <dl className="kd-dl">
                    <div><dt>공문</dt><dd className="min-w-0">{a.title ?? a.name}{(a.doc_number || a.sender) && <span className="kd-small kd-muted block">{a.sender ? `${a.sender} · ` : ""}{a.doc_number}</span>}</dd></div>
                    {a.fiscal_year && <div><dt>회계연도</dt><dd className="kd-num">{a.fiscal_year}</dd></div>}
                    {a.nature && <div><dt>거래 성격</dt><dd><span className="kd-badge" data-tone="accent">{a.nature}</span> <span className="kd-small kd-muted">"{a.nature_words.slice(0, 3).join("·")}" 낱말로 판단</span></dd></div>}
                    {a.period && <div><dt>기간</dt><dd>{a.period}</dd></div>}
                    {a.people && <div><dt>대상</dt><dd>{a.people}</dd></div>}
                    {a.due && <div><dt>처리 기한</dt><dd className="kd-num">{a.due}까지</dd></div>}
                  </dl>
                  {a.notes.length > 0 && <Note tone="info">{a.notes.join(" · ")}</Note>}
                  {a.fiscal_year && book && a.fiscal_year !== book.year && (
                    <Note tone="warn">문서는 {a.fiscal_year}회계연도인데 지금 장부는 {book.year}회계연도입니다. 맞는 장부에 반영하려면 설정 › 예산과 회계에서 회계연도를 바꾸세요.</Note>
                  )}
                  {bundle && <BundleSummary bundle={bundle} />}
                  <label className="kd-field">
                    <span className="kd-label">금액 (원)</span>
                    <input className="kd-input kd-amount-input" inputMode="numeric" value={amountText} data-low={!a.amounts[0] || a.amounts[0].confidence < 0.6}
                      onChange={(e) => { setAmountText(e.target.value.replace(/[^\d,]/g, "")); setConfirming(false); }}
                      onBlur={() => { const n = parseWon(amountText); setAmountText(n ? won(n) : ""); void resuggest(account, n); }} placeholder="공문에서 금액을 찾지 못했습니다. 직접 적으세요." />
                  </label>
                  {a.amounts[0] && (
                    <p className="kd-small kd-muted">근거: "{a.amounts[0].source}"{a.amounts[0].confidence < 0.6 && " · 확실하지 않으니 공문과 견줘 확인하세요"}</p>
                  )}
                  {a.amounts.length > 1 && (
                    <div className="kd-amount-alt" aria-label="다른 금액 후보">
                      {a.amounts.slice(1, 5).map((x) => (
                        <button key={x.value} type="button" className="kd-chip" data-tip={x.source} onClick={() => { setAmountText(won(x.value)); void resuggest(account, x.value); }}>{won(x.value)}원</button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="kd-step" data-on={!!a}><b>3</b>예산 과목 고르기</div>
              {accounts.length > 0 && (
                <Seg label="회계 구분" value={account} onChange={(v) => { setAccount(v); manualPick.current = false; void resuggest(v, amount); }}
                  options={[{ value: "", label: "전체" }, ...accounts.map((x) => ({ value: x.id, label: x.label }))]} />
              )}
              <Seg label="고르는 방법" value={pickMode} onChange={setPickMode} options={[{ value: "suggest", label: `추천 ${suggestions.length}` }, { value: "tree", label: "과목표에서 직접 찾기" }]} />
              {pickMode === "suggest" ? (
                <div role="radiogroup" aria-label="추천 예산 과목" className="flex flex-col gap-2">
                  {!a ? <p className="kd-small kd-muted">공문을 읽으면 맞는 과목을 추천합니다.</p>
                    : suggestions.length === 0 ? <Note tone="info">맞는 과목을 찾지 못했습니다. 과목표에서 직접 찾으세요. 과목에 추천 낱말을 더하면 다음부터 찾습니다(예산 현황).</Note>
                      : suggestions.map((s, i) => (
                        <button key={s.item.id} type="button" role="radio" aria-checked={itemId === s.item.id} className="kd-sug" onClick={() => { manualPick.current = false; setItemId(s.item.id); setConfirming(false); }}>
                          <span className="kd-sug-radio" aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="kd-sug-path block">{label(s.item.account)} · {itemPath(s.item) || "사업 없음"}</span>
                            <span className="kd-sug-name block">{s.item.name}</span>
                            <span className="kd-chips">{s.reasons.map((r) => <span key={r} className="kd-badge" data-tone={r === "잔액 부족" ? "err" : r === "잔액 충분" ? "ok" : r.startsWith("거래") ? "accent" : undefined}>{r}</span>)}</span>
                          </span>
                          <span className="kd-sug-score"><b>{s.score}</b>{i + 1}순위</span>
                        </button>
                      ))}
                  {a && suggestions.length > 0 && <p className="kd-small kd-muted flex items-center gap-1"><Sparkles size={13} aria-hidden="true" /> 점수는 순서를 정할 뿐 확률이 아닙니다. 근거를 보고 고르세요.</p>}
                </div>
              ) : (
                <ItemTree items={items} account={account} label={label} itemId={itemId} onPick={(id) => { manualPick.current = true; setItemId(id); setConfirming(false); }}
                  project={project} onProject={setProject} search={search} onSearch={setSearch} />
              )}
              <GuideRefs analysis={a ?? null} item={item} year={book?.year} />
            </div>

            {/* ④ 잔액 */}
            <div className="kd-spend-col">
              <div className="kd-step" data-on={!!item}><b>4</b>반영 전 잔액 확인</div>
              {!item ? (
                <Note tone="info">예산 과목을 고르면 반영 전후 잔액이 보입니다.</Note>
              ) : (
                <div className="kd-bcard">
                  <div>
                    <span className="kd-sug-path block">{label(item.account)} · {itemPath(item) || "사업 없음"}</span>
                    <span className="kd-sug-name block" style={{ marginBottom: 0 }}>{item.name}</span>
                  </div>
                  {siblings.length > 0 && (
                    <label className="kd-field">
                      <span className="kd-small kd-muted">같은 세부사업의 다른 과목으로 바꾸기</span>
                      <select className="kd-input" value="" onChange={(e) => { if (e.target.value) { manualPick.current = true; setItemId(e.target.value); setConfirming(false); } }}>
                        <option value="">과목 {siblings.length + 1}개 중 고르기</option>
                        {siblings.map((x) => <option key={x.id} value={x.id}>{x.name}{x.code ? ` (${x.code})` : ""} · 잔액 {won(x.avail)}원</option>)}
                      </select>
                    </label>
                  )}
                  <div>
                    <span className="kd-small kd-muted">{already ? "지금 가용 잔액" : "반영 후 가용 잔액"}</span>
                    <div className="kd-big" data-over={over}>{over ? "−" : ""}{won(Math.abs(after))}<small> 원</small></div>
                  </div>
                  <BalanceBar item={item} amount={shown} />
                  <dl className="kd-calc">
                    <dt>예산액</dt><dd>{won(item.budget)}</dd>
                    <dt>집행액</dt><dd>− {won(item.paid)}</dd>
                    <dt>품의 중(집행 예정)</dt><dd>− {won(item.commit)}</dd>
                    <dt>반영 전 가용 잔액</dt><dd>{won(item.avail)}</dd>
                    <dt>이번 공문</dt><dd style={{ color: "var(--color-warning)" }}>− {won(shown)}</dd>
                    <dt className="kd-calc-sum">반영 후 가용 잔액</dt><dd className="kd-calc-sum" style={over ? { color: "var(--color-error)" } : undefined}>{won(after)}</dd>
                    <dt>집행률(품의 포함)</dt><dd>{item.rate.toFixed(1)}% → {rateAfter.toFixed(1)}%</dd>
                  </dl>
                  {already ? (
                    <Note tone="ok">이 공문은 지출 대장에 반영돼 있습니다. 위 숫자는 반영한 뒤의 잔액입니다.
                      <span className="mt-1 flex flex-wrap gap-2">
                        <button type="button" className="kd-link kd-small" onClick={() => go("ledger")}>지출 대장 보기</button>
                        <button type="button" className="kd-link kd-small" onClick={() => { setAgain(true); setDone(null); }}>다른 과목에 나눠 더 반영하기</button>
                      </span>
                    </Note>
                  ) : over ? (
                    <Note tone="err">잔액이 {won(-after)}원 모자랍니다. {overBlock ? "설정이 \"잔액을 넘는 반영 막기\"라 반영할 수 없습니다. " : ""}다른 과목을 고르거나 예산 변경(전용·추경) 여부를 회계 담당과 확인하세요.</Note>
                  ) : warn ? (
                    <Note tone="warn">반영하면 집행률이 경고 기준 {warnAt}%를 넘습니다. 남은 사업 일정을 확인하세요.</Note>
                  ) : amount > 0 ? <Note tone="ok">잔액이 충분합니다.</Note> : null}
                  {!already && <>
                  <div className="kd-stage" role="group" aria-label="반영 단계">
                    <button type="button" aria-pressed={stage === "commit"} onClick={() => { setStage("commit"); setConfirming(false); }}>품의로 반영<small>집행 예정 · 잔액에서 미리 뺌</small></button>
                    <button type="button" aria-pressed={stage === "paid"} onClick={() => { setStage("paid"); setConfirming(false); }}>지출 완료로 반영<small>실제 지급 끝남</small></button>
                  </div>
                  <label className="kd-field">
                    <span className="kd-label">메모 (선택)</span>
                    <input className="kd-input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 계약 업체, 결의서 번호" />
                  </label>
                  {confirming ? (
                    <div className="kd-confirm" role="alertdialog" aria-label="반영 확인">
                      <b>이렇게 반영할까요?</b>
                      <span className="kd-small">{item.name}에 <b className="kd-num">{won(amount)}원</b>을 <b>{stage === "commit" ? "품의(집행 예정)" : "지출 완료"}</b>로 기록합니다.{a?.doc_number ? ` 근거 공문: ${a.doc_number}` : ""}</span>
                      <span className="kd-small kd-muted">잘못 넣으면 지출 대장에서 취소 기록을 남겨 되돌릴 수 있습니다.</span>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => void apply()} isLoading={applying}><Check size={14} /> 반영하기</Button>
                        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={applying}>취소</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="lg" onClick={() => { setDone(null); setConfirming(true); }} disabled={!a || amount <= 0 || (over && overBlock)}
                      data-tip={!a ? "공문을 먼저 넣으세요." : amount <= 0 ? "금액을 적으세요." : undefined}><Check size={15} /> 예산에 반영</Button>
                  )}
                  </>}
                  <ErrorLine message={applyError} />
                  {done && !already && (
                    <Note tone={done.warning ? "warn" : "ok"}>
                      {done.name}에 {won(done.amount)}원을 반영했습니다. 남은 예산 {won(done.avail)}원.{done.warning ? ` ${done.warning}` : ""}
                      <button type="button" className="kd-link kd-small ml-2" onClick={() => go("ledger")}>지출 대장 보기</button>
                    </Note>
                  )}
                </div>
              )}
              {/* 공문으로 지출할 때만: 이미 결의서(원인행위서 등)를 넣었으면 초안은 필요 없다 */}
              {a && item && amount > 0 && (!a.doc_kind || a.doc_kind === "공문") && (
                <VoucherDraft key={`${a.path}#${item.id}`} analysis={a} item={item} amount={amount} accountLabel={label(item.account)} />
              )}
              <p className="kd-small kd-muted">잔액은 업무 참고용 추정치입니다. 공식 집행·결산은 기관 회계 시스템 기준입니다.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BalanceBar({ item, amount = 0 }: { item: BudgetItemView; amount?: number }) {
  const pct = (v: number) => (item.budget > 0 ? Math.max(0, Math.min(100, (v / item.budget) * 100)) : 0);
  const paid = pct(item.paid);
  const commit = Math.min(pct(item.commit), 100 - paid);
  const rest = Math.max(0, 100 - paid - commit);
  const over = item.avail - amount < 0;
  return (
    <>
      <div className="kd-bar" role="img" aria-label={`예산 ${won(item.budget)}원 가운데 집행 ${won(item.paid)}원, 품의 중 ${won(item.commit)}원${amount ? `, 이번 ${won(amount)}원` : ""}`}>
        <span className="kd-bar-paid" style={{ width: `${paid}%` }} />
        <span className="kd-bar-commit" style={{ width: `${commit}%` }} />
        {amount > 0 && <span className={over ? "kd-bar-over" : "kd-bar-new"} style={{ width: `${over ? rest : Math.min(rest, pct(amount))}%` }} />}
      </div>
      <div className="kd-legend"><span><i style={{ background: "var(--color-accent)" }} />집행</span><span><i style={{ background: "var(--color-accent)", opacity: 0.45 }} />품의 중</span>{amount > 0 && <span><i style={{ background: "var(--color-warning)" }} />이번 반영</span>}</div>
    </>
  );
}
