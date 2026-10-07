/**
 * Research-window decisions over pipeline state; no reader door and no civic-data promotion.
 * The lock is a CAS lease in `leases`, never `repos.locks`: the Postgres advisory lock is released
 * by the HTTP driver before the guarded section runs.
 */

import { claim, isExpired, release, type ExecutionLease } from "../attempt.ts";
import { fingerprint } from "../ids.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { retryStartupRead, type StartupReadRetryOptions } from "../startup-read-retry.ts";
import type { PipelineItemState } from "./types.ts";
import type {
  ActivationGateReading,
  ItemVerdict,
  RecordClassTally,
  WindowIncident,
  WindowLockFacts,
  WindowRunRecord,
  WindowStageName,
  WindowTrigger,
} from "./types.ts";
import { WINDOW_FORMAT_VERSION } from "./types.ts";
import { scheduledBlackoutAt } from "../fleet-safety.ts";

export const WINDOW_ZONE = "America/New_York";
export const WINDOW_HOUR = 4;
export const WINDOW_LEASE_ID = "nightly-window";
export const WINDOW_LEASE_TTL_MS = 90 * 60_000;
/** A window that starts later than this after its boundary is a CATCH_UP. */
export const CATCH_UP_GRACE_MS = 60 * 60_000;

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Wall-clock parts of an instant in a zone. DST is the zone's business. */
export function zonedParts(iso: string, zone: string = WINDOW_ZONE): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function localDateOf(iso: string, zone: string = WINDOW_ZONE): string {
  const p = zonedParts(iso, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The instant at which a zone's wall clock reads `hour:00` on `localDate`. */
export function zonedInstant(localDate: string, hour: number, zone: string = WINDOW_ZONE): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, hour, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(new Date(guess).toISOString(), zone);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = wall - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess).toISOString();
}

function shiftLocalDate(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export interface WindowDue {
  readonly due: boolean;
  /** The local date the next window answers for. */
  readonly localDate: string;
  /** The 04:00 boundary of that date, as an instant. */
  readonly boundary: string;
  readonly trigger: WindowTrigger;
  /** Local dates no window answered for since the last one, oldest first; excludes `localDate`. */
  readonly caughtUp: readonly string[];
  readonly reason: string;
}

/** With no prior window recorded, nothing before the owed date is claimed missed. */
export function windowDue(input: {
  readonly nowIso: string;
  readonly lastWindowLocalDate: string | null;
  readonly zone?: string;
  readonly hour?: number;
}): WindowDue {
  const zone = input.zone ?? WINDOW_ZONE;
  const hour = input.hour ?? WINDOW_HOUR;
  const today = localDateOf(input.nowIso, zone);
  const todayBoundary = zonedInstant(today, hour, zone);
  const owed = Date.parse(input.nowIso) >= Date.parse(todayBoundary) ? today : shiftLocalDate(today, -1);
  const boundary = zonedInstant(owed, hour, zone);
  if (scheduledBlackoutAt(boundary)) {
    return {
      due: false,
      localDate: owed,
      boundary,
      trigger: "RUNNER_CLOCK",
      caughtUp: [],
      reason:
        `SCHEDULED BLACKOUT: the ${owed} nightly window falls inside Saturday 18:00 through ` +
        "Sunday 06:00 America/Phoenix and is intentionally suppressed, not failed or caught up later",
    };
  }
  if (input.lastWindowLocalDate !== null && input.lastWindowLocalDate >= owed) {
    return {
      due: false,
      localDate: owed,
      boundary,
      trigger: "RUNNER_CLOCK",
      caughtUp: [],
      reason: `the window for ${owed} (${zone}) has already run`,
    };
  }
  const caughtUp: string[] = [];
  if (input.lastWindowLocalDate !== null) {
    for (let d = shiftLocalDate(input.lastWindowLocalDate, 1); d < owed; d = shiftLocalDate(d, 1)) {
      if (!scheduledBlackoutAt(zonedInstant(d, hour, zone))) caughtUp.push(d);
    }
  }
  const late = Date.parse(input.nowIso) - Date.parse(boundary) > CATCH_UP_GRACE_MS;
  const trigger: WindowTrigger = late || caughtUp.length > 0 ? "CATCH_UP" : "RUNNER_CLOCK";
  return {
    due: true,
    localDate: owed,
    boundary,
    trigger,
    caughtUp,
    reason:
      `the window for ${owed} (${zone}, boundary ${boundary}) has not run` +
      (caughtUp.length > 0 ? `; ${caughtUp.length} earlier date(s) also unanswered: ${caughtUp.join(", ")}` : "") +
      (late ? "; started more than an hour past the boundary" : ""),
  };
}

export class WindowLockHeld extends Error {
  readonly holder: string;
  readonly until: string;

  constructor(holder: string, until: string) {
    super(
      `the nightly-window lease is held by ${holder} until ${until}. A second window, or a cycle ` +
        "under a window, is refused rather than interleaved.",
    );
    this.name = "WindowLockHeld";
    this.holder = holder;
    this.until = until;
  }
}

/** The aggregate id is fixed so the slot is the race; the value's own id moves per claim. */
export async function acquireWindowLease(
  repos: ControlPlaneRepositories,
  holder: string,
  now: string,
  ttlMs: number = WINDOW_LEASE_TTL_MS,
  readRetry?: StartupReadRetryOptions,
): Promise<{ readonly lease: ExecutionLease; readonly revision: number }> {
  // Retry only the idempotent read. An uncertain put/CAS response must never
  // re-run the claim or allow work to start without a confirmed lease.
  const existing = readRetry
    ? await retryStartupRead(() => repos.leases.read(WINDOW_LEASE_ID), () => null, readRetry)
    : await repos.leases.read(WINDOW_LEASE_ID);
  if (existing !== null && !isExpired(existing.value, now) && existing.value.holder !== holder) {
    throw new WindowLockHeld(existing.value.holder, existing.value.expiresAt);
  }
  const lease = claim(WINDOW_LEASE_ID, holder, now, ttlMs, existing?.value ?? null);
  if (existing === null) {
    const put = await repos.leases.put(WINDOW_LEASE_ID, lease, now);
    return { lease: put.persisted.value, revision: put.persisted.revision };
  }
  const persisted = await repos.leases.compareAndSet(WINDOW_LEASE_ID, existing.revision, lease, now);
  return { lease: persisted.value, revision: persisted.revision };
}

export async function releaseWindowLease(
  repos: ControlPlaneRepositories,
  holder: string,
  now: string,
): Promise<boolean> {
  const current = await repos.leases.read(WINDOW_LEASE_ID);
  if (current === null || current.value.holder !== holder || current.value.released) return false;
  await repos.leases.compareAndSet(WINDOW_LEASE_ID, current.revision, release(current.value), now);
  return true;
}

/** The process a window-lease holder id names: `<role>@<host>#<pid>`, e.g. `cycle@HOST#1234`. */
export function windowLeaseHolderProcess(
  holder: string,
): { readonly role: string; readonly host: string; readonly pid: number } | null {
  const match = /^([a-z][a-z-]*)@([^#@]+)#(\d+)$/.exec(holder);
  if (match === null) return null;
  const pid = Number(match[3]);
  return Number.isSafeInteger(pid) && pid > 0 ? { role: match[1]!, host: match[2]!, pid } : null;
}

export type ExitedHolderRecovery =
  | { readonly state: "RELEASED"; readonly holder: string; readonly expiresAt: string }
  | { readonly state: "NOT_NEEDED" | "KEPT"; readonly holder: string | null; readonly reason: string };

/**
 * Releases a lease whose holder names a process on this host that no longer exists, through the same
 * compare-and-set as `releaseWindowLease`. Keeps it when another host holds it, the holder names no
 * process, or the pid is live or unreadable.
 */
export async function releaseWindowLeaseOfExitedLocalHolder(
  repos: ControlPlaneRepositories,
  input: { readonly host: string; readonly now: string; readonly processExists: (pid: number) => boolean },
): Promise<ExitedHolderRecovery> {
  const current = await repos.leases.read(WINDOW_LEASE_ID);
  if (current === null || isExpired(current.value, input.now)) {
    return { state: "NOT_NEEDED", holder: current?.value.holder ?? null, reason: "no live window lease stands" };
  }
  const holder = current.value.holder;
  const held = windowLeaseHolderProcess(holder);
  if (held === null) return { state: "KEPT", holder, reason: "the holder does not name a process" };
  if (held.host.toLowerCase() !== input.host.toLowerCase()) {
    return { state: "KEPT", holder, reason: `held on host ${held.host}, whose processes this host cannot see` };
  }
  if (input.processExists(held.pid)) return { state: "KEPT", holder, reason: `process ${held.pid} still exists` };
  await repos.leases.compareAndSet(WINDOW_LEASE_ID, current.revision, release(current.value), input.now);
  return { state: "RELEASED", holder, expiresAt: current.value.expiresAt };
}

/** Released in a finally; a dead process holds nothing past the TTL. */
export async function withNightlyWindowLease<R>(
  repos: ControlPlaneRepositories,
  holder: string,
  now: () => string,
  fn: (facts: WindowLockFacts) => Promise<R>,
  ttlMs: number = WINDOW_LEASE_TTL_MS,
): Promise<R> {
  const claimed = await acquireWindowLease(repos, holder, now(), ttlMs);
  const facts: WindowLockFacts = {
    leaseId: claimed.lease.id,
    holder,
    claimedAt: claimed.lease.claimedAt,
    expiresAt: claimed.lease.expiresAt,
    releasedAt: null,
  };
  try {
    return await fn(facts);
  } finally {
    await releaseWindowLease(repos, holder, now());
  }
}

/** DEFER retains the window-level execution reason. */
export function evaluateItems(
  states: readonly PipelineItemState[],
  gate: Pick<ActivationGateReading, "openRecordClasses" | "openFields">,
  deferAll: string | null = null,
): { readonly verdicts: readonly ItemVerdict[]; readonly byRecordClass: readonly RecordClassTally[] } {
  void gate; // Compatibility argument for saved window callers; never publication authority.
  const verdicts: ItemVerdict[] = states.map((s) => {
    const recordClass = s.recordClass ?? "unknown";
    const base = { itemId: s.itemId, recordClass, stage: s.stage };
    if (deferAll !== null) return { ...base, verdict: "DEFER", reason: deferAll };
    const lastRefusal =
      s.refused === null ? "" : `; last refused offer at ${s.refused.atStage}: ${s.refused.reasons.map((r) => r.code).join(", ")}`;
    if (s.stage !== "APPROVED_FOR_PROMOTION") {
      return { ...base, verdict: "REFUSE_WOULD", reason: `at ${s.stage ?? "no accepted stage"}; APPROVED_FOR_PROMOTION is required${lastRefusal}` };
    }
    if (s.recordClass === null) return { ...base, verdict: "DEFER", reason: "the item names no record class or reader door" };
    return { ...base, verdict: "PROMOTE_WOULD", reason: "Verified fact is approved for its reader door" };
  });
  const tallies = new Map<string, { items: number; promoteWould: number; refuseWould: number; deferred: number }>();
  for (const v of verdicts) {
    const t = tallies.get(v.recordClass) ?? { items: 0, promoteWould: 0, refuseWould: 0, deferred: 0 };
    t.items += 1;
    if (v.verdict === "PROMOTE_WOULD") t.promoteWould += 1;
    if (v.verdict === "REFUSE_WOULD") t.refuseWould += 1;
    if (v.verdict === "DEFER") t.deferred += 1;
    tallies.set(v.recordClass, t);
  }
  return {
    verdicts,
    byRecordClass: [...tallies.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([recordClass, t]) => ({ recordClass, ...t })),
  };
}

/** A window record this module wrote, as opposed to a foreign row under the same log. */
export function isWindowRunRecord(value: unknown): value is WindowRunRecord {
  if (value === null || typeof value !== "object") return false;
  const r = value as { formatVersion?: unknown; windowId?: unknown; localDate?: unknown; finishedAt?: unknown; stages?: unknown };
  return (
    r.formatVersion === WINDOW_FORMAT_VERSION &&
    typeof r.windowId === "string" &&
    typeof r.localDate === "string" &&
    typeof r.finishedAt === "string" &&
    Array.isArray(r.stages)
  );
}

export function isWindowIncident(value: unknown): value is WindowIncident {
  if (value === null || typeof value !== "object") return false;
  const r = value as { formatVersion?: unknown; incidentId?: unknown; windowId?: unknown; stage?: unknown };
  return r.formatVersion === WINDOW_FORMAT_VERSION && typeof r.incidentId === "string" && typeof r.windowId === "string" && typeof r.stage === "string";
}

/** The newest local date any window record answers for. Null when none exists. */
export function lastWindowLocalDate(records: readonly unknown[]): string | null {
  const dates = records.filter(isWindowRunRecord).map((r) => r.localDate).sort();
  return dates.at(-1) ?? null;
}

export function openIncident(input: {
  readonly windowId: string;
  readonly stage: WindowStageName | "LOCK";
  readonly code: string;
  readonly detail: string;
  readonly openedAt: string;
  readonly missedScope: readonly string[];
}): WindowIncident {
  return {
    formatVersion: WINDOW_FORMAT_VERSION,
    incidentId: `wi-${fingerprint([input.windowId, input.stage, input.code])}`,
    windowId: input.windowId,
    stage: input.stage,
    code: input.code,
    detail: input.detail,
    openedAt: input.openedAt,
    missedScope: input.missedScope,
  };
}

export function windowId(localDate: string, startedAt: string, host: string): string {
  return `nw-${localDate}-${fingerprint([startedAt, host])}`;
}

export function windowHeadline(run: WindowRunRecord): string {
  const failed = run.stages.filter((s) => s.outcome === "FAILED").map((s) => s.stage);
  const p = run.pipeline;
  const would = p.verdicts.filter((v) => v.verdict === "PROMOTE_WOULD").length;
  const refused = p.verdicts.filter((v) => v.verdict === "REFUSE_WOULD").length;
  const deferred = p.verdicts.filter((v) => v.verdict === "DEFER").length;
  return (
    `${run.finishedAt} - window ${run.localDate} (${run.trigger}) - SHADOW - promoted ${run.promoted} - ` +
    `would promote ${would} of ${p.items} - refused ${refused} of ${p.items} - deferred ${deferred} of ${p.items} - ` +
    (failed.length > 0 ? `FAILED ${failed.join(", ")} - ` : "") +
    `${run.incidents.length} incident(s)` +
    (run.caughtUp.length > 0 ? ` - caught up ${run.caughtUp.join(", ")}` : "")
  );
}

export function buildWindowDigest(run: WindowRunRecord): string {
  const out: string[] = [];
  const p = run.pipeline;
  out.push(`# Nightly window digest — ${run.localDate} (${run.zone}), ${run.trigger}`);
  out.push("");
  out.push(
    `Written by \`pnpm window:run\` on the \`${run.provider}\` control plane, host ${run.host}, SHA ${run.testedSha ?? "unrecorded"}. ` +
      "**Research-only:** this window has no civic-data acquisition, promotion, Git, build, deploy, or Reader-materialization door.",
  );
  out.push("");
  out.push("## THE WINDOW");
  out.push("");
  out.push(`- scheduled for ${run.scheduledFor}; started ${run.startedAt}; finished ${run.finishedAt}`);
  out.push(`- lock: lease \`${run.lock.leaseId}\` held by ${run.lock.holder} from ${run.lock.claimedAt} until ${run.lock.expiresAt}${run.lock.releasedAt ? `, released ${run.lock.releasedAt}` : ""}`);
  out.push(
    run.caughtUp.length > 0
      ? `- CATCH-UP: ${run.caughtUp.length} earlier local date(s) no window answered for — ${run.caughtUp.join(", ")} — are answered by this one, by name`
      : "- no earlier local date was owed by this window",
  );
  out.push("- GitHub Actions is not a wakeup, clock, or promotion surface for routine civic data");
  out.push("");
  out.push("## ACTIVATION GATE");
  out.push("");
  out.push("- Verified facts publish through their reader doors without a class activation gate.");
  out.push("");
  out.push("## STAGES");
  out.push("");
  for (const s of run.stages) {
    out.push(`- **${s.stage} — ${s.outcome}** (${s.startedAt} → ${s.finishedAt})${s.reason ? `: ${s.reason}` : ""}`);
  }
  out.push("");
  out.push("## RESEARCH PIPELINE EVALUATION");
  out.push("");
  out.push(`- ${p.items} pipeline item(s); ${p.refused} of ${p.items} carry at least one refused offer (a refused offer never closes an item)`);
  out.push(
    `- by furthest stage: SCOUTED ${p.byStage.SCOUTED}, CONFIRMED ${p.byStage.CONFIRMED}, VERIFIED ${p.byStage.VERIFIED}, ` +
      `AUDITED ${p.byStage.AUDITED}, APPROVED_FOR_PROMOTION ${p.byStage.APPROVED_FOR_PROMOTION} — each of ${p.items}`,
  );
  out.push(`- **promoted: ${run.promoted}** (shadow)`);
  for (const t of p.byRecordClass) {
    out.push(
      `- \`${t.recordClass}\`: would promote ${t.promoteWould} of ${t.items}; refused ${t.refuseWould} of ${t.items}; deferred ${t.deferred} of ${t.items}`,
    );
  }
  const reasons = new Map<string, number>();
  for (const v of p.verdicts) reasons.set(`${v.verdict} — ${v.reason}`, (reasons.get(`${v.verdict} — ${v.reason}`) ?? 0) + 1);
  for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) out.push(`  - ${n} of ${p.items}: ${reason}`);
  out.push("");
  out.push("## CONTROL SCORES");
  out.push("");
  if (run.controls === null) {
    out.push("- NOT MEASURED: this window's batch carried no injected controls, so recall, the false-absence rate and the false-presence rate cannot be stated. An unmeasured score refuses AUDITED for every item.");
  } else {
    const c = run.controls;
    out.push(`- recall ${c.recalled} of ${c.knownPresentCount}; false absences ${c.falseAbsences} of ${c.knownPresentCount}; false presences ${c.falsePresences} of ${c.knownAbsenceCount}; unobserved ${c.unobserved}`);
  }
  out.push("");
  out.push("## INCIDENTS");
  out.push("");
  if (run.incidents.length === 0) out.push("- none opened by this window");
  for (const i of run.incidents) {
    out.push(`- \`${i.incidentId}\` at ${i.stage}: ${i.code} — ${i.detail}${i.missedScope.length > 0 ? ` — next window catches up: ${i.missedScope.join("; ")}` : ""}`);
  }
  out.push("");
  out.push(`Record: ${run.recordPath ?? "unwritten"}. Promotion to reader truth: **none**.`);
  out.push("");
  return `${out.join("\n")}\n`;
}
