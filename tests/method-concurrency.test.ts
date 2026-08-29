/**
 * **TWO WRITERS, ONE CANONICAL STORE.** (2026-08-29.)
 *
 * `data/method/knowledge.json` has several read-modify-write paths —
 * `runLearnBatch`, `runClaimAmendment`, and a handful of scripts that open the
 * file themselves. Every one of them reads the whole store, changes part of it,
 * and writes the whole thing back. Two of them overlapping does not produce a
 * conflict, a merge or an error: **the second one silently destroys everything
 * the first learned**, and the store looks perfectly healthy afterwards. That is
 * the same shape as `pnpm method:ingest` taking the store from 88 routes at
 * version 27 down to 62 at version 0 and printing a success.
 *
 * Two mechanisms are proved here:
 *
 *   a. **the version precondition** — a writer that read version N refuses to
 *      overwrite a store that has since become N+1, and NAMES both numbers;
 *   b. **the bypass detector** — a sweep of `lib/` and `scripts/` for anything
 *      writing that store without the governed path, ratcheted against a NAMED
 *      list rather than an assertion that there are none.
 *
 * What the detector cannot do is stated rather than hidden: it is textual, it
 * cannot prove a write call and a store reference in one file are connected, and
 * it knows only the write functions it has been told about. It makes a NEW
 * bypass impossible to add quietly. It does not make one impossible.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  MethodStoreUnreadable,
  MethodStoreVersionConflict,
  readMethodStore,
  writeMethodStore,
} from "../lib/method/candidate.ts";
import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import type { MethodKnowledge } from "../lib/method/knowledge.ts";
import {
  GOVERNED_METHOD_WRITER,
  GOVERNED_WRITE_ALLOWLIST,
  KNOWN_UNGOVERNED_METHOD_WRITERS,
  findUngovernedMethodWrites,
  ungovernedWriteRefusal,
  unnamedUngovernedWrites,
} from "../lib/method/retired-writers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ON = "2026-08-29";
const CANONICAL = join(ROOT, "data", "method", "knowledge.json");

function scratch(name: string): { dir: string; storePath: string } {
  const dir = join(ROOT, ".scratch", `method-concurrency-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "data", "method"), { recursive: true });
  const storePath = join(dir, "data", "method", "knowledge.json");
  writeFileSync(storePath, readFileSync(CANONICAL, "utf8"), "utf8");
  return { dir, storePath };
}

function route(id: string): LearnedRoute {
  return {
    id,
    title: `${id} — a synthetic route used only to move the method version`,
    tier: "A1",
    fields: ["meeting"],
    note: "a test route; portability is UNKNOWN and it claims nothing",
    origin: "tests/method-concurrency.test.ts",
    outcome: { jurisdiction: "az", rows: 1, outcome: "YIELDED", note: "synthetic" },
    claims: [
      { id: `${id}#exists`, class: "ROUTE_EXISTENCE", statement: "this synthetic route exists", restsOn: [] },
    ],
  };
}

/* ------------------------------------------------------------------------ (a) */

test("PLANTED: a writer that read version N refuses to overwrite a store now at N+1", () => {
  const { dir, storePath } = scratch("stale");

  // WRITER ONE reads the store. It is now holding a stale snapshot.
  const staleReader = readMethodStore(storePath);
  const staleVersion = staleReader.version;

  // WRITER TWO lands a route in between. The store moves to N+1.
  const interleaved = runLearnBatch(storePath, [route("concurrency-writer-two")], ON);
  assert.equal(interleaved.written, true);
  assert.equal(interleaved.versionAfter, staleVersion + 1);
  const afterWriterTwo = readFileSync(storePath, "utf8");

  // WRITER ONE now tries to write what it computed from the stale snapshot.
  // Without the precondition this succeeds and writer two's route is gone.
  assert.throws(
    () =>
      writeMethodStore(
        storePath,
        { ...staleReader, version: staleVersion + 1 },
        { expectedVersion: staleVersion, stamp: ON },
      ),
    (error: unknown) => {
      assert.ok(error instanceof MethodStoreVersionConflict, "the refusal must be a NAMED error class");
      assert.equal(error.expected, staleVersion, "the refusal states the version the writer READ");
      assert.equal(error.found, staleVersion + 1, "and the version it FOUND");
      assert.match(error.message, new RegExp(`${staleVersion}`));
      assert.match(error.message, /REFUSED/);
      return true;
    },
  );

  // THE ASSERTION THAT MATTERS: writer two's work survived.
  assert.equal(readFileSync(storePath, "utf8"), afterWriterTwo, "the stale write landed anyway");
  const after = JSON.parse(afterWriterTwo) as MethodKnowledge;
  assert.ok(
    after.routes.some((r) => r.id === "concurrency-writer-two"),
    "the interleaved writer's route was destroyed by a stale overwrite",
  );
  rmSync(dir, { recursive: true, force: true });
});

test("the same precondition through runLearnBatch's optional options argument", () => {
  const { dir, storePath } = scratch("stale-batch");
  const version = readMethodStore(storePath).version;

  const exitCodeBefore = process.exitCode;
  assert.throws(
    () =>
      runLearnBatch(storePath, [route("concurrency-optioned")], ON, {
        // A version that is NOT what the file holds: the caller believes the
        // store is somewhere it is not, which is precisely the stale case.
        expectedVersion: version - 1,
      }),
    MethodStoreVersionConflict,
  );
  process.exitCode = exitCodeBefore;

  // The refusal happens at the WRITE, after the batch was computed, so the file
  // must still be untouched.
  assert.equal(readMethodStore(storePath).version, version);
  assert.ok(!readMethodStore(storePath).routes.some((r) => r.id === "concurrency-optioned"));
  rmSync(dir, { recursive: true, force: true });
});

test("creating a store that already exists is refused, not merged", () => {
  const { dir, storePath } = scratch("create-over");
  const before = readFileSync(storePath, "utf8");
  assert.throws(
    () => writeMethodStore(storePath, JSON.parse(before) as MethodKnowledge, { expectedVersion: null, stamp: ON }),
    (error: unknown) => {
      assert.ok(error instanceof MethodStoreVersionConflict);
      assert.equal(error.expected, null, "expectedVersion null means CREATE, and the store existed");
      return true;
    },
  );
  assert.equal(readFileSync(storePath, "utf8"), before);
  rmSync(dir, { recursive: true, force: true });
});

test("an unreadable store is a NAMED refusal, never an empty store", () => {
  const dir = join(ROOT, ".scratch", "method-concurrency-unreadable");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const storePath = join(dir, "knowledge.json");

  // A missing file. An `emptyKnowledge()` default here would be a store that
  // failed to load reported as a project that has learned nothing.
  assert.throws(() => readMethodStore(storePath), MethodStoreUnreadable);

  writeFileSync(storePath, "{ not json", "utf8");
  assert.throws(() => readMethodStore(storePath), MethodStoreUnreadable);

  writeFileSync(storePath, JSON.stringify({ hello: "world" }), "utf8");
  assert.throws(
    () => readMethodStore(storePath),
    (error: unknown) => {
      assert.ok(error instanceof MethodStoreUnreadable);
      assert.match(error.message, /not a method store/);
      return true;
    },
  );
  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------ (b) */

const SOURCE = /\.(ts|tsx|mts|mjs|js)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".scratch", "dist", "build"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE.test(entry)) out.push(full);
  }
  return out;
}

function sweepInputs(dirs: readonly string[]): Array<{ path: string; source: string }> {
  const files: Array<{ path: string; source: string }> = [];
  for (const d of dirs) {
    for (const file of sourceFiles(join(ROOT, d))) {
      files.push({
        path: relative(ROOT, file).split("\\").join("/"),
        source: readFileSync(file, "utf8"),
      });
    }
  }
  return files;
}

test("the sweep actually scans the tree — a collapsed scan reports nothing found", () => {
  const files = sweepInputs(["lib", "scripts"]);
  assert.ok(files.length > 300, `only ${files.length} source file(s) scanned — the sweep stopped seeing the tree`);
  assert.ok(
    files.some((f) => f.path === GOVERNED_METHOD_WRITER.module),
    "the governed writer itself must be in the scanned population, or the allowlist proves nothing",
  );
});

test("PLANTED: a synthetic ungoverned writer IS detected", () => {
  // THE POSITIVE CONTROL. Without it, "no offenders" and "the detector is
  // broken" are the same output.
  const planted = findUngovernedMethodWrites([
    {
      path: "scripts/planted-bypass.mts",
      source: [
        'import { writeFileSync } from "node:fs";',
        'const STORE = join(ROOT, "data", "method", "knowledge.json");',
        'writeFileSync(STORE, JSON.stringify(k, null, 2), "utf8");',
      ].join("\n"),
    },
  ]);
  assert.equal(planted.length, 1, "the detector did not see a plain bypass");
  assert.equal(planted[0].file, "scripts/planted-bypass.mts");
  assert.deepEqual(planted[0].writeCallLines, [3]);
  assert.deepEqual(planted[0].storeReferenceLines, [2]);
  assert.match(planted[0].why, /writeMethodStore/);

  // NEGATIVE CONTROLS, which are what stop the detector from being a nuisance
  // that gets deleted: a file that only NAMES the store, a file that only
  // writes something else, and a file whose only mention is in a COMMENT.
  const clean = findUngovernedMethodWrites([
    { path: "scripts/reads-only.mts", source: 'const STORE = "data/method/knowledge.json";\nreadFileSync(STORE);' },
    { path: "scripts/writes-elsewhere.mts", source: 'writeFileSync("out.json", "{}");' },
    {
      path: "scripts/mentions-in-prose.mts",
      source: '/* the route lives in data/method/knowledge.json */\nwriteFileSync("report.json", "{}");',
    },
  ]);
  assert.deepEqual(clean, [], "the detector fired on a file that does not write the method store");
});

test("no UNNAMED file writes the canonical method store — the ratchet", () => {
  const findings = findUngovernedMethodWrites(sweepInputs(["lib", "scripts"]));
  const unnamed = unnamedUngovernedWrites(findings);

  assert.deepEqual(
    unnamed.map((f) => f.file),
    [],
    `${ungovernedWriteRefusal(unnamed)}\n\nA new bypass must either use ${GOVERNED_METHOD_WRITER.fn}() or be added ` +
      "to KNOWN_UNGOVERNED_METHOD_WRITERS with a reason and the change wanted.",
  );

  // AND THE RATCHET ONLY TURNS ONE WAY. Every named exception must still be a
  // real one: a name left behind after the file was fixed would quietly re-open
  // the allowance for the next file with that path.
  const found = new Set(findings.map((f) => f.file));
  const stale = KNOWN_UNGOVERNED_METHOD_WRITERS.filter((w) => !found.has(w.file));
  assert.deepEqual(
    stale.map((w) => w.file),
    [],
    "these are named as known bypasses and no longer bypass anything — remove them from the list",
  );
});

test("no file under lib/method/ bypasses the gate except the gate itself", () => {
  // The tighter statement, scoped to the library where the rule is enforceable
  // today. `scripts/` carries six named legacy writers; `lib/method/` carries
  // exactly one writer and it is the governed one.
  const findings = findUngovernedMethodWrites(sweepInputs(["lib"]));
  assert.deepEqual(findings.map((f) => f.file), []);
  assert.ok(
    GOVERNED_WRITE_ALLOWLIST.includes(GOVERNED_METHOD_WRITER.module),
    "the gate must be allowlisted, or it reports itself and the guard gets deleted",
  );
});

test("every named bypass says what it must become — a list of paths teaches nothing", () => {
  assert.ok(KNOWN_UNGOVERNED_METHOD_WRITERS.length > 0, "this ratchet is vacuous if it names nothing");
  for (const w of KNOWN_UNGOVERNED_METHOD_WRITERS) {
    assert.ok(w.why.length > 30, `${w.file} names no reason`);
    assert.ok(w.wanted.length > 30, `${w.file} does not say what it must become`);
  }
  const refusal = ungovernedWriteRefusal(findUngovernedMethodWrites(sweepInputs(["scripts"])));
  assert.match(refusal, /REFUSED/);
  assert.match(refusal, /writeMethodStore/);
  assert.match(refusal, /ratchet/);
});
