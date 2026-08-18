import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../lib/db/schema.ts";
import {
  ORGANIC,
  SYNTHETIC_RUN_HEADER,
  makeRunId,
  markerFromRequest,
  syntheticRunHeaders,
} from "../lib/db/run-marker.ts";
import { organicDenominatorSentence } from "../lib/signal/search-log-reads.ts";

/**
 * C05 (2026-08-17): our own traffic stops contaminating the aggregate.
 *
 * Roughly 537 rows on production's `search_log` are ours, written by local and
 * CI Playwright runs, and every walk adds about 28 more. The number only grows
 * and nothing sold may ever contain it.
 *
 * The obvious fix — stop writing to production — was rejected by the author,
 * because it would delete the only end-to-end proof that the write path works.
 * So the row says whose it is, and this file holds the three properties that
 * make that claim worth anything:
 *
 *   1. the marker is DECLARED at write time, never inferred afterwards;
 *   2. `run_id` is null on every organic row, so it can never become a session
 *      key relating two readers to each other;
 *   3. **no aggregate can be written that reads the unfiltered table.**
 */

// ── 1. Declared, not inferred ──────────────────────────────────────────────

test("a request that declares nothing is a reader", () => {
  const marker = markerFromRequest(new Request("https://example.test/api/meetings"));
  assert.deepEqual(marker, ORGANIC);
  assert.equal(marker.runId, null);
});

test("a run declares itself in a header, and the id rides with it", () => {
  const request = new Request("https://example.test/api/meetings", {
    headers: { [SYNTHETIC_RUN_HEADER]: "walk-all-local@2026-08-17T07:16:45.726Z" },
  });
  const marker = markerFromRequest(request);
  assert.equal(marker.runClass, "SYNTHETIC");
  assert.equal(marker.runId, "walk-all-local@2026-08-17T07:16:45.726Z");
});

test("a malformed declaration is synthetic, never quietly organic", () => {
  // Something said it was automated and got the label wrong. Resolving that
  // toward "reader" is the exact mistake the column exists to prevent.
  for (const bad of ["", "   ", "a".repeat(200), "has spaces", "semi;colon"]) {
    const marker = markerFromRequest(
      new Request("https://example.test/x", { headers: { [SYNTHETIC_RUN_HEADER]: bad } }),
    );
    assert.equal(marker.runClass, "SYNTHETIC", `"${bad.slice(0, 12)}" must not read as a reader`);
    assert.equal(marker.runId, null);
  }
});

test("a runner with no WTP_RUN_ID sends no header — a human at a browser is organic", () => {
  assert.deepEqual(syntheticRunHeaders({}), {});
  assert.deepEqual(syntheticRunHeaders({ WTP_RUN_ID: "  " }), {});
  assert.deepEqual(syntheticRunHeaders({ WTP_RUN_ID: "ci-42" }), {
    [SYNTHETIC_RUN_HEADER]: "ci-42",
  });
});

test("a generated run id survives its own round trip through the header reader", () => {
  const id = makeRunId("walk:all local", "2026-08-17T07:16:45.726Z");
  const marker = markerFromRequest(
    new Request("https://example.test/x", { headers: { [SYNTHETIC_RUN_HEADER]: id } }),
  );
  assert.equal(marker.runClass, "SYNTHETIC");
  assert.equal(marker.runId, id, "a generated id must not be rejected by the shape it was built for");
});

// ── 2. run_id cannot become a session key ──────────────────────────────────

test("the marker columns exist and carry no identifier fragment", () => {
  const config = getTableConfig(schema.searchLog);
  const byName = new Map(config.columns.map((c) => [c.name, c]));
  assert.ok(byName.has("run_class"), "search_log must carry run_class");
  assert.ok(byName.has("run_id"), "search_log must carry run_id");

  // Same discipline the rest of the table is held to.
  for (const forbidden of ["user", "account", "device", "session", "subscriber", "cookie"]) {
    for (const name of byName.keys()) {
      assert.ok(!name.toLowerCase().includes(forbidden), `${name} matches "${forbidden}"`);
    }
  }
});

test("reactions did not grow the marker — the stores still share no key", () => {
  const reactionCols = new Set(
    getTableConfig(schema.reactions).columns.map((c) => c.name),
  );
  assert.ok(!reactionCols.has("run_id"), "run_id on both stores would be a join path");
  assert.ok(!reactionCols.has("run_class"));
});

test("the migration marks pre-existing rows UNKNOWN, not organic", async () => {
  // The column default is ORGANIC, which is right for a live request and
  // WRONG for every row that already existed. drizzle-kit cannot know the
  // difference, so the migration corrects them — and this asserts the
  // correction is actually in the file rather than in the intention.
  const dir = join(process.cwd(), "lib", "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql"));
  const all = (
    await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")))
  ).join("\n");
  assert.match(all, /ADD COLUMN "run_class"/, "the column must be added by a migration");
  assert.match(
    all.replace(/--[^\n]*/g, ""),
    /UPDATE "search_log" SET "run_class" = 'UNKNOWN'/,
    "every row written before the marker existed must be UNKNOWN",
  );
});

// ── 3. No aggregate can read the unfiltered table ──────────────────────────

test("no module reads search_log without the organic filter", async () => {
  /*
   * The property that makes the other two worth anything. A filter each
   * aggregate remembers to apply is a filter one aggregate will forget, and
   * the forgetting is invisible — the number just comes out slightly too
   * high, in our favour, on the thing we sell.
   */
  const roots = ["lib", "scripts", "app"];
  const ALLOWED = new Set(
    [
      // The write path and the schema, which are not reads.
      "lib/db/schema.ts",
      "lib/db/search-log.ts",
      // The filter itself, and the census whose job is to describe the WHOLE
      // table — it reports rather than aggregates, and it is not a sold
      // number.
      "lib/signal/search-log-reads.ts",
      // The back-marking pass, which by definition operates on unmarked rows.
      "scripts/searchlog-backmark.mts",
      // G04, 2026-08-17: the walk asks how many rows ITS OWN run landed, by
      // `run_id = <this run>`. That is the opposite of an aggregate — it is a
      // count of OUR rows, the ones the organic filter exists to exclude, and
      // filtering it to ORGANIC would make it report zero every time and read
      // as "this run created nothing". Declared here with the reason, the
      // DECLARED_EXTRAS pattern, because an exception that lives in code can
      // be argued with and a silent one cannot.
      "scripts/walk-all.mts",
      // R36, 2026-08-17: the read-only-credential probe. It SELECTs from
      // search_log to prove the connection can read a real store table —
      // grants are per-table, so `select 1` against nothing would prove
      // nothing — and it deliberately takes no count and prints no total, so
      // there is no number here for the organic filter to be protecting.
      // Declared with its reason, the DECLARED_EXTRAS pattern, because an
      // exception that lives in code can be argued with and a silent one
      // cannot.
      "scripts/verify-readonly.mts",
      // R42, 2026-08-17: the local-write probe. It writes one SYNTHETIC row
      // through the real write path and reads it back BY ITS OWN run id —
      // the same "count of OUR rows" exception the walk carries, and
      // filtering it to ORGANIC would make it read zero and report the write
      // as failed. Its only other read of the table is a before/after
      // count(*) whose PURPOSE is to prove the probe row was removed again,
      // and it prints the DELTA rather than the total for exactly the reason
      // verify-readonly.mts gives: a raw total out of this table is a number
      // somebody can quote. Declared with its reason, the DECLARED_EXTRAS
      // pattern, because an exception that lives in code can be argued with
      // and a silent one cannot.
      "scripts/verify-local-write.mts",
      // R36/R42, 2026-08-17 (g11): the run-id census. It is the command form
      // of `runClassCensusQuery()`, whose documented job is to describe the
      // WHOLE table INCLUDING the part that is ours — the one read that
      // reports rather than aggregates. Filtering it to ORGANIC would delete
      // the thing it exists to print: how many rows are not readers. It never
      // emits an organic figure without the denominator sentence beside it,
      // which is the protection the filter gives elsewhere. Declared with its
      // reason, the DECLARED_EXTRAS pattern, because an exception that lives
      // in code can be argued with and a silent one cannot.
      "scripts/census-run-class.mts",
      // R36, 2026-08-17 (g11): the production write-handle probe. It writes
      // one SYNTHETIC row and reads it back BY ITS OWN run id — the same
      // "count of OUR rows" exception the walk and the local-write probe
      // carry — and its before/after count(*) exists to prove the row was
      // removed again, printing the delta rather than the total for the same
      // reason verify-readonly.mts gives.
      "scripts/verify-write-handle.mts",
    ].map((p) => p.replace(/\//g, sep)),
  );

  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(full)));
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const files: string[] = [];
  for (const root of roots) files.push(...(await walk(join(process.cwd(), root))));
  assert.ok(files.length > 100, `expected the source tree, found ${files.length} files`);

  const offenders: string[] = [];
  for (const file of files) {
    const relative = file.slice(process.cwd().length + 1);
    if ([...ALLOWED].some((a) => relative === a)) continue;
    const src = await readFile(file, "utf8");
    // Strip comments so an explanation of the rule is not a violation of it.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("//") && !l.startsWith("*"))
      .join("\n");

    const readsTable =
      /FROM\s+search_log/i.test(code) || /\bsearchLog\b/.test(code);
    if (!readsTable) continue;

    const filtered =
      /run_class\s*=\s*'ORGANIC'/i.test(code) ||
      /ORGANIC_ONLY/.test(code) ||
      /organicOnly\s*\(/.test(code);
    if (!filtered) offenders.push(relative);
  }

  assert.deepEqual(
    offenders,
    [],
    "every read of search_log outside the allow-list must go through the organic filter " +
      "(lib/signal/search-log-reads.ts) — an aggregate that forgets is invisible",
  );
});

// ── The denominator, in words ──────────────────────────────────────────────

test("the denominator sentence states the organic count and what was excluded", () => {
  const sentence = organicDenominatorSentence({
    organic: 12,
    synthetic: 565,
    unknown: 537,
    author: 0,
    total: 1114,
  });
  assert.match(sentence, /12 reader events/);
  assert.match(sentence, /565/);
  assert.match(sentence, /537/);
  assert.match(sentence, /never counted as a reader/);
  // 1114 - 12. The excluded figure is derived from the total, never summed by
  // hand, so a class added later cannot quietly fall out of it.
  assert.match(sentence, /1102 further rows are excluded/);
});

test("the author class is named in the sentence and counted in the exclusion", () => {
  const sentence = organicDenominatorSentence({
    organic: 0,
    synthetic: 717,
    unknown: 2845,
    author: 17,
    total: 3579,
  });
  assert.match(sentence, /0 reader events/);
  assert.match(sentence, /3579 further rows are excluded/);
  assert.match(sentence, /17 the author using his own product/);
});

test("a class the sentence does not know about still cannot inflate the reader count", () => {
  // The failure this pins: a future class lands in the table, nobody updates
  // this file, and the excluded figure silently stops reconciling. Derived
  // from the total, the arithmetic holds whatever the class is called.
  const sentence = organicDenominatorSentence({
    organic: 10,
    synthetic: 5,
    unknown: 5,
    author: 0,
    total: 100, // 80 rows in some class this code has never heard of
  });
  assert.match(sentence, /10 reader events/);
  assert.match(sentence, /90 further rows are excluded/);
});
