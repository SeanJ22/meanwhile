/** Partition the canonical test command, never its assertions or dependencies. */
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { availableParallelism, totalmem } from "node:os";
import { SCHEDULING_HINTS } from "./ci-test-scheduling-hints.mjs";
import { validateTimings } from "./ci-test-timing-reporter.mjs";

// Every test process starts with the fixture meeting doors installed, as every production process installs the registry's.
// Node 24's V8 can double-free collected PGlite import wrappers (nodejs/node#66366).
// Retain compiled Wasm code until each test process exits; assertions and file isolation stay intact.
const FLAGS = ["--test", "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--import", "./tests/helpers/install-fixture-doors.ts", "--no-wasm-code-gc"];
const PATTERNS = ["tests/**/*.test.ts", "tests/**/*.test.tsx", "lib/sources/platform-adapters/**/*.test.ts", "lib/sources/platform-adapters/**/*.test.tsx"];
const COMMAND = "node scripts/ci-tests.mjs";
const REPORTER = new URL("./ci-test-timing-reporter.mjs", import.meta.url);
const EXECUTION_INPUTS = ["ci-tests.mjs", "ci-test-timing-reporter.mjs", "ci-test-scheduling-hints.mjs"];

export function testFileConcurrency(available) {
  if (!Number.isSafeInteger(available) || available < 1) throw new Error("Available parallelism must be a positive integer.");
  return Math.min(2, available);
}

// Node's CLI sorts file arguments lexically before dispatch. Model that order,
// not the longest-first ordering used to propose shard membership. Replacement
// indices are merged into an already sorted shard without sorting each trial.
function lexicalCost(indices, costs, workers, removed = -1, added = -1) {
  const loads = Array(workers).fill(0);
  const schedule = (index) => {
    const worker = workers === 1 || loads[0] <= loads[1] ? 0 : 1;
    loads[worker] += costs[index];
  };
  let inserted = added < 0;
  for (const index of indices) {
    if (!inserted && added < index) { schedule(added); inserted = true; }
    if (index !== removed) schedule(index);
  }
  if (!inserted) schedule(added);
  return Math.max(...loads);
}

/**
 * @param {{file: string, shard: number, hintDurationMs: number | null, schedulingCost: number}[]} roundRobin
 * @param {{file: string, shard: number, hintDurationMs: number | null, schedulingCost: number}[]} longestFirst
 * @param {number[]} costs
 * @param {number} count
 * @param {number} workers
 * @param {boolean} canOptimize
 */
function chooseSchedule(roundRobin, longestFirst, costs, count, workers, canOptimize) {
  const groupsFor = (assignments) => {
    const groups = Array.from({ length: count }, () => []);
    assignments.forEach((entry, index) => groups[entry.shard - 1].push(index));
    return groups;
  };
  const estimatesFor = (groups) => groups.map((group) => lexicalCost(group, costs, workers));
  const rrGroups = groupsFor(roundRobin);
  const lptGroups = groupsFor(longestFirst);
  const roundRobinCost = Math.max(...estimatesFor(rrGroups));
  const longestFirstCost = Math.max(...estimatesFor(lptGroups));
  const useLongestFirst = canOptimize && longestFirstCost < roundRobinCost;
  const groups = useLongestFirst ? lptGroups : rrGroups;
  const initialPlan = useLongestFirst ? "longest-first" : "round-robin";
  let estimates = estimatesFor(groups);
  let swapsAccepted = 0;
  let evaluatedSwaps = 0;
  const passLimit = 8;
  const candidatesPerEnd = 16;
  // This is a bounded linear-size neighborhood, not all pairs of suite files.
  // Swaps retain every shard's exact floor/ceil capacity. Ties retain the first
  // deterministic proposal; only strict global makespan improvements are kept.
  for (let pass = 0; canOptimize && pass < passLimit && count > 1; pass++) {
    const currentCost = Math.max(...estimates);
    const critical = estimates.indexOf(currentCost);
    const candidates = groups.map((group) => {
      const ranked = [...group].sort((a, b) => costs[b] - costs[a] || a - b);
      return [...new Set([...ranked.slice(0, candidatesPerEnd), ...ranked.slice(-candidatesPerEnd)])];
    });
    let best = null;
    let bestCost = currentCost;
    for (let other = 0; other < count; other++) {
      if (other === critical) continue;
      const unchanged = Math.max(0, ...estimates.filter((_, index) => index !== critical && index !== other));
      for (const from of candidates[critical]) {
        for (const to of candidates[other]) {
          evaluatedSwaps++;
          const next = Math.max(unchanged,
            lexicalCost(groups[critical], costs, workers, from, to),
            lexicalCost(groups[other], costs, workers, to, from));
          // Avoid treating floating-point summation noise as an improvement.
          if (next < bestCost - 1e-6) { bestCost = next; best = { other, from, to }; }
        }
      }
    }
    if (best === null) break;
    groups[critical] = groups[critical].filter((index) => index !== best.from).concat(best.to).sort((a, b) => a - b);
    groups[best.other] = groups[best.other].filter((index) => index !== best.to).concat(best.from).sort((a, b) => a - b);
    estimates = estimatesFor(groups);
    swapsAccepted++;
  }
  const assignments = roundRobin.map((entry) => ({ ...entry }));
  groups.forEach((group, index) => group.forEach((file) => { assignments[file].shard = index + 1; }));
  return { assignments, model: {
    label: "ESTIMATE", model: "lexical-greedy-worker-dispatch-v1", workers,
    initialPlan, roundRobinMakespanCost: roundRobinCost, longestFirstMakespanCost: longestFirstCost,
    selectedMakespanCost: Math.max(...estimates), shardMakespanCosts: estimates,
    swapsAccepted, evaluatedSwaps, passLimit, candidatesPerEnd,
    limitation: "Scheduling estimate from historical file-harness hints; excludes startup, shared-resource contention, queues and billing. Not an actual runtime measurement.",
  } };
}

/**
 * Fixed count capacities avoid concentrating unknown/new files on one runner.
 * @param {string[]} files
 * @param {number} count
 * @param {unknown} hints
 * @param {number} workers
 */
export function partitionTests(files, count, hints = SCHEDULING_HINTS, workers = 1) {
  if (!Number.isSafeInteger(count) || count < 1 || files.length < count || new Set(files).size !== files.length) {
    throw new Error("Test discovery must assign unique files and leave no empty shard.");
  }
  if (workers !== 1 && workers !== 2) throw new Error("Scheduling model supports one or two file workers.");
  const weights = hints?.durationMsByFile;
  const valid = hints?.formatVersion === 1 && weights !== null && typeof weights === "object" && !Array.isArray(weights) &&
    Object.entries(weights).every(([file, duration]) => /^tests\/.+\.test\.tsx?$/.test(file) &&
      !file.includes("\\") && !file.split("/").includes("..") && Number.isFinite(duration) && duration >= 0) &&
    (Object.keys(weights).length === 0 || (typeof hints.source === "string" && hints.source.trim().length > 0));
  const duration = (file) => valid && Object.hasOwn(weights, file) ? weights[file] : null;
  const measured = files.map(duration).filter((value) => value !== null).sort((a, b) => a - b);
  const unknownEstimate = measured.length ? Math.max(1, measured[Math.ceil(measured.length * 0.95) - 1]) : 1;
  const cost = (file) => duration(file) ?? unknownEstimate;
  const ordered = [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0));
  const shards = Array.from({ length: count }, (_, index) => ({
    index: index + 1, count: 0, schedulingCost: 0,
    capacity: Math.floor(files.length / count) + (index < files.length % count ? 1 : 0),
  }));
  const longestFirst = ordered.map((file) => {
    const target = shards.filter((shard) => shard.count < shard.capacity)
      .sort((a, b) => a.schedulingCost - b.schedulingCost || a.count - b.count || a.index - b.index)[0];
    const hintDurationMs = duration(file);
    target.count++;
    target.schedulingCost += cost(file);
    return { file, shard: target.index, hintDurationMs, schedulingCost: cost(file) };
  });
  // Stable canonical order keeps suite identity independent of scheduling.
  longestFirst.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  const roundRobin = longestFirst.map((entry, index) => ({ ...entry, shard: index % count + 1 }));
  const { assignments, model } = chooseSchedule(roundRobin, longestFirst, longestFirst.map((entry) => entry.schedulingCost),
    count, workers, measured.some((value) => value > 0));
  return { assignments, scheduling: {
    algorithm: "lexical-model-fallback-with-bounded-swaps-v1", hintsValid: valid,
    source: valid ? hints.source : null,
    hintedFiles: assignments.filter((entry) => entry.hintDurationMs !== null).length,
    unknownFiles: assignments.filter((entry) => entry.hintDurationMs === null).length,
    unknownEstimate, estimateBasis: measured.length ? "measured-p95-with-1ms-floor" : "equal-positive-unit-cost",
    model: { ...model, costUnit: measured.length ? "estimated-ms" : "relative-unit" },
    note: valid ? "Hints change scheduling only; unknown files always run with an explicitly estimated cost, never a measured duration."
      : "Invalid hints ignored; every file runs in deterministic count-balanced partitions.",
  } };
}

export function parseShard(value) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value ?? "");
  if (!match) throw new Error("CI_TEST_SHARD must be an explicit index/count, for example 1/4.");
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count || count > 256) {
    throw new Error("CI_TEST_SHARD index must be within 1..count; count must be at most 256.");
  }
  return { index, count };
}

/** The canonical suite: every file the test command owns, sorted, as POSIX paths. */
export function discoverTests(root) {
  return globSync(PATTERNS, { cwd: root }).map((file) => file.replaceAll("\\", "/")).sort();
}

function canonicalCommand(root) {
  const command = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts?.test;
  if (command !== COMMAND) {
    throw new Error("Canonical package scripts.test changed. Review the shard runner before certifying tests.");
  }
  return command;
}

/**
 * An explicit file list (CI_TEST_FILES, newline-separated) — the tests a pull
 * request's change can reach, chosen by scripts/ci-affected-tests.mjs. Every
 * entry must be a file of the canonical suite, named once; an empty list is
 * refused rather than read as a pass.
 */
export function parseTestFiles(value, suite) {
  const files = String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (files.length === 0) throw new Error("CI_TEST_FILES names no test files; an empty selection cannot certify anything.");
  if (new Set(files).size !== files.length) throw new Error("CI_TEST_FILES names a test file more than once.");
  const known = new Set(suite);
  const unknown = files.filter((file) => !known.has(file));
  if (unknown.length) throw new Error(`CI_TEST_FILES names files outside the canonical suite: ${unknown.join(", ")}`);
  return [...files].sort();
}

/**
 * Run exactly the named files, with the same flags, reporters, identity and
 * timing validation as a shard. What does not apply is only the partition:
 * the selection is one group, so `assignments` lists the selected files (all
 * in group 1) and the suite hash covers them, not the whole suite.
 */
export function planExplicitTests(root, filesValue) {
  const command = canonicalCommand(root);
  const selected = parseTestFiles(filesValue, discoverTests(root));
  const available = availableParallelism();
  const concurrency = { available, effective: testFileConcurrency(available) };
  const { assignments, scheduling } = partitionTests(selected, 1, SCHEDULING_HINTS, concurrency.effective);
  return { command, mode: "explicit", shard: { index: 1, count: 1 }, assignments, scheduling, concurrency, selected, args: [...FLAGS, ...selected] };
}

export function planTests(root, shardValue) {
  const shard = parseShard(shardValue);
  const command = canonicalCommand(root);
  const files = discoverTests(root);
  if (files.length < shard.count || new Set(files).size !== files.length) {
    throw new Error("Test discovery must assign unique files and leave no empty shard.");
  }
  const available = availableParallelism();
  const concurrency = { available, effective: testFileConcurrency(available) };
  const { assignments, scheduling } = partitionTests(files, shard.count, SCHEDULING_HINTS, concurrency.effective);
  const selected = assignments.filter((entry) => entry.shard === shard.index).map((entry) => entry.file);
  return { command, mode: "shard", shard, assignments, scheduling, concurrency, selected, args: [...FLAGS, ...selected] };
}

function identity(root, plan) {
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error(`Cannot establish tested Git identity: ${result.stderr || result.error}`);
    return result.stdout.trim();
  };
  const commit = git(["rev-parse", "HEAD"]);
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit) {
    throw new Error(`Checkout ${commit} does not match GITHUB_SHA ${process.env.GITHUB_SHA}.`);
  }
  const config = createHash("sha256").update(JSON.stringify({ command: plan.command, node: process.version, concurrency: plan.concurrency }));
  const inputs = ["package.json", "pnpm-lock.yaml", "tsconfig.json", "scripts/register-test-loader.mjs", "scripts/test-alias-loader.mjs"];
  for (const file of inputs) config.update(file).update(readFileSync(join(root, file)));
  // Hash the modules actually executed, including when a fixture has another cwd.
  for (const file of EXECUTION_INPUTS) {
    const path = `scripts/${file}`;
    inputs.push(path);
    config.update(path).update(readFileSync(new URL(file, import.meta.url)));
  }
  const suite = createHash("sha256");
  for (const entry of plan.assignments) suite.update(entry.file).update(readFileSync(join(root, entry.file)));
  return {
    commit, tree: git(["rev-parse", "HEAD^{tree}"]),
    workingTreeStatus: git(["status", "--porcelain", "--untracked-files=normal"]),
    runner: { platform: process.platform, arch: process.arch, totalMemoryBytes: totalmem() },
    node: process.version, configInputs: inputs, configHash: config.digest("hex"),
    suiteHash: suite.digest("hex"),
  };
}

export async function runTests(root = process.cwd(), shardValue = process.env.CI_TEST_SHARD, filesValue = process.env.CI_TEST_FILES ?? "") {
  const started = Date.now();
  const explicit = filesValue.trim().length > 0;
  if (explicit && (shardValue ?? "").trim().length > 0) throw new Error("Set CI_TEST_SHARD or CI_TEST_FILES, not both.");
  const plan = explicit ? planExplicitTests(root, filesValue) : planTests(root, shardValue ?? "1/1");
  const metadata = identity(root, plan);
  const directory = join(root, ".scratch", "ci");
  mkdirSync(directory, { recursive: true });
  const stem = join(directory, explicit ? "test-affected" : `test-shard-${plan.shard.index}-of-${plan.shard.count}`);
  const timingPath = `${stem}.timings.jsonl`;
  const invocationArgs = [...FLAGS, `--test-concurrency=${plan.concurrency.effective}`, "--test-reporter=spec", "--test-reporter-destination=stdout",
    `--test-reporter=${REPORTER.href}`, `--test-reporter-destination=${timingPath}`, ...plan.selected];
  const manifest = { ...metadata, ...plan, invocationArgs,
    startedAt: new Date(started).toISOString(), status: "running", exitCode: null, signal: null, elapsedMs: null,
    timing: { complete: false, usableForScheduling: false, issues: ["Test process has not completed."] } };
  const persist = () => writeFileSync(`${stem}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  const header = `${explicit ? "Affected tests" : `Test shard ${plan.shard.index}/${plan.shard.count}`}: ${plan.selected.length}/${plan.assignments.length} files; SHA ${metadata.commit}\n${plan.selected.join("\n")}\n`;
  writeFileSync(`${stem}.log`, header);
  // A bootstrap failure must not inherit a prior invocation's complete timings.
  writeFileSync(timingPath, "");
  process.stdout.write(header);
  persist();
  const child = spawn(process.execPath, invocationArgs, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  // Preserve raw spec diagnostics and stderr alongside the structured reporter.
  child.stdout.on("data", (chunk) => { appendFileSync(`${stem}.log`, chunk); process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { appendFileSync(`${stem}.log`, chunk); process.stderr.write(chunk); });
  let interrupted = null;
  const interrupt = (signal) => { interrupted = signal; child.kill(signal); };
  const onTerm = () => interrupt("SIGTERM");
  const onInt = () => interrupt("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  const outcome = await new Promise((done) => {
    child.on("error", (error) => {
      appendFileSync(`${stem}.log`, `\nRunner error: ${error.message}\n`);
      process.stderr.write(`Runner error: ${error.message}\n`);
    });
    child.on("close", (code, signal) => done({ code, signal }));
  });
  process.off("SIGTERM", onTerm);
  process.off("SIGINT", onInt);
  const exitCode = interrupted || outcome.signal || outcome.code === null ? 1 : outcome.code;
  let timingText = "";
  let readIssue = null;
  try { timingText = readFileSync(timingPath, "utf8"); }
  catch (error) { readIssue = `Timing output could not be read: ${error.code ?? error.name}.`; }
  const timing = validateTimings(timingText, plan.selected);
  if (readIssue) { timing.complete = false; timing.issues.unshift(readIssue); }
  const usableForScheduling = timing.complete && exitCode === 0 && timing.run?.success === true &&
    timing.run.counts.failed === 0 && timing.run.counts.cancelled === 0 &&
    timing.files.every((row) => row.success && row.counts.failed === 0 && row.counts.cancelled === 0);
  if (!timing.complete) {
    const warning = `Timing evidence incomplete; unusable for scheduling hints: ${timing.issues.join(" ")}\n`;
    appendFileSync(`${stem}.log`, warning);
    process.stderr.write(warning);
  }
  Object.assign(manifest, { status: exitCode === 0 ? "passed" : "failed", exitCode,
    signal: interrupted ?? outcome.signal, elapsedMs: Date.now() - started,
    timing: { ...timing, usableForScheduling, file: `${stem.split(/[\\/]/).at(-1)}.timings.jsonl`,
      measurement: "Node file harness duration; excludes some process startup/exit time and is not billed runner usage." } });
  persist();
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("The shard runner takes no arguments; set CI_TEST_SHARD or CI_TEST_FILES.");
    process.exitCode = await runTests();
  } catch (error) {
    console.error(`Test sharding refused: ${error.message}`);
    process.exitCode = 1;
  }
}
