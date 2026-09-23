/**
 * **ONE SELECTED GEOGRAPHY, AS THE OWNER READS IT.** (Expansion controls, 2026-09-23.)
 *
 * The decision (priority, budget, who and when), what the runner last measured
 * about it, and the assignments listed there. A server component with no
 * client hooks, so it renders under `renderToStaticMarkup` in the suite; the
 * page adds the edit control beside it.
 *
 * Every figure here is one `scopeCardNumbers` already audited, and every
 * unknown renders as the sentence saying why it is unknown — never as a zero.
 */
import { STATE_WORDS } from "@/lib/control-plane/assignment-view.ts";
import { SCOPE_TYPE_WORDS } from "@/lib/control-plane/expansion/scopes.ts";
import type { ScopeCard } from "@/lib/control-plane/expansion/view.ts";
import { count, usdCents } from "@/lib/control-plane/plain-words.ts";

import { Said, When, agoText } from "../../console-ui.tsx";

function money(v: number | null | undefined): string {
  return v === null || v === undefined ? "not measured" : usdCents(v);
}

/** Everything a scope card says, without its controls. */
export function ScopeCardSummary({ card, nowIso }: { card: ScopeCard; nowIso: string }) {
  const d = card.decision;
  const g = d.geography;
  return (
    <>
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
        {d.note ? (
          <>
            {" "}
            Why: <Said text={d.note} />
            {/[.!?]$/.test(d.note) ? "" : "."}
          </>
        ) : null}
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
          {count(card.assignments.inScope)} of the {count(card.assignments.listed)} listed assignment(s) are about a government in this geography
          {card.assignments.byState.length > 0
            ? `: ${card.assignments.byState.map((s) => `${count(s.count)} ${STATE_WORDS[s.state].label.toLowerCase()}`).join(", ")}`
            : ""}
          .{" "}
          <span className="note">
            The published list is bounded
            {card.assignments.total !== null ? ` (it carries ${count(card.assignments.listed)} of ${count(card.assignments.total)} assignments)` : ""}, so
            these counts are a floor{card.assignments.floor ? ", and so is the subject list the runner published for it" : ""}.{" "}
            <a href={`/admin/assignments?scope=${encodeURIComponent(d.key)}`}>Open the assignments in this geography</a>
          </span>
        </p>
      )}
    </>
  );
}

/** What the runner last measured about one geography. */
export function ScopeReading({ card, nowIso }: { card: ScopeCard; nowIso: string }) {
  if (card.runner.kind !== "READ") return null;
  const r = card.runner.reading;
  return (
    <>
      <p className="note">
        As the runner measured it at the start of its latest cycle, <When iso={card.runner.at} /> ({agoText(card.runner.at, nowIso)}).
      </p>
      {r.resolution.kind === "UNRESOLVED" ? (
        <p className="refusal">
          <strong>Not resolved:</strong> <Said text={r.resolution.why} /> — nothing is placed in it, so it orders nothing.
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
                <strong>{count(r.coverage.withWork)}</strong> of {count(r.coverage.registeredJurisdictions)} registered government(s) in it have standing
                work
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
                  {count(r.coverage.notRegisteredCensusUnits)} Census of Governments unit(s) lie in it in a state this repository does not cover yet (
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
          ? ` Last cycle it held ${count(r.heldThisCycle)} paid Scout(s)${r.work !== null && r.work.scoutAdmitted !== null ? ` and let ${count(r.work.scoutAdmitted)} through` : ""}.`
          : " How many paid Scouts it held is known once the cycle's dispatch phase ends."}
      </p>
    </>
  );
}
