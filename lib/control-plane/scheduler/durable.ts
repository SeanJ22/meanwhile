import { createRouteTask, type RouteDisposition, type RouteTask } from "../route-task.ts";
import { createWorkItem, type WorkItem } from "../work-item.ts";
import { inheritPublicationConnection } from "../workers/autonomous-plan.ts";
import { questionOfObligation } from "../work-question.ts";
import { registerRouteTask, registerWorkItem } from "../repository/coordinator.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";

import type { DispatchSnapshot } from "../repository/dispatch-state.ts";

import type { FreshnessDebt } from "./debt.ts";
import { DISCHARGING_DISPOSITIONS } from "./dispatch.ts";
import type { FreshnessObligation } from "./obligation.ts";
import { runPool } from "./shadow-loop.ts";
import { absenceHold } from "./absence-hold.ts";
import { planningStateOf } from "./state-planning.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";

export const FRESHNESS_PROJECT = "freshness";

export interface StandingObligation extends FreshnessObligation {

  readonly nextDueAt: string | null;

  readonly occurrenceCount: number;
  readonly openOccurrenceId: string | null;

  readonly retiredAt?: string;
  readonly retirementReason?: string;
  readonly updatedAt: string;
}

export interface FreshnessOccurrence {
  readonly id: string;
  readonly obligationId: string;

  readonly sequence: number;

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

export function occurrenceObligationClause(obligationId: string, sequence: number): string {
  return `${obligationId}#${sequence}`;
}

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

const RUNTIME_OWNED = [
  "nextDueAt",
  "occurrenceCount",
  "openOccurrenceId",
  "lastWorkedAt",

  "absentUntil",
  "absenceUnlock",
  "absenceReopened",

  "materializedBy",

  "assignments",

  "materializedFrom",
  "autonomousPlan",
  "officialsLead",
] as const;

export async function syncObligations(
  repos: ControlPlaneRepositories,
  corpus: readonly FreshnessObligation[],
  now: string,
  options: { readonly exactReads?: boolean } = {},
): Promise<{
  readonly all: readonly StandingObligation[];
  readonly registered: readonly string[];
  readonly alreadyDurable: readonly string[];

  readonly refreshed: readonly { readonly id: string; readonly changed: readonly string[] }[];

  readonly outside: readonly StandingObligation[] | null;
}> {
  const registered: string[] = [];
  const alreadyDurable: string[] = [];
  const refreshed: { id: string; changed: string[] }[] = [];
  const all: StandingObligation[] = [];

  const existingById = new Map<string, { id: string; revision: number; value: StandingObligation }>();
  if (options.exactReads) {
    for (const obligation of corpus) {
      const row = await repos.obligations.read(obligation.id);
      if (row !== null) existingById.set(row.id, { id: row.id, revision: row.revision, value: row.value });
    }
  } else {
    for (const row of await repos.obligations.list()) {
      existingById.set(row.id, { id: row.id, revision: row.revision, value: row.value });
    }
  }

  if(repos.planningState) {
    if(!repos.obligations.readMany)throw new Error("Planning requires indexed batch reads");
    const missing=corpus.filter(row=>!existingById.has(row.id)).map(row=>row.id);
    for(const row of await repos.obligations.readMany(missing))existingById.set(row.id,row);
  }

  for (const o of corpus) {
    const existing = existingById.get(o.id) ?? null;
    if (existing === null) {
      const row = standing(o, now);
      await repos.obligations.put(o.id, row, now);
      registered.push(o.id);
      all.push(row);
      continue;
    }

    alreadyDurable.push(o.id);
    const held = existing.value;

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
      ...(held.officialsLead !== undefined ? { officialsLead: held.officialsLead } : {}),
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

        const structured = (held[key] !== null && typeof held[key] === "object") ||
          (o[key] !== null && typeof o[key] === "object");
        if (structured ? canonicalJson(held[key]) !== canonicalJson(o[key]) : held[key] !== o[key]) changed.push(key);
      }
    }

    if (changed.length === 0) {
      all.push(held);
      continue;
    }
    const written = await repos.obligations.compareAndSet(
      existing.id,
      existing.revision,
      next,
      now,
    );
    refreshed.push({ id: o.id, changed });
    all.push(written.value);
  }
  const named = new Set(corpus.map((o) => o.id));
  const outside = options.exactReads
    ? null
    : [...existingById.values()].filter((row) => !named.has(row.id)).map((row) => row.value);
  return { all, registered, alreadyDurable, refreshed, outside };
}

export async function retireObligationsByPrefix(
  repos: ControlPlaneRepositories,
  prefixes: readonly string[],
  now: string,
  reason: string,
): Promise<{
  readonly retired: readonly string[];
  readonly alreadyRetired: readonly string[];
}> {
  const retired: string[] = [];
  const alreadyRetired: string[] = [];
  if (prefixes.length === 0) return { retired, alreadyRetired };

  for (const row of await repos.obligations.list()) {
    if (!prefixes.some((prefix) => row.id.startsWith(prefix))) continue;
    const held = row.value;
    if (
      held.active === false &&
      held.nextDueAt === null &&
      held.retirementReason === reason
    ) {
      alreadyRetired.push(row.id);
      continue;
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
    retired.push(row.id);
  }
  return { retired, alreadyRetired };
}

export const SUPERSEDED_RETIREMENT_BOUND = 0.25;

export function obligationNamespace(id: string): string | null {
  const head = "freshness:";
  if (!id.startsWith(head)) return null;
  const end = id.indexOf(":", head.length);
  return end <= head.length ? null : id.slice(0, end + 1);
}

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
  readonly retire: readonly RetirementItem[];
  readonly heldBack: readonly {
    readonly obligationId: string;
    readonly code: SupersededHold;
    readonly why: string;
  }[];
}

export function supersededRetirementReason(providerId: string): string {
  return (
    `SUPERSEDED: provider '${providerId}' read its input cleanly and no longer emits this ` +
    "obligation, so it is no longer owed"
  );
}

function cleanOwnerOf(
  corpus: readonly { readonly providerId: string; readonly obligationId: string }[],
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

export function planSupersededRetirement(input: {
  readonly outside: readonly StandingObligation[];
  readonly corpus: readonly { readonly providerId: string; readonly obligationId: string }[];
  readonly providers: readonly ProviderReading[];
  readonly bound?: number;
}): SupersededRetirementPlan {
  const bound = input.bound ?? SUPERSEDED_RETIREMENT_BOUND;
  const inCorpus = new Set(input.corpus.map((u) => u.obligationId));
  const unitsBy = new Map<string, number>();
  for (const u of input.corpus) unitsBy.set(u.providerId, (unitsBy.get(u.providerId) ?? 0) + 1);
  const ownerOf = cleanOwnerOf(input.corpus, input.providers);

  const candidates = new Map<string, string[]>();
  const heldBack: SupersededRetirementPlan["heldBack"][number][] = [];
  for (const row of input.outside) {
    if (!row.active || inCorpus.has(row.id)) continue;
    const owner = ownerOf(row.id);
    if ("code" in owner) {
      heldBack.push({ obligationId: row.id, ...owner });
      continue;
    }
    const list = candidates.get(owner.providerId) ?? [];
    list.push(row.id);
    candidates.set(owner.providerId, list);
  }

  const retire: SupersededRetirementPlan["retire"][number][] = [];
  for (const [providerId, ids] of candidates) {
    const standingTotal = (unitsBy.get(providerId) ?? 0) + ids.length;
    if (ids.length > bound * standingTotal) {
      for (const obligationId of ids) {
        heldBack.push({
          obligationId,
          code: "OVER_RETIREMENT_BOUND",
          why:
            `provider '${providerId}' would retire ${ids.length} of its ${standingTotal} standing ` +
            `obligations this cycle, more than the bound of ${Math.round(bound * 100)}%. A read that ` +
            "suddenly emits that much less is held for a person, never retired by a clock",
        });
      }
      continue;
    }
    for (const obligationId of ids) retire.push({ obligationId, reason: supersededRetirementReason(providerId) });
  }
  retire.sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
  heldBack.sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
  return { retire, heldBack };
}

const JURISDICTION_MEETINGS_OBLIGATION = /^freshness:jurisdiction:([^#]+)#meetings-\d+$/;

export function jurisdictionMeetingsSubject(id: string): string | null {
  return JURISDICTION_MEETINGS_OBLIGATION.exec(id)?.[1] ?? null;
}

export type HeldRouteHold = SupersededHold | "ROUTES_UNREAD" | "NO_EXACT_BODY" | "NO_HELD_CALENDAR_ROUTE";

export function heldCalendarRouteReason(jurisdictionId: string, bodyId: string): string {
  return (
    `CALENDAR ROUTE HELD: ${jurisdictionId}'s body ${bodyId} has a held calendar route on the mission map ` +
    "(its publisher route or a meeting captured from it), so its meetings are owed through that route and this old discovery row ends"
  );
}

export function planHeldRouteRetirement(input: {
  readonly outside: readonly StandingObligation[];
  readonly corpus: readonly { readonly providerId: string; readonly obligationId: string }[];
  readonly providers: readonly ProviderReading[];

  readonly routes:
    | { readonly bodyIdFor: (jurisdictionId: string) => string | null; readonly held: ReadonlySet<string> }
    | { readonly unreadable: string };
}): {

  readonly owned: ReadonlySet<string>;
  readonly retire: readonly RetirementItem[];
  readonly heldBack: readonly { readonly obligationId: string; readonly code: HeldRouteHold; readonly why: string }[];
} {
  const inCorpus = new Set(input.corpus.map((u) => u.obligationId));
  const ownerOf = cleanOwnerOf(input.corpus, input.providers);
  const { routes } = input;
  const owned = new Set<string>();
  const retire: RetirementItem[] = [];
  const heldBack: { obligationId: string; code: HeldRouteHold; why: string }[] = [];
  for (const row of input.outside) {
    const jurisdictionId = jurisdictionMeetingsSubject(row.id);
    if (jurisdictionId === null || inCorpus.has(row.id)) continue;
    owned.add(row.id);
    if (!row.active) continue;
    const owner = ownerOf(row.id);
    if ("code" in owner) {
      heldBack.push({ obligationId: row.id, ...owner });
      continue;
    }
    if ("unreadable" in routes) {
      heldBack.push({
        obligationId: row.id,
        code: "ROUTES_UNREAD",
        why: `the owed rows could not be read (${routes.unreadable}), so nothing shows this government's meetings have a route`,
      });
      continue;
    }
    const bodyId = routes.bodyIdFor(jurisdictionId);
    if (bodyId === null) {
      heldBack.push({
        obligationId: row.id,
        code: "NO_EXACT_BODY",
        why: `${jurisdictionId} has no exact governing-body join, so no calendar row shows its meetings have a route`,
      });
    } else if (!routes.held.has(bodyId)) {
      heldBack.push({
        obligationId: row.id,
        code: "NO_HELD_CALENDAR_ROUTE",
        why: `${bodyId} holds no calendar route on the owed rows, so retiring this row would drop a need nothing has met`,
      });
    } else {
      retire.push({ obligationId: row.id, reason: heldCalendarRouteReason(jurisdictionId, bodyId) });
    }
  }
  retire.sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
  heldBack.sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
  return { owned, retire, heldBack };
}

export function planRetiredResidue(outside: readonly StandingObligation[]): readonly RetirementItem[] {
  return outside
    .filter((row) => !row.active && row.openOccurrenceId !== null)
    .map((row) => ({ obligationId: row.id, reason: row.retirementReason ?? "RETIRED: this obligation was retired" }))
    .sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
}

export async function settleRetirements(
  repos: ControlPlaneRepositories,
  input: {
    readonly items: readonly RetirementItem[];
    readonly now: string;
    readonly budget?: { readonly spent: () => boolean };
  },
): Promise<{
  readonly retired: readonly string[];
  readonly occurrencesClosed: readonly string[];
  readonly failed: readonly { readonly obligationId: string; readonly why: string }[];
  readonly deferred: readonly string[];
}> {
  const retired: string[] = [];
  const occurrencesClosed: string[] = [];
  const failed: { obligationId: string; why: string }[] = [];
  const deferred: string[] = [];
  for (const { obligationId, reason } of input.items) {
    if (deferred.length > 0 || input.budget?.spent() === true) {
      deferred.push(obligationId);
      continue;
    }
    try {
      const held = await repos.obligations.read(obligationId);
      if (held === null) continue;

      let closedAny = false;
      for (const occurrence of await repos.occurrences.listWhere(["obligationId"], obligationId)) {
        if (occurrence.value.closedAt !== null) continue;
        await closeOccurrence(repos, {
          occurrenceId: occurrence.id,
          disposition: null,
          unresolvedReason: `${reason}. The occurrence closes unresolved: nothing was read and nothing was refreshed`,
          now: input.now,
        });
        occurrencesClosed.push(occurrence.id);
        closedAny = true;
      }

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
        retired.push(obligationId);
      } else if (row.value.openOccurrenceId !== null) {
        await repos.obligations.compareAndSet(
          row.id,
          row.revision,
          { ...row.value, openOccurrenceId: null, updatedAt: input.now },
          input.now,
        );
      }
    } catch (error) {
      failed.push({ obligationId, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { retired, occurrencesClosed, failed, deferred };
}

export async function resumeOpenOccurrence(
  repos: ControlPlaneRepositories,
  obligation: StandingObligation,
  snapshot: DispatchSnapshot,
): Promise<ResumedOccurrence | null> {
  if (obligation.openOccurrenceId === null) return null;
  const held = snapshot.occurrences.get(obligation.openOccurrenceId) ?? null;
  if (held === null) return null;

  if (held.value.closedAt !== null) return null;

  if (obligation.autonomousPlan) {
    const item = snapshot.workItems.get(held.value.workItemId);
    if (!item) throw new Error(`open occurrence ${held.id} has no work item ${held.value.workItemId}`);
    const connected = inheritPublicationConnection(item.value.autonomousPlan, obligation.autonomousPlan)!;
    const ownerInstructions = [...new Set([...(connected.ownerInstructions ?? []), ...(obligation.assignments ?? []).map(assignment => assignment.ref)])];
    if (connected !== item.value.autonomousPlan || JSON.stringify(ownerInstructions) !== JSON.stringify(connected.ownerInstructions)) {
      await repos.workItems.compareAndSet(item.id, item.revision,
        { ...item.value, autonomousPlan: { ...connected, ownerInstructions } }, obligation.updatedAt);
    }
  }
  const task = snapshot.routeTasks.get(held.value.routeTaskId) ?? null;

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

export interface SettledOccurrence {
  readonly occurrenceId: string;
  readonly obligationId: string;
  readonly routeTaskId: string;
  readonly workItemId: string;

  readonly disposition: RouteDisposition;
}

export type ResumedOccurrence =

  | { readonly kind: "OPEN"; readonly id: string; readonly routeTaskId: string }

  | { readonly kind: "SETTLED"; readonly settled: SettledOccurrence };

export async function findSettledOccurrences(
  repos: ControlPlaneRepositories,
  input: {
    readonly obligations: readonly StandingObligation[];
    readonly settledRouteTaskIds: ReadonlySet<string>;
  },
): Promise<readonly SettledOccurrence[]> {
  if (!input.obligations.some((o) => o.openOccurrenceId !== null) || input.settledRouteTaskIds.size === 0) return [];
  return (await scanOccurrences(repos, { ...input, neverClaimedRouteTaskIds: new Set() })).settled;
}

export interface AbandonedOccurrence {
  readonly occurrenceId: string;
  readonly obligationId: string;
  readonly sequence: number;

  readonly movedOnTo: number;
}

export async function scanOccurrences(
  repos: ControlPlaneRepositories,
  input: {
    readonly obligations: readonly StandingObligation[];
    readonly settledRouteTaskIds: ReadonlySet<string>;
    readonly neverClaimedRouteTaskIds: ReadonlySet<string>;
    readonly snapshot?: DispatchSnapshot;
  },
): Promise<{ readonly settled: readonly SettledOccurrence[]; readonly abandoned: readonly AbandonedOccurrence[] }> {
  const byId = new Map<string, StandingObligation>();
  const byOpenOccurrence = new Map<string, StandingObligation>();
  for (const o of input.obligations) {
    byId.set(o.id, o);
    if (o.openOccurrenceId !== null) byOpenOccurrence.set(o.openOccurrenceId, o);
  }
  const settled: SettledOccurrence[] = [];
  const abandoned: AbandonedOccurrence[] = [];
  if (byId.size === 0) return { settled, abandoned };
  const snapshot = input.snapshot ?? await repos.dispatchState.readOpen({ obligationIds: [...byId.keys()] });
  for (const occurrence of snapshot.occurrences.values()) {
    if (occurrence.value.closedAt !== null) continue;
    const pointedBy = byOpenOccurrence.get(occurrence.id);
    if (pointedBy !== undefined) {
      if (!input.settledRouteTaskIds.has(occurrence.value.routeTaskId)) continue;
      const resumed = await resumeOpenOccurrence(repos, pointedBy, snapshot);
      if (resumed?.kind === "SETTLED") settled.push(resumed.settled);
      continue;
    }
    const owner = byId.get(occurrence.value.obligationId);
    if (owner === undefined || owner.openOccurrenceId === occurrence.id) continue;
    if (occurrence.value.sequence >= owner.occurrenceCount) continue;
    if (!input.neverClaimedRouteTaskIds.has(occurrence.value.routeTaskId)) continue;
    abandoned.push({
      occurrenceId: occurrence.id,
      obligationId: owner.id,
      sequence: occurrence.value.sequence,
      movedOnTo: owner.occurrenceCount,
    });
  }
  return { settled, abandoned };
}

export async function closeAbandonedOccurrences(
  repos: ControlPlaneRepositories,
  input: { readonly abandoned: readonly AbandonedOccurrence[]; readonly now: string },
): Promise<{
  readonly closed: readonly string[];
  readonly skipped: readonly { readonly occurrenceId: string; readonly why: string }[];
  readonly failed: readonly { readonly occurrenceId: string; readonly why: string }[];
}> {
  const closed: string[] = [];
  const skipped: { occurrenceId: string; why: string }[] = [];
  const failed: { occurrenceId: string; why: string }[] = [];
  for (const { occurrenceId } of input.abandoned) {
    try {
      const occurrence = await repos.occurrences.read(occurrenceId);
      if (occurrence === null || occurrence.value.closedAt !== null) {
        skipped.push({ occurrenceId, why: "no longer open" });
        continue;
      }
      const owner = await repos.obligations.read(occurrence.value.obligationId);
      if (
        owner === null ||
        owner.value.openOccurrenceId === occurrence.id ||
        occurrence.value.sequence >= owner.value.occurrenceCount
      ) {
        skipped.push({ occurrenceId, why: "its obligation has not moved on from it" });
        continue;
      }
      const task = await repos.routeTasks.read(occurrence.value.routeTaskId);
      if (task === null || task.value.state !== "PENDING" || task.value.disposition !== null) {
        skipped.push({ occurrenceId, why: "its RouteTask is no longer an unclaimed PENDING task" });
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
      await repos.dispatchState.archiveOccurrence(occurrence.id, input.now);
      closed.push(occurrence.id);
    } catch (error) {
      failed.push({ occurrenceId, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { closed, skipped, failed };
}

export function settledRouteTaskIds(
  routeTasks: readonly { readonly id: string; readonly value: RouteTask }[],
): ReadonlySet<string> {
  return new Set(routeTasks.filter((t) => t.value.disposition !== null).map((t) => t.id));
}

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

  const current = await repos.obligations.mustRead(o.id);
  if (current.value.openOccurrenceId !== null) {
    const held = await repos.occurrences.read(current.value.openOccurrenceId);
    if (held !== null && held.value.closedAt === null) throw new OccurrenceStillOpen(o.id, held.id);
  }
  const sequence = current.value.occurrenceCount + 1;

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
  if (row.value.closedAt !== null) {
    await repos.dispatchState.archiveOccurrence(row.id, input.now);
    return row.value;
  }

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

      ...(input.disposition !== null
        ? { lastWorkedAt: input.workedAt ?? input.now, absentUntil: null, absenceUnlock: null }
        : {}),
      updatedAt: input.now,
    },
    input.now,
  );
  await repos.dispatchState.archiveOccurrence(row.id, input.now);
  return closed;
}

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

export function settledUnresolvedReason(disposition: RouteDisposition): string {
  return (
    `the route was already disposed ${disposition.disposition} (committed ${disposition.at} by ` +
    `Attempt ${disposition.attemptId}), which closes the RouteTask and is not a reading of the ` +
    "record. The occurrence was closed without walking the settled route again, and the " +
    "obligation stays owed"
  );
}

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

export async function recordArguedAbsence(
  repos: ControlPlaneRepositories,
  input: { readonly obligationId: string; readonly absentUntil: string; readonly now: string; readonly unlockWhen?: import("./absence.ts").AbsenceUnlock },
): Promise<void> {
  const row = await repos.obligations.mustRead(input.obligationId);

  const configRow = await repos.adminConfig.read(ADMIN_CONFIG_ID).catch(() => null);
  const hold = absenceHold(row.value, input.now, configRow && isAdminConfig(configRow.value) ? configRow.value : null);
  const absentUntil = hold.until < input.absentUntil ? hold.until : input.absentUntil;
  if (row.value.absentUntil === absentUntil && row.value.nextDueAt === absentUntil) return;

  const unlock = input.unlockWhen === undefined ? undefined : { ...input.unlockWhen, recordedAt: input.now,
    triggers: input.unlockWhen.triggers.map((t) => (t.kind === "DATE" ? { ...t, at: absentUntil } : t)) };
  await repos.obligations.compareAndSet(
    row.id,
    row.revision,

    { ...row.value, absentUntil, ...(unlock !== undefined ? { absenceUnlock: unlock } : {}), nextDueAt: absentUntil, updatedAt: input.now },
    input.now,
  );
}

export async function loadDebts(
  repos: ControlPlaneRepositories,
): Promise<readonly FreshnessDebt[]> {
  const rows = await repos.debts.list();
  return rows.map((r) => r.value);
}

/**
 * The state a debt is saved under. A debt carries only its obligation's id, which for most
 * obligations names no state, so the row is stamped: `cp_control_state` reads the `state`
 * field when the id names none. An id that names a state keeps it, as `cp_control_state` does.
 * Otherwise the planner that saves the debt works exactly one state's obligations, and that
 * state is the debt's. A planner without a state reads it from the obligation's subject.
 */
export function debtStateOf(obligationId: string, planningState: string | undefined): string | null {
  const named = planningStateOf(obligationId);
  if (named !== null) return named;
  if (planningState !== undefined) return planningState === "system" ? null : planningState;
  const subject = /^freshness:[^:]+:([^#]+)(?:#.*)?$/.exec(obligationId)?.[1];
  return subject === undefined ? null : planningStateOf(subject);
}

export async function persistDebts(
  repos: ControlPlaneRepositories,
  next: readonly FreshnessDebt[],
  now: string,
  scope: readonly string[] | null = null,

  retired: ReadonlyMap<string, string> = new Map(),

  concurrency = 1,
): Promise<{
  readonly written: number;
  readonly cleared: readonly string[];
  readonly clearedAsRetired: readonly string[];
}> {
  const stamped = next.map((debt) => {
    const state = debtStateOf(debt.obligationId, repos.planningState);
    return state === null || debt.state === state ? debt : { ...debt, state };
  });
  const byId = new Map(stamped.map((d) => [d.obligationId, d]));
  const existing = scope === null
    ? await repos.debts.list()
    : (await Promise.all(scope.map((id) => repos.debts.read(id)))).filter((row) => row !== null);
  const existingById = new Map(existing.map(row => [row.id, row]));

  /* A planner lists only its own state's debts. A debt saved before it carried a state is not in that list but still holds its id. */
  const unlisted = stamped.map(debt => debt.obligationId).filter(id => !existingById.has(id));
  if (unlisted.length > 0) {
    const held = repos.debts.readMany !== undefined
      ? await repos.debts.readMany(unlisted)
      : (await Promise.all(unlisted.map(id => repos.debts.read(id)))).filter(row => row !== null);
    for (const row of held) existingById.set(row.id, row);
  }
  const operations: {
    id: string;
    obligationId: string;
    kind: "WRITTEN" | "CLEARED" | "RETIRED";
    run: () => Promise<unknown>;
  }[] = [];

  for (const row of existing) {
    if (byId.has(row.value.obligationId)) continue;
    const retiredFor = retired.get(row.value.obligationId);
    if (retiredFor !== undefined) {
      if (row.value.consecutiveFailures === 0) continue;
      operations.push({ id: row.id, obligationId: row.value.obligationId, kind: "RETIRED", run: () => repos.debts.compareAndSet(
        row.id,
        row.revision,
        {
          ...row.value,
          consecutiveFailures: 0,
          detail: `cleared at ${now}: the obligation was retired (${retiredFor}). Not a reading: nothing was refreshed`,
        },
        now,
      ) });
      continue;
    }

    if (row.value.consecutiveFailures === 0) continue;
    operations.push({ id: row.id, obligationId: row.value.obligationId, kind: "CLEARED", run: () => repos.debts.compareAndSet(
      row.id,
      row.revision,
      { ...row.value, consecutiveFailures: 0, detail: `cleared at ${now}: the obligation was discharged` },
      now,
    ) });
  }

  for (const debt of stamped) {
    const row = existingById.get(debt.obligationId) ?? null;
    if (row === null) {
      operations.push({ id: debt.obligationId, obligationId: debt.obligationId, kind: "WRITTEN",
        run: () => repos.debts.put(debt.obligationId, debt, now) });
    } else {
      if (canonicalJson(row.value) === canonicalJson(debt)) continue;
      operations.push({ id: row.id, obligationId: debt.obligationId, kind: "WRITTEN",
        run: () => repos.debts.compareAndSet(row.id, row.revision, debt, now) });
    }
  }
  const groups = new Map<string, { index: number; run: () => Promise<unknown> }[]>();
  operations.forEach((operation, index) => {
    const group = groups.get(operation.id) ?? [];
    group.push({ index, run: operation.run });
    groups.set(operation.id, group);
  });
  const failures: { index: number; error: unknown }[] = [];
  await runPool([...groups.values()], concurrency, async group => {
    for (const operation of group) {
      try {
        await operation.run();
      } catch (error) {

        failures.push({ index: operation.index, error });
        break;
      }
    }
  });
  if (failures.length > 0) throw failures.sort((a, b) => a.index - b.index)[0].error;
  return {
    written: operations.filter(operation => operation.kind === "WRITTEN").length,
    cleared: operations.filter(operation => operation.kind === "CLEARED").map(operation => operation.obligationId),
    clearedAsRetired: operations.filter(operation => operation.kind === "RETIRED").map(operation => operation.obligationId),
  };
}
