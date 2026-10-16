#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STALE_LOCK_MS = 45 * 60 * 1000;

export const CI_ABSENT_ENV = ["DATABASE_URL", "WTP_ASSET_STORE"];

const HEARTBEAT_EVERY_MS = 10 * 60 * 1000;

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
const STEP_ID = /\b(?:R\d-[A-Z]+(?:-[A-Z]+)*|[A-Z]{2,4}-\d{1,3}|[A-Z]{2,}-[A-Z]{2,}|R\d[A-Z]?)\b/g;

export const adapterPath = (path) => path.startsWith("lib/sources/platform-adapters/")
  && /\.[cm]?[jt]sx?$/.test(path) && !/(?:^|\/)(?:evidence|fixtures)(?:\/|$)/.test(path);

/** @param {string} text @returns {Record<string, string>} */
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

/** @param {string} text @param {Record<string, string>} updates */
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

export function stepIds(subject) {
  return [...new Set(subject.match(STEP_ID) ?? [])];
}

export function heartbeatAge(heartbeat, now) {
  if (!heartbeat || heartbeat === "none") return null;
  const at = Date.parse(heartbeat);
  return Number.isFinite(at) ? now - at : null;
}

/** @param {{ commits: { sha: string, subject: string }[], integrated: Set<string> }} input */
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

/** @param {string[]} lanes @param {string} [order] */
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

/** @param {{ mode: "claim" | "heartbeat" | "release", fields: Record<string, string>, token: string, now: number }} input @returns {{ write: boolean, exit: number, reason: string, takeover?: string }} */
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

/** @param {{ lane: string, steps: string[] }[]} integration @param {{ n: number, integration_count: number }[]} releases */
export function releaseContents(integration, releases) {
  const previous = releases.reduce((last, release) => (release.n > (last?.n ?? -Infinity) ? release : last), null);
  const from = previous ? previous.integration_count : 0;
  const entries = integration.slice(from);
  return {
    from,
    entries,
    steps: [...new Set(entries.flatMap((entry) => entry.steps))],
    lanes: [...new Set(entries.map((entry) => entry.lane))],
  };
}

const ACTIVE_RUN = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/** @typedef {{ id: number, head_sha: string, status: string, conclusion: string | null, html_url?: string }} WorkflowRun @param {WorkflowRun[]} runs @param {string} sha @returns {{ action: "reuse" | "rerun" | "dispatch", run?: WorkflowRun, reason: string }} */
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

const NUMBERED = /^\d{4}_[a-z0-9_]+\.sql$/;

export const isStepNamed = (name) => name.endsWith(".sql") && !/^\d{4}_/.test(name);

export function slugOf(tag) {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .replace(/^([a-z]{2,4})_(\d)/, "$1$2");
}

/** @param {{ added: string[], journal: { idx: number, version: string, when: number, tag: string, breakpoints: boolean }[], baseCount: number }} input */
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

function gitTry(args) {
  const run = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() };
}
const remoteRef = (branch) => `refs/remotes/origin/${branch}`;

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

/** @param {string} branch @param {(tip: string) => ({ files: Record<string, string>, message: string } | null)} change */
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

async function fold(flags) {
  requireClean();
  const plan = scan();
  const wanted = flags.lanes ? new Set(flags.lanes.split(",").map((lane) => lane.trim())) : null;
  const ready = plan.lanes.filter((lane) => lane.ready && (!wanted || wanted.has(lane.lane)));
  if (wanted) {
    for (const lane of wanted) {
      if (!plan.lanes.some((entry) => entry.lane === lane)) throw new Refusal(`no stream/${lane} on origin`);
    }
  }
  const order = foldOrder(ready.map((lane) => lane.lane), flags.order);
  const record = { base_river_sha: plan.river, folded_at: nowIso(), order, lanes: [], head: plan.river, conflict: null };
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
  record.head = git(["rev-parse", "HEAD"]);
  writeScratch("fold.json", record);
  console.log(`river fold: river-next ${short(record.head)} from river ${short(plan.river)}; next: migrations, then test`);
}

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
  // Replace longer tags first so a step tag cannot rewrite a sibling migration name.
  for (const rename of [...plan.renames].sort((a, b) => b.oldTag.length - a.oldTag.length)) {
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
  console.log(`river migrations: committed ${short(git(["rev-parse", "HEAD"]))}; run test next.`);
}

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

async function test(flags) {
  requireClean();
  if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== NEXT) throw new Refusal(`check out ${NEXT} first`);
  if (flags.heartbeat && !flags.token) throw new Refusal("--heartbeat needs --token", 2);
  const sha = git(["rev-parse", "HEAD"]);
  // `pnpm gates` when pnpm is on PATH: gates.mjs warns that a corepack shim can
  // make its nested pnpm calls refuse on the version guard.
  const [command, ...args] = whichPnpm() ? ["pnpm", "gates"] : ["corepack", "pnpm", "gates"];
  const startedAt = nowIso();
  console.log(`river test: ${command} ${args.join(" ")} on ${short(sha)}`);
  const env = { ...process.env };
  for (const name of CI_ABSENT_ENV) delete env[name];
  // A previous gates run leaves its untracked run record behind, and the
  // visible-tree gate then fails on a file this fold never made.
  for (const path of (git(["ls-files", "--others", "--exclude-standard", "data/ops/gate-runs"], { allowFail: true }) ?? "").split("\n").filter(Boolean)) {
    rmSync(join(ROOT, path), { force: true });
  }
  // A stale .next from an earlier build feeds tsc route types that may no longer exist.
  rmSync(join(ROOT, ".next"), { recursive: true, force: true });
  const projection = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/project-place-references.mts"], { cwd: ROOT, env, encoding: "utf8" });
  if (projection.status !== 0) throw new Refusal(`place-reference generation failed: ${projection.error?.message ?? projection.stderr ?? "no diagnostic"}`, 2);
  const child = spawn(command, args, { cwd: ROOT, env, stdio: ["inherit", "pipe", "pipe"], shell: process.platform === "win32" });
  const tail = [];
  const keep = (sink) => (chunk) => {
    sink.write(chunk);
    tail.push(...`${chunk}`.split("\n"));
    if (tail.length > 2000) tail.splice(0, tail.length - 2000);
  };
  child.stdout.on("data", keep(process.stdout));
  child.stderr.on("data", keep(process.stderr));
  let abandoned = null;
  const timer = flags.heartbeat ? setInterval(() => {
    try {
      lock("heartbeat", { branch: flags.branch ?? BOARD, file: flags.file ?? "status.md", token: flags.token });
    } catch (error) {
      abandoned = error.message;
      console.error(`river test: ${error.message}; stopping gates`);
      child.kill();
    }
  }, HEARTBEAT_EVERY_MS) : null;
  const exit = await new Promise((done) => child.on("close", (code) => done(code ?? 1)));
  if (timer) clearInterval(timer);
  const result = {
    sha,
    tree: git(["rev-parse", "HEAD^{tree}"]),
    gates: abandoned ? "abandoned" : exit === 0 ? "pass" : "fail",
    exit,
    command: [command, ...args].join(" "),
    started_at: startedAt,
    finished_at: nowIso(),
    ...(abandoned ? { reason: abandoned } : {}),
  };
  writeScratch("test.json", result);
  console.log(`river test: gates ${result.gates} on ${short(sha)} (recorded in .scratch/river/test.json)`);
  if (result.gates === "fail") {
    const output = tail.join("\n");
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(join(SCRATCH, "test-output.txt"), `${output}\n`, "utf8");
    const folded = readScratch("fold.json");
    const lanes = folded?.lanes ?? [];
    const only = lanes.length === 1 ? lanes[0] : null;
    if (only?.lane.startsWith("adapter-")) {
      // A fold of one adapter stream: the failure is that stream's.
      await recordReturn({ lane: only.lane, check: "gates", output, readySha: only.ready_sha, steps: only.steps, riverSha: folded.base_river_sha });
    } else if (lanes.some((lane) => lane.lane.startsWith("adapter-"))) {
      console.log("river test: an adapter stream is in this fold. Isolate it with `fold --lanes adapter-<kind>` and test again (a failure is then returned to it),");
      console.log("  or return it directly: river.mjs return adapter-<kind> --check gates --output-file .scratch/river/test-output.txt");
    }
  }
  if (result.gates !== "pass") throw new Refusal(`gates ${result.gates}; isolate the failing lane before promoting`);
}

function whichPnpm() {
  try {
    execFileSync("pnpm", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    return true;
  } catch {
    return false;
  }
}

function promote() {
  const folded = readScratch("fold.json");
  const tested = readScratch("test.json");
  if (!folded?.lanes?.length) throw new Refusal("nothing folded; nothing to promote");
  if (folded.conflict) throw new Refusal(`the fold stopped on ${folded.conflict.lane}; fold again before promoting`);
  const head = git(["rev-parse", "--verify", NEXT]);
  if (!tested || tested.gates !== "pass" || tested.sha !== head) {
    throw new Refusal(`gates have not passed on river-next ${short(head)} (test.json: ${tested ? `${tested.gates} on ${short(tested.sha)}` : "absent"})`);
  }
  fetchBranches([RIVER]);
  const river = git(["rev-parse", "--verify", remoteRef(RIVER)]);
  if (river !== folded.base_river_sha) throw new Refusal(`river moved since the fold (${short(folded.base_river_sha)} → ${short(river)}); fold again`);
  if (!ok(["merge-base", "--is-ancestor", river, head])) throw new Refusal("river-next does not contain river; fold again");
  if (!ok(["push", "--quiet", "origin", `${head}:refs/heads/${RIVER}`])) throw new Refusal("river rejected the fast-forward; fold again");
  console.log(`river promote: river ${short(river)} → ${short(head)}`);
  const at = nowIso();
  const entries = folded.lanes.map((lane) => ({
    lane: lane.lane, steps: lane.steps, ready_sha: lane.ready_sha, merge_sha: lane.result_sha,
    river_sha: head, tested_sha: tested.sha, gates: "pass", at,
  }));
  commitToBranch(BOARD, (tip) => {
    const integration = readJson(tip, "integration.json", []);
    const fresh = entries.filter((entry) => !integration.some((old) => old.lane === entry.lane && old.ready_sha === entry.ready_sha));
    if (!fresh.length) return null;
    const markdown = (readAt(tip, "integration.md") ?? "# Integration record").replace(/\n\(none yet\)\n?/, "\n").trimEnd();
    const separator = /\n- [^\n]*$/.test(markdown) ? "\n" : "\n\n";
    const lines = fresh.map((entry) => `- ${entry.at} · ${entry.lane} · ${entry.steps.join(", ")} · ready ${short(entry.ready_sha)} · river ${short(entry.river_sha)} · pnpm gates pass on ${short(entry.tested_sha)}`);
    // An adapter stream's open return is cleared by the integration that repairs it.
    const cleared = {};
    for (const entry of fresh) {
      const open = entry.lane.startsWith("adapter-") ? readAt(tip, `returns/${entry.lane}.md`) : null;
      if (open !== null && parseStatus(open).state === "returned") {
        cleared[`returns/${entry.lane}.md`] = `${setStatusFields(open, { state: `cleared: integrated ready ${entry.ready_sha} on river ${entry.river_sha}` })}\n`;
      }
    }
    return {
      files: {
        "integration.json": `${JSON.stringify([...integration, ...fresh], null, 2)}\n`,
        "integration.md": `${markdown}${separator}${lines.join("\n")}\n`,
        ...cleared,
      },
      message: `integration: ${fresh.map((entry) => `${entry.lane} ${entry.steps.join(",")}`).join("; ")} on river ${short(head)}`,
    };
  });
  console.log(`river promote: recorded ${entries.length} lane(s) on ${BOARD}`);
}

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

function releaseRecords(ref) {
  const names = git(["ls-tree", "--name-only", `${ref}:releases`], { allowFail: true }) ?? "";
  return names.split("\n").filter((name) => /^\d+\.json$/.test(name)).map((name) => readJson(ref, `releases/${name}`, null)).filter(Boolean);
}

function checkMain() {
  fetchBranches(["main", RIVER, BOARD]);
  const main = git(["rev-parse", "--verify", remoteRef("main")]);
  const river = git(["rev-parse", "--verify", remoteRef(RIVER)]);
  const integration = readJson(remoteRef(BOARD), "integration.json", []);
  const tested = integration.length ? integration[integration.length - 1].tested_sha : null;
  const mainInRiver = ok(["merge-base", "--is-ancestor", main, river]);
  // A river restarted from main after a release carries nothing untested.
  return { main, river, tested, main_in_river: mainInRiver, river_is_tested: tested === river || river === main };
}

async function release(n, flags) {
  if (flags["check-main"]) {
    const state = checkMain();
    console.log(JSON.stringify(state, null, 2));
    if (!state.main_in_river) throw new Refusal("main moved after river was tested: fold main into river-next, run gates, promote, then release");
    if (!state.river_is_tested) throw new Refusal("river's tip is not the last tested SHA on the board");
    console.log("river release --check-main: main is inside the tested river.");
    return;
  }
  if (!/^\d+$/.test(n ?? "")) throw new Refusal("usage: river.mjs release <n> | --check-main", 2);
  const state = checkMain();
  if (!state.main_in_river) throw new Refusal("main moved after river was tested; integrate main and test again first");
  if (!state.river_is_tested) throw new Refusal(`river ${short(state.river)} is not the last tested SHA (${state.tested ? short(state.tested) : "none"})`);
  const releases = releaseRecords(remoteRef(BOARD));
  const integration = readJson(remoteRef(BOARD), "integration.json", []);
  const existing = releases.find((record) => record.n === Number(n));
  if (existing && existing.river_sha !== state.river) throw new Refusal(`release ${n} already records river ${short(existing.river_sha)}`);
  const fresh = releaseContents(integration, releases.filter((record) => record.n !== Number(n)));
  const contents = existing
    ? { steps: existing.steps, lanes: existing.lanes, from: existing.integration_from, count: existing.integration_count }
    : { ...fresh, count: fresh.from + fresh.entries.length };
  if (!contents.steps.length) throw new Refusal("no integrated steps since the last release; no release PR");

  const repo = repoSlug();
  const branch = `release/${n}`;
  const title = `Release ${n}: ${contents.steps.length} step${contents.steps.length === 1 ? "" : "s"} from river`;
  const body = [
    `River release ${n}. Tested river SHA \`${state.river}\` (pnpm gates passed on that exact SHA).`,
    "",
    `Lanes: ${contents.lanes.join(", ")}`,
    "",
    "Steps:",
    ...contents.steps.map((step) => `- ${step}`),
    "",
    "Built by `scripts/river.mjs release`. Data never rides the river; this carries code only.",
  ].join("\n");

  // Never two competing release candidates.
  const open = await github("GET", `repos/${repo}/pulls?state=open&base=main&per_page=100`);
  if (open.ok) {
    const rival = open.body.find((pr) => pr.head.ref.startsWith("release/") && pr.head.ref !== branch);
    if (rival) throw new Refusal(`#${rival.number} from ${rival.head.ref} is still open; close it or merge it before release ${n}`);
  }
  if (flags["dry-run"]) {
    console.log(JSON.stringify({ branch, river: state.river, title, body, steps: contents.steps }, null, 2));
    return;
  }

  const remote = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split("\t")[0];
  if (remote && remote !== state.river) throw new Refusal(`${branch} already exists at ${short(remote)}`);
  if (!remote && !ok(["push", "--quiet", "origin", `${state.river}:refs/heads/${branch}`])) throw new Refusal(`could not push ${branch}`);

  let pr = null;
  const create = { title, head: branch, base: "main", body };
  if (!open.ok) {
    actionNeeded(`confirm no other release/* PR is open into main, then create the release PR`, "POST", `repos/${repo}/pulls`, create,
      `listing open PRs failed (${open.status}: ${typeof open.body === "string" ? open.body : open.body?.message})`);
  } else {
    const mine = open.body.find((candidate) => candidate.head.ref === branch);
    const made = mine ? { ok: true, body: mine } : await github("POST", `repos/${repo}/pulls`, create);
    if (made.ok) pr = made.body;
    else actionNeeded("create the release PR", "POST", `repos/${repo}/pulls`, create, `${made.status}: ${made.body?.message ?? made.body}`);
  }
  if (pr) {
    console.log(`river release: PR #${pr.number} ${pr.html_url}`);
    const query = "mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) { clientMutationId } }";
    const auto = await github("POST", "graphql", { query, variables: { id: pr.node_id } });
    if (!auto.ok || auto.body?.errors) {
      actionNeeded(`enable auto-merge (merge commit) on #${pr.number}`, "POST", "graphql", { query, variables: { id: pr.node_id } },
        `${auto.status}: ${JSON.stringify(auto.body?.errors ?? auto.body)}`);
    } else {
      console.log(`river release: auto-merge enabled on #${pr.number}`);
    }
  }

  commitToBranch(BOARD, (tip) => {
    const record = {
      n: Number(n), branch, river_sha: state.river, tested_sha: state.tested, steps: contents.steps, lanes: contents.lanes,
      integration_from: contents.from, integration_count: contents.count,
      pr: pr ? { number: pr.number, url: pr.html_url } : null, at: nowIso(),
    };
    const old = readJson(tip, `releases/${n}.json`, null);
    if (old && old.pr && !record.pr) return null;
    return { files: { [`releases/${n}.json`]: `${JSON.stringify(record, null, 2)}\n` }, message: `release ${n}: ${contents.steps.length} steps at river ${short(state.river)}` };
  });
  console.log(`river release: recorded releases/${n}.json on ${BOARD}`);
}

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

const BOOLEAN_FLAGS = new Set(["heartbeat", "dry-run", "check-main"]);

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
    case "test": await test(flags); return;
    case "promote": promote(); return;
    case "release": await release(positional[0], flags); return;
    case "observe": await observe(positional[0], flags); return;
    case "lock": {
      const mode = positional[0];
      if (!["claim", "heartbeat", "release"].includes(mode)) throw new Refusal("usage: river.mjs lock claim|heartbeat|release --branch B --file F --token T", 2);
      lock(mode, { branch: flags.branch, file: flags.file, token: flags.token, worker: flags.worker, runId: flags["run-id"] });
      return;
    }
    default:
      throw new Refusal("usage: river.mjs scan | fold | migrations | test | promote | return <lane> | release <n> | lock <mode> | observe <sha>", 2);
  }
}

const NEEDS_GITHUB = new Set(["release", "observe"]);
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
