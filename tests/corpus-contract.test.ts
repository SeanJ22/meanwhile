import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { CORPUS_ARTIFACTS } from "../lib/corpus/artifacts.ts";
import { conformanceOf, isStale, requiredFields, supportsChangeDetection } from "../lib/corpus/contract.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

/**
 * **THE PROVENANCE CONTRACT, AND THE BOUNDARY THAT KEEPS A LOCAL STORE FROM
 * BECOMING AN ALTERNATE PRODUCT TRUTH.**
 * (2026-08-27, the coverage-truth session.)
 *
 * Two things are guarded here and they are the two halves of the same rule:
 *
 * 1. **Every artifact class the product consumes can say where it came from**,
 *    or is NAMED as unable to. `public/geo/*.geojson` cannot say when it was
 *    retrieved, and that gap is a row in the register rather than a silence.
 * 2. **A local corpus or analysis layer may never become a product-serving
 *    write path.** This is wanted BEFORE an analytical engine exists, which is
 *    the entire point of writing it now: a rule adopted after the first engine
 *    lands is a rule adopted after the first bypass.
 */

const ROOT = process.cwd();

test("every registered artifact class exists on disk", () => {
  /*
   * A register describing files that are not there is a register describing
   * nothing, and it reads exactly like a clean one.
   */
  const missing = CORPUS_ARTIFACTS.filter((a) => {
    if (!a.localPath.includes("*")) return !existsSync(join(ROOT, a.localPath));
    const dir = join(ROOT, dirname(a.localPath));
    if (!existsSync(dir)) return true;
    const ext = a.localPath.slice(a.localPath.lastIndexOf("."));
    return !readdirSync(dir).some((f) => f.endsWith(ext));
  }).map((a) => a.localPath);
  assert.deepEqual(missing, [], missing.join("\n  "));
});

test("no artifact class claims a field it cannot answer", () => {
  /*
   * The register describes what IS. A row that filled `retrievedAt` in with a
   * plausible date would make `pnpm corpus:check` agree with itself, which is
   * the failure mode this whole session was about — so the rule is enforced in
   * the direction that matters: a stated value must not be a placeholder.
   */
  const problems: string[] = [];
  for (const a of CORPUS_ARTIFACTS) {
    for (const [k, v] of Object.entries(a)) {
      if (typeof v !== "string") continue;
      if (/^(tbd|todo|unknown|n\/a|-|\?)$/i.test(v.trim())) {
        problems.push(`${a.localPath}: ${k} is a placeholder ("${v}") — leave it null instead`);
      }
    }
    if (a.sourceClass === "DERIVED" && (a.derivedFrom ?? []).length === 0) {
      problems.push(`${a.localPath} is DERIVED and names nothing it was derived from`);
    }
    if (a.sourceClass === "RETRIEVED" && !a.sourceUrl) {
      problems.push(`${a.localPath} is RETRIEVED and names no source URL`);
    }
    if (!a.freshness?.refreshedBy?.trim()) {
      problems.push(`${a.localPath} names no way to refresh it — a file nobody can refresh is a dead end`);
    }
    if (!a.permission?.basis?.trim()) {
      problems.push(`${a.localPath} states a permission with no basis`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n  "));
});

test("the contract asks different things of RETRIEVED, DERIVED and CURATED", () => {
  /*
   * One requirement set applied to all three would make two thirds of this
   * repository permanently non-conformant for reasons that are not defects — a
   * derived artifact has no source URL and a curated one has a citation rather
   * than a hash.
   */
  assert.ok(requiredFields("RETRIEVED").includes("contentHash"));
  assert.ok(!requiredFields("DERIVED").includes("contentHash"));
  assert.ok(requiredFields("DERIVED").includes("derivedFrom"));
  assert.ok(!requiredFields("CURATED").includes("contentHash"));
});

test("CONTROL: the contract actually refuses an artifact that cannot answer it", () => {
  /*
   * `pnpm corpus:check` reports 4 of 7 conforming. A conformance checker that
   * cannot report non-conformance would report 7 of 7 just as calmly, so it is
   * shown refusing.
   */
  const bare = conformanceOf({ localPath: "x.json", what: "a thing", sourceClass: "RETRIEVED" });
  assert.equal(bare.level, "ABSENT");
  assert.ok(bare.missing.includes("retrievedAt"), "the field this contract was written over must be demanded");
  assert.ok(bare.missing.includes("contentHash"));

  const full = conformanceOf({
    localPath: "y.json",
    what: "a thing",
    sourceClass: "RETRIEVED",
    sourceUrl: "https://example.gov/x",
    sourceOrg: "Example",
    retrievedAt: "2026-08-27",
    contentType: "application/json",
    contentHash: "abc",
    freshness: { staleAfterDays: 1, refreshedBy: "pnpm x" },
    permission: { state: "ALLOWED", basis: "robots read 2026-08-27", attribution: null },
  });
  assert.equal(full.level, "CONFORMS");
  assert.deepEqual(full.missing, []);
});

test("staleness is null when it cannot be told, never false", () => {
  /*
   * "We cannot tell whether this is stale" and "this is fresh" are different
   * answers and only one of them is a reason to relax. `public/geo` is the
   * case: no retrieval date, so no staleness verdict.
   */
  const geo = CORPUS_ARTIFACTS.find((a) => a.localPath === "public/geo/*.geojson");
  assert.ok(geo, "the boundary-file row is the one this rule exists over");
  assert.equal(
    isStale({ retrievedAt: geo.retrievedAt ?? null, freshness: geo.freshness! }, "2026-08-27"),
    null,
    "with no retrieval date there is no staleness verdict to give",
  );
  assert.equal(
    isStale({ retrievedAt: "2026-08-01", freshness: { staleAfterDays: 1, refreshedBy: "x" } }, "2026-08-27"),
    true,
  );
  assert.equal(
    isStale({ retrievedAt: "2026-08-27", freshness: { staleAfterDays: 30, refreshedBy: "x" } }, "2026-08-27"),
    false,
  );
});

test("change detection is reported honestly, and one class already has it", () => {
  const withHash = CORPUS_ARTIFACTS.filter((a) => supportsChangeDetection(a));
  assert.ok(
    withHash.length >= 1,
    "at least one class must be content-addressed, or the contract is describing an aspiration",
  );
  assert.ok(
    withHash.some((a) => a.localPath === "data/corpus/statements.json"),
    "the statement corpus is the worked example the rest are measured against",
  );
});

/* ------------------------------------------- the corpus / serving boundary */

/** The modules that WRITE a canonical product-serving store. */
const SERVING_WRITERS = [
  "scripts/build-registry.ts",
  "scripts/build-officeholders.ts",
  "scripts/ingest.ts",
  "scripts/adjudicate-leads.mts",
  "scripts/census-gap-walk.mts",
  "lib/registry/promoted-bodies.ts",
];

test("NH243: no module that WRITES a serving store sources from the local corpus", () => {
  /*
   * **THE RULE, WRITTEN BEFORE THE ENGINE THAT WOULD BREAK IT.**
   *
   * A local corpus or analytical store may never become an alternate product
   * truth. `lib/corpus/` holds RETRIEVED MATERIAL — pages as they were
   * fetched, un-normalised, and in several cases somebody else's prose. The
   * canonical serving stores are validated and carry provenance per row, and
   * what fills them must come through that path.
   *
   * ## The first version of this guard was too broad, and the repository said so
   *
   * It banned any import of `lib/corpus/` from `app/`, `components/` or the
   * serving libraries, and flagged two modules that are entirely correct:
   * `app/api/positions/[subject]/[topic]/route.ts` and
   * `components/officials/positions-section.tsx`. That route exists precisely
   * BECAUSE the corpus must not be shipped to a reader — 175 KB of extracted
   * page text stays on the server and the search runs there — and it carries
   * D35's three-answer machinery so an empty match renders as a named gap
   * rather than as "this person has no position on X".
   *
   * READING the corpus to answer a question, with the answer's own provenance
   * attached, is not the defect. **WRITING a canonical store from it is**,
   * because that is what puts unvalidated material behind every surface at once
   * with nothing in between. So the guard is scoped to the writers.
   *
   * DuckDB belongs in a later brief, and this is why it is written now: it is
   * easier to adopt the rule while nothing violates it than after an engine
   * makes violating it convenient.
   */
  const CORPUS = /from\s+["'][^"']*lib\/corpus\//;
  const offenders: string[] = [];

  for (const file of SERVING_WRITERS) {
    if (!existsSync(join(ROOT, file))) {
      offenders.push(`${file} — registered as a serving writer and NOT PRESENT, so this guard is stale`);
      continue;
    }
    const text = readFileSync(join(ROOT, file), "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (CORPUS.test(code)) offenders.push(file);
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} module(s) that write a canonical serving store import lib/corpus/:\n  ` +
      offenders.join("\n  ") +
      "\n\nWhat fills a serving store comes through the governed ingestion path, which validates and " +
      "carries provenance per row. The corpus holds retrieved material as it was fetched.",
  );
});

test("NH243 CONTROL: the boundary guard can see an import, so its silence is a measurement", () => {
  /*
   * A guard that has never matched anything is indistinguishable from a guard
   * whose pattern is wrong. Both halves are exercised on real strings.
   */
  const CORPUS = /from\s+["'][^"']*lib\/corpus\//;
  assert.ok(CORPUS.test('import { x } from "../corpus/types.ts";') === false, "a relative sibling path is not the shape");
  assert.ok(CORPUS.test('import { x } from "@/lib/corpus/contract";'), "the aliased form must match");
  assert.ok(CORPUS.test("import type { A } from '../../lib/corpus/types.ts';"), "the relative form must match");
  assert.ok(!CORPUS.test('import { x } from "@/lib/registry/server";'), "a governed import must not match");

  /* And the writer list must actually name modules that write serving stores. */
  for (const f of SERVING_WRITERS) {
    assert.ok(existsSync(join(ROOT, f)), `${f} is registered as a serving writer and is not present`);
  }
  assert.ok(
    SERVING_WRITERS.includes("scripts/build-registry.ts"),
    "the registry generator is the canonical serving writer and must be covered",
  );
  assert.ok(
    !SERVING_WRITERS.includes("scripts/fetch-corpus.mts"),
    "the corpus FETCHER obviously reads the corpus — banning it would ban the thing from itself",
  );
  assert.ok(
    !SERVING_WRITERS.some((f) => f.startsWith("app/api/positions")),
    "the positions route READS the corpus by design, on the server, and is not a serving writer",
  );
});
