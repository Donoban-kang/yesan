/** 브라우저 미리보기용 예산 목 — 가상의 가온대학교 2026 장부. 잔액·추천 계산은 엔진과 같은 순수 함수를 그대로 쓴다 */

import type { BudgetAnalysis, BudgetBookView, BudgetEntry, BudgetItem, RpcMethod, RpcParams, RpcResult, Settings } from "./contract";
import { linkedDocs, reversedGroups, reversibleGroups, settledCommits, viewOf } from "../../node-sidecar/src/core/budget/tally";
import { suggestItems } from "../../node-sidecar/src/core/budget/suggest";

export const MOCK_BUDGET_SETTINGS: Settings["budget"] = {
  year: 2026,
  warn_at: 90,
  over_block: true,
  accounts: [
    { id: "univ", label: "대학회계", words: ["대학회계", "등록금", "교비"] },
    { id: "glocal", label: "글로컬", words: ["글로컬"] },
    { id: "growth", label: "육성사업", words: ["육성사업", "국립대학육성", "대학육성"] },
  ],
  rules: [
    { nature: "임차", words: ["임차", "대절", "버스", "대여", "렌탈"], hints: ["임차", "임대"] },
    { nature: "구입", words: ["구입", "구매", "기자재", "물품", "장비"], hints: ["구입", "자산", "기자재", "재료", "수용비", "소모품"] },
    { nature: "여비", words: ["출장", "여비", "교통비", "숙박"], hints: ["여비"] },
    { nature: "수당", words: ["강사", "수당", "사례비", "자문료", "심사비", "원고료"], hints: ["수당", "사례", "인건비"] },
    { nature: "회의", words: ["회의", "간담회", "다과", "협의회", "식대"], hints: ["회의", "협의회", "업무추진"] },
    { nature: "행사", words: ["행사", "포럼", "세미나", "설명회", "박람회", "캠프"], hints: ["행사", "운영비"] },
  ],
};

const D = "/Users/kim/Documents/받은 공문";
const items: BudgetItem[] = [
  { id: "u1", account: "univ", program: "학생 지원", unit: "진로·취업", detail: "진로체험 운영", name: "체험활동 임차료", budget: 6_000_000, spent_before: 2_150_000, keywords: ["버스", "견학"] },
  { id: "u2", account: "univ", program: "학생 지원", unit: "진로·취업", detail: "진로체험 운영", name: "외부강사 수당", budget: 3_000_000, spent_before: 1_200_000, keywords: [] },
  { id: "u3", account: "univ", program: "교육 운영", unit: "실험실습", detail: "실험 기자재 확충", name: "기자재 구입", budget: 5_000_000, spent_before: 900_000, keywords: ["현미경"] },
  { id: "u4", account: "univ", program: "교육 운영", unit: "교직원 역량", detail: "직무연수 지원", name: "국내여비", budget: 2_400_000, spent_before: 1_980_000, keywords: [] },
  { id: "g1", account: "glocal", program: "글로컬대학 30", unit: "지역 협업", detail: "지역 협업 포럼", name: "행사운영비", budget: 12_000_000, spent_before: 3_100_000, keywords: ["포럼"] },
  { id: "g2", account: "glocal", program: "글로컬대학 30", unit: "지역 협업", detail: "지역 협업 포럼", name: "외부강사 수당", budget: 4_000_000, spent_before: 600_000, keywords: [] },
  { id: "g3", account: "glocal", program: "글로컬대학 30", unit: "산학 연계", detail: "현장실습 버스", name: "차량 임차료", budget: 8_000_000, spent_before: 7_400_000, keywords: [] },
  { id: "n1", account: "growth", program: "국립대학육성", unit: "교육혁신", detail: "교수법 연수", name: "국내여비", budget: 3_600_000, spent_before: 1_100_000, keywords: [] },
  { id: "n2", account: "growth", program: "국립대학육성", unit: "교육혁신", detail: "학습공간 개선", name: "기자재 구입", budget: 20_000_000, spent_before: 15_500_000, keywords: [] },
];
const entries: BudgetEntry[] = [
  { id: "e1", group: "e1", at: "2026-10-21T01:00:00.000Z", date: "2026-10-21", item_id: "u1", amount: 650_000, stage: "paid", kind: "apply", doc_title: "현장체험(공학관) 버스 임차", by: "김예산" },
  { id: "e2", group: "e2", at: "2026-11-03T01:00:00.000Z", date: "2026-11-03", item_id: "g1", amount: 1_200_000, stage: "commit", kind: "apply", doc_title: "지역 협업 포럼 대관 품의", sender: "기획처", by: "김예산" },
];
let seq = 10;

const book = (): BudgetBookView => {
  const views = items.map((it) => viewOf(it, entries));
  const sum = (l: typeof views) => {
    const budget = l.reduce((n, x) => n + x.budget, 0);
    const paid = l.reduce((n, x) => n + x.paid, 0);
    const commit = l.reduce((n, x) => n + x.commit, 0);
    return { budget, paid, commit, avail: budget - paid - commit, rate: budget ? Math.round(((paid + commit) / budget) * 1000) / 10 : 0 };
  };
  return {
    year: 2026,
    accounts: MOCK_BUDGET_SETTINGS.accounts.map((a) => ({ id: a.id, label: a.label, items: views.filter((x) => x.account === a.id).length, ...sum(views.filter((x) => x.account === a.id)) })),
    items: views, entries: [...entries], reversible: reversibleGroups(entries), linked_docs: linkedDocs(entries),
    imports: [{ at: "2026-10-31T00:00:00.000Z", file: "2026_예산현황_1031.xlsx", sha256: "", items: items.length }], totals: sum(views),
  };
};

const LETTER = `${D}/2026 진로체험 버스 임차 협조.hwpx`;
const analysisOf = (path: string): BudgetAnalysis => {
  if (path.includes("원인행위")) {
    // 실제 원인행위서 짜임을 따른 가상 값 (사람·번호는 지어냄)
    const lines = [{ dept: "교육혁신과", ledger: "자체수입", source: "지원금(보조금)", detail: "[국립대학육성사업]지원금", subject: "물건비-여비-국내여비 (국립대학 육성사업 국내여비)", amount: 412_000 }];
    const subjects = lines.map((l) => `${l.detail} ${l.subject}`);
    const basis = ["[육성]출장여비 정산 결의 요청", ...lines.map((l) => `${l.source} ${l.detail} ${l.subject}`)].join("\n");
    const views = items.map((it) => viewOf(it, entries));
    return {
      path, name: path.split("/").pop() ?? path, format: "hwx", notes: ["HWX 파일 속 형식: 한솔 전자결재 문서", "본문 HWP을(를) 꺼내 읽었습니다"],
      doc_kind: "원인행위서", fiscal_year: 2025, resolution_no: "20251BD0000E40000001", doc_number: "20251BD0000E40000001", title: "[육성]출장여비 정산 결의 요청(교육혁신과/김*온외 1명)",
      sender: "교육혁신과", sent_date: "2026-01-08", purpose: "[육성]출장여비 정산 결의 요청", amount: 412_000,
      amounts: [{ value: 412_000, source: "원인행위서 금액 칸", confidence: 0.97, form: "결의서" }], nature: "여비", nature_words: ["여비"], account_hint: "growth",
      budget_lines: lines, basis, subjects, suggestions: suggestItems(views, entries, MOCK_BUDGET_SETTINGS, { text: basis, nature: "여비", account: "growth", amount: 412_000, subjects }),
    };
  }
  const forum = path.includes("포럼");
  const basis = forum
    ? "글로컬대학 30 지역 협업 포럼 개최 안내\n가. 일시: 2026. 12. 4.(금) 14:00\n나. 소요 예산: 금3,000,000원(행사 운영)"
    : "2026 진로체험 버스 임차 협조 요청\n버스 임차를 협조 요청하오니 2026. 11. 20.까지\n라. 소요 예산: 금1,980,000원(45인승 버스 3대, 부가세 포함)";
  const amount = forum ? 3_000_000 : 1_980_000;
  const nature = forum ? "행사" : "임차";
  const views = items.map((it) => viewOf(it, entries));
  const account = forum ? "glocal" : undefined;
  return {
    path, name: path.split("/").pop() ?? path, format: path.endsWith(".hwx") ? "hwx" : "hwpx", notes: path.endsWith(".hwx") ? ["HWX 파일 속 형식: HWPX(ZIP)"] : [],
    title: forum ? "글로컬대학 30 지역 협업 포럼 개최 안내" : "2026 진로체험 버스 임차 협조 요청",
    sender: forum ? "기획처" : "학생처", doc_number: forum ? "기획처-77" : "학생처-4021", sent_date: "2026-11-10", due: "2026-11-20",
    purpose: forum ? "지역 협업 포럼 개최" : "진로체험 버스 임차", period: forum ? "2026. 12. 4.(금) 14:00" : "2026. 11. 27.(금) 08:30~15:30", people: forum ? undefined : "학생 142명, 인솔 8명",
    amount, amounts: [{ value: amount, source: forum ? "나. 소요 예산: 금3,000,000원(행사 운영)" : "라. 소요 예산: 금1,980,000원(45인승 버스 3대, 부가세 포함)", confidence: 0.85, form: "원" }, { value: 660_000, source: "버스 1대 660,000원", confidence: 0.45, form: "원" }],
    nature, nature_words: forum ? ["포럼"] : ["임차", "버스"], ...(account ? { account_hint: account } : {}), basis,
    suggestions: suggestItems(views, entries, MOCK_BUDGET_SETTINGS, { text: basis, nature, account, amount }),
  };
};

type H = { [M in RpcMethod]?: (p: RpcParams<M>) => RpcResult<M> | Promise<RpcResult<M>> };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const budgetHandlers: H = {
  budget_book: () => book(),
  budget_analyze: async (p) => { await wait(400); return analysisOf(p.path); },
  budget_suggest: (p) => suggestItems(items.map((it) => viewOf(it, entries)), entries, MOCK_BUDGET_SETTINGS, { ...p, account: p.account || undefined }),
  budget_apply: (p) => {
    const it = items.find((x) => x.id === p.item_id)!;
    const v = viewOf(it, entries);
    if (v.avail < p.amount) throw new Error(`${it.name} 가용 잔액(${v.avail.toLocaleString("ko-KR")}원)보다 ${(p.amount - v.avail).toLocaleString("ko-KR")}원 많습니다. 다른 과목을 고르거나 예산 변경(전용·추경) 여부를 회계 담당과 확인하세요.`);
    const id = `e${++seq}`;
    const e: BudgetEntry = { id, group: id, at: new Date().toISOString(), date: "2026-11-13", item_id: it.id, amount: p.amount, stage: p.stage, kind: "apply", doc_path: p.doc_path, doc_title: p.doc_title, doc_number: p.doc_number, sender: p.sender, memo: p.memo, by: "김예산" };
    entries.push(e);
    const view = viewOf(it, entries);
    return { entries: [e], item: view, warning: view.rate >= 90 ? `${it.name} 집행률(품의 포함)이 ${view.rate}%로 경고 기준 90%를 넘었습니다.` : undefined };
  },
  budget_settle: (p) => {
    const c = entries.find((e) => e.id === p.id)!;
    if (settledCommits(entries, reversedGroups(entries)).has(c.id)) throw new Error("이미 지출 완료로 바꾼 품의입니다.");
    const group = `s${++seq}`;
    const base = { group, at: new Date().toISOString(), date: "2026-11-13", item_id: c.item_id, kind: "settle" as const, settles: c.id, doc_title: c.doc_title, sender: c.sender, by: "김예산" };
    const made: BudgetEntry[] = [{ ...base, id: `e${++seq}`, amount: -c.amount, stage: "commit", memo: "품의 정산" }, { ...base, id: `e${++seq}`, amount: p.amount ?? c.amount, stage: "paid" }];
    entries.push(...made);
    return { entries: made, item: viewOf(items.find((x) => x.id === c.item_id)!, entries) };
  },
  budget_reverse: (p) => {
    const t = entries.find((e) => e.id === p.id)!;
    if (!reversibleGroups(entries).includes(t.group)) throw new Error("이미 취소했거나 취소할 수 없는 기록입니다.");
    const group = `r${++seq}`;
    const made: BudgetEntry[] = entries.filter((e) => e.group === t.group).map((e) => ({ ...e, id: `e${++seq}`, group, at: new Date().toISOString(), date: "2026-11-13", amount: -e.amount, kind: "reverse", reverses: e.id, memo: p.reason ? `취소: ${p.reason}` : "취소" }));
    entries.push(...made);
    return { entries: made, item: viewOf(items.find((x) => x.id === t.item_id)!, entries) };
  },
  budget_import: async (p) => {
    await wait(300);
    const preview = items.map(({ account, program, unit, detail, name, code, budget, spent_before }) => ({ account, program, unit, detail, name, code, budget, spent_before }));
    return {
      header: ["회계구분", "정책사업", "단위사업", "세부사업", "과목", "예산액", "집행액"], mapping: { account: 0, program: 1, unit: 2, detail: 3, name: 4, budget: 5, spent: 6 }, unit: 1,
      preview, added: p.dry_run ? items.length : 0, updated: p.dry_run ? 0 : items.length, retired: 0, synced: 0, total_budget: items.reduce((n, x) => n + x.budget, 0),
      warnings: ["합계·소계·빈 금액 줄 3개는 뺐습니다."], saved: !p.dry_run,
    };
  },
  budget_item_add: (p) => {
    const it: BudgetItem = { id: `i${++seq}`, account: p.account, program: p.program ?? "", unit: p.unit ?? "", detail: p.detail ?? "", name: p.name, budget: p.budget, spent_before: p.spent_before ?? 0, keywords: p.keywords ?? [] };
    items.push(it);
    return viewOf(it, entries);
  },
  budget_item_update: (p) => {
    const it = items.find((x) => x.id === p.id)!;
    if (p.keywords) it.keywords = p.keywords;
    if (p.budget) it.budget = p.budget;
    if (p.spent_before !== undefined) it.spent_before = p.spent_before;
    return viewOf(it, entries);
  },
  budget_export: async () => { await wait(300); return { output_path: "/Users/kim/Documents/KorDoc AI 결과/예산현황_2026_20261113.xlsx", items: items.length, entries: entries.length }; },
};

export const MOCK_LETTERS = [LETTER, `${D}/글로컬 지역 협업 포럼 개최 안내.hwx`, `${D}/[원인행위] 출장여비 정산 결의.hwx`];
