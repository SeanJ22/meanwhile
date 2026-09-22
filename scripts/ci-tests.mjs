/** Partition the canonical test command, never its assertions or dependencies. */
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FLAGS = ["--test", "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"];
const PATTERNS = ["tests/**/*.test.ts", "tests/**/*.test.tsx"];
const COMMAND = ["node", ...FLAGS, ...PATTERNS].join(" ");

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

export function planTests(root, shardValue) {
  const shard = parseShard(shardValue);
  const command = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts?.test;
  if (command !== COMMAND) {
    throw new Error("Canonical package scripts.test changed. Review the shard runner before certifying tests.");
  }
  const files = globSync(PATTERNS, { cwd: root })
    .map((file) => file.replaceAll("\\", "/")).sort();
  if (files.length < shard.count || new Set(files).size !== files.length) {
    throw new Error("Test discovery must assign unique files and leave no empty shard.");
  }
  const assignments = files.map((file, index) => ({ file, shard: index % shard.count + 1 }));
  const selected = assignments.filter((entry) => entry.shard === shard.index).map((entry) => entry.file);
  return { command, shard, assignments, selected, args: [...FLAGS, ...selected] };
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
  const config = createHash("sha256").update(JSON.stringify({ command: plan.command, node: process.version }));
  const inputs = ["package.json", "pnpm-lock.yaml", "tsconfig.json", "scripts/register-test-loader.mjs", "scripts/test-alias-loader.mjs"];
  for (const file of inputs) config.update(file).update(readFileSync(join(root, file)));
  config.update(readFileSync(fileURLToPath(import.meta.url)));
  const suite = createHash("sha256");
  for (const entry of plan.assignments) suite.update(entry.file).update(readFileSync(join(root, entry.file)));
  return {
    commit, tree: git(["rev-parse", "HEAD^{tree}"]),
    workingTreeStatus: git(["status", "--porcelain", "--untracked-files=normal"]),
    node: process.version, configInputs: inputs, configHash: config.digest("hex"),
    suiteHash: suite.digest("hex"),
  };
}

export async function runTests(root = process.cwd(), shardValue = process.env.CI_TEST_SHARD) {
  const started = Date.now();
  const plan = planTests(root, shardValue);
  const metadata = identity(root, plan);
  const directory = join(root, ".scratch", "ci");
  mkdirSync(directory, { recursive: true });
  const stem = join(directory, `test-shard-${plan.shard.index}-of-${plan.shard.count}`);
  const manifest = { ...metadata, ...plan, startedAt: new Date(started).toISOString(), status: "running", exitCode: null, signal: null, elapsedMs: null };
  const persist = () => writeFileSync(`${stem}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  const header = `Test shard ${plan.shard.index}/${plan.shard.count}: ${plan.selected.length}/${plan.assignments.length} files; SHA ${metadata.commit}\n${plan.selected.join("\n")}\n`;
  writeFileSync(`${stem}.log`, header);
  process.stdout.write(header);
  persist();
  const child = spawn(process.execPath, plan.args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  // Preserve the complete TAP/diagnostics both in Actions output and the artifact.
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
  Object.assign(manifest, { status: exitCode === 0 ? "passed" : "failed", exitCode,
    signal: interrupted ?? outcome.signal, elapsedMs: Date.now() - started });
  persist();
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("The shard runner takes no arguments; set CI_TEST_SHARD.");
    process.exitCode = await runTests();
  } catch (error) {
    console.error(`Test sharding refused: ${error.message}`);
    process.exitCode = 1;
  }
}
