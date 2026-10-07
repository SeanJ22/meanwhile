import assert from "node:assert/strict";
import test from "node:test";

// Plain .mjs, shared with the plain-node scripts that never see tsx.
import { posixRelative } from "../scripts/repo-path.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

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

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

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

test("the marker columns exist and carry no identifier fragment", () => {
  const config = getTableConfig(schema.searchLog);
  const byName = new Map(config.columns.map((c) => [c.name, c]));
  assert.ok(byName.has("run_class"), "search_log must carry run_class");
  assert.ok(byName.has("run_id"), "search_log must carry run_id");

  for (const forbidden of ["user", "account", "device", "session", "subscriber", "cookie"]) {
    for (const name of byName.keys()) {
      assert.ok(!name.toLowerCase().includes(forbidden), `${name} matches "${forbidden}"`);
    }
  }
});

test("reactions grew the marker in its own value space — the stores still share no key", () => {
  const reactionCols = new Set(
    getTableConfig(schema.reactions).columns.map((c) => c.name),
  );
  assert.ok(reactionCols.has("run_class"), "the sold table must be able to say whose traffic a row is");
  assert.ok(reactionCols.has("run_id"));

  // `run_class` is a four-value enum, not an identifier: joining on it would
  // relate every row to every other row and single out nobody. It is the id
  // that had to be put beyond reach.
  const source = readFileSync(join(process.cwd(), "lib", "db", "reactions.ts"), "utf8");
  assert.match(
    source,
    /createHash\("sha256"\)\.update\(`reaction-run:\$\{runId\}`/,
    "the reaction run id must be namespaced and digested, never the raw label",
  );

  const raw = "f01c-s2@2026-08-19T00:00:00.000Z";
  const digested = createHash("sha256").update(`reaction-run:${raw}`, "utf8").digest("hex");
  assert.notEqual(digested, raw, "a digest that equalled the label would join");
  const continuity = createHash("sha256").update(raw, "utf8").digest("hex");
  assert.notEqual(digested, continuity, "the run digest must not share the continuity key's space");

  const roots = ["lib", "app", "scripts"];
  const offenders: string[] = [];
  for (const root of roots) {
    const files = filesThatWouldBeCommitted({ cwd: process.cwd(), paths: [root] })
      .map((f) => f.trim())
      .filter((f) => /\.(ts|tsx|mts|mjs)$/.test(f));
    for (const file of files) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      if (/searchLog\.runId[\s\S]{0,120}reactions\.runId/.test(text)) offenders.push(file);
      if (/reactions\.runId[\s\S]{0,120}searchLog\.runId/.test(text)) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `these files put the two run ids in one expression: ${offenders.join(", ")}`);
});

test("the migration marks pre-existing rows UNKNOWN, not organic", async () => {
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

test("no module reads search_log without the organic filter", async () => {
  const roots = ["lib", "scripts", "app"];
  const ALLOWED = new Set(
    [
      "lib/db/schema.ts",
      "lib/db/search-log.ts",
      // The filter itself, and the census that describes the whole table.
      "lib/signal/search-log-reads.ts",
      // These read back only their own run's rows (or no count at all); filtering to ORGANIC would read zero.
      "scripts/walk-all.mts",
      "scripts/verify-readonly.mts",
      "scripts/verify-write-handle.mts",
      // Paths are repo-relative POSIX, produced by posixRelative below.
    ],
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
    const relative = posixRelative(process.cwd(), file);
    if ([...ALLOWED].some((a) => relative === a)) continue;
    const src = await readFile(file, "utf8");
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
