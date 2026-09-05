/**
 * **RL-2 / RL-3 — the pure parts of the Reader proof renewal, and the run
 * record that carries RL-1's observations and the renewal's verdict.**
 * (The author's refresh-liveness addendum, 2026-09-05.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REFRESH_SOURCES } from "../lib/ops/refresh-cadence.ts";
import {
  changedHoldings,
  failedRenewal,
  notNeededRenewal,
  renewalSummary,
  renewedRenewal,
  sourcesTouchingHoldings,
  unownedHoldings,
} from "../lib/ops/refresh-renewal.ts";
import { REFRESH_REPORT_PATH, readRefreshRun, writeRefreshRun, type RefreshRun } from "../lib/ops/refresh-report.ts";

const proved = [
  { path: "data/meetings-snapshot.json", sha256: "aaa" },
  { path: "data/fec/fec-2026.json", sha256: "bbb" },
  { path: "data/votes/state-votes-snapshot.json", sha256: "ccc" },
];

test("changedHoldings names a holding whose bytes moved, appeared or vanished, and nothing else", () => {
  const current = [
    { path: "data/meetings-snapshot.json", sha256: "aaa" },
    { path: "data/fec/fec-2026.json", sha256: "bbb2" },
    { path: "data/states/nj/ballot/nj-morris-2026.json", sha256: "new" },
  ];
  assert.deepEqual(changedHoldings(proved, current), ["data/fec/fec-2026.json", "data/states/nj/ballot/nj-morris-2026.json", "data/votes/state-votes-snapshot.json"]);
  assert.deepEqual(changedHoldings(proved, proved), []);
});

test("a changed holding is attributed to the refresh source whose governed prefix covers it — including the NJ files at their post-reorg home", () => {
  const touching = sourcesTouchingHoldings(REFRESH_SOURCES, [
    "data/fec/fec-2026.json",
    "data/states/nj/ballot/nj-morris-2026.json",
    "data/states/nj/ballot/nj-morris-2026-contacts.json",
    "data/meetings-snapshot.json",
  ]);
  assert.deepEqual(touching.map((t) => t.id).sort(), ["fec", "meetings", "nj-filing"]);
  assert.deepEqual(touching.find((t) => t.id === "nj-filing")!.paths, ["data/states/nj/ballot/nj-morris-2026.json", "data/states/nj/ballot/nj-morris-2026-contacts.json"]);
  assert.deepEqual(unownedHoldings(REFRESH_SOURCES, ["data/fec/fec-2026.json", "public/candidates/someone.jpg"]), ["public/candidates/someone.jpg"]);
});

test("a failed renewal refuses only the sources whose change touched a holding, names the step, and says the paths are back at HEAD", () => {
  const renewal = failedRenewal({
    exactHead: "0".repeat(40),
    ranAt: "2026-09-05T20:00:00.000Z",
    changedHoldings: ["data/meetings-snapshot.json", "data/fec/fec-2026.json"],
    prefix: "docs/evidence/reader-last-mile-refresh",
    steps: [
      { name: "exact-head production build", ok: true, secs: 90, detail: null },
      { name: "agenda", ok: false, secs: 3, detail: "agenda exited 1" },
    ],
    failure: "agenda: agenda exited 1: assert failed",
    sources: REFRESH_SOURCES,
  });
  assert.equal(renewal.verdict, "FAILED");
  assert.deepEqual(renewal.refusedSources.map((r) => r.id).sort(), ["fec", "meetings"]);
  const meetings = renewal.refusedSources.find((r) => r.id === "meetings")!;
  assert.match(meetings.why, /data\/meetings-snapshot\.json/);
  assert.match(meetings.why, /at agenda: agenda: agenda exited 1/);
  assert.match(meetings.why, /back at HEAD and it is owed/);
  assert.deepEqual(renewalSummary(renewal).filter((line) => line.startsWith("  refused")).length, 2);
});

test("NOT_NEEDED and RENEWED carry no refusal, and the summary leads with the verdict and the head", () => {
  const head = "abcdef0123456789abcdef0123456789abcdef01";
  const none = notNeededRenewal(head, "2026-09-05T20:00:00.000Z");
  assert.equal(none.verdict, "NOT_NEEDED");
  assert.deepEqual(none.refusedSources, []);
  const renewed = renewedRenewal({ exactHead: head, ranAt: "2026-09-05T20:00:00.000Z", changedHoldings: ["data/fec/fec-2026.json"], prefix: "docs/evidence/reader-last-mile-refresh", steps: [{ name: "finalize --renew-holdings", ok: true, secs: 40, detail: null }] });
  assert.equal(renewed.verdict, "RENEWED");
  assert.equal(renewed.failure, null);
  assert.match(renewalSummary(renewed)[0], /^Reader proof renewal: RENEWED at 2026-09-05T20:00:00.000Z on abcdef01$/);
});

test("the run record round-trips RL-1 observations and the renewal, and the Markdown states both", () => {
  const root = mkdtempSync(join(tmpdir(), "refresh-renewal-report-"));
  const observation = {
    path: "data/votes/state-votes-snapshot.json",
    observedAt: "2026-09-05T19:55:00.000Z",
    verdict: "FACTS_UNCHANGED" as const,
    written: false,
    stampKeys: ["generatedAt", "downloadedAt", "retrievedAt"],
    ignoredTopLevel: [],
    factsSha256: "f".repeat(64),
  };
  const run: RefreshRun = {
    formatVersion: 1,
    runDate: "2026-09-05",
    startedAt: "2026-09-05T19:50:00.000Z",
    finishedAt: "2026-09-05T20:10:00.000Z",
    mode: "ALL",
    exitCode: 0,
    sources: REFRESH_SOURCES.map((s) => ({
      id: s.id,
      due: true,
      ran: true,
      outcome: s.id === "legiscan" ? ("UNCHANGED" as const) : ("INGESTED" as const),
      reason: s.id === "legiscan" ? "ran clean; facts unchanged — 1 artifact(s) re-observed at 2026-09-05T19:55:00.000Z and left byte-identical (stamps not rewritten)" : "ran clean; 1 governed path(s) changed — awaiting the gate",
      commands: [...s.commands],
      failedCommand: null,
      exitCode: 0,
      governs: [...s.governs],
      changedPaths: s.id === "legiscan" ? [] : [s.governs[0]],
      recoveredFrom: [],
      nextDueAt: "2026-09-06",
      observations: s.id === "legiscan" ? [observation] : [],
    })),
    catchUp: { lastLanded: "docs/refresh-run.md", days: ["2026-09-05"], cap: 3, off: true },
    gate: { verdict: "GREEN", ranAt: "2026-09-05T20:09:00.000Z", failingFiles: [], attribution: [], note: "The full suite passed." },
    renewal: renewedRenewal({ exactHead: "a".repeat(40), ranAt: "2026-09-05T20:00:00.000Z", changedHoldings: ["data/meetings-snapshot.json"], prefix: "docs/evidence/reader-last-mile-refresh", steps: [{ name: "finalize --renew-holdings", ok: true, secs: 40, detail: null }] }),
  };
  writeRefreshRun(root, run, REFRESH_SOURCES);
  const back = readRefreshRun(root)!;
  assert.deepEqual(back, run);
  const md = readFileSync(join(root, REFRESH_REPORT_PATH), "utf8");
  assert.match(md, /## What the writers observed \(RL-1\)/);
  assert.match(md, /`legiscan` \| `data\/votes\/state-votes-snapshot\.json` \| FACTS_UNCHANGED \| 2026-09-05T19:55:00\.000Z \| no \|/);
  assert.match(md, /## Reader proof renewal \(RL-2 \/ RL-3\)/);
  assert.match(md, /Reader proof renewal: RENEWED at 2026-09-05T20:00:00\.000Z on aaaaaaaa/);
});
