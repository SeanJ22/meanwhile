/**
 * RL-06: the runner's adapter engineer publishes `stream/adapter-<kind>` for
 * River instead of opening and merging its own pull requests, behind a switch
 * that keeps exactly one publisher active, and a stream that fails River's
 * checks is returned to its writer with a fix-list entry.
 */
import assert from "node:assert/strict";
import { repairScope } from "../lib/control-plane/workers/adapter-repair-scope.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  ADAPTER_PUBLICATION_DEFAULT,
  ADAPTER_PUBLICATION_ENV,
  readAdapterPublication,
} from "../lib/control-plane/workers/adapter-publication.mjs";
import {
  adapterOwnCheck,
  adapterStatusRecord,
  publishAdapterStream,
  workAdapterQueue,
  type GitHubRequest,
} from "../lib/control-plane/workers/engineering-adapter.ts";
import { parseFixField, ADD_TO_QUEUE_OPTION } from "../lib/control-plane/fix-queue.ts";
import { riverReturn, riverReturnMarkdown } from "../lib/control-plane/river-returns.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { readFieldManual } from "../lib/control-plane/field-manual.ts";
import { MODELS } from "../lib/models.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { parseStatus, pendingReady } from "../scripts/river.mjs";

const ROOT = join(import.meta.dirname, "..");
const RIVER_SCRIPT = join(ROOT, "scripts", "river.mjs");
const MERGE_SCRIPT = join(ROOT, "scripts", "merge-engineer-adapters.mjs");
const SHA = (c: string) => c.repeat(40);
const FILES = [
  { path: "lib/sources/platform-adapters/test-calendar-feed.ts", content: "export const extract = () => [];\n" },
  { path: "lib/sources/platform-adapters/test-calendar-feed.test.ts", content: "import test from 'node:test';\ntest('x', () => {});\n" },
];

/* -------------------------------------------------------------------------- */
/* The switch                                                                 */
/* -------------------------------------------------------------------------- */

test("the publication switch defaults to pr, reads the env override, and an unreadable value turns both routes off", () => {
  assert.equal(ADAPTER_PUBLICATION_DEFAULT, "pr", "the old route stays default until River's route is checked live");
  assert.deepEqual(readAdapterPublication({}), { mode: "pr", source: "default", problem: null });
  assert.deepEqual(readAdapterPublication({ [ADAPTER_PUBLICATION_ENV]: "" }), { mode: "pr", source: "default", problem: null },
    "an unset repository variable reaches the workflow as an empty string");
  assert.deepEqual(readAdapterPublication({ [ADAPTER_PUBLICATION_ENV]: " River " }), { mode: "river", source: "env", problem: null });
  assert.deepEqual(readAdapterPublication({ [ADAPTER_PUBLICATION_ENV]: "pr" }), { mode: "pr", source: "env", problem: null });
  const typo = readAdapterPublication({ [ADAPTER_PUBLICATION_ENV]: "rivr" });
  assert.equal(typo.mode, null);
  assert.match(typo.problem ?? "", /neither pr nor river/);
});

test("the merge workflow passes the switch and its script merges nothing unless the switch reads pr", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/engineer-adapter-merge.yml"), "utf8");
  assert.match(workflow, /WTP_ADAPTER_PUBLICATION: \$\{\{ vars\.WTP_ADAPTER_PUBLICATION \}\}/);
  for (const [value, expected] of [["river", /adapter merges are off: WTP_ADAPTER_PUBLICATION reads river/], ["bogus", /neither pr nor river/]] as const) {
    // No token and no repository: any GitHub call would fail loudly, so a clean
    // exit with the message proves the merge path did not run.
    const run = spawnSync(process.execPath, [MERGE_SCRIPT], {
      cwd: ROOT, encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", [ADAPTER_PUBLICATION_ENV]: value, GH_TOKEN: "", GH_REPOSITORY: "" } as unknown as NodeJS.ProcessEnv,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, expected);
    assert.doesNotMatch(`${run.stdout}${run.stderr}`, /api\.github\.com|merged|#\d+/);
  }
});

/* -------------------------------------------------------------------------- */
/* The engineer's river route                                                 */
/* -------------------------------------------------------------------------- */

function fakeGitHub(options: { branch?: string | null } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const blobs = new Map<string, { base: string; tree: { path: string; content: string }[] }>();
  let n = 0;
  const request: GitHubRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    if (/\/pulls/.test(path)) throw new Error("river mode must not touch pull requests");
    if (path.includes("/git/matching-refs/heads/stream/adapter-")) {
      return options.branch ? [{ ref: "refs/heads/stream/adapter-test-calendar-feed-other", object: { sha: SHA("9") } },
        { ref: "refs/heads/stream/adapter-test-calendar-feed", object: { sha: options.branch } }] : [];
    }
    if (path.endsWith("/git/ref/heads/river")) return { object: { sha: SHA("r") } };
    if (/\/git\/commits\/[0-9a-z]{40}$/.test(path)) return { tree: { sha: "tree-of-" + path.slice(-40) } };
    if (path.endsWith("/git/trees")) {
      const sha = `tree-${++n}`;
      blobs.set(sha, body as never);
      return { sha };
    }
    if (path.endsWith("/git/commits")) return { sha: String(++n).padStart(40, "c") };
    return {};
  };
  return { calls, request, blobs };
}

test("river mode pushes a READY commit and a status record River's scan parses, from river when the stream is new, and opens no PR", async () => {
  const gh = fakeGitHub();
  const published = await publishAdapterStream({ platform: "Test Calendar Feed", files: FILES, reason: "Recover meetings acquisition.", runId: "engineer:a1", now: "2026-10-04T12:00:00Z", request: gh.request });
  assert.equal(published.branch, "stream/adapter-test-calendar-feed");
  assert.equal(published.created, true);
  assert.ok(gh.calls.every((call) => !call.path.includes("/pulls")), "no pull request call");

  const commits = gh.calls.filter((call) => call.path.endsWith("/git/commits") && call.method === "POST").map((call) => call.body as { message: string; parents: string[]; tree: string });
  assert.equal(commits.length, 2);
  assert.match(commits[0].message.split("\n")[0], /^READY: adapter test-calendar-feed /);
  assert.deepEqual(commits[0].parents, [SHA("r")], "a new stream starts from river");
  assert.deepEqual(commits[1].parents, [published.readySha], "the status commit follows the READY commit");
  const readyTree = gh.calls.find((call) => call.path.endsWith("/git/trees"))!.body as { base_tree: string; tree: { path: string }[] };
  assert.deepEqual(readyTree.tree.map((file) => file.path), FILES.map((file) => file.path), "the READY commit carries only adapter files");
  assert.equal(readyTree.base_tree, "tree-of-" + SHA("r"));

  const statusTree = gh.calls.filter((call) => call.path.endsWith("/git/trees"))[1].body as { tree: { path: string; content: string }[] };
  assert.equal(statusTree.tree[0].path, ".factory/adapter-test-calendar-feed.md");
  const fields = parseStatus(statusTree.tree[0].content);
  assert.equal(fields.build_state, "waiting");
  assert.equal(fields.worker, "adapter engineer");
  assert.equal(fields.provider, "runner");
  assert.equal(fields.run_id, "engineer:a1");
  assert.equal(fields.lock, "none");
  assert.equal(fields.heartbeat, "2026-10-04T12:00:00Z");
  assert.equal(fields.ready, `adapter-test-calendar-feed ${published.readySha}`);
  assert.match(fields.checks, /engineer check pass: 1 implementation, 1 colocated test/);
  assert.match(fields.checks, /River runs pnpm gates/);

  const ref = gh.calls.at(-1)!;
  assert.deepEqual([ref.method, ref.path, ref.body], ["POST", "repos/SeanJ22/meanwhile/git/refs", { ref: "refs/heads/stream/adapter-test-calendar-feed", sha: published.statusSha }]);

  // What River does with it: the READY commit is the one folded; the status after it stays behind.
  const pending = pendingReady({
    commits: [{ sha: published.statusSha, subject: commits[1].message }, { sha: published.readySha, subject: commits[0].message.split("\n")[0] }],
    integrated: new Set(),
  });
  assert.deepEqual(pending, { ready_sha: published.readySha, steps: [], wip_after_ready: 1 });
});

test("an existing adapter stream moves by fast-forward only, never forced", async () => {
  const gh = fakeGitHub({ branch: SHA("e") });
  const published = await publishAdapterStream({ platform: "test-calendar-feed", files: FILES, reason: "Repair.", runId: "r", now: "2026-10-04T12:00:00Z", request: gh.request });
  assert.equal(published.created, false);
  assert.ok(!gh.calls.some((call) => call.path.endsWith("/git/ref/heads/river")), "an existing stream is built on, not restarted");
  const ready = gh.calls.find((call) => call.path.endsWith("/git/commits") && call.method === "POST")!.body as { parents: string[] };
  assert.deepEqual(ready.parents, [SHA("e")]);
  const update = gh.calls.at(-1)!;
  assert.deepEqual([update.method, update.path, update.body], ["PATCH", "repos/SeanJ22/meanwhile/git/refs/heads/stream/adapter-test-calendar-feed", { sha: published.statusSha, force: false }]);
});

test("nothing is marked READY until the engineer's own checks pass", async () => {
  assert.equal(adapterOwnCheck([FILES[0]]).ok, false, "an implementation without a colocated test is not ready");
  assert.equal(adapterOwnCheck([FILES[1]]).ok, false, "a test without an implementation is not ready");
  assert.equal(adapterOwnCheck(FILES).ok, true);
  for (const [files, check] of [[[FILES[0]], undefined], [FILES, () => ({ ok: false, summary: "colocated test failed" })]] as const) {
    const gh = fakeGitHub();
    await assert.rejects(publishAdapterStream({ platform: "x", files, reason: "r", runId: "r", now: "n", request: gh.request, check }), /ENGINEER_ADAPTER_CHECK_FAILED/);
    assert.deepEqual(gh.calls, [], "a failed check publishes nothing");
  }
  const text = adapterStatusRecord({ kind: "k", readySha: SHA("a"), check: { ok: true, summary: "pass" }, runId: "r", now: "t", reason: "why\n## not a field" });
  assert.equal(parseStatus(text).ready, `adapter-k ${SHA("a")}`, "the reason never leaks into the field block");
});

function needsAdapter(attemptId: string): ScoutResult {
  return {
    refusal: null, outcome: "NEEDS_ADAPTER", subjectId: "tenant", recordClass: "meetings", attemptId, recordedAt: "2026-10-04T00:00:00Z",
    narrative: "A new calendar format needs a parser", artifactIds: ["held"], nextRungs: [], findings: [],
    candidates: [{ routeId: "test-calendar-feed", url: "https://platform.example/tenant/calendar", evidenceArtifactIds: ["held"] }],
    rungs: [],
  } as unknown as ScoutResult;
}
const generated = () => async () => ({
  model: MODELS.haiku.model, stop_reason: "end_turn",
  content: [{ type: "text" as const, text: JSON.stringify({ files: FILES }) }],
  usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

test("the engineer's queue publishes to the adapter stream with no PR when the switch reads river", async () => {
  const before = process.env[ADAPTER_PUBLICATION_ENV];
  process.env[ADAPTER_PUBLICATION_ENV] = "river";
  try {
    const repos = createMemoryRepositories();
    const gh = fakeGitHub();
    const opened = await workAdapterQueue({
      repos, results: [needsAdapter("river-1")], now: "2026-10-04T12:00:00Z", request: gh.request, transportFor: generated,
      readEvidence: async () => ({ text: "Saved calendar", canonicalUrl: "https://platform.example/tenant/calendar", artifactId: "held" } as never),
    });
    assert.equal(opened.length, 1);
    assert.equal(opened[0].branch, "stream/adapter-test-calendar-feed");
    assert.ok(!("number" in opened[0]), "no pull request number: none was opened");
    assert.ok(gh.calls.length > 0 && gh.calls.every((call) => !call.path.includes("/pulls")));
    const entry = (await readFieldManual(repos, { role: "DETECTIVE" })).store.entries.find((e) => e.kind === "ENGINEER_ADAPTER_PR")!;
    const payload = entry.payload as { stream?: { branch: string; readySha: string }; pr?: unknown; files: string[] };
    assert.equal(payload.stream?.branch, "stream/adapter-test-calendar-feed");
    assert.equal(payload.pr, undefined);
    assert.deepEqual(payload.files, FILES.map((file) => file.path), "Detective still learns the adapter's files");
  } finally {
    if (before === undefined) delete process.env[ADAPTER_PUBLICATION_ENV]; else process.env[ADAPTER_PUBLICATION_ENV] = before;
  }
});

test("an unreadable switch publishes nothing and records why", async () => {
  const before = process.env[ADAPTER_PUBLICATION_ENV];
  process.env[ADAPTER_PUBLICATION_ENV] = "both";
  try {
    const repos = createMemoryRepositories();
    let calls = 0;
    const opened = await workAdapterQueue({
      repos, results: [needsAdapter("off-1")], now: "2026-10-04T12:00:00Z", transportFor: generated,
      request: async () => { calls++; return {}; },
      readEvidence: async () => ({ text: "Saved calendar", canonicalUrl: "https://platform.example/tenant/calendar", artifactId: "held" } as never),
    });
    assert.deepEqual(opened, []);
    assert.equal(calls, 0);
    const blocker = (await readFieldManual(repos, { role: "ENGINEER" })).store.entries.find((e) => e.kind === "ENGINEER_BLOCKER")!;
    assert.match(blocker.summary, /ENGINEER_ADAPTER_ROUTE_OFF/);
  } finally {
    if (before === undefined) delete process.env[ADAPTER_PUBLICATION_ENV]; else process.env[ADAPTER_PUBLICATION_ENV] = before;
  }
});

test("pr mode is unchanged: the engineer still opens its labelled pull request", async () => {
  const repos = createMemoryRepositories();
  const paths: string[] = [];
  const opened = await workAdapterQueue({
    repos, results: [needsAdapter("pr-1")], now: "2026-10-04T12:00:00Z", mode: "pr", transportFor: generated,
    readEvidence: async () => ({ text: "Saved calendar", canonicalUrl: "https://platform.example/tenant/calendar", artifactId: "held" } as never),
    request: async (method, path) => {
      paths.push(`${method} ${path}`);
      if (path.includes("/pulls?")) return [];
      if (path.endsWith("/git/ref/heads/main")) return { object: { sha: "base" } };
      if (path.endsWith("/git/commits/base")) return { tree: { sha: "base-tree" } };
      if (path.endsWith("/git/trees")) return { sha: "tree" };
      if (path.endsWith("/git/commits")) return { sha: "commit" };
      if (path.endsWith("/pulls")) return { html_url: "https://github.com/SeanJ22/meanwhile/pull/7", number: 7 };
      return {};
    },
  });
  assert.equal(opened.length, 1);
  assert.equal((opened[0] as { number: number }).number, 7);
  assert.ok(paths.includes("POST repos/SeanJ22/meanwhile/pulls"));
  assert.ok(!paths.some((path) => path.includes("stream/adapter-")));
});

/* -------------------------------------------------------------------------- */
/* Returns                                                                    */
/* -------------------------------------------------------------------------- */

test("a returned stream becomes one fix-list item owned by the lane that wrote it", () => {
  const output = "> pnpm gates\n\nok 1 - first\nnot ok 2 - calendar adapter keeps exact quotes\n  AssertionError: expected 3 got 2\n";
  const first = riverReturn({ lane: "adapter-test-calendar-feed", check: "gates", output, readySha: SHA("a"), steps: ["adapter-test-calendar-feed"], riverSha: SHA("r"), at: "2026-10-04T12:00:00Z" });
  assert.equal(first.owner, "adapter-test-calendar-feed");
  assert.equal(first.writer, "the runner's adapter engineer");
  assert.equal(first.headline, "not ok 2 - calendar adapter keeps exact quotes");
  assert.equal(first.fix.chosenOption, ADD_TO_QUEUE_OPTION);
  // The entry is exactly what the queue button would record for the same words.
  const asQueued = parseFixField(first.fix.consequenceShown)!;
  assert.equal(asQueued.subjectId, first.fix.subjectId);
  assert.equal(asQueued.where, "River · stream/adapter-test-calendar-feed");

  const again = riverReturn({ lane: "adapter-test-calendar-feed", check: "gates", output, readySha: SHA("b"), steps: [], riverSha: SHA("s"), at: "2026-10-05T12:00:00Z" });
  assert.equal(again.fix.subjectId, first.fix.subjectId, "the same failure returned twice is one item");
  assert.equal(riverReturn({ lane: "meetings", check: "gates", output, readySha: null, steps: [], riverSha: null, at: "t" }).writer, "the meetings lane");

  const markdown = riverReturnMarkdown(first);
  const fields = parseStatus(markdown);
  assert.equal(fields.lane, "adapter-test-calendar-feed");
  assert.equal(fields.state, "returned");
  assert.equal(fields.fix_subject, first.fix.subjectId);
  assert.equal(fields.ready, `adapter-test-calendar-feed ${SHA("a")}`);
  assert.match(markdown, /AssertionError: expected 3 got 2/);
});

/* -------------------------------------------------------------------------- */
/* River end to end                                                           */
/* -------------------------------------------------------------------------- */

const ENV = {
  ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "",
  GIT_AUTHOR_NAME: "River Test", GIT_AUTHOR_EMAIL: "river@example.invalid",
  GIT_COMMITTER_NAME: "River Test", GIT_COMMITTER_EMAIL: "river@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
};
const sh = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function put(cwd: string, path: string, text: string) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), text);
}
function river(cwd: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [RIVER_SCRIPT, ...args], { cwd, env: ENV, encoding: "utf8" });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

test("River takes an adapter stream like any lane, returns a conflicting one to its writer, and clears the return when the repair integrates", { timeout: 120_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "river-adapter-"));
  try {
    const origin = join(root, "origin.git");
    const work = join(root, "work");
    const checkout = join(root, "river");
    sh(root, ["init", "--quiet", "--bare", "--initial-branch=main", origin]);
    sh(root, ["clone", "--quiet", origin, work]);
    sh(work, ["checkout", "--quiet", "-b", "main"]);
    put(work, "lib/sources/platform-adapters/shared.ts", "export const v = 0;\n");
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "base"]);
    sh(work, ["push", "--quiet", "origin", "main", "main:river"]);
    sh(work, ["checkout", "--quiet", "--orphan", "board"]);
    sh(work, ["rm", "-r", "-q", "--cached", "."]);
    rmSync(join(work, "lib"), { recursive: true, force: true });
    put(work, "status.md", "# River status\n\nlock: none\n");
    sh(work, ["add", "status.md"]);
    sh(work, ["commit", "--quiet", "-m", "board"]);
    sh(work, ["push", "--quiet", "origin", "board:board/river"]);

    // The engineer's two commits, as publishAdapterStream writes them.
    const publish = (kind: string, value: string) => {
      sh(work, ["fetch", "--quiet", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
      const exists = spawnSync("git", ["rev-parse", "--verify", `origin/stream/adapter-${kind}`], { cwd: work, env: ENV }).status === 0;
      sh(work, ["checkout", "--quiet", "-f", "-B", `adapter-${kind}`, exists ? `origin/stream/adapter-${kind}` : "origin/river"]);
      put(work, "lib/sources/platform-adapters/shared.ts", `export const v = "${value}";\n`);
      put(work, `lib/sources/platform-adapters/${kind}.test.ts`, "// test\n");
      sh(work, ["add", "lib"]);
      sh(work, ["commit", "--quiet", "-m", `READY: adapter ${kind} reusable source adapter`]);
      const ready = sh(work, ["rev-parse", "HEAD"]);
      put(work, `.factory/adapter-${kind}.md`, adapterStatusRecord({ kind, readySha: ready, check: { ok: true, summary: "engineer check pass" }, runId: "engineer:x", now: new Date().toISOString(), reason: "why" }));
      sh(work, ["add", ".factory"]);
      sh(work, ["commit", "--quiet", "-m", `status: adapter-${kind} ready ${ready.slice(0, 12)}`]);
      sh(work, ["push", "--quiet", "origin", `adapter-${kind}:stream/adapter-${kind}`]);
      return ready;
    };
    const alphaReady = publish("alpha", "alpha");
    const betaReady = publish("beta", "beta");
    sh(root, ["clone", "--quiet", origin, checkout]);

    const plan = JSON.parse(river(checkout, "scan").out);
    assert.deepEqual(plan.ready_lanes, ["adapter-alpha", "adapter-beta"]);
    const alpha = plan.lanes.find((lane: { lane: string }) => lane.lane === "adapter-alpha");
    assert.deepEqual(alpha.ready, { ready_sha: alphaReady, steps: ["adapter-alpha"], wip_after_ready: 1 }, "the stream is the step");
    assert.equal(alpha.status.worker, "adapter engineer");
    assert.equal(alpha.status.ready, `adapter-alpha ${alphaReady}`);
    assert.deepEqual(alpha.outside_adapter_path, []);

    // Both edit the same line: beta conflicts and goes back to its writer.
    const folded = river(checkout, "fold");
    assert.equal(folded.code, 1, folded.out);
    assert.match(folded.out, /RETURN: adapter-beta failed fold; owner adapter-beta \(the runner's adapter engineer\)/);
    assert.match(folded.out, /fix list: River · stream\/adapter-beta — fold failed for adapter-beta: /);
    const returned = sh(checkout, ["show", "origin/board/river:returns/adapter-beta.md"]);
    const fields = parseStatus(returned);
    assert.equal(fields.state, "returned");
    assert.equal(fields.ready, `adapter-beta ${betaReady}`);
    assert.match(returned, /CONFLICT/);
    assert.equal(sh(checkout, ["show", "origin/board/river:status.md"]), "# River status\n\nlock: none", "River's own status is untouched");

    // The `return` command records any check's failure by hand.
    put(checkout, ".scratch/out.txt", "not ok 1 - alpha keeps quotes\n");
    const byHand = river(checkout, "return", "adapter-alpha", "--check", "gates", "--output-file", ".scratch/out.txt", "--sha", alphaReady);
    assert.equal(byHand.code, 0, byHand.out);
    assert.equal(parseStatus(sh(checkout, ["show", "origin/board/river:returns/adapter-alpha.md"])).check, "gates");

    // The repaired alpha integrates alone; its return is cleared on the board.
    sh(checkout, ["checkout", "--quiet", "-f", "main"]);
    assert.equal(river(checkout, "fold", "--lanes", "adapter-alpha").code, 0);
    const head = sh(checkout, ["rev-parse", "HEAD"]);
    writeFileSync(join(checkout, ".scratch/river/test.json"), JSON.stringify({ sha: head, gates: "pass" }));
    const promoted = river(checkout, "promote");
    assert.equal(promoted.code, 0, promoted.out);
    assert.match(parseStatus(sh(checkout, ["show", "origin/board/river:returns/adapter-alpha.md"])).state, /^cleared: integrated ready /);
    assert.equal(parseStatus(sh(checkout, ["show", "origin/board/river:returns/adapter-beta.md"])).state, "returned", "an unrepaired return stays open");
    const integration = JSON.parse(sh(checkout, ["show", "origin/board/river:integration.json"]));
    assert.deepEqual(integration.map((entry: { lane: string; steps: string[] }) => [entry.lane, entry.steps]), [["adapter-alpha", ["adapter-alpha"]]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB-57 connects saved failure, adapter files and its own tests to a scoped engineer request and checked publication", async () => {
  const repos = createMemoryRepositories();
  const gh = fakeGitHub();
  const changed = [{ path: 'lib/sources/iqm2/index.ts', content: 'export const repaired = true;' }];
  let checked = 0;
  const opened = await workAdapterQueue({
    repos, results: [needsAdapter('scoped-repair')], now: '2026-10-05T12:00:00Z', mode: 'river', request: gh.request,
    readEvidence: async () => ({ text: 'Saved failing calendar', canonicalUrl: 'https://calendar.example/meeting', artifactId: 'held' } as never),
    repairScopeFor: (_kind, example) => repairScope({ kind: 'iqm2', example,
      paths: ['lib/sources/iqm2/index.ts', 'tests/iqm2.test.ts', 'tests/composite.test.ts'],
      readText: path => path.endsWith('iqm2.test.ts') ? 'import "../lib/sources/iqm2/index.ts"; /* existing behavior check */' : 'export const prior = true;' }),
    transportFor: () => async request => {
      const brief = String(request.messages[0].content);
      assert.match(brief, /Saved failing calendar/);
      assert.match(brief, /lib\/sources\/iqm2\/index.ts/);
      assert.match(brief, /existing behavior check/);
      assert.doesNotMatch(brief, /lib\/sources\/ical/);
      return { content: [{ type: 'text', text: JSON.stringify({ files: changed }) }], usage: { input_tokens: 1, output_tokens: 1 } } as never;
    },
    check: files => { checked++; assert.deepEqual(files, changed); return { ok: true, summary: 'iqm2 fixture and composite tests passed' }; },
  });
  assert.equal(checked, 1);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].branch, 'stream/adapter-iqm2');
  assert.ok(gh.calls.every(call => !call.path.includes('/pulls')));
});
