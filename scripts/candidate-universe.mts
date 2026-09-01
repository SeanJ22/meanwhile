/**
 * `pnpm candidates:universe` — **THE CANDIDATE ACQUISITION DENOMINATOR,
 * re-derived from every committed source, AND LABELLED FOR WHAT IT ACTUALLY
 * IS.**
 * (Session C3, lane C, 2026-09-01. RULING 229. Relabelled Session C final,
 * lane 1, 2026-09-01, R-C9.)
 *
 * **THIS FILE USED TO CALL ITSELF "THE STATEWIDE CANDIDATE ACQUISITION
 * DENOMINATOR" AND IT WAS NOT ONE.** Its own body said so four paragraphs down
 * — *"It is not the state's candidate universe"* — and the title said the
 * opposite, which is the shape a reader keeps and the body is not. R-C9:
 * "no ZIP in the key" is a property of the key, not of the population. The run
 * now PRINTS the provenance of each state's population beside its count, from
 * `lib/candidates/population-label.ts`, where a population that was not
 * acquired from an authority is PILOT_DERIVED by default rather than by
 * omission.
 *
 * Writes `data/hunt/<state>-candidate-universe-<cycle>.json`. **A GENERATED
 * ARTIFACT** (RULING 92).
 *
 * ## IT GLOBS RATHER THAN NAMING FILES, AND THAT IS THE POINT
 *
 * The Arizona candidate universe this lane can state today comes from the
 * ballot documents this repository has committed. Another lane is building a
 * statewide identity registry, and it will land under a filename this lane does
 * not know. So the derivation reads EVERY `data/ballot/<state>-*.json` that
 * carries a `candidacies` array and unions them by canonical identity.
 *
 * A larger committed source therefore enlarges this denominator the moment it
 * lands, with no edit here — which is what "make the registration re-derive
 * rather than hardcode" has to mean if it is to survive the session that wrote
 * it.
 *
 * ## What the number IS, stated so it cannot be mistaken for something else
 *
 * It is the largest candidate denominator DERIVABLE FROM COMMITTED SOURCES
 * TODAY. It is **not** the state's candidate universe: Arizona's Secretary of
 * State published a statewide filing list that this repository has read for one
 * county's projection and has never acquired as a corpus, and acquiring it is
 * an OPEN OBLIGATION registered by the local-jurisdictions provider against the
 * state row. A candidate absent from every document below is absent from THIS
 * FILE. That is never a statement about the ballot.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  deriveCandidateUniverse,
  enrichmentSplit,
  ENRICHMENT_FIELDS,
  type BallotDocument,
  type CandidateUniverse,
  type EnrichmentStores,
} from "../lib/hunt/candidate-universe.ts";
import { populationLabel } from "../lib/candidates/population-label.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const BALLOT_DIR = join(ROOT, "data", "ballot");
const OUT_DIR = join(ROOT, "data", "hunt");
const GENERATOR = "scripts/candidate-universe.mts";
const CYCLE = 2026;
const STATES = ["az", "nh", "nj"] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Every committed ballot document for one state that carries candidacies.
 *
 * A document with `candidacies` but no `contests` is SKIPPED and NAMED: a
 * candidacy whose contest cannot be resolved has no office and no division, and
 * a canonical identity without an office is a person filed under nothing.
 */
/**
 * The directories a committed candidate document may land in.
 *
 * `data/ballot/` is where every certified ballot this project holds lives.
 * `data/candidates/` is the contract path for a STATEWIDE IDENTITY REGISTRY
 * another lane is building: this derivation must enlarge the moment a larger
 * committed source exists, not when somebody remembers to change a constant,
 * so both are scanned and the shape decides rather than the filename.
 */
const SCAN_DIRS = ["data/ballot", "data/candidates"] as const;

function ballotDocuments(stateCode: string): { docs: BallotDocument[]; skipped: string[] } {
  const docs: BallotDocument[] = [];
  const skipped: string[] = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).sort()) {
      if (!name.startsWith(`${stateCode}-`) || !name.endsWith(".json")) continue;
      const path = `${dir}/${name}`;
      const doc = readJson<Partial<BallotDocument>>(join(abs, name));
      if (!Array.isArray(doc.candidacies) || doc.candidacies.length === 0) continue;
      if (!Array.isArray(doc.contests) || doc.contests.length === 0) {
        skipped.push(`${path} carries candidacies and NO contests — no office, so no canonical identity`);
        continue;
      }
      docs.push({ path, contests: doc.contests, candidacies: doc.candidacies });
    }
  }
  return { docs, skipped };
}

function enrichmentStores(): EnrichmentStores {
  const hunt = readJson<{ candidates?: Record<string, Record<string, { state?: string; checkedAt?: string }>> }>(
    join(BALLOT_DIR, "candidate-hunt-state.json"),
  );
  const cards = readJson<{ cards?: Record<string, Record<string, unknown>> }>(
    join(BALLOT_DIR, "candidate-cards-2026.json"),
  );
  const links = readJson<{
    links?: Record<string, unknown>;
    hunts?: { key?: string; note?: string; attemptedAt?: string }[];
  }>(join(BALLOT_DIR, "candidate-links-2026.json"));
  return {
    huntState: hunt.candidates ?? {},
    cards: cards.cards ?? {},
    links: links.links ?? {},
    linkHunts: links.hunts ?? [],
  };
}

const DRY = process.argv.includes("--dry");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const stores = enrichmentStores();
const AS_OF = today();

console.log(`candidates:universe · cycle ${CYCLE}, as of ${AS_OF}\n`);

for (const stateCode of STATES) {
  const { docs, skipped } = ballotDocuments(stateCode);
  if (docs.length === 0) {
    console.error(
      `  ${stateCode.toUpperCase()}: no committed ballot document carries candidacies. That is a FAILED ` +
        "read of data/ballot/, never a state with no candidates. Nothing written.",
    );
    process.exitCode = 2;
    continue;
  }
  for (const s of skipped) console.log(`  SKIPPED — ${s}`);

  const universe: CandidateUniverse = deriveCandidateUniverse({
    stateCode: stateCode.toUpperCase(),
    cycle: CYCLE,
    generatedBy: GENERATOR,
    generatedOn: AS_OF,
    documents: docs,
    stores,
  });

  const label = populationLabel({
    stateCode: universe.stateCode,
    cycle: universe.cycle,
    derivedFrom: universe.derivedFrom,
  });
  console.log(
    `  ${stateCode.toUpperCase()}: ${universe.candidacies.length} canonical candidacy identit(ies) ` +
      `from ${docs.length} committed document(s) — ${label.provenance}`,
  );
  console.log(`      ${label.authorityLine}`);
  for (const d of universe.derivedFrom) {
    console.log(`      ${d.path.padEnd(40)} contributed ${d.candidaciesContributed} new identit(ies)`);
  }
  for (const field of ENRICHMENT_FIELDS) {
    const s = enrichmentSplit(universe, field);
    console.log(
      `      ${floorLine(
        floored(
          `${field} FOUND`,
          `every canonical ${stateCode.toUpperCase()} candidacy`,
          s.total,
          s.found,
          `the ${stateCode.toUpperCase()} derivation produced no candidacy at all`,
        ),
      )} · searched-no-result ${s.searchedNoResult} · UNWORKED ${s.unworked}`,
    );
  }

  const out = join(OUT_DIR, `${stateCode}-candidate-universe-${CYCLE}.json`);
  if (DRY) {
    console.log(`      --dry: nothing written. Would write ${out}\n`);
  } else {
    writeFileSync(out, `${JSON.stringify(universe, null, 1)}\n`, "utf8");
    console.log(`      wrote ${out}\n`);
  }
}
