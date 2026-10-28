#!/usr/bin/env node
/**
 * River: the one path code takes from the build streams to `main`.
 *
 * Builders push `stream/<lane>` and mark finished work with a `READY: <step ids>`
 * commit after the full suite and `pnpm lint` pass on current river. River folds
 * those exact commits into `river-next`, merges `main` in, numbers any
 * step-named migrations and runs only the quick check: the fold is clean, the
 * migrations are numbered, and `pnpm lint` and the type check pass. It then opens
 * one `release/<n>` pull request from that commit with the `run-full-ci` label
 * and auto-merge on, so GitHub CI runs the one full test. `settle` moves `river`
 * to the release commit only after GitHub CI passes, so lanes always cut from
 * fully tested code. When CI fails, `settle` reads which tests failed, returns
 * the lane that caused them, folds again without it and opens the next release.
 * A READY whose message does not state that the work is connected end to end and
 * still works on the next scheduled run is refused and returned, never folded.
 * Every decision a fresh session needs to resume is kept on `board/river`
 * (`integration.json`, `releases/<n>.json`, `returns/<lane>.md`) or in
 * `.scratch/river/`, so the same inputs always give the same fold.
 *
 *   node scripts/river.mjs scan                          what is ready, as JSON
 *   node scripts/river.mjs fold [--lanes a,b] [--order dep|a,b,...]
 *   node scripts/river.mjs migrations                    number step-named migrations on river-next
 *   node scripts/river.mjs check                         the quick check on river-next
 *   node scripts/river.mjs release <n> [--dry-run]       quick check, then release/<n> PR: run-full-ci, auto-merge
 *   node scripts/river.mjs settle <n> [--ci pass|fail --log-file F --lanes a,b]   act on GitHub CI's verdict
 *   node scripts/river.mjs return <lane> --check C [--output-file F]   send a failure back (returns/<lane>.md)
 *   node scripts/river.mjs lock claim|heartbeat|release --branch B --file F --token T [--worker W --run-id R]
 *   node scripts/river.mjs observe <sha> [--dry-run]     one post-deploy reading per deployed SHA
 *
 * A release, in order: `fold`, `migrations`, `release <n>`, then `settle <n>`
 * once GitHub CI has finished. `fold` leaves out a lane whose open return names
 * the same READY, unless `--lanes` names it.
 *
 * GitHub API calls use GITHUB_TOKEN or GH_TOKEN over REST. Without a token, or
 * when the call fails, the command prints `ACTION NEEDED:` with the exact request
 * so the session can make it with its own GitHub tool, and exits 0. `settle`
 * then takes the verdict by hand: `--ci pass`, or `--ci fail --log-file F` with
 * the failed jobs' logs (and `--lanes` when River names the cause itself).
 *
 * Pushes are always normal fast-forwards. A rejected push refetches and decides
 * again; nothing here force-pushes. Lock and board writes are built with git
 * plumbing on a temporary index, so they never touch the caller's checkout.
 *
 * Exit codes: 0 done (or ACTION NEEDED), 1 refused or failed, 2 usage,
 * 3 lock held by a live owner, 4 lock ownership changed.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REQUIRED_CONTEXTS } from "../lib/ops/required-contexts.ts";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** A heartbeat younger than this keeps a lock (briefs/common.md, startup step 4). */
export const STALE_LOCK_MS = 45 * 60 * 1000;

/**
 * The label that makes a ready pull request's CI the full test as soon as it
 * is opened (`lib/ops/pull-request-ci-tier.ts`); without it, or auto-merge, the
 * run waits with lint and types only.
 */
export const FULL_CI_LABEL = "run-full-ci";

/** River's quick check after the fold: `pnpm <args>` for each. */
export const QUICK_CHECKS = Object.freeze([
  { id: "lint", args: ["lint"] },
  { id: "types", args: ["exec", "tsc", "--noEmit"] },
]);

/**
 * Default fold order: lanes that others build on go first (measures owns what a
 * place is owed, registry owns the doors), the screens last. Adapter streams
 * follow, sorted by name, then any lane this list does not know.
 */
export const LANE_ORDER = Object.freeze([
  "measures", "registry", "hunters", "meetings", "auditors", "people",
  "admin", "slide", "ballot", "bank", "frontend",
]);

const BOARD = "board/river";
const RIVER = "river";
const NEXT = "river-next";
const MIGRATIONS_DIR = "lib/db/migrations";
const JOURNAL = `${MIGRATIONS_DIR}/meta/_journal.json`;
const OBSERVE_WORKFLOW = "post-deploy-integrity.yml";
const STEP_ID = /\b(?:R\d-[A-Z]+(?:-[A-Z]+)*|[A-Z]{2,4}-[A-Z]?\d{1,3}|[A-Z]{2,}-[A-Z]{2,}|R\d[A-Z]?)\b/g;

/**
 * The adapter implementation path. An adapter stream that reaches outside it is
 * flagged in `scan` so River reviews it like any other lane.
 */
export const adapterPath = (path) => path.startsWith("lib/sources/platform-adapters/")
  && /\.[cm]?[jt]sx?$/.test(path) && !/(?:^|\/)(?:evidence|fixtures)(?:\/|$)/.test(path);

/* -------------------------------------------------------------------------- */
/* Pure decisions                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The `key: value` lines at the top of a status file, up to its first `## `
 * section. Values are kept verbatim; a key appearing twice keeps the first.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseStatus(text) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) break;
    const match = /^([a-z][a-z_]*):[ \t]?(.*)$/.exec(line);
    if (match && !(match[1] in fields)) fields[match[1]] = match[2].trim();
  }
  return fields;
}

/**
 * The same file with `updates` written into its field block: existing lines are
 * replaced in place, new keys are added after the last field line (or after a
 * leading `# ` title). Everything else is preserved byte for byte.
 * @param {string} text
 * @param {Record<string, string>} updates
 */
export function setStatusFields(text, updates) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  let lastField = -1;
  let titleAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    if (titleAt < 0 && lastField < 0 && lines[i].startsWith("# ")) titleAt = i;
    const match = /^([a-z][a-z_]*):/.exec(lines[i]);
    if (!match) continue;
    lastField = i;
    if (pending.has(match[1])) {
      lines[i] = `${match[1]}: ${pending.get(match[1])}`;
      pending.delete(match[1]);
    }
  }
  const added = [...pending].map(([key, value]) => `${key}: ${value}`);
  if (added.length) {
    if (lastField >= 0) lines.splice(lastField + 1, 0, ...added);
    else if (titleAt >= 0) lines.splice(titleAt + 1, 0, "", ...added);
    else lines.unshift(...added, ...(lines.length ? [""] : []));
  }
  return lines.join(eol) + (lines.length && !text.length ? eol : "");
}

/**
 * The two connection proofs every READY message carries (Sean, Oct 23): the
 * work is connected end to end, and it still works on the next scheduled run.
 */
export const CONNECTION_PROOFS = Object.freeze([
  { label: "connected end to end", pattern: /\bconnect(?:ed|ion proofs?)\b|end[- ]to[- ]end|\bfeeds?\b/i },
  { label: "still working on the next scheduled run", pattern: /next (?:scheduled|configured)[- ]run|\bnext[- ](?:day|run) proof|\btomorrow proof|\bcontrolled (?:next|tomorrow)\b|following scheduled (?:run|refresh|pass)|\btomorrow(?:'s)?[- ](?:clock|run|pass|tick)\b/i },
]);

/** The connection proofs a READY commit's full message lacks, by label. */
export function missingProofs(message) {
  return CONNECTION_PROOFS.filter((proof) => !proof.pattern.test(message)).map((proof) => proof.label);
}

/** Step ids named in a `READY:` subject, in order, without repeats. */
export function stepIds(subject) {
  return [...new Set(subject.match(STEP_ID) ?? [])];
}

/** Milliseconds since an ISO heartbeat, or null when there is none to read. */
export function heartbeatAge(heartbeat, now) {
  if (!heartbeat || heartbeat === "none") return null;
  const at = Date.parse(heartbeat);
  return Number.isFinite(at) ? now - at : null;
}

/**
 * What a lane has ready that River has not integrated.
 *
 * `commits` are the stream's commits not on `river`, newest first. The newest
 * `READY:` commit is the one to fold; it carries every READY before it, back to
 * the last one River recorded. Commits after it are WIP and stay behind.
 * @param {{ commits: { sha: string, subject: string }[], integrated: Set<string> }} input
 */
export function pendingReady({ commits, integrated }) {
  const ready = [];
  for (const commit of commits) {
    if (integrated.has(commit.sha)) break;
    if (/^READY:/.test(commit.subject)) ready.push(commit);
  }
  if (!ready.length) return null;
  const latest = ready[0];
  const steps = [...new Set(ready.slice().reverse().flatMap((commit) => stepIds(commit.subject)))];
  return {
    ready_sha: latest.sha,
    steps,
    wip_after_ready: commits.findIndex((commit) => commit.sha === latest.sha),
  };
}

/**
 * The order lanes fold in. `order` is `dep`/`default`/undefined for
 * {@link LANE_ORDER}, or a comma list of lanes that go first.
 * @param {string[]} lanes
 * @param {string} [order]
 */
export function foldOrder(lanes, order) {
  const first = !order || order === "dep" || order === "default"
    ? [] : order.split(",").map((lane) => lane.trim()).filter(Boolean);
  const rank = (lane) => {
    const pinned = first.indexOf(lane);
    if (pinned >= 0) return [0, pinned, lane];
    const known = LANE_ORDER.indexOf(lane);
    if (known >= 0) return [1, known, lane];
    return [lane.startsWith("adapter-") ? 2 : 3, 0, lane];
  };
  return [...new Set(lanes)].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
  });
}

/**
 * Whether a lock change may be written, from the remote file's fields.
 * claim: refuse (3) while a different token has a heartbeat under 45 minutes,
 * or one whose age cannot be read. heartbeat: refuse (4) unless the token still
 * owns it. release: write `none` when owned; nothing to do when already free.
 * @param {{ mode: "claim" | "heartbeat" | "release", fields: Record<string, string>, token: string, now: number }} input
 * @returns {{ write: boolean, exit: number, reason: string, takeover?: string }}
 */
export function decideLock({ mode, fields, token, now }) {
  const held = fields.lock && fields.lock !== "none" ? fields.lock : null;
  const age = heartbeatAge(fields.heartbeat, now);
  const minutes = age === null ? "unknown" : `${Math.floor(age / 60000)} min`;
  if (mode === "claim") {
    if (!held || held === token) return { write: true, exit: 0, reason: held ? "already ours; heartbeat refreshed" : "lock was free" };
    if (age === null) return { write: false, exit: 3, reason: `held by ${held} with no readable heartbeat; cannot tell whether it is live` };
    if (age < STALE_LOCK_MS) return { write: false, exit: 3, reason: `held by ${held}, heartbeat ${minutes} old (live under 45 min)` };
    return { write: true, exit: 0, reason: `took over stale lock ${held} (heartbeat ${minutes} old)`, takeover: held };
  }
  if (mode === "heartbeat") {
    return held === token
      ? { write: true, exit: 0, reason: "heartbeat refreshed" }
      : { write: false, exit: 4, reason: `ownership changed: lock is ${held ?? "none"}; stop before writing` };
  }
  if (!held) return { write: false, exit: 0, reason: "lock already free" };
  return held === token
    ? { write: true, exit: 0, reason: "lock released" }
    : { write: false, exit: 4, reason: `lock is ${held}, not ours; left alone` };
}

/**
 * Whether a lane's open return on the board holds back this READY: the return
 * is still `returned` and names the same READY commit. A new READY, or a
 * cleared return, folds again.
 * @param {string | null} text `returns/<lane>.md`
 * @param {string} readySha
 */
export function returnHolds(text, readySha) {
  if (!text) return false;
  const fields = parseStatus(text);
  const named = (fields.ready ?? "").split(/\s+/).at(-1) ?? "";
  return fields.state === "returned" && /^[0-9a-f]{7,40}$/.test(named) && readySha.startsWith(named);
}

/**
 * What stops river-next's migrations from shipping as they are: a migration
 * this fold added that is still named by step, a journal entry out of sequence
 * or out of time order, or a journal entry and a file that do not name each
 * other. Step-named migrations river already shipped keep their names.
 * @param {{ files: string[], added: string[], journal: { idx: number, when: number, tag: string }[] }} input
 */
export function migrationProblems({ files, added, journal }) {
  const problems = [];
  const sql = files.filter((name) => name.endsWith(".sql"));
  for (const name of added.filter((file) => isStepNamed(file) && sql.includes(file))) problems.push(`${name} is still named by step; run migrations`);
  const tags = new Set(journal.map((entry) => entry.tag));
  journal.forEach((entry, i) => {
    if (entry.idx !== i) problems.push(`journal entry ${entry.tag} has idx ${entry.idx}, expected ${i}`);
    if (i > 0 && !(entry.when > journal[i - 1].when)) problems.push(`journal entry ${entry.tag} is not later than ${journal[i - 1].tag}`);
    if (!sql.includes(`${entry.tag}.sql`)) problems.push(`journal entry ${entry.tag} has no ${entry.tag}.sql`);
  });
  for (const name of sql) {
    if (!tags.has(name.slice(0, -4))) problems.push(`${name} has no journal entry`);
  }
  return problems;
}

/** A job that ran and failed. A cancelled job is left out: it is a run a newer one replaced. */
const RED = new Set(["failure", "timed_out", "action_required", "startup_failure", "stale"]);

/**
 * GitHub CI's verdict on a release head, from its check runs. Only the newest
 * run of each name counts (a newer workflow run replaces an older one). The
 * verdict waits until every required check has finished, then passes only when
 * each one succeeded (a cancelled or skipped required check is not a pass).
 * Every failed job is named so its log can be read.
 * @param {{ id: number, name: string, status: string, conclusion: string | null }[]} runs
 * @param {readonly string[]} [required]
 * @returns {{ state: "pending" | "pass" | "fail", waiting: string[], failed: { id: number, name: string, conclusion: string | null }[] }}
 */
export function decideCi(runs, required = REQUIRED_CONTEXTS) {
  const latest = new Map();
  for (const run of runs) if (!latest.has(run.name) || latest.get(run.name).id < run.id) latest.set(run.name, run);
  const failed = [...latest.values()]
    .filter((run) => run.status === "completed" && RED.has(run.conclusion ?? ""))
    .map((run) => ({ id: run.id, name: run.name, conclusion: run.conclusion }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const waiting = required.filter((name) => latest.get(name)?.status !== "completed");
  if (waiting.length) return { state: "pending", waiting, failed };
  return { state: required.every((name) => latest.get(name).conclusion === "success") ? "pass" : "fail", waiting, failed };
}

const FAILING_AT = /^\s*test at (?:.*\/)?((?:tests|lib\/sources\/platform-adapters)\/.+?\.test\.tsx?):\d+:\d+\s*$/;

/**
 * The failing tests a CI job log names, from the spec reporter's
 * `✖ failing tests:` list (`test at <file>:<line>:<col>`, then `✖ <name>`).
 * GitHub's timestamp prefixes and absolute checkout paths are dropped.
 * @param {string} log
 * @returns {{ file: string, name: string }[]}
 */
export function failingTests(log) {
  const lines = log.replace(/\r\n/g, "\n").split("\n").map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, ""));
  const found = new Map();
  lines.forEach((line, i) => {
    const file = FAILING_AT.exec(line)?.[1];
    if (!file) return;
    const named = lines.slice(i + 1, i + 4).find((next) => /^\s*✖ /.test(next));
    const name = named ? named.trim().replace(/^✖ /, "").replace(/ \([\d.]+m?s\)$/, "") : file;
    found.set(`${file}\0${name}`, { file, name });
  });
  return [...found.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.name < b.name ? -1 : 1));
}

/**
 * Which folded lane caused each failing test file. A lane that changed the
 * test file itself is its cause; otherwise every lane whose change reaches the
 * test is a suspect (`reaches` gives the test files a lane's change reaches, or
 * "all"). A test with exactly one suspect returns that lane. A test with none
 * (it fails on river's own code) or several is left for River to judge.
 * @param {{ tests: string[], lanes: { lane: string, changed: string[] }[], reaches: (lane: { lane: string, changed: string[] }) => Set<string> | "all" }} input
 */
export function blameLanes({ tests, lanes, reaches }) {
  const reached = new Map();
  const reach = (lane) => {
    if (!reached.has(lane.lane)) reached.set(lane.lane, reaches(lane));
    const set = reached.get(lane.lane);
    return set === "all" ? () => true : (file) => set.has(file);
  };
  const byTest = [...new Set(tests)].map((file) => {
    const direct = lanes.filter((lane) => lane.changed.includes(file));
    const suspects = (direct.length ? direct : lanes.filter((lane) => reach(lane)(file))).map((lane) => lane.lane);
    return { file, suspects };
  });
  return {
    byTest,
    returned: [...new Set(byTest.filter((entry) => entry.suspects.length === 1).map((entry) => entry.suspects[0]))],
    unresolved: byTest.filter((entry) => entry.suspects.length !== 1),
  };
}

const ACTIVE_RUN = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/**
 * Reuse a post-deploy run for exactly this SHA, or say what to do instead.
 * The workflow's concurrency group cancels an older run when a newer one starts,
 * so a cancelled run covers nothing. A run that finished red is retried, not
 * duplicated.
 * @typedef {{ id: number, head_sha: string, status: string, conclusion: string | null, html_url?: string }} WorkflowRun
 * @param {WorkflowRun[]} runs
 * @param {string} sha
 * @returns {{ action: "reuse" | "rerun" | "dispatch", run?: WorkflowRun, reason: string }}
 */
export function decideObserve(runs, sha) {
  const mine = runs.filter((run) => run.head_sha === sha).sort((a, b) => b.id - a.id);
  const active = mine.find((run) => ACTIVE_RUN.has(run.status));
  if (active) return { action: "reuse", run: active, reason: `run ${active.id} is ${active.status}` };
  const passed = mine.find((run) => run.status === "completed" && run.conclusion === "success");
  if (passed) return { action: "reuse", run: passed, reason: `run ${passed.id} succeeded` };
  const failed = mine.find((run) => run.status === "completed" && ["failure", "timed_out"].includes(run.conclusion ?? ""));
  if (failed) return { action: "rerun", run: failed, reason: `run ${failed.id} finished ${failed.conclusion}; retry its failed jobs` };
  return { action: "dispatch", reason: mine.length ? `only cancelled or skipped runs cover ${sha}` : `no run covers ${sha}` };
}

/* -------------------------------------------------------------------------- */
/* Migrations                                                                 */
/* -------------------------------------------------------------------------- */

const NUMBERED = /^\d{4}_[a-z0-9_]+\.sql$/;

/** A migration file named by step rather than number, e.g. `DB-09_place_owed.sql`. */
export const isStepNamed = (name) => name.endsWith(".sql") && !/^\d{4}_/.test(name);

/** `DB-09_place_owed` → `db09_place_owed`: the step id stays readable in the tag. */
export function slugOf(tag) {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .replace(/^([a-z]{2,4})_(\d)/, "$1$2");
}

/**
 * Number step-named migrations after the journal's last entry, in the order
 * given (fold order). Returns the renames and the new journal entries, or the
 * reasons it cannot be done safely.
 *
 * Matches the repository's journal: version "7", `breakpoints: true`, `idx` in
 * sequence, `when` strictly increasing (it is the key `db:apply` joins on). A
 * stream that already wrote a journal entry for its step-named tag keeps its
 * `when` when that still sorts last; otherwise the next millisecond is used.
 * @param {{ added: string[], journal: { idx: number, version: string, when: number, tag: string, breakpoints: boolean }[], baseCount: number }} input
 */
export function planMigrationNumbers({ added, journal, baseCount }) {
  const problems = [];
  const stepNamed = added.filter(isStepNamed);
  const numberedAdds = added.filter((name) => !isStepNamed(name));
  for (const name of numberedAdds) {
    const number = Number(name.slice(0, 4));
    if (!NUMBERED.test(name)) problems.push(`${name} is not named NNNN_lowercase.sql`);
    else if (number < baseCount) problems.push(`${name} reuses a number river already has (${baseCount} migrations); rename it to a step id`);
  }
  const numbers = numberedAdds.map((name) => name.slice(0, 4));
  for (const number of new Set(numbers)) {
    if (numbers.filter((n) => n === number).length > 1) problems.push(`two streams added migration ${number}`);
  }
  const stepTags = new Set(stepNamed.map((name) => name.slice(0, -4)));
  const kept = journal.filter((entry) => !stepTags.has(entry.tag));
  const byTag = new Map(journal.map((entry) => [entry.tag, entry]));
  kept.forEach((entry, i) => {
    if (entry.idx !== i) problems.push(`journal entry ${entry.tag} has idx ${entry.idx}, expected ${i}`);
  });
  if (problems.length) return { ok: false, problems, renames: [], journal };

  const entries = kept.map((entry) => ({ ...entry }));
  const renames = [];
  for (const name of stepNamed) {
    const oldTag = name.slice(0, -4);
    const idx = entries.length;
    const tag = `${String(idx).padStart(4, "0")}_${slugOf(oldTag)}`;
    const lastWhen = entries.length ? entries[entries.length - 1].when : 0;
    const own = byTag.get(oldTag)?.when;
    const when = typeof own === "number" && own > lastWhen ? own : lastWhen + 1;
    entries.push({ idx, version: "7", when, tag, breakpoints: true });
    renames.push({ from: name, to: `${tag}.sql`, oldTag, tag, idx, when });
  }
  return { ok: true, problems, renames, journal: entries };
}

/* -------------------------------------------------------------------------- */
/* Git and GitHub                                                             */
/* -------------------------------------------------------------------------- */

const ROOT = process.cwd();
const SCRATCH = join(ROOT, ".scratch", "river");

class Refusal extends Error {
  constructor(message, exit = 1) {
    super(message);
    this.exit = exit;
  }
}

function git(args, { env, input, allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT, encoding: "utf8", input, env: env ? { ...process.env, ...env } : process.env,
      maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    }).trim();
  } catch (error) {
    if (allowFail) return null;
    const detail = `${error.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ");
    throw new Error(`git ${args.join(" ")} failed: ${detail || error.message}`);
  }
}

const ok = (args) => git(args, { allowFail: true }) !== null;

/** Run git and keep what it printed either way, for a return record. */
function gitTry(args) {
  const run = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() };
}
const remoteRef = (branch) => `refs/remotes/origin/${branch}`;

/** Fetch branches into explicit remote-tracking refs. Missing branches are skipped. */
function fetchBranches(branches) {
  const listed = git(["ls-remote", "--heads", "origin", ...branches.map((b) => `refs/heads/${b}`)]);
  const present = new Set(listed.split("\n").filter(Boolean).map((line) => line.split("\t")[1].replace("refs/heads/", "")));
  const specs = branches.filter((b) => present.has(b)).map((b) => `+refs/heads/${b}:${remoteRef(b)}`);
  if (specs.length) git(["fetch", "--quiet", "--no-tags", "origin", ...specs]);
  return present;
}

function streamBranches() {
  const listed = git(["ls-remote", "--heads", "origin", "refs/heads/stream/*"]);
  return listed.split("\n").filter(Boolean).map((line) => line.split("\t")[1].replace("refs/heads/", "")).sort();
}

function readAt(ref, path) {
  return git(["show", `${ref}:${path}`], { allowFail: true });
}

function readJson(ref, path, fallback) {
  const text = readAt(ref, path);
  return text === null ? fallback : JSON.parse(text);
}

/**
 * Commit `change(tip)`'s files onto a remote branch without touching the
 * checkout, and push by fast-forward. On rejection, refetch and call `change`
 * again with the new tip. `change` returns null to stop without writing.
 * @param {string} branch
 * @param {(tip: string) => ({ files: Record<string, string>, message: string } | null)} change
 */
function commitToBranch(branch, change, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    fetchBranches([branch]);
    const tip = git(["rev-parse", "--verify", remoteRef(branch)]);
    const next = change(tip);
    if (!next) return null;
    const index = join(tmpdir(), `river-index-${process.pid}-${attempt}`);
    try {
      const env = { GIT_INDEX_FILE: index };
      git(["read-tree", tip], { env });
      for (const [path, content] of Object.entries(next.files)) {
        const blob = git(["hash-object", "-w", "--stdin"], { input: content });
        git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
      }
      const tree = git(["write-tree"], { env });
      const commit = git(["commit-tree", tree, "-p", tip, "-m", next.message]);
      if (ok(["push", "--quiet", "origin", `${commit}:refs/heads/${branch}`])) return commit;
      console.error(`river: push to ${branch} was rejected (attempt ${attempt}); refetching`);
    } finally {
      rmSync(index, { force: true });
    }
  }
  throw new Refusal(`could not push to ${branch} after ${attempts} attempts`);
}

function repoSlug() {
  if (process.env.GH_REPOSITORY) return process.env.GH_REPOSITORY;
  const url = git(["remote", "get-url", "origin"]);
  const match = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url) ?? /\/git\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!match) throw new Refusal(`cannot tell the GitHub repository from origin ${url}; set GH_REPOSITORY`);
  return match[1];
}

/**
 * One GitHub REST/GraphQL request. Returns `{ ok, status, body }`, or
 * `{ ok: false, status: 0 }` with no token so the caller can print it instead.
 */
async function github(method, path, body) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return { ok: false, status: 0, body: "no GITHUB_TOKEN or GH_TOKEN" };
  try {
    const response = await fetch(`https://api.github.com/${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    return { ok: false, status: 0, body: error?.message ?? String(error) };
  }
}

/** Print a request the session must make itself. */
function actionNeeded(what, method, path, body, why) {
  console.log(`ACTION NEEDED: ${what}`);
  if (why) console.log(`  because: ${why}`);
  console.log(`  ${method} https://api.github.com/${path}`);
  if (body !== undefined) console.log(`  body: ${JSON.stringify(body)}`);
}

function writeScratch(name, value) {
  mkdirSync(SCRATCH, { recursive: true });
  writeFileSync(join(SCRATCH, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readScratch(name) {
  const file = join(SCRATCH, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

function requireClean() {
  if (git(["status", "--porcelain", "--untracked-files=no"])) {
    throw new Refusal("the working tree has uncommitted changes; commit or set them aside first");
  }
}

const short = (sha) => sha.slice(0, 12);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/* -------------------------------------------------------------------------- */
/* scan                                                                       */
/* -------------------------------------------------------------------------- */

function integratedShas(integration) {
  const byLane = new Map();
  for (const entry of integration) {
    if (!byLane.has(entry.lane)) byLane.set(entry.lane, new Set());
    byLane.get(entry.lane).add(entry.ready_sha);
  }
  return byLane;
}

export function scan({ now = Date.now() } = {}) {
  const streams = streamBranches();
  fetchBranches([RIVER, BOARD, ...streams]);
  const river = git(["rev-parse", "--verify", remoteRef(RIVER)]);
  const integration = readJson(remoteRef(BOARD), "integration.json", []);
  const integrated = integratedShas(integration);
  const lanes = [];
  for (const branch of streams) {
    const lane = branch.slice("stream/".length);
    const tip = git(["rev-parse", "--verify", remoteRef(branch)]);
    const log = git(["log", "--format=%H%x09%s", `${remoteRef(RIVER)}..${tip}`]);
    const commits = log.split("\n").filter(Boolean).map((line) => {
      const [sha, ...subject] = line.split("\t");
      return { sha, subject: subject.join("\t") };
    });
    const status = parseStatus(readAt(tip, `.factory/${lane}.md`) ?? "");
    const age = heartbeatAge(status.heartbeat, now);
    const locked = Boolean(status.lock && status.lock !== "none");
    const pending = pendingReady({ commits, integrated: integrated.get(lane) ?? new Set() });
    if (pending) pending.missing_proofs = missingProofs(git(["log", "-1", "--format=%B", pending.ready_sha]));
    const entry = {
      lane,
      branch,
      tip,
      ahead_of_river: commits.length,
      ready: pending,
      status: {
        build_state: status.build_state ?? null,
        worker: status.worker ?? null,
        provider: status.provider ?? null,
        run_id: status.run_id ?? null,
        lock: status.lock ?? null,
        heartbeat: status.heartbeat ?? null,
        ready: status.ready ?? null,
      },
      heartbeat_age_min: age === null ? null : Math.floor(age / 60000),
      stale_lock: locked && (age === null || age >= STALE_LOCK_MS),
    };
    if (lane.startsWith("adapter-") && pending) {
      // `READY: adapter <kind>` names no plan step; the stream itself is the
      // step, so a release carrying only an adapter repair still has contents.
      if (!pending.steps.length) pending.steps = [lane];
      const files = git(["diff", "--name-only", "--no-renames", `${river}...${pending.ready_sha}`]).split("\n").filter(Boolean)
        .filter((path) => !path.startsWith(".factory/"));
      entry.outside_adapter_path = files.filter((path) => !adapterPath(path));
    }
    lanes.push(entry);
  }
  const ordered = foldOrder(lanes.map((lane) => lane.lane));
  lanes.sort((a, b) => ordered.indexOf(a.lane) - ordered.indexOf(b.lane));
  return {
    river,
    board: git(["rev-parse", "--verify", remoteRef(BOARD)], { allowFail: true }),
    scanned_at: new Date(now).toISOString(),
    ready_lanes: lanes.filter((lane) => lane.ready).map((lane) => lane.lane),
    lanes,
  };
}

/* -------------------------------------------------------------------------- */
/* fold                                                                       */
/* -------------------------------------------------------------------------- */

async function fold(flags) {
  requireClean();
  const plan = scan();
  const wanted = flags.lanes ? new Set(flags.lanes.split(",").map((lane) => lane.trim())) : null;
  const offered = plan.lanes.filter((lane) => lane.ready && (!wanted || wanted.has(lane.lane)));
  if (wanted) {
    for (const lane of wanted) {
      if (!plan.lanes.some((entry) => entry.lane === lane)) throw new Refusal(`no stream/${lane} on origin`);
    }
  }
  const refused = offered.filter((lane) => lane.ready.missing_proofs.length);
  for (const lane of refused) {
    const { ready_sha: sha, steps, missing_proofs: missing } = lane.ready;
    const output = `READY ${short(sha)} refused: its message lacks ${missing.map((label) => `"${label}"`).join(" and ")}. `
      + "Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.";
    console.log(`river fold: REFUSED ${lane.lane} ${short(sha)}: lacks ${missing.join("; ")}`);
    await recordReturn({ lane: lane.lane, check: "connection proofs", output, readySha: sha, steps, riverSha: plan.river });
  }
  // A READY River already returned stays out until its lane posts a new one.
  const held = offered.filter((lane) => !refused.includes(lane) && !wanted?.has(lane.lane)
    && returnHolds(readAt(remoteRef(BOARD), `returns/${lane.lane}.md`), lane.ready.ready_sha));
  for (const lane of held) console.log(`river fold: HELD ${lane.lane} ${short(lane.ready.ready_sha)}: returns/${lane.lane}.md is open for this READY`);
  const ready = offered.filter((lane) => !refused.includes(lane) && !held.includes(lane));
  const order = foldOrder(ready.map((lane) => lane.lane), flags.order);
  const record = {
    base_river_sha: plan.river, folded_at: nowIso(), order, lanes: [], head: plan.river, conflict: null, main_sha: null,
    refused: refused.map((lane) => ({ lane: lane.lane, ready_sha: lane.ready.ready_sha, missing: lane.ready.missing_proofs })),
    held: held.map((lane) => ({ lane: lane.lane, ready_sha: lane.ready.ready_sha })),
  };
  if (!order.length) {
    writeScratch("fold.json", record);
    console.log("river fold: nothing ready to fold; river-next not created.");
    return;
  }
  git(["checkout", "--quiet", "-B", NEXT, plan.river]);
  for (const name of order) {
    const lane = ready.find((entry) => entry.lane === name);
    const { ready_sha: sha, steps } = lane.ready;
    const message = `River: fold ${name} READY ${short(sha)} (${steps.join(", ") || "no step ids"})`;
    let merged = gitTry(["merge", "--no-ff", "--no-edit", "-m", message, sha]);
    if (!merged.ok) {
      // A lane's own status file conflicts with river's deletion of it on every
      // fold after the first (modify/delete). That is not an application
      // conflict: drop .factory and finish the merge if nothing else is unmerged.
      git(["rm", "-r", "-q", "-f", "--ignore-unmatch", ".factory"], { allowFail: true });
      rmSync(join(ROOT, ".factory"), { recursive: true, force: true });
      const unmerged = git(["diff", "--name-only", "--diff-filter=U"], { allowFail: true });
      if (!unmerged) merged = gitTry(["commit", "--quiet", "--no-edit", "--no-verify"]);
    }
    if (!merged.ok) {
      git(["merge", "--abort"], { allowFail: true });
      record.conflict = { lane: name, ready_sha: sha, steps };
      record.head = git(["rev-parse", "HEAD"]);
      writeScratch("fold.json", record);
      // The runner's adapter engineer cannot read a session's terminal: its
      // stream's failure goes back to it, and to the fix list, as a record.
      if (name.startsWith("adapter-")) {
        await recordReturn({ lane: name, check: "fold", output: merged.output, readySha: sha, steps, riverSha: plan.river });
      }
      throw new Refusal(`fold stopped: ${name} (${short(sha)}) conflicts with river-next; merge aborted at ${short(record.head)}. Return it to ${name} or resolve by hand.`);
    }
    // Coordination files never reach the application tree: drop them from the merge itself.
    git(["rm", "-r", "-q", "--cached", "--ignore-unmatch", ".factory"]);
    rmSync(join(ROOT, ".factory"), { recursive: true, force: true });
    if (!ok(["diff", "--cached", "--quiet"])) {
      git(["commit", "--quiet", "--amend", "--no-edit", "--no-verify"]);
    }
    const result = git(["rev-parse", "HEAD"]);
    record.lanes.push({ lane: name, steps, ready_sha: sha, result_sha: result });
    console.log(`river fold: ${name} ${short(sha)} → ${short(result)} (${steps.join(", ")})`);
  }
  // The release head carries main, so the pull request is up to date with its
  // base and the commit CI tests is the commit river moves to.
  if (fetchBranches(["main"]).has("main")) {
    const main = git(["rev-parse", "--verify", remoteRef("main")]);
    if (!ok(["merge-base", "--is-ancestor", main, "HEAD"])) {
      const merged = gitTry(["merge", "--no-ff", "--no-edit", "-m", `River: merge main ${short(main)} into river-next`, main]);
      if (!merged.ok) {
        git(["merge", "--abort"], { allowFail: true });
        record.conflict = { lane: "main", ready_sha: main, steps: [] };
        record.head = git(["rev-parse", "HEAD"]);
        writeScratch("fold.json", record);
        throw new Refusal(`fold stopped: main ${short(main)} conflicts with river-next; merge aborted at ${short(record.head)}. Resolve by hand.`);
      }
      record.main_sha = main;
      console.log(`river fold: merged main ${short(main)}`);
    }
  }
  record.head = git(["rev-parse", "HEAD"]);
  writeScratch("fold.json", record);
  console.log(`river fold: river-next ${short(record.head)} from river ${short(plan.river)}; next: migrations, then release <n>`);
}

/* -------------------------------------------------------------------------- */
/* migrations                                                                 */
/* -------------------------------------------------------------------------- */

function migrations() {
  requireClean();
  const folded = readScratch("fold.json");
  if (!folded?.lanes?.length) throw new Refusal("no fold.json with folded lanes; run fold first");
  if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== NEXT) throw new Refusal(`check out ${NEXT} first`);
  const base = folded.base_river_sha;
  const added = [];
  for (const lane of folded.lanes) {
    const names = git(["diff", "--name-only", "--no-renames", "--diff-filter=A", `${base}...${lane.ready_sha}`, "--", `${MIGRATIONS_DIR}/*.sql`])
      .split("\n").filter(Boolean).map((path) => posix.basename(path)).sort();
    // A file an earlier run already renamed is no longer on disk under this name.
    for (const name of names) if (!added.includes(name) && existsSync(join(ROOT, MIGRATIONS_DIR, name))) added.push(name);
  }
  const journal = JSON.parse(readFileSync(join(ROOT, JOURNAL), "utf8"));
  const baseJournal = JSON.parse(readAt(base, JOURNAL) ?? '{"entries":[]}');
  const plan = planMigrationNumbers({ added, journal: journal.entries, baseCount: baseJournal.entries.length });
  if (!plan.ok) {
    console.error("river migrations: cannot number safely. Resolve by hand on river-next:");
    for (const problem of plan.problems) console.error(`  - ${problem}`);
    throw new Refusal("migration numbering refused");
  }
  if (!plan.renames.length) {
    console.log(`river migrations: no step-named migrations among ${added.length} added; nothing to number.`);
    return;
  }
  for (const rename of plan.renames) {
    git(["mv", `${MIGRATIONS_DIR}/${rename.from}`, `${MIGRATIONS_DIR}/${rename.to}`]);
    const snapshot = `${MIGRATIONS_DIR}/meta/${rename.oldTag}_snapshot.json`;
    if (existsSync(join(ROOT, snapshot))) git(["mv", snapshot, `${MIGRATIONS_DIR}/meta/${String(rename.idx).padStart(4, "0")}_snapshot.json`]);
    // Every other place that names the old tag (the phase declaration, tests) follows it.
    const naming = git(["grep", "-l", "-F", rename.oldTag], { allowFail: true });
    for (const path of (naming ?? "").split("\n").filter(Boolean)) {
      if (path === JOURNAL) continue;
      const text = readFileSync(join(ROOT, path), "utf8");
      writeFileSync(join(ROOT, path), text.split(rename.oldTag).join(rename.tag), "utf8");
      git(["add", path]);
    }
    console.log(`river migrations: ${rename.from} → ${rename.to} (when ${rename.when})`);
  }
  const eol = readFileSync(join(ROOT, JOURNAL), "utf8").includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(join(ROOT, JOURNAL), `${JSON.stringify({ ...journal, entries: plan.journal }, null, 2)}\n`.replace(/\n/g, eol), "utf8");
  git(["add", JOURNAL]);
  git(["commit", "--quiet", "--no-verify", "-m", `River: number migrations ${plan.renames.map((r) => r.to.slice(0, 4)).join(", ")}\n\n${plan.renames.map((r) => `${r.from} -> ${r.to}`).join("\n")}`]);
  console.log(`river migrations: committed ${short(git(["rev-parse", "HEAD"]))}; run release <n> next.`);
}

/* -------------------------------------------------------------------------- */
/* lock                                                                       */
/* -------------------------------------------------------------------------- */

/** Apply one lock decision to `<branch>:<file>`. Returns the decision. */
export function lock(mode, { branch, file, token, worker, runId }) {
  if (!branch || !file || !token) throw new Refusal("lock needs --branch, --file and --token", 2);
  let decision = null;
  commitToBranch(branch, (tip) => {
    const text = readAt(tip, file);
    if (text === null) throw new Refusal(`${branch}:${file} does not exist`);
    decision = decideLock({ mode, fields: parseStatus(text), token, now: Date.now() });
    if (!decision.write) return null;
    const updates = mode === "release"
      ? { lock: "none", heartbeat: nowIso() }
      : { lock: token, heartbeat: nowIso(), ...(worker ? { worker } : {}), ...(runId ? { run_id: runId } : {}) };
    return { files: { [file]: setStatusFields(text, updates) }, message: `${file}: lock ${mode} (${decision.reason})` };
  });
  console.log(`river lock ${mode}: ${decision.reason}`);
  if (decision.exit) throw new Refusal(`lock ${mode} refused: ${decision.reason}`, decision.exit);
  return decision;
}

/* -------------------------------------------------------------------------- */
/* check                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The quick check on river-next before it is released: the fold finished and
 * river-next carries river, every folded lane and main; the migrations are
 * numbered; `pnpm lint` and the type check pass. No suite and no build: GitHub
 * CI on the release pull request is the one full test.
 * @param {{ commands?: boolean }} [options] false checks the fold and migrations only
 */
function quickCheck({ commands = true } = {}) {
  requireClean();
  if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== NEXT) throw new Refusal(`check out ${NEXT} first`);
  const folded = readScratch("fold.json");
  if (!folded?.lanes?.length) throw new Refusal("no fold.json with folded lanes; run fold first");
  if (folded.conflict) throw new Refusal(`the fold stopped on ${folded.conflict.lane}; fold again first`);
  const head = git(["rev-parse", "HEAD"]);
  for (const sha of [folded.base_river_sha, ...folded.lanes.map((lane) => lane.result_sha)]) {
    if (!ok(["merge-base", "--is-ancestor", sha, head])) throw new Refusal(`river-next ${short(head)} does not carry ${short(sha)} from the fold; fold again`);
  }
  if (fetchBranches(["main"]).has("main")) {
    const main = git(["rev-parse", "--verify", remoteRef("main")]);
    if (!ok(["merge-base", "--is-ancestor", main, head])) throw new Refusal(`main moved since the fold (${short(main)} is not in river-next); fold again`);
  }
  const dir = join(ROOT, MIGRATIONS_DIR);
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const journal = existsSync(join(ROOT, JOURNAL)) ? JSON.parse(readFileSync(join(ROOT, JOURNAL), "utf8")).entries : [];
  const added = git(["diff", "--name-only", "--no-renames", "--diff-filter=A", `${folded.base_river_sha}...${head}`, "--", `${MIGRATIONS_DIR}/*.sql`])
    .split("\n").filter(Boolean).map((path) => posix.basename(path));
  const problems = migrationProblems({ files, added, journal });
  if (problems.length) {
    for (const problem of problems) console.error(`  - ${problem}`);
    throw new Refusal("river-next's migrations are not ready to ship");
  }
  if (commands) {
    const [command, prefix] = whichPnpm() ? ["pnpm", []] : ["corepack", ["pnpm"]];
    // A stale .next feeds tsc route types that may no longer exist, and a warm
    // incremental build can skip a just-written file; CI checks types on a fresh checkout.
    rmSync(join(ROOT, ".next"), { recursive: true, force: true });
    rmSync(join(ROOT, "tsconfig.tsbuildinfo"), { force: true });
    const env = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=8192" };
    for (const check of QUICK_CHECKS) {
      console.log(`river check: ${command} ${[...prefix, ...check.args].join(" ")} on ${short(head)}`);
      const run = spawnSync(command, [...prefix, ...check.args], { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
      if (run.status !== 0) throw new Refusal(`${check.id} failed on river-next ${short(head)}; fix it in the fold or return the lane that broke it`);
    }
  }
  console.log(`river check: river-next ${short(head)} folds clean with numbered migrations${commands ? "; lint and types pass" : ""}`);
  return { folded, head };
}

function whichPnpm() {
  try {
    execFileSync("pnpm", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* return                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Send a stream's failed check back to the lane that wrote it: print the
 * record, keep it in `.scratch/river/`, and write `returns/<lane>.md` on
 * `board/river`. The record carries the fix-list entry shape from
 * `lib/control-plane/river-returns.ts`.
 */
async function recordReturn({ lane, check, output, readySha = null, steps = [], riverSha = null }) {
  const { riverReturn, riverReturnMarkdown } = await import("../lib/control-plane/river-returns.ts");
  const record = riverReturn({ lane, check, output, readySha, steps, riverSha, at: nowIso() });
  console.log(`RETURN: ${lane} failed ${check}; owner ${record.owner} (${record.writer})`);
  console.log(`  fix list: ${record.fix.consequenceShown} [${record.fix.subjectId}]`);
  console.log(JSON.stringify({ return: record }, null, 2));
  writeScratch(`return-${lane}.json`, record);
  if (!fetchBranches([BOARD]).has(BOARD)) {
    console.log(`ACTION NEEDED: ${BOARD} does not exist on origin; returns/${lane}.md was not written (record kept in .scratch/river/return-${lane}.json)`);
    return record;
  }
  commitToBranch(BOARD, (tip) => {
    const markdown = riverReturnMarkdown(record);
    if (readAt(tip, `returns/${lane}.md`) === markdown.trimEnd()) return null;
    return { files: { [`returns/${lane}.md`]: markdown }, message: `returns: ${lane} failed ${check}${readySha ? ` at ${short(readySha)}` : ""}` };
  });
  console.log(`river return: wrote returns/${lane}.md on ${BOARD}`);
  return record;
}

async function returnCommand(lane, flags) {
  if (!lane || !/^[a-z0-9][a-z0-9-]*$/.test(lane) || !flags.check || typeof flags.check !== "string") {
    throw new Refusal("usage: river.mjs return <lane> --check <name> [--output-file F | --output TEXT] [--sha READY_SHA]", 2);
  }
  const output = typeof flags["output-file"] === "string" ? readFileSync(resolve(ROOT, flags["output-file"]), "utf8")
    : typeof flags.output === "string" ? flags.output : "";
  const folded = readScratch("fold.json");
  const known = [...(folded?.lanes ?? []), ...(folded?.conflict ? [folded.conflict] : [])].find((entry) => entry.lane === lane);
  await recordReturn({
    lane, check: flags.check, output,
    readySha: typeof flags.sha === "string" ? flags.sha : known?.ready_sha ?? null,
    steps: known?.steps ?? [], riverSha: folded?.base_river_sha ?? null,
  });
}

/* -------------------------------------------------------------------------- */
/* release                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Open release/<n> from river-next after the quick check: push the branch,
 * open the pull request into main, put `run-full-ci` on it at once and turn
 * auto-merge on, so its first CI run is the full test. Record it on the board
 * for `settle`.
 */
async function release(n, flags) {
  if (!/^\d+$/.test(n ?? "")) throw new Refusal("usage: river.mjs release <n> [--dry-run]", 2);
  const { folded, head } = quickCheck({ commands: !flags["dry-run"] });
  fetchBranches([BOARD]);
  const existing = readJson(remoteRef(BOARD), `releases/${n}.json`, null);
  if (existing && existing.head_sha !== head) throw new Refusal(`release ${n} is already recorded at ${short(existing.head_sha ?? existing.river_sha ?? "unknown")}`);
  const steps = [...new Set(folded.lanes.flatMap((lane) => lane.steps))];
  const lanes = folded.lanes.map((lane) => lane.lane);
  if (!steps.length) throw new Refusal("the fold carries no step ids; no release PR");

  const repo = repoSlug();
  const branch = `release/${n}`;
  const title = `Release ${n}: ${steps.length} step${steps.length === 1 ? "" : "s"} from river`;
  const body = [
    `River release ${n}: river-next \`${head}\`, river \`${folded.base_river_sha}\` with these READY commits folded${folded.main_sha ? " and main merged in" : ""}.`,
    "",
    `Lanes: ${lanes.join(", ")}`,
    "",
    "Steps:",
    ...steps.map((step) => `- ${step}`),
    "",
    `GitHub CI on this pull request is the full test of this exact commit (\`${FULL_CI_LABEL}\`, auto-merge). River moves \`river\` here only after it passes.`,
    "",
    "Built by `scripts/river.mjs release`. Data never rides the river; this carries code only.",
  ].join("\n");

  // Never two competing release candidates.
  const open = await github("GET", `repos/${repo}/pulls?state=open&base=main&per_page=100`);
  if (open.ok) {
    const rival = open.body.find((pr) => pr.head.ref.startsWith("release/") && pr.head.ref !== branch);
    if (rival) throw new Refusal(`#${rival.number} from ${rival.head.ref} is still open; settle or close it before release ${n}`);
  }
  if (flags["dry-run"]) {
    console.log(JSON.stringify({ branch, head, title, body, steps, label: FULL_CI_LABEL }, null, 2));
    return;
  }

  const remote = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split("\t")[0];
  if (remote && remote !== head) throw new Refusal(`${branch} already exists at ${short(remote)}`);
  if (!remote && !ok(["push", "--quiet", "origin", `${head}:refs/heads/${branch}`])) throw new Refusal(`could not push ${branch}`);

  const create = { title, head: branch, base: "main", body };
  const labels = { labels: [FULL_CI_LABEL] };
  const autoMerge = "mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) { clientMutationId } }";
  let pr = null;
  if (open.ok) {
    const mine = open.body.find((candidate) => candidate.head.ref === branch);
    const made = mine ? { ok: true, body: mine } : await github("POST", `repos/${repo}/pulls`, create);
    if (made.ok) pr = made.body;
    else actionNeeded("create the release PR", "POST", `repos/${repo}/pulls`, create, `${made.status}: ${made.body?.message ?? made.body}`);
  } else {
    actionNeeded(`confirm no other release/* PR is open into main, then create the release PR`, "POST", `repos/${repo}/pulls`, create,
      `listing open PRs failed (${open.status}: ${typeof open.body === "string" ? open.body : open.body?.message})`);
  }
  if (!pr) {
    actionNeeded(`right after creating it, label the new PR ${FULL_CI_LABEL} (without it the first CI run waits and skips the tests)`, "POST", `repos/${repo}/issues/<new PR number>/labels`, labels);
    actionNeeded("then enable auto-merge (merge commit) on it", "POST", "graphql", { query: autoMerge, variables: { id: "<new PR node_id>" } });
  } else {
    console.log(`river release: PR #${pr.number} ${pr.html_url}`);
    const labelled = await github("POST", `repos/${repo}/issues/${pr.number}/labels`, labels);
    if (labelled.ok) console.log(`river release: ${FULL_CI_LABEL} on #${pr.number}`);
    else actionNeeded(`label #${pr.number} ${FULL_CI_LABEL} now`, "POST", `repos/${repo}/issues/${pr.number}/labels`, labels, `${labelled.status}: ${labelled.body?.message ?? labelled.body}`);
    const auto = await github("POST", "graphql", { query: autoMerge, variables: { id: pr.node_id } });
    if (!auto.ok || auto.body?.errors) {
      actionNeeded(`enable auto-merge (merge commit) on #${pr.number}`, "POST", "graphql", { query: autoMerge, variables: { id: pr.node_id } },
        `${auto.status}: ${JSON.stringify(auto.body?.errors ?? auto.body)}`);
    } else {
      console.log(`river release: auto-merge enabled on #${pr.number}`);
    }
  }

  commitToBranch(BOARD, (tip) => {
    const old = readJson(tip, `releases/${n}.json`, null);
    if (old && old.pr && !pr) return null;
    const record = {
      n: Number(n), branch, head_sha: head, base_river_sha: folded.base_river_sha, main_sha: folded.main_sha ?? null,
      lanes: folded.lanes.map((lane) => ({ lane: lane.lane, steps: lane.steps, ready_sha: lane.ready_sha, result_sha: lane.result_sha })),
      steps, pr: pr ? { number: pr.number, url: pr.html_url } : old?.pr ?? null, ci: "running", at: nowIso(),
    };
    return { files: { [`releases/${n}.json`]: `${JSON.stringify(record, null, 2)}\n` }, message: `release ${n}: ${steps.length} steps at river-next ${short(head)}; GitHub CI running` };
  });
  console.log(`river release: recorded releases/${n}.json on ${BOARD}; when GitHub CI finishes: node scripts/river.mjs settle ${n}`);
}

/* -------------------------------------------------------------------------- */
/* settle                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Act on GitHub CI's verdict for release/<n>. Pass: fast-forward river to the
 * release commit and record the integration. Fail: name the failing tests,
 * return the lane that caused them, close the pull request, fold again without
 * that lane and open release <n+1>. Still running: say so and change nothing.
 */
async function settle(n, flags) {
  const usage = "usage: river.mjs settle <n> [--ci pass | --ci fail --log-file F [--lanes a,b]]";
  if (!/^\d+$/.test(n ?? "") || (flags.ci !== undefined && !["pass", "fail"].includes(flags.ci))) throw new Refusal(usage, 2);
  if (flags.ci === "fail" && typeof flags["log-file"] !== "string") throw new Refusal(usage, 2);
  const branch = `release/${n}`;
  fetchBranches([RIVER, BOARD, branch]);
  const record = readJson(remoteRef(BOARD), `releases/${n}.json`, null);
  if (!record?.head_sha) throw new Refusal(`${BOARD} has no releases/${n}.json with a head_sha; open it with river.mjs release ${n}`);
  if (record.ci === "pass" || record.ci === "fail") {
    console.log(`river settle: release ${n} is already settled (${record.ci})`);
    return;
  }
  const head = record.head_sha;
  const repo = repoSlug();
  if (flags.ci === "pass") return settlePass(n, record);
  if (flags.ci === "fail") {
    return settleFail(n, record, { failed: [], log: readFileSync(resolve(ROOT, flags["log-file"]), "utf8"), lanes: flags.lanes, repo });
  }
  const checksPath = `repos/${repo}/commits/${head}/check-runs?filter=latest&per_page=100`;
  const listed = await github("GET", checksPath);
  if (!listed.ok) {
    actionNeeded(`read GitHub CI on ${branch} ${short(head)}; the required checks are ${REQUIRED_CONTEXTS.join(", ")}`, "GET", checksPath, undefined,
      listed.status ? `${listed.status}` : listed.body);
    console.log(`  all of them succeeded: node scripts/river.mjs settle ${n} --ci pass`);
    console.log(`  any failed: save the failed jobs' logs to one file, then: node scripts/river.mjs settle ${n} --ci fail --log-file <file>`);
    return;
  }
  const verdict = decideCi(listed.body.check_runs ?? []);
  if (verdict.state === "pending") {
    console.log(`river settle: GitHub CI is still running on ${branch} ${short(head)} (${verdict.waiting.join(", ")}); river stays where it is`);
    return;
  }
  if (verdict.state === "pass") return settlePass(n, record);
  const logs = [];
  for (const job of verdict.failed) {
    const logPath = `repos/${repo}/actions/jobs/${job.id}/logs`;
    const got = await github("GET", logPath);
    if (got.ok && typeof got.body === "string") logs.push(got.body);
    else actionNeeded(`read the log of failed job ${job.name}`, "GET", logPath, undefined, `${got.status}: ${got.body?.message ?? got.body}`);
  }
  return settleFail(n, record, { failed: verdict.failed, log: logs.join("\n"), lanes: flags.lanes, repo });
}

function settlePass(n, record) {
  const head = record.head_sha;
  fetchBranches([RIVER]);
  const river = git(["rev-parse", "--verify", remoteRef(RIVER)]);
  if (river !== head) {
    if (!ok(["merge-base", "--is-ancestor", river, head])) throw new Refusal(`river ${short(river)} is not inside release/${n} ${short(head)}; it cannot fast-forward`);
    if (!ok(["push", "--quiet", "origin", `${head}:refs/heads/${RIVER}`])) throw new Refusal("river rejected the fast-forward; settle again");
  }
  console.log(`river settle: GitHub CI passed on release/${n}; river ${short(river)} → ${short(head)}`);
  const at = nowIso();
  const entries = record.lanes.map((lane) => ({
    lane: lane.lane, steps: lane.steps, ready_sha: lane.ready_sha, merge_sha: lane.result_sha, river_sha: head, release: Number(n), ci: "pass", at,
  }));
  commitToBranch(BOARD, (tip) => {
    const integration = readJson(tip, "integration.json", []);
    const fresh = entries.filter((entry) => !integration.some((old) => old.lane === entry.lane && old.ready_sha === entry.ready_sha));
    const markdown = (readAt(tip, "integration.md") ?? "# Integration record").replace(/\n\(none yet\)\n?/, "\n").trimEnd();
    const separator = /\n- [^\n]*$/.test(markdown) ? "\n" : "\n\n";
    const lines = fresh.map((entry) => `- ${entry.at} · ${entry.lane} · ${entry.steps.join(", ")} · ready ${short(entry.ready_sha)} · river ${short(entry.river_sha)} · GitHub CI passed on release ${n}`);
    // A lane's open return is cleared by the integration that repairs it.
    const cleared = {};
    for (const entry of fresh) {
      const open = readAt(tip, `returns/${entry.lane}.md`);
      if (open !== null && parseStatus(open).state === "returned") {
        cleared[`returns/${entry.lane}.md`] = `${setStatusFields(open, { state: `cleared: integrated ready ${entry.ready_sha} on river ${entry.river_sha}` })}\n`;
      }
    }
    return {
      files: {
        ...(fresh.length ? { "integration.json": `${JSON.stringify([...integration, ...fresh], null, 2)}\n`, "integration.md": `${markdown}${separator}${lines.join("\n")}\n` } : {}),
        [`releases/${n}.json`]: `${JSON.stringify({ ...record, ci: "pass", settled_at: at }, null, 2)}\n`,
        ...cleared,
      },
      message: `release ${n}: GitHub CI passed; river ${short(head)}${fresh.length ? `; integration: ${fresh.map((entry) => `${entry.lane} ${entry.steps.join(",")}`).join("; ")}` : ""}`,
    };
  });
  console.log(`river settle: recorded ${entries.length} lane(s) on ${BOARD}`);
}

/** The test files each folded lane's change reaches, by the import graph CI selects tests with. */
async function laneReach() {
  const { selectTests } = await import("./ci-affected-tests.mjs");
  const { discoverTests } = await import("./ci-tests.mjs");
  const { filesThatWouldBeCommitted } = await import("../lib/ops/repo-files.ts");
  const tracked = filesThatWouldBeCommitted({ cwd: ROOT });
  const tests = discoverTests(ROOT);
  const texts = new Map();
  const readText = (path) => {
    if (!texts.has(path)) texts.set(path, readFileSync(join(ROOT, path), "utf8"));
    return texts.get(path);
  };
  return (lane) => {
    const plan = selectTests({ changed: lane.changed, tracked, tests, readText });
    return plan.plan === "full" ? "all" : new Set(plan.files);
  };
}

async function settleFail(n, record, { failed, log, lanes: named, repo }) {
  const head = record.head_sha;
  const tests = failingTests(log);
  console.log(`river settle: GitHub CI FAILED on release/${n} ${short(head)}${failed.length ? ` (${failed.map((job) => job.name).join(", ")})` : ""}`);
  for (const failure of tests) console.log(`  ✖ ${failure.file} — ${failure.name}`);
  /** @type {{ byTest: { file: string, suspects: string[] }[], returned: string[], unresolved: { file: string, suspects: string[] }[] }} */
  let blame = { byTest: [], returned: [], unresolved: [] };
  if (typeof named === "string") {
    const names = named.split(",").map((lane) => lane.trim()).filter(Boolean);
    const unknown = names.filter((lane) => !record.lanes.some((entry) => entry.lane === lane));
    if (!names.length || unknown.length) throw new Refusal(`--lanes must name lanes in release ${n} (${record.lanes.map((lane) => lane.lane).join(", ")})`, 2);
    blame.returned = names;
  } else if (tests.length) {
    // Read the import graph at the release commit itself.
    requireClean();
    git(["checkout", "--quiet", "-B", NEXT, head]);
    const lanes = record.lanes.map((lane) => ({
      lane: lane.lane,
      changed: git(["diff", "--name-only", "--no-renames", `${record.base_river_sha}...${lane.ready_sha}`]).split("\n").filter((path) => path && !path.startsWith(".factory/")),
    }));
    blame = blameLanes({ tests: tests.map((failure) => failure.file), lanes, reaches: await laneReach() });
  }
  for (const entry of blame.unresolved) {
    console.log(`  not attributed: ${entry.file} (${entry.suspects.length ? `reached by ${entry.suspects.join(", ")}` : "reached by no folded lane"})`);
  }
  if (!blame.returned.length) {
    console.log(`ACTION NEEDED: no folded lane is the single cause of the CI failure on release/${n}; the PR stays open and river stays where it is.`);
    console.log("  Read the failed jobs. A test that never ran means the run was not the full tier: label the PR run-full-ci and settle again.");
    console.log(`  A flaky or infrastructure failure: re-run the failed jobs and settle again. A lane's fault: node scripts/river.mjs settle ${n} --ci fail --log-file <file> --lanes <lane>`);
    return;
  }
  for (const name of blame.returned) {
    const lane = record.lanes.find((entry) => entry.lane === name);
    const mine = new Set(blame.byTest.filter((entry) => entry.suspects.length === 1 && entry.suspects[0] === name).map((entry) => entry.file));
    const output = [
      `GitHub CI failed on release/${n} (${head}).${mine.size ? " Failing tests this lane's change reaches:" : ""}`,
      ...tests.filter((failure) => mine.has(failure.file)).map((failure) => `✖ ${failure.file} — ${failure.name}`),
      ...(mine.size ? [] : [log.trim().split("\n").slice(-40).join("\n")]),
      "",
      "Fix on your stream, run the full suite and pnpm lint on current river, and post a new READY.",
    ].join("\n");
    await recordReturn({ lane: name, check: "GitHub CI", output, readySha: lane.ready_sha, steps: lane.steps, riverSha: record.base_river_sha });
  }
  if (record.pr?.number) {
    const closed = await github("PATCH", `repos/${repo}/pulls/${record.pr.number}`, { state: "closed" });
    if (closed.ok) console.log(`river settle: closed #${record.pr.number}`);
    else actionNeeded(`close #${record.pr.number} (release/${n} failed CI)`, "PATCH", `repos/${repo}/pulls/${record.pr.number}`, { state: "closed" }, `${closed.status}: ${closed.body?.message ?? closed.body}`);
  } else {
    actionNeeded(`close the release/${n} pull request (it failed CI)`, "PATCH", `repos/${repo}/pulls/<release/${n} PR number>`, { state: "closed" });
  }
  commitToBranch(BOARD, (tip) => {
    const current = readJson(tip, `releases/${n}.json`, record);
    if (current.ci === "fail") return null;
    const settled = { ...current, ci: "fail", failed_jobs: failed.map((job) => job.name), failed_tests: tests, returned: blame.returned, settled_at: nowIso() };
    return { files: { [`releases/${n}.json`]: `${JSON.stringify(settled, null, 2)}\n` }, message: `release ${n}: GitHub CI failed; returned ${blame.returned.join(", ")}` };
  });

  // Fold again without the returned lanes (their open returns hold them back) and release again.
  const next = String(Number(n) + 1);
  console.log(`river settle: folding again without ${blame.returned.join(", ")} for release ${next}`);
  await fold({});
  if (!readScratch("fold.json")?.lanes?.length) {
    console.log("river settle: nothing left to fold; no new release");
    return;
  }
  migrations();
  await release(next, {});
}

/* -------------------------------------------------------------------------- */
/* observe                                                                    */
/* -------------------------------------------------------------------------- */

async function observe(sha, flags) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Refusal("usage: river.mjs observe <full 40-character sha>", 2);
  const repo = repoSlug();
  const listPath = `repos/${repo}/actions/workflows/${OBSERVE_WORKFLOW}/runs?head_sha=${sha}&per_page=50`;
  const dispatchPath = `repos/${repo}/actions/workflows/${OBSERVE_WORKFLOW}/dispatches`;
  const dispatchBody = { ref: "main", inputs: { sha } };
  const listed = await github("GET", listPath);
  if (!listed.ok) {
    actionNeeded(`list ${OBSERVE_WORKFLOW} runs for ${sha}; reuse a queued, running or successful one, retry a failed one's jobs, and dispatch only if none covers it`,
      "GET", listPath, undefined, listed.status ? `${listed.status}` : listed.body);
    console.log(`  then, only if none covers it: POST https://api.github.com/${dispatchPath}`);
    console.log(`  body: ${JSON.stringify(dispatchBody)}`);
    return;
  }
  const decision = decideObserve(listed.body.workflow_runs ?? [], sha);
  console.log(`river observe: ${decision.action} — ${decision.reason}${decision.run?.html_url ? ` (${decision.run.html_url})` : ""}`);
  if (decision.action === "reuse" || flags["dry-run"]) return;
  const [path, body, what] = decision.action === "rerun"
    ? [`repos/${repo}/actions/runs/${decision.run.id}/rerun-failed-jobs`, undefined, `retry the failed jobs of run ${decision.run.id}`]
    : [dispatchPath, dispatchBody, `dispatch ${OBSERVE_WORKFLOW} for ${sha}`];
  const sent = await github("POST", path, body);
  if (sent.ok) console.log(`river observe: ${what}: sent`);
  else actionNeeded(what, "POST", path, body, `${sent.status}: ${sent.body?.message ?? sent.body}`);
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

/** `--key value`, `--key=value` and bare `--flag` into an object; the rest positional. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
    else flags[key] = true;
  }
  return { flags, positional };
}

const BOOLEAN_FLAGS = new Set(["dry-run"]);

async function main(argv) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  // A boolean flag never swallows the next word as its value.
  for (const key of BOOLEAN_FLAGS) {
    if (typeof flags[key] === "string") { positional.unshift(flags[key]); flags[key] = true; }
  }
  switch (command) {
    case "scan": console.log(JSON.stringify(scan(), null, 2)); return;
    case "fold": await fold(flags); return;
    case "return": await returnCommand(positional[0], flags); return;
    case "migrations": migrations(); return;
    case "check": quickCheck(); return;
    case "release": await release(positional[0], flags); return;
    case "settle": await settle(positional[0], flags); return;
    case "observe": await observe(positional[0], flags); return;
    case "lock": {
      const mode = positional[0];
      if (!["claim", "heartbeat", "release"].includes(mode)) throw new Refusal("usage: river.mjs lock claim|heartbeat|release --branch B --file F --token T", 2);
      lock(mode, { branch: flags.branch, file: flags.file, token: flags.token, worker: flags.worker, runId: flags["run-id"] });
      return;
    }
    default:
      throw new Refusal("usage: river.mjs scan | fold | migrations | check | release <n> | settle <n> | return <lane> | lock <mode> | observe <sha>", 2);
  }
}

const NEEDS_GITHUB = new Set(["release", "settle", "observe"]);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  && NEEDS_GITHUB.has(process.argv[2]) && PROXY && !process.env.NODE_USE_ENV_PROXY) {
  // Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set at
  // startup; cloud sessions reach api.github.com only through their proxy.
  const again = spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" } });
  process.exit(again.status ?? 1);
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`river: ${error.message}`);
    process.exitCode = error instanceof Refusal ? error.exit : 1;
  });
}
