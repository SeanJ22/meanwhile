#!/usr/bin/env tsx
/**
 * **RL-2 / RL-3 — renew the Reader Last-Mile closure receipt for the holdings
 * a refresh genuinely changed, before the suite validates; refuse by name
 * what cannot be proved.** (The author's refresh-liveness addendum, 2026-09-05.)
 *
 * ## Where this runs
 *
 * In `refresh-daily.yml`, after the governed diff found a change and the
 * browser is installed, and BEFORE `corepack pnpm test`. The refresh runner has
 * already written `docs/refresh-run.json`; this script adds its `renewal`
 * block to that record, and `refresh-gate.mts` reads it.
 *
 * ## What it does
 *
 * 1. Compares the canonical holdings in the tree with those the committed
 *    closure census proved. No difference: NOT_NEEDED, nothing else happens.
 * 2. Otherwise runs the EXISTING dependency-aware renewal, unchanged: the
 *    PURE dependents regenerate, one exact-head production build serves the
 *    tree on localhost, `reader-last-mile-finalize.mts --prepare` projects the
 *    census, every route executor re-executes at this head, and
 *    `--renew-holdings` inherits unaffected rows from the committed closure and
 *    recomputes only the invalidated ones. The renewed receipt is validated
 *    in-process before it is called RENEWED.
 * 3. If any step fails, the committed evidence is restored byte-for-byte, the
 *    governed paths of every source whose change touched a holding go back to
 *    HEAD, the registered PURE dependents are regenerated from that RESTORED
 *    tree (RLC-2, 2026-09-05: run #25 left 56 state manifests derived from
 *    the change under holdings back at HEAD, and the suite refused the
 *    survivors for it), and the record says which source, which step, why,
 *    and what was put back. The gate then records the debt and the run goes
 *    red with that attribution. Nothing is hand-edited, the census validator
 *    is not weakened, and `walk:all` is never run.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReaderCensus,
  packReaderEvidence,
  readReaderEvidence,
  validateReaderClosureReceipt,
  type ReaderCensus,
  type ReaderClosureReceipt,
} from "../lib/holdings/reader-census.ts";
import { regenerateStaleDependents, spawningRunner } from "../lib/ops/generated-freshness.ts";
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
import { readRefreshRun, writeRefreshRun, type RefreshRenewal, type RefreshRenewalStep } from "../lib/ops/refresh-report.ts";
import { restoreRefusedChange } from "./lib/refresh-revert.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_PATH = "docs/evidence/reader-last-mile-final-closure-receipt.json";
const argv = process.argv.slice(2);
const prefix = argv.find((a) => a.startsWith("--prefix="))?.slice("--prefix=".length) ?? "docs/evidence/reader-last-mile-refresh";
const port = Number(argv.find((a) => a.startsWith("--port="))?.slice("--port=".length) ?? "3210");
const base = `http://localhost:${port}`;
const temp = process.env.READER_RENEWAL_TEMP ?? process.env.RUNNER_TEMP ?? tmpdir();
const workDir = join(temp, "reader-renewal");
mkdirSync(workDir, { recursive: true });
const isWindows = process.platform === "win32";
const corepack = isWindows ? "corepack.cmd" : "corepack";

function git(args: string[]): string {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr ?? "").trim()}`);
  return r.stdout;
}
function tail(text: string, lines = 8): string {
  // The message a failure names is usually above its stack; keep the first
  // lines that say error/assert/fail, then the last few, so a refusal record
  // reads as a reason rather than as a stack trace.
  const all = text.trim().split("\n").filter((line) => line.trim().length > 0);
  const named = all.filter((line) => /error|assert|fail|refus|unknown|cannot/i.test(line) && !/^\s+at /.test(line)).slice(0, 4);
  const last = all.slice(-lines).filter((line) => !/^\s+at /.test(line));
  return [...new Set([...named, ...last])].join(" | ").slice(0, 700);
}
function runChild(name: string, command: string, args: string[], env: Record<string, string>, timeoutMinutes = 25): string {
  console.log(`\n  $ ${command} ${args.join(" ")}`);
  const r = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMinutes * 60 * 1000,
    shell: isWindows && command.endsWith(".cmd"),
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(output.length > 20_000 ? `${output.slice(0, 8_000)}\n… (${output.length} chars) …\n${output.slice(-8_000)}` : output);
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${name} exited ${r.status}: ${tail(output)}`);
  return output;
}

const exactHead = git(["rev-parse", "HEAD"]).trim();
const ranAt = new Date().toISOString();
const run = readRefreshRun(ROOT);
if (!run) {
  console.error("refresh-reader-renewal: CANNOT RUN — docs/refresh-run.json does not exist; the orchestrator did not write its record");
  process.exit(1);
}

const receipt = JSON.parse(readReaderEvidence(ROOT, RECEIPT_PATH).toString("utf8")) as ReaderClosureReceipt;
const provedCensus = JSON.parse(readReaderEvidence(ROOT, receipt.censusPath).toString("utf8")) as ReaderCensus;
const current = buildReaderCensus(ROOT);
const changed = changedHoldings(provedCensus.holdings, current.holdings);
const record = (renewal: RefreshRenewal): void => {
  run.renewal = renewal;
  writeRefreshRun(ROOT, run, REFRESH_SOURCES);
  for (const line of renewalSummary(renewal)) console.log(line);
};

if (changed.length === 0) {
  console.log(`refresh-reader-renewal · every canonical holding matches the committed closure (${current.holdings.length} holdings) — no renewal needed`);
  record(notNeededRenewal(exactHead, ranAt));
  process.exit(0);
}

console.log(`refresh-reader-renewal · ${changed.length} canonical holding(s) changed against the committed closure:`);
for (const path of changed) console.log(`  ${path}`);
const touching = sourcesTouchingHoldings(REFRESH_SOURCES, changed);
const unowned = unownedHoldings(REFRESH_SOURCES, changed);
const steps: RefreshRenewalStep[] = [];
let server: ChildProcess | null = null;

function stopServer(): void {
  if (!server) return;
  const child = server;
  server = null;
  try {
    if (isWindows && child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}
function refuse(failure: string): never {
  stopServer();
  // RLC-2 (2026-09-05): the refused change goes back to HEAD — the committed
  // Reader evidence first, then every touching source's governed paths — and
  // the registered PURE dependents are regenerated from the RESTORED tree
  // before the gate's suite validates it. Run #25 reverted the holdings alone
  // and left 56 state manifests regenerated from the changed tree; the suite
  // then refused the survivors for a staleness the refusal itself had made.
  // One shared move (scripts/lib/refresh-revert.ts), the same registry and
  // runner the gate and the push door use, for whichever source is refused.
  const runner = spawningRunner(ROOT);
  const restore = restoreRefusedChange({
    git,
    root: ROOT,
    groups: [
      { id: "committed Reader evidence", paths: ["docs/evidence"] },
      ...touching.map((source) => ({ id: source.id, paths: REFRESH_SOURCES.find((s) => s.id === source.id)!.governs })),
    ],
    runCheck: runner,
    runGen: (command) => runner(command),
    log: (line) => console.log(`  ${line}`),
  });
  record(failedRenewal({ exactHead, ranAt, changedHoldings: changed, prefix: steps.length ? prefix : null, steps, failure, sources: REFRESH_SOURCES, restore }));
  // The refusal is recorded, attributed and reverted: the gate now runs over the
  // survivors. A non-zero exit here would hide the survivors' own verdict.
  process.exit(0);
}
// RLC-2's proof seam (2026-09-05): READER_RENEWAL_REFUSE_AT names a step that
// must fail on purpose AFTER its work, so the refusal path — restore,
// regenerate, record — is exercised end to end without planting a defect.
// refresh-daily.yml never sets it (tests/refresh-renewal.test.ts pins that);
// a run that sets it can only refuse, never renew.
const refuseAt = process.env.READER_RENEWAL_REFUSE_AT?.trim() || null;
async function step(name: string, work: () => Promise<string | void> | string | void): Promise<void> {
  const started = Date.now();
  try {
    const detail = await work();
    if (refuseAt === name) throw new Error(`refused on purpose: READER_RENEWAL_REFUSE_AT=${name}`);
    steps.push({ name, ok: true, secs: Math.round((Date.now() - started) / 1000), detail: detail ? String(detail).slice(0, 300) : null });
    console.log(`  ok   ${name} (${steps[steps.length - 1].secs}s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({ name, ok: false, secs: Math.round((Date.now() - started) / 1000), detail: message.slice(0, 600) });
    console.log(`  FAIL ${name}: ${message.slice(0, 600)}`);
    refuse(`${name}: ${message.slice(0, 400)}`);
  }
}

if (unowned.length > 0) {
  refuse(
    `canonical holding(s) changed that no refresh source governs (${unowned.join(", ")}): the committed receipt was already stale before this refresh, ` +
      "which is a defect on main, not a source's; a refresh cannot renew a proof it did not invalidate",
  );
}

const preparedCensus = join(workDir, "prepared-census.json");
const proofSources = join(workDir, "proof-sources.json");
const buildLog = join(workDir, "reader-final-build.log");
// reader-last-mile-census.mts resolves --output against the repo root, so this
// scratch path is repo-relative; .scratch/ is gitignored and never committed.
const censusScratchDir = ".scratch/reader-renewal";
mkdirSync(join(ROOT, censusScratchDir), { recursive: true });
const censusOutput = `${censusScratchDir}/renewal-census.json`;
const proofEnv = { READER_FINAL_PREPARED_CENSUS: preparedCensus, READER_PROOF_SOURCES: proofSources, SHOOT_BASE_URL: base };
const node = process.execPath;

await step("regenerate stale PURE dependents", () => {
  const runner = spawningRunner(ROOT);
  const regen = regenerateStaleDependents({ runCheck: runner, runGen: (command) => runner(command), log: (line) => console.log(`    ${line}`) });
  if (regen.failed.length > 0) throw new Error(`a dependent could not be regenerated: ${regen.failed.map((f) => f.command).join(", ")}`);
  return `${regen.regenerated.length} regenerated`;
});

await step("exact-head production build", () => {
  const output = runChild("build", corepack, ["pnpm", "build"], { COMMIT_REF: exactHead, WTP_BUILD_CONTEXT: "reader-renewal" }, 40);
  writeFileSync(buildLog, output, "utf8");
  return "build log recorded";
});

await step("serve the build on localhost", async () => {
  server = spawn(corepack, ["pnpm", "exec", "next", "start", "-p", String(port)], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ["ignore", "ignore", "pipe"],
    shell: isWindows,
  });
  let stderr = "";
  server.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/build`, { headers: { "x-wtp-synthetic-run": "refresh-reader-renewal" } });
      if (response.ok) {
        const served = (await response.json()) as { commit?: string };
        if (served.commit === exactHead) return `serving ${exactHead.slice(0, 8)}`;
        throw new Error(`the served build reports commit ${served.commit ?? "unknown"}, not ${exactHead}`);
      }
    } catch (error) {
      if (error instanceof Error && /reports commit/.test(error.message)) throw error;
    }
    if (server.exitCode !== null) throw new Error(`next start exited ${server.exitCode}: ${tail(stderr)}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`the build did not answer on ${base} within 180s: ${tail(stderr)}`);
});

await step("prepare the census", () => {
  runChild("prepare", node, ["--experimental-strip-types", "scripts/reader-last-mile-finalize.mts", "--prepare"], proofEnv);
  if (!existsSync(preparedCensus) || !existsSync(proofSources)) throw new Error("the prepared census or proof sources were not written");
});

await step("active portrait inventory", () => {
  runChild("census --project", node, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "scripts/reader-last-mile-census.mts", "--project", "--output", censusOutput], proofEnv);
});

const executors: { name: string; script: string; output: string; env?: Record<string, string> }[] = [
  { name: "build receipt", script: "scripts/reader-last-mile-build-receipt.mts", output: "docs/evidence/reader-last-mile-final-build-receipt.json", env: { READER_BUILD_LOG: buildLog } },
  { name: "portraits", script: "scripts/reader-last-mile-portraits.mts", output: "docs/evidence/reader-last-mile-final-portraits.json" },
  { name: "delta routes", script: "scripts/reader-last-mile-final-delta-routes.mts", output: "docs/evidence/reader-last-mile-final-delta-routes.json" },
  { name: "ballot", script: "scripts/reader-last-mile-ballot.mts", output: "docs/evidence/reader-last-mile-final-ballot.json", env: { READER_BALLOT_PLAN_OUTPUT: join(workDir, "ballot-plan.json") } },
  { name: "ballot ask", script: "docs/evidence/reader-last-mile-ballot-ask.mts", output: "docs/evidence/reader-last-mile-final-ballot-ask.json" },
  { name: "candidate profiles ask", script: "scripts/reader-last-mile-candidate-profiles-ask.mts", output: "docs/evidence/reader-last-mile-final-candidate-profiles-ask.json" },
  { name: "meeting routes", script: "docs/evidence/reader-last-mile-meeting-routes.mts", output: "docs/evidence/reader-last-mile-final-meeting-routes.json" },
  { name: "agenda", script: "scripts/reader-last-mile-agenda.mts", output: "docs/evidence/reader-last-mile-final-agenda.json" },
  { name: "meetings ask", script: "docs/evidence/reader-last-mile-meetings-ask.mts", output: "docs/evidence/reader-last-mile-final-meetings-ask.json" },
  { name: "meeting knowledge ask", script: "docs/evidence/reader-last-mile-meeting-knowledge-ask.mts", output: "docs/evidence/reader-last-mile-final-meeting-knowledge-ask.json" },
  { name: "money ask", script: "docs/evidence/reader-last-mile-money-ask.mts", output: "docs/evidence/reader-last-mile-final-money-ask.json" },
  { name: "federal money ask", script: "docs/evidence/reader-last-mile-federal-money-ask.mts", output: "docs/evidence/reader-last-mile-final-federal-money-ask.json" },
  { name: "final render and witnesses", script: "scripts/reader-last-mile-final-render.mts", output: "docs/evidence/reader-last-mile-final-render.json" },
];
for (const executor of executors) {
  await step(executor.name, () => {
    runChild(executor.name, node, ["--import", "tsx", executor.script], { ...proofEnv, READER_PROOF_OUTPUT: executor.output, ...(executor.env ?? {}) });
    if (!existsSync(join(ROOT, executor.output))) throw new Error(`${executor.output} was not written`);
  });
}

await step("finalize --renew-holdings", () => {
  runChild("finalize", node, ["--experimental-strip-types", "scripts/reader-last-mile-finalize.mts", "--renew-holdings"], { ...proofEnv, READER_HOLDING_RENEWAL_PREFIX: prefix });
});

await step("pack the executed evidence losslessly", () => {
  // The committed evidence is gzip plus a manifest carrying the original byte
  // hash (packReaderEvidence); readReaderEvidence reads either form, so the
  // receipt written above binds the same bytes before and after packing. The
  // finalizer packs the census and the components itself; the rest is packed
  // here, exactly as every prior closure and renewal committed it.
  const plain = [
    ...executors.map((executor) => executor.output),
    "docs/evidence/reader-last-mile-final-invalidation.json",
    "docs/evidence/reader-last-mile-final-bundle.json",
  ];
  let packed = 0;
  for (const path of plain) {
    if (!existsSync(join(ROOT, path))) continue;
    packReaderEvidence(ROOT, path);
    packed += 1;
  }
  return `${packed} file(s) packed`;
});

await step("validate the renewed receipt", () => {
  const renewed = JSON.parse(readReaderEvidence(ROOT, RECEIPT_PATH).toString("utf8")) as ReaderClosureReceipt;
  const failures = validateReaderClosureReceipt(ROOT, renewed);
  if (failures.length > 0) throw new Error(`${failures.length} validator failure(s): ${failures.slice(0, 5).join("; ")}`);
  return `holdings digest ${renewed.holdingsDigest.slice(0, 8)}, ${renewed.sourceHashes.length} sources bound`;
});

stopServer();
rmSync(censusOutput, { force: true });
record(renewedRenewal({ exactHead, ranAt, changedHoldings: changed, prefix, steps }));
process.exit(0);
