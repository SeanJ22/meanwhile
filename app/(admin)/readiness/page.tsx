/**
 * **READINESS · ALL STATES.** (Admin redesign, 2026-09-23.)
 *
 * One row per state and territory. A state tracked with coverage carries its own figures:
 * how many of its registered bodies have a way in, how much of its
 * requirement grid is satisfied, how many of its published meeting versions a
 * reader was confirmed able to open, and the next thing to do — generated
 * from its largest county gap. Every other state says whether its Census
 * governments are registered (its promoted REGISTRATION pointer, and when)
 * and what the Census knows is there (its governments and ZIP codes), never a
 * row of zeros.
 */
import Link from "next/link";

import type { BodyView } from "@/lib/control-plane/admin-view/bodies.ts";
import { containerStanding, countBodies, indexBodies, pct, watchedIndex, type ContainerStanding } from "@/lib/control-plane/admin-view/coverage.ts";
import { bodyFreshness, gridCounts } from "@/lib/control-plane/admin-view/readiness-view.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { censusUniverseWords } from "@/lib/control-plane/admin-view/census-universe.ts";
import { noFiguresCell, registrationWords } from "@/lib/control-plane/admin-view/registration-standing.ts";
import { readReadinessGrid } from "@/lib/control-plane/readiness/read.ts";

import { AuditFooter, NotAsked } from "../_mw/blocks.tsx";
import { censusEntryOf } from "../_mw/data/census-universe.ts";
import { loadContainersWithCodes } from "../_mw/data/geography.ts";
import { loadWatchedBodies } from "../_mw/data/load-bodies.ts";
import { loadRegistryBodies } from "../_mw/data/registry.ts";
import { TRACKED_STATE_CODES, statesByStanding } from "../_mw/load-shell.ts";
import { openPage, type SearchParams } from "../_mw/page-base.ts";
import { withScope } from "../_mw/scope.ts";
import { MwShell } from "../_mw/shell.tsx";
import { Dash, Refusal, Section, mw as s } from "../_mw/ui.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

interface StateRow {
  readonly code: string;
  readonly name: string;
  readonly coverage: { readonly wayIn: number; readonly bodies: number } | null;
  readonly requirements: { readonly current: number; readonly cells: number } | null;
  readonly requirementsGap: string | null;
  readonly delivery: { readonly readBack: number; readonly published: number } | null;
  readonly next: string;
}

function nextThing(name: string, counties: readonly { readonly label: string; readonly standing: ContainerStanding }[], unwalked: number): string {
  const ranked = counties
    .map((c) => ({ label: c.label.replace(/^[A-Z]{2} /, ""), gap: c.standing.counts.bodies - c.standing.counts.wayIn, never: c.standing.counts.neverWalked }))
    .filter((c) => c.gap > 0)
    .sort((a, b) => b.gap - a.gap);
  if (ranked.length === 0) {
    return unwalked > 0 ? `Place ${name}'s remaining bodies in codes: none of its indexed counties shows a gap.` : `No county gap is recorded in ${name}.`;
  }
  const top = ranked[0];
  return `Find a way in for ${top.gap} ${top.gap === 1 ? "body" : "bodies"} in ${top.label}${top.never > 0 ? ` (${top.never} never walked)` : ""} — its largest county gap.`;
}

export default async function ReadinessAllStatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const nowIso = new Date().toISOString();
  const states = TRACKED_STATE_CODES;
  /*
   * Every read this page draws needs only the instant, so all of them start
   * before the policy row is read rather than after it: the body read (the
   * longest), the registry, and each state's grid (its snapshot without the
   * ZIP rows this page never draws: 870 KB of 989 KB on 2026-09-25) beside its
   * counties, not after them. Handled here so a page that stops early at an
   * unopened control plane leaves nothing unobserved; the await below still
   * sees any failure.
   */
  const reads = Promise.all([
    loadRegistryBodies(),
    loadWatchedBodies(nowIso),
    ...states.map(async (code) => {
      const [readiness, counties] = await Promise.all([readReadinessGrid(code), loadContainersWithCodes(code.toUpperCase(), "county")]);
      return { code, readiness, counties };
    }),
  ]);
  reads.catch(() => undefined);
  const base = await openPage("/readiness", sp, nowIso);
  const shellProps = {
    area: "readiness" as const,
    tab: "readiness" as const,
    scope: base.scope,
    scopeLabel: base.shell.label,
    scopeGroups: base.shell.groups,
    here: base.here,
    observedAt: base.nowIso,
    standard: base.standard,
  };
  if (base.repos === null) {
    return (
      <MwShell {...shellProps}>
        <NotAsked detail={base.controlPlaneGap} />
      </MwShell>
    );
  }

  const [registry, bodiesRead, ...perState] = await reads;

  // The standard every state here is measured against, when they share one (they are published under one derivation contract); with none read, the standard in force.
  const contracts = [...new Set(perState.flatMap((p) => (p.readiness.kind === "HELD" ? [p.readiness.snapshot.derivationContract] : [])))];
  shellProps.standard = contracts.length === 1 ? contracts[0] : base.standard;

  const rows: StateRow[] = perState.map(({ code, readiness, counties }) => {
    const name = US_STATES.find((x) => x.code === code)?.name ?? code.toUpperCase();
    const watched: readonly BodyView[] = bodiesRead.kind === "HELD" ? bodiesRead.views.filter((b) => b.stateCode === code) : [];
    const stateBodies = registry.kind === "HELD" ? registry.bodies.filter((b) => b.stateCode === code) : [];
    const cov = registry.kind === "HELD" ? countBodies(stateBodies, watchedIndex(watched).byId) : null;
    const grid = readiness.kind === "HELD" ? gridCounts(readiness.snapshot.capabilities) : null;
    const fresh = bodiesRead.kind === "HELD" ? bodyFreshness(watched, base.nowIso) : null;
    const index = indexBodies(stateBodies);
    const countyStandings =
      counties.kind === "HELD" && registry.kind === "HELD"
        ? counties.value.map((c) => ({ label: c.geography.label, standing: containerStanding(c.zctas, index, watched) }))
        : [];
    return {
      code,
      name,
      coverage: cov ? { wayIn: cov.wayIn, bodies: cov.bodies } : null,
      requirements: grid ? { current: grid.byState.CURRENT, cells: grid.cells } : null,
      requirementsGap: readiness.kind === "HELD" ? null : readiness.kind === "REQUIRES_REPUBLISH" ? "worked out an older way" : "not read",
      delivery: fresh && fresh.published > 0 ? { readBack: fresh.readBack, published: fresh.published } : null,
      next: counties.kind === "HELD" && registry.kind === "HELD" ? nextThing(name, countyStandings, cov ? cov.neverWalked : 0) : "Read this state's bodies and counties to say what comes next.",
    };
  });

  /*
   * Every other state and territory, one row each — tracked everywhere, not
   * only where the product has figures (Sean, 2026-09-23). A state whose
   * REGISTRATION pointer is promoted says so, with when; one with none says
   * nothing is registered; and when the pointers were not read, neither is
   * claimed. Each then says what the Census knows is there, never a zero for
   * what we hold: nothing of ours is measured there, so there is nothing of
   * ours to count.
   */
  const otherRows = statesByStanding(base.registration)
    .filter((st) => st.standing.kind !== "TRACKED")
    .map((st) => ({
      code: st.code,
      name: st.name,
      standing: st.standing,
      words: `${registrationWords(st.name, st.standing)} ${censusUniverseWords(st.name, censusEntryOf(st.code))}`,
    }));
  const registeredCount = otherRows.filter((r) => r.standing.kind === "REGISTERED").length;
  const unregisteredCount = otherRows.filter((r) => r.standing.kind === "NOT_REGISTERED").length;
  const othersWords =
    base.registration.kind === "HELD"
      ? `The other ${otherRows.length} states and territories have no figures of ours: ${registeredCount} of them are registered from the 2022 Census of Governments but not measured yet, and ${unregisteredCount} have nothing registered. Each says what the Census knows is there instead, because a zero would claim we measured.`
      : `The other ${otherRows.length} states and territories have no figures of ours, and whether they are registered was not read just now: ${base.registration.detail} Each says what the Census knows is there instead, because a zero would claim we measured.`;

  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [
    { label: "tracked states", stated: states.length, rendered: rows.length },
    { label: "states and territories", stated: US_STATES.length, rendered: rows.length + otherRows.length },
  ];
  for (const r of rows) {
    if (r.coverage) numbers.push({ label: `${r.code} way in`, value: r.coverage.wayIn, denominator: r.coverage.bodies, contract: "registered bodies with a way in, of every registered body in the state" });
    if (r.requirements) numbers.push({ label: `${r.code} requirements`, value: r.requirements.current, denominator: r.requirements.cells, contract: "grid checks current, of every check in the state's published grid" });
    if (r.delivery) numbers.push({ label: `${r.code} delivery`, value: r.delivery.readBack, denominator: r.delivery.published, contract: "published meeting versions read back by the typed Reader, of every published meeting version in the state" });
  }
  const na = auditRenderedNumbers(numbers);
  const ca = checkStatedEqualsRendered(claims);

  return (
    <MwShell {...shellProps}>
      <nav className={s.crumbs} aria-label="Where you are">
        <span className={s.crumbHere}>All states</span>
      </nav>
      <Section
        title="All states"
        lede="Every state and territory. Those tracked with coverage carry the figures that decide whether work there is worth dispatching; the rest say whether their Census governments are registered and what the Census knows is there. Opening one goes to its readings and its gaps; the figures are its own or they are absent."
      />
      {!na.ok || !ca.ok ? (
        <Refusal title="This page refused to draw its own numbers.">{!na.ok ? na.detail : ca.detail}</Refusal>
      ) : (
        <div className={`${s.card} ${s.cardFlush}`}>
          <div className={s.table} style={{ gridTemplateColumns: "minmax(140px,1fr) minmax(120px,1fr) minmax(120px,1fr) minmax(120px,1fr) minmax(240px,2fr)", minWidth: 760 }}>
            <div className={s.contents}>
              {["State", "Coverage", "Requirements", "Delivery", "Next thing to do"].map((h) => (
                <div key={h} className={s.th}>
                  {h}
                </div>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.code} className={s.contents}>
                <div className={s.td}>
                  <Link href={withScope(`/readiness/${r.code}`, { kind: "state", state: r.code })} className={s.linkStrong}>
                    {r.name}
                  </Link>
                </div>
                <div className={s.td}>
                  {r.coverage ? <span className={`${s.figSm} ${s.cGold}`}>{`${r.coverage.wayIn} of ${r.coverage.bodies}`}</span> : <Dash>NOT READ</Dash>}
                </div>
                <div className={s.td}>
                  {r.requirements ? (
                    <span className={`${s.figSm} ${s.cGold}`} title={`${pct(r.requirements.current, r.requirements.cells)} of the grid`}>{`${r.requirements.current} of ${r.requirements.cells}`}</span>
                  ) : (
                    <span className={s.tdMono}>{r.requirementsGap}</span>
                  )}
                </div>
                <div className={s.td}>
                  {r.delivery ? <span className={`${s.figSm} ${s.cTeal}`}>{`${r.delivery.readBack} of ${r.delivery.published}`}</span> : <Dash>UNKNOWN</Dash>}
                </div>
                <div className={`${s.td} ${s.tdSmall}`}>{r.next}</div>
              </div>
            ))}
            {otherRows.map((r) => (
              <div key={r.code} className={s.contents}>
                <div className={s.td}>
                  <Link href={withScope(`/readiness/${r.code}`, { kind: "state", state: r.code })} className={s.linkStrong}>
                    {r.name}
                  </Link>
                </div>
                <div className={`${s.td} ${s.tdMono}`}>{noFiguresCell(r.standing)}</div>
                <div className={`${s.td} ${s.tdMono}`}>{noFiguresCell(r.standing)}</div>
                <div className={`${s.td} ${s.tdMono}`}>{noFiguresCell(r.standing)}</div>
                <div className={`${s.td} ${s.tdSmall}`}>{r.words}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className={s.note} style={{ fontSize: 14, maxWidth: "76ch", marginTop: 16 }}>
        Coverage is registered bodies with a way in for meetings; Requirements is the state&rsquo;s published grid checks that are satisfied and current; Delivery is
        published meeting versions the typed Reader read back. {othersWords}
      </p>
      <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}
