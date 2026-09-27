/**
 * **READINESS · ONE STATE.** (Admin redesign, 2026-09-23 — the design's
 * Readiness screen, replacing the capability-grid panel.)
 *
 * ```
 *   Collection status   which lanes can run now and which cannot, each blocked
 *                       lane blocking only itself
 *   Readings            five readings, five denominators, never combined
 *   Where the gaps are  congressional district | county | metropolitan area →
 *                       one container → every code (ZCTA) in it → one code
 * ```
 *
 * The drilldown keeps membership (which codes a container overlaps, from the
 * published Census lookup) apart from coverage (which bodies reach each code
 * and whether each has a way in, from the reader's own registry and ZIP
 * index) and from work (which bodies' meetings we read now, and how that is
 * going). Switching the container type replaces the rows and closes whatever
 * was open: a county can never stay selected under a district view.
 */
import Link from "next/link";

import { readFleetSafety, readSnapshot } from "@/lib/control-plane/admin-data.ts";
import type { BodyView } from "@/lib/control-plane/admin-view/bodies.ts";
import {
  bodiesAtDivisions,
  containerStanding,
  countBodies,
  coverageStatusPill,
  indexBodies,
  overlapWords,
  pct,
  wayInShare,
  watchedIndex,
  worstGapWords,
  type BodyIndex,
  type ContainerStanding,
  type CoverageCounts,
  type RegistryBody,
} from "@/lib/control-plane/admin-view/coverage.ts";
import { censusUniverseWords } from "@/lib/control-plane/admin-view/census-universe.ts";
import { registrationCountWords } from "@/lib/control-plane/admin-view/registration-standing.ts";
import { bodyFreshness, collectionStatus, gridCounts, readingCards, type ReadingCard } from "@/lib/control-plane/admin-view/readiness-view.ts";
import type { GeographyType } from "@/lib/census-geography/contract.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { expansionScopesOf, scopeKeyOf } from "@/lib/control-plane/expansion/scopes.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, pilotHealthView, type CountClaim, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";
import { readReadinessSnapshot } from "@/lib/control-plane/readiness/read.ts";

import { AuditFooter, EmptyScope, NotAsked } from "../../_mw/blocks.tsx";
import { censusEntryOf } from "../../_mw/data/census-universe.ts";
import { membershipsOfCode, type ContainerWithCodes } from "../../_mw/data/geography.ts";
import { loadWatchedBodies } from "../../_mw/data/load-bodies.ts";
import { loadRegistryBodies } from "../../_mw/data/registry.ts";
import { loadReadinessContainersWithCodes, readReadinessDistrictEdge } from "../../_mw/data/readiness-counties.ts";
import { paidLaneOf } from "../../_mw/data/research-lane.ts";
import { loadRegistrationCounts } from "../../_mw/data/registration.ts";
import { isTrackedState, shellScope, stateName } from "../../_mw/load-shell.ts";
import { openPage, param, type SearchParams } from "../../_mw/page-base.ts";
import { GEO_TYPE_WORDS, geographyShortLabel, withScope, type MwScope } from "../../_mw/scope.ts";
import { MwShell } from "../../_mw/shell.tsx";
import { Dash, Fig, MetaKV, Pill, Refusal, Section, mw as s } from "../../_mw/ui.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type By = "cd" | "county" | "metro";
const BY_TYPE: Readonly<Record<By, GeographyType>> = { cd: "congressional_district", county: "county", metro: "cbsa" };
const BY_WORDS: Readonly<Record<By, { readonly tab: string; readonly head: string; readonly many: string }>> = {
  cd: { tab: "Congressional district", head: "District", many: "districts" },
  county: { tab: "County", head: "County", many: "counties" },
  metro: { tab: "Metropolitan area", head: "Metropolitan area", many: "metropolitan and micropolitan areas" },
};
const TYPE_BY: Readonly<Record<string, By>> = { congressional_district: "cd", county: "county", cbsa: "metro" };

function parseBy(raw: string | null): By {
  return raw === "county" || raw === "metro" || raw === "cd" ? raw : "cd";
}

const shortLabel = geographyShortLabel;

function standingFig(c: CoverageCounts | null, indexed: number): { text: string | null; tone: "gold" | "teal" | "amber"; unknown: string } {
  if (c === null || indexed === 0) return { text: null, tone: "gold", unknown: "NOT INDEXED" };
  if (c.bodies === 0) return { text: null, tone: "gold", unknown: "NO BODY PLACED" };
  const share = wayInShare(c) ?? 0;
  return { text: pct(c.wayIn, c.bodies), tone: share >= 0.8 ? "teal" : share >= 0.4 ? "gold" : "amber", unknown: "" };
}

export default async function ReadinessStatePage({
  params,
  searchParams,
}: {
  params: Promise<{ state: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { state: rawState } = await params;
  const code = rawState.trim().toLowerCase();
  const sp = await searchParams;
  // An untracked state's registration counts are asked for beside the page's opening reads, not after them (one ~300-byte row; NOT_PUBLISHED when none is promoted).
  const countsRead = isTrackedState(code) ? null : loadRegistrationCounts(code);
  const districtEdge = isTrackedState(code) ? readReadinessDistrictEdge() : null;
  const base = await openPage(`/readiness/${code}`, sp);
  /* The path names the state; a scope elsewhere yields to it, a geography inside it is kept. */
  const scope: MwScope = base.scope.kind !== "all" && base.scope.state === code ? base.scope : { kind: "state", state: code };
  const shell = base.scope === scope ? base.shell : shellScope(scope, base.selected, base.registration);
  const name = stateName(code);
  const by = parseBy(param(sp, "by") ?? (scope.kind === "geo" ? TYPE_BY[scope.type] ?? null : null));
  const openGeoid = param(sp, "c") ?? (scope.kind === "geo" && TYPE_BY[scope.type] === by ? scope.geoid : null);
  const openCode = param(sp, "code");

  const shellProps = {
    area: "readiness" as const,
    tab: "readiness" as const,
    scope,
    scopeLabel: shell.label,
    scopeGroups: shell.groups,
    here: withScope(`/readiness/${code}`, scope, { by: param(sp, "by"), c: openGeoid, code: openCode }),
    observedAt: base.nowIso,
    standard: base.standard,
  };

  const crumbs = (extra: readonly { label: string; href: string | null }[]) => (
    <nav className={s.crumbs} aria-label="Where you are">
      <Link href={withScope("/readiness", { kind: "all" })} className={s.crumb}>
        All states
      </Link>
      <span aria-hidden="true">/</span>
      {extra.length === 0 ? (
        <span className={s.crumbHere}>{name}</span>
      ) : (
        <Link href={withScope(`/readiness/${code}`, scope)} className={s.crumb}>
          {name}
        </Link>
      )}
      {extra.map((e, i) => (
        <span key={e.label} className={s.row10}>
          <span aria-hidden="true">/</span>
          {e.href && i < extra.length - 1 ? (
            <Link href={e.href} className={s.crumb}>
              {e.label}
            </Link>
          ) : (
            <span className={s.crumbHere}>{e.label}</span>
          )}
        </span>
      ))}
    </nav>
  );

  if (!isTrackedState(code)) {
    // A registered state's own counts: one state's row, counted inside Postgres (~300 bytes), never the registration itself.
    const standing = shell.standing;
    const counts = standing !== null && standing.kind === "REGISTERED" && countsRead !== null ? await countsRead : null;
    return (
      <MwShell {...shellProps}>
        {crumbs([])}
        <EmptyScope
          name={name}
          scope={scope}
          standing={standing}
          counts={counts === null ? null : counts.kind === "HELD" ? registrationCountWords(name, counts.value) : counts.kind === "UNREAD" ? counts.detail : null}
          census={censusUniverseWords(name, censusEntryOf(code))}
        />
      </MwShell>
    );
  }
  if (base.repos === null) {
    return (
      <MwShell {...shellProps}>
        {crumbs([])}
        <NotAsked detail={base.controlPlaneGap} />
      </MwShell>
    );
  }

  const [readiness, snapshotOut, researchOut, registry, bodiesRead, containers] = await Promise.all([
    readReadinessSnapshot(code),
    readSnapshot(base.repos),
    readFleetSafety(base.repos),
    loadRegistryBodies(),
    loadWatchedBodies(base.nowIso),
    loadReadinessContainersWithCodes(code.toUpperCase(), BY_TYPE[by], districtEdge ?? undefined),
  ]);

  const snapshot = readiness.kind === "HELD" ? readiness.snapshot : null;
  // A grid worked out under an older contract still names the standard in force — and says the grid predates it. With no grid read, the standard in force is still the standard.
  shellProps.standard =
    snapshot !== null ? snapshot.derivationContract : readiness.kind === "REQUIRES_REPUBLISH" ? `${readiness.currentContract} — the grid on file predates it` : base.standard;
  const watched: readonly BodyView[] = bodiesRead.kind === "HELD" ? bodiesRead.views.filter((b) => b.stateCode === code) : [];
  const stateBodies: readonly RegistryBody[] = registry.kind === "HELD" ? registry.bodies.filter((b) => b.stateCode === code) : [];
  const index: BodyIndex = indexBodies(stateBodies);
  const w = watchedIndex(watched);
  const stateCoverage = registry.kind === "HELD" ? countBodies(stateBodies, w.byId) : null;
  const unplaced = stateBodies.filter((b) => b.ocdId === null && b.alsoServesOcdIds.length === 0).length;

  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [];

  /* ------------------------------------------------------------ one code */
  if (openCode !== null) {
    const m = await membershipsOfCode(openCode, ["congressional_district", "county", "cbsa", "state_leg_upper", "state_leg_lower"]);
    const container = containers.kind === "HELD" && openGeoid ? containers.value.find((c) => c.geography.geoid === openGeoid) ?? null : null;
    const containerHref = container ? withScope(`/readiness/${code}`, scope, { by, c: openGeoid }) : null;
    const extra = [
      ...(container ? [{ label: shortLabel(container.geography.label), href: containerHref }] : []),
      { label: openCode, href: null },
    ];
    const bodiesHere = m.kind === "HELD" && m.value.code.indexed ? bodiesAtDivisions(m.value.code.divisions, index) : [];
    const counts = countBodies(bodiesHere, w.byId);
    claims.push({ label: "bodies at this code", stated: counts.bodies, rendered: bodiesHere.length });
    if (counts.bodies > 0) {
      numbers.push({ label: `${openCode} bodies with a way in`, value: counts.wayIn, denominator: counts.bodies, contract: "distinct registered bodies reaching this code whose coverage records a route, of every body reaching it" });
      numbers.push({ label: `${openCode} bodies never walked`, value: counts.neverWalked, denominator: counts.bodies, contract: "distinct registered bodies reaching this code that no walk has reached, of every body reaching it" });
      numbers.push({ label: `${openCode} bodies looked at with no route`, value: counts.lookedNoRoute, denominator: counts.bodies, contract: "distinct registered bodies reaching this code looked at and left with no route, of every body reaching it" });
    }
    const audit = checkStatedEqualsRendered(claims);
    const codeNumbers = auditRenderedNumbers(numbers);
    return (
      <MwShell {...shellProps}>
        {crumbs(extra)}
        {!audit.ok || !codeNumbers.ok ? (
          <Refusal title="This code refused to draw its own numbers.">{!audit.ok ? audit.detail : !codeNumbers.ok ? codeNumbers.detail : ""}</Refusal>
        ) : m.kind === "UNREAD" ? (
          <Refusal title={`${openCode} could not be looked up.`}>{m.detail}</Refusal>
        ) : (
          <>
            <div className={`${s.card} ${s.cardAccent}`} style={{ marginBottom: 28 }}>
              <div className={s.row} style={{ marginBottom: 10 }}>
                <h2 className={s.h3Container}>ZIP code tabulation area {openCode}</h2>
                <span className={s.mono}>
                  {m.value.code.indexed ? `${counts.bodies} bodies · ${counts.wayIn} with a way in · ${counts.watched.WORKING + counts.watched["NEEDS ATTENTION"] + counts.watched.STUCK + counts.watched["NOT READ YET"]} watched now` : "not in the ZIP index"}
                </span>
              </div>
              <p className={s.note} style={{ fontSize: 14, lineHeight: 1.55, maxWidth: "80ch", marginBottom: 16 }}>
                Membership comes from the published Census lookup and says which containers this code sits in; it is not coverage. Coverage is which bodies reach
                this code and whether each has a way in — the reader&rsquo;s own registry and ZIP index. A code is a Census tabulation area, not a USPS ZIP code.
              </p>
              <h4 className={s.h4}>Which containers it sits in</h4>
              <div className={s.stack8} style={{ marginBottom: 20 }}>
                {m.value.memberships.length === 0 ? (
                  <p className={s.note}>The lookup places this code in no published container.</p>
                ) : (
                  m.value.memberships.map((mm) => (
                    <div key={`${mm.type}-${mm.geoid}`} className={s.insetRow}>
                      <span className={s.monoText}>{shortLabel(mm.label)}</span>
                      <span className={`${s.note} ${s.grow}`}>{overlapWords(mm.whole, mm.fraction)}</span>
                      <span className={s.mono}>{geoTypeWords(mm.type)}</span>
                    </div>
                  ))
                )}
              </div>
              <h4 className={s.h4}>The bodies that reach it</h4>
              {!m.value.code.indexed ? (
                <div className={s.row}>
                  <Dash>NOT INDEXED</Dash>
                  <span className={s.note}>
                    This code is outside the ZIP index this repository has geometry for, so no body is placed here. That is not a finding that none governs it.
                  </span>
                </div>
              ) : bodiesHere.length === 0 ? (
                <p className={s.note}>No registered body reaches this code.</p>
              ) : (
                <div className={s.stack8}>
                  {bodiesHere
                    .slice()
                    .sort((a, b) => a.coverageStatus.localeCompare(b.coverageStatus) || a.name.localeCompare(b.name))
                    .map((b) => {
                      const sw = coverageStatusPill(b.coverageStatus);
                      const v = w.byId.get(b.id);
                      return (
                        <div key={b.id} className={s.insetRow}>
                          <Pill tone={sw.tone}>{sw.pill}</Pill>
                          <span className={`${s.text14} ${s.grow}`}>{b.name}</span>
                          {v ? (
                            <Link href={withScope(`/admin#body-${encodeURIComponent(v.id)}`, scope, { body: v.id })} className={s.btnLink}>
                              Watched · {v.status.toLowerCase()}
                            </Link>
                          ) : (
                            <span className={s.mono}>not watched</span>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
            <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
          </>
        )}
      </MwShell>
    );
  }

  /* ------------------------------------------------------------ collection status + readings */
  const research = researchOut.kind === "HELD" ? researchOut.value : null;
  const lane = paidLaneOf(research);
  const liveMeetingSources = bodiesRead.kind === "HELD" ? watched.reduce((n, b) => n + b.contractIds.length, 0) : null;
  const status = snapshot ? collectionStatus({ snapshot, paidLaneClosedBecause: lane.open ? null : lane.closedBecause, liveMeetingSources }) : null;
  const grid = snapshot ? gridCounts(snapshot.capabilities) : null;
  const fresh = bodiesRead.kind === "HELD" ? bodyFreshness(watched, base.nowIso) : null;
  const owner = snapshotOut.kind === "HELD" ? snapshotOut.value : null;
  const health = owner ? pilotHealthView(owner, base.nowIso) : null;
  const gates = health
    ? {
        passing: health.cards.filter((c) => c.level === "GREEN").length,
        total: health.cards.length,
        failing: health.cards.filter((c) => c.level !== "GREEN").map((c) => `${c.contract.toLowerCase()} — ${c.headline}`),
      }
    : null;
  const readings: ReadingCard[] = readingCards({
    stateName: name,
    coverage: stateCoverage,
    coverageGap: registry.kind === "UNREAD" ? registry.detail : null,
    registryVersion: registry.kind === "HELD" ? registry.versionId : null,
    grid,
    contract: snapshot?.derivationContract ?? null,
    freshness: fresh,
    gates,
    observedAt: formatEastern(base.nowIso, { year: true }),
  });

  if (stateCoverage) {
    numbers.push({ label: "bodies with a way in", value: stateCoverage.wayIn, denominator: stateCoverage.bodies, contract: "registered bodies in the state whose coverage status records a route, of every registered body in the state" });
  }
  if (grid) numbers.push({ label: "requirement checks current", value: grid.byState.CURRENT, denominator: grid.cells, contract: "capability gate checks CURRENT, of every check the published grid holds for the state" });
  if (fresh && fresh.published > 0) {
    numbers.push({ label: "fresh meeting sources", value: fresh.freshInside, denominator: fresh.published, contract: "published meeting sources confirmed within a day, of every published meeting source in the state" });
    numbers.push({ label: "read back", value: fresh.readBack, denominator: fresh.published, contract: "published meeting versions the typed Reader read back, of every published meeting version in the state" });
  }
  if (gates) numbers.push({ label: "gates passing", value: gates.passing, denominator: gates.total, contract: "pilot health contracts GREEN, of every published contract (system wide)" });

  /* ------------------------------------------------------------ where the gaps are */
  const selectedKeys = new Map(expansionScopesOf(base.adminConfig).scopes.map((d) => [`${d.geography.type}|${d.geography.geoid}`, d]));
  const rows: { readonly c: ContainerWithCodes; readonly standing: ContainerStanding }[] =
    containers.kind === "HELD" && registry.kind === "HELD" ? containers.value.map((c) => ({ c, standing: containerStanding(c.zctas, index, watched) })) : [];
  const walked = rows.filter((r) => r.standing.indexedCodes > 0);
  const notIndexed = rows.length - walked.length;
  /* Biggest gap first: the most bodies with no way in, then the lowest share. */
  const gapOf = (r: { readonly standing: ContainerStanding }) => r.standing.counts.bodies - r.standing.counts.wayIn;
  const ordered = [...walked.sort((a, b) => gapOf(b) - gapOf(a) || (wayInShare(a.standing.counts) ?? 1) - (wayInShare(b.standing.counts) ?? 1)), ...rows.filter((r) => r.standing.indexedCodes === 0)];
  const open = ordered.find((r) => r.c.geography.geoid === openGeoid) ?? null;
  claims.push({ label: `${BY_WORDS[by].many} listed`, stated: rows.length, rendered: ordered.length });
  if (open) claims.push({ label: "codes in the opened container", stated: open.standing.codes, rendered: open.standing.perCode.length });
  for (const r of walked) {
    numbers.push({ label: `${r.c.geography.geoid} way in`, value: r.standing.counts.wayIn, denominator: r.standing.counts.bodies, contract: "distinct bodies placed in the container's indexed codes with a way in, of all of them" });
  }
  // Every per-code figure the opened container draws is inside the same audit (ADM-41).
  if (open) {
    for (const pc of open.standing.perCode) {
      const k = pc.counts;
      if (k === null || k.bodies === 0) continue;
      numbers.push({ label: `${pc.zcta5} way in`, value: k.wayIn, denominator: k.bodies, contract: "distinct registered bodies reaching this code whose coverage records a route, of every body reaching it" });
      numbers.push({ label: `${pc.zcta5} never walked`, value: k.neverWalked, denominator: k.bodies, contract: "distinct registered bodies reaching this code that no walk has reached, of every body reaching it" });
      numbers.push({ label: `${pc.zcta5} looked with no route`, value: k.lookedNoRoute, denominator: k.bodies, contract: "distinct registered bodies reaching this code looked at and left with no route, of every body reaching it" });
    }
  }

  const numberAudit = auditRenderedNumbers(numbers);
  const countAudit = checkStatedEqualsRendered(claims);
  if (!numberAudit.ok || !countAudit.ok) {
    return (
      <MwShell {...shellProps}>
        {crumbs([])}
        <Refusal title="This page refused to draw its own numbers.">
          {!numberAudit.ok && <p>{numberAudit.detail}</p>}
          {!countAudit.ok && <p>{countAudit.detail}</p>}
        </Refusal>
      </MwShell>
    );
  }

  const decision = open ? selectedKeys.get(`${open.c.geography.type}|${open.c.geography.geoid}`) ?? null : null;
  const crossing = open ? crossWords(open.c, by) : null;
  const shortOf = (by === "cd" ? "cd" : by === "county" ? "county" : "cbsa") as "cd" | "county" | "cbsa";

  return (
    <MwShell {...shellProps} extraStrip={[{ label: "GRID PUBLISHED", value: snapshot ? formatEastern(snapshot.publishedAt) : "not published", warn: snapshot === null }]}>
      {crumbs(open ? [{ label: shortLabel(open.c.geography.label), href: null }] : [])}

      {readiness.kind === "UNAVAILABLE" && <Refusal title="The readiness grid could not be read.">{readiness.detail}</Refusal>}
      {readiness.kind === "REQUIRES_REPUBLISH" && (
        <Refusal title="The readiness grid on file was worked out an older way.">
          <p>
            {readiness.says} {readiness.next}
          </p>
          {/* The machine's own facts: moved one disclosure down, never deleted (ADM-1). */}
          <details>
            <summary className={s.btnLink}>Technical details</summary>
            <div className={s.stack6} style={{ marginTop: 8 }}>
              <p className={s.text14}>{readiness.detail}</p>
              <MetaKV
                rows={[
                  ["Contract on the record", readiness.snapshotContract !== null ? readiness.snapshotContract : "no contract marker"],
                  ["Contract it must become", readiness.currentContract],
                  ["Published", readiness.legacy.publishedAt !== null ? formatEastern(readiness.legacy.publishedAt, { year: true }) : "no publish time on record"],
                  ["Publisher", readiness.legacy.publisher !== null ? readiness.legacy.publisher : "not recorded"],
                  ["Published from", readiness.legacy.publishedFromSha !== null ? readiness.legacy.publishedFromSha : "not recorded"],
                  ["Store revision", readiness.legacy.revision !== null ? `${readiness.legacy.revision}${readiness.legacy.updatedAt !== null ? `, written ${formatEastern(readiness.legacy.updatedAt, { year: true })}` : ""}` : "not read"],
                  ["Cleared by", `${readiness.clearedBy.command} — ${readiness.clearedBy.unattended}`],
                  ["Source", readiness.source],
                ]}
              />
            </div>
          </details>
        </Refusal>
      )}

      {status && (
        <div className={s.card} style={{ marginBottom: 28 }}>
          <div className={s.row} style={{ marginBottom: 12 }}>
            <Pill tone={status.pill === "READY" ? "teal" : status.pill === "PARTLY READY" ? "gold" : "amber"}>{status.pill}</Pill>
            <h2 className={s.h2Inline}>Collection status · {name}</h2>
          </div>
          <p className={s.ledeCard}>{status.lede}</p>
          <div className={s.gridAuto300}>
            <div className={s.insetTile}>
              <div className={s.row10} style={{ marginBottom: 12 }}>
                <Pill tone="teal">CAN RUN NOW</Pill>
                <strong className={s.titleStrong14}>Eligible lanes</strong>
              </div>
              <div className={s.stack10}>
                {status.eligible.length === 0 ? (
                  <p className={s.note}>None.</p>
                ) : (
                  status.eligible.map((l) => (
                    <p key={l.name} className={s.note} style={{ fontSize: 14 }}>
                      <strong className={s.strong}>{l.name}</strong> — {l.why}
                    </p>
                  ))
                )}
              </div>
            </div>
            <div className={s.insetTile}>
              <div className={s.row10} style={{ marginBottom: 12 }}>
                <Pill tone="amber">BLOCKED</Pill>
                <strong className={s.titleStrong14}>Lanes that cannot start</strong>
              </div>
              <div className={s.stack10}>
                {status.blocked.length === 0 ? (
                  <p className={s.note}>None.</p>
                ) : (
                  status.blocked.map((l) => (
                    <p key={l.name} className={s.note} style={{ fontSize: 14 }} title={l.name.startsWith("Paid") && lane.recorded ? lane.recorded : undefined}>
                      <strong className={s.strong}>{l.name}</strong> — {l.why}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Section title="Readings" lede="Five readings with five denominators. Unlike percentages are never averaged and no sixth number combining them exists." />
      <div className={s.gridAuto300} style={{ marginBottom: 32 }}>
        {readings.map((r) => (
          <div key={r.key} className={r.dashed ? s.dashedCard : `${s.card} ${s.cardReading}`}>
            <div className={s.name14} style={{ fontSize: 15, marginBottom: 14 }}>
              {r.name}
            </div>
            <div className={s.row}>
              <Fig value={r.fig} tone={r.tone} unknown={r.unknown} />
              <span className={s.figTextSmall} style={{ flex: "1 1 140px" }}>
                {r.unit}
              </span>
            </div>
            <p className={s.note} style={{ marginTop: 14 }}>
              {r.note}
            </p>
            <MetaKV rows={r.meta} />
          </div>
        ))}
      </div>

      <Section
        title="Where the gaps are"
        lede={
          <>
            Pick the container a resource decision is actually made in. Codes sit underneath whichever one you open — a code straddling two containers appears in
            both, and its bodies are counted once. Standing is the share of a container&rsquo;s distinct bodies with a way in recorded.
            {unplaced > 0 ? ` ${unplaced} registered bodies in ${name} carry no division, so they are counted in the state and placed in no code.` : ""}
          </>
        }
      />
      <div className={s.rowCenter} style={{ gap: 8, marginBottom: 16 }}>
        {(["cd", "county", "metro"] as const).map((b) => (
          <Link key={b} href={withScope(`/readiness/${code}`, scope.kind === "geo" ? { kind: "state", state: code } : scope, { by: b })} className={`${s.chip} ${b === by ? s.chipOn : ""}`} aria-current={b === by ? "page" : undefined}>
            {BY_WORDS[b].tab}
          </Link>
        ))}
      </div>
      {containers.kind === "UNREAD" ? (
        <Refusal title="The containers could not be listed.">{containers.detail}</Refusal>
      ) : registry.kind === "UNREAD" ? (
        <Refusal title="The bodies could not be placed.">{registry.detail}</Refusal>
      ) : (
        <>
          <div className={`${s.card} ${s.cardFlush}`} style={{ marginBottom: 20 }}>
            <div className={s.table} style={{ gridTemplateColumns: "minmax(140px,1.1fr) minmax(100px,0.7fr) minmax(70px,0.5fr) minmax(70px,0.5fr) minmax(240px,2.4fr)" }}>
              <div className={s.contents}>
                {[BY_WORDS[by].head, "Standing", "Codes", "Bodies", "Worst gap inside it"].map((h) => (
                  <div key={h} className={s.th}>
                    {h}
                  </div>
                ))}
              </div>
              {ordered.map((r) => {
                const st = standingFig(r.standing.counts, r.standing.indexedCodes);
                const isOpen = open?.c.geography.geoid === r.c.geography.geoid;
                const cell = `${s.td} ${isOpen ? s.tdSelected : ""}`;
                return (
                  <div key={r.c.geography.geoid} className={s.contents}>
                    <div className={cell}>
                      <Link href={withScope(`/readiness/${code}`, scope.kind === "geo" ? { kind: "state", state: code } : scope, { by, c: isOpen ? null : r.c.geography.geoid })} className={s.linkStrong} aria-expanded={isOpen}>
                        {shortLabel(r.c.geography.label)}
                      </Link>
                    </div>
                    <div className={cell}>{st.text === null ? <Dash>{st.unknown}</Dash> : <span className={`${s.figSm} ${st.tone === "teal" ? s.cTeal : st.tone === "gold" ? s.cGold : s.cAmber}`}>{st.text}</span>}</div>
                    <div className={`${cell} ${s.tdMono}`}>{r.standing.indexedCodes > 0 && r.standing.indexedCodes < r.standing.codes ? `${r.standing.codes} · ${r.standing.indexedCodes} indexed` : r.standing.codes}</div>
                    <div className={`${cell} ${s.tdMono}`}>{r.standing.indexedCodes === 0 ? "—" : r.standing.counts.bodies}</div>
                    <div className={`${cell} ${s.tdSmall}`}>
                      {r.standing.indexedCodes > 0 && r.standing.indexedCodes < r.standing.codes ? `Only ${r.standing.indexedCodes} of its ${r.standing.codes} codes are indexed, so its figures cover those codes alone. ` : ""}
                      {worstGapWords(r.standing)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <p className={s.note} style={{ fontSize: 14, maxWidth: "78ch", marginBottom: 20 }}>
            {notIndexed === 0
              ? `Every one of the ${rows.length} ${BY_WORDS[by].many} reaching ${name} has at least one code in the ZIP index. Selecting one lists its codes.`
              : `${notIndexed} of the ${rows.length} ${BY_WORDS[by].many} reaching ${name} have no code in the ZIP index this repository has geometry for — one row each, because a percentage for a place nobody has indexed would be a false claim. Selecting one lists its codes.`}
          </p>

          {open && (
            <div className={`${s.card} ${s.cardAccent}`} id="container" style={{ marginBottom: 32 }}>
              <div className={s.row} style={{ marginBottom: 10 }}>
                <h3 className={s.h3Container}>{shortLabel(open.c.geography.label)}</h3>
                <span className={s.mono}>
                  {open.standing.codes} codes · {open.standing.counts.bodies} bodies · {open.standing.counts.wayIn} with a way in
                  {open.standing.indexedCodes < open.standing.codes ? ` · ${open.standing.codes - open.standing.indexedCodes} codes not indexed` : ""}
                </span>
              </div>
              <p className={s.note} style={{ fontSize: 14, lineHeight: 1.55, maxWidth: "80ch", marginBottom: 16 }}>
                {crossing} {open.standing.wholeCodes} of its {open.standing.codes} codes lie wholly inside; the rest reach past its edge and are included whole —
                nothing is clipped to the boundary. Counties, districts and metro areas cut the state differently and are never presented as nested.
              </p>
              <div className={s.stack8} style={{ marginBottom: 18 }}>
                {open.standing.perCode.map((pc) => {
                  const st = standingFig(pc.counts, pc.indexed ? 1 : 0);
                  const k = pc.counts;
                  const watchedHere = k ? k.watched.WORKING + k.watched["NEEDS ATTENTION"] + k.watched.STUCK + k.watched["NOT READ YET"] : 0;
                  return (
                    <div key={pc.zcta5} className={s.insetRow}>
                      <Link href={withScope(`/readiness/${code}`, scope.kind === "geo" ? { kind: "state", state: code } : scope, { by, c: open.c.geography.geoid, code: pc.zcta5 })} className={s.monoText} style={{ color: "inherit" }}>
                        {pc.zcta5}
                      </Link>
                      <span className={`${s.note} ${s.grow}`}>
                        {cap(overlapWords(pc.whole, pc.fraction))}.{" "}
                        {k === null
                          ? "Not in the ZIP index, so its bodies are not placed."
                          : k.bodies === 0
                            ? "No registered body reaches it."
                            : `${k.bodies} ${k.bodies === 1 ? "body" : "bodies"}: ${k.wayIn} with a way in, ${k.neverWalked} never walked${k.lookedNoRoute ? `, ${k.lookedNoRoute} looked at with no route` : ""}; ${watchedHere} watched now${k.watched.STUCK ? ` (${k.watched.STUCK} stuck)` : ""}.`}
                      </span>
                      {st.text === null ? <Dash>{st.unknown}</Dash> : <span className={`${s.figSm} ${st.tone === "teal" ? s.cTeal : st.tone === "gold" ? s.cGold : s.cAmber}`}>{st.text}</span>}
                    </div>
                  );
                })}
              </div>
              <div className={s.actions}>
                <Link href={withScope("/admin/work", scope, { geo: `${shortOf}:${open.c.geography.geoid}`, st: code })} className={s.btnPrimary}>
                  Deploy fleet here
                </Link>
                {decision ? (
                  <Link href={withScope("/admin/work", scope, { open: `scope:${scopeKeyOf(decision.geography)}` })} className={s.btnSecondary}>
                    Open the assignment already covering it
                  </Link>
                ) : null}
              </div>
              <p className={s.note} style={{ marginTop: 14, maxWidth: "80ch" }}>
                Deploy opens the same instruction the Fleet area uses, with this geography filled in, and shows what sending it does before anything moves. Sending
                creates the work the registry defines here that no clock carries yet (bounded per cycle and per geography), orders all work here first, and bounds
                paid work by a budget.
                {decision ? "" : " No assignment covers this geography yet."}
              </p>
            </div>
          )}
        </>
      )}
      <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}

function cap(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** A container type in words: the header's own word where it has one, else the lookup's type name spelled out. */
function geoTypeWords(type: string): string {
  const known = (GEO_TYPE_WORDS as Readonly<Record<string, string>>)[type];
  return known === undefined ? cap(type.replace(/_/g, " ")) : known;
}

/** What else the container crosses — kept to words the lookup itself supports. */
function crossWords(c: ContainerWithCodes, by: By): string {
  const partial = c.zctas.filter((z) => !z.whole).length;
  const words = BY_WORDS[by].head.toLowerCase();
  return partial === 0 ? `Every code in this ${words} lies wholly inside it.` : `${partial} of its codes also reach into neighbouring places.`;
}
