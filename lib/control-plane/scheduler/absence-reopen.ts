/**
 * **A NEW CAPABILITY REOPENS THE DEAD ENDS IT COULD SOLVE.** (DP-10.)
 *
 * "Wake when an adapter is installed" (`wakeInstalledAdapterDebts`) generalized
 * to "wake when a capability appears". When a route or method entry is written
 * for a platform and record class, or an adapter or tool appears, every
 * recorded absence whose `unlockWhen` names it is cleared, so the obligation
 * is owed in the next round instead of waiting out its clock.
 *
 * What matches (a trigger is stored with the absence, DP-06):
 * - ADAPTER: the capability is for that platform.
 * - TOOL: the capability is that tool.
 * - ROUTE: the capability is for that record class (and that platform, when the
 *   trigger names one). The record class alone is the weakest match the
 *   absence stores; it is why a trigger can carry the platform.
 * - DATE: never. The clock reopens it by itself.
 *
 * A capability that does not work (a failed or blocked entry) is not a new
 * capability and reopens nothing.
 */
import type { FieldManualEntry } from "../field-manual.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { ABSENCE_EXPIRY_DAYS, type AbsenceUnlock, type AbsenceUnlockTrigger } from "./absence.ts";

/** What appeared: the platforms, record classes and tools a new working entry covers. */
export interface Capability {
  readonly platforms: readonly string[];
  readonly recordClasses: readonly string[];
  readonly tools: readonly string[];
  /** One line saying what appeared, kept on the reopened obligation. */
  readonly because: string;
  /** When the entry was observed (a UTC day or an instant); null when unknown. */
  readonly observedAt?: string | null;
}

/** Entry kinds that mean "a way of getting this now exists". */
const CAPABILITY_KINDS: readonly string[] = ["METHOD", "ROUTE", "PLATFORM_ADAPTER", "ENGINEER_ADAPTER_PR"];

const norm = (value: string): string => value.trim().toLowerCase();

/** The capabilities a set of newly written field-manual entries stands for: working entries of a capability kind. */
export function capabilitiesFromEntries(entries: readonly FieldManualEntry[]): Capability[] {
  return entries
    .filter((entry) => CAPABILITY_KINDS.includes(entry.kind) && entry.outcome === "YIELDED")
    .map((entry) => {
      const payload = (entry.payload ?? {}) as { tool?: unknown };
      return {
        platforms: entry.platforms.map(norm),
        recordClasses: entry.recordClasses.map(norm),
        tools: typeof payload.tool === "string" ? [norm(payload.tool)] : [],
        because: `${entry.kind.toLowerCase().replace(/_/g, " ")} written: ${entry.title}`,
        observedAt: entry.observedAt,
      };
    })
    .filter((capability) => capability.platforms.length + capability.recordClasses.length + capability.tools.length > 0);
}

export function triggerMatches(trigger: AbsenceUnlockTrigger, capability: Capability): boolean {
  switch (trigger.kind) {
    case "ADAPTER": return capability.platforms.includes(norm(trigger.platform));
    case "TOOL": return capability.tools.includes(norm(trigger.tool));
    case "ROUTE":
      return capability.recordClasses.includes(norm(trigger.recordClass)) &&
        (trigger.platform === undefined || capability.platforms.includes(norm(trigger.platform)));
    case "DATE": return false;
  }
}

/**
 * Whether a capability appeared after the absence was argued. An instant compares as an instant; a bare
 * day only counts from the next day, so a method the walk already had can never reopen its own dead end.
 * An absence without `recordedAt` (older rows) is dated from its end less the old 30-day hold.
 */
export function appearedAfter(capability: Capability, unlock: AbsenceUnlock, absentUntil: string | null | undefined): boolean {
  if (capability.observedAt === undefined) return true;
  if (!capability.observedAt) return false;
  const recordedAt = unlock.recordedAt ??
    (absentUntil ? new Date(Date.parse(absentUntil) - ABSENCE_EXPIRY_DAYS * 86_400_000).toISOString() : null);
  if (!recordedAt) return false;
  return capability.observedAt.length <= 10 ? capability.observedAt > recordedAt.slice(0, 10) : capability.observedAt >= recordedAt;
}

/** The first capability that matches any of the absence's triggers, or null. */
export function unlockedBy(unlock: AbsenceUnlock | null | undefined, capabilities: readonly Capability[], absentUntil?: string | null): Capability | null {
  if (!unlock) return null;
  return capabilities.find((capability) => appearedAfter(capability, unlock, absentUntil) &&
    unlock.triggers.some((trigger) => triggerMatches(trigger, capability))) ?? null;
}

export interface ReopenedAbsence {
  readonly obligationId: string;
  readonly because: string;
}

/**
 * Clear the absence on every obligation a new capability unlocks. The obligation is due at once, and
 * its row keeps what reopened it. Idempotent: an obligation with no absence is left alone.
 */
export async function reopenAbsencesFor(
  repos: Pick<ControlPlaneRepositories, "obligations">,
  capabilities: readonly Capability[],
  now: string,
): Promise<readonly ReopenedAbsence[]> {
  if (capabilities.length === 0) return [];
  const reopened: ReopenedAbsence[] = [];
  for (const row of await repos.obligations.list()) {
    const held = row.value;
    if (!held.absentUntil || !(Date.parse(held.absentUntil) > Date.parse(now))) continue;
    const capability = unlockedBy(held.absenceUnlock, capabilities, held.absentUntil);
    if (!capability) continue;
    await repos.obligations.compareAndSet(row.id, row.revision,
      { ...held, absentUntil: null, absenceUnlock: null, nextDueAt: now, updatedAt: now,
        absenceReopened: { at: now, because: capability.because } }, now);
    reopened.push({ obligationId: row.id, because: capability.because });
  }
  return reopened;
}

/** Capabilities observed this recently are checked each round; older ones already had their rounds. */
export const RECENT_CAPABILITY_DAYS = 2;

/**
 * Each round: the working capabilities the bank gained in the last two days reopen the dead ends argued
 * before they appeared. Reads the obligations only when such a capability exists.
 */
export async function reopenAbsencesForRecentCapabilities(
  repos: Pick<ControlPlaneRepositories, "obligations">,
  entries: readonly FieldManualEntry[],
  now: string,
): Promise<readonly ReopenedAbsence[]> {
  const since = new Date(Date.parse(now) - RECENT_CAPABILITY_DAYS * 86_400_000).toISOString();
  const recent = capabilitiesFromEntries(entries).filter((c) => c.observedAt && c.observedAt >= since.slice(0, c.observedAt.length <= 10 ? 10 : undefined));
  return reopenAbsencesFor(repos, recent, now);
}
