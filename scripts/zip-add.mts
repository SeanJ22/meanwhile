/**
 * `pnpm zip:add <zip> [--dry]` — the staged pipeline (Prompt C item 13,
 * 2026-08-20).
 *
 * ## The promise this deliberately does not make
 *
 * The goal was stated as "add zip ABC123 and the data flows in." That cannot
 * be honestly true of the town and district tier. **There is no API under
 * local government**, and every small town is a bespoke hunt: a selectboard
 * that posts a PDF, a zoning board with a page nobody links, a fire district
 * whose whole publication is a paragraph in an annual report.
 *
 * A command that promised completeness and delivered partial coverage while
 * exiting green would be the flat-total defect one level up — a single number
 * standing in front of two measurements, with the falling one hidden. So this
 * promises something narrower and true: **at every stage it states a
 * denominator, and everything it could not reach becomes a NAMED OUTPUT rather
 * than a silence.**
 *
 * ## The stages, each with its denominator
 *
 *   1. GEOGRAPHY   — TIGER and ZCTA. Which governments' territory covers this
 *                    zip. Denominator: the TIGER layers examined.
 *   2. UNIVERSE    — the Census of Governments and NCES. What SHOULD exist in
 *                    the counties this zip touches, INCLUDING the special
 *                    districts TIGER publishes no boundary for. Denominator:
 *                    Census units in scope.
 *   3. BODIES      — RULING 9: Census counts GOVERNMENTS and this product
 *                    renders BODIES. Census and NCES can never establish this
 *                    stage. Denominator: governments enumerated to bodies,
 *                    against governments in scope.
 *   4. RUNGS       — which automatable rung reaches each body: a wired vendor
 *                    platform, a feed, the `.gov` registry, congress.gov,
 *                    LegiScan, FEC by resolved district.
 *
 * ## Two outputs, and the second is not a failure
 *
 *   - `data/derived/zip-add/<zip>.json` — what was retrieved.
 *   - `data/derived/zip-add/<zip>-gap-queue.md` — every body it could not
 *     reach, with the rungs ALREADY WALKED recorded against each, so the next
 *     session starts at the next rung rather than re-walking.
 *
 * The gap queue is an OUTPUT. A pipeline whose gaps are a failure state either
 * lies or refuses to run.
 *
 * ## The number that matters
 *
 * Every run prints the **auto-resolved fraction**: bodies populated without
 * human intervention, over bodies enumerated. That number climbing across zips
 * is the only real evidence the process is repeatable, and it is what turns
 * this from a promise into something measurable. `docs/intent.md` records the
 * bar: the third zip's diff adds fewer than five new rungs, needs no new
 * source-type recipe, and holds its auto-resolved fraction within ten points
 * of the second.
 *
 * ## RULING 12 governs every fetch
 *
 * A source that is walled, challenged or times out ON THE SOURCE'S SIDE is a
 * WALL: named, skipped, its rung recorded, and the run continues. Anything
 * that is our code is a JOB failure and the run goes red. `--dry` performs NO
 * fetch at all and reports the denominators and the queue from committed data
 * — which is what item 13.6 asks for, and what makes this verifiable without
 * touching a public body's server.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readRecords } from "../lib/reference/index.ts";
import { today } from "./doc-dates.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const zip = args.find((a) => /^\d{5}$/.test(a));

if (!zip) {
  console.error("usage: pnpm zip:add <zip> [--dry]");
  process.exit(2);
}

const DERIVED = join(process.cwd(), "data", "derived");
const OUT_DIR = join(DERIVED, "zip-add");

/* ========================================================================== */
/* STAGE 1 — GEOGRAPHY                                                        */
/* ========================================================================== */

type Edge = {
  layer: string;
  id: string;
  name: string;
  entity: "GOVERNMENT" | "STATISTICAL" | "UNCLASSIFIED";
  lsad: string;
};

const zipGov = JSON.parse(readFileSync(join(DERIVED, "zip-governments.json"), "utf8")) as {
  generatedAt: string;
  method: string;
  zips: Record<string, Edge[]>;
};

const edges = zipGov.zips[zip];
if (!edges) {
  /*
   * A zip with no ZCTA is a fact about our METHOD, not about the place —
   * RULING 10, and it is stated as such rather than reported as an empty zip.
   */
  console.error(
    `STAGE 1 CANNOT RUN: ${zip} has no row in zip-governments.json. Either it is ` +
      `not a ZCTA (RULING 10: a ZCTA is not a ZIP code — 1,599 USPS ZIPs have no ` +
      `ZCTA at all, see PB06), or the territory resolution has not been re-run. ` +
      `This is a gap in our method, not a place with no government.`,
  );
  process.exit(1);
}

const governments = edges.filter((e) => e.entity === "GOVERNMENT");
const statistical = edges.filter((e) => e.entity === "STATISTICAL");
const unclassified = edges.filter((e) => e.entity === "UNCLASSIFIED");
const counties = governments.filter((e) => e.layer === "county");

const layers = [...new Set(edges.map((e) => e.layer))].sort();

console.log(`\n${"═".repeat(74)}`);
console.log(`ZIP ${zip} — staged pipeline${DRY ? "  (DRY: no fetch will be made)" : ""}`);
console.log(`${"═".repeat(74)}`);

console.log(`\nSTAGE 1 — GEOGRAPHY (TIGER + ZCTA, resolved ${zipGov.generatedAt.slice(0, 10)})`);
console.log(`  TIGER layers examined:        ${layers.length}  (${layers.join(", ")})`);
console.log(`  entities intersecting:        ${edges.length}`);
console.log(`    GOVERNMENT                  ${governments.length}`);
console.log(`    STATISTICAL (CDP/CCD)       ${statistical.length}  — not governments; excluded from every denominator`);
console.log(`    UNCLASSIFIED                ${unclassified.length}  — a work item, never guessed into a bucket`);
console.log(`  counties overlapping:         ${counties.length}  (${counties.map((c) => c.name).join(", ") || "none"})`);

/* ========================================================================== */
/* STAGE 2 — UNIVERSE                                                         */
/* ========================================================================== */

const countyFips = new Set(counties.map((c) => c.id.slice(2)));
const stateFips = counties[0]?.id.slice(0, 2) ?? governments[0]?.id.slice(0, 2) ?? "";

const census = readRecords("census_govt_units_2022");
const inScope = census.filter(
  (r) => r.fips_state === stateFips && countyFips.has(r.fips_county),
);
const byType = new Map<string, number>();
for (const r of inScope) byType.set(r.gov_type, (byType.get(r.gov_type) ?? 0) + 1);

const specialDistricts = inScope.filter((r) => r.gov_type === "SPECIAL DISTRICT");

/*
 * THE DEPENDENT SCHOOL SYSTEMS ARE PART OF THE UNIVERSE, and they live in a
 * SECOND Census file. Merrimack County reads 62 from the main workbook and the
 * h session's frozen extract says 63 — the difference is exactly one dependent
 * system, and a universe that quietly dropped it would be a denominator that
 * disagrees with the one already committed. Counted, reconciled, and stated.
 */
const dependent = readRecords("census_govt_units_2022_dependent_school_systems").filter(
  (r) => r.fips_state === stateFips && countyFips.has(r.fips_county),
);
const universeUnits = inScope.length + dependent.length;

const nces = readRecords("nces_ccd_lea_directory_2025_26");
const ncesInScope = nces.filter((r) => r.fips_state === stateFips);

console.log(`\nSTAGE 2 — UNIVERSE (Census of Governments 2022 + NCES CCD 2025-26)`);
console.log(`  Census units in the counties this zip touches: ${universeUnits}`);
console.log(`    independent (main workbook)   ${String(inScope.length).padStart(5)}`);
console.log(`    dependent school systems      ${String(dependent.length).padStart(5)}  — a second Census file; omitting it undercounts the universe`);
for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${t.padEnd(24)} ${String(n).padStart(5)}`);
}
console.log(`  NCES LEA records in ${stateFips ? `state ${stateFips}` : "scope"}:${" ".repeat(8)}${ncesInScope.length}`);
console.log(
  `  SPECIAL DISTRICTS, and the ceiling they set: ${specialDistricts.length} in scope, ` +
    `${specialDistricts.length} unresolved`,
);
console.log(
  `    TIGER publishes NO special-district boundary at any vintage, so not one of ` +
    `these can be attributed to this zip. They are Tier 0 governments a reader may ` +
    `live under and hear nothing about, and they are why this zip's floor tier ` +
    `cannot rise (PB02).`,
);

/* ========================================================================== */
/* STAGE 3 — BODIES (RULING 9)                                                */
/* ========================================================================== */

const registry = JSON.parse(
  readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8"),
) as {
  divisions: { ocdId: string; geoid: string | null; label: string; divisionType: string }[];
  bodies: {
    id: string;
    ocdId: string;
    name: string | null;
    bodyClass: string;
    coverageStatus: string;
    agendaSourceType: string | null;
    agendaSourceRef: string | null;
    homepageUrl: string | null;
  }[];
};

const divisionByGeoid = new Map<string, string>();
for (const d of registry.divisions) if (d.geoid) divisionByGeoid.set(d.geoid, d.ocdId);

const bodiesByOcd = new Map<string, typeof registry.bodies>();
for (const b of registry.bodies) {
  if (!bodiesByOcd.has(b.ocdId)) bodiesByOcd.set(b.ocdId, []);
  bodiesByOcd.get(b.ocdId)!.push(b);
}

interface GovernmentRow {
  layer: string;
  geoid: string;
  name: string;
  ocdId: string | null;
  bodies: typeof registry.bodies;
  enumerated: boolean;
}

const rows: GovernmentRow[] = governments.map((g) => {
  const ocdId = divisionByGeoid.get(g.id) ?? null;
  const bodies = ocdId ? (bodiesByOcd.get(ocdId) ?? []) : [];
  return { layer: g.layer, geoid: g.id, name: g.name, ocdId, bodies, enumerated: bodies.length > 0 };
});

const enumeratedGovs = rows.filter((r) => r.enumerated);
const unenumerated = rows.filter((r) => !r.enumerated);
const allBodies = rows.flatMap((r) => r.bodies);

console.log(`\nSTAGE 3 — BODIES (RULING 9: Census counts GOVERNMENTS; this renders BODIES)`);
console.log(`  governments whose territory resolved: ${rows.length}`);
console.log(`  of those, enumerated to bodies:       ${enumeratedGovs.length}`);
console.log(`  BODIES_UNENUMERATED:                  ${unenumerated.length}  — a named gap, never a body count of one`);
console.log(`  bodies known across this zip:          ${allBodies.length}`);
console.log(
  `  NOTE THE DENOMINATOR: ${allBodies.length} is a count of what we HOLD. There is no ` +
    `external enumeration of bodies anywhere, for any state (HUNT02), so this stage ` +
    `has no outside denominator and does not pretend to one.`,
);

/* ========================================================================== */
/* STAGE 4 — AUTOMATABLE RUNGS                                                */
/* ========================================================================== */

/**
 * Which rung reaches a body WITHOUT a human. A body with a wired vendor source
 * is auto-resolvable; one with only a homepage is a hunt.
 */
const AUTOMATABLE_SOURCE_TYPES = new Set([
  "LEGISTAR",
  "ICAL",
  "DILIGENT",
  "APPTEGY",
  "BOARDBOOK",
  "IQM2",
  "CIVICPLUS",
  "ONBASE",
  "REVIZE",
  "CLERKSBOARDS",
  "SCHEDULEPAGE",
  "COMPOSITE",
]);

/*
 * The committed snapshot holds `electionDomains` (the 693 CISA types as election
 * offices) and a `counts` block — NOT a `domains` array. The first draft read
 * `.domains?.length ?? 0` and printed "0 registered domains", which is the
 * empty-success shape in a status line: a real file, read successfully, reported
 * as holding nothing. Read what the file has.
 */
const dotgov = existsSync(join(process.cwd(), "data", "dotgov", "snapshot.json"))
  ? (JSON.parse(
      readFileSync(join(process.cwd(), "data", "dotgov", "snapshot.json"), "utf8"),
    ) as { counts?: Record<string, number>; electionDomains?: unknown[] })
  : null;
const dotgovDomains = dotgov?.counts?.domains ?? dotgov?.counts?.total ?? null;
const dotgovElection = dotgov?.electionDomains?.length ?? 0;

interface BodyRung {
  bodyId: string;
  government: string;
  bodyName: string;
  rung: string;
  auto: boolean;
  detail: string;
}

const bodyRungs: BodyRung[] = [];
for (const r of rows) {
  for (const b of r.bodies) {
    const type = b.agendaSourceType ?? "";
    const auto = AUTOMATABLE_SOURCE_TYPES.has(type) && Boolean(b.agendaSourceRef);
    bodyRungs.push({
      bodyId: b.id,
      government: r.name,
      bodyName: b.name ?? `${r.name} (governing body)`,
      rung: auto ? `wired source: ${type}` : type ? `source type ${type}, no ref` : "no wired source",
      auto,
      detail: b.agendaSourceRef ?? b.homepageUrl ?? "no URL recorded",
    });
  }
}

const autoResolved = bodyRungs.filter((b) => b.auto);
const fraction = bodyRungs.length === 0 ? 0 : autoResolved.length / bodyRungs.length;

/** The national rungs that need no per-body hunt, listed rather than run. */
const nationalRungs = [
  {
    name: "congress.gov / unitedstates-legislators",
    reaches: "the federal division on every zip in the country",
    auto: true,
  },
  {
    name: "LegiScan (state roll calls)",
    reaches: "the state legislative districts, where the state is wired",
    auto: true,
  },
  {
    name: "OpenFEC by resolved district",
    reaches: "federal committee totals for the districts this zip sits in",
    auto: true,
  },
  {
    name: ".gov registry (CISA)",
    reaches:
      dotgov === null
        ? "NOT READ — data/dotgov/snapshot.json is absent; this rung could not be sized"
        : `${dotgovElection} domains CISA types as election offices` +
          `${dotgovDomains === null ? "" : ` of ${dotgovDomains} registered`}` +
          `, the cheapest first rung for a body's own site`,
    auto: true,
  },
];

console.log(`\nSTAGE 4 — AUTOMATABLE RUNGS`);
console.log(`  bodies with a wired, automatable source: ${autoResolved.length} of ${bodyRungs.length}`);
for (const n of nationalRungs) {
  console.log(`  national rung — ${n.name}: ${n.reaches}`);
}
console.log(
  `\n  AUTO-RESOLVED FRACTION: ${(fraction * 100).toFixed(1)}%  ` +
    `(${autoResolved.length} bodies populated without human intervention / ` +
    `${bodyRungs.length} bodies enumerated)`,
);
console.log(
  `  This is the repeatability instrument. docs/intent.md holds the bar: the third ` +
    `zip's diff adds fewer than five new rungs, needs no new source-type recipe, and ` +
    `holds this fraction within ten points of the second.`,
);

/* ========================================================================== */
/* THE TWO OUTPUTS                                                            */
/* ========================================================================== */

mkdirSync(OUT_DIR, { recursive: true });

const retrieved = {
  zip,
  ranAt: today(),
  mode: DRY ? "DRY — no fetch was made" : "LIVE",
  stage1: {
    tigerLayers: layers,
    entities: edges.length,
    governments: governments.length,
    statistical: statistical.length,
    unclassified: unclassified.length,
    counties: counties.map((c) => ({ geoid: c.id, name: c.name })),
  },
  stage2: {
    censusUnitsInScope: universeUnits,
    censusUnitsIndependent: inScope.length,
    censusUnitsDependentSchoolSystems: dependent.length,
    byGovType: Object.fromEntries(byType),
    specialDistrictsInScope: specialDistricts.length,
    specialDistrictsUnresolved: specialDistricts.length,
    ncesLeaInState: ncesInScope.length,
  },
  stage3: {
    governmentsResolved: rows.length,
    governmentsEnumerated: enumeratedGovs.length,
    bodiesUnenumerated: unenumerated.length,
    bodiesKnown: allBodies.length,
    governments: rows.map((r) => ({
      layer: r.layer,
      geoid: r.geoid,
      name: r.name,
      ocdId: r.ocdId,
      bodies: r.bodies.length,
      enumerated: r.enumerated,
    })),
  },
  stage4: {
    bodiesEnumerated: bodyRungs.length,
    autoResolved: autoResolved.length,
    autoResolvedFraction: Number(fraction.toFixed(4)),
    nationalRungs,
  },
};

const dataPath = join(OUT_DIR, `${zip}.json`);
writeFileSync(dataPath, `${JSON.stringify(retrieved, null, 1)}\n`, "utf8");

/* ---- the gap queue, which is an OUTPUT --------------------------------- */

const queue: string[] = [];
queue.push(`# ${zip} — the gap queue`);
queue.push("");
queue.push(
  `Written by \`pnpm zip:add ${zip}${DRY ? " --dry" : ""}\` on ${today()} ` +
    `(America/Phoenix, from \`pnpm stamp\`).`,
);
queue.push("");
queue.push(
  "**THIS IS AN OUTPUT, NOT A FAILURE STATE.** There is no API under local " +
    "government and every small town is a bespoke hunt, so a pipeline whose gaps " +
    "were a failure would either lie or refuse to run. Each entry names what could " +
    "not be reached and the rungs ALREADY WALKED against it, so the next session " +
    "starts at the next rung rather than re-walking.",
);
queue.push("");
queue.push("## The denominators this queue is measured against");
queue.push("");
queue.push(
  `- Census units in the counties this zip touches: **${universeUnits}** ` +
    `(${inScope.length} independent + ${dependent.length} dependent school system(s))`,
);
queue.push(`- Governments whose territory resolves to this zip: **${rows.length}**`);
queue.push(`- Of those, enumerated to bodies: **${enumeratedGovs.length}**`);
queue.push(`- Bodies known: **${allBodies.length}** — a count of what we HOLD; no external enumeration of bodies exists (HUNT02)`);
queue.push(
  `- Auto-resolved: **${autoResolved.length} of ${bodyRungs.length}** (${(fraction * 100).toFixed(1)}%)`,
);
queue.push("");

queue.push(`## Governments with NO bodies enumerated — ${unenumerated.length}`);
queue.push("");
if (unenumerated.length === 0) {
  queue.push("_None. Every government whose territory resolved has at least one body._");
} else {
  queue.push("| Layer | GEOID | Name | OCD division | Rungs walked |");
  queue.push("|---|---|---|---|---|");
  for (const r of unenumerated) {
    queue.push(
      `| ${r.layer} | \`${r.geoid}\` | ${r.name} | ${r.ocdId ? `\`${r.ocdId}\`` : "**no division**"} | ` +
        `NONE RECORDED — start at discovery ladder A (resolve the real domain) |`,
    );
  }
}
queue.push("");

const notAuto = bodyRungs.filter((b) => !b.auto);
queue.push(`## Bodies with no automatable rung — ${notAuto.length}`);
queue.push("");
if (notAuto.length === 0) {
  queue.push("_None. Every known body has a wired source._");
} else {
  queue.push("| Government | Body | State | What is recorded |");
  queue.push("|---|---|---|---|");
  for (const b of notAuto) {
    queue.push(`| ${b.government} | ${b.bodyName} | ${b.rung} | ${b.detail} |`);
  }
}
queue.push("");

queue.push(`## The special districts — ${specialDistricts.length}, all unresolved`);
queue.push("");
queue.push(
  "TIGER publishes no special-district boundary at any vintage, so not one of these " +
    "can be attributed to this zip by geometry. They are known to exist in the " +
    "counties above and nothing more, which is Tier 0. This is the ceiling on this " +
    "zip's floor tier and it is a national problem, not a local one (`PB02`).",
);
queue.push("");
if (specialDistricts.length > 0) {
  queue.push("| Census id | Name | County FIPS | Web address on file |");
  queue.push("|---|---|---|---|");
  for (const d of specialDistricts.slice(0, 60)) {
    queue.push(
      `| \`${d.census_id_pid6}\` | ${d.unit_name} | ${d.fips_county} | ${d.web_address || "_none_"} |`,
    );
  }
  if (specialDistricts.length > 60) {
    queue.push("");
    queue.push(
      `_${specialDistricts.length - 60} further special district(s) not listed here — the ` +
        `full set is in \`${zip}.json\`'s stage 2 counts and in the Census reference file. ` +
        `The clip is stated so it does not read as the whole._`,
    );
  }
}
queue.push("");

const queuePath = join(OUT_DIR, `${zip}-gap-queue.md`);
writeFileSync(queuePath, `${queue.join("\n")}\n`, "utf8");

/* ---- re-read, because a writer that wrote nothing exits 0 --------------- */

const backData = JSON.parse(readFileSync(dataPath, "utf8")) as { zip: string };
const backQueue = readFileSync(queuePath, "utf8");

console.log(`\nOUTPUTS`);
console.log(`  data:      ${dataPath}  (re-read: zip ${backData.zip})`);
console.log(`  gap queue: ${queuePath}  (${Buffer.byteLength(backQueue, "utf8")} bytes)`);

if (DRY) {
  console.log(
    `\nDRY RUN — no fetch was made. Every number above came from committed data: ` +
      `zip-governments.json, data/reference/, and lib/registry/registry.json.`,
  );
}

if (backData.zip !== zip || backQueue.length < 200) {
  console.error("REFUSED: the outputs did not read back.");
  process.exit(1);
}
