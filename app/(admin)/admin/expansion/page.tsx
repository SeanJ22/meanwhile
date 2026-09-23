/**
 * **EXPANSION — WHERE THE FLEET WORKS FIRST, AND WHAT IT MAY SPEND THERE.**
 * (Expansion controls, 2026-09-23.)
 *
 * The owner does three things here and nothing more:
 *
 * ```
 *   SELECT    a county, congressional district, metro/micro area or state
 *             legislative district from the published Census geography lookup
 *   SET       its priority (1 runs first) and its rolling 24-hour budget for
 *             paid model work there (may be $0)
 *   MONITOR   what work exists there, what it cost, which governments with
 *             work overlap it, and which of its ZCTAs have none (the gap)
 * ```
 *
 * Selecting a scope starts nothing. It does not open the paid lane, register a
 * government or a source, promote anything, or raise a spend limit: the runner
 * orders the work already registered there first, and the scope's budget can
 * only hold paid work back. Both land at the start of the runner's next cycle.
 *
 * ## Where each part comes from
 *
 * ```
 *   the decisions      the owner's policy row (`AdminConfig.expansionScopes`),
 *                      read live — so a change shows at once, with who and when
 *   the measurements   the runner's last cycle (`ResearchState.expansion`): it
 *                      resolved each scope against the published lookup and
 *                      measured membership, order, spend and coverage there
 *   the assignments    the published assignment list (the owner snapshot)
 *   the choices        the published Census geography lookup, read once for
 *                      this request; anything but "published" is shown as such
 * ```
 *
 * The page audits itself like every console page: every number it draws has a
 * denominator and a contract, and every stated count equals its rendered rows.
 */
import { cookies } from "next/headers";

import type { CensusGeographyLookup, GeographyRef } from "@/lib/census-geography/contract.ts";
import { loadPublishedLookupState, type PublishedLookupSource } from "@/lib/census-geography/reader.ts";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane, readAdminConfig, readFleetSafety, readSnapshot } from "@/lib/control-plane/admin-data.ts";
import { STATE_WORDS } from "@/lib/control-plane/assignment-view.ts";
import { isExpansionCycleReading, MEMBERSHIP_METHOD, type ExpansionCycleReading } from "@/lib/control-plane/expansion/reading.ts";
import {
  COVERED_SCOPE_STATES,
  EXPANSION_SCOPE_TYPES,
  SCOPE_TYPE_WORDS,
  expansionScopesOf,
  isExpansionScopeType,
  scopeKeyOf,
  type ExpansionScopeGeography,
  type ExpansionScopeType,
} from "@/lib/control-plane/expansion/scopes.ts";
import { scopeCardNumbers, scopeCards, type ScopeCard } from "@/lib/control-plane/expansion/view.ts";
import { resolveRollingCeiling } from "@/lib/control-plane/fleet-safety.ts";
import { fleetSpendCeilingOverrideUsd } from "@/lib/control-plane/gateway/admin-config.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim } from "@/lib/control-plane/owner-surface.ts";
import { count, usdCents } from "@/lib/control-plane/plain-words.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import { ConsoleNav } from "../../console-nav.tsx";
import { QueueForm, Said, When, agoText } from "../../console-ui.tsx";
import { EditScopeControl, SelectScopeControl } from "./scope-controls.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Expansion controls",
  robots: { index: false, follow: false, nocache: true },
};

const HERE = "/admin/expansion";
const ACTION_ROUTE = "/api/admin/action";

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** The covered states first, then every other state and territory — never hidden. */
function stateOptions(): { readonly code: string; readonly name: string }[] {
  const all = US_STATES.map((s) => ({ code: s.code.toUpperCase(), name: s.name }));
  const covered = COVERED_SCOPE_STATES.map((code) => all.find((s) => s.code === code)).filter((s): s is { code: string; name: string } => s !== undefined);
  return [...covered, ...all.filter((s) => !(COVERED_SCOPE_STATES as readonly string[]).includes(s.code))];
}

type LookupRead =
  | { readonly kind: "READ"; readonly lookup: CensusGeographyLookup; readonly source: PublishedLookupSource; readonly versionId: string }
  | { readonly kind: "FAILED"; readonly detail: string };

type Choices =
  | { readonly kind: "LISTED"; readonly instances: readonly ExpansionScopeGeography[]; readonly plan: string }
  | { readonly kind: "NOT_LISTED"; readonly says: string };

function toGeography(ref: GeographyRef, type: ExpansionScopeType): ExpansionScopeGeography {
  return { type, geoid: ref.geoid, version: ref.version, label: ref.label, stateAbbr: ref.stateAbbr };
}

async function choicesFor(read: LookupRead, type: ExpansionScopeType, state: string): Promise<Choices> {
  if (read.kind === "FAILED") return { kind: "NOT_LISTED", says: `The Census geography lookup could not be read (${read.detail}). Nothing can be chosen until it can.` };
  if (read.source !== "published") {
    return {
      kind: "NOT_LISTED",
      says:
        read.source === "bootstrap"
          ? "Only the bundled Arizona test fixture is available here, which is not the published Census geography — so nothing is offered to choose from."
          : "The Census geography is not published yet, so there is nothing to choose from. This is not an empty list of places.",
    };
  }
  const listed = await read.lookup.enumerateGroupings(type);
  if (listed.status.kind !== "OK") {
    return {
      kind: "NOT_LISTED",
      says: listed.status.kind === "NOT_YET_PUBLISHED" ? `No ${SCOPE_TYPE_WORDS[type].toLowerCase()} plan is published yet.` : listed.status.note,
    };
  }
  const instances = listed.instances
    .filter((g) => g.stateAbbr === state || g.memberStates.includes(state))
    .map((g) => toGeography(g, type))
    .sort((a, b) => a.label.localeCompare(b.label, "en-US", { numeric: true }));
  return { kind: "LISTED", instances, plan: `${listed.version.plan} (${listed.version.key})` };
}

function money(v: number | null | undefined): string {
  return v === null || v === undefined ? "not measured" : usdCents(v);
}

function ScopeCardView({ card, nowIso }: { card: ScopeCard; nowIso: string }) {
  const d = card.decision;
  const g = d.geography;
  return (
    <section className="card" id={`scope-${d.key.replace(/[^a-z0-9]+/gi, "-")}`}>
      <h3>
        {d.priority}. {g.label}
      </h3>
      <p className="note">
        {SCOPE_TYPE_WORDS[g.type]} · {g.stateAbbr} · plan {g.version} · Census code {g.geoid}
      </p>
      <p className="plain">
        Priority <strong>{d.priority}</strong>, with a budget of <strong>{usdCents(d.budgetUsd)}</strong> per rolling 24 hours for paid model work
        here{d.budgetUsd === 0 ? " — no paid work here at all" : ""}. Chosen <When iso={d.decidedAt} /> by {d.decidedBy}
        {d.previous !== null ? ` (was priority ${d.previous.priority} with ${usdCents(d.previous.budgetUsd)})` : ""}.
        {d.note ? <> Why: <Said text={d.note} /></> : null}
      </p>
      {card.runner.kind === "NOT_YET" ? (
        <p className="note gap">
          <Said text={card.runner.says} />
        </p>
      ) : (
        <ScopeReading card={card} nowIso={nowIso} />
      )}
      <h4>Assignments here</h4>
      {card.assignments === null ? (
        <p className="note gap">
          <Said text={card.assignmentsSays} />
        </p>
      ) : (
        <p className="plain">
          {count(card.assignments.inScope)} of the {count(card.assignments.listed)} listed assignment(s) are about a government in this scope
          {card.assignments.byState.length > 0
            ? `: ${card.assignments.byState.map((s) => `${count(s.count)} ${STATE_WORDS[s.state].label.toLowerCase()}`).join(", ")}`
            : ""}
          .{" "}
          <span className="note">
            The published list is bounded
            {card.assignments.total !== null ? ` (it carries ${count(card.assignments.listed)} of ${count(card.assignments.total)} assignments)` : ""}, so
            these counts are a floor{card.assignments.floor ? ", and so is the scope's subject list the runner published" : ""}.{" "}
            <a href={`/admin/assignments?scope=${encodeURIComponent(d.key)}`}>Open the assignments in this scope</a>
          </span>
        </p>
      )}
      <EditScopeControl actionRoute={ACTION_ROUTE} geography={g} priority={d.priority} budgetUsd={d.budgetUsd} />
    </section>
  );
}

function ScopeReading({ card, nowIso }: { card: ScopeCard; nowIso: string }) {
  if (card.runner.kind !== "READ") return null;
  const r = card.runner.reading;
  return (
    <>
      <p className="note">
        As the runner measured it at the start of its latest cycle, <When iso={card.runner.at} /> ({agoText(card.runner.at, nowIso)}).
      </p>
      {r.resolution.kind === "UNRESOLVED" ? (
        <p className="refusal">
          <strong>Not resolved:</strong> <Said text={r.resolution.why} />. Nothing is placed in it, so it orders nothing.
        </p>
      ) : (
        <ul className="plain">
          <li>
            <strong>{count(r.resolution.zctaCount)}</strong> ZCTA(s) wholly or partly inside it.
          </li>
          {r.work !== null && (
            <li>
              <strong>{count(r.work.registeredObligations)}</strong> standing obligation(s) about {count(r.work.subjects)} government(s) in it;{" "}
              {count(r.work.dueThisCycle)} were due at the cycle start, and {count(r.work.scoutRowsPlacedFirst)} paid-lane row(s) were placed ahead of the rest.
            </li>
          )}
          {r.spend === null ? (
            <li className="gap">Spend here was not read, so it is not shown — not zero.</li>
          ) : (
            <li>
              Spent here: <strong>{money(r.spend.rolling24hUsd)}</strong> in the rolling 24 hours ({count(r.spend.measuredRows24h)} measured row(s)
              {r.spend.unmeasuredRows24h > 0 ? `, ${count(r.spend.unmeasuredRows24h)} with no dollar figure` : ""}) and{" "}
              <strong>{money(r.spend.sevenDayUsd)}</strong> in 7 days ({count(r.spend.measuredRows7d)} measured
              {r.spend.unmeasuredRows7d > 0 ? `, ${count(r.spend.unmeasuredRows7d)} with no dollar figure` : ""}).
            </li>
          )}
          {r.coverage !== null && (
            <>
              <li>
                <strong>{count(r.coverage.withWork)}</strong> of {count(r.coverage.registeredJurisdictions)} registered government(s) overlapping it have
                standing work
                {Object.keys(r.coverage.registeredByClass).length > 0
                  ? ` (registered here: ${Object.entries(r.coverage.registeredByClass).map(([k, v]) => `${count(v)} ${k.toLowerCase().replace(/_/g, " ")}`).join(", ")})`
                  : ""}
                {r.coverage.withWorkSample.length > 0
                  ? `: ${r.coverage.withWorkSample.map((w) => w.name).join("; ")}${r.coverage.withWork > r.coverage.withWorkSample.length ? `; and ${count(r.coverage.withWork - r.coverage.withWorkSample.length)} more` : ""}`
                  : ""}
                .
              </li>
              <li>
                <strong>{count(r.coverage.zctasWithLocalWork)}</strong> of its {count(r.resolution.zctaCount)} ZCTAs have a local government with work;{" "}
                <strong>{count(r.coverage.gapZctas)}</strong> have none — the gap
                {r.coverage.gapSample.length > 0
                  ? ` (${r.coverage.gapSample.join(", ")}${r.coverage.gapZctas > r.coverage.gapSample.length ? `, and ${count(r.coverage.gapZctas - r.coverage.gapSample.length)} more` : ""})`
                  : ""}
                .
              </li>
              {r.coverage.notRegisteredCensusUnits > 0 && (
                <li>
                  {count(r.coverage.notRegisteredCensusUnits)} Census of Governments unit(s) overlap it in a state this repository does not cover yet (
                  {Object.entries(r.coverage.notRegisteredByType).map(([k, v]) => `${count(v)} ${k.toLowerCase()}`).join(", ")}). Covering them is a launch
                  decision this page does not make.
                </li>
              )}
            </>
          )}
        </ul>
      )}
      <p className={r.heldThisCycle !== null && r.heldThisCycle > 0 ? "state-amber" : "note"}>
        Budget: <Said text={r.budgetSays} />
        {r.heldThisCycle !== null
          ? ` Last cycle it held ${count(r.heldThisCycle)} paid Scout(s)${r.work?.scoutAdmitted !== null && r.work?.scoutAdmitted !== undefined ? ` and let ${count(r.work.scoutAdmitted)} through` : ""}.`
          : " How many paid Scouts it held is known once the cycle's dispatch phase ends."}
      </p>
    </>
  );
}

export default async function ExpansionPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const params = (await searchParams) ?? {};
  const jar = await cookies();
  const hasSession = jar.has(ADMIN_SESSION_COOKIE);
  const nowIso = new Date().toISOString();
  const nav = <ConsoleNav view="expansion" currentState={null} states={US_STATES} />;
  const rawType = first(params.type);
  const type: ExpansionScopeType = rawType !== null && isExpansionScopeType(rawType) ? rawType : "county";
  const states = stateOptions();
  const rawState = (first(params.state) ?? "AZ").toUpperCase();
  const state = states.some((s) => s.code === rawState) ? rawState : "AZ";

  const opened = await openControlPlane();
  if (!opened.ok) {
    return (
      <main className="admin console-page">
        {nav}
        <h1>Expansion controls</h1>
        <p className="refusal">
          <strong>We could not ask.</strong> <Said text={opened.detail} />
        </p>
        <p className="note">Nothing below is missing — nothing below has been checked. Your selections are unchanged.</p>
      </main>
    );
  }

  const [configOut, researchOut, snapshotOut] = await Promise.all([
    readAdminConfig(opened.repos),
    readFleetSafety(opened.repos),
    readSnapshot(opened.repos),
  ]);
  let lookupRead: LookupRead;
  try {
    const state0 = await loadPublishedLookupState();
    lookupRead = { kind: "READ", lookup: state0.lookup, source: state0.source, versionId: state0.versionId };
  } catch (error) {
    lookupRead = { kind: "FAILED", detail: error instanceof Error ? error.name : "error" };
  }
  const choices = await choicesFor(lookupRead, type, state);

  const config = configOut.kind === "HELD" ? configOut.value : null;
  const held = expansionScopesOf(config);
  const research = researchOut.kind === "HELD" ? researchOut.value : null;
  const reading: ExpansionCycleReading | null = research !== null && isExpansionCycleReading(research.expansion) ? research.expansion : null;
  const publication = snapshotOut.kind === "HELD" ? snapshotOut.value.assignments : undefined;
  const view = publication?.kind === "BUILT" ? publication.view : null;
  const assignmentTotal = view === null ? null : view.summary.total;
  const cards = scopeCards({ scopes: held.scopes, reading, assignmentRows: view?.rows ?? null, assignmentTotal });
  const ceiling = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(config));

  /* ---------------- THE PAGE'S AUDIT OF ITSELF ---------------- */
  const numbers = scopeCardNumbers(cards, reading?.territory.registeredObligations ?? null);
  const claims: CountClaim[] = [{ label: "selected scopes", stated: held.scopes.length, rendered: cards.length }];
  if (choices.kind === "LISTED") claims.push({ label: "geographies offered", stated: choices.instances.length, rendered: choices.instances.length });
  const numberAudit = auditRenderedNumbers(numbers);
  const countAudit = checkStatedEqualsRendered(claims);
  if (!numberAudit.ok || !countAudit.ok) {
    return (
      <main className="admin console-page">
        {nav}
        <h1>Expansion controls</h1>
        <p className="refusal">
          <strong>This page refused to render its own numbers.</strong>
        </p>
        {!numberAudit.ok && <p className="note">{numberAudit.detail}</p>}
        {!countAudit.ok && <p className="note">{countAudit.detail}</p>}
      </main>
    );
  }

  const lookupLine =
    lookupRead.kind === "FAILED"
      ? `could not be read (${lookupRead.detail})`
      : lookupRead.source === "published"
        ? `published — version ${lookupRead.versionId}`
        : lookupRead.source === "bootstrap"
          ? "the bundled Arizona test fixture only (not published)"
          : "not published yet";
  const nextPriority = held.scopes.reduce((max, s) => Math.max(max, s.priority), 0) + 1;

  return (
    <main className="admin console-page">
      {nav}
      <QueueForm returnTo={HERE} />
      <h1>Expansion — where the fleet works first</h1>
      <p className="plain">
        Choose a geography, give it a priority and a budget, and watch what happens there. The runner puts the work already registered in your
        geographies ahead of the rest — priority 1 first — and each geography&rsquo;s budget caps what paid model work there may spend in any rolling 24
        hours.
      </p>
      <p className="note">
        What this does not do: it starts no work, opens no paid lane, adds no government or source, and raises no spend limit. Budgets can only hold
        paid work back; the Fleet ceiling of <strong>{usdCents(ceiling.rollingCeilingUsd)}</strong> ({ceiling.source === "OVERRIDE" ? "your dial" : "the built-in fallback"}) stays
        the one limit over everything. Changes take effect at the start of the runner&rsquo;s next cycle.
      </p>
      {research !== null && !research.modelLaneEnabled && (
        <p className="note">
          The paid lane is closed right now
          {research.modelLaneDisabledReason !== null ? (
            <>
              : <Said text={research.modelLaneDisabledReason} />
            </>
          ) : (
            <> (the runner recorded why only as closed)</>
          )}
          . Selecting a geography does not open it, so today its budget has nothing to hold back.
        </p>
      )}
      {configOut.kind === "STORE_UNREACHABLE" && (
        <p className="refusal">
          <strong>Your selections could not be read:</strong> <Said text={configOut.detail} /> They are not shown as none.
        </p>
      )}
      {held.malformed > 0 && (
        <p className="refusal">
          <strong>{count(held.malformed)} stored selection(s) could not be read.</strong> While they cannot, the runner holds all paid Scout work, and
          changing the list is refused rather than written over them.
        </p>
      )}

      <h2>Your geographies — {count(held.scopes.length)}</h2>
      {reading !== null && reading.lookup.source !== "published" && (
        <p className="note gap">
          At its last cycle the runner could not resolve any geography: the Census geography was {reading.lookup.source === "NOT_READ" ? "unreadable" : reading.lookup.source}.
          Until it is published, a selected geography orders nothing, and its budget holds paid work in its state.
        </p>
      )}
      {cards.length === 0 ? (
        <p className="note">None selected. The runner works in its normal order until you choose one below.</p>
      ) : (
        cards.map((card) => <ScopeCardView key={card.decision.key} card={card} nowIso={nowIso} />)
      )}

      <h2>Choose a geography</h2>
      <p className="note">Census geography: {lookupLine}.</p>
      <form method="get" action={HERE} className="controls-row">
        <label>
          Kind{" "}
          <select name="type" defaultValue={type}>
            {EXPANSION_SCOPE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SCOPE_TYPE_WORDS[t]}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          State{" "}
          <select name="state" defaultValue={state}>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
                {(COVERED_SCOPE_STATES as readonly string[]).includes(s.code) ? " (covered today)" : ""}
              </option>
            ))}
          </select>
        </label>{" "}
        <button type="submit">Show the list</button>
      </form>
      {choices.kind === "NOT_LISTED" ? (
        <p className="note gap">
          <Said text={choices.says} />
        </p>
      ) : choices.instances.length === 0 ? (
        <p className="note">The published {SCOPE_TYPE_WORDS[type].toLowerCase()} plan has no geography filed under {state}.</p>
      ) : (
        <>
          <p className="note">
            {count(choices.instances.length)} {SCOPE_TYPE_WORDS[type].toLowerCase()} geograph{choices.instances.length === 1 ? "y" : "ies"} in {state}, from the{" "}
            {choices.plan}.
          </p>
          <SelectScopeControl
            actionRoute={ACTION_ROUTE}
            instances={choices.instances}
            defaultPriority={nextPriority}
            selectedKeys={held.scopes.map((s) => scopeKeyOf(s.geography))}
          />
        </>
      )}

      <h2>How &ldquo;in this geography&rdquo; is decided</h2>
      <p className="note">{MEMBERSHIP_METHOD}</p>
      {reading !== null && (
        <p className="note">
          <Said text={reading.orderSays} /> Of the {count(reading.territory.registeredObligations)} standing obligation(s) registered at the last cycle,
          the governments of {count(reading.territory.placedSubjects)} subject(s) have a known territory, {count(reading.territory.statewideSubjects)} are
          statewide, and {count(reading.territory.unplacedSubjects)} could not be placed (candidate and contest work, and governments whose Census unit carries
          no territory) — those keep their normal order and only the Fleet ceiling governs their spend.
        </p>
      )}

      <hr />
      <p className="note audit-footer">
        {numberAudit.detail} {countAudit.detail} Read at <When iso={nowIso} />.
        {hasSession ? "" : " No admin session cookie was present on this render."}
      </p>
    </main>
  );
}
