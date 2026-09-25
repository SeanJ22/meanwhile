import "server-only";

/**
 * **WORK — the composer and the one list of assignments.** (Admin redesign,
 * 2026-09-23; Fleet · Work and Readiness · Work and instructions render this
 * same screen — one queue, one set of references, no second copy.)
 *
 * ```
 *   Ask for something new   the composer (client): geography, words, priority,
 *                           budget → `expansion.scope.set`
 *   Assignments             your instructions (selected geographies, with the
 *                           runner's acknowledgement), then the standing work
 *                           the system owes (published assignment view) and the
 *                           routine meeting reads — each opens in place
 * ```
 *
 * An opened assignment is read live by id: an instruction from the policy row
 * and the runner's reading, a routine read from the body store, anything else
 * from the control plane's records for that id alone.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { readDigests, readFleetSafety, readHeartbeat, readSnapshot } from "@/lib/control-plane/admin-data.ts";
import { readAssignmentSourcesById } from "@/lib/control-plane/assignment-read.ts";
import { routineContractIdOf } from "@/lib/control-plane/assignment-routine.ts";
import { buildAssignments, type AssignmentListRow, type AssignmentState, type AssignmentView } from "@/lib/control-plane/assignment-view.ts";
import type { BodyView } from "@/lib/control-plane/admin-view/bodies.ts";
import {
  instructionKey,
  instructionView,
  routineCard,
  routineDetail,
  standingCard,
  standingDetail,
  STATE_PILL,
  type AssignmentDetailView,
  type CardView,
  type InstructionView,
} from "@/lib/control-plane/admin-view/work-view.ts";
import type { GeographyType } from "@/lib/census-geography/contract.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { isExpansionCycleReading } from "@/lib/control-plane/expansion/reading.ts";
import { resolveRollingCeiling } from "@/lib/control-plane/fleet-safety.ts";
import { fleetSpendCeilingOverrideUsd } from "@/lib/control-plane/gateway/admin-config.ts";
import { censusUniverseWords } from "@/lib/control-plane/admin-view/census-universe.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { PILOT_ZIPS } from "@/lib/health/owner-corpus-compile.ts";
import { readResearchIntents } from "@/lib/control-plane/research-view.ts";
import { runnerStanding } from "@/lib/control-plane/runner-standing.ts";
import { pulseLanesOf, queueLanesOf } from "@/lib/control-plane/scheduler/lane-reading.ts";

import { AuditFooter, EmptyScope, NotAsked } from "../blocks.tsx";
import { Composer, type GeoOption } from "../composer.tsx";
import { censusEntryOf } from "../data/census-universe.ts";
import { listContainers } from "../data/geography.ts";
import { loadWatchedBodies } from "../data/load-bodies.ts";
import { paidLaneOf } from "../data/research-lane.ts";
import { REGISTERED_STATE_CODES, stateName } from "../load-shell.ts";
import { DeliveryTrailCard } from "../delivery-trail.tsx";
import { LaneStrip } from "../lane-strip.tsx";
import { RunnerCard } from "../runner-card.tsx";
import { openPage, param, type SearchParams } from "../page-base.ts";
import { withScope, type MwArea } from "../scope.ts";
import { MwShell } from "../shell.tsx";
import { Cells, DeadEnd, KV, Pill, Refusal, Section, mw as s } from "../ui.tsx";

const ACTION_ROUTE = "/api/admin/action";
const PREVIEW_ROUTE = "/api/admin/geography-preview";
const TYPES: readonly GeographyType[] = ["county", "congressional_district", "cbsa", "state_leg_upper", "state_leg_lower"];
const SHORT_TO_TYPE: Readonly<Record<string, GeographyType>> = {
  county: "county",
  cd: "congressional_district",
  cbsa: "cbsa",
  sldu: "state_leg_upper",
  sldl: "state_leg_lower",
};
const GROUP_ORDER: readonly AssignmentState[] = ["BLOCKED", "FAILED", "WORKING", "WAITING", "UNKNOWN", "SUCCEEDED", "RETIRED"];
const FIRST_PER_GROUP = 4;

type Opened =
  | { readonly kind: "NONE" }
  | { readonly kind: "INSTRUCTION"; readonly view: InstructionView }
  | { readonly kind: "DETAIL"; readonly id: string; readonly detail: AssignmentDetailView; readonly says: string }
  | { readonly kind: "MISSING"; readonly id: string; readonly says: string };

export async function WorkScreen(props: { readonly area: MwArea; readonly searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const path = props.area === "fleet" ? "/admin/work" : "/readiness/work";
  const base = await openPage(path, sp);
  const shellProps = {
    area: props.area,
    tab: "work" as const,
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

  /* ------------------------------------------------------------ what the composer offers */
  const composerState = (param(sp, "st") ?? (base.scope.kind === "all" ? REGISTERED_STATE_CODES[0] ?? US_STATES[0].code : base.scope.state)).toLowerCase();
  const geoParam = param(sp, "geo");
  const initialGeo = (() => {
    if (!geoParam) {
      if (base.scope.kind === "geo") return { type: base.scope.type as string, geoid: base.scope.geoid };
      return null;
    }
    const [short, geoid] = geoParam.split(":");
    const type = SHORT_TO_TYPE[short ?? ""];
    return type && geoid ? { type: type as string, geoid } : null;
  })();
  const openId = param(sp, "open");
  const show = param(sp, "show");

  const [containers, snapshotOut, researchOut, heartbeatOut, bodiesRead, intentsOut, digestsOut] = await Promise.all([
    listContainers(composerState.toUpperCase(), TYPES),
    readSnapshot(base.repos),
    readFleetSafety(base.repos),
    readHeartbeat(base.repos),
    loadWatchedBodies(base.nowIso),
    readResearchIntents(base.repos),
    props.area === "fleet" ? readDigests(base.repos) : Promise.resolve(null),
  ]);

  const geographies: Record<string, GeoOption[]> = {};
  if (containers.kind === "HELD") {
    for (const type of TYPES) {
      geographies[type] = (containers.value[type] ?? []).map((g) => ({ type: g.type, geoid: g.geoid, version: g.version, label: g.label, stateAbbr: g.stateAbbr }));
    }
  }
  const ceiling = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(base.adminConfig));
  const research = researchOut.kind === "HELD" ? researchOut.value : null;
  const lane = paidLaneOf(research);
  const expansionRaw: unknown = research ? (research as { expansion?: unknown }).expansion : null;
  const reading = isExpansionCycleReading(expansionRaw) ? expansionRaw : null;
  const pause = heartbeatOut.kind === "HELD" ? (heartbeatOut.value as { pause?: { since?: string | null } | null }).pause ?? null : null;

  const published = snapshotOut.kind === "HELD" ? snapshotOut.value.assignments ?? null : null;
  const view: AssignmentView | null = published && published.kind === "BUILT" ? published.view : null;
  const rows: readonly AssignmentListRow[] = view?.rows ?? [];
  const bodies: readonly BodyView[] = bodiesRead.kind === "HELD" ? bodiesRead.views : [];
  const scopeState = base.scope.kind === "all" ? null : base.scope.state;
  const inScopeBodies = scopeState === null ? bodies : bodies.filter((b) => b.stateCode === scopeState);

  /* ------------------------------------------------------------ your instructions */
  const instructions = base.selected.map((decision) =>
    instructionView({
      decision,
      reading,
      rows: view ? rows : null,
      totalAssignments: view?.summary.total ?? null,
      paidLaneClosedBecause: lane.open ? null : lane.closedBecause,
      runnerPaused: pause ? { since: pause.since ?? null } : null,
    }),
  );

  /* ------------------------------------------------------------ the opened assignment */
  let opened: Opened = { kind: "NONE" };
  if (openId !== null) {
    const instruction = instructions.find((i) => i.card.id === openId);
    const contractId = routineContractIdOf(openId);
    if (instruction) opened = { kind: "INSTRUCTION", view: instruction };
    else if (openId.startsWith("scope:")) opened = { kind: "MISSING", id: openId, says: "This geography is not on your list any more, or its change has not been read yet." };
    else if (contractId !== null) {
      const body = bodies.find((b) => b.contractIds.includes(contractId));
      opened = body
        ? { kind: "DETAIL", id: openId, detail: routineDetail(body), says: `read from the production data plane at ${bodiesRead.kind === "HELD" ? formatEastern(bodiesRead.asOf) : "no time"}` }
        : { kind: "MISSING", id: openId, says: bodiesRead.kind === "HELD" ? `No routine meeting contract has the id ${contractId}.` : bodiesRead.detail };
    } else {
      const read = await readAssignmentSourcesById(base.repos, openId, { nowIso: base.nowIso, activation: view?.activation ?? null, pilotZips: PILOT_ZIPS });
      if (read.kind === "HELD") {
        const attributed = view && view.summary.costs.attributed.held ? view.summary.costs.attributed.value.value : null;
        const row = buildAssignments(read.value, { costDenominatorUsd: attributed }).find((r) => r.id === openId) ?? null;
        opened = row
          ? { kind: "DETAIL", id: openId, detail: standingDetail(row), says: `read live from the control plane at ${formatEastern(base.nowIso)}` }
          : { kind: "MISSING", id: openId, says: `The records for ${openId} were read and no assignment with that id is among them.` };
      } else opened = { kind: "MISSING", id: openId, says: read.detail };
    }
  }

  /* ------------------------------------------------------------ the list */
  const groups = GROUP_ORDER.map((state) => {
    const listed = rows.filter((r) => r.state === state);
    const total = view?.summary.byState.find((x) => x.state === state)?.count.value ?? listed.length;
    return { state, listed, total };
  }).filter((g) => g.total > 0 || g.listed.length > 0);
  const routineGroups = (["STUCK", "NEEDS ATTENTION", "WORKING", "NOT READ YET"] as const).map((st) => ({ st, bodies: inScopeBodies.filter((b) => b.status === st) })).filter((g) => g.bodies.length > 0);

  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [{ label: "your instructions", stated: base.selected.length, rendered: instructions.length }];
  if (view) {
    numbers.push({ label: "assignments listed", value: rows.length, denominator: view.summary.total, contract: "rows the published assignment list carries, of every assignment the control plane holds" });
    for (const g of groups) claims.push({ label: `listed ${g.state}`, stated: g.listed.length, rendered: g.listed.length });
  }
  const na = auditRenderedNumbers(numbers);
  const ca = checkStatedEqualsRendered(claims);

  const here = (extra: Record<string, string | null>) => withScope(path, base.scope, { st: param(sp, "st"), geo: geoParam, show, ...extra });
  /* Every state and territory can be chosen — the Census lookup behind the geographies covers them all — registered ones first. */
  const stateHref: Record<string, string> = {};
  for (const { code } of US_STATES) stateHref[code] = withScope(path, base.scope, { st: code });
  const composerStates = [
    ...REGISTERED_STATE_CODES.map((code) => ({ code, name: stateName(code) })),
    ...US_STATES.filter((st) => !REGISTERED_STATE_CODES.includes(st.code)).map((st) => ({ code: st.code, name: `${st.name} — nothing registered` })),
  ];
  const selected: Record<string, { priority: number; budgetUsd: number }> = {};
  for (const d of base.selected) selected[`${d.geography.type}|${d.geography.geoid}`] = { priority: d.priority, budgetUsd: d.budgetUsd };

  const card = (c: CardView, detail: ReactNode | null) => {
    const isOpen = detail !== null;
    return (
      <div key={c.id} className={`${s.card} ${s.cardList}`} id={`a-${encodeURIComponent(c.id)}`}>
        <div className={s.row}>
          <Pill tone={c.tone}>{c.pill}</Pill>
          <h3 className={`${s.h3} ${s.grow}`}>{c.title}</h3>
          <span className={s.mono} title={c.id}>
            {c.id.length > 48 ? `${c.id.slice(0, 46)}…` : c.id}
          </span>
          <Link href={`${here({ open: isOpen ? null : c.id })}#a-${encodeURIComponent(c.id)}`} className={s.btnLink} scroll={false}>
            {isOpen ? "Close" : "Open"}
          </Link>
        </div>
        <p className={s.body}>{c.summary}</p>
        {detail}
      </div>
    );
  };

  return (
    <MwShell {...shellProps} extraStrip={[{ label: "LIST PUBLISHED", value: snapshotOut.kind === "HELD" ? formatEastern(snapshotOut.value.publishedAt) : "not read", warn: snapshotOut.kind !== "HELD" }]}>
      {base.scope.kind !== "all" && !base.shell.registered ? (
        <EmptyScope name={stateName(base.scope.state)} scope={base.scope} census={censusUniverseWords(stateName(base.scope.state), censusEntryOf(base.scope.state))} />
      ) : null}
      <Composer
        states={composerStates}
        stateCode={composerState}
        geographies={geographies}
        geographiesGap={containers.kind === "UNREAD" ? containers.detail : null}
        initial={initialGeo}
        ceilingUsd={ceiling.rollingCeilingUsd}
        paidLaneClosedBecause={lane.open ? null : lane.closedBecause}
        selected={selected}
        actionRoute={ACTION_ROUTE}
        previewRoute={PREVIEW_ROUTE}
        stateHref={stateHref}
        workHref={withScope(path, base.scope)}
      />

      <Section
        id="assignments"
        title="Assignments"
        lede="One queue and one set of references across both areas. This list can order and bound work; it never creates a second copy of it. Open one to follow it from why it exists to whether a reader can see what it produced."
      />
      {!na.ok || !ca.ok ? (
        <Refusal title="This list refused to draw its own numbers.">{!na.ok ? na.detail : ca.detail}</Refusal>
      ) : (
        <div className={s.stack14}>
          <h3 className={s.titleStrong16} style={{ margin: "4px 0 0" }}>
            Your instructions — {instructions.length}
          </h3>
          {base.malformedScopes > 0 && (
            <p className={s.goldNote}>
              {base.malformedScopes} entr{base.malformedScopes === 1 ? "y" : "ies"} on your policy row could not be read as a geography, so the runner holds all paid work until
              it is fixed.
            </p>
          )}
          {instructions.length === 0 ? (
            <p className={s.note}>You have not sent any. The runner works through the standing work below in its own order until you do.</p>
          ) : (
            instructions.map((i) => card(i.card, opened.kind === "INSTRUCTION" && opened.view.card.id === i.card.id ? <InstructionDetail view={i} /> : null))
          )}

          <h3 className={s.titleStrong16} style={{ margin: "18px 0 0" }}>
            Standing work the system owes{view ? ` — ${view.summary.total.toLocaleString("en-US")}` : ""}
          </h3>
          {published === null ? (
            <p className={s.note}>The assignment list is not on the published snapshot, so no standing work is listed — not an empty list.</p>
          ) : published.kind === "NOT_BUILT" ? (
            <p className={s.note}>The publisher could not build the assignment list at {formatEastern(published.at)}: {published.says}</p>
          ) : (
            <>
              <p className={s.note}>
                {view!.selection.rule} {view!.selection.omitted > 0 ? `${view!.selection.omitted.toLocaleString("en-US")} rows are not carried on the published list; each group says how many it holds.` : ""}
              </p>
              <div className={s.rowCenter} style={{ gap: 8 }}>
                {groups.map((g) => (
                  <Link key={g.state} href={`${here({ show: show === g.state ? null : g.state, open: null })}#assignments`} className={`${s.chip} ${show === g.state ? s.chipOn : ""}`}>
                    {STATE_PILL[g.state].pill.toLowerCase()} · {g.total.toLocaleString("en-US")}
                  </Link>
                ))}
              </div>
              {groups
                .filter((g) => show === null || show === g.state)
                .map((g) => {
                  const cards = show === g.state ? g.listed : g.listed.slice(0, FIRST_PER_GROUP);
                  return (
                    <div key={g.state} className={s.stack14}>
                      <p className={s.note}>
                        {STATE_PILL[g.state].pill.toLowerCase()}: {g.total.toLocaleString("en-US")} in all, {g.listed.length} carried on the published list
                        {cards.length < g.listed.length ? `, ${cards.length} shown — ` : "."}
                        {cards.length < g.listed.length && (
                          <Link href={`${here({ show: g.state, open: null })}#assignments`} className={s.btnLink}>
                            show all {g.listed.length}
                          </Link>
                        )}
                      </p>
                      {cards.map((r) => card(standingCard(r), opened.kind === "DETAIL" && opened.id === r.id ? <DetailSections detail={opened.detail} says={opened.says} /> : null))}
                    </div>
                  );
                })}
            </>
          )}

          <h3 className={s.titleStrong16} style={{ margin: "18px 0 0" }}>
            Routine meeting reads{bodiesRead.kind === "HELD" ? ` — ${inScopeBodies.reduce((n, b) => n + b.contractIds.length, 0)}` : ""}
          </h3>
          {bodiesRead.kind === "UNREAD" ? (
            <p className={s.note}>{bodiesRead.detail}</p>
          ) : (
            routineGroups.map((g) => (
              <div key={g.st} className={s.stack14}>
                {g.bodies.slice(0, show === `routine-${g.st}` ? g.bodies.length : FIRST_PER_GROUP).flatMap((b) =>
                  b.contractIds.map((cid) => {
                    const id = `routine:${cid}`;
                    return card(routineCard(b, cid), opened.kind === "DETAIL" && opened.id === id ? <DetailSections detail={opened.detail} says={opened.says} /> : null);
                  }),
                )}
                {g.bodies.length > FIRST_PER_GROUP && show !== `routine-${g.st}` && (
                  <Link href={`${here({ show: `routine-${g.st}`, open: null })}#assignments`} className={s.btnLink}>
                    Show all {g.bodies.length} {g.st.toLowerCase()} bodies
                  </Link>
                )}
              </div>
            ))
          )}
          {opened.kind === "MISSING" && (
            <Refusal title={`${opened.id} could not be opened.`}>{opened.says}</Refusal>
          )}
        </div>
      )}
      {/* The lane gauges, drawn from the research state read above and refreshed from the pulse while the page is visible (MW-071). */}
      {props.area === "fleet" && <LaneStrip initial={pulseLanesOf(research)} />}
      {/* The runner is not drawn in the design; it follows the design's own sections so Work leads with the instruction, as the design does. */}
      {props.area === "fleet" && (
        <RunnerCard
          standing={runnerStanding(heartbeatOut.kind === "HELD" ? heartbeatOut.value : null, intentsOut.kind === "HELD" ? intentsOut.value : [], base.nowIso, research?.fleetSafety ?? null)}
          heartbeat={heartbeatOut.kind === "HELD" ? heartbeatOut.value : null}
          safety={research?.fleetSafety ?? null}
          digest={digestsOut && digestsOut.kind === "HELD" && digestsOut.value.length > 0 ? digestsOut.value[0] : null}
          digestNote={digestsOut && digestsOut.kind !== "HELD" ? digestsOut.detail : null}
          returnTo={base.here}
          lanes={queueLanesOf(research)}
        />
      )}
      {props.area === "fleet" && (
        <DeliveryTrailCard
          trail={snapshotOut.kind === "HELD" ? snapshotOut.value.deliveryTrail ?? null : null}
          note={snapshotOut.kind === "HELD" ? null : snapshotOut.detail}
        />
      )}
      <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}

function InstructionDetail({ view }: { view: InstructionView }) {
  const d = view.decision;
  return (
    <div className={s.divider}>
      <h4 className={s.h4}>Your words</h4>
      {d.note ? <p className={s.record}>“{d.note}”</p> : <p className={s.note} style={{ marginBottom: 22 }}>You sent this without words of your own.</p>}
      <h4 className={s.h4}>The runner&rsquo;s acknowledgement</h4>
      <div className={s.stack2} style={{ marginBottom: 24 }}>
        {view.ack.map((f) => (
          <div key={f.pill} className={s.activityRow}>
            <Pill tone={f.tone}>{f.pill}</Pill>
            <span className={`${s.text14} ${s.grow}`}>{f.text}</span>
            <span className={s.monoSmall}>{f.at ? formatEastern(f.at) : "—"}</span>
          </div>
        ))}
      </div>
      <h4 className={s.h4}>What it addresses</h4>
      <div className={s.stack8} style={{ marginBottom: 24 }}>
        <div className={s.insetRow}>
          <span className={s.monoId}>{instructionKey(d)}</span>
          <span className={`${s.text14} ${s.grow}`}>
            {d.geography.label}
            {view.reading?.resolution.kind === "RESOLVED" ? ` — ${view.reading.resolution.zctaCount} codes` : ""}
          </span>
          <Pill tone="slate">PRIORITY {d.priority}</Pill>
        </div>
        <p className={s.note}>No requirement instance is recorded against an assignment yet (MW-063); the geography is what it is for.</p>
      </div>
      {view.lanes.length > 0 && (
        <>
          <h4 className={s.h4}>Work lanes, running at once</h4>
          <div className={s.gridAuto240} style={{ gap: 12, marginBottom: 24 }}>
            {view.lanes.map((l) => (
              <div key={l.name} className={s.inset}>
                <div className={s.row10} style={{ marginBottom: 8 }}>
                  <span className={s.name14}>{l.name}</span>
                  <Pill tone={l.tone}>{l.pill}</Pill>
                </div>
                <KV tight rows={l.rows} />
                <p className={s.note} style={{ marginTop: 10 }}>
                  {l.note}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
      <h4 className={s.h4}>What it has spent</h4>
      <p className={s.note} style={{ marginBottom: 24 }}>
        {view.spend}.
      </p>
      <h4 className={s.h4}>Where it got to</h4>
      {view.inScope ? (
        <p className={s.note}>
          {view.inScope.inScope} listed {view.inScope.inScope === 1 ? "assignment is" : "assignments are"} about governments here
          {view.inScope.byState.length > 0 ? `: ${view.inScope.byState.map((b) => `${b.count} ${STATE_PILL[b.state].pill.toLowerCase()}`).join(", ")}` : ""}.
          {view.inScope.floor ? " The runner's list of subjects was cut, so these counts are a floor." : ""}
        </p>
      ) : (
        <p className={s.note}>{view.inScopeWhyNot}</p>
      )}
    </div>
  );
}

function DetailSections({ detail, says }: { detail: AssignmentDetailView; says: string }) {
  return (
    <div className={s.divider}>
      <h4 className={s.h4}>Your words</h4>
      <p className={s.note} style={{ fontSize: 14, marginBottom: 22 }}>
        {detail.wordsNote}
      </p>
      <h4 className={s.h4}>What it addresses</h4>
      <div className={s.stack8} style={{ marginBottom: 10 }}>
        {detail.addresses.map((a) => (
          <div key={`${a.id}-${a.text}`} className={s.insetRow}>
            <span className={s.monoId}>{a.id}</span>
            <span className={`${s.text14} ${s.grow}`}>{a.text}</span>
            <Pill tone={a.tone}>{a.pill}</Pill>
          </div>
        ))}
      </div>
      <p className={s.note} style={{ marginBottom: 24 }}>
        {detail.addressesNote}
      </p>
      <h4 className={s.h4}>Work lanes, running at once</h4>
      <div className={s.gridAuto240} style={{ gap: 12, marginBottom: 24 }}>
        {detail.lanes.map((l) => (
          <div key={l.name} className={s.inset}>
            <div className={s.row10} style={{ marginBottom: 8 }}>
              <span className={s.name14}>{l.name}</span>
              <Pill tone={l.tone}>{l.pill}</Pill>
            </div>
            {l.rows.length > 0 && <KV tight rows={l.rows} />}
            {l.note && (
              <p className={s.note} style={{ marginTop: 10 }}>
                {l.note}
              </p>
            )}
          </div>
        ))}
      </div>
      <h4 className={s.h4}>Which AI it used, and why anything went higher</h4>
      <div className={s.stack8} style={{ marginBottom: 10 }}>
        {detail.models.length === 0 ? (
          <p className={s.note}>{detail.modelsNote}</p>
        ) : (
          detail.models.map((m, i) => (
            <div key={`${i}-${m.step}-${m.pill}`} className={s.insetBox}>
              <div className={s.row}>
                <Pill tone={m.tone}>{m.pill}</Pill>
                <span className={`${s.text14} ${s.grow}`}>{m.step}</span>
                <span className={s.monoSmall}>{m.model}</span>
                <span className={s.figSm} style={{ fontSize: 13, minWidth: 56, textAlign: "right" }}>
                  {m.cost}
                </span>
              </div>
              <p className={s.note} style={{ marginTop: 8 }}>
                {m.why}
              </p>
            </div>
          ))
        )}
      </div>
      {detail.models.length > 0 && (
        <p className={s.note} style={{ marginBottom: 24 }}>
          {detail.modelsNote}
        </p>
      )}
      <h4 className={s.h4}>Where it got to</h4>
      <div style={{ marginBottom: 24 }}>
        <Cells five cells={detail.outcomes.map((o) => ({ key: o.key, value: o.value, label: o.label, unknown: o.unknown, tone: o.tone }))} />
      </div>
      <h4 className={s.h4}>What reached the public site</h4>
      {detail.promoted.length === 0 ? (
        <p className={s.note} style={{ marginBottom: 12 }}>
          {detail.promotedNote}
        </p>
      ) : (
        <div className={s.stack8}>
          {detail.promoted.map((p) => (
            <div key={p.title} className={s.inset}>
              <div className={s.row} style={{ marginBottom: 12 }}>
                <Pill tone={p.tone}>{p.pill}</Pill>
                <span className={`${s.name14} ${s.grow}`}>{p.title}</span>
              </div>
              <KV rows={p.trail} />
            </div>
          ))}
        </div>
      )}
      {detail.unsettled.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h4 className={s.h4} style={{ marginBottom: 6 }}>
            Not settled — this is why it is not finished
          </h4>
          <p className={s.note} style={{ marginBottom: 12 }}>
            Being visited is not the same as finished, and it is never shown as finished.
          </p>
          <div className={s.stack10}>
            {detail.unsettled.map((u) => (
              <DeadEnd key={`${u.pill}-${u.title}`} flush d={{ pill: u.pill, title: u.title, ruledOut: u.ruledOut, wouldSettle: u.wouldSettle, whoMoves: u.whoMoves }} />
            ))}
          </div>
        </div>
      )}
      <p className={`${s.note} ${s.noteTop}`}>
        <strong className={s.strong}>Cost:</strong> {detail.costLine}
      </p>
      <p className={s.monoSmall} style={{ marginTop: 10 }}>
        {says}
      </p>
    </div>
  );
}

