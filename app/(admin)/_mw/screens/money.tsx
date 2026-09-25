import "server-only";

/**
 * **MONEY — what the operation costs, and what a result cost.** (Admin
 * redesign, 2026-09-23; Fleet · Money and Readiness · Cost render this same
 * screen — COST-ACCOUNTING.md.)
 *
 * ```
 *   Overall spending   three ceilings never blended; every provider with its
 *                      amount, kind, period and how it is read; the manual entry
 *                      and import path for the ones nothing reads; AI usage by
 *                      provider and model; the reconciliation rules
 *   Cost of work       what the paid attempts produced, from their own results;
 *                      what plain-code work caught at no model cost; what needed
 *                      AI; the assignments that cost the most
 * ```
 *
 * Reads: the published snapshot (the UTC month, spend by place, MapTiler, the
 * assignment cost summary), the runner's own spend window, the owner's policy
 * row (the dial and the billing figures), an aggregate over the Scout results
 * (`spend-store.ts`) and the watched bodies' last 24 hours. Each section that
 * could not be read says so; none renders as zero.
 */
import Link from "next/link";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import type { ReactNode } from "react";

import { readFleetSafety, readHeartbeat, readMapTilerUsageDigests, readSnapshot } from "@/lib/control-plane/admin-data.ts";
import { billingFactsOf } from "@/lib/control-plane/billing-facts.ts";
import { displayNameOf } from "@/lib/control-plane/display-name.ts";
import type { BodyView } from "@/lib/control-plane/admin-view/bodies.ts";
import {
  LADDER_RULES,
  ceilingCards,
  eastern,
  ladderTiles,
  modelUsageRows,
  outcomesInScope,
  perAttempt,
  placeWords,
  outcomeWords,
  modelProviderWords,
  providerRows,
  purposeSplit,
  reconciliation,
  resultTiles,
  testAttemptsWords,
  topWorkLine,
  unreadProviders,
  type LedgerMonth,
  type MapTilerReading,
  type OutcomeFacts,
  type PurposeLine,
  type RoutineDay,
} from "@/lib/control-plane/admin-view/money-view.ts";
import { FLEET_SPEND_CEILING_MAX_USD, resolveRollingCeiling } from "@/lib/control-plane/fleet-safety.ts";
import { discoverySearchEnabled, fleetSpendCeilingOverrideUsd } from "@/lib/control-plane/gateway/admin-config.ts";
import { MAPTILER_USAGE_FORMAT_VERSION, type MapTilerUsageSnapshot } from "@/lib/control-plane/maptiler/types.ts";
import { maptilerHistoryNumbers, maptilerSectionNumbers, projectMapTilerAttemptHistory, projectPanel } from "@/lib/control-plane/maptiler/usage.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";

import { AuditFooter, EmptyScope, NotAsked } from "../blocks.tsx";
import { divisionsOf, loadContainer } from "../data/geography.ts";
import { loadWatchedBodies } from "../data/load-bodies.ts";
import { loadSpendFacts } from "../data/spend-store.ts";
import { ladderHeadline } from "@/lib/control-plane/admin-view/model-ladder-view.ts";
import { stateName } from "../load-shell.ts";
import { MapTilerSection } from "../maptiler-panel.tsx";
import { BillingEntry, CeilingDial, DiscoverySearchSwitch, RemoveFact } from "../money-controls.tsx";
import { openPage, param, type SearchParams } from "../page-base.ts";
import { withScope, type MwArea, type MwScope } from "../scope.ts";
import { MwShell } from "../shell.tsx";
import { Dash, Pill, Refusal, Section, mw as s } from "../ui.tsx";

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** No published MapTiler reading: the panel projects NOT CONNECTED, which draws no figures — never zero usage. */
function notConnectedMapTiler(nowIso: string): MapTilerUsageSnapshot {
  return {
    formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
    collectedAt: nowIso,
    publisher: "the admin console",
    connection: "NOT_CONNECTED",
    detail:
      "NOT CONNECTED — the published snapshot carries no MapTiler reading, so nobody has asked " +
      "the provider what this account spent. That is not the same as spending nothing.",
    period: "current_billing_period",
    since: null,
    until: null,
    allowance: null,
    allowanceIsAssumed: true,
    days: [],
    provenance: [],
    actors: null,
  };
}

function scopeWords(scope: MwScope, label: string): string {
  return scope.kind === "all" ? "Everywhere" : label;
}

export async function MoneyScreen(props: { readonly area: MwArea; readonly searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const path = props.area === "fleet" ? "/admin/money" : "/readiness/cost";
  const base = await openPage(path, sp);
  const view = param(sp, "view") === "work" ? "work" : "overall";
  const shellProps = {
    area: props.area,
    tab: props.area === "fleet" ? ("money" as const) : ("cost" as const),
    scope: base.scope,
    scopeLabel: base.shell.label,
    scopeGroups: base.shell.groups,
    here: base.here,
    observedAt: base.nowIso,
    standard: null,
  };
  if (!base.shell.registered) {
    const name = base.scope.kind === "all" ? "Everywhere" : stateName(base.scope.state);
    return (
      <MwShell {...shellProps}>
        <EmptyScope name={name} scope={base.scope} />
      </MwShell>
    );
  }
  if (base.repos === null) {
    return (
      <MwShell {...shellProps}>
        <NotAsked detail={base.controlPlaneGap} />
      </MwShell>
    );
  }

  const here = withScope(path, base.scope, view === "work" ? { view: "work" } : {});
  const segment = (
    <div className={`${s.segmented} ${s.gap24}`} role="tablist" aria-label="Money views">
      <Link role="tab" aria-selected={view === "overall"} className={`${s.segBtn} ${view === "overall" ? s.segBtnOn : ""}`} href={withScope(path, base.scope)}>
        Overall spending
      </Link>
      <Link role="tab" aria-selected={view === "work"} className={`${s.segBtn} ${view === "work" ? s.segBtnOn : ""}`} href={withScope(path, base.scope, { view: "work" })}>
        Cost of work
      </Link>
    </div>
  );

  const [snapshotOut, safetyOut, heartbeatOut] = await Promise.all([readSnapshot(base.repos), readFleetSafety(base.repos), readHeartbeat(base.repos)]);
  /* What the runner last said it applied for paid discovery search (its heartbeat's acknowledgement), or null. */
  const beat = heartbeatOut.kind === "HELD" ? heartbeatOut.value : null;
  const searchApplied = beat?.discoverySearch ?? null;
  const snapshot = snapshotOut.kind === "HELD" ? snapshotOut.value : null;
  const safety = safetyOut.kind === "HELD" ? safetyOut.value.fleetSafety ?? null : null;
  const facts = billingFactsOf(base.adminConfig);
  const assignments = snapshot?.assignments && snapshot.assignments.kind === "BUILT" ? snapshot.assignments.view : null;
  const unpricedModelRows = assignments?.summary.costs.unmeasuredModelRows.held ? assignments.summary.costs.unmeasuredModelRows.value.value : null;
  const ms = snapshot?.monthlySpend ?? null;
  const month: LedgerMonth | null = ms
    ? {
        label: ms.window.label,
        since: ms.window.since,
        asOf: ms.asOf,
        resetsAt: ms.window.resetsAt,
        measuredUsd: ms.total.total,
        measuredRows: ms.total.measured,
        unpricedModelRows,
        byModel: ms.byModel.map((r) => ({ key: r.key, usd: r.usd, measuredRows: r.measuredRows, unmeasuredRows: r.unmeasuredRows })),
        byRole: ms.byRole.map((r) => ({ key: r.key, usd: r.usd, measuredRows: r.measuredRows, unmeasuredRows: r.unmeasuredRows })),
        bySearchSource: ms.bySearchSource ? ms.bySearchSource.map((r) => ({ key: r.key, usd: r.usd, measuredRows: r.measuredRows, unmeasuredRows: r.unmeasuredRows })) : null,
      }
    : null;
  const rolling = safety ? { usd: safety.rolling24Hours.modelUsd, asOf: safety.rolling24Hours.asOf } : null;
  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [];

  let body: ReactNode;
  if (view === "overall") {
    const resolved = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(base.adminConfig));
    /* The owner's paid discovery search switch, read from the same row the runner reads at cycle start. */
    const decisionReceipt = base.adminConfig?.discoverySearch?.receiptId ?? null;
    const searchSwitch = {
      on: discoverySearchEnabled(base.adminConfig),
      decidedWords: base.adminConfig?.discoverySearch?.decidedAt ? formatEastern(base.adminConfig.discoverySearch.decidedAt) : null,
      /* The runner's acknowledgement: it applied THIS decision (the same receipt), or it has not read it yet. */
      acknowledgement:
        searchApplied === null
          ? beat === null
            ? "The runner has not recorded a heartbeat, so it has not said what it applied."
            : `The runner has not said what it applied yet (last beat ${formatEastern(beat.beatAt)}).`
          : searchApplied.receiptId === decisionReceipt
            ? `The runner applied it at ${formatEastern(searchApplied.appliedAt)}: ${searchApplied.enabled ? "on" : "off"}, at most ${searchApplied.perCycle} a cycle and ${searchApplied.perDay} a day.`
            : `The runner has not read this decision yet (last beat ${formatEastern(beat?.beatAt ?? searchApplied.appliedAt)}); it last applied ${searchApplied.enabled ? "on" : "off"} at ${formatEastern(searchApplied.appliedAt)}.`,
    };
    const ceiling = {
      settingUsd: resolved.rollingCeilingUsd,
      source: resolved.source,
      setAt: base.adminConfig?.fleetSpendCeiling?.decidedAt ?? null,
      previousUsd: base.adminConfig?.fleetSpendCeiling?.previousUsd ?? null,
      enforcedUsd: safety?.bounds.rolling24HourModelUsd ?? null,
    };
    /*
     * The map provider: ONE projection, handed both to the audit and to the
     * panel, so the page can never audit one set of numbers and show another.
     * No published reading projects as NOT CONNECTED — never as zero usage.
     */
    const maptilerDigestsOut = await readMapTilerUsageDigests(base.repos);
    const maptilerHistory = maptilerDigestsOut.kind === "HELD" ? projectMapTilerAttemptHistory(maptilerDigestsOut.value, base.nowIso) : null;
    const maptilerPanel = projectPanel({ snapshot: snapshot?.maptiler ?? notConnectedMapTiler(base.nowIso) });
    numbers.push(...maptilerSectionNumbers(maptilerPanel));
    if (maptilerHistory) numbers.push(...maptilerHistoryNumbers(maptilerHistory));
    claims.push({ label: "map provider keys", stated: maptilerPanel.byKey.length, rendered: maptilerPanel.byKey.length });
    claims.push({ label: "map provider services", stated: maptilerPanel.byService.length, rendered: maptilerPanel.byService.length });
    if (maptilerHistory) {
      const thirtyDays = maptilerHistory.windows.find((window) => window.id === "30d");
      claims.push({ label: "map provider 30-day attempts", stated: thirtyDays ? thirtyDays.attempts : maptilerHistory.attempts.length, rendered: maptilerHistory.attempts.length });
    }
    const maptiler: MapTilerReading | null =
      maptilerPanel.readingState === "UNKNOWN"
        ? { used: null, allowance: null, allowanceAssumed: true, since: null, until: null, collectedAt: null, says: maptilerPanel.says }
        : {
            used: maptilerPanel.used,
            allowance: maptilerPanel.allowance,
            allowanceAssumed: maptilerPanel.allowanceIsAssumed,
            since: maptilerPanel.since,
            until: maptilerPanel.until,
            collectedAt: maptilerPanel.collectedAt,
            says: maptilerPanel.says,
          };
    const rows = providerRows({
      month,
      rolling,
      maptiler,
      facts: facts.facts,
      searchCaps: searchApplied === null ? null : { perCycle: searchApplied.perCycle, perDay: searchApplied.perDay, appliedAt: searchApplied.appliedAt },
    });
    const unread = unreadProviders(rows);
    const cards = ceilingCards({ ceiling, rolling, facts: facts.facts });
    const recon = reconciliation({
      month,
      facts: facts.facts,
      unread,
      proofAssignments: assignments ? assignments.summary.byLane.find((l) => l.lane === "PROOF")?.count.value ?? 0 : null,
    });
    const models = month ? modelUsageRows(month) : [];
    const places = snapshot?.spendByPlace ?? null;
    const placeState = base.scope.kind === "all" ? null : base.scope.state;
    const placeRows = places ? places.states.filter((st) => placeState === null || st.state === placeState) : [];
    claims.push({ label: "provider rows", stated: rows.length, rendered: rows.length });
    if (rolling?.usd != null) numbers.push({ label: "rolling 24-hour spend", value: rolling.usd, denominator: ceiling.settingUsd, contract: "measured model spend in the rolling 24 hours, against the ceiling in force" });

    body = (
      <>
        {segment}
        {base.scope.kind !== "all" && (
          <div className={`${s.dashedCard} ${s.gap32}`}>
            <h2 className={s.h2CardTight}>{base.shell.label} — overall spending belongs to the whole operation.</h2>
            <p className={s.lede}>
              The ceilings, the bills and the subscriptions below are for everywhere; none of them is split by place. Only the model money by place narrows,
              and {base.scope.kind === "state" ? "it is shown for this state" : "it names a state, not a county or a district"}. Cost of work narrows further.
            </p>
          </div>
        )}
        <section className={`${s.card} ${s.gap32}`} aria-labelledby="ceilings">
          <h2 id="ceilings" className={s.h2Card}>
            Three ceilings, and only one of them is ours
          </h2>
          <p className={s.lede}>
            These are never added together and never presented as one budget. One is enforced by the application, one by the
            provider, and one is a fixed charge nothing can stop.
          </p>
          <div className={s.grid3}>
            {cards.map((c) => (
              <div key={c.label} className={`${s.insetTile} ${s.stack8}`}>
                {c.amount === null ? <Dash large>NO READING</Dash> : <span className={s.fig}>{c.amount}</span>}
                <span className={s.titleStrong14}>{c.label}</span>
                <span className={s.note}>{c.note}</span>
                <span className={s.monoSmall}>{c.source}</span>
              </div>
            ))}
          </div>
          <div className={s.noteTop}>
            <CeilingDial currentUsd={ceiling.settingUsd} maxUsd={FLEET_SPEND_CEILING_MAX_USD} returnTo={here} />
          </div>
        </section>

        <Section
          title="Every provider"
          lede="Bills, billing periods, subscriptions, usage, credits and when each was read. Where no reading exists the cell says so — an unread bill is not a zero bill. The system's own measurements are their own rows, never merged into a bill's."
        />
        <div className={`${s.card} ${s.cardFlush} ${s.gap32}`}>
          <div className={s.table} style={{ gridTemplateColumns: "minmax(170px,1.2fr) minmax(130px,0.9fr) minmax(130px,0.9fr) minmax(130px,0.9fr) minmax(220px,1.6fr)" }}>
            {["Provider", "Amount", "What kind", "Period", "How it is read"].map((h) => (
              <div key={h} className={s.th}>
                {h}
              </div>
            ))}
            {rows.map((r) => (
              <ProviderRowCells key={r.key} row={r} returnTo={here} searchSwitch={r.key === "ledger-search" ? searchSwitch : null} />
            ))}
          </div>
        </div>
        {facts.malformed > 0 && (
          <p className={s.refusal}>
            {facts.malformed} stored billing figure{facts.malformed === 1 ? "" : "s"} could not be read, so {facts.malformed === 1 ? "it is" : "they are"} not shown. Nothing
            will overwrite {facts.malformed === 1 ? "it" : "them"} until engineering has looked.
          </p>
        )}

        <MapTilerSection panel={maptilerPanel} history={maptilerHistory} historyGap={maptilerDigestsOut.kind === "HELD" ? null : maptilerDigestsOut.detail} />

        <section className={`${s.card} ${s.gap32}`} aria-labelledby="enter">
          <h2 id="enter" className={s.h2Card}>
            Enter a figure the system cannot read
          </h2>
          <p className={s.lede}>
            For every provider above with no reading: what you read, the period it covers, the day you read it and where. It is kept
            with your session reference, shown beside what the system measures itself, and never added to it.
          </p>
          <BillingEntry returnTo={here} />
        </section>

        <Section
          title="AI usage, by provider and model"
          lede={
            month
              ? `${month.label} (UTC) to ${eastern(month.asOf)}, from the charge ledger. Resets ${eastern(month.resetsAt)}. ${modelProviderWords(month)}`
              : undefined
          }
        />
        {month ? (
          <div className={`${s.card} ${s.cardFlush} ${s.gap32}`}>
            <div className={s.table} style={{ gridTemplateColumns: "minmax(200px,1.6fr) minmax(90px,0.7fr) minmax(130px,0.9fr) minmax(90px,0.6fr) minmax(110px,0.8fr) minmax(80px,0.5fr)" }}>
              {["Model", "Provider", "Class", "Charges", "Measured", "Share"].map((h) => (
                <div key={h} className={s.th}>
                  {h}
                </div>
              ))}
              {models.map((m) => (
                <ModelCells key={m.model} m={m} />
              ))}
            </div>
          </div>
        ) : (
          <Refusal title="The month's ledger was not read.">The published snapshot could not be read, so AI usage is not shown. It is not zero.</Refusal>
        )}

        {places && (
          <>
            <Section
              title="Where the model money went, by place"
              lede={`Every charge in the ledger (it begins ${month ? eastern(ms!.ledgerBeginsAt ?? month.since) : "at its first row"}), by the place its work was for. Charges that name no place are their own row, never folded into a state.`}
            />
            <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
              <div className={s.stack10}>
                {placeRows.length === 0 && <span className={s.note}>No charge in the ledger names a place in this state.</span>}
                {placeRows.map((st) => (
                  <div key={st.state} className={s.insetRow}>
                    <span className={s.titleStrong14}>{st.state.length === 2 ? stateName(st.state) : st.label}</span>
                    <span className={s.figSm}>{st.usd === null ? "not measured" : usd(st.usd)}</span>
                    <span className={s.note}>
                      {st.attempts.toLocaleString("en-US")} charges
                      {st.places.length > 0 ? ` · ${st.places.length} places; most: ${st.places.slice(0, 3).map((p) => `${placeWords(p.key)} ${p.usd === null ? "not measured" : usd(p.usd)}`).join(", ")}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <Section title="Reconciliation" />
        <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
          <div className={s.stack14}>
            {recon.map((r) => (
              <div key={r.pill} className={s.row10}>
                <Pill tone={r.tone}>{r.pill}</Pill>
                <span className={s.text14}>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  } else {
    /* ------------------------------------------------------------ cost of work */
    const container = base.scope.kind === "geo" ? loadContainer(base.scope.type, base.scope.geoid) : null;
    const [spend, bodiesRead, containerRead] = await Promise.all([loadSpendFacts(base.nowIso), loadWatchedBodies(base.nowIso), container]);
    const scopeState = base.scope.kind === "all" ? null : base.scope.state;
    let bodies: readonly BodyView[] = [];
    if (bodiesRead.kind === "HELD") {
      if (base.scope.kind === "all") bodies = bodiesRead.views.filter((b) => b.stateCode !== null);
      else if (base.scope.kind === "state") bodies = bodiesRead.views.filter((b) => b.stateCode === scopeState);
      else if (containerRead && containerRead.kind === "HELD") {
        const divisions = divisionsOf(containerRead.value.zctas);
        bodies = bodiesRead.views.filter((b) => b.ocdId !== null && divisions.has(b.ocdId));
      }
    }
    const readToday = bodies.filter((b) => b.day !== null);
    const day: RoutineDay | null =
      readToday.length === 0
        ? null
        : readToday.reduce(
            (acc, b) => ({
              bodiesRead: acc.bodiesRead + 1,
              reads: acc.reads + b.day!.reads,
              gotIn: acc.gotIn + b.day!.gotIn,
              versions: acc.versions + b.day!.versions,
              changedReads: acc.changedReads + b.day!.changedReads,
              cannotTell: acc.cannotTell + b.day!.cannotTell,
              added: acc.added + b.day!.added,
              changed: acc.changed + b.day!.changed,
              removed: acc.removed + b.day!.removed,
            }),
            { bodiesRead: 0, reads: 0, gotIn: 0, versions: 0, changedReads: 0, cannotTell: 0, added: 0, changed: 0, removed: 0 },
          );

    // Paid work narrows by the state its subject names; a county or a district cannot be told apart in a charge (MW-013).
    const facts2 = spend.kind === "HELD" ? spend.facts : null;
    const outcomes: OutcomeFacts[] | null = facts2 ? outcomesInScope(facts2.outcomes, facts2.refusals, scopeState) : null;
    const window =
      outcomes && outcomes.length > 0
        ? `every paid attempt on record, ${eastern(outcomes.map((o) => o.first ?? "").filter((x) => x !== "").sort()[0] ?? base.nowIso)} to ${eastern(outcomes.map((o) => o.last ?? "").sort().slice(-1)[0] ?? base.nowIso)}`
        : "every paid attempt on record";
    const tiles = resultTiles({ outcomes, day, window });
    const ladder = month ? ladderTiles(month) : null;
    const top = facts2
      ? facts2.top
          .filter((t) => scopeState === null || t.state === scopeState)
          .sort((a, b) => b.usd - a.usd)
          .slice(0, 6)
      : [];
    const totalPaid = (outcomes ?? []).reduce((n, o) => n + o.usd, 0);
    const attemptsPaid = (outcomes ?? []).reduce((n, o) => n + o.attempts, 0);
    const found = (outcomes ?? []).filter((o) => o.outcome === "ROUTE_CANDIDATE" || o.outcome === "EVIDENCE_FOUND").reduce((n, o) => n + o.attempts, 0);
    const costs = assignments?.summary.costs ?? null;
    if (outcomes) {
      claims.push({ label: "what the paid attempts produced", stated: outcomes.length, rendered: outcomes.length });
      numbers.push({ label: "paid attempts that found something", value: found, denominator: attemptsPaid, contract: "paid Scout attempts whose own result was a way in or the record, of every paid attempt in scope" });
    }
    if (day) {
      numbers.push({ label: "routine reads that got in", value: day.gotIn, denominator: day.reads, contract: "routine meeting reads in the last 24 hours that reached the source, of every such read in scope" });
      numbers.push({ label: "reads that caught a change", value: day.changedReads, denominator: day.versions, contract: "reads whose promoted version carried a changed record, of every read that promoted a version, last 24 hours" });
    }
    const names = snapshot?.candidateNames;
    /* MW-013: what the paid charges were for, as each recorded it; MW-024: test runs on their own line. */
    const purpose = facts2 ? purposeSplit(facts2.purpose, scopeState) : null;
    const purposeLines: PurposeLine[] = purpose ? [...purpose.lines, ...(purpose.before ? [purpose.before] : []), ...(purpose.notKept ? [purpose.notKept] : []), ...(purpose.test ? [purpose.test] : [])] : [];
    if (purpose) {
      claims.push({ label: "what the paid charges were for", stated: purposeLines.length, rendered: purposeLines.length });
      numbers.push({
        label: "paid charges that recorded their purpose",
        value: purpose.lines.reduce((n, l) => n + l.charges, 0),
        denominator: purpose.totalCharges,
        contract: "production paid charges that recorded what their work was for, of every paid charge in scope, test runs included",
      });
    }

    const scopeName = scopeWords(base.scope, base.shell.label);
    const headline =
      scopeState === null
        ? {
            title: `${scopeName} — what the money bought is split by what each attempt recorded it produced.`,
            text:
              "Every paid attempt records its own result — found a way in, found the record, hit a wall, produced nothing — and its own cost, and those agree with the charge ledger to the cent. That is the split used here. " +
              "Charges now also record what the work was for (MW-013), shown below; charges written before that are named as such and never split by guesswork. Test and proof runs are real money inside every total, and are kept out of what a result cost (MW-024). " +
              "Plain-code work is counted from the routine store and carries no model cost.",
          }
        : {
            title: `${scopeName} — paid work is shown for ${stateName(scopeState)} as a whole${base.scope.kind === "geo" ? ", because no charge records a county or a district" : ""}.`,
            text:
              `A paid attempt names the state of its subject, so ${stateName(scopeState)}'s share and what it produced are exact: ${usd(totalPaid)} on ${attemptsPaid.toLocaleString("en-US")} attempts. Attempts whose subject names no state are counted only in Everywhere.` +
              (base.scope.kind === "geo" ? " The plain-code figures below are this geography's own bodies." : ""),
          };

    body = (
      <>
        {segment}
        <div className={`${s.dashedCard} ${s.gap32}`}>
          <h2 className={s.h2CardTight}>{headline.title}</h2>
          <p className={s.lede}>{headline.text}</p>
        </div>

        <Section
          title="What a result cost"
          lede="Four kinds of work, priced separately against what each produced. Never added into one rate — finding a body we did not have and confirming a record we already hold are not the same result."
        />
        <div className={`${s.grid2} ${s.gap32}`}>
          {tiles.map((t) => (
            <div key={t.title} className={t.figure === null ? s.dashedTile : `${s.card} ${s.cardReading}`}>
              <div className={s.stack8}>
                <span className={s.titleStrong16}>{t.title}</span>
                {t.figure === null ? (
                  <Dash>CANNOT BE WORKED OUT</Dash>
                ) : (
                  <span>
                    <span className={s.fig}>{t.figure}</span> <span className={s.note}>{t.figureLabel}</span>
                  </span>
                )}
                {t.figure === null && t.refused && <span className={s.note}>{t.refused}</span>}
                {t.lines.map((l) => (
                  <span key={l} className={s.text14}>
                    {l}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Section
          title="What the paid attempts produced"
          lede={
            facts2
              ? `${usd(totalPaid)} on ${attemptsPaid.toLocaleString("en-US")} paid attempts — ${window}. The last paid charge was recorded ${facts2.ledger.lastPaidAt ? eastern(facts2.ledger.lastPaidAt) : "at an unrecorded time"}. ${scopeState === null ? "" : "Everywhere: "}${testAttemptsWords(facts2.testAttempts)}`
              : undefined
          }
        />
        {spend.kind === "UNREAD" ? (
          <Refusal title="The Scout results were not read.">{spend.detail}</Refusal>
        ) : (
          <div className={`${s.card} ${s.cardFlush} ${s.gap32}`}>
            <div className={s.table} style={{ gridTemplateColumns: "minmax(200px,1.5fr) minmax(90px,0.6fr) minmax(110px,0.7fr) minmax(110px,0.7fr) minmax(220px,1.6fr)" }}>
              {["What it produced", "Attempts", "Spent", "Each", "What that means"].map((h) => (
                <div key={h} className={s.th}>
                  {h}
                </div>
              ))}
              {(outcomes ?? []).map((o) => (
                <OutcomeCells key={o.outcome} o={o} />
              ))}
            </div>
          </div>
        )}
        {facts2 && (
          <div className={s.gap32}>
          <p className={s.footnote}>
            {scopeState === null ? "" : "Everywhere: "}Checked against the charge ledger: {facts2.ledger.onBoth.toLocaleString("en-US")} attempts are on both records, differing by{" "}
            {usd(facts2.ledger.differenceUsd)} in total.{" "}
            {facts2.ledger.ledgerOnly > 0
              ? `${facts2.ledger.ledgerOnly.toLocaleString("en-US")} Scout charges (${usd(facts2.ledger.ledgerOnlyUsd)}) have no result${facts2.ledger.ledgerOnlyPrewarm === facts2.ledger.ledgerOnly ? " — all of them the hourly prompt-cache pre-warm, which readies the cache for every Scout in a cycle and belongs to no attempt" : `, ${facts2.ledger.ledgerOnlyPrewarm} of them the hourly prompt-cache pre-warm`}. `
              : ""}
            {facts2.ledger.resultsOnly > 0 ? `${facts2.ledger.resultsOnly.toLocaleString("en-US")} results carry no charge: plain-code attempts that never reached a model.` : ""}
          </p>
          </div>
        )}

        <Section
          title="What the paid charges were for"
          lede={
            purpose
              ? `${usd(purpose.totalUsd)} on ${purpose.totalCharges.toLocaleString("en-US")} paid charges — ${purpose.window}${scopeState === null ? "" : `, whose body is in ${stateName(scopeState)}`}. Each line is what the charge itself recorded: the kind of record, the question the work asked, and whether an instruction of yours reached it. Test and proof runs are inside this total, on their own line.`
              : undefined
          }
        />
        {spend.kind === "UNREAD" ? (
          <Refusal title="The charges were not read.">{spend.detail}</Refusal>
        ) : purposeLines.length === 0 ? (
          <p className={s.note}>No paid charge in this scope.</p>
        ) : (
          <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
            <div className={s.stack12}>
              {purposeLines.map((l) => (
                <div key={l.key} className={s.insetRow}>
                  <div className={s.stack2}>
                    <span className={l.tone === "text" ? s.titleStrong14 : `${s.titleStrong14} ${s.note}`}>{l.label}</span>
                    <span className={s.note}>{l.detail}</span>
                  </div>
                  <span className={s.figSm}>{usd(l.usd)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Section
          title="What actually needed AI"
          lede={
            month
              ? `${scopeState === null ? "" : "Everywhere — the month's ledger by model is not split by state. "}${month.label} (UTC), from the charge ledger. The ladder below is enforced in code — work that plain code can do cannot reach AI at all. What is missing is the record of why a particular job would move up, and what both tries cost.`
              : undefined
          }
        />
        {ladder ? (
          <div className={`${s.gridAuto220} ${s.gap20}`}>
            {ladder.map((t) => (
              <div key={t.label} className={`${s.card} ${s.cardReading}`}>
                <div className={s.stack6}>
                  <span className={s.fig}>{t.figure.toLocaleString("en-US")}</span>
                  <span className={s.titleStrong14}>{t.label}</span>
                  <span className={s.note}>{t.note}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Refusal title="The month's ledger was not read.">The published snapshot could not be read, so the ladder&rsquo;s use is not shown.</Refusal>
        )}
        <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
          <div className={s.stack12}>
            {LADDER_RULES.map((r) => (
              <div key={r.text} className={s.row10}>
                <Pill tone={r.holds ? "teal" : "gold"}>{r.holds ? "TRUE" : "NOT YET"}</Pill>
                <span className={s.text14}>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
        <p className={s.footnote}>{ladderHeadline({ ladder: facts2?.ladder ?? null, lastPaidAt: facts2?.ledger.lastPaidAt ?? null, pausedByOwner: safetyOut.kind === "HELD" ? safetyOut.value.pausedByOwner : null })}</p>

        <Section
          title="The assignments that cost the most"
          lede={
            scopeState === null
              ? "Paid work only, by what each assignment's attempts cost in total. A refused attempt is retried, and the retries are counted in."
              : `Paid work whose subject is in ${stateName(scopeState)}, among the six costliest per state.`
          }
        />
        {spend.kind === "UNREAD" ? (
          <Refusal title="Not read.">{spend.detail}</Refusal>
        ) : top.length === 0 ? (
          <p className={s.note}>No paid assignment in this scope.</p>
        ) : (
          <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
            <div className={s.stack12}>
              {top.map((t) => (
                <div key={t.id} className={s.insetRow}>
                  <div className={s.stack2}>
                    <Link className={s.linkStrong} href={withScope(`/admin/work?open=${encodeURIComponent(t.id)}`, base.scope)}>
                      {displayNameOf(t.subject ?? t.recordClass, { candidateNames: names }).name}
                    </Link>
                    <span className={s.note}>
                      {t.recordClass ? `${t.recordClass.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())} · ` : ""}
                      {topWorkLine(t)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {costs && (
          <p className={s.footnote}>
            {scopeState === null ? "" : "Everywhere: "}Of {usd(costs.ledgerMeasuredUsd ?? 0)} measured in the ledger,{" "}
            {costs.attributed.held ? `${usd(costs.attributed.value.value)} is joined to an assignment` : "the share joined to an assignment is not measured"}; {costs.shared.says}{" "}
            {costs.unattributed.rows > 0 ? costs.unattributed.says : ""}
          </p>
        )}
      </>
    );
  }

  const audit = auditRenderedNumbers(numbers);
  const stated = checkStatedEqualsRendered(claims);
  if (!audit.ok || !stated.ok) {
    return (
      <MwShell {...shellProps}>
        <Refusal title="This page refused to draw its own numbers.">
          {!audit.ok && <p>{audit.detail}</p>}
          {!stated.ok && <p>{stated.detail}</p>}
          <p>A number without a denominator, or a headline that disagrees with the rows beneath it, is worse than a blank page: you would act on it.</p>
        </Refusal>
      </MwShell>
    );
  }
  return (
    <MwShell {...shellProps}>
      {body}
      <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}

function ProviderRowCells({
  row,
  returnTo,
  searchSwitch,
}: {
  row: ReturnType<typeof providerRows>[number];
  returnTo: string;
  /** Only on the search line: the owner's switch for paid discovery search. */
  searchSwitch: { readonly on: boolean; readonly decidedWords: string | null; readonly acknowledgement: string } | null;
}) {
  return (
    <>
      <div className={`${s.td} ${s.tdName}`}>
        {row.name}
        {row.shared && <div className={s.tdMonoSmall}>shared with the reader site</div>}
      </div>
      <div className={s.td}>{row.amount === null ? <Dash>NO READING</Dash> : <span className={row.amountTone === "accent" ? `${s.figAmount} ${s.cAccent}` : s.figAmount}>{row.amount}</span>}</div>
      <div className={`${s.td} ${s.tdSmall}`}>{row.kind}</div>
      <div className={`${s.td} ${s.tdMono}`}>{row.period}</div>
      <div className={`${s.td} ${s.tdSmall}`}>
        {row.how}
        {row.factId && (
          <div>
            <RemoveFact id={row.factId} returnTo={returnTo} />
          </div>
        )}
        {searchSwitch && (
          <div>
            <DiscoverySearchSwitch on={searchSwitch.on} decidedWords={searchSwitch.decidedWords} acknowledgement={searchSwitch.acknowledgement} returnTo={returnTo} />
          </div>
        )}
      </div>
    </>
  );
}

function ModelCells({ m }: { m: ReturnType<typeof modelUsageRows>[number] }) {
  return (
    <>
      <div className={`${s.td} ${s.tdName}`}>{m.model}</div>
      <div className={`${s.td} ${s.tdSmall}`}>{m.provider}</div>
      <div className={`${s.td} ${s.tdSmall}`}>{m.tier}</div>
      <div className={`${s.td} ${s.tdMono}`}>{m.charges.toLocaleString("en-US")}</div>
      <div className={s.td}>
        {m.provider === "None" ? <span className={s.tdSmall}>no model cost — plain code</span> : m.usd === null ? <Dash>COST NOT REPORTED</Dash> : <span className={s.figAmount}>{usd(m.usd)}</span>}
        {m.unpriced > 0 && <div className={s.tdMonoSmall}>{m.unpriced} with no cost reported</div>}
      </div>
      <div className={`${s.td} ${s.tdMono}`}>{m.share === null ? "—" : `${Math.round(m.share * 100)}%`}</div>
    </>
  );
}

function OutcomeCells({ o }: { o: OutcomeFacts }) {
  const w = outcomeWords(o.outcome);
  return (
    <>
      <div className={`${s.td} ${s.tdName}`}>{w.label}</div>
      <div className={`${s.td} ${s.tdMono}`}>{o.attempts.toLocaleString("en-US")}</div>
      <div className={s.td}>
        <span className={s.figAmount}>{usd(o.usd)}</span>
        {o.unpriced > 0 && <div className={s.tdMonoSmall}>{o.unpriced} reported no cost</div>}
      </div>
      <div className={`${s.td} ${s.tdMono}`}>{perAttempt(o.usd, o.attempts)}</div>
      <div className={`${s.td} ${s.tdSmall}`}>{w.means}</div>
    </>
  );
}

