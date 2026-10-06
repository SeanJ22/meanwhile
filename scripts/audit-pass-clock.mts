/**
 * The standing runner's clock for the auditors' passes (DP-13, DP-29, DP-32,
 * DP-33/DP-34, FE-02, FE-18, FE-21). Before this clock nothing ran them:
 * release 8's live ledger found cp_log_live_audits empty, so Admin could show
 * no audited fact, no resident task, no look at a deploy and no speed pass.
 *
 * One pass runs at a time, the most overdue first, so two browser passes never
 * share the droplet's memory. Each pass is its own child process from the
 * code the runner is on. When a pass last started is kept in a host-local file
 * under `.mirror/` (never the checkout), so a restart does not repeat a daily
 * pass. A release drain ends the running pass and gives back its turn, so the
 * next runner starts it again. A failure is printed and never stops the runner.
 * `WTP_AUDIT_PASSES=off` on the runner leaves every pass out.
 *
 * Control-plane reads (Neon), at most, per hour: the live audit reads one
 * Admin settings row and the week's audit rows (about 1 KB each, at most 60
 * a pass, so under 10 MB by the week's end); the look check and first-run
 * check read their small key rows (a few KB). Once a day the loss study reads
 * the hunts and the held and published work items (cp_work_items is 45 MB in
 * all), about 2-4 MB an hour spread over the day. Total well under 20 MB an
 * hour against the 0.7 GB target. Civic pages are read on the reader
 * database or the live site, not the control plane.
 */
import type { ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { endOwnedProcessTree, runRuntimeChildren } from "./pilot-runtime-child.mts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export interface AuditPass {
  readonly id: string;
  /** What it does, in the runner's log. */
  readonly says: string;
  readonly args: readonly string[];
  readonly everyMs: number;
}

export const AUDIT_PASSES: readonly AuditPass[] = [
  { id: "look-check", says: "look check of the latest deploy (FE-21)", args: ["scripts/look-pass.mts"], everyMs: 15 * 60_000 },
  { id: "live-audit", says: "live audit of published facts (DP-13)", args: ["scripts/live-audit-pass.mts"], everyMs: HOUR },
  { id: "first-tasks", says: "resident tasks at newly published ZIPs (FE-18)", args: ["scripts/resident-tasks.mts", "--if-queued"], everyMs: HOUR },
  { id: "resident-tasks", says: "daily resident tasks (FE-18)", args: ["scripts/resident-tasks.mts"], everyMs: DAY },
  { id: "speed", says: "worst-case speed on production (FE-02)", args: ["scripts/worst-case-speed-pass.mts"], everyMs: DAY },
  { id: "claim-audit", says: "claim audit and Proven labels (DP-33, DP-34)", args: ["scripts/claim-audit-pass.mts"], everyMs: DAY },
  { id: "loss-study", says: "loss study (DP-29)", args: ["scripts/loss-study-pass.mts"], everyMs: DAY },
  { id: "break-patterns", says: "break patterns (DP-32)", args: ["scripts/break-pattern-pass.mts"], everyMs: DAY },
];

/** A look check may wait up to 60 minutes on its batch; past 75 minutes with no output a pass is ended. */
export const AUDIT_PASS_NO_PROGRESS_MS = 75 * 60_000;
const TICK_MS = 60_000;

export type AuditPassStarts = Readonly<Record<string, string>>;

/** The passes due at `nowMs`, most overdue first; one never run is the most overdue. */
export function duePasses(passes: readonly AuditPass[], starts: AuditPassStarts, nowMs: number): AuditPass[] {
  const overdue = (pass: AuditPass) => {
    const last = Date.parse(starts[pass.id] ?? "");
    return Number.isFinite(last) ? nowMs - last - pass.everyMs : Number.POSITIVE_INFINITY;
  };
  return passes.filter((pass) => overdue(pass) >= 0)
    .sort((a, b) => overdue(b) - overdue(a) || passes.indexOf(a) - passes.indexOf(b));
}

export function readStarts(path: string): AuditPassStarts {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

function writeStarts(path: string, starts: AuditPassStarts): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(starts, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

export interface PassRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorMessage: string | null;
}

export interface AuditPassClockOptions {
  readonly statePath: string;
  /** The checkout new children start from (the runner's CODE_ROOT). */
  readonly codeRoot: () => string;
  readonly env: () => NodeJS.ProcessEnv;
  readonly passes?: readonly AuditPass[];
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  readonly error?: (line: string) => void;
  /** Runs one pass to its end; `onStarted` hands over the child so a drain can end it. */
  readonly runPass?: (pass: AuditPass, root: string, env: NodeJS.ProcessEnv, onStarted: (child: ChildProcess) => void) => Promise<PassRun>;
  readonly endChild?: (child: ChildProcess) => Promise<void>;
}

export interface AuditPassClock {
  start(): void;
  /** Start the most overdue pass if none is running; returns its id. */
  tick(): string | null;
  /** Stop the clock and end the running pass; its turn is given back. */
  stop(): Promise<void>;
  running(): string | null;
}

const lastLine = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? null;

function defaultRunPass(pass: AuditPass, root: string, env: NodeJS.ProcessEnv, onStarted: (child: ChildProcess) => void): Promise<PassRun> {
  return runRuntimeChildren([{
    id: `audit-pass:${pass.id}`,
    executable: process.execPath,
    args: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", ...pass.args],
    env,
  }], {
    cwd: root, env, maxBufferBytes: 4 * 1024 * 1024, noProgressMs: AUDIT_PASS_NO_PROGRESS_MS,
    onStarted: (_id, child) => onStarted(child),
  }).then(([run]) => run ?? { status: null, stdout: "", stderr: "", errorMessage: "child result missing" });
}

export function auditPassClock(options: AuditPassClockOptions): AuditPassClock {
  const passes = options.passes ?? AUDIT_PASSES;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  const error = options.error ?? ((line: string) => console.error(line));
  const runPass = options.runPass ?? defaultRunPass;
  const endChild = options.endChild ?? endOwnedProcessTree;
  let timer: ReturnType<typeof setInterval> | null = null;
  let current: { pass: AuditPass; previous: string | undefined; child: ChildProcess | null; ending: boolean; done: Promise<void> } | null = null;

  const tick = (): string | null => {
    if (current !== null || timer === null) return null;
    const starts = readStarts(options.statePath);
    const pass = duePasses(passes, starts, now())[0];
    if (!pass) return null;
    const startedAt = new Date(now()).toISOString();
    try {
      writeStarts(options.statePath, { ...starts, [pass.id]: startedAt });
    } catch (e) {
      // Without the clock file a restart would repeat the pass; it is still better run than skipped.
      error(`  audit pass ${pass.id}: its start could not be kept (${e instanceof Error ? e.message : String(e)})`);
    }
    const started = now();
    const run = { pass, previous: starts[pass.id], child: null as ChildProcess | null, ending: false, done: Promise.resolve() };
    log(`  audit pass: ${pass.says} started`);
    // Started now, not on a later turn, so the child exists before anything can ask to end it.
    run.done = (async () => runPass(pass, options.codeRoot(), options.env(), (child) => { run.child = child; }))()
      .then((result) => {
        const seconds = Math.round((now() - started) / 1000);
        if (run.ending) {
          // Ended by a release drain: give the turn back so the next runner starts it again.
          const starts = readStarts(options.statePath);
          const { [pass.id]: _dropped, ...rest } = starts;
          writeStarts(options.statePath, run.previous === undefined ? rest : { ...rest, [pass.id]: run.previous });
          log(`  audit pass: ${pass.says} ended by the release drain after ${seconds}s; it runs again on the next runner`);
        } else if (result.status === 0) {
          log(`  audit pass: ${pass.says} OK (${seconds}s)${lastLine(result.stdout) ? ` — ${lastLine(result.stdout)}` : ""}`);
        } else {
          const exit = result.status === null ? "no exit" : `exit ${result.status}`;
          error(`  audit pass: ${pass.says} FAILED ${exit} after ${seconds}s — ${lastLine(result.stderr) ?? result.errorMessage ?? "(nothing on stderr)"}`);
        }
      })
      .catch((e: unknown) => error(`  audit pass: ${pass.says} FAILED — ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        current = null;
      });
    current = run;
    return pass.id;
  };

  return {
    start() {
      if (timer !== null) return;
      if (options.env().WTP_AUDIT_PASSES === "off" || process.env.WTP_AUDIT_PASSES === "off") {
        log("  audit passes: off (WTP_AUDIT_PASSES=off)");
        return;
      }
      timer = setInterval(tick, TICK_MS);
      timer.unref?.();
      tick();
    },
    tick,
    async stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
      const run = current;
      if (run === null) return;
      run.ending = true;
      if (run.child !== null) await endChild(run.child).catch(() => run.child?.kill("SIGKILL"));
      await run.done;
    },
    running: () => current?.pass.id ?? null,
  };
}
