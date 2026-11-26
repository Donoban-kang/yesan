/** 예산 장부 읽기 — 지출 도우미·예산 현황·지출 대장이 함께 쓴다. 한 화면에서 바꾸면 "kordoc:budget" 알림으로 다른 화면도 다시 읽는다 */

import { useCallback, useEffect, useState } from "react";
import type { BudgetBookView } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { useApp } from "../../state/app";

export const budgetChanged = () => window.dispatchEvent(new Event("kordoc:budget"));

export function useBudgetBook(active: boolean) {
  const { ready } = useApp();
  const [book, setBook] = useState<BudgetBookView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setBook(await rpc("budget_book", {}));
      setError("");
    } catch (e) {
      setError(`예산 장부를 읽지 못했습니다: ${errorText(e)}`);
    }
  }, []);

  useEffect(() => { if (ready && active) void load(); }, [ready, active, load]);
  useEffect(() => {
    const on = () => { if (ready) void load(); };
    window.addEventListener("kordoc:budget", on);
    return () => window.removeEventListener("kordoc:budget", on);
  }, [ready, load]);

  return { book, error, reload: load };
}

/** 1980000 → "1,980,000" */
export const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** "1,980,000원" 같은 글 → 수 (숫자 아닌 것은 버림) */
export const parseWon = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

export const STAGE_LABEL = { commit: "품의 중", paid: "지출 완료" } as const;

/** 과목 한 줄 이름 */
export const itemPath = (it: { program: string; unit: string; detail: string }) => [it.program, it.unit, it.detail].filter(Boolean).join(" › ");

export const BUDGET_FILTER = [{ name: "예산 과목표", extensions: ["xlsx", "xls", "csv"] }];
export const LETTER_FILTER = [{ name: "공문", extensions: ["hwp", "hwpx", "hwx", "hml", "pdf", "docx", "txt"] }];
/** 지출 서류 묶음: 공문·영수증·견적서·세금계산서·계좌 사본 (스캔 PDF·사진 포함) */
export const BUNDLE_FILTER = [{ name: "지출 서류", extensions: ["hwp", "hwpx", "hwx", "hml", "pdf", "docx", "png", "jpg", "jpeg", "webp", "txt"] }];
