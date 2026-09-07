/**
 * **THE COST SECTION — WHAT THE PAID WORK COSTS, AND WHAT NOBODY MEASURED.**
 * (Admin C, LANE H: ADM-C14; ADM-26/33/36/45/47; §9A.4 and §9A.23, from the
 * 9.6.26 owner feedback.)
 *
 * Lifted out of `app/(admin)/admin/page.tsx` §5 as a PURE SERVER COMPONENT: it
 * takes data that has already been read and renders it, and it opens no store,
 * reads no clock and touches no environment. The page keeps the reading and
 * the audits; this keeps the rendering, so a change to how spend is shown is
 * one file and one test rather than a diff inside a 1,400-line page.
 *
 * ## What the owner said, and what each part of this answers
 *
 *   POS-12   *"Cost looks good by date and then by role. I like that."* — both
 *            charts survive, captions unchanged. ADM-36 adds a restrained
 *            semantic colour by ROLE through class names only; the declarations
 *            are reported to the integrator, because this lane writes no CSS.
 *   ADM-26   the run-on spend sentence becomes a `| Window | Spend |` table
 *            with a definition of the operational night, and every dollar on
 *            this page is to the cent (`usdCents` / `usdOf`) — never `toFixed(4)`.
 *   ADM-33   models read `Claude Opus 5`, and *"($0 by design, not a gap)"* is
 *            gone. It was the wrong claim: see {@link costClassOf}. A row is now
 *            one of §9A.4's six classes, and the only one that says a role never
 *            spends is the one the EXECUTION POLICY proves.
 *   ADM-45   the section leads with the sentence that is actually useful — what
 *            the daily limit buys — rather than with an architecture paragraph.
 *   ADM-47   a zero says why: *"0% model work this cycle — nothing was
 *            dispatched"* is a different fact from every job having run as plain
 *            code, and the ring drew both the same.
 *   §9A.23   a monthly window on the owner's own billing period — 00:00 UTC on
 *            the 1st to now — because his API funds reset then and no window in
 *            the control plane was that window.
 *   ADM-C14  subscription work is shown APART from API spend, and when the job
 *            log does not exist yet the block says so in those words rather
 *            than rendering an encouraging emptiness.
 *
 * Every figure here is a `Measured` or a dollar against its stated ceiling.
 * `costSectionNumbers` hands the page the audit rows for the ones this section
 * draws itself, so they fall inside the console's own refusal to render a
 * number without a denominator.
 */

import {
  COST_CLASS_WORDS,
  MONTHLY_TOKEN_METRICS,
  MONTHLY_TOKEN_WORDS,
  bytesText,
  capacitySentence,
  costClassOf,
  durationText,
  modelLabel,
  roleBarClass,
  shareSentence,
  subscriptionJobsReading,
  utcStamp,
  type CacheCallerHealth,
  type CostRowLike,
  type MonthlySpendView,
  type NonDollarMeasures,
  type SpendWindowRow,
  type SubscriptionJobRow,
} from "@/lib/control-plane/cost-panel.ts";
import type { Held, Measured } from "@/lib/control-plane/owner-surface.ts";
import { count, plainCode, usdCents } from "@/lib/control-plane/plain-words.ts";
import type { ScoutCapacity } from "@/lib/control-plane/research-metrics.ts";

import { BarChart, Ring } from "../../charts.tsx";
import { GapNote, HeldNum, QueueButton, Said, When } from "../../console-ui.tsx";
import { roleWords } from "../../fleet-wording.ts";
import { NeedsYouLine, type NeedsYou } from "../../status-ui.tsx";

/** One published cost row, as this section reads it. An `OwnerCostRow` satisfies it. */
export interface CostSectionRow extends CostRowLike {
  readonly nonDollar?: NonDollarMeasures;
  readonly meaning?: string;
}

/** One published cache-hit-rate row. The health block is absent on an older snapshot. */
export interface CacheSectionRow {
  readonly callerKey: string;
  readonly hitRate: Held<Measured>;
  readonly health?: CacheCallerHealth;
}

export interface CostSectionProps {
  /** Whole-ledger totals. Absent on a snapshot published before the ledger read. */
  readonly costSummary:
    | {
        readonly measuredUsd: number | null;
        readonly attemptsMeasured: number;
        readonly attemptsUnmeasured: number;
        readonly entries: number;
      }
    | null
    | undefined;
  readonly costByRole: readonly CostSectionRow[];
  readonly costByModel: readonly CostSectionRow[];
  readonly cacheHitRateByCaller: readonly CacheSectionRow[];
  readonly deterministicShare: Held<Measured>;
  readonly costPerVerifiedRecord: Held<Measured>;
  /** Measured spend per Eastern calendar day over the trailing fortnight. */
  readonly spendByDay: readonly { readonly day: string; readonly usd: number; readonly attempts: number }[];
  /**
   * The three enforced spend windows, built by `spendWindowRows` from the
   * fleet-safety snapshot. EMPTY or absent when that snapshot could not be
   * read, which the table then says rather than showing three zeroes.
   *
   * The four props below are OPTIONAL because each needs a wiring step the
   * page owns (§9A.23's clock on the publisher, the fleet-safety read, the
   * Agent Bridge log), and a section that refused to compile until all three
   * landed would block the ones that already have. Absent renders as the
   * specific missing wire, never as a zero.
   */
  readonly spendWindows?: readonly SpendWindowRow[];
  /** What the daily ceiling buys, from the ledger. Null when the publisher passed no clock. */
  readonly capacity?: ScoutCapacity | null;
  /** The UTC calendar month (§9A.23). Null when the publisher passed no clock. */
  readonly monthly?: MonthlySpendView | null;
  /** The Agent Bridge job log. Null while no such log exists to read. */
  readonly subscriptionJobs?: readonly SubscriptionJobRow[] | null;
  /** The organic reader-path cache observation, as the page already renders it. */
  readonly cacheLine: { readonly state: string; readonly says: string };
  /** The read outcome's own note, when the observation could not be read at all. */
  readonly cacheNote?: string | null;
  /** Where a fix-queue button returns to. */
  readonly returnTo: string;
}

const HERE = "Cost";

/**
 * A caller key as words. `roleWords` is the console's own dictionary and stays
 * first so this table agrees with the fleet cards; a code it does not know
 * falls through to {@link plainCode} rather than onto the face in
 * SCREAMING_SNAKE, which is how an unrecognised role used to reach the owner.
 */
function roleLabel(key: string): string {
  const words = roleWords(key);
  return words === key ? plainCode(key) || key : words;
}

/** A count that may not have been published. Absent is unknown, never zero. */
function countOrGap(value: number | undefined): string {
  return value === undefined ? "not measured" : count(value);
}

/** A cache reading with a defect in it needs him; an unmeasured window needs him more. */
function needsYouFor(props: CostSectionProps): NeedsYou {
  const blindWindow = (props.spendWindows ?? []).find((w) => w.unmeasured);
  if (blindWindow) {
    return {
      needed: true,
      action: `the ${blindWindow.window.toLowerCase()} has no total because a model reply reported no cost — paid work stops until that is accounted for. Add it to the fix queue below.`,
    };
  }
  const defective = props.cacheHitRateByCaller.find(
    (c) => (c.health?.stationaryTurns ?? 0) > 0 || (c.health?.zeroReadTurns ?? 0) > 0,
  );
  if (defective) {
    return {
      needed: true,
      action: `${roleLabel(defective.callerKey.replace(/ \(.*\)$/, ""))} re-sent prompt text it had already cached, which is paid for twice. Add it to the fix queue below.`,
    };
  }
  return { needed: false };
}

/** The summary line, without the claim ADM-33 struck out. */
function summaryLine(props: CostSectionProps) {
  const s = props.costSummary;
  if (!s) {
    return <span className="gap">This snapshot predates the cost ledger read; republish to see totals.</span>;
  }
  if (s.measuredUsd === null) {
    return (
      <span>
        {count(s.entries)} attempt{s.entries === 1 ? "" : "s"} in the ledger, and not one reported a dollar cost. That is a
        measurement nobody took, not a total of zero.
      </span>
    );
  }
  return (
    <span>
      <strong>{usdCents(s.measuredUsd)}</strong> measured across {count(s.attemptsMeasured)} attempt
      {s.attemptsMeasured === 1 ? "" : "s"}; {count(s.attemptsUnmeasured)} more reported no dollar figure. What each of those
      means is in the table below, by role.
    </span>
  );
}

/** `| Window | Spend |` — ADM-26, to the cent, with the one window that needs defining defined. */
function SpendWindows({ rows }: { rows: readonly SpendWindowRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="note gap">
        The runner&rsquo;s own spend ceilings were not read for this page, so the three windows are not shown. They are not
        zero.
      </p>
    );
  }
  return (
    <div className="scroll-x">
      <table className="cost spend-windows">
        <thead>
          <tr>
            <th>Window</th>
            <th className="n">Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.window} className={r.unmeasured ? "cost-unmeasured" : undefined}>
              <td>
                {r.window}
                {r.defines && <div className="note">{r.defines}</div>}
              </td>
              <td className={`n${r.unmeasured ? " gap" : ""}`}>{r.shown}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** §9A.23 — the owner's own billing period, and nobody else's. */
function MonthlySpend({ monthly, returnTo }: { monthly: MonthlySpendView | null; returnTo: string }) {
  if (monthly === null) {
    return (
      <p className="note gap">
        The monthly window is not on this snapshot yet: the publisher passes no clock, so no month could be dated. That is a
        wiring gap, not a month with nothing in it.
        <QueueButton where={`${HERE} · monthly UTC spend window`} says="the publisher does not pass a clock, so the UTC month cannot be dated" returnTo={returnTo} compact />
      </p>
    );
  }
  const { total, unmeasured } = monthly;
  const blind = unmeasured.predatesFields + unmeasured.providerReportedNothing;
  return (
    <>
      <h3>This month, on the API</h3>
      {/*
        THE ONE PLACE ON THIS CONSOLE THAT PRINTS A UTC STAMP. §9A.23 defines
        the window on the provider's clock, so showing only the Eastern
        rendering would make a UTC rule look like an Eastern one. Both are
        printed; neither replaces the other.
      */}
      <p className="plain">
        <strong>{total.total === null ? "Not measured" : usdCents(total.total)}</strong> in {monthly.window.label} so far,
        counted from {utcStamp(monthly.window.since)} — midnight UTC on the 1st, because that is when the API funds reset.
        Resets {utcStamp(monthly.window.resetsAt)} (<When iso={monthly.window.resetsAt} /> here).
      </p>
      <p className="note">
        {count(total.measured)} of {count(total.measured + total.unmeasured)} ledger row(s) this month reported a dollar
        figure. {total.unmeasured > 0 ? `${count(total.unmeasured)} did not, and are counted out of the total rather than into it as zero.` : "Every row reported one."}
      </p>
      <div className="scroll-x">
        <table className="cost monthly">
          <thead>
            <tr>
              <th>This month by</th>
              <th className="n">Spend</th>
              <th className="n">Rows measured / not</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Provider", monthly.byProvider],
                ["Model", monthly.byModel],
                ["Caller role", monthly.byRole],
              ] as const
            ).flatMap(([heading, rows]) => [
              <tr key={`h-${heading}`} className="group-head">
                <th colSpan={3}>{heading}</th>
              </tr>,
              ...rows.map((r) => (
                <tr key={`${heading}-${r.key}`}>
                  <td>{heading === "Model" ? modelLabel(r.key) : heading === "Caller role" ? roleLabel(r.key) : r.key}</td>
                  <td className="n">{r.usd === null ? <span className="gap">not measured</span> : usdCents(r.usd)}</td>
                  <td className="n">
                    {count(r.measuredRows)} / {count(r.unmeasuredRows)}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <p className="note">
        <strong>Caching saved</strong>{" "}
        {monthly.cacheSavingUsd === null
          ? "— not measured this month: no row carried a priced cache read."
          : `${usdCents(monthly.cacheSavingUsd)} across ${count(monthly.cacheSavingRows)} row(s), against sending the same tokens uncached at list price.`}{" "}
        <strong>Batching saved</strong>{" "}
        {monthly.batchSavingUsd === null
          ? "— nothing went through the Batches API this month, so there is no batch discount to report."
          : `${usdCents(monthly.batchSavingUsd)} across ${count(monthly.batchRows)} request(s), which are billed at half of list.`}
      </p>
      {blind > 0 && (
        <p className="note">
          Kept out of every figure above: {count(unmeasured.predatesFields)} row(s) written before cache and batch use were
          recorded, and {count(unmeasured.providerReportedNothing)} row(s) whose provider reported no usage at all. Neither is
          a zero.
        </p>
      )}
      <details className="status-detail">
        <summary>Month by month, and what a month here means</summary>
        <div className="scroll-x">
          <table className="cost">
            <thead>
              <tr>
                <th>Month (UTC)</th>
                <th className="n">Spend</th>
                <th className="n">Rows measured / all</th>
              </tr>
            </thead>
            <tbody>
              {monthly.history.map((h) => (
                <tr key={h.since}>
                  <td>
                    {h.label}
                    {!h.complete && <span className="note"> still running</span>}
                  </td>
                  <td className="n">{h.usd === null ? <span className="gap">not measured</span> : usdCents(h.usd)}</td>
                  <td className="n">
                    {count(h.measuredRows)} / {count(h.rows)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          A month here is 00:00 UTC on the 1st to now, because that is when the owner&rsquo;s API funds reset. It is not a
          provider invoice period; if a provider bills on some other cycle, that figure would be a different number and would
          be labelled as one. The ledger holds nothing before{" "}
          {monthly.ledgerBeginsAt === null ? "any recorded moment — it is empty" : <When iso={monthly.ledgerBeginsAt} />}, so
          earlier months are not history that exists to show.
        </p>
        {/*
          ADM-C14 asks for the billed quantities BY provider/model, not only in
          aggregate — a month whose cache looks healthy overall can hide one
          model re-sending its whole prompt every turn. So each model is a
          column and the month's total is the last one.
        */}
        <div className="scroll-x">
          <table className="cost billed">
            <thead>
              <tr>
                <th>Billed this month</th>
                {monthly.byModel.map((m) => (
                  <th key={m.key} className="n">
                    {modelLabel(m.key)}
                  </th>
                ))}
                <th className="n">All models</th>
              </tr>
            </thead>
            <tbody>
              {MONTHLY_TOKEN_METRICS.map((metric) => {
                const t = monthly.tokens[metric];
                return (
                  <tr key={metric}>
                    <td>{MONTHLY_TOKEN_WORDS[metric]}</td>
                    {monthly.byModel.map((m) => {
                      const cell = m.tokens[metric];
                      return (
                        <td key={m.key} className="n">
                          {cell.total === null ? <span className="gap">not measured</span> : count(cell.total)}
                        </td>
                      );
                    })}
                    <td className="n">
                      {t.total === null ? <span className="gap">not measured</span> : count(t.total)}
                      <span className="denom">
                        {" "}
                        from {count(t.measured)} of {count(t.measured + t.unmeasured)} row(s)
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td>Rows served through batching (billed at half)</td>
                {monthly.byModel.map((m) => (
                  <td key={m.key} className="n">
                    {count(m.batchedRows)}
                  </td>
                ))}
                <td className="n">{count(monthly.batchRows)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/** ADM-C14 — subscription jobs, never inside the API totals. */
function SubscriptionBlock({ jobs, returnTo }: { jobs: readonly SubscriptionJobRow[] | null; returnTo: string }) {
  const reading = subscriptionJobsReading(jobs);
  return (
    <div className="card subscription-block">
      <h3>Work that ran on the subscription, not on the API</h3>
      {/*
        The separation is stated whatever the log says. A subscription job
        never touched the metered API, so none of it can appear in any dollar
        figure above — and that is true when the log is empty and when it does
        not exist yet, which is exactly when it is easiest to forget.
      */}
      <p className="note">
        Nothing in this block is part of any dollar figure above: subscription work is outside the API ledger.
      </p>
      <p className="plain">
        <Said text={reading.says} />
        {reading.state === "NOT_WIRED" && (
          <QueueButton where={`${HERE} · subscription job log`} says={reading.says} returnTo={returnTo} compact />
        )}
      </p>
      {reading.state === "HELD" && (
        <div className="scroll-x">
          <table className="cost">
            <thead>
              <tr>
                <th>Job</th>
                <th>When</th>
                <th>How it ended</th>
              </tr>
            </thead>
            <tbody>
              {reading.jobs.map((j) => (
                <tr key={`${j.at}-${j.what}`}>
                  <td>{j.what}</td>
                  <td>
                    <When iso={j.at} />
                  </td>
                  <td>{j.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NeedsYouLine needs={{ needed: false }} />
    </div>
  );
}

/** One caller's cache health, as a sentence rather than a row of unexplained integers. */
function cacheHealthLine(health: CacheCallerHealth | undefined): string | null {
  if (!health) return null;
  const parts: string[] = [];
  if (health.stationaryTurns !== null && health.stationaryTurns > 0) {
    parts.push(
      `${health.stationaryTurns} turn(s) paid full price for text that was already in the cache — the request is being assembled so the cache marker never moves forward`,
    );
  }
  if (health.zeroReadTurns !== null && health.zeroReadTurns > 0 && health.turnsExamined !== null) {
    parts.push(`${health.zeroReadTurns} of ${health.turnsExamined} repeat turn(s) read nothing from the cache at all`);
  }
  if (parts.length === 0 && health.measuredRows > 0) parts.push("no cache defect was found in the turns that were examined");
  if (health.predatesFieldRows > 0) {
    parts.push(`${health.predatesFieldRows} row(s) ran before this was measured, so they say nothing either way`);
  }
  if (health.providerReportedNothingRows > 0) {
    parts.push(`${health.providerReportedNothingRows} row(s) came back with no usage reported`);
  }
  if (health.batchShare !== null) parts.push(`${Math.round(health.batchShare * 100)}% of requests went through batching`);
  if (health.savedUsd !== null) parts.push(`caching saved ${usdCents(health.savedUsd)}`);
  if (health.aggregatePricedRows > 0) {
    parts.push(
      `${health.aggregatePricedRows} row(s) reported a cache write with no 5-minute/1-hour split, so the write was priced at the length the request asked for`,
    );
  }
  return parts.length === 0 ? null : `${parts.join("; ")}.`;
}

export function CostSection(props: CostSectionProps) {
  const spendRows = props.costByRole.filter((c) => c.usd.held && c.usd.value.value > 0);
  const dayShort = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const needsYou = needsYouFor(props);

  return (
    <section className="cost-section">
      {/* 1 — what this is, what happened, does it need him, what happens next */}
      <h2 id="cost">Cost</h2>
      <p className="plain">{capacitySentence(props.capacity ?? null)}</p>
      <p className="cost-summary">{summaryLine(props)}</p>
      <NeedsYouLine needs={needsYou} />

      {/* 2 — ADM-26: the three enforced windows, to the cent */}
      <h3>Spend against the limits that stop the work</h3>
      <SpendWindows rows={props.spendWindows ?? []} />

      {/* 3 — §9A.23: the owner's own billing period */}
      <MonthlySpend monthly={props.monthly ?? null} returnTo={props.returnTo} />

      {/* 4 — POS-12: the two charts he likes, unchanged in shape, coloured by role (ADM-36) */}
      <div className="chart-row">
        {spendRows.length > 0 && (
          <BarChart
            caption="Spend by role — measured dollars"
            rows={spendRows.map((c) => ({
              label: roleLabel(c.key),
              value: c.usd.held ? c.usd.value.value : 0,
              max: c.usd.held ? c.usd.value.denominator : 0,
              shown: c.usd.held ? usdCents(c.usd.value.value) : "not measured",
              hint: `${countOrGap(c.attemptsMeasured)} measured attempt${c.attemptsMeasured === 1 ? "" : "s"}`,
              className: roleBarClass(c.key),
            }))}
          />
        )}
        {props.spendByDay.length > 0 && (
          <BarChart
            caption="Spend by day — last 14 days"
            rows={props.spendByDay.map((d) => ({
              label: dayShort.format(new Date(`${d.day}T12:00:00Z`)),
              value: d.usd,
              shown: usdCents(d.usd),
              hint: `${count(d.attempts)} attempt${d.attempts === 1 ? "" : "s"}`,
              className: "spend-day",
            }))}
          />
        )}
        {props.deterministicShare.held && (
          <Ring
            value={props.deterministicShare.value.value}
            total={props.deterministicShare.value.denominator}
            label="plain-code share of jobs"
            shown={`${Math.round((props.deterministicShare.value.value / Math.max(props.deterministicShare.value.denominator, 1)) * 100)}%`}
          />
        )}
        {props.cacheHitRateByCaller
          .filter((c) => c.hitRate.held)
          .map((c) => (
            <Ring
              key={c.callerKey}
              value={c.hitRate.held ? c.hitRate.value.value : 0}
              total={c.hitRate.held ? c.hitRate.value.denominator : 1}
              label={`cache hit rate · ${roleLabel(c.callerKey.replace(/ \(.*\)$/, ""))}`}
              shown={`${c.hitRate.held ? Math.round((c.hitRate.value.value / Math.max(c.hitRate.value.denominator, 1)) * 100) : 0}%`}
            />
          ))}
      </div>
      {/* ADM-47: a zero says which of the three zeroes it is. */}
      <p className="note">{shareSentence(props.deterministicShare)}</p>

      {/* 5 — ADM-33: six honest classes, and the one that says "never spends" is proven */}
      <div className="scroll-x">
        <table className="cost">
          <thead>
            <tr>
              <th>By caller role</th>
              <th>What this cost is</th>
              <th className="n">Spend</th>
              <th className="n">Attempts measured / not</th>
              <th>Also measured</th>
            </tr>
          </thead>
          <tbody>
            {props.costByRole.length === 0 && (
              <tr>
                <td colSpan={5} className="gap">
                  not read — republish the snapshot to fill this table.
                </td>
              </tr>
            )}
            {props.costByRole.map((c) => {
              const reading = costClassOf(c);
              return (
                <tr key={c.key} className={`cost-${reading.cls.toLowerCase().replace(/_/g, "-")}`}>
                  <td>
                    <span title={c.key}>{roleLabel(c.key)}</span>
                  </td>
                  <td>
                    <span className={`cost-class cost-class-${reading.cls.toLowerCase().replace(/_/g, "-")}`}>{reading.words}</span>
                    <div className="note" title={reading.provenIn ?? undefined}>
                      {reading.says}
                    </div>
                  </td>
                  <td className="n">
                    {c.usd.held ? (
                      usdCents(c.usd.value.value)
                    ) : (
                      <GapNote gap={c.usd.gap} where={`${HERE} · ${c.key}`} returnTo={props.returnTo} />
                    )}
                  </td>
                  <td className="n">
                    {countOrGap(c.attemptsMeasured)} / {countOrGap(c.attemptsUnmeasured)}
                  </td>
                  <td className="note">
                    {c.nonDollar && c.nonDollar.entries > 0
                      ? `${count(c.nonDollar.requests)} request${c.nonDollar.requests === 1 ? "" : "s"} · ${bytesText(c.nonDollar.bytes)} · ${durationText(c.nonDollar.durationMs)}`
                      : "nothing else recorded"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 6 — by model, as names (ADM-33) */}
      <div className="scroll-x">
        <table className="cost">
          <thead>
            <tr>
              <th>By model</th>
              <th>What this cost is</th>
              <th className="n">Spend</th>
              <th className="n">Attempts measured / not</th>
            </tr>
          </thead>
          <tbody>
            {props.costByModel.length === 0 && (
              <tr>
                <td colSpan={4} className="gap">
                  not read — republish the snapshot to fill this table.
                </td>
              </tr>
            )}
            {props.costByModel.map((c) => {
              const reading = costClassOf(c);
              return (
                <tr key={c.key} className={`cost-${reading.cls.toLowerCase().replace(/_/g, "-")}`}>
                  <td>
                    <span title={c.key}>{modelLabel(c.key)}</span>
                  </td>
                  <td>
                    <span className={`cost-class cost-class-${reading.cls.toLowerCase().replace(/_/g, "-")}`}>{reading.words}</span>
                  </td>
                  <td className="n">
                    {c.usd.held ? (
                      usdCents(c.usd.value.value)
                    ) : (
                      <GapNote gap={c.usd.gap} where={`${HERE} · ${c.key}`} returnTo={props.returnTo} />
                    )}
                  </td>
                  <td className="n">
                    {countOrGap(c.attemptsMeasured)} / {countOrGap(c.attemptsUnmeasured)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 7 — is the cache working, and what did it save */}
      <div className="scroll-x">
        <table className="cost">
          <thead>
            <tr>
              <th>Cache hit rate by caller</th>
              <th className="n">Cached input tokens of all input tokens</th>
            </tr>
          </thead>
          <tbody>
            {props.cacheHitRateByCaller.map((c) => {
              const line = cacheHealthLine(c.health);
              return (
                <tr key={c.callerKey}>
                  <td>
                    <span title={c.callerKey}>{roleLabel(c.callerKey)}</span>
                    {line && <div className="note">{line}</div>}
                  </td>
                  <td className="n">
                    <HeldNum h={c.hitRate} format={count} where={`${HERE} · cache hit rate · ${c.callerKey}`} returnTo={props.returnTo} />
                  </td>
                </tr>
              );
            })}
            <tr>
              <td>Plain-code share of jobs</td>
              <td className="n">
                <HeldNum h={props.deterministicShare} format={count} where={`${HERE} · plain-code share`} returnTo={props.returnTo} />
              </td>
            </tr>
            <tr>
              <td>Cost per verified record</td>
              <td className="n">
                {props.costPerVerifiedRecord.held ? (
                  <span title={props.costPerVerifiedRecord.value.contract}>
                    <strong>{usdCents(props.costPerVerifiedRecord.value.value)}</strong>
                    <span className="denom"> per record over {count(props.costPerVerifiedRecord.value.denominator)} verified</span>
                  </span>
                ) : (
                  <GapNote gap={props.costPerVerifiedRecord.gap} where={`${HERE} · cost per verified record`} returnTo={props.returnTo} />
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/*
        THE H1 WAIVER'S STANDING CHECK (owner, 2026-09-01). Three states, and
        the third is why this is not a boolean: "not yet observed" is a claim
        about the RECORD, and it is only honest if the recording path is wired.
      */}
      <p className={`note ${props.cacheLine.state === "OBSERVED" ? "state-green" : ""}`}>
        <Said text={props.cacheLine.says} />
        {props.cacheLine.state !== "OBSERVED" && (
          <QueueButton
            where={`${HERE} · organic prod-ask cache read`}
            says={props.cacheLine.says}
            returnTo={props.returnTo}
            compact
          />
        )}
      </p>

      {/*
        The read outcome's own note, when the observation could not be read at
        all. A store that was unreachable and a store that holds nothing are
        different facts, and the page hands this down rather than collapsing
        them into the line above.
      */}
      {props.cacheNote && <p className="note">{props.cacheNote}</p>}

      {/* 8 — ADM-C14: subscription work, separately */}
      <SubscriptionBlock jobs={props.subscriptionJobs ?? null} returnTo={props.returnTo} />

      {/* 9 — the raw forms, one disclosure away and never leading */}
      <details className="status-detail">
        <summary>What each cost class means, and where the policy behind it is written</summary>
        <ul className="glossary">
          <li>
            <strong>{COST_CLASS_WORDS.PAID_MODEL}</strong> — a paid model ran and reported what it cost.
          </li>
          <li>
            <strong>{COST_CLASS_WORDS.PLAIN_CODE}</strong> — current execution policy routes no model step to this role at
            all. This is a reading of the code that runs the work, not of how much it happened to spend.
          </li>
          <li>
            <strong>{COST_CLASS_WORDS.SUBSCRIPTION_JOB}</strong> — ran on the subscription and never touched the API, so it
            leaves no row in this ledger.
          </li>
          <li>
            <strong>{COST_CLASS_WORDS.ZERO_THIS_RUN}</strong> — this work can run on a paid model and none of these rows did.
            It is not a claim that the work is free.
          </li>
          <li>
            <strong>{COST_CLASS_WORDS.NOT_MEASURED}</strong> — a paid model ran and reported no dollar figure. Not zero.
          </li>
          <li>
            <strong>{COST_CLASS_WORDS.PREDATES_MEASUREMENT}</strong> — the rows were written before this was recorded, so
            there is nothing to read either way.
          </li>
        </ul>
        <ul className="glossary">
          {props.costByRole.map((c) => {
            const reading = costClassOf(c);
            return reading.provenIn === null ? null : (
              <li key={c.key}>
                <strong>{roleLabel(c.key)}</strong> <code>{c.key}</code> — {reading.provenIn}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
