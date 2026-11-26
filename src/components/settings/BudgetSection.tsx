/** 예산과 회계 — 회계연도, 회계 구분(이름·공문 단서 낱말), 집행률 경고 기준, 잔액 초과 막기, 거래 성격 규칙 */

import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import type { Settings } from "../../lib/contract";
import { useApp } from "../../state/app";
import { useSectionMark } from "./marks";
import { Button } from "../ui/Button";
import { Section, Switch, TextField } from "../common/Field";
import { rpc } from "../../lib/rpc";
import { Note } from "../common/Status";
import { Advanced, UnsavedBadge, useDirtyMark } from "./dirty";
import { GuideList } from "./GuideList";

type B = Settings["budget"];
const words = (s: string) => s.split(/[,，]+/).map((w) => w.trim()).filter(Boolean);
const joinW = (w: string[]) => w.join(", ");
/** 집행 전 점검표의 필요 서류 종류 (엔진 REQUIRED_DOC_KINDS 와 같은 값) */
const DOCS: Array<[string, string]> = [["letter", "공문"], ["quote", "견적서"], ["receipt", "영수증"], ["bank", "계좌 사본"], ["claim", "여비 정산 신청서"], ["inspection", "검사·검수서"]];

export function BudgetSection() {
  const mark = useSectionMark("set-budget");
  const { settings, saveSettings, toast } = useApp();
  const saved = settings?.budget;
  const [b, setB] = useState<B | undefined>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setB(saved), [saved]);

  // 보관 연수를 바꾸면 "지금 저장하면 몇 건이 삭제 대상인지"를 먼저 보여 준다 (미리보기만, 지우지 않음)
  const keepYears = b?.precheck_keep_years ?? 0;
  const [due, setDue] = useState<number | null>(null);
  useEffect(() => {
    if (keepYears < 1) { setDue(null); return; }
    let alive = true;
    const t = window.setTimeout(() => {
      void rpc("budget_precheck_purge", { years: keepYears, dry_run: true }).then((r) => { if (alive) setDue(r.due); }, () => { if (alive) setDue(null); });
    }, 300);
    return () => { alive = false; window.clearTimeout(t); };
  }, [keepYears]);

  const changed = useMemo(() => JSON.stringify(b) !== JSON.stringify(saved), [b, saved]);
  const save = async () => {
    if (!b) return false;
    setSaving(true);
    const next = await saveSettings({ budget: b });
    setSaving(false);
    if (next) toast("예산과 회계 설정을 저장했습니다", "success");
    return !!next;
  };
  useDirtyMark("set-budget", "예산과 회계", changed, save, () => setB(saved));
  if (!b) return null;
  const nowYear = new Date().getFullYear();

  return (
    <Section id="set-budget" mark={mark} title="예산과 회계" sub="지출 도우미가 쓰는 회계연도·회계 구분·경고 기준입니다. 이 PC에만 저장합니다."
      aside={changed ? <UnsavedBadge /> : undefined}>
      <div className="flex flex-col gap-4">
        <div className="kd-fieldgrid">
          <TextField label="회계연도" hint={`비우면 올해(${nowYear})`} value={b.year ? String(b.year) : ""} placeholder={String(nowYear)}
            onChange={(v) => setB({ ...b, year: Number(v.replace(/\D/g, "").slice(0, 4)) || 0 })} />
          <TextField label="집행률 경고 기준 (%)" hint="품의를 포함한 집행률이 넘으면 노랗게 알립니다" value={String(b.warn_at)}
            onChange={(v) => setB({ ...b, warn_at: Math.min(100, Number(v.replace(/\D/g, "")) || 0) })} />
        </div>
        <Switch label="잔액을 넘는 반영 막기" desc="끄면 반영은 하되 경고만 합니다. 예산 변경(전용·추경) 여부는 회계 담당과 확인하세요."
          checked={b.over_block} onChange={(v) => setB({ ...b, over_block: v })} />
        <div className="flex flex-col gap-2">
          <TextField label="점검 기록 보관 연수" hint="0 또는 빈칸이면 자동으로 지우지 않습니다 (1~50)" value={keepYears ? String(keepYears) : ""} placeholder="0"
            onChange={(v) => setB({ ...b, precheck_keep_years: Math.min(50, Number(v.replace(/\D/g, "").slice(0, 2)) || 0) })} />
          <p className="kd-small kd-muted">보관한 점검 기록(집행 전 점검표)만 저장한 날부터 이 기간이 지나면 지출 도우미를 쓸 때 자동으로 지웁니다. 지출 대장과 예산 장부는 지우지 않으며, 지운 기록은 되돌릴 수 없습니다. 기관의 기록물 보존 기준이 있으면 그 기간 이상으로 정하세요.</p>
          {keepYears >= 1 && due !== null && (
            <Note tone={due > 0 ? "warn" : "info"}>{due > 0 ? `저장하면 지금 보관된 기록 중 ${due}건이 바로 삭제됩니다.` : "저장해도 지금 지워지는 기록은 없습니다."}</Note>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="kd-label">회계 구분</span>
          <p className="kd-small kd-muted">이름은 화면과 엑셀에 보이는 말입니다. 단서 낱말이 공문에 나오면 그 회계의 과목을 먼저 추천합니다.</p>
          {b.accounts.map((a, i) => (
            <div key={a.id} className="kd-fieldgrid">
              <TextField label={`이름 (${a.id})`} value={a.label} onChange={(v) => setB({ ...b, accounts: b.accounts.map((x, j) => (j === i ? { ...x, label: v } : x)) })} />
              <TextField label="공문 단서 낱말" hint="쉼표로 나눔" value={joinW(a.words)} onChange={(v) => setB({ ...b, accounts: b.accounts.map((x, j) => (j === i ? { ...x, words: words(v) } : x)) })} />
            </div>
          ))}
        </div>
        <Advanced title="거래 성격 규칙">
          <p className="kd-small kd-muted mb-2">공문에 "공문 낱말"이 보이면 그 거래 성격으로 보고, 과목 이름에 "과목 단서"가 든 과목을 먼저 추천합니다. 기관 과목 이름에 맞게 고치세요.</p>
          <div className="flex flex-col gap-2">
            {b.rules.map((r, i) => (
              <div key={i} className="kd-fieldgrid">
                <TextField label="거래 성격" value={r.nature} onChange={(v) => setB({ ...b, rules: b.rules.map((x, j) => (j === i ? { ...x, nature: v } : x)) })} />
                <TextField label="공문 낱말" value={joinW(r.words)} onChange={(v) => setB({ ...b, rules: b.rules.map((x, j) => (j === i ? { ...x, words: words(v) } : x)) })} />
                <TextField label="과목 단서" value={joinW(r.hints)} onChange={(v) => setB({ ...b, rules: b.rules.map((x, j) => (j === i ? { ...x, hints: words(v) } : x)) })} />
                <fieldset className="kd-field" aria-label={`${r.nature} 필요 서류`}>
                  <legend className="kd-label">필요 서류 (집행 전 점검표)</legend>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {DOCS.map(([k, name]) => (
                      <label key={k} className="kd-small flex items-center gap-1">
                        <input type="checkbox" checked={(r.docs ?? []).includes(k)}
                          onChange={(e) => setB({ ...b, rules: b.rules.map((x, j) => (j === i ? { ...x, docs: DOCS.map(([d]) => d).filter((d) => (d === k ? e.target.checked : (x.docs ?? []).includes(d))) } : x)) })} />
                        {name}
                      </label>
                    ))}
                  </div>
                  {!r.docs?.length && <span className="kd-small kd-muted">고르지 않으면 일반 기본값(추정)을 씁니다.</span>}
                </fieldset>
              </div>
            ))}
          </div>
        </Advanced>
        <GuideList />
        {b.year && (b.year < 2000 || b.year > 2100) ? <Note tone="warn">회계연도는 네 자리 연도로 적으세요.</Note> : null}
        <div><Button onClick={() => void save()} disabled={saving || !changed}><Save size={14} /> {saving ? "저장하는 중" : "저장"}</Button></div>
      </div>
    </Section>
  );
}
