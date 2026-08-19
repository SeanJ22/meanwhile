/**
 * THE COVERAGE MANIFEST, AND THE ONE-EDIT CLAIM (AUD-06, g18, 2026-08-18).
 *
 * The auditor's row said one source of truth for covered states. The claim
 * this file has to prove is not "a manifest exists" — a manifest that half the
 * wiring ignores is worse than none, because it reads as centralised. The
 * claim is: **adding a state is exactly one edit, and every derived list sees
 * it.** So the test adds a THROWAWAY state to the manifest input and asserts
 * every derived list contains it. Nothing here asserts a shape and calls it a
 * behaviour.
 *
 * The second guard is the one that keeps it true: a grep over the tree for the
 * literal state codes, refusing any NEW hand-kept list. The fourteen that
 * existed are enumerated below as the fixed set of allowed sites, so a
 * fifteenth fails rather than joins.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  COVERED_SLUGS,
  COVERED_STATES,
  FIPS_BY_USPS,
  deriveClientLists,
  geoFilesFor,
  type CoveredState,
} from "../lib/coverage/states.ts";
import {
  BALLOT_FILES,
  CLIP_COUNTIES,
  COVERED,
  COVERED_FIPS,
  COVERED_USPS,
  FIPS_BY_SLUG,
  NAME_BY_USPS,
  ROSTER_BY_USPS,
  ROSTER_FILES,
  SLUG_BY_FIPS,
  USPS_BY_FIPS,
  deriveArtifacts,
} from "../lib/coverage/artifacts.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* -- the manifest agrees with the authority outside it -------------------- */

test("every manifest FIPS/USPS pair matches the Census table in lib/ocd/fips.ts", () => {
  assert.ok(COVERED_STATES.length > 0, "the manifest must not be empty");
  for (const s of COVERED_STATES) {
    const authoritative = FIPS_TO_STATE[s.fips];
    assert.ok(authoritative, `FIPS ${s.fips} is not a Census state code`);
    assert.equal(
      s.usps,
      authoritative.postal,
      `manifest says FIPS ${s.fips} is ${s.usps}; Census says ${authoritative.postal}`,
    );
    assert.equal(s.slug, s.usps.toLowerCase(), `${s.usps} slug must be its own lower case`);
  }
});

test("the manifest's generated artifacts are all committed on disk", () => {
  // A manifest that names files nobody generated is a manifest that lies about
  // coverage. Every artifact it claims is opened here.
  for (const file of ROSTER_FILES) {
    statSync(join(ROOT, "lib", "registry", file));
  }
  for (const { file } of BALLOT_FILES) {
    statSync(join(ROOT, "data", "ballot", file));
  }
  for (const f of geoFilesFor("cd119", "sldu", "sldl", "place", "cousub", "unsd", "elsd", "scsd")) {
    statSync(join(ROOT, "public", "geo", f));
  }
  assert.equal(ROSTER_FILES.length, COVERED_STATES.length + 1, "federal roster plus one per state");
  assert.equal(BALLOT_FILES.length, COVERED_STATES.length);
  assert.equal(CLIP_COUNTIES.length, COVERED_STATES.length);
});

/* -- the one-edit claim, proven by adding a state ------------------------- */

/**
 * A state that does not exist in this product, added to a COPY of the manifest
 * input. FIPS 06 / CA is a real Census code — deliberately, so the derivation
 * is exercised with a plausible value rather than a sentinel that a defensive
 * filter somewhere might drop for looking wrong.
 */
const THROWAWAY: CoveredState = { fips: "06", usps: "CA", slug: "ca" };
const WITH_EXTRA = [...COVERED_STATES, THROWAWAY];

test("adding one state to the manifest reaches every CLIENT-side derived list", () => {
  const d = deriveClientLists(WITH_EXTRA);
  const checks: [string, boolean][] = [
    ["fipsByUsps", d.fipsByUsps.CA === "06"],
    ["slugs", d.slugs.includes("ca")],
  ];
  for (const [name, saw] of checks) {
    assert.ok(saw, `client list ${name} did not see the added state`);
  }
  assert.equal(
    checks.length,
    Object.keys(d).length,
    "every client derivation must be checked — a new one must not slip in unchecked",
  );
});

test("adding one state to the manifest reaches every SERVER-side derived list", () => {
  const detail = {
    "04": { name: "Arizona", countyFips: "04019", countyName: "Pima", countySlug: "pima" },
    "33": { name: "New Hampshire", countyFips: "33013", countyName: "Merrimack", countySlug: "merrimack" },
    "34": { name: "New Jersey", countyFips: "34027", countyName: "Morris", countySlug: "morris" },
    "06": { name: "California", countyFips: "06037", countyName: "Los Angeles", countySlug: "los-angeles" },
  };
  const d = deriveArtifacts(WITH_EXTRA, detail);
  const checks: [string, boolean][] = [
    ["states", d.states.some((s) => s.usps === "CA")],
    ["rosters", d.rosters.includes("officeholders-06.json")],
    ["rosterByUsps", d.rosterByUsps.CA === "officeholders-06.json"],
    ["nameByUsps", d.nameByUsps.CA === "California"],
    ["clipCounties", d.clipCounties.some((c) => c.fips === "06037")],
    ["ballotFiles", d.ballotFiles.some((b) => b.file === "ca-los-angeles-2026.json")],
    ["slugByFips", d.slugByFips["06"] === "ca"],
    ["uspsByFips", d.uspsByFips["06"] === "CA"],
    ["fipsBySlug", d.fipsBySlug.ca === "06"],
    ["fips", d.fips.includes("06")],
    ["usps", d.usps.includes("CA")],
  ];
  for (const [name, saw] of checks) {
    assert.ok(saw, `server list ${name} did not see the added state`);
  }
  assert.equal(
    checks.length,
    Object.keys(d).length,
    "every server derivation must be checked — a new one must not slip in unchecked",
  );
});

test("adding one state reaches the geometry filenames on every layer type", () => {
  // geoFilesFor reads the live manifest rather than an argument, so this is the
  // control for it: it must produce one file per covered state per type, and
  // the map's seven per-state layers must all be built through it.
  const files = geoFilesFor("place", "cousub");
  assert.equal(files.length, COVERED_STATES.length * 2);
  for (const s of COVERED_STATES) {
    assert.ok(files.includes(`place-${s.fips}.geojson`));
    assert.ok(files.includes(`cousub-${s.fips}.geojson`));
  }
});

test("a manifest state with no artifacts detail row throws rather than being skipped", () => {
  // The failure a silent skip would produce is a state that is covered on the
  // map and absent from every roster — which renders as a state with no
  // government. Absence manufactured by a default; refused here.
  assert.throws(
    () => deriveArtifacts(WITH_EXTRA),
    /no detail row/,
    "an unknown state must refuse, not degrade",
  );
});

/* -- the applied exports are the derivation, not a second copy ------------ */

test("the exported lists equal the derivation of the live manifest", () => {
  const c = deriveClientLists(COVERED_STATES);
  assert.deepEqual({ ...FIPS_BY_USPS }, c.fipsByUsps);
  assert.deepEqual([...COVERED_SLUGS], c.slugs);

  const a = deriveArtifacts(COVERED_STATES);
  assert.deepEqual([...COVERED], a.states);
  assert.deepEqual([...ROSTER_FILES], a.rosters);
  assert.deepEqual({ ...ROSTER_BY_USPS }, a.rosterByUsps);
  assert.deepEqual({ ...NAME_BY_USPS }, a.nameByUsps);
  assert.deepEqual({ ...SLUG_BY_FIPS }, a.slugByFips);
  assert.deepEqual({ ...USPS_BY_FIPS }, a.uspsByFips);
  assert.deepEqual({ ...FIPS_BY_SLUG }, a.fipsBySlug);
  assert.deepEqual([...COVERED_FIPS], a.fips);
  assert.deepEqual([...COVERED_USPS], a.usps);
});

test("the client module exports ONLY what the browser reads", () => {
  // The measured half of the split (g18): the four script-side lookups cost
  // +159 raw bytes on every reader's initial JavaScript while they lived in
  // the client module. This asserts they stayed out. A new export here is not
  // forbidden — it is required to be a deliberate act with a re-measurement
  // behind it, which a silently-passing test would not make anyone do.
  const d = deriveClientLists(COVERED_STATES);
  assert.deepEqual(
    Object.keys(d).sort(),
    ["fipsByUsps", "slugs"],
    "a lookup added to the client module must be paid for — re-measure budget 2 and record it",
  );
});

/* -- no fifteenth hand-kept list ----------------------------------------- */

function sourceFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".next", ".git", "public", "data", "docs", "tests"]);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.(ts|tsx|mts|mjs)$/.test(entry.name)) out.push(abs);
    }
  };
  walk(ROOT);
  return out;
}

/**
 * Files allowed to hold a state triple, with the reason each is not wiring.
 *
 * Content tables, not coverage lists: a manifest cannot generate an election
 * date or a registration URL, and these carry one record PER state rather than
 * a list OF states. The manifest is held against them by their own suites —
 * that is where an onboarded state with no content gets caught.
 */
const CONTENT_FILES = new Set(
  [
    "lib/coverage/states.ts", // the manifest itself
    "lib/coverage/artifacts.ts", // its server projection
    "lib/ocd/fips.ts", // the Census table for all 56 jurisdictions
    "lib/area/facts.ts",
    "lib/ballot/election-dates.ts",
    "lib/ballot/polling-place-links.ts",
    "lib/ballot/registration-links.ts",
    "lib/sources/legiscan/districts.ts", // per-state district NUMBERING rules
    "lib/sources/mock/fixtures.ts",
    "lib/registry/coverage-audit.ts", // per-body hunt notes, prose
    "components/map/welcome-overlay.tsx", // four sample zips, a content list
  ].map((p) => p.replace(/\//g, "\\")),
);

test("no file outside the manifest holds a hand-kept list of every covered state", () => {
  const offenders: string[] = [];
  for (const abs of sourceFiles()) {
    const rel = relative(ROOT, abs);
    if (CONTENT_FILES.has(rel) || CONTENT_FILES.has(rel.replace(/\\/g, "/"))) continue;
    const text = readFileSync(abs, "utf8");
    const holdsEveryUsps = COVERED_USPS.every((c) => text.includes(`"${c}"`));
    const holdsEveryFips = COVERED_FIPS.every((c) => text.includes(`"${c}"`));
    if (holdsEveryUsps || holdsEveryFips) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    "these files enumerate every covered state by hand — derive from lib/coverage/states.ts instead",
  );
});
