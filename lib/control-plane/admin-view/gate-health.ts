/** Read-only health rows: no gate here can hold publishing. A gate with no reading says "not measured" and why, never a guessed pass. */
import type { RunnerHeartbeat } from "../owner-surface.ts";
import { livenessOf } from "../owner-surface.ts";

export type GateHealthState = "pass" | "attention" | "not_measured";

export interface GateHealthRow {
  readonly id: string;
  readonly name: string;
  readonly state: GateHealthState;
  readonly sentence: string;
}

export interface GateHealthReadings {
  readonly nowIso: string;
  readonly heartbeat: RunnerHeartbeat | null;
  readonly databaseReachable: boolean | null;
  readonly lastDispatch: { readonly finishedAt: string; readonly durableResult: boolean } | null;
  readonly spend: {
    readonly rolling24HoursUsd: number | null;
    readonly effectiveCeilingUsd: number | null;
    readonly worstCaseCharges: number;
  } | null;
}

const NOT_MEASURED: readonly { id: string; name: string; why: string }[] = [
  { id: "GATE-05", name: "Scouts receive what we already know", why: "No reading yet records what an actual scout was handed." },
  { id: "GATE-08", name: "Bad data cannot replace good data", why: "Publication refusals are counted elsewhere; no single reading covers this yet." },
  { id: "GATE-09", name: "Each kind of fact reaches a reader", why: "Per-family reader checks are not recorded yet." },
  { id: "GATE-10", name: "Status is honest", why: "No automatic reading exists for this." },
  { id: "GATE-11", name: "Sources and privacy", why: "No automatic reading exists for this." },
];

function row(id: string, name: string, state: GateHealthState, sentence: string): GateHealthRow {
  return { id, name, state, sentence };
}

function runningRelease(r: GateHealthReadings): GateHealthRow {
  const name = "The runner is on the released code";
  if (!r.heartbeat) return row("GATE-02", name, "not_measured", "No runner heartbeat has been recorded.");
  const live = livenessOf(r.heartbeat, r.nowIso);
  if (live.state !== "ALIVE") return row("GATE-02", name, "attention", `The runner is not beating on time. ${live.detail}`);
  const verdict = r.heartbeat.codeIdentity?.verdict ?? null;
  if (verdict === null || verdict === "CANNOT_TELL") {
    return row("GATE-02", name, "not_measured", "The runner is beating, but which code it runs could not be compared with the released code.");
  }
  if (verdict === "CONSISTENT") return row("GATE-02", name, "pass", "The runner is beating and runs the released code.");
  return row("GATE-02", name, "attention", r.heartbeat.codeIdentity?.detail ?? "The runner is not on the released code.");
}

function databaseReach(r: GateHealthReadings): GateHealthRow {
  const name = "The runner reaches the database";
  if (r.databaseReachable === null) return row("GATE-03", name, "not_measured", "No cycle has reported whether the database was reached.");
  return r.databaseReachable
    ? row("GATE-03", name, "pass", "The last cycle reached the database.")
    : row("GATE-03", name, "attention", "The last cycle could not reach the database.");
}

function dispatch(r: GateHealthReadings): GateHealthRow {
  const name = "Waiting work is being sent out";
  if (!r.lastDispatch) return row("GATE-04", name, "not_measured", "No normal dispatch has been recorded.");
  return r.lastDispatch.durableResult
    ? row("GATE-04", name, "pass", "The last normal dispatch finished and left a saved result.")
    : row("GATE-04", name, "attention", "The last normal dispatch finished without a saved result.");
}

function spendControl(r: GateHealthReadings): GateHealthRow {
  const name = "Spending stays under the ceiling";
  const s = r.spend;
  if (!s || s.rolling24HoursUsd === null || s.effectiveCeilingUsd === null) {
    return row("GATE-06", name, "not_measured", "Spend or the ceiling could not be read.");
  }
  if (s.rolling24HoursUsd > s.effectiveCeilingUsd) {
    return row("GATE-06", name, "attention", "Spend over the last day is above the ceiling.");
  }
  if (s.worstCaseCharges > 0) {
    return row("GATE-06", name, "attention", `${s.worstCaseCharges} charge${s.worstCaseCharges === 1 ? " was" : "s were"} counted at the worst case because no price was recorded.`);
  }
  return row("GATE-06", name, "pass", "Spend over the last day is under the ceiling and every charge is priced.");
}

function schedule(r: GateHealthReadings): GateHealthRow {
  const name = "Scheduled work is not silently blocked";
  const h = r.heartbeat;
  if (!h) return row("GATE-07", name, "not_measured", "No runner heartbeat has been recorded.");
  if (h.pause) return row("GATE-07", name, "attention", "The runner is paused by an order, so no scheduled work is running.");
  if (!h.nextCycleDueAt) return row("GATE-07", name, "not_measured", "The runner has not said when its next cycle is due.");
  const due = Date.parse(h.nextCycleDueAt);
  const now = Date.parse(r.nowIso);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return row("GATE-07", name, "not_measured", "The next cycle time could not be read.");
  return due < now - 30 * 60_000
    ? row("GATE-07", name, "attention", "The next cycle was due more than 30 minutes ago.")
    : row("GATE-07", name, "pass", "The next cycle is scheduled and not overdue.");
}

function overnight(r: GateHealthReadings): GateHealthRow {
  const name = "The runner keeps going overnight";
  const h = r.heartbeat;
  if (!h) return row("GATE-12", name, "not_measured", "No runner heartbeat has been recorded.");
  const live = livenessOf(h, r.nowIso);
  if (live.state === "SILENT" || live.state === "NEVER_BEAT") return row("GATE-12", name, "attention", live.detail);
  if (h.lastCycleOk === false) return row("GATE-12", name, "attention", "The last cycle did not finish cleanly.");
  if (h.lastCycleOk === null) return row("GATE-12", name, "not_measured", "The last cycle has not reported how it ended.");
  return row("GATE-12", name, "pass", "The runner is beating and its last cycle finished cleanly.");
}

export function readGateHealth(readings: GateHealthReadings): readonly GateHealthRow[] {
  const measured = [
    runningRelease(readings),
    databaseReach(readings),
    dispatch(readings),
    spendControl(readings),
    schedule(readings),
    overnight(readings),
  ];
  const unmeasured = NOT_MEASURED.map((g) => row(g.id, g.name, "not_measured", g.why));
  return [...measured, ...unmeasured].sort((a, b) => a.id.localeCompare(b.id));
}

/** Counts shown beside the group; "not measured" is never folded into pass or attention. */
export function summarizeGateHealth(rows: readonly GateHealthRow[]): { pass: number; attention: number; notMeasured: number; total: number } {
  return {
    pass: rows.filter((r) => r.state === "pass").length,
    attention: rows.filter((r) => r.state === "attention").length,
    notMeasured: rows.filter((r) => r.state === "not_measured").length,
    total: rows.length,
  };
}
