import "server-only";

/**
 * **IS IT LEARNING — six fair questions, and what the records can say about
 * each today.** (Admin redesign, 2026-09-23; Fleet · Is it learning.)
 *
 * None of the six is a trend yet (MW-027): improvement cannot be told from
 * luck without a measurement over time. Where a record already holds a real
 * reading it is shown, with its window and denominator, and labelled as one
 * reading rather than a trend; where nothing records the behaviour the card
 * says so and names the requirement that would.
 */
import { readSnapshot } from "@/lib/control-plane/admin-data.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";

import { AuditFooter, NotAsked } from "../blocks.tsx";
import { loadWatchedBodies } from "../data/load-bodies.ts";
import { loadLearningFacts } from "../data/spend-store.ts";
import { openPage, type SearchParams } from "../page-base.ts";
import { MwShell } from "../shell.tsx";
import { Dash, Pill, Refusal, mw as s } from "../ui.tsx";

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function n(x: number): string {
  return x.toLocaleString("en-US");
}

const FMT_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
function day(iso: string | null): string {
  if (iso === null) return "an unrecorded date";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? FMT_DAY.format(new Date(t)) : iso;
}

interface Question {
  readonly title: string;
  readonly state: "ONE READING, NO TREND" | "NOTHING MEASURES THIS";
  readonly lines: readonly string[];
  readonly needs: string;
}

export async function LearningScreen(props: { readonly searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const base = await openPage("/admin/learning", sp);
  const shellProps = {
    area: "fleet" as const,
    tab: "learning" as const,
    scope: base.scope,
    scopeLabel: base.shell.label,
    scopeGroups: base.shell.groups,
    here: base.here,
    observedAt: base.nowIso,
    standard: null,
  };
  if (base.repos === null) {
    return (
      <MwShell {...shellProps}>
        <NotAsked detail={base.controlPlaneGap} />
      </MwShell>
    );
  }
  const [learning, bodiesRead, snapshotOut] = await Promise.all([loadLearningFacts(base.nowIso), loadWatchedBodies(base.nowIso), readSnapshot(base.repos)]);
  const f = learning.kind === "HELD" ? learning.facts : null;
  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [];

  /* ------------------------------------------------------------ blockages */
  const bodies = bodiesRead.kind === "HELD" ? bodiesRead.views.filter((b) => b.stateCode !== null) : [];
  const recovered = bodies.filter((b) => b.recovery === "RECOVERED").length;
  const stillFailing = bodies.filter((b) => b.recovery === "STILL_FAILING").length;
  const everFailed = recovered + stillFailing;
  if (bodiesRead.kind === "HELD" && everFailed > 0) {
    numbers.push({ label: "bodies that cleared by themselves", value: recovered, denominator: everFailed, contract: "watched bodies whose latest read got in after an earlier one could not, of every watched body with a failed read among its last reads in seven days" });
  }

  /* ------------------------------------------------------------ the model ladder */
  const month = snapshotOut.kind === "HELD" ? snapshotOut.value.monthlySpend ?? null : null;
  const modelRows = month ? month.byModel.filter((r) => r.key !== "no model (deterministic work)") : [];
  const modelCharges = modelRows.reduce((a, r) => a + r.measuredRows + r.unmeasuredRows, 0);
  const topCharges = modelRows.filter((r) => /opus/i.test(r.key) || r.key === "(attempt not on record)").reduce((a, r) => a + r.measuredRows + r.unmeasuredRows, 0);
  if (month && modelCharges > 0) {
    numbers.push({ label: "charges on the most capable class", value: topCharges, denominator: modelCharges, contract: "model charges this UTC month on the most capable class (including the pre-warm, whose model is not on the row), of every model charge" });
  }

  /* ------------------------------------------------------------ the weeks */
  const weeks = f ? f.weeks : [];
  claims.push({ label: "weeks of paid work", stated: weeks.length, rendered: weeks.length });
  if (f && f.resumed.walks > 0) numbers.push({ label: "resumed walks that found something", value: f.resumed.found, denominator: f.resumed.walks, contract: "unrefused Scout walks that started from an earlier walk's recorded rungs and found a way in or the record, of every such walk" });
  if (f && f.manual.recorded > 0) numbers.push({ label: "walks handed inherited ways in", value: f.manual.inherited, denominator: f.manual.recorded, contract: "Scout walks whose brief carried ways in from the field manual, of every walk that recorded the pair" });

  const questions: Question[] = [
    {
      title: "Are ways in learned once, then used free forever?",
      state: f && f.manual.recorded > 0 ? "ONE READING, NO TREND" : "NOTHING MEASURES THIS",
      lines:
        f && f.manual.recorded > 0
          ? [
              `Since ${day(f.manual.since)}, ${n(f.manual.inherited)} of ${n(f.manual.recorded)} paid Scout walks were handed ways in that earlier walks had found (the field manual).`,
              `${n(f.manual.rebuilt)} ${f.manual.rebuilt === 1 ? "walk" : "walks"} proposed a way in the manual already held — rebuilding a known door is a defect, not progress.`,
              "Whether a learned way in is then walked by plain code, for free, is not recorded, so the saving cannot be shown.",
            ]
          : ["Routes are stored and reused. What is not recorded is which ones were first worked out by AI, so nobody can show the saving."],
      needs: "MW-027",
    },
    {
      title: "Does it get better after it fails?",
      state: f && f.resumed.walks > 0 ? "ONE READING, NO TREND" : "NOTHING MEASURES THIS",
      lines:
        f && f.resumed.walks > 0
          ? [
              `Since ${day(f.resumed.since)}, ${n(f.resumed.walks)} paid walks started from the ways an earlier walk had already ruled out; ${n(f.resumed.found)} of them found something. Of the ${n(f.resumed.freshWalks)} that started fresh, ${n(f.resumed.freshFound)} did.`,
              "Refused attempts are left out of both. The two groups hunted different records, so this is an observation, not proof that the lesson stuck.",
            ]
          : ["Every failure records what it ruled out, and the next attempt starts below it. What is not recorded is whether the lesson stuck."],
      needs: "MW-027",
    },
    {
      title: "Do blockages clear themselves, or wait for you?",
      state: bodiesRead.kind === "HELD" ? "ONE READING, NO TREND" : "NOTHING MEASURES THIS",
      lines:
        bodiesRead.kind === "HELD"
          ? everFailed === 0
            ? [`None of the ${n(bodies.length)} watched bodies failed to get in among its recent reads, so there was nothing to clear.`]
            : [
                `Of the ${n(everFailed)} watched bodies that could not get in at least once among their last reads in seven days, ${n(recovered)} got in again on a later read without anyone acting; ${n(stillFailing)} are still failing at their latest read.`,
                "That is one week's reading of the routine meeting reads only. How often a blockage needs you, over time and across all work, is not counted.",
              ]
          : [bodiesRead.detail],
      needs: "MW-027",
    },
    {
      title: "Is a record getting cheaper over time?",
      state: weeks.length > 0 ? "ONE READING, NO TREND" : "NOTHING MEASURES THIS",
      lines:
        weeks.length > 0
          ? [
              "Below, by week: what paid Scout work cost against what it found. A find is an attempt that found a way in or the record; it is not yet a record a reader can see, because paid research promotes nothing today. So this prices finds, not records, and a cost per record stays unmeasured until charges say what the work was for.",
            ]
          : ["Needs a cost per result first, which needs every charge to say what the work was for."],
      needs: "MW-013 then MW-027",
    },
    {
      title: "Is it reaching for expensive AI less often?",
      state: month && modelCharges > 0 ? "ONE READING, NO TREND" : "NOTHING MEASURES THIS",
      lines:
        month && modelCharges > 0
          ? [
              `${n(topCharges)} of ${n(modelCharges)} model charges this month (${month.window.label}, UTC) were on the most capable class. Nothing starts lower and nothing has ever moved up, so there is no reaching to count — the Scout loop and the audit start at the top by design.`,
              "A trend needs a ladder that is used, and the reason for each move recorded.",
            ]
          : ["Escalation is not counted, so the rate over time cannot be drawn."],
      needs: "MW-031 then MW-027",
    },
    {
      title: "Do difficult bodies become routine?",
      state: "NOTHING MEASURES THIS",
      lines: ["Each body's recent reads are visible on Fleet · Now. Nothing aggregates them into a trend of hard bodies becoming easy ones."],
      needs: "MW-027",
    },
  ];

  const audit = auditRenderedNumbers(numbers);
  const stated = checkStatedEqualsRendered(claims);
  if (!audit.ok || !stated.ok) {
    return (
      <MwShell {...shellProps}>
        <Refusal title="This page refused to draw its own numbers.">
          {!audit.ok && <p>{audit.detail}</p>}
          {!stated.ok && <p>{stated.detail}</p>}
        </Refusal>
      </MwShell>
    );
  }

  return (
    <MwShell {...shellProps}>
      <div className={`${s.dashedCard} ${s.gap24}`}>
        <div className={s.row10}>
          <Dash>CANNOT TELL</Dash>
          <h2 className={s.h2Inline}>None of this is a trend yet.</h2>
        </div>
        <p className={s.lede}>
          Every question below is a fair question. The underlying work is real — routes are stored and reused, failures record what they ruled out, blockages clear
          themselves — and where a record already holds one reading of it, that reading is shown with its window. None is measured over time, so improvement cannot
          yet be told from luck. That is why MW-027 treats it as delivery rather than a nicety.
          {base.scope.kind !== "all" ? " These readings are for everywhere; none of them narrows to a place yet." : ""}
        </p>
      </div>
      {learning.kind === "UNREAD" && (
        <p className={`${s.refusal} ${s.gap20}`}>{learning.detail}</p>
      )}
      <div className={`${s.stack14} ${s.gap32}`}>
        {questions.map((q) => (
          <article key={q.title} className={`${s.card} ${s.cardList}`}>
            <div className={s.stack8}>
              <div className={s.row10}>
                <h3 className={s.titleStrong16}>{q.title}</h3>
                <span className={s.pushRight}>
                  {q.state === "NOTHING MEASURES THIS" ? <Dash>NOTHING MEASURES THIS</Dash> : <Pill tone="cyan">ONE READING, NO TREND</Pill>}
                </span>
              </div>
              {q.lines.map((l) => (
                <p key={l} className={s.body}>
                  {l}
                </p>
              ))}
              <span className={s.monoId}>{q.needs}</span>
            </div>
          </article>
        ))}
      </div>
      {weeks.length > 0 && (
        <>
          <h2 className={s.h2Page}>Paid finds, by week</h2>
          <p className={s.lede}>Every paid Scout attempt on record, by the UTC week it started. Refused attempts are shown apart: the provider did not answer, so they found nothing and cost almost nothing.</p>
          <div className={`${s.card} ${s.cardFlush} ${s.gap32}`}>
            <div className={s.table} style={{ gridTemplateColumns: "minmax(120px,1fr) minmax(90px,0.8fr) minmax(90px,0.8fr) minmax(90px,0.8fr) minmax(100px,0.9fr) minmax(110px,0.9fr)" }}>
              {["Week of", "Attempts", "Refused", "Found", "Spent", "Per find"].map((h) => (
                <div key={h} className={s.th}>
                  {h}
                </div>
              ))}
              {weeks.map((w) => (
                <WeekCells key={w.week} week={w.week} attempts={w.attempts} refused={w.refused} found={w.found} spent={w.usd} />
              ))}
            </div>
          </div>
        </>
      )}
      <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}

function WeekCells(p: { week: string; attempts: number; refused: number; found: number; spent: number }) {
  return (
    <>
      <div className={`${s.td} ${s.tdMono}`}>{p.week}</div>
      <div className={`${s.td} ${s.tdMono}`}>{n(p.attempts)}</div>
      <div className={`${s.td} ${s.tdMono}`}>{n(p.refused)}</div>
      <div className={`${s.td} ${s.tdMono}`}>{n(p.found)}</div>
      <div className={s.td}>
        <span className={s.figAmount}>{usd(p.spent)}</span>
      </div>
      <div className={`${s.td} ${s.tdMono}`}>{p.found > 0 ? usd(p.spent / p.found) : "no finds"}</div>
    </>
  );
}
