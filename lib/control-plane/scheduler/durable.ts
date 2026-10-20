import { readRuntimeAdminConfig } from "../runtime-admin-config.ts";
/**
 * Durable scheduler state. A standing obligation recurs; each due occurrence owns its own WorkItem and
 * RouteTask. Identity is derived from the obligation id and the occurrence sequence, so no RouteTask is
 * reused across occurrences.
 */

import { createRouteTask, type RouteDisposition, type RouteTask } from "../route-task.ts";
import { createWorkItem, type WorkItem } from "../work-item.ts";
import { inheritPublicationConnection, isRetiredRoutineMeetingAcquisition } from "../workers/autonomous-plan.ts";
import { plannedForHunters } from "../workers/route-plan.ts";
import { questionOfObligation } from "../work-question.ts";
import { registerRouteTask, registerWorkItem } from "../repository/coordinator.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";

import type { FreshnessDebt } from "./debt.ts";
import { DISCHARGING_DISPOSITIONS } from "./dispatch.ts";
import type { FreshnessObligation } from "./obligation.ts";
import { runPool } from "./shadow-loop.ts";
import { absenceHold } from "./absence-hold.ts";
import { isAdminConfig } from "../gateway/admin-config.ts";
import { forEachAggregate } from "../workers/streamed-history.ts";
import { createPlannerSpool, plannerMap, plannerSet, type PlannerTable, type PlannerSpool } from "./planner-spool.ts";
import { DiskRows } from "./disk-rows.ts";

export const FRESHNESS_PROJECT = "freshness";

/** A standing obligation as the control plane holds it. `nextDueAt` is stored (and indexed) so the due query runs in the database. */
export interface StandingObligation extends FreshnessObligation {
  /** The derived next-due, as of the last cycle that scheduled it. */
  readonly nextDueAt: string | null;
  /** How many occurrences this obligation has opened. Monotonic. */
  readonly occurrenceCount: number;
  readonly openOccurrenceId: string | null;
  /**
   * Set when an authority transfer permanently removes this clock from the
   * standing corpus. The row remains as history, but `active: false` and a
   * null next-due make it impossible to dispatch as live work.
   */
  readonly retiredAt?: string;
  readonly retirementReason?: string;
  readonly updatedAt: string;
}

/** The coordinator needs outside identities and clocks, never their source plans. */
export type StandingObligationHeader = Pick<StandingObligation, "id" | "subjectId" | "active" | "materializedBy" |
  "assignments" | "lastWorkedAt" | "openOccurrenceId" | "nextDueAt" | "absentUntil" | "retirementReason">;
const STANDING_HEADER_PROJECTION = { id: true, subjectId: true, active: true, materializedBy: true, assignments: true,
  lastWorkedAt: true, openOccurrenceId: true, nextDueAt: true, absentUntil: true, retirementReason: true } as const;
const SYNC_SCOPE_SIZE = 100;
type RetirementRows<T> = readonly T[] | DiskRows<T>;
let retirementSequence = 0;
function retirementRows<T>(planner: PlannerSpool | undefined, name: string) {
  let sequence = 0;
  const disk = planner?.table<T>(`${name}:${retirementSequence++}`, () => String(sequence++));
  const memory: T[] = [];
  return {
    add: (row: T) => { if (disk) disk.add(row); else memory.push(row); },
    rows: disk?.rows ?? memory as RetirementRows<T>,
    ordered: (field: keyof T & string) => disk?.rowsBy([[field]]) ?? memory.sort((left, right) => {
      const a = String(left[field]), b = String(right[field]); return a < b ? -1 : a > b ? 1 : 0;
    }),
  };
}

/** One due occurrence: owns exactly one WorkItem and one RouteTask; closes on a terminal disposition or unresolved. */
export interface FreshnessOccurrence {
  readonly id: string;
  readonly obligationId: string;
  /** Monotonic per obligation, starting at 1. Part of the derived identity. */
  readonly sequence: number;
  /** The due time this occurrence answers. Not the time it opened. */
  readonly dueAt: string;
  readonly workItemId: string;
  readonly routeTaskId: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly disposition: string | null;
  readonly unresolvedReason: string | null;
}

export function occurrenceId(obligationId: string, sequence: number): string {
  return `occ-${obligationId}-${String(sequence).padStart(6, "0")}`;
}

/** The occurrence's WorkItem obligation clause. The sequence number in it makes each occurrence's WorkItem and RouteTask ids distinct. */
export function occurrenceObligationClause(obligationId: string, sequence: number): string {
  return `${obligationId}#${sequence}`;
}

/** Lift a plain obligation into a standing row. Never invents a next-due. */
export function standing(
  obligation: FreshnessObligation,
  now: string,
): StandingObligation {
  return {
    ...obligation,
    nextDueAt: null,
    occurrenceCount: 0,
    openOccurrenceId: null,
    absentUntil: obligation.absentUntil ?? null,
    updatedAt: now,
  };
}

/** Runtime fields the durable row owns; a registration pass never resets them. */
const RUNTIME_OWNED = [
  "nextDueAt",
  "occurrenceCount",
  "openOccurrenceId",
  "lastWorkedAt",
  /* A recorded expiring absence is runtime state; a registration pass must never reset it. */
  "absentUntil",
  "absenceUnlock",
  "absenceReopened",
  /* The owner's dispatch materialized this row; a provider re-emitting it must not erase the mark. */
  "materializedBy",
  /* The owner's Sends that reached this row; no provider emits them, and a registration pass must never drop them. */
  "assignments",
  /* Which registry the dispatch materialized it from, kept with the mark. */
  "materializedFrom",
  "autonomousPlan",
] as const;

/** Register what is new and refresh provider-derived signals on what is not, without touching runtime state. `refreshed` names every row whose signals moved. */
interface SyncArrayResult {
  readonly all: readonly StandingObligation[];
  readonly registered: readonly string[];
  readonly alreadyDurable: readonly string[];
  readonly refreshed: readonly { readonly id: string; readonly changed: readonly string[] }[];
  readonly outside: readonly StandingObligationHeader[] | null;
}
export interface SyncPlannerSink {
  readonly all: PlannerTable<StandingObligation>;
  readonly registered: PlannerTable<string>;
  readonly alreadyDurable: PlannerTable<string>;
  readonly refreshed: PlannerTable<{ readonly id: string; readonly changed: readonly string[] }>;
  readonly outside: PlannerTable<StandingObligationHeader>;
}
export interface SyncPlannerResult {
  readonly all: DiskRows<StandingObligation>;
  readonly registered: DiskRows<string>;
  readonly alreadyDurable: DiskRows<string>;
  readonly refreshed: DiskRows<{ readonly id: string; readonly changed: readonly string[] }>;
  readonly outside: DiskRows<StandingObligationHeader> | null;
}
export function syncObligations(repos: ControlPlaneRepositories, corpus: Iterable<FreshnessObligation>, now: string,
  options: { readonly exactReads?: boolean; readonly sink: SyncPlannerSink }): Promise<SyncPlannerResult>;
export function syncObligations(repos: ControlPlaneRepositories, corpus: Iterable<FreshnessObligation>, now: string,
  options?: { readonly exactReads?: boolean }): Promise<SyncArrayResult>;
export async function syncObligations(
  repos: ControlPlaneRepositories,
  corpus: Iterable<FreshnessObligation>,
  now: string,
  options: { readonly exactReads?: boolean; readonly sink?: SyncPlannerSink } = {},
): Promise<SyncArrayResult | SyncPlannerResult> {
  const collected = <T>(keyOf: (row: T) => string) => {
    const rows: T[] = [];
    return { rows, add: (row: T) => { rows.push(row); }, has: (key: string) => rows.some(row => keyOf(row) === key),
      delete: (key: string) => { const at = rows.findIndex(row => keyOf(row) === key); if (at >= 0) rows.splice(at, 1); } };
  };
  const registered = options.sink?.registered ?? collected<string>(row => row);
  const alreadyDurable = options.sink?.alreadyDurable ?? collected<string>(row => row);
  const refreshed = options.sink?.refreshed ?? collected<{ id: string; changed: readonly string[] }>(row => row.id);
  const all = options.sink?.all ?? collected<StandingObligation>(row => row.id);
  const outside = options.sink?.outside ?? collected<StandingObligationHeader>(row => row.id);
  if (!options.exactReads) await forEachAggregate(repos.obligations, row => { outside.add(row.value); }, STANDING_HEADER_PROJECTION);

  const synchronize = async (scope: readonly FreshnessObligation[]): Promise<void> => {
    // Full plans belong only to the exact provider/subject identities being synchronized.
    // One bounded scope is held while CAS preserves each row's complete runtime state.
    const ids = scope.map(row => row.id);
    const heldRows = repos.obligations.readMany ? await repos.obligations.readMany(ids)
      : (await Promise.all(ids.map(id => repos.obligations.read(id)))).filter(row => row !== null);
    const existingRows = new Map(heldRows.map(row => [row.id, row]));
    for (const o of scope) {
      outside.delete(o.id);
      const existing = existingRows.get(o.id) ?? null;
      if (existing === null) {
        const row = standing(o, now);
        await repos.obligations.put(o.id, row, now);
        registered.add(o.id);
        all.add(row);
        continue;
      }

      alreadyDurable.add(o.id);
      const held = existing.value;
      /* A provider can connect a plan (or a reader door) to a row that lacks one; the held plan is never replaced. */
      const plan = inheritPublicationConnection(held.autonomousPlan, o.autonomousPlan);
      const { autonomousPlan: _provided, ...signals } = o;
      const next: StandingObligation = {
        ...signals,
        nextDueAt: held.nextDueAt,
        occurrenceCount: held.occurrenceCount,
        openOccurrenceId: held.openOccurrenceId,
        lastWorkedAt: held.lastWorkedAt,
        absentUntil: held.absentUntil,
        ...(held.absenceUnlock !== undefined ? { absenceUnlock: held.absenceUnlock } : {}),
        ...(held.materializedBy !== undefined ? { materializedBy: held.materializedBy } : {}),
        ...(held.assignments !== undefined ? { assignments: held.assignments } : {}),
        ...(held.materializedFrom !== undefined ? { materializedFrom: held.materializedFrom } : {}),
        ...(plan !== undefined ? { autonomousPlan: plan } : {}),
        updatedAt: now,
      };

      const changed: string[] = [];
      if (plan !== held.autonomousPlan) changed.push("autonomousPlan");
      for (const key of new Set([...Object.keys(o), "scopeDivisions"] as (keyof FreshnessObligation)[])) {
        if ((RUNTIME_OWNED as readonly string[]).includes(key)) continue;
        if (key === "scopeDivisions") {
          if (canonicalJson(held.scopeDivisions ?? []) !== canonicalJson(o.scopeDivisions ?? [])) changed.push(key);
        } else {
          // Providers reconstruct arrays/objects each pass. Compare their saved
          // facts, not their references, so an idle registry does not revise rows.
          const structured = (held[key] !== null && typeof held[key] === "object") ||
            (o[key] !== null && typeof o[key] === "object");
          if (structured ? canonicalJson(held[key]) !== canonicalJson(o[key]) : held[key] !== o[key]) changed.push(key);
        }
      }

      if (changed.length === 0) {
        all.add(held);
        continue;
      }
      const written = await repos.obligations.compareAndSet(
        existing.id,
        existing.revision,
        next,
        now,
      );
      refreshed.add({ id: o.id, changed });
      all.add(written.value);
    }
  };
  let scope: FreshnessObligation[] = [];
  for (const obligation of corpus) {
    scope.push(obligation);
    if (scope.length === SYNC_SCOPE_SIZE) { await synchronize(scope); scope = []; }
  }
  if (scope.length) await synchronize(scope);
  return { all: all.rows, registered: registered.rows, alreadyDurable: alreadyDurable.rows, refreshed: refreshed.rows,
    outside: options.exactReads ? null : outside.rows } as SyncArrayResult | SyncPlannerResult;
}

/** Permanently stop clocks whose provider was retired: inactive, no next due, with a reason. Idempotent; nothing is deleted. */
export async function retireObligationsByPrefix(
  repos: ControlPlaneRepositories,
  prefixes: readonly string[],
  now: string,
  reason: string,
  planner?: PlannerSpool,
): Promise<{
  readonly retired: RetirementRows<string>;
  readonly alreadyRetired: RetirementRows<string>;
}> {
  const retired = retirementRows<string>(planner, "prefix-retired");
  const alreadyRetired = retirementRows<string>(planner, "prefix-already-retired");
  if (prefixes.length === 0) return { retired: retired.rows, alreadyRetired: alreadyRetired.rows };

  await forEachAggregate(repos.obligations, async slot => {
    if (!prefixes.some((prefix) => slot.id.startsWith(prefix))) return;
    const row = await repos.obligations.mustRead(slot.id);
    const held = row.value;
    if (
      held.active === false &&
      held.nextDueAt === null &&
      held.retirementReason === reason
    ) {
      alreadyRetired.add(row.id);
      return;
    }
    await repos.obligations.compareAndSet(
      row.id,
      row.revision,
      {
        ...held,
        active: false,
        nextDueAt: null,
        retiredAt: held.retiredAt ?? now,
        retirementReason: reason,
        updatedAt: now,
      },
      now,
    );
    retired.add(row.id);
  }, {});
  return { retired: retired.rows, alreadyRetired: alreadyRetired.rows };
}

/**
 * A row the registry no longer emits is retired only when it is active, its namespace belongs to exactly one
 * provider that read cleanly with at least one unit, and retiring it keeps that provider under
 * `SUPERSEDED_RETIREMENT_BOUND`. Every other such row is held back by name; re-emitting the id makes it live again.
 */
export const SUPERSEDED_RETIREMENT_BOUND = 0.25;

/** `freshness:<namespace>:`, the part of a standing obligation id its provider owns. Null for any other id. */
export function obligationNamespace(id: string): string | null {
  const head = "freshness:";
  if (!id.startsWith(head)) return null;
  const end = id.indexOf(":", head.length);
  return end <= head.length ? null : id.slice(0, end + 1);
}

/** One provider's reading this cycle, as `RegistryPass.byProvider` reports it. */
export interface ProviderReading {
  readonly providerId: string;
  readonly units: number;
  readonly readFailure: string | null;
  readonly emptyReason: string | null;
}

export type SupersededHold =
  | "NO_PROVIDER_NAMESPACE"
  | "AMBIGUOUS_NAMESPACE"
  | "PROVIDER_NOT_READ_CLEANLY"
  | "OVER_RETIREMENT_BOUND";

export interface RetirementItem {
  readonly obligationId: string;
  readonly reason: string;
}

export interface SupersededRetirementPlan {
  readonly retire: RetirementRows<RetirementItem>;
  readonly heldBack: RetirementRows<{
    readonly obligationId: string;
    readonly code: SupersededHold;
    readonly why: string;
  }>;
}

/** Why an obligation was retired as superseded, in the words its row, occurrence and debt carry. */
export function supersededRetirementReason(providerId: string): string {
  return (
    `SUPERSEDED: provider '${providerId}' read its input cleanly and no longer emits this ` +
    "obligation, so it is no longer owed"
  );
}

/**
 * The one provider that owns a row's namespace this cycle and read cleanly,
 * or the named reason there is none. Both retirement planners ask this.
 */
function cleanOwnerOf(
  corpus: Iterable<{ readonly providerId: string; readonly obligationId: string }>,
  providers: readonly ProviderReading[],
): (id: string) => { readonly providerId: string } | { readonly code: SupersededHold; readonly why: string } {
  const owners = new Map<string, Set<string>>();
  for (const u of corpus) {
    const ns = obligationNamespace(u.obligationId);
    if (ns === null) continue;
    const set = owners.get(ns) ?? new Set<string>();
    set.add(u.providerId);
    owners.set(ns, set);
  }
  const reading = new Map(providers.map((p) => [p.providerId, p]));
  return (id) => {
    const ns = obligationNamespace(id);
    const owner = ns === null ? undefined : owners.get(ns);
    if (ns === null || owner === undefined) {
      return {
        code: "NO_PROVIDER_NAMESPACE",
        why: `no provider emitted ${ns ?? "a standing namespace for this id"} this cycle, so nothing can say it ended`,
      };
    }
    if (owner.size !== 1) {
      return {
        code: "AMBIGUOUS_NAMESPACE",
        why: `${ns} is emitted by ${[...owner].sort().join(" and ")}, so no one provider owns this row`,
      };
    }
    const providerId = [...owner][0];
    const p = reading.get(providerId);
    if (p === undefined || p.readFailure !== null || p.emptyReason !== null || p.units === 0) {
      return {
        code: "PROVIDER_NOT_READ_CLEANLY",
        why:
          `provider '${providerId}' did not read cleanly this cycle (` +
          (p === undefined
            ? "it reported nothing"
            : p.readFailure ?? p.emptyReason ?? "it produced no units") +
          "), so its missing rows are not evidence that they ended",
      };
    }
    return { providerId };
  };
}

/**
 * Which rows outside the corpus to retire, and which to hold back and why.
 * PURE: the caller passes the rows `syncObligations` read (`outside`), the
 * cycle's FULL, unfiltered registry units, and the provider reports.
 */
export function planSupersededRetirement(input: {
  readonly outside: Iterable<Pick<StandingObligationHeader, "id" | "active">>;
  readonly corpus: Iterable<{ readonly providerId: string; readonly obligationId: string }>;
  readonly providers: readonly ProviderReading[];
  readonly bound?: number;
  readonly planner?: PlannerSpool;
}): SupersededRetirementPlan {
  const bound = input.bound ?? SUPERSEDED_RETIREMENT_BOUND;
  const prefix = `superseded:${retirementSequence++}`;
  const identities = new DiskRows(() => input.corpus).map((u) => u.obligationId);
  const inCorpus = input.planner ? plannerSet(input.planner, `${prefix}:corpus`, identities) : new Set(identities);
  const unitsBy = new Map<string, number>();
  for (const u of input.corpus) unitsBy.set(u.providerId, (unitsBy.get(u.providerId) ?? 0) + 1);
  const ownerOf = cleanOwnerOf(input.corpus, input.providers);

  const candidates = retirementRows<{ providerId: string; obligationId: string }>(input.planner, `${prefix}:candidates`);
  const counts = new Map<string, number>();
  const heldBack = retirementRows<{ obligationId: string; code: SupersededHold; why: string }>(input.planner, `${prefix}:holds`);
  for (const row of input.outside) {
    if (!row.active || inCorpus.has(row.id)) continue;
    const owner = ownerOf(row.id);
    if ("code" in owner) {
      heldBack.add({ obligationId: row.id, ...owner });
      continue;
    }
    candidates.add({ providerId: owner.providerId, obligationId: row.id });
    counts.set(owner.providerId, (counts.get(owner.providerId) ?? 0) + 1);
  }

  const retire = retirementRows<RetirementItem>(input.planner, `${prefix}:retire`);
  for (const [providerId, count] of counts) {
    const standingTotal = (unitsBy.get(providerId) ?? 0) + count;
    const ids = new DiskRows(() => candidates.rows).filter(row => row.providerId === providerId).map(row => row.obligationId);
    if (count > bound * standingTotal) {
      for (const obligationId of ids) {
        heldBack.add({
          obligationId,
          code: "OVER_RETIREMENT_BOUND",
          why:
            `provider '${providerId}' would retire ${count} of its ${standingTotal} standing ` +
            `obligations this cycle, more than the bound of ${Math.round(bound * 100)}%. A read that ` +
            "suddenly emits that much less is held for a person, never retired by a clock",
        });
      }
      continue;
    }
    for (const obligationId of ids) retire.add({ obligationId, reason: supersededRetirementReason(providerId) });
  }
  return { retire: retire.ordered("obligationId"), heldBack: heldBack.ordered("obligationId") };
}

/**
 * Retires an old `freshness:jurisdiction:<id>#meetings-N` row only when it is active, the owning provider read
 * cleanly, and the government's exact body holds a calendar route on the owed rows. This planner owns every
 * such row; `planSupersededRetirement` is given none of them.
 */
const JURISDICTION_MEETINGS_OBLIGATION = /^freshness:jurisdiction:([^#]+)#meetings-\d+$/;

/** The jurisdiction a `freshness:jurisdiction:<id>#meetings-N` row was owed for; null for any other id. */
export function jurisdictionMeetingsSubject(id: string): string | null {
  return JURISDICTION_MEETINGS_OBLIGATION.exec(id)?.[1] ?? null;
}

export type HeldRouteHold = SupersededHold | "ROUTES_UNREAD" | "NO_EXACT_BODY" | "NO_HELD_CALENDAR_ROUTE";

/** Why a jurisdiction meetings row was retired, naming the body whose calendar route is held. */
export function heldCalendarRouteReason(jurisdictionId: string, bodyId: string): string {
  return (
    `CALENDAR ROUTE HELD: ${jurisdictionId}'s body ${bodyId} has a held calendar route on the mission map ` +
    "(its publisher route or a meeting captured from it), so its meetings are owed through that route and this old discovery row ends"
  );
}

export function planHeldRouteRetirement(input: {
  readonly outside: Iterable<Pick<StandingObligationHeader, "id" | "active">>;
  readonly corpus: Iterable<{ readonly providerId: string; readonly obligationId: string }>;
  readonly providers: readonly ProviderReading[];
  /** The exact government/body join, and the bodies whose calendar route the owed rows hold, or why they were not read. */
  readonly routes:
    | { readonly bodyIdFor: (jurisdictionId: string) => string | null; readonly held: ReadonlySet<string> }
    | { readonly unreadable: string };
  readonly planner?: PlannerSpool;
}): {
  /** Every row this planner owns. None of them is given to `planSupersededRetirement`. */
  readonly owned: ReadonlySet<string>;
  readonly retire: RetirementRows<RetirementItem>;
  readonly heldBack: RetirementRows<{ readonly obligationId: string; readonly code: HeldRouteHold; readonly why: string }>;
} {
  const prefix = `held-retirement:${retirementSequence++}`;
  const identities = new DiskRows(() => input.corpus).map((u) => u.obligationId);
  const inCorpus = input.planner ? plannerSet(input.planner, `${prefix}:corpus`, identities) : new Set(identities);
  const ownerOf = cleanOwnerOf(input.corpus, input.providers);
  const { routes } = input;
  const owned = input.planner ? plannerSet(input.planner, `${prefix}:owned`) : new Set<string>();
  const retire = retirementRows<RetirementItem>(input.planner, `${prefix}:retire`);
  const heldBack = retirementRows<{ obligationId: string; code: HeldRouteHold; why: string }>(input.planner, `${prefix}:holds`);
  for (const row of input.outside) {
    const jurisdictionId = jurisdictionMeetingsSubject(row.id);
    if (jurisdictionId === null || inCorpus.has(row.id)) continue;
    owned.add(row.id);
    if (!row.active) continue;
    const owner = ownerOf(row.id);
    if ("code" in owner) {
      heldBack.add({ obligationId: row.id, ...owner });
      continue;
    }
    if ("unreadable" in routes) {
      heldBack.add({
        obligationId: row.id,
        code: "ROUTES_UNREAD",
        why: `the owed rows could not be read (${routes.unreadable}), so nothing shows this government's meetings have a route`,
      });
      continue;
    }
    const bodyId = routes.bodyIdFor(jurisdictionId);
    if (bodyId === null) {
      heldBack.add({
        obligationId: row.id,
        code: "NO_EXACT_BODY",
        why: `${jurisdictionId} has no exact governing-body join, so no calendar row shows its meetings have a route`,
      });
    } else if (!routes.held.has(bodyId)) {
      heldBack.add({
        obligationId: row.id,
        code: "NO_HELD_CALENDAR_ROUTE",
        why: `${bodyId} holds no calendar route on the owed rows, so retiring this row would drop a need nothing has met`,
      });
    } else {
      retire.add({ obligationId: row.id, reason: heldCalendarRouteReason(jurisdictionId, bodyId) });
    }
  }
  return { owned, retire: retire.ordered("obligationId"), heldBack: heldBack.ordered("obligationId") };
}

/** A retired row holds no open occurrence: any inactive row still pointing at one is settled under its retirement reason. */
export function planRetiredResidue(outside: Iterable<Pick<StandingObligationHeader, "id" | "active" | "openOccurrenceId" | "retirementReason">>, planner?: PlannerSpool): RetirementRows<RetirementItem> {
  const rows = retirementRows<RetirementItem>(planner, "retired-residue");
  for (const row of outside) if (!row.active && row.openOccurrenceId !== null) rows.add({ obligationId: row.id, reason: row.retirementReason ?? "RETIRED: this obligation was retired" });
  return rows.ordered("obligationId");
}

/**
 * Retire each row, or settle one already retired: close every open occurrence it owns UNRESOLVED, then mark
 * the row inactive with no next-due. Nothing is deleted. Interruption-safe: the row stays active until the
 * last step. `budget` is asked before each row; the rest come back as `deferred`.
 */
export async function settleRetirements(
  repos: ControlPlaneRepositories,
  input: {
    readonly items: Iterable<RetirementItem>;
    readonly now: string;
    readonly budget?: { readonly spent: () => boolean };
    readonly planner?: PlannerSpool;
  },
): Promise<{
  readonly retired: RetirementRows<string>;
  readonly occurrencesClosed: RetirementRows<string>;
  readonly failed: RetirementRows<{ readonly obligationId: string; readonly why: string }>;
  readonly deferred: RetirementRows<string>;
}> {
  const retired = retirementRows<string>(input.planner, "settled-retired");
  const occurrencesClosed = retirementRows<string>(input.planner, "settled-occurrences");
  const failed = retirementRows<{ obligationId: string; why: string }>(input.planner, "retirement-failed");
  const deferred = retirementRows<string>(input.planner, "retirement-deferred");
  let deferring = false;
  for (const { obligationId, reason } of input.items) {
    if (deferring || input.budget?.spent() === true) {
      deferring = true;
      deferred.add(obligationId);
      continue;
    }
    try {
      const held = await repos.obligations.read(obligationId);
      if (held === null) continue;

      /* Every open occurrence the row owns, not only the one it points at. */
      let closedAny = false;
      for (const occurrence of await repos.occurrences.listWhere(["obligationId"], obligationId)) {
        if (occurrence.value.closedAt !== null) continue;
        await closeOccurrence(repos, {
          occurrenceId: occurrence.id,
          disposition: null,
          unresolvedReason: `${reason}. The occurrence closes unresolved: nothing was read and nothing was refreshed`,
          now: input.now,
        });
        occurrencesClosed.add(occurrence.id);
        closedAny = true;
      }

      /* Closing an occurrence rewrote the row; otherwise the first read is still current. */
      const row = closedAny ? await repos.obligations.mustRead(obligationId) : held;
      if (row.value.active) {
        await repos.obligations.compareAndSet(
          row.id,
          row.revision,
          {
            ...row.value,
            active: false,
            nextDueAt: null,
            openOccurrenceId: null,
            retiredAt: row.value.retiredAt ?? input.now,
            retirementReason: reason,
            updatedAt: input.now,
          },
          input.now,
        );
        retired.add(obligationId);
      } else if (row.value.openOccurrenceId !== null) {
        await repos.obligations.compareAndSet(
          row.id,
          row.revision,
          { ...row.value, openOccurrenceId: null, updatedAt: input.now },
          input.now,
        );
      }
    } catch (error) {
      failed.add({ obligationId, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { retired: retired.rows, occurrencesClosed: occurrencesClosed.rows, failed: failed.rows, deferred: deferred.rows };
}

/**
 * Resume the occurrence this obligation already has open; null when none is. An open occurrence whose
 * RouteTask is already disposed comes back as SETTLED with that disposition, to be closed with
 * `closeSettledOccurrence`, never dispatched again.
 */
export async function resumeOpenOccurrence(
  repos: ControlPlaneRepositories,
  obligation: StandingObligation,
): Promise<ResumedOccurrence | null> {
  if (obligation.openOccurrenceId === null) return null;
  const held = await repos.occurrences.read(obligation.openOccurrenceId);
  if (held === null) return null;
  /* A CLOSED occurrence is finished work and is never re-dispatched: its
     RouteTask carries a committed disposition, and re-opening it would attach a
     second Attempt to a settled task. */
  if (held.value.closedAt !== null) return null;
  // A new Send can connect an already-open occurrence without a second discovery; existing or repaired instructions stay immutable.
  if (obligation.autonomousPlan) {
    const item = await repos.workItems.mustRead(held.value.workItemId);
    const connected = inheritPublicationConnection(item.value.autonomousPlan, obligation.autonomousPlan)!;
    const ownerInstructions = [...new Set([...(connected.ownerInstructions ?? []), ...(obligation.assignments ?? []).map(assignment => assignment.ref)])];
    if (connected !== item.value.autonomousPlan || JSON.stringify(ownerInstructions) !== JSON.stringify(connected.ownerInstructions)) {
      await repos.workItems.compareAndSet(item.id, item.revision,
        { ...item.value, autonomousPlan: { ...connected, ownerInstructions } }, obligation.updatedAt);
    }
  }
  const task = await repos.routeTasks.read(held.value.routeTaskId);
  /* `disposition !== null`, not `state`, decides settledness: a later claim can overwrite the state. */
  if (task !== null && task.value.disposition !== null) {
    return {
      kind: "SETTLED",
      settled: {
        occurrenceId: held.value.id,
        obligationId: held.value.obligationId,
        routeTaskId: held.value.routeTaskId,
        workItemId: held.value.workItemId,
        disposition: task.value.disposition,
      },
    };
  }
  return { kind: "OPEN", id: held.value.id, routeTaskId: held.value.routeTaskId };
}

/**
 * An open occurrence whose RouteTask already carries a committed disposition.
 * Recovered by closing it with that disposition; never dispatched again.
 */
export interface SettledOccurrence {
  readonly occurrenceId: string;
  readonly obligationId: string;
  readonly routeTaskId: string;
  readonly workItemId: string;
  /** The disposition the RouteTask carries, verbatim. Never re-derived and never replaced. */
  readonly disposition: RouteDisposition;
}

export type ResumedOccurrence =
  /** Owed work: the RouteTask carries no disposition yet, so the occurrence is dispatched. */
  | { readonly kind: "OPEN"; readonly id: string; readonly routeTaskId: string }
  /** The route was already settled by the cycle that walked it. */
  | { readonly kind: "SETTLED"; readonly settled: SettledOccurrence };

/** Every settled open occurrence, found before any lane runs (recovery spends nothing, so it never waits on dispatch capacity). Each candidate is confirmed by `resumeOpenOccurrence`. */
export async function findSettledOccurrences(
  repos: ControlPlaneRepositories,
  input: {
    readonly obligations: Iterable<StandingObligation>;
    readonly settledRouteTaskIds: ReadonlySet<string>;
  },
): Promise<readonly SettledOccurrence[]> {
  if (!new DiskRows(() => input.obligations).some((o) => o.openOccurrenceId !== null) || input.settledRouteTaskIds.size === 0) return [];
  return [...(await scanOccurrences(repos, { ...input, neverClaimedRouteTaskIds: new Set() })).settled];
}

/**
 * An OPEN occurrence its obligation has moved on from without closing: nothing
 * points to it, so nothing will ever resume or dispatch it.
 */
export interface AbandonedOccurrence {
  readonly occurrenceId: string;
  readonly obligationId: string;
  readonly sequence: number;
  /** The obligation's own count: the occurrence it has moved on to. */
  readonly movedOnTo: number;
}

/**
 * One pass over the occurrences, two findings: settled (pointed at, on a disposed RouteTask) and abandoned
 * (open, not pointed at, its obligation already opened a later sequence, and its RouteTask never claimed).
 */
interface OccurrenceScanInput {
  readonly obligations: Iterable<StandingObligation>;
  readonly settledRouteTaskIds: ReadonlySet<string>;
  readonly neverClaimedRouteTaskIds: ReadonlySet<string>;
}
export function scanOccurrences(repos: ControlPlaneRepositories, input: OccurrenceScanInput & { readonly planner: PlannerSpool }): Promise<{ readonly settled: DiskRows<SettledOccurrence>; readonly abandoned: DiskRows<AbandonedOccurrence> }>;
export function scanOccurrences(repos: ControlPlaneRepositories, input: OccurrenceScanInput): Promise<{ readonly settled: readonly SettledOccurrence[]; readonly abandoned: readonly AbandonedOccurrence[] }>;
export async function scanOccurrences(
  repos: ControlPlaneRepositories,
  input: OccurrenceScanInput & { readonly planner?: PlannerSpool },
): Promise<{ readonly settled: readonly SettledOccurrence[] | DiskRows<SettledOccurrence>; readonly abandoned: readonly AbandonedOccurrence[] | DiskRows<AbandonedOccurrence> }> {
  const spool = input.planner ?? await createPlannerSpool();
  try {
  const byId = plannerMap<StandingObligation>(spool, "scan-standing");
  const byOpenOccurrence = plannerMap<string>(spool, "scan-open-occurrence");
  for (const o of input.obligations) {
    byId.set(o.id, o);
    if (o.openOccurrenceId !== null) byOpenOccurrence.set(o.openOccurrenceId, o.id);
  }
  const settled = spool.table<SettledOccurrence>("scan-settled", row => row.occurrenceId), abandoned = spool.table<AbandonedOccurrence>("scan-abandoned", row => row.occurrenceId);
  if (byId.size === 0) return { settled: input.planner ? settled.rows : [], abandoned: input.planner ? abandoned.rows : [] };
  await forEachAggregate(repos.occurrences, async occurrence => {
    if (occurrence.value.closedAt !== null) return;
    const pointedId = byOpenOccurrence.get(occurrence.id);
    const pointedBy = pointedId === undefined ? undefined : byId.get(pointedId);
    if (pointedBy !== undefined) {
      if (!input.settledRouteTaskIds.has(occurrence.value.routeTaskId)) return;
      const resumed = await resumeOpenOccurrence(repos, pointedBy);
      if (resumed?.kind === "SETTLED") settled.add(resumed.settled);
      return;
    }
    const owner = byId.get(occurrence.value.obligationId);
    if (owner === undefined || owner.openOccurrenceId === occurrence.id) return;
    if (occurrence.value.sequence >= owner.occurrenceCount) return;
    if (!input.neverClaimedRouteTaskIds.has(occurrence.value.routeTaskId)) return;
    abandoned.add({
      occurrenceId: occurrence.id,
      obligationId: owner.id,
      sequence: occurrence.value.sequence,
      movedOnTo: owner.occurrenceCount,
    });
  }, { closedAt: true, routeTaskId: true, obligationId: true, sequence: true });
  return { settled: input.planner ? settled.rows : [...settled.rows], abandoned: input.planner ? abandoned.rows : [...abandoned.rows] };
  } finally { if (!input.planner) await spool.close(); }
}

/** Close an abandoned occurrence UNRESOLVED after re-checking every condition at write time. Writes only the occurrence row. */
export async function closeAbandonedOccurrences(
  repos: ControlPlaneRepositories,
  input: { readonly abandoned: Iterable<AbandonedOccurrence>; readonly now: string; readonly planner?: PlannerSpool },
): Promise<{
  readonly closed: RetirementRows<string>;
  readonly skipped: RetirementRows<{ readonly occurrenceId: string; readonly why: string }>;
  readonly failed: RetirementRows<{ readonly occurrenceId: string; readonly why: string }>;
}> {
  const closed = retirementRows<string>(input.planner, "abandoned-closed");
  const skipped = retirementRows<{ occurrenceId: string; why: string }>(input.planner, "abandoned-skipped");
  const failed = retirementRows<{ occurrenceId: string; why: string }>(input.planner, "abandoned-failed");
  for (const { occurrenceId } of input.abandoned) {
    try {
      const occurrence = await repos.occurrences.read(occurrenceId);
      if (occurrence === null || occurrence.value.closedAt !== null) {
        skipped.add({ occurrenceId, why: "no longer open" });
        continue;
      }
      const owner = await repos.obligations.read(occurrence.value.obligationId);
      if (
        owner === null ||
        owner.value.openOccurrenceId === occurrence.id ||
        occurrence.value.sequence >= owner.value.occurrenceCount
      ) {
        skipped.add({ occurrenceId, why: "its obligation has not moved on from it" });
        continue;
      }
      const task = await repos.routeTasks.read(occurrence.value.routeTaskId);
      if (task === null || task.value.state !== "PENDING" || task.value.disposition !== null) {
        skipped.add({ occurrenceId, why: "its RouteTask is no longer an unclaimed PENDING task" });
        continue;
      }
      await repos.occurrences.compareAndSet(
        occurrence.id,
        occurrence.revision,
        {
          ...occurrence.value,
          closedAt: input.now,
          disposition: null,
          unresolvedReason:
            `ABANDONED: the obligation moved on to occurrence ${owner.value.occurrenceCount} without closing ` +
            `occurrence ${occurrence.value.sequence}, whose RouteTask was never claimed. Nothing was read and ` +
            "nothing was refreshed",
        },
        input.now,
      );
      closed.add(occurrence.id);
    } catch (error) {
      failed.add({ occurrenceId, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { closed: closed.rows, skipped: skipped.rows, failed: failed.rows };
}

/** Recovery carries membership and task status, never source plans, captures or attempt history. */
export async function scanRecoveryTaskMetadata(repos: ControlPlaneRepositories, input: {
  readonly lifetimeHuntSubjects: ReadonlySet<string>;
  readonly lifetimeHuntWorkIds: Pick<Set<string>, "add">;
  readonly settledTaskIds: Pick<Set<string>, "add">;
  readonly neverClaimedTaskIds: Pick<Set<string>, "add">;
}): Promise<void> {
  await forEachAggregate(repos.workItems, item => {
    if (plannedForHunters(item.value.autonomousPlan) && !isRetiredRoutineMeetingAcquisition(item.value.autonomousPlan.contract)
      && input.lifetimeHuntSubjects.has(item.value.subject)) input.lifetimeHuntWorkIds.add(item.id);
  }, { subject: true, autonomousPlan: { contract: { schemaVersion: true, recordClass: true } } });
  await forEachAggregate(repos.routeTasks, row => {
    if (row.value.workerTask && input.lifetimeHuntSubjects.has(row.value.workerTask.contract.subjectId)) {
      input.lifetimeHuntWorkIds.add(row.id); input.lifetimeHuntWorkIds.add(row.value.workItemId);
    }
    if (row.value.disposition !== null) input.settledTaskIds.add(row.id);
    if (row.value.state === "PENDING" && !row.value.workerTask) input.neverClaimedTaskIds.add(row.id);
  }, { workItemId: true, state: true, disposition: {}, workerTask: { contract: { subjectId: true } } });
}

/** The ids of the RouteTasks that carry a disposition: the settledness `resumeOpenOccurrence` reads. */
export function settledRouteTaskIds(
  routeTasks: readonly { readonly id: string; readonly value: RouteTask }[],
): ReadonlySet<string> {
  return new Set(routeTasks.filter((t) => t.value.disposition !== null).map((t) => t.id));
}

/** Raised when an obligation is asked to open past an occurrence it still holds open. */
export class OccurrenceStillOpen extends Error {
  readonly obligationId: string;
  readonly occurrenceId: string;
  constructor(obligationId: string, occurrenceId: string) {
    super(
      `obligation ${obligationId} still holds open occurrence ${occurrenceId}. Resume it; opening another ` +
        "would strand it as open work nothing will ever dispatch",
    );
    this.name = "OccurrenceStillOpen";
    this.obligationId = obligationId;
    this.occurrenceId = occurrenceId;
  }
}

/** Open the next occurrence of a due obligation, with its own WorkItem and RouteTask. Null when the obligation names no route. */
export async function openOccurrence(
  repos: ControlPlaneRepositories,
  input: {
    readonly obligation: StandingObligation;
    readonly dueAt: string;
    readonly now: string;
  },
): Promise<{
  readonly occurrence: FreshnessOccurrence;
  readonly workItem: WorkItem;
  readonly routeTask: RouteTask;
} | null> {
  const o = input.obligation;
  if (o.routeId === null) return null;

  /* Never open past an occurrence that is still open, checked against the row as it is now. */
  const current = await repos.obligations.mustRead(o.id);
  if (current.value.openOccurrenceId !== null) {
    const held = await repos.occurrences.read(current.value.openOccurrenceId);
    if (held !== null && held.value.closedAt === null) throw new OccurrenceStillOpen(o.id, held.id);
  }
  const sequence = current.value.occurrenceCount + 1;
  /* The round names its question from the row as it is now, and none when that is not on the row. */
  const question = questionOfObligation(current.value);
  const workItem: WorkItem = { ...createWorkItem({
    project: FRESHNESS_PROJECT,
    subject: o.subjectId,
    obligation: occurrenceObligationClause(o.id, sequence),
    why:
      `occurrence ${sequence} of standing freshness obligation ${o.id} (${o.recordClass}), due ` +
      `${input.dueAt}. The obligation recurs; THIS is the piece of work that completes.`,
    ...(question !== null ? { question } : {}),
    now: input.now,
  }), ...(current.value.autonomousPlan ? { autonomousPlan: { ...current.value.autonomousPlan,
    ownerInstructions: [...new Set((current.value.assignments ?? []).map(assignment => assignment.ref))] } } : {}) };
  const routeTask = createRouteTask({
    workItemId: workItem.id,
    routeId: o.routeId,
    routeLabel: o.routeId,
    target: o.subjectId,
    inherited: true,
    now: input.now,
  });

  await registerWorkItem(repos, workItem, input.now);
  await registerRouteTask(repos, routeTask, input.now);

  const occurrence: FreshnessOccurrence = {
    id: occurrenceId(o.id, sequence),
    obligationId: o.id,
    sequence,
    dueAt: input.dueAt,
    workItemId: workItem.id,
    routeTaskId: routeTask.id,
    openedAt: input.now,
    closedAt: null,
    disposition: null,
    unresolvedReason: null,
  };
  await repos.occurrences.put(occurrence.id, occurrence, input.now);

  const row = await repos.obligations.mustRead(o.id);
  await repos.obligations.compareAndSet(
    o.id,
    row.revision,
    {
      ...row.value,
      occurrenceCount: sequence,
      openOccurrenceId: occurrence.id,
      updatedAt: input.now,
    },
    input.now,
  );

  return { occurrence, workItem, routeTask };
}

/**
 * Close an occurrence. A non-null `disposition` discharges it and moves `lastWorkedAt` (to `workedAt` when
 * given); null leaves the anchor where it is.
 */
export async function closeOccurrence(
  repos: ControlPlaneRepositories,
  input: {
    readonly occurrenceId: string;
    readonly disposition: string | null;
    readonly unresolvedReason: string | null;
    readonly now: string;
    readonly workedAt?: string;
  },
): Promise<FreshnessOccurrence> {
  const row = await repos.occurrences.mustRead(input.occurrenceId);
  if (row.value.closedAt !== null) return row.value;

  const closed: FreshnessOccurrence = {
    ...row.value,
    closedAt: input.now,
    disposition: input.disposition,
    unresolvedReason: input.unresolvedReason,
  };
  await repos.occurrences.compareAndSet(row.id, row.revision, closed, input.now);

  const obligationRow = await repos.obligations.mustRead(row.value.obligationId);
  await repos.obligations.compareAndSet(
    obligationRow.id,
    obligationRow.revision,
    {
      ...obligationRow.value,
      openOccurrenceId: null,
      /* A productive disposition also clears any standing absence. */
      ...(input.disposition !== null
        ? { lastWorkedAt: input.workedAt ?? input.now, absentUntil: null, absenceUnlock: null }
        : {}),
      updatedAt: input.now,
    },
    input.now,
  );
  return closed;
}

/**
 * Close a settled occurrence without walking its route again. INGESTED and WALKED_NO_YIELD discharge it with
 * the anchor at `disposition.at`; anything else closes it UNRESOLVED and the obligation stays due. Only the
 * occurrence and obligation rows are written.
 */
export async function closeSettledOccurrence(
  repos: ControlPlaneRepositories,
  input: { readonly settled: SettledOccurrence; readonly now: string },
): Promise<FreshnessOccurrence> {
  const { disposition } = input.settled;
  const discharged = DISCHARGING_DISPOSITIONS.includes(disposition.disposition);
  return closeOccurrence(repos, {
    occurrenceId: input.settled.occurrenceId,
    disposition: discharged ? disposition.disposition : null,
    unresolvedReason: discharged ? null : settledUnresolvedReason(disposition),
    now: input.now,
    ...(discharged ? { workedAt: disposition.at } : {}),
  });
}

/** Why a settled occurrence closed without discharge, in the words its debt row carries. */
export function settledUnresolvedReason(disposition: RouteDisposition): string {
  return (
    `the route was already disposed ${disposition.disposition} (committed ${disposition.at} by ` +
    `Attempt ${disposition.attemptId}), which closes the RouteTask and is not a reading of the ` +
    "record. The occurrence was closed without walking the settled route again, and the " +
    "obligation stays owed"
  );
}

/** Record the derived next-due against the durable row, so a query can use it. */
export async function recordNextDue(
  repos: ControlPlaneRepositories,
  input: { readonly obligationId: string; readonly nextDueAt: string; readonly now: string },
): Promise<void> {
  const row = await repos.obligations.mustRead(input.obligationId);
  if (row.value.nextDueAt === input.nextDueAt) return;
  await repos.obligations.compareAndSet(
    row.id,
    row.revision,
    { ...row.value, nextDueAt: input.nextDueAt, updatedAt: input.now },
    input.now,
  );
}

/** Record an expiring absence on the durable row; `scheduleObligation` owes the next reading at its expiry. Not a debt. */
export async function recordArguedAbsence(
  repos: ControlPlaneRepositories,
  input: { readonly obligationId: string; readonly absentUntil: string; readonly now: string; readonly unlockWhen?: import("./absence.ts").AbsenceUnlock },
): Promise<void> {
  const row = await repos.obligations.mustRead(input.obligationId);
  /* The hold is the owner's setting tied to the source's pace, never longer than the caller's own expiry. */
  const configRow = await readRuntimeAdminConfig(repos, ["settings"]).catch(() => null);
  const hold = absenceHold(row.value, input.now, configRow && isAdminConfig(configRow.value) ? configRow.value : null);
  const absentUntil = hold.until < input.absentUntil ? hold.until : input.absentUntil;
  if (row.value.absentUntil === absentUntil && row.value.nextDueAt === absentUntil) return;
  /* The unlock keeps when the absence was argued and its recheck date. */
  const unlock = input.unlockWhen === undefined ? undefined : { ...input.unlockWhen, recordedAt: input.now,
    triggers: input.unlockWhen.triggers.map((t) => (t.kind === "DATE" ? { ...t, at: absentUntil } : t)) };
  await repos.obligations.compareAndSet(
    row.id,
    row.revision,
    /* Advance the stored next-due to the expiry too, so the durable due-query
       (`dueByStoredTime`) and the derived schedule agree at once rather than at
       the next cycle's re-derivation. */
    { ...row.value, absentUntil, ...(unlock !== undefined ? { absenceUnlock: unlock } : {}), nextDueAt: absentUntil, updatedAt: input.now },
    input.now,
  );
}


/** Every defined debt field is scalar. Adding a field requires deciding its scheduler projection. */
const DEBT_METADATA_PROJECTION = { obligationId: true, cause: true, detail: true, target: true, dueAt: true,
  firstFailedAt: true, lastFailedAt: true, consecutiveFailures: true, retryAt: true } as const satisfies Record<keyof FreshnessDebt, true>;

/** Every debt row this control plane holds, without unrelated stored extensions. */
export function loadDebts(repos: ControlPlaneRepositories, sink: PlannerTable<FreshnessDebt>): Promise<DiskRows<FreshnessDebt>>;
export function loadDebts(repos: ControlPlaneRepositories): Promise<readonly FreshnessDebt[]>;
export async function loadDebts(repos: ControlPlaneRepositories, sink?: PlannerTable<FreshnessDebt>): Promise<readonly FreshnessDebt[] | DiskRows<FreshnessDebt>> {
  const rows: FreshnessDebt[] = [];
  await forEachAggregate(repos.debts, row => { if (sink) sink.add(row.value); else rows.push(row.value); }, DEBT_METADATA_PROJECTION);
  return sink?.rows ?? rows;
}

/** Persist the cycle from a disk snapshot; only one stored debt and one operation per active writer are decoded. */
export async function persistDebts(
  repos: ControlPlaneRepositories,
  next: Iterable<FreshnessDebt>,
  now: string,
  scope: Iterable<string> | null = null,
  retired: ReadonlyMap<string, string> = new Map(),
  concurrency = 1,
  planner?: PlannerSpool,
): Promise<{ readonly written: number; readonly cleared: readonly string[] | DiskRows<string>; readonly clearedAsRetired: readonly string[] | DiskRows<string> }> {
  const spool = planner ?? await createPlannerSpool();
  const prefix = `persist-debts:${debtPersistenceSequence++}`;
  const nextRows = spool.table<FreshnessDebt>(`${prefix}:next`, debt => debt.obligationId);
  let submittedSequence = 0;
  const submitted = spool.table<FreshnessDebt>(`${prefix}:submitted`, () => String(submittedSequence++));
  const existing = spool.table<import("../repository/types.ts").Persisted<FreshnessDebt>>(`${prefix}:existing`, row => row.id);
  type Operation = { readonly sequence: number; readonly id: string; readonly obligationId: string; readonly kind: "WRITTEN" | "CLEARED" | "RETIRED"; readonly revision: number | null; readonly value: FreshnessDebt };
  const operations = spool.table<Operation>(`${prefix}:operations`, operation => String(operation.sequence));
  const groups = spool.table<string>(`${prefix}:groups`, id => id);
  const cleared = spool.table<string>(`${prefix}:cleared`, id => id), clearedAsRetired = spool.table<string>(`${prefix}:retired`, id => id);
  let sequence = 0, written = 0;
  const add = (operation: Omit<Operation,"sequence">) => {
    operations.add({ ...operation, sequence: sequence++ }); groups.add(operation.id);
    if (operation.kind === "WRITTEN") written++;
    else if (operation.kind === "CLEARED") cleared.add(operation.obligationId);
    else clearedAsRetired.add(operation.obligationId);
  };
  try {
    for (const debt of next) { nextRows.add(debt); submitted.add(debt); }
    if (scope === null) await forEachAggregate(repos.debts, row => { existing.add(row); }, DEBT_METADATA_PROJECTION);
    else for (const id of scope) { const row = await repos.debts.read(id); if (row) existing.add(row); }
    for (const row of existing.rows) {
      if (nextRows.has(row.value.obligationId) || row.value.consecutiveFailures === 0) continue;
      const reason = retired.get(row.value.obligationId);
      add({ id: row.id, obligationId: row.value.obligationId, kind: reason === undefined ? "CLEARED" : "RETIRED", revision: row.revision,
        value: { ...row.value, consecutiveFailures: 0, detail: reason === undefined
          ? `cleared at ${now}: the obligation was discharged`
          : `cleared at ${now}: the obligation was retired (${reason}). Not a reading: nothing was refreshed` } });
    }
    // Keep each submitted operation, including duplicates, so a stale second CAS still refuses as before.
    for (const debt of submitted.rows) {
      const row = existing.read(debt.obligationId);
      if (row && canonicalJson(row.value) === canonicalJson(debt)) continue;
      add({ id: row?.id ?? debt.obligationId, obligationId: debt.obligationId, kind: "WRITTEN", revision: row?.revision ?? null, value: debt });
    }
    let earliestFailure: { sequence: number; error: unknown } | null = null;
    await runPool(groups.rows, concurrency, async id => {
      for (const operation of operations.rowsWhere(["id"], id)) {
        try {
          if (operation.revision === null) await repos.debts.put(operation.id, operation.value, now);
          else {
            // The country snapshot is metadata only. Hydrate this exact row before a write so
            // extensions owned by another writer survive, and retain the snapshot's CAS revision.
            const current = await repos.debts.mustRead(operation.id);
            await repos.debts.compareAndSet(operation.id, operation.revision, { ...current.value, ...operation.value }, now);
          }
        } catch (error) {
          if (earliestFailure === null || operation.sequence < earliestFailure.sequence) earliestFailure = { sequence: operation.sequence, error };
          break;
        }
      }
    });
    if (earliestFailure !== null) throw (earliestFailure as { error: unknown }).error;
    return { written, cleared: planner ? cleared.rows : [...cleared.rows], clearedAsRetired: planner ? clearedAsRetired.rows : [...clearedAsRetired.rows] };
  } finally { if (!planner) await spool.close(); }
}
let debtPersistenceSequence = 0;

/** The obligations whose stored next-due has passed. */
export async function dueByStoredTime(
  repos: ControlPlaneRepositories,
  nowIso: string,
): Promise<readonly StandingObligation[]> {
  const rows = await repos.obligations.list();
  return rows
    .map((r) => r.value)
    .filter((o) => o.active && o.nextDueAt !== null && o.nextDueAt <= nowIso)
    .sort((a, b) => ((a.nextDueAt ?? "") < (b.nextDueAt ?? "") ? -1 : 1));
}
