/**
 * **RULING 107 — a freshness date is written only by the code path that
 * performed the read.** (Adopted 2026-08-23, the visual-tail-and-rehunt
 * session, item 1. It closes `NH80`.)
 *
 * ## What `NH80` feared, and what was actually there
 *
 * `NH80` left `lib/officials/directory-source.ts` deliberately un-regenerated,
 * on the belief that re-running `pnpm congress:migrate` would restamp a
 * `collectedAt` of 2026-08-16 without re-reading the data. Regenerating it on
 * 2026-08-23 against the committed snapshot returned the artifact
 * **byte-identical** — its `collectedAt` is propagated from
 * `snapshot.source.collectedAt`, so that generator was already honest.
 *
 * The defect was one file over. `docs/congress-legislators-diff.md` moved its
 * header from `Generated 2026-08-16` to `Generated 2026-08-23` **with nothing
 * read**, because the value feeding it was a clock call named `collectedAt`.
 *
 * ## Why a stamp that moves without a read is worse than no stamp
 *
 * RULING 96 makes last-walked dates the instrument that decides whether a
 * source is re-walked. RULING 53 says a record that cannot say when it was
 * measured reads as stale. A date that updates on every run defeats both — it
 * does not merely fail to help, it **suppresses the re-walk that would have
 * caught the staleness**. `UNKNOWN` sends a session back to the source; a
 * confident wrong date buys permanent trust.
 *
 * ## The two halves of the guard
 *
 * 1. **The registered generators** — `lib/ops/generated-register.ts`, walked
 *    through their whole source closure so a stamp three imports deep is still
 *    counted. Any one of them able to restamp without reading FAILS. This half
 *    is enforced.
 * 2. **The wider class** — every file under `scripts/` and `lib/`. A named
 *    instance is an example of a class-wide defect, and the registered
 *    generators are not the whole class. This half is pinned to a baseline that
 *    may only shrink, so a new undeclared stamp site fails while the ones
 *    already triaged do not have to be fixed in the same commit.
 *
 * ## The carve-out is a diff, deliberately
 *
 * An adapter that stamps the moment it fetched IS the reading path, and that is
 * the rule being obeyed rather than broken. A file says so with
 * `@freshness-reads-here` in its header. Twenty-nine files carry it, each
 * verified on 2026-08-23 by reading its stamp sites against the retrieval they
 * sit in. Declaring costs a diff — the same mechanism `tests/guard-census.json`
 * uses to let a guard leave, and for the same reason: a carve-out nobody has to
 * write down is a carve-out that grows.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { GENERATED } from "../lib/ops/generated-register.ts";
import { entryFor, repoPath, sourceClosure } from "../lib/ops/generator-digest.ts";
import { judge, sitesIn, sourceFilesUnder, sweep } from "../lib/ops/freshness-audit.ts";
import {
  NEVER_READ,
  carried,
  provenanceLine,
  runStamp,
  stampFromRead,
} from "../lib/ops/freshness.ts";

const ROOT = process.cwd();

/**
 * The files outside the registered generators that still take a clock value
 * into a freshness field without declaring a read.
 *
 * **This list may only shrink.** Adding to it is how a class defect survives
 * the session that discovered it.
 */
const KNOWN_UNDECLARED = [
  // `collectedAt: new Date()` on a portrait whose collection happened when it
  // was STAGED, not when it was shipped — the staged row carries no date to
  // carry forward, so fixing it needs the staging step to record one. Tracker
  // row opened 2026-08-23 rather than fixed here, per the scope rule.
  "scripts/ship-staged-portraits.mts",
];

test("RULING 107: no registered generator can restamp a freshness date without reading", () => {
  let audited = 0;
  const offenders: string[] = [];
  for (const artifact of GENERATED) {
    const entry = entryFor(ROOT, artifact.command);
    // An unresolvable generator is reported as its own failure rather than
    // skipped — a generator with no completion condition is the state RULING
    // 102 exists to end.
    assert.notEqual(entry, null, `${artifact.path}: cannot resolve \`${artifact.command}\``);
    audited += 1;
    const closure = sourceClosure(ROOT, entry as string).map((f) =>
      repoPath(ROOT, join(ROOT, f)),
    );
    for (const site of judge(sweep(ROOT, closure)).restamping) {
      offenders.push(`${artifact.path} <- ${site.file}:${site.line} (${site.field} <- ${site.clock})`);
    }
  }
  assert.equal(audited, GENERATED.length, "every registered generator is audited");
  assert.deepEqual(
    offenders,
    [],
    "a freshness field is taking a clock value in a generator that did not declare the stamp sits in its reading path",
  );
});

test("RULING 107: the wider class of stamp sites only shrinks", () => {
  const files = sourceFilesUnder(ROOT, ["scripts", "lib"]);
  assert.ok(files.length > 400, `the sweep read only ${files.length} files — it is not looking`);
  const undeclared = [...new Set(judge(sweep(ROOT, files)).restamping.map((s) => s.file))].sort();
  const added = undeclared.filter((f) => !KNOWN_UNDECLARED.includes(f));
  assert.deepEqual(
    added,
    [],
    "a new file writes a freshness date from the clock without declaring that it read — " +
      "either mint it from the read (lib/ops/freshness.ts) or declare @freshness-reads-here",
  );
});

test("RULING 107: a stamp cannot be minted without evidence of a read", () => {
  const good = stampFromRead({ source: "https://example.gov/x", ok: true, bytes: 4096, on: "2026-08-16" });
  assert.equal(good, "2026-08-16");

  // A refusal is not a read.
  assert.equal(
    stampFromRead({ source: "https://example.gov/x", ok: false, bytes: 4096, on: "2026-08-16" }),
    NEVER_READ,
  );
  // Zero bytes is a failed read, not an empty document — the zero-row rule.
  assert.equal(
    stampFromRead({ source: "https://example.gov/x", ok: true, bytes: 0, on: "2026-08-16" }),
    NEVER_READ,
  );
  // A malformed date is never repaired into a plausible one.
  assert.equal(
    stampFromRead({ source: "https://example.gov/x", ok: true, bytes: 10, on: "August 16" }),
    NEVER_READ,
  );
});

test("RULING 107: carrying a prior read date forward is honest; inventing one is not", () => {
  assert.equal(carried("2026-08-16", "the pinned snapshot records the day it was read"), "2026-08-16");
  // A carry with no stated basis is indistinguishable from a guess.
  assert.equal(carried("2026-08-16", "   "), NEVER_READ);
  assert.equal(carried(null, "why"), NEVER_READ);
  assert.equal(carried(undefined, "why"), NEVER_READ);
});

test("RULING 107: a run date never renders as a data date", () => {
  const line = provenanceLine("pnpm congress:migrate", runStamp(new Date("2026-08-23T18:00:00Z")), "2026-08-16" as never);
  assert.match(line, /that is when the program ran, not when the data was read/);
  assert.match(line, /read 2026-08-16/);

  // With no read recorded, it says so rather than falling back to the run date.
  const unread = provenanceLine("pnpm x", runStamp(new Date("2026-08-23T18:00:00Z")), NEVER_READ);
  assert.match(unread, /reads as stale/);
  assert.doesNotMatch(unread, /The data below was read/);
});

test("RULING 107: the sweep sees a stamp broken across two lines", () => {
  // A formatter routinely breaks `collectedAt:\n  new Date()...`, and a sweep
  // that read only the assignment line would report nothing found without
  // having looked.
  const split = sitesIn("x.ts", "const a = {\n  collectedAt:\n    new Date().toISOString(),\n};\n");
  assert.equal(split.length, 1, "a stamp split across two lines is still a stamp");
  assert.equal(split[0]?.field, "collectedAt");

  // A comment describing the rule is not a stamp site.
  assert.deepEqual(sitesIn("x.ts", " * collectedAt: new Date() is the defect\n"), []);
});

test("RULING 107: the declaration is what separates a reading path from a restamp", () => {
  const body = "const r = { collectedAt: new Date().toISOString() };\n";
  assert.equal(judge(sitesIn("a.ts", body)).restamping.length, 1);
  assert.equal(judge(sitesIn("a.ts", `/** @freshness-reads-here */\n${body}`)).reading.length, 1);
  assert.equal(judge(sitesIn("a.ts", `/** @freshness-reads-here */\n${body}`)).restamping.length, 0);
});
