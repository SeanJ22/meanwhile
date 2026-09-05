/**
 * **RL-2 / RL-3 — the pure parts of the Reader proof renewal, and the run
 * record that carries RL-1's observations and the renewal's verdict.**
 * (The author's refresh-liveness addendum, 2026-09-05.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckRunner } from "../lib/ops/generated-freshness.ts";
import type { GeneratedArtifact } from "../lib/ops/generated-register.ts";
import { REFRESH_SOURCES } from "../lib/ops/refresh-cadence.ts";
import { restoreRefusedChange, type GitRunner } from "../scripts/lib/refresh-revert.ts";
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

/* ========================================================================== */
/* RLC-2 (2026-09-05) — a refusal restores ONE coherent tree, dependents too   */
/* ========================================================================== */

/**
 * Refresh run #25 (head 742993c7) refused meetings and fec at the final render,
 * put both holdings back at HEAD, and left the 56 state manifests the
 * orchestrator had regenerated from the CHANGED tree in place. The suite then
 * failed `tests/generated-artifacts.test.ts` on `state-manifest --check` —
 * STALE docs/states/ak.md … — against a tree the refusal itself had made
 * incoherent. The shared move below restores first and regenerates second,
 * through the same registry the gate and the push door use.
 */
const SAMPLE: GeneratedArtifact[] = [
  { path: "docs/states/nh.md", command: "corepack pnpm state-manifest", checkCommand: "corepack pnpm state-manifest --check", pure: true },
  { path: "docs/states/az.md", command: "corepack pnpm state-manifest", checkCommand: "corepack pnpm state-manifest --check", pure: true },
  { path: "data/questionnaire/invitations-nj-morris-2026.json", command: "corepack pnpm questionnaire:invitations --write", checkCommand: "corepack pnpm questionnaire:invitations --check", pure: true },
];

/** A Git that answers `status` for the refused groups and records every move it is asked to make. */
function fakeGit(calls: string[]): GitRunner {
  return (args) => {
    calls.push(args.join(" "));
    if (args[0] !== "status") return "";
    const under = args.slice(args.indexOf("--") + 1);
    if (under.includes("docs/evidence")) {
      return " M docs/evidence/reader-last-mile-final-closure-receipt.json\0?? docs/evidence/reader-last-mile-refresh-prior-receipt.json\0";
    }
    if (under.includes("data/meetings-snapshot.json")) return " M data/meetings-snapshot.json\0";
    return "";
  };
}

test("RLC-2: a refused change goes back to HEAD and THEN the PURE dependents regenerate from the restored tree, in that order, through the registry", () => {
  const root = mkdtempSync(join(tmpdir(), "refresh-revert-"));
  mkdirSync(join(root, "docs/evidence"), { recursive: true });
  const leaked = join(root, "docs/evidence/reader-last-mile-refresh-prior-receipt.json");
  writeFileSync(leaked, "{}");
  const calls: string[] = [];
  // The manifests read STALE until the generator has run — the world after run #25's revert.
  let manifestsCurrent = false;
  const runCheck: CheckRunner = (command) => {
    calls.push(`check ${command}`);
    return command.includes("state-manifest") && !manifestsCurrent
      ? { ok: false, output: "state-manifest: STALE docs/states/nh.md\nSTALE docs/states/az.md" }
      : { ok: true, output: "CURRENT" };
  };
  const runGen = (command: string) => {
    calls.push(`gen ${command}`);
    if (command.includes("state-manifest")) manifestsCurrent = true;
    return { ok: true, output: "wrote" };
  };
  const restore = restoreRefusedChange({
    git: fakeGit(calls),
    root,
    groups: [
      { id: "committed Reader evidence", paths: ["docs/evidence"] },
      { id: "meetings", paths: ["data/meetings-snapshot.json"] },
    ],
    runCheck,
    runGen,
    generated: SAMPLE,
    log: () => {},
  });
  // Every group is back at HEAD by name — including the untracked evidence a failed renewal wrote.
  assert.deepEqual(restore.restored, [
    { id: "committed Reader evidence", paths: ["docs/evidence/reader-last-mile-final-closure-receipt.json", "docs/evidence/reader-last-mile-refresh-prior-receipt.json"] },
    { id: "meetings", paths: ["data/meetings-snapshot.json"] },
  ]);
  assert.ok(!existsSync(leaked), "the failed renewal's untracked evidence is gone");
  assert.ok(calls.includes("checkout HEAD -- docs/evidence/reader-last-mile-final-closure-receipt.json"));
  assert.ok(calls.includes("checkout HEAD -- data/meetings-snapshot.json"));
  // THE ORDER IS THE FIX: the last checkout precedes the first freshness check.
  const lastCheckout = calls.reduce((last, call, index) => (call.startsWith("checkout") ? index : last), -1);
  const firstCheck = calls.findIndex((call) => call.startsWith("check "));
  assert.ok(firstCheck > lastCheckout && lastCheckout >= 0, `regeneration must follow the restore: ${calls.join(" | ")}`);
  // Only the stale generator ran, by its generator command, and the tree is now coherent.
  assert.deepEqual(calls.filter((call) => call.startsWith("gen ")), ["gen corepack pnpm state-manifest"]);
  assert.deepEqual(restore.regenerated, ["docs/states/nh.md", "docs/states/az.md"]);
  assert.deepEqual(restore.regenerationFailed, []);
  assert.ok(runCheck("corepack pnpm state-manifest --check").ok);
});

test("RLC-2: a generator that cannot regenerate after the restore is reported, never passed off as coherent", () => {
  const root = mkdtempSync(join(tmpdir(), "refresh-revert-fail-"));
  const calls: string[] = [];
  const restore = restoreRefusedChange({
    git: fakeGit(calls),
    root,
    groups: [{ id: "meetings", paths: ["data/meetings-snapshot.json"] }],
    runCheck: (command) => (command.includes("state-manifest") ? { ok: false, output: "STALE docs/states/nh.md" } : { ok: true, output: "ok" }),
    runGen: () => ({ ok: false, output: "generator crashed\nat somewhere" }),
    generated: SAMPLE,
    log: () => {},
  });
  assert.deepEqual(restore.regenerated, []);
  assert.equal(restore.regenerationFailed.length, 1);
  assert.match(restore.regenerationFailed[0].command, /state-manifest/);
});

test("RLC-2: the FAILED record carries what the refusal put back and regenerated, and the summary states it beside the refusal", () => {
  const restore = {
    restored: [
      { id: "committed Reader evidence", paths: ["docs/evidence/reader-last-mile-final-closure-receipt.json"] },
      { id: "meetings", paths: ["data/meetings-snapshot.json"] },
    ],
    regenerated: ["docs/states/nh.md", "docs/states/az.md"],
    regenerationFailed: [] as { command: string; output: string }[],
  };
  const renewal = failedRenewal({
    exactHead: "742993c78f5ef56afe9d9bab2e52c31256326563",
    ranAt: "2026-09-05T20:19:26.681Z",
    changedHoldings: ["data/meetings-snapshot.json"],
    prefix: "docs/evidence/reader-last-mile-refresh",
    steps: [{ name: "final render and witnesses", ok: false, secs: 38, detail: "exited 1" }],
    failure: "final render and witnesses: exited 1",
    sources: REFRESH_SOURCES,
    restore,
  });
  assert.deepEqual(renewal.restore, restore);
  const lines = renewalSummary(renewal);
  assert.ok(lines.includes("  restored committed Reader evidence: 1 path(s) back at HEAD"));
  assert.ok(lines.includes("  restored meetings: 1 path(s) back at HEAD"));
  assert.ok(lines.includes("  regenerated 2 PURE dependent path(s) from the restored tree"));
  // The refusal's attribution is untouched by the restore: the step named is the one that failed.
  assert.match(renewal.refusedSources[0].why, /at final render and witnesses:/);
  const broken = failedRenewal({ ...renewal, prefix: renewal.prefix, failure: renewal.failure!, sources: REFRESH_SOURCES, restore: { ...restore, regenerated: [], regenerationFailed: [{ command: "corepack pnpm state-manifest", output: "generator crashed\nat somewhere" }] } });
  assert.ok(renewalSummary(broken).includes("  regeneration FAILED: `corepack pnpm state-manifest` — generator crashed"));
  // A renewal that refused nothing restored nothing, and says so by shape.
  assert.equal(notNeededRenewal("a".repeat(40), "2026-09-05T20:00:00.000Z").restore, null);
});

test("RLC-2: the orchestrator refuses through the shared restore, and the refresh workflow never arms the forced-refusal seam", () => {
  const orchestrator = readFileSync(join(process.cwd(), "scripts/refresh-reader-renewal.mts"), "utf8");
  assert.ok(orchestrator.includes("restoreRefusedChange("), "the refusal path restores through scripts/lib/refresh-revert.ts");
  assert.ok(!/revertFilesToHead\(/.test(orchestrator), "no second revert path in the orchestrator");
  assert.ok(orchestrator.includes("process.env.READER_RENEWAL_REFUSE_AT"), "the proof seam exists, named exactly");
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/refresh-daily.yml"), "utf8");
  assert.ok(!workflow.includes("READER_RENEWAL_REFUSE_AT"), "a scheduled refresh can never be told to refuse on purpose");
});
