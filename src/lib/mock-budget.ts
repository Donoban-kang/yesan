/** 브라우저 미리보기용 예산 목 — 가상의 가온대학교 2026 장부. 잔액·추천 계산은 엔진과 같은 순수 함수를 그대로 쓴다 */

import type { BudgetAnalysis, BudgetBookView, BudgetEntry, BudgetItem, RpcMethod, RpcParams, RpcResult, Settings } from "./contract";
import { linkedDocs, linkedNumbers, reversedGroups, reversibleGroups, settledCommits, viewOf } from "../../node-sidecar/src/core/budget/tally";
import { suggestItems } from "../../node-sidecar/src/core/budget/suggest";
import { rankClauses, splitClauses } from "../../node-sidecar/src/core/budget/guide-match";
import type { BudgetBundleDoc, BudgetGuide, BudgetPrecheckRecord } from "./contract";
import { buildRecord, summaryOf } from "../../node-sidecar/src/core/budget/precheck-record";

/** 미리보기용 가상 규정 (실제 규정 아님) */
const MOCK_RULE = [
  "제1장 총칙",
  "제1조(목적) 이 지침은 가온대학교 예산의 집행에 필요한 사항을 정함을 목적으로 한다.",
  "제2장 경비별 집행 기준",
  "제10조(국내여비) ① 국내 출장 여비는 운임·일비·숙박비·식비로 나눈다. ② 숙박비는 1박당 70,000원 이내에서 실비로 지급한다.",
  "제11조(업무추진비) ① 업무추진비는 간담회·회의 경비로 쓴다. ② 간담회 식대는 1인당 30,000원 이내로 한다.",
  "제12조(일반수용비) 소모품·사무용품 구입과 인쇄비는 일반수용비로 집행한다. 1건당 500만원 이상은 계약 절차를 따른다.",
  "제13조(임차료) 버스 등 차량 임차는 임차료로 집행하고, 2개 업체 이상 견적을 받는다.",
].join("\n");
const mockGuides: Array<{ g: BudgetGuide; clauses: ReturnType<typeof splitClauses> }> = [(() => {
  const clauses = splitClauses(MOCK_RULE);
  return { g: { id: "demo-guide", name: "가온대 예산집행 지침(가상).hwp", added_at: "2026-11-14T09:00:00.000Z", clauses: clauses.length, articles: clauses.length, chars: MOCK_RULE.length, size: 48_000 }, clauses };
})()];

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
    items: views, entries: [...entries], reversible: reversibleGroups(entries), linked_docs: linkedDocs(entries), linked_numbers: linkedNumbers(entries),
    imports: [{ at: "2026-10-31T00:00:00.000Z", file: "2026_예산현황_1031.xlsx", sha256: "", items: items.length }], totals: sum(views),
  };
};

const LETTER = `${D}/2026 진로체험 버스 임차 협조.hwpx`;
const analysisOf = (path: string): BudgetAnalysis => {
  if (path.includes("원인행위")) {
    // 실제 원인행위서 짜임을 따른 가상 값 (사람·번호는 지어냄)
    // 예산 줄 둘: 나눠 반영(F-09) 미리보기용
    const lines = [
      { dept: "교육혁신과", ledger: "자체수입", source: "지원금(보조금)", detail: "[국립대학육성사업]지원금", subject: "물건비-여비-국내여비 (국립대학 육성사업 국내여비)", amount: 300_000 },
      { dept: "교육혁신과", ledger: "대학회계", source: "등록금", detail: "직무연수 지원", subject: "물건비-여비-국내여비 (교직원 직무연수)", amount: 112_000 },
    ];
    const subjects = lines.map((l) => `${l.detail} ${l.subject}`);
    const basis = ["[육성]출장여비 정산 결의 요청", ...lines.map((l) => `${l.source} ${l.detail} ${l.subject}`)].join("\n");
    const views = items.map((it) => viewOf(it, entries));
    return {
      path, name: path.split("/").pop() ?? path, format: "hwx", notes: ["HWX 파일 속 형식: 한솔 전자결재 문서", "본문 HWP을(를) 꺼내 읽었습니다"],
      doc_kind: "원인행위서", fiscal_year: 2025, resolution_no: "20251BD0000E40000001", doc_number: "20251BD0000E40000001", title: "[육성]출장여비 정산 결의 요청(교육혁신과/김*온외 1명)",
      sender: "교육혁신과", sent_date: "2026-01-08", purpose: "[육성]출장여비 정산 결의 요청", amount: 412_000,
      amounts: [{ value: 412_000, source: "원인행위서 금액 칸", confidence: 0.97, form: "결의서" }], nature: "여비", nature_words: ["여비"], account_hint: "growth",
      budget_lines: lines, basis, subjects,
      content: "# [육성]출장여비 정산 결의 요청\n\n| 회계연도 | 2025 | 결의구분 | 원인행위 |\n|---|---|---|---|\n| 발의부서 | 교육혁신과 | 발의일자 | 2026-01-08 |\n\n| 세부사업 | 예산과목 | 금액 |\n|---|---|---|\n" + lines.map((l) => `| ${l.detail} | ${l.subject} | ${l.amount.toLocaleString("ko-KR")} |`).join("\n") + "\n\n적요: 1. 관련: 교육혁신과-0000(2026.01.05.) 2. 내용: 가온 교육혁신 포럼 참석 3. 지급금액: 금412,000원",
      suggestions: suggestItems(views, entries, MOCK_BUDGET_SETTINGS, { text: basis, nature: "여비", account: "growth", amount: 412_000, subjects }),
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
    content: forum
      ? "# 글로컬대학 30 지역 협업 포럼 개최 안내\n\n1. 관련: 기획처-70(2026. 11. 3.)\n2. 지역 협업을 위한 포럼을 아래와 같이 개최하오니 참석하여 주시기 바랍니다.\n  가. 일시: 2026. 12. 4.(금) 14:00\n  나. 소요 예산: 금3,000,000원(행사 운영)\n\n붙임  1. 포럼 계획서 1부.  끝."
      : "# 2026 진로체험 버스 임차 협조 요청\n\n1. 학생 진로체험 활동을 위하여 버스 임차를 아래와 같이 협조 요청하오니 2026. 11. 20.까지 회신하여 주시기 바랍니다.\n  가. 일시: 2026. 11. 27.(금) 08:30~15:30\n  나. 대상: 학생 142명, 인솔 8명\n  다. 차량: 45인승 버스 3대 (1대 660,000원)\n  라. 소요 예산: 금1,980,000원(45인승 버스 3대, 부가세 포함)\n\n| 구분 | 수량 | 단가 | 금액 |\n|---|---|---|---|\n| 45인승 버스 | 3 | 660,000 | 1,980,000 |\n\n붙임  1. 견적서 1부.  끝.",
    suggestions: suggestItems(views, entries, MOCK_BUDGET_SETTINGS, { text: basis, nature, account, amount }),
  };
};

type H = { [M in RpcMethod]?: (p: RpcParams<M>) => RpcResult<M> | Promise<RpcResult<M>> };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const precheckRecords: BudgetPrecheckRecord[] = [];

export const budgetHandlers: H = {
  budget_book: () => book(),
  budget_analyze: async (p) => { await wait(400); return analysisOf(p.path); },
  budget_bundle: async (p) => {
    await wait(500);
    const name = (x: string) => x.split("/").pop() ?? x;
    // 이름으로 가른 가상 서류 (계좌·사업자번호는 지어낸 값)
    const docs = p.paths.map((x): BudgetBundleDoc => {
      const n = name(x);
      if (/영수증/.test(n)) return { path: x, name: n, kind: "receipt", label: "영수증", amount: 1_980_000, date: "2026-11-27", ocr: true };
      if (/통장|계좌/.test(n)) return { path: x, name: n, kind: "bank", label: "계좌 사본", bank: "가온은행", account: "1002-345-678901", holder: "가온관광", ocr: true };
      return { path: x, name: n, kind: "letter", label: "공문" };
    });
    const main = docs.find((d) => d.kind === "letter") ?? docs[0];
    const analysis = { ...analysisOf(main.path), doc_kind: "공문" as const, budget_lines: undefined };
    const receipts_total = docs.filter((d) => d.kind === "receipt").reduce((n, d) => n + (d.amount ?? 0), 0);
    const payees = docs.filter((d) => d.kind === "bank").map((d) => ({ bank: d.bank, account: d.account, holder: d.holder, from: d.name }));
    const notes = docs.some((d) => d.ocr) ? ["스캔 서류는 글자 읽기(OCR)로 읽어 틀릴 수 있습니다. 원본과 견줘 확인하세요."] : [];
    return { analysis, docs, receipts_total, quotes_total: 0, failed: [], notes, payees };
  },
  budget_precheck: async (p) => {
    await wait(200);
    const it = items.find((x) => x.id === p.item_id);
    const v = it ? viewOf(it, entries) : undefined;
    const amount = p.amount ?? p.bundle.analysis.amount ?? 0;
    const kinds = new Set(p.bundle.docs.map((d) => d.kind));
    const missing = (["quote", "bank"] as const).filter((k) => !kinds.has(k)).map((k) => (k === "quote" ? "견적서" : "계좌 사본"));
    return {
      nature: p.bundle.analysis.nature, docs_source: "default",
      items: [
        { id: "docs", label: "서류 구비", status: missing.length ? "check" : "ok", summary: missing.length ? `${missing.join("·")}이(가) 없습니다` : "필요한 서류가 모두 있습니다", details: ["거래 성격 기준 필요 서류: 공문 · 견적서 · 계좌 사본 (일반 기본값, 추정)"] },
        { id: "amount", label: "금액 일치", status: p.bundle.receipts_total && p.bundle.receipts_total !== amount ? "check" : p.bundle.receipts_total ? "ok" : "na", summary: p.bundle.receipts_total ? (p.bundle.receipts_total !== amount ? "서류 금액이 서로 다릅니다" : "서류 금액이 서로 맞습니다") : "견줄 영수증·견적 금액이 없습니다", details: [] },
        { id: "party", label: "사업자·계좌·날짜", status: "na", summary: "점검할 사업자번호·계좌·날짜를 읽지 못했습니다", details: [] },
        v ? { id: "balance", label: "예산 잔액", status: amount > v.avail ? "check" : "ok", summary: amount > v.avail ? `잔액이 ${(amount - v.avail).toLocaleString("ko-KR")}원 모자랍니다` : "잔액이 충분합니다", details: [] }
          : { id: "balance", label: "예산 잔액", status: "na", summary: "예산 과목을 고르면 점검합니다", details: [] },
        { id: "rule", label: "규정 금액 기준", status: "na", summary: "규정 파일이 없어 대조하지 못했습니다", details: ["설정 › 예산과 회계에서 기관 규정·지침 파일을 넣으면 맞는 조항의 금액 기준을 견줍니다."] },
      ],
      caveat: "정해진 규칙으로 읽은 값만 견준 참고용 점검표입니다. 집행 가능 여부와 규정 적합 여부는 기관 규정 원문과 회계 담당 확인으로 정하세요.",
    };
  },
  budget_precheck_record: async (p) => {
    const it = items.find((x) => x.id === p.item_id);
    return buildRecord({ bundle: p.bundle, precheck: await budgetHandlers.budget_precheck!(p), year: 2026, item: it ? { id: it.id, name: it.name } : undefined, amount: p.amount, memo: p.memo });
  },
  budget_precheck_save: async (p) => {
    const rec = await budgetHandlers.budget_precheck_record!(p);
    const saved = { ...rec, id: `pc-${Date.now()}-${(++seq).toString(16).padStart(6, "0")}` };
    precheckRecords.unshift(saved);
    return saved;
  },
  budget_precheck_list: () => precheckRecords.map(summaryOf),
  budget_precheck_get: (p) => {
    const r = precheckRecords.find((x) => x.id === p.id);
    if (!r) throw new Error("점검 기록을 찾지 못했습니다. 이미 지웠거나 다른 PC의 기록일 수 있습니다.");
    return r;
  },
  budget_precheck_delete: (p) => {
    const i = precheckRecords.findIndex((x) => x.id === p.id);
    if (i >= 0) precheckRecords.splice(i, 1);
    return i >= 0;
  },
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
  budget_apply_split: (p) => {
    for (const x of p.parts) {
      const it = items.find((i) => i.id === x.item_id)!;
      const sum = p.parts.filter((y) => y.item_id === x.item_id).reduce((n, y) => n + y.amount, 0);
      if (viewOf(it, entries).avail < sum) throw new Error(`${it.name} 가용 잔액보다 많습니다. 다른 과목을 고르세요.`);
    }
    const group = `g${++seq}`;
    const made: BudgetEntry[] = p.parts.map((x) => ({ id: `e${++seq}`, group, at: new Date().toISOString(), date: "2026-11-13", item_id: x.item_id, amount: x.amount, stage: p.stage, kind: "apply", doc_path: p.doc_path, doc_title: p.doc_title, doc_number: p.doc_number, sender: p.sender, memo: x.memo, by: "김예산" }));
    entries.push(...made);
    const ids = [...new Set(p.parts.map((x) => x.item_id))];
    return { entries: made, items: ids.map((id) => viewOf(items.find((i) => i.id === id)!, entries)), warnings: [] };
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
  budget_evidence: async (p) => {
    await wait(600);
    // 가상 증빙: 여비 묶음(원인행위서 금액과 같은 값)
    const amount = p.voucher?.amount ?? 412_000;
    return {
      ocr: true, missing: [],
      pages: [
        { page: 1, kind: "travel_claim", label: "여비 정산 신청서", amount, fare: 52_000, date: "2026-01-07" },
        { page: 2, kind: "ticket", label: "교통비 영수증", amount: 52_000, brn: "000-00-00000", date: "2026-01-05" },
        { page: 3, kind: "trip_request", label: "출장 신청서", doc_no: "교육혁신과-1234", date: "2026-01-02" },
      ],
      checks: [
        { label: "여비 정산 신청서(1쪽) 금액 = 결의 금액", ok: true, detail: `${amount.toLocaleString("ko-KR")}원 / ${amount.toLocaleString("ko-KR")}원` },
        { label: "교통비 영수증 합계 = 정산서 운임", ok: true, detail: "52,000원 / 52,000원" },
      ],
    };
  },
  budget_guide_list: () => mockGuides.map((x) => x.g),
  budget_guide_add: async (p) => {
    await wait(500);
    const added = p.paths.map((path, i) => {
      const clauses = splitClauses(MOCK_RULE);
      const g: BudgetGuide = { id: `guide-${Date.now()}-${i}`, name: path.split(/[\\/]/).pop() ?? path, added_at: new Date().toISOString(), clauses: clauses.length, articles: clauses.length, chars: MOCK_RULE.length, size: 1000 };
      mockGuides.push({ g, clauses });
      return g;
    });
    return { added, failed: [] };
  },
  budget_guide_remove: (p) => {
    const i = mockGuides.findIndex((x) => x.g.id === p.id);
    if (i < 0) return false;
    mockGuides.splice(i, 1);
    return true;
  },
  budget_guide_find: (p) => {
    const it = p.item_id ? items.find((x) => x.id === p.item_id) : undefined;
    const all = mockGuides.flatMap((x) => x.clauses.map((c) => ({ g: x.g, c })));
    return rankClauses(all, { text: p.text, item: it, nature: p.nature, words: p.words }, MOCK_BUDGET_SETTINGS.rules).slice(0, p.limit ?? 5);
  },
  budget_guide_clause: (p) => {
    const c = mockGuides.find((x) => x.g.id === p.id)?.clauses.find((x) => x.no === p.no);
    if (!c) throw new Error("조항을 찾지 못했습니다.");
    return c;
  },
  budget_export: async () => { await wait(300); return { output_path: "/Users/kim/Documents/KnuDoc AI 결과/예산현황_2026_20261113.xlsx", items: items.length, entries: entries.length }; },
};

export const MOCK_LETTERS = [LETTER, `${D}/글로컬 지역 협업 포럼 개최 안내.hwx`, `${D}/[원인행위] 출장여비 정산 결의.hwx`];
