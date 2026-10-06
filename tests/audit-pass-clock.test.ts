import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { AUDIT_PASSES, auditPassClock, duePasses, type AuditPass, type PassRun } from "../scripts/audit-pass-clock.mts";

const T0 = Date.parse("2026-10-06T06:00:00.000Z");
const HOUR = 60 * 60_000;
const passes: AuditPass[] = [
  { id: "hourly", says: "hourly", args: ["scripts/a.mts"], everyMs: HOUR },
  { id: "daily", says: "daily", args: ["scripts/b.mts"], everyMs: 24 * HOUR },
];
const iso = (ms: number) => new Date(ms).toISOString();

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "audit-pass-clock-"));
  const statePath = join(dir, ".mirror", "audit-pass-clock.json");
  let clock = T0;
  const ran: string[] = [];
  const lines: string[] = [];
  const pending: { resolve: (run: PassRun) => void }[] = [];
  const ended: string[] = [];
  const clockApi = auditPassClock({
    statePath, passes, codeRoot: () => "/code", env: () => ({}) as NodeJS.ProcessEnv, now: () => clock,
    log: (l) => lines.push(l), error: (l) => lines.push(`ERR ${l}`),
    runPass: (pass, root, _env, onStarted) => {
      assert.equal(root, "/code");
      ran.push(pass.id);
      onStarted({ pid: 1 } as ChildProcess);
      return new Promise((resolve) => pending.push({ resolve }));
    },
    endChild: async () => {
      ended.push("ended");
      pending.shift()?.resolve({ status: null, stdout: "", stderr: "", errorMessage: "ended" });
    },
  });
  return {
    clockApi, statePath, ran, lines, ended,
    advance: (ms: number) => { clock += ms; },
    finish: async (run: PassRun) => { pending.shift()?.resolve(run); await new Promise((r) => setImmediate(r)); },
  };
}

describe("audit pass clock", () => {
  it("runs every never-run pass, most overdue first, in the runner's list order", () => {
    assert.deepEqual(duePasses(passes, {}, T0).map((p) => p.id), ["hourly", "daily"]);
    assert.deepEqual(duePasses(passes, { hourly: iso(T0 - 2 * HOUR), daily: iso(T0 - 25 * HOUR) }, T0).map((p) => p.id), ["hourly", "daily"]);
    assert.deepEqual(duePasses(passes, { hourly: iso(T0 - 2 * HOUR), daily: iso(T0 - 30 * HOUR) }, T0).map((p) => p.id), ["daily", "hourly"]);
    assert.deepEqual(duePasses(passes, { hourly: iso(T0 - 10 * 60_000), daily: iso(T0 - HOUR) }, T0), []);
  });

  it("schedules every auditors pass the live ledger found never running", () => {
    const scripts = AUDIT_PASSES.map((p) => p.args[0]);
    for (const script of ["scripts/live-audit-pass.mts", "scripts/look-pass.mts", "scripts/resident-tasks.mts", "scripts/worst-case-speed-pass.mts",
      "scripts/claim-audit-pass.mts", "scripts/loss-study-pass.mts", "scripts/break-pattern-pass.mts"]) {
      assert.ok(scripts.includes(script), `${script} is scheduled`);
    }
    assert.ok(AUDIT_PASSES.some((p) => p.args.includes("--if-queued") && p.everyMs <= HOUR), "a newly published ZIP gets its first tasks within the hour");
    assert.ok(AUDIT_PASSES.every((p) => p.everyMs <= 24 * HOUR));
  });

  it("runs one pass at a time and keeps its start across a restart", async () => {
    const h = harness();
    h.clockApi.start();
    assert.deepEqual(h.ran, ["hourly"]);
    assert.equal(h.clockApi.tick(), null, "nothing else starts while a pass runs");
    await h.finish({ status: 0, stdout: "live audit: 12 sampled\n", stderr: "", errorMessage: null });
    assert.equal(h.clockApi.tick(), "daily");
    await h.finish({ status: 1, stdout: "", stderr: "boom\nloss study: nothing was measured\n", errorMessage: null });
    assert.ok(h.lines.some((l) => l.includes("hourly OK") && l.includes("12 sampled")));
    assert.ok(h.lines.some((l) => l.startsWith("ERR") && l.includes("daily FAILED exit 1") && l.includes("nothing was measured")));
    assert.equal(h.clockApi.tick(), null, "a failed pass is not retried before its turn");
    await h.clockApi.stop();

    const starts = JSON.parse(readFileSync(h.statePath, "utf8"));
    assert.deepEqual(starts, { hourly: iso(T0), daily: iso(T0) });
    // A new runner an hour later runs only the hourly pass.
    const again = auditPassClock({ statePath: h.statePath, passes, codeRoot: () => "/code", env: () => ({}) as NodeJS.ProcessEnv, now: () => T0 + HOUR,
      log: () => undefined, runPass: (pass) => { h.ran.push(`again:${pass.id}`); return new Promise(() => undefined); } });
    again.start();
    assert.equal(again.running(), "hourly");
    assert.equal(again.tick(), null);
    assert.ok(!h.ran.includes("again:daily"));
    // stop() with no child handed over still returns once the pass settles; here it never does, so stop the timer only.
    void again.stop();
  });

  it("a release drain ends the running pass and gives its turn back", async () => {
    const h = harness();
    h.clockApi.start();
    await h.finish({ status: 0, stdout: "", stderr: "", errorMessage: null });
    h.clockApi.tick();
    assert.equal(h.clockApi.running(), "daily");
    await h.clockApi.stop();
    assert.deepEqual(h.ended, ["ended"]);
    assert.equal(h.clockApi.running(), null);
    const starts = JSON.parse(readFileSync(h.statePath, "utf8"));
    assert.deepEqual(starts, { hourly: iso(T0) }, "the ended daily pass is due again on the next runner");
    assert.ok(h.lines.some((l) => l.includes("ended by the release drain")));
    assert.equal(h.clockApi.tick(), null, "a stopped clock starts nothing");
  });

  it("WTP_AUDIT_PASSES=off leaves every pass out", () => {
    const ran: string[] = [];
    const lines: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "audit-pass-clock-"));
    const off = auditPassClock({ statePath: join(dir, "s.json"), passes, codeRoot: () => "/code", env: () => ({ WTP_AUDIT_PASSES: "off" }) as unknown as NodeJS.ProcessEnv,
      log: (l) => lines.push(l), runPass: async (pass) => { ran.push(pass.id); return { status: 0, stdout: "", stderr: "", errorMessage: null }; } });
    off.start();
    assert.deepEqual(ran, []);
    assert.ok(lines.some((l) => l.includes("off")));
  });
});
