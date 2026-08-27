/**
 * `pnpm coverage --zip 85641` — **WHAT SHOULD EXIST, WHAT WE VERIFIED, WHAT
 * THE PRODUCT STORES, AND WHAT THE READER GETS — COMPARED INDEPENDENTLY.**
 * (2026-08-27, the coverage-truth session.)
 *
 * ## Why a fourth instrument, when three already count things
 *
 * `pnpm matrix` says which facts about which candidates are in which state.
 * `pnpm denominators` says what each existing number counts. `pnpm pilot:verify`
 * spot-checks four zips against a national join. Every one of them measures the
 * project against ITSELF.
 *
 * That is the gap this closes. A store validating itself agrees with itself,
 * and on 2026-08-27 this repository was simultaneously reporting healthy
 * coverage numbers and:
 *
 * - deleting 731 verified bodies whenever its registry generator ran (NH232),
 * - telling readers the sitting Governor of Arizona was a Challenger,
 * - showing five county supervisors as a fifteen-member elected water board,
 * - showing 364 of 460 meetings on bodies that did not hold them,
 * - and rendering "0 upcoming" over a board meeting the body had published.
 *
 * Not one of those was visible to a count. Every one is visible the moment two
 * layers are asked the same question separately.
 *
 * ## The four layers, and the rule that they must not share a source
 *
 * ```
 * L1 EXTERNAL   what an authoritative outside enumerator says exists
 * L2 EVIDENCE   what this project has actually verified
 * L3 PRODUCT    what the canonical serving stores hold
 * L4 SERVED     what the serving path returns for a real reader's point
 * ```
 *
 * **L1 may never be derived from L3.** The external denominator here is the
 * Census Bureau's, through two of its own products, and neither is built from
 * anything this project decided.
 *
 * ## INTEGRITY_DEFECT vs COVERAGE_GAP — the distinction the whole thing rests on
 *
 * Three of the four pilots are deliberately less researched than 85641, so most
 * of what this finds is honest unfinished work and must not be reported as
 * failure. The test is whether a CLAIM was made:
 *
 * - **COVERAGE_GAP** — the outside world holds a subject, the project has not
 *   investigated it, and no layer says it is absent, complete or resolved.
 *   Real owed work. Not a defect.
 * - **INTEGRITY_DEFECT** — a layer asserts something another layer or the
 *   reader contradicts. A verified fact stranded from the product, a product
 *   fact stranded from the reader, an absence asserted over a subject that
 *   exists, a stated count disagreeing with a rendered one.
 *
 * `coverageStatus` is what makes this checkable rather than a judgement call:
 * `KNOWN_UNCOVERED` is a CLAIM about a body and `NOT_ATTEMPTED` is an admission
 * about us, and the two are treated completely differently below.
 *
 * ## What it does NOT do, stated rather than implied
 *
 * L4 here is the **serving path** — `coverageAt`, the function the route calls
 * — and not the DOM. That is one step short of the reader, and the step matters:
 * a component can drop what the server returned, which is exactly what Red
 * Controls 2, 3 and 4 were. `pnpm verify:composition` is the DOM-level check
 * and it covers three bodies, not a zip. Until a DOM walk covers every surface
 * here, this reports L4 as SERVED and never as RENDERED, and the difference is
 * named in the output rather than left for a reader of the report to assume.
 *
 * ```
 * pnpm coverage --zip 85641
 * pnpm coverage                 all four pilots
 * pnpm coverage --json out.json
 * ```
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { globalIntegrityLine } from "../lib/ops/integrity-claim.ts";
import { answerQuestion } from "../lib/routing/ask.ts";
import { resolveRouting } from "../lib/routing/resolve.ts";
import { coverageAt } from "../lib/registry/server.ts";
import { membersOfBody } from "../lib/registry/body-composition.ts";
import { officeIdentity } from "../lib/officials/office-identity.ts";
import { seatHoldersForOffice } from "../lib/registry/server.ts";
import type { Body, Registry } from "../lib/registry/types.ts";
import type { Meeting } from "../lib/sources/types.ts";

const ROOT = process.cwd();
const PILOTS = ["85641", "85701", "07866", "03255"] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The ZCTA centroid each pilot is oriented from, for the serving-path probe. */
const ZIP_POINTS: Record<string, [number, number]> = {
  /* lat, lng. From data/derived — the same centroids the app orients on. */
  "85641": [32.04903, -110.62291],
  "85701": [32.21696, -110.971],
  "07866": [40.95499, -74.48801],
  "03255": [43.31403, -72.02455],
};

type DeltaClass = "INTEGRITY_DEFECT" | "COVERAGE_GAP" | "AGREES";

interface SurfaceRow {
  surface: string;
  external: number | null;
  evidence: number | null;
  product: number | null;
  served: number | null;
  /** Whether any layer asserted absence, completeness or resolution. */
  claimed: boolean;
  delta: DeltaClass;
  why: string;
}

/** A surface this instrument cannot measure, and exactly what is missing. */
interface Unmeasured {
  surface: string;
  missing: string;
}

/* ------------------------------------------------------------- the stores */

const registry = JSON.parse(
  readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8"),
) as Registry;

const snapshot = JSON.parse(
  readFileSync(join(ROOT, "data/meetings-snapshot.json"), "utf8"),
) as { meetings: Meeting[]; sources: { source: string }[]; generatedAt: string };

const censusZips = JSON.parse(
  readFileSync(join(ROOT, "data/derived/census-unit-zips.json"), "utf8"),
) as {
  totals: { byType: Record<string, { total: number; resolved: number }> };
  units: { pid6: string; name: string; type: string; state: string; zips: string[] }[];
};

const countyClip = JSON.parse(
  readFileSync(join(ROOT, "data/audit/gus-2022-clip-counties.json"), "utf8"),
) as Record<string, { kind: string; censusId: string; name: string; web: string | null }[]>;

/** Which clipped county each pilot sits in — stated, never inferred from a name. */
const ZIP_COUNTY: Record<string, string> = {
  "85641": "Pima AZ",
  "85701": "Pima AZ",
  "07866": "Morris NJ",
  "03255": "Merrimack NH",
};

function workstate(state: string): { candidates: { state: string; bodyId?: string }[] } | null {
  const p = join(ROOT, "data", "workstate", `${state}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as { candidates: { state: string; bodyId?: string }[] };
}

const ZIP_STATE: Record<string, string> = {
  "85641": "az",
  "85701": "az",
  "07866": "nj",
  "03255": "nh",
};

function ballotFor(zip: string): {
  contests: { id: string; title: string; ocdId: string }[];
  candidacies: { contestId: string; givenName?: string; familyName?: string }[];
} | null {
  const files: Record<string, string> = {
    "85641": "az-pima-2026.json",
    "85701": "az-pima-2026.json",
    "07866": "nj-morris-2026.json",
    "03255": "nh-merrimack-2026.json",
  };
  const p = join(ROOT, "data", "ballot", files[zip] ?? "");
  if (!files[zip] || !existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as ReturnType<typeof ballotFor> & object;
}

/* -------------------------------------------------- the seams inside a zip */

/**
 * The distinct governing combinations a zip actually contains.
 *
 * `public/streets/<zip>.json` records, per street, which municipalities and
 * which school districts it touches. Distinct combinations of those two sets
 * ARE the seams — the places where two addresses in one zip have different
 * governments — and they are derivable without geocoding a single address.
 *
 * **This is a seam CENSUS, not an address test.** It says how many distinct
 * combinations exist and how many streets sit in each; it does not resolve a
 * house number to a point. That gap is named in the report rather than papered
 * over, because "we exercised every combination" and "we tested one address per
 * combination" are different claims and only the first is made here.
 */
function seamsIn(zip: string): { combinations: number; streets: number; detail: string[] } | null {
  const p = join(ROOT, "public", "streets", `${zip}.json`);
  if (!existsSync(p)) return null;
  const f = JSON.parse(readFileSync(p, "utf8")) as {
    municipalities: { label: string }[];
    schoolDistricts: { label: string }[];
    streets: Record<string, { m: number[]; s: number[] }>;
  };
  const combos = new Map<string, number>();
  for (const [, v] of Object.entries(f.streets)) {
    const key = `${[...v.m].sort().join(",")}|${[...v.s].sort().join(",")}`;
    combos.set(key, (combos.get(key) ?? 0) + 1);
  }
  const detail = [...combos.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const [m, s] = key.split("|");
      const munis = m ? m.split(",").map((i) => f.municipalities[Number(i)]?.label ?? "?") : [];
      const schools = s ? s.split(",").map((i) => f.schoolDistricts[Number(i)]?.label ?? "?") : [];
      return `${String(n).padStart(4)} street(s) · municipality: ${munis.join(" + ") || "unincorporated"} · school: ${schools.join(" + ") || "none"}`;
    });
  return { combinations: combos.size, streets: Object.keys(f.streets).length, detail };
}

/* ------------------------------------------------------------ the measure */

/**
 * The Ask probes for one point, and what they found.
 *
 * A government from ANOTHER pilot is used as the "elsewhere" name, so the probe
 * is a real government this product holds rather than an invented string — the
 * defect was never about unknown names, it was about a known name being
 * overridden by the reader's location.
 */
function askEntityProbes(
  zip: string,
  coverage: Awaited<ReturnType<typeof coverageAt>>,
): { total: number; correct: number; substitutions: string[] } {
  const localLabels = coverage.bodies
    .map((b) => b.name ?? b.divisionLabel)
    .filter((l): l is string => Boolean(l));

  /* A government held by the product, deliberately NOT at this point. */
  const elsewhere = ELSEWHERE_BY_ZIP[zip];
  /*
   * A government that IS at this point — and specifically a SCHOOL DISTRICT,
   * because the probe question below says "school district" to make the topic
   * route. The first version took any place or district, which produced
   * *"What's on the Tucson school district agenda?"* about the CITY of Tucson
   * and then flagged the correct answer (Tucson Unified) as a substitution. A
   * probe has to ask a question that means what the checker assumes it means.
   */
  const local = coverage.bodies.find((b) => b.divisionType === "school_district");

  const substitutions: string[] = [];
  let total = 0;
  let correct = 0;

  /*
   * **THE PROBE MUST ROUTE, OR IT PROVES NOTHING.**
   *
   * The first version of this asked *"What's on the Vail Unified District
   * agenda?"* — which contains no topic keyword, so `matchTopic` returned null,
   * no body was ever named, and the probe scored itself CORRECT. Disabling the
   * repair did not make it fire. A probe that passes whether or not the defect
   * is present is worse than no probe, because it reports green.
   *
   * So the question carries the words that actually route ("school district"),
   * and a probe whose question fails to route is reported as a SUBSTITUTION
   * rather than silently counted as a pass.
   */
  const probe = (name: string, question: string, forbidden: (named: string[]) => string[]) => {
    total++;
    const asked = answerQuestion(question, coverage, zip, { entities: [] });
    if (asked.answer.kind !== "ROUTED") {
      substitutions.push(
        `PROBE DID NOT ROUTE: ${JSON.stringify(question)} produced no topic, so it tests nothing`,
      );
      return;
    }
    const named = asked.answer.steps.flatMap((s) => s.bodies.map((b) => b.label));
    const wrong = forbidden(named);
    if (wrong.length > 0) {
      substitutions.push(`asked about "${name}", answered about ${wrong.join(", ")}`);
    } else {
      correct++;
    }
  };

  if (elsewhere) {
    /* A government we hold, deliberately not at this point. No LOCAL body may
     * be named in reply — that is the reported defect exactly. */
    probe(elsewhere, `What's on the ${elsewhere} school district agenda?`, (named) =>
      named.filter((n) => localLabels.includes(n)),
    );
  }

  if (local) {
    /* And the reader's own government must still answer for them, or the
     * repair has cost more than it fixed. */
    const label = local.name ?? local.divisionLabel ?? "";
    probe(label, `What's on the ${label} school district agenda?`, (named) =>
      named.filter((n) => n !== label && localLabels.includes(n)),
    );
  }

  return { total, correct, substitutions };
}

/**
 * A government this product holds that is NOT at the given zip. Stated per zip
 * rather than derived, so the probe cannot quietly become a self-comparison.
 */
const ELSEWHERE_BY_ZIP: Record<string, string> = {
  /* Vail is ~30 miles from central Tucson and is the tester's own case. */
  "85701": "Vail Unified District",
  "85641": "Sunnyside Unified District",
  "07866": "Kearsarge Regional School District",
  /* A SCHOOL DISTRICT, like the others — the probe question says "school
   * district", so naming a township here asked a question nobody would. */
  "03255": "Morris Hills Regional School District",
};

async function measure(
  zip: string,
  /**
   * An adapter to pretend never ran — its source row AND its meetings both
   * removed, because that is the state faithfully: on 2026-08-26 `civicclerk`
   * had no row in the snapshot AND no meetings in it, and the card said
   * "0 upcoming". Removing only the row leaves the meetings behind and the
   * body never looks silent, which is how the first version of the control
   * passed a broken input.
   */
  excludeAdapter?: string,
): Promise<{
  zip: string;
  rows: SurfaceRow[];
  unmeasured: Unmeasured[];
  enumerators: string[];
  notReached: string[];
  seams: ReturnType<typeof seamsIn>;
  defects: string[];
  gaps: string[];
}> {
  const rows: SurfaceRow[] = [];
  const unmeasured: Unmeasured[] = [];
  const defects: string[] = [];
  const gaps: string[] = [];

  const point = ZIP_POINTS[zip];
  const served = await coverageAt(point[0], point[1], 0);
  const servedBodies = served.bodies;

  /* ---- L1, from two Census products that disagree BY CONSTRUCTION -------- */
  const zipUnits = censusZips.units.filter((u) => u.zips.includes(zip));
  const clip = countyClip[ZIP_COUNTY[zip]] ?? [];

  const enumerators = [
    `Census ZIP crosswalk (data/derived/census-unit-zips.json): ${zipUnits.length} government(s) resolved to ${zip}`,
    `2022 Census of Governments, clipped to ${ZIP_COUNTY[zip]} (data/audit/gus-2022-clip-counties.json): ${clip.length} government(s) in the COUNTY`,
  ];

  /*
   * **THE DISAGREEMENT IS PRESERVED, NOT RESOLVED.** These two are the same
   * bureau and they answer different questions: the crosswalk is per-ZIP and
   * resolves 0 of 39,555 special districts nationally because the Census
   * publishes no geography for them; the clip is per-COUNTY and carries 60 of
   * them across the three pilot counties. Neither is the denominator. Forcing
   * them to agree would delete the very class this product exists to reach.
   */
  const specialResolved = censusZips.totals.byType["SPECIAL DISTRICT"];
  const notReached = [
    `Census ZIP crosswalk resolves ${specialResolved.resolved} of ${specialResolved.total} SPECIAL DISTRICTS nationally — the Census publishes no ZIP-resolvable geography for them, so this enumerator CANNOT answer for the class that includes CAWCD, the flood control district and every community facilities district. The county clip is used beside it for exactly this reason.`,
    "State-native enumerators (AZ Auditor General special-district registry, NJ DCA, NH DRA) — NOT WALKED by this instrument. Each is a per-state route and none is wired here.",
    "County assessor / levy rolls — NOT WALKED. `pnpm az:levy` reaches Pima's and is not read by this instrument.",
    "NCES CCD — reached only indirectly, through the crosswalk that built census-unit-zips.json.",
  ];

  /* ---- Surface: governing bodies --------------------------------------- */
  const ws = workstate(ZIP_STATE[zip]);
  const promoted = new Set(
    (ws?.candidates ?? []).filter((c) => c.state === "BODY_PROMOTED" && c.bodyId).map((c) => c.bodyId as string),
  );
  const productBodiesInZipState = registry.bodies.filter((b) =>
    (b.id + (b.ocdId ?? "")).includes(`state:${ZIP_STATE[zip]}`),
  );

  rows.push({
    surface: "governing bodies (served to this point)",
    external: zipUnits.length,
    evidence: promoted.size,
    product: productBodiesInZipState.length,
    served: servedBodies.length,
    claimed: false,
    delta: servedBodies.length > 0 ? "AGREES" : "INTEGRITY_DEFECT",
    why:
      servedBodies.length > 0
        ? `${servedBodies.length} body/bodies reach this point. The external count is per-ZIP and the served count is per-POINT; they are not the same population and are not subtracted.`
        : "the serving path returned NO body for a point in a covered zip, which is an absence asserted to a reader",
  });

  /* ---- Surface: body composition (who sits on it) ----------------------- */
  const withMembers = servedBodies.filter((b) => membersOfBody(b.bodyId).members.length > 0);
  const unknownComposition = servedBodies.filter((b) => membersOfBody(b.bodyId).unknown);
  rows.push({
    surface: "body composition (who sits on it)",
    external: null,
    evidence: null,
    product: servedBodies.length,
    served: withMembers.length,
    claimed: false,
    /*
     * UNKNOWN_COMPOSITION is an admission about US and renders as a named gap,
     * so it is a COVERAGE_GAP and never a defect. Before 2026-08-27 these same
     * bodies rendered the parent government's roster, which WAS a defect —
     * the difference between the two is the whole of Red Controls 2 and 3.
     */
    delta: unknownComposition.length > 0 ? "COVERAGE_GAP" : "AGREES",
    why: `${unknownComposition.length} of ${servedBodies.length} served bodies have no sourced membership. That is recorded as UNKNOWN_COMPOSITION and renders as a named gap, never as inherited people.`,
  });
  if (unknownComposition.length > 0) {
    gaps.push(
      `${zip}: ${unknownComposition.length} served body/bodies with unsourced membership — ${unknownComposition
        .slice(0, 4)
        .map((b) => b.name ?? b.divisionLabel)
        .join("; ")}${unknownComposition.length > 4 ? "; …" : ""}`,
    );
  }

  /* ---- Surface: meetings ------------------------------------------------ */
  const servedIds = new Set(servedBodies.map((b) => b.bodyId));
  const meetingsForServed = snapshot.meetings.filter(
    (m) => m.bodyId && servedIds.has(m.bodyId) && (!excludeAdapter || !m.id.startsWith(`${excludeAdapter}:`)),
  );
  const bodiesWithMeetings = new Set(meetingsForServed.map((m) => m.bodyId));
  /*
   * **"WIRED AND SILENT" IS NOT ONE STATE, AND THE FIRST VERSION OF THIS
   * TREATED IT AS ONE.** It reported 10 integrity defects at 03255 over
   * Newbury committees — the Cemetery Trustees, the Septic Committee — that
   * simply have nothing scheduled. A small town committee with no upcoming
   * sitting is the town's honest state, and calling it a defect is the same
   * unearned certainty this instrument exists to find, pointed at ourselves.
   *
   * The real question is the one RULING 100 asks: an operation that can return
   * nothing must be asked WHAT IT RETURNED.
   *
   * - The body's source left **no row in the snapshot's `sources` array** →
   *   the adapter was never asked, and zero is OUR silence wearing the body's
   *   name. **INTEGRITY_DEFECT.** This is exactly the CAWCD shape: `civicclerk`
   *   was registered in the composite and absent from the 2026-08-26 snapshot's
   *   source list, and the card said "0 upcoming" over 15 published events.
   * - The source ran and reported → zero for this body is the source's own
   *   answer. Reported, and not a defect.
   */
  const wiring = readFileSync(join(ROOT, "lib/registry/source-wiring.ts"), "utf8");
  const wiredServed = servedBodies.filter((b) => wiring.includes(`"${b.bodyId}"`));
  const sourcesRun = new Set(
    snapshot.sources.map((s) => s.source).filter((s) => s !== excludeAdapter),
  );

  /** The adapter each wired body is served by, from its own wiring row. */
  const adapterFor = (bodyId: string): string | null => {
    const at = wiring.indexOf(`"${bodyId}"`);
    if (at < 0) return null;
    const m = /agendaSourceType:\s*"([A-Z_]+)"/.exec(wiring.slice(at, at + 900));
    return m ? m[1].toLowerCase() : null;
  };

  const silent = wiredServed.filter((b) => !bodiesWithMeetings.has(b.bodyId));
  const neverAsked = silent.filter((b) => {
    const a = adapterFor(b.bodyId);
    return a !== null && !sourcesRun.has(a);
  });
  const askedAndEmpty = silent.filter((b) => !neverAsked.includes(b));

  rows.push({
    surface: "meetings",
    external: null,
    evidence: null,
    product: meetingsForServed.length,
    served: bodiesWithMeetings.size,
    claimed: wiredServed.length > 0,
    delta: neverAsked.length > 0 ? "INTEGRITY_DEFECT" : "AGREES",
    why:
      `${bodiesWithMeetings.size} of ${servedBodies.length} served bodies carry meetings; ` +
      `${wiredServed.length} wired, of which ${askedAndEmpty.length} were asked and returned nothing ` +
      `(the source's own answer) and ${neverAsked.length} had no source row at all` +
      (neverAsked.length > 0 ? " — never asked, which renders as the body's absence" : ""),
  });
  for (const b of neverAsked) {
    defects.push(
      `${zip}: ${b.name ?? b.divisionLabel} is wired to \`${adapterFor(b.bodyId)}\`, which left NO row in the snapshot's source list. It was never asked, and the card renders that as the body having no meetings.`,
    );
  }
  if (askedAndEmpty.length > 0) {
    gaps.push(
      `${zip}: ${askedAndEmpty.length} wired body/bodies whose source ran and returned no sitting — the source's own answer, worth a recheck rather than a repair`,
    );
  }

  /* ---- Surface: ballot contests, candidates, incumbency ----------------- */
  const ballot = ballotFor(zip);
  if (!ballot) {
    unmeasured.push({
      surface: "ballot contests / candidates / incumbency",
      missing: `no ballot corpus for ${zip} in data/ballot/. The instrument cannot ask a question the store cannot answer, and inventing a denominator here would be worse than naming the gap.`,
    });
  } else {
    const contests = ballot.contests;
    const withCandidates = new Set(ballot.candidacies.map((c) => c.contestId));
    rows.push({
      surface: "ballot contests",
      external: null,
      evidence: null,
      product: contests.length,
      served: withCandidates.size,
      claimed: false,
      delta: "AGREES",
      why: `${withCandidates.size} of ${contests.length} contests carry at least one candidacy; the rest are measures, which have no candidates by construction`,
    });

    /* Incumbency, by EXACT SEAT — the Red Control 1 surface. */
    let unknownSeats = 0;
    let resolvedSeats = 0;
    let unclassifiedOffices = 0;
    for (const c of contests) {
      if (!withCandidates.has(c.id)) continue;
      if (officeIdentity(c.title) === null) {
        unclassifiedOffices += 1;
        continue;
      }
      const holders = await seatHoldersForOffice(c.ocdId, c.title);
      if (holders.length === 0) unknownSeats += 1;
      else resolvedSeats += 1;
    }
    rows.push({
      surface: "incumbency (by exact seat)",
      external: null,
      evidence: null,
      product: resolvedSeats + unknownSeats,
      served: resolvedSeats,
      claimed: false,
      /*
       * An unsourced seat holder resolves to UNKNOWN, which renders as a named
       * gap and is therefore owed work rather than a false claim. Before
       * 2026-08-27 these same contests resolved against the division's whole
       * officeholder list and rendered CHALLENGER, which was the defect.
       */
      delta: unknownSeats > 0 ? "COVERAGE_GAP" : "AGREES",
      why: `${resolvedSeats} contested seat(s) have a sourced current holder, ${unknownSeats} do not and render UNKNOWN${unclassifiedOffices > 0 ? `, ${unclassifiedOffices} contest title(s) the office vocabulary does not classify` : ""}`,
    });
    if (unknownSeats > 0) {
      gaps.push(`${zip}: ${unknownSeats} contested seat(s) with no sourced current holder`);
    }
    if (unclassifiedOffices > 0) {
      defects.push(
        `${zip}: ${unclassifiedOffices} contest title(s) are unclassified by lib/officials/office-identity.ts, so their incumbency can never resolve — a silent permanent UNKNOWN`,
      );
    }
  }

  /* ---- Surface: Ask entity routing ------------------------------------- */
  /*
   * **THE SURFACE THAT WAS UNMEASURED WHILE IT CARRIED A DEFECT.**
   * (2026-08-27.)
   *
   * A tester asked what was on the Vail school district agenda at a Tucson zip
   * and was told about Sunnyside Unified. This instrument reported zero
   * integrity defects that day, truthfully, because Ask was not one of the
   * surfaces it measured — and "zero over the measured subset" is exactly the
   * claim `lib/ops/integrity-claim.ts` now refuses to let a report compress.
   *
   * So Ask is measured here, through the SAME pure function the reader's
   * surface calls, with the SAME coverage the serving path returns. Two probes,
   * each aimed at one half of the contract:
   *
   * 1. **A government we hold but that is NOT at this point.** The answer may
   *    not name a local body. Naming one is the reported defect exactly.
   * 2. **A government that IS at this point.** The answer must still name it —
   *    a repair that simply stopped answering whenever a name appears would
   *    pass probe 1 and break the product, so both are required.
   */
  const askProbes = askEntityProbes(zip, served);
  rows.push({
    surface: "Ask entity routing (question names a government)",
    external: null,
    evidence: null,
    product: askProbes.total,
    served: askProbes.correct,
    claimed: true,
    delta: askProbes.substitutions.length > 0 ? "INTEGRITY_DEFECT" : "AGREES",
    why:
      askProbes.substitutions.length > 0
        ? `Ask answered about a DIFFERENT government than the one named: ${askProbes.substitutions.join("; ")}`
        : `${askProbes.correct} of ${askProbes.total} probe(s) bound to the government named, or said honestly that it could not be resolved. A named government is never silently replaced by the reader's own.`,
  });
  for (const substitution of askProbes.substitutions) {
    defects.push(`${zip}: Ask substituted a government — ${substitution}`);
  }

  /* ---- Surfaces this instrument does not reach -------------------------- */
  unmeasured.push(
    {
      surface: "RENDERED (DOM) state for every surface",
      missing:
        "L4 here is the SERVING path (`coverageAt`), one step short of the reader. `pnpm verify:composition` is the DOM-level check and covers three bodies, not a zip. A DOM walk per surface is the missing instrument.",
    },
    {
      surface: "agendas, minutes, packets",
      missing:
        "the snapshot carries agendaDocuments; this instrument does not yet reconcile them against what each body published, so it would be counting our own rows.",
    },
    {
      surface: "campaign finance / filings",
      missing:
        "no external per-ZIP denominator is wired. FEC and state systems are per-candidate and per-committee, and joining them to a zip is its own instrument.",
    },
    {
      surface: "special districts, per ZIP",
      missing:
        "no enumerator resolves them to a ZIP — the Census resolves 0 of 39,555 nationally. The county clip gives a COUNTY denominator only, so a per-ZIP special-district completeness figure has no honest denominator and none is invented.",
    },
  );

  return {
    zip,
    rows,
    unmeasured,
    enumerators,
    notReached,
    seams: seamsIn(zip),
    defects,
    gaps,
  };
}

/* ------------------------------------------------------------- the report */

const only = arg("zip");
const zips = only ? [only] : [...PILOTS];
const out = arg("json");
const results: Awaited<ReturnType<typeof measure>>[] = [];

for (const zip of zips) {
  if (!ZIP_POINTS[zip]) {
    console.error(`coverage: no orientation point for ${zip}. Known: ${Object.keys(ZIP_POINTS).join(", ")}`);
    process.exit(2);
  }
  results.push(await measure(zip));
}

console.log("=".repeat(78));
console.log("FOUR-LAYER COVERAGE — external · evidence · product · served");
console.log(`snapshot generated ${snapshot.generatedAt}  ·  ${snapshot.sources.length} meeting source(s)`);
console.log("=".repeat(78));

for (const r of results) {
  console.log(`\n\n${"─".repeat(78)}\nZIP ${r.zip}\n${"─".repeat(78)}`);

  console.log("\nAUTHORITATIVE ENUMERATORS WALKED");
  for (const e of r.enumerators) console.log(`  · ${e}`);
  console.log("\nENUMERATORS NOT REACHED, AND WHY");
  for (const n of r.notReached) console.log(`  · ${n}`);

  console.log("\nSURFACES");
  console.log(
    `  ${"surface".padEnd(40)} ${"EXT".padStart(5)} ${"EVID".padStart(5)} ${"PROD".padStart(5)} ${"SERV".padStart(5)}  verdict`,
  );
  const n = (v: number | null) => (v === null ? "  —" : String(v));
  for (const row of r.rows) {
    console.log(
      `  ${row.surface.padEnd(40)} ${n(row.external).padStart(5)} ${n(row.evidence).padStart(5)} ${n(row.product).padStart(5)} ${n(row.served).padStart(5)}  ${row.delta}`,
    );
    console.log(`  ${" ".repeat(40)} ${row.why}`);
  }

  console.log("\nSURFACES NOT MEASURABLE BY THIS INSTRUMENT, AND WHAT IS MISSING");
  for (const u of r.unmeasured) console.log(`  · ${u.surface}\n      ${u.missing}`);

  if (r.seams) {
    console.log(
      `\nTERRITORY SEAMS INSIDE ${r.zip} — ${r.seams.combinations} distinct governing combination(s) across ${r.seams.streets} street(s)`,
    );
    for (const d of r.seams.detail.slice(0, 8)) console.log(`  ${d}`);
    if (r.seams.detail.length > 8) console.log(`  … ${r.seams.detail.length - 8} more`);
    console.log(
      "  NOTE: a seam CENSUS, not an address test. No house number was resolved to a point, so this\n" +
        "  says which combinations EXIST and not that each was exercised by a real address.",
    );
  } else {
    console.log(`\nTERRITORY SEAMS INSIDE ${r.zip} — no street index; the seams inside this zip are unmeasured.`);
  }

  console.log(`\nINTEGRITY DEFECTS  ${r.defects.length}`);
  for (const d of r.defects) console.log(`  ✗ ${d}`);
  console.log(`COVERAGE GAPS      ${r.gaps.length}`);
  for (const g of r.gaps) console.log(`  · ${g}`);
}

/* RULING 159 — the two counts are reported against their own denominator, and
 * they are NEVER added together. A coverage gap is owed work; an integrity
 * defect is a wrong claim; a rate mixing them would describe neither. */
const surfaces = results.flatMap((r) => r.rows).length;
const defects = results.flatMap((r) => r.defects).length;
const gaps = results.flatMap((r) => r.gaps).length;
const unmeasured = results.flatMap((r) => r.unmeasured).length;

console.log(`\n\n${"=".repeat(78)}`);
console.log(
  `  ${floorLine(floored("surfaces carrying an integrity defect", "the surfaces measured", surfaces, results.flatMap((r) => r.rows).filter((x) => x.delta === "INTEGRITY_DEFECT").length))}`,
);
console.log(
  `  ${floorLine(floored("surfaces carrying a coverage gap", "the surfaces measured", surfaces, results.flatMap((r) => r.rows).filter((x) => x.delta === "COVERAGE_GAP").length))}`,
);
console.log(
  `\n  INTEGRITY DEFECTS ${defects}   COVERAGE GAPS ${gaps}   SURFACES NOT MEASURABLE ${unmeasured}`,
);
console.log("  These are three different things and are never summed.");
console.log(
  `  A defect count of ${defects} is a statement about the ${surfaces} surface(s) this instrument\n` +
    `  MEASURES, and about nothing else. ${unmeasured} surface(s) are listed above as unmeasurable,\n` +
    "  each with what is missing, and they are not evidence of anything either way.",
);

/*
 * **AND THE GLOBAL QUESTION, ANSWERED AS ITS OWN LINE** (2026-08-27).
 *
 * The paragraph above already said this in prose, and a session still
 * compressed the run into "0 integrity defects" in its report — after which a
 * tester found a reader-visible defect on Ask, one of the unmeasured surfaces.
 * So the verdict is now a NAMED FIELD that a report can carry forward without
 * having to re-derive it, and `lib/ops/integrity-claim.ts` holds the guard that
 * catches the compression.
 */
const tally = { measured: surfaces, unmeasured, defects };
console.log(`\n  ${globalIntegrityLine(tally)}`);

/*
 * **THE INSTRUMENT IS SHOWN CATCHING THE REAL THING, ON EVERY RUN.**
 *
 * A coverage instrument written the same day its defects were repaired will
 * report zero, and zero from an instrument nobody has seen fire is
 * indistinguishable from an instrument that cannot fire. RULING 110, and the
 * same discipline `pnpm sweep:absence-claims` uses.
 *
 * The specimen is the exact CAWCD shape: a body wired to an adapter that left
 * no row in the snapshot's source list. That is what produced "Meetings · 0
 * upcoming" over four published board meetings on 2026-08-27.
 */
const SPECIMEN_ADAPTER = "civicclerk";
/* The REAL measure, re-run over 85641 with that one source row removed. Not a
 * stand-in for the classifier — the classifier itself, driven at the input. */
const control = await measure("85641", SPECIMEN_ADAPTER);
if (control.defects.length === 0) {
  console.error(
    `\ncoverage: removing \`${SPECIMEN_ADAPTER}\` from the snapshot's source list produced NO ` +
      "integrity defect. That is the exact state that rendered CAWCD's '0 upcoming' over four " +
      "published board meetings, and an instrument that cannot find the defect it was built over " +
      "is reporting green about nothing (RULING 110).",
  );
  process.exit(1);
}
console.log(
  `\n  control: re-running 85641 with \`${SPECIMEN_ADAPTER}\` removed from the snapshot's source\n` +
    `  list yields ${control.defects.length} integrity defect(s) — the shape that rendered CAWCD's\n` +
    "  '0 upcoming'. The classifier fires, so the zero above is a measurement.",
);

/*
 * **THE FALSE-POSITIVE CONTROL — the direction a defect-finder gets wrong.**
 * (2026-08-27.)
 *
 * The `civicclerk` control above proves this instrument can FIRE. It says
 * nothing about whether it fires on the innocent, and the first version of this
 * instrument did exactly that: it reported 10 integrity defects at 03255 over
 * Newbury committees — the Cemetery Trustees, the Septic Committee — whose only
 * offence was having nothing scheduled. A small town committee with no upcoming
 * sitting is the town's honest state.
 *
 * So both directions are controlled. The wired-and-silent class must still be
 * PRESENT at 03255 (or this proves nothing) and must be classified as a GAP.
 */
{
  const nh = results.find((r) => r.zip === "03255");
  if (nh) {
    const silentGap = nh.gaps.find((g) => g.includes("returned no sitting"));
    const silentDefect = nh.defects.find((d) => d.includes("returned no sitting"));
    if (!silentGap) {
      console.error(
        "\ncoverage: 03255 no longer reports any wired-and-silent body, so the false-positive " +
          "control is vacuous — it cannot show that a body with nothing scheduled is still " +
          "classified as a GAP rather than a defect (RULING 110).",
      );
      process.exit(1);
    }
    if (silentDefect) {
      console.error(
        `\ncoverage: a wired body whose source RAN and returned nothing is being reported as an ` +
          `integrity defect again — "${silentDefect}". That is the Newbury committee false ` +
          "positive: the town's honest state, called a defect by us.",
      );
      process.exit(1);
    }
    console.log(
      `\n  control: at 03255 the wired-and-silent bodies are still present and are still a GAP,\n` +
        "  not a defect — the Newbury committee false positive does not return.",
    );
  }
}

/*
 * **AND THE SAME CONTROL FOR THE ASK SURFACE** (2026-08-27).
 *
 * The Ask probe was added because a tester found a defect this instrument could
 * not see. Its FIRST version could not see it either: the probe question
 * carried no topic keyword, nothing routed, and it scored itself green whether
 * or not the repair was in place. So the pre-repair path is re-run here on
 * every run and is required to still produce the substitution.
 *
 * `resolveRouting` called WITHOUT a binding is exactly the code that shipped
 * the Sunnyside answer.
 */
{
  const point = ZIP_POINTS["85701"];
  const cov = await coverageAt(point[0], point[1], 0);
  const preRepair = resolveRouting("schools-policy", cov)
    .steps.flatMap((s) => s.bodies.map((b) => b.label));
  const bound = resolveRouting("schools-policy", cov, {
    kind: "UNRESOLVED",
    mention: "vail",
  }).steps.flatMap((s) => s.bodies.map((b) => b.label));

  if (preRepair.length === 0 || bound.length > 0) {
    console.error(
      "\ncoverage: the Ask entity-routing control did not reproduce the defect. Unbound routing " +
        `named ${preRepair.length} body/bodies and a named-but-unresolved government still named ` +
        `${bound.length}. The probe cannot distinguish the repaired path from the broken one and ` +
        "is reporting green about nothing (RULING 110).",
    );
    process.exit(1);
  }
  console.log(
    `\n  control: at 85701, routing a schools question with NO entity binding names\n` +
      `  ${preRepair.join(", ")} — the reader's own district, which is what answered a question\n` +
      "  about Vail. With the government named but unresolved it names none. The Ask probe\n" +
      "  can tell those apart, so its zero above is a measurement.",
  );
}

if (out) {
  writeFileSync(out, `${JSON.stringify({ generatedAt: snapshot.generatedAt, results }, null, 1)}\n`, "utf8");
  console.log(`\nwrote ${out}`);
}

/* A defect fails the command. A gap does not — unfinished is not wrong. */
process.exit(defects > 0 ? 1 : 0);
