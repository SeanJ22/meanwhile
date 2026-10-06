/**
 * **THE SCHEDULER'S STATE, WHERE IT SURVIVES THE PROCESS.**
 * (Session B resume, W3.B and W3.C, 2026-08-31. RULING 212, RULING 218.)
 *
 * ## What was wrong, stated plainly
 *
 * `FreshnessDebt` existed in `debt.ts` and in the shadow loop's signature, and
 * nowhere else. `runCycle` accepted `debts` as an input and the runner passed
 * `debts: []` on every invocation. So the retry logic was real, tested, and
 * unreachable: a route that failed on Monday was not retried on Tuesday by a
 * fresh process, because Tuesday's process started with an empty debt list and
 * had no way to learn otherwise. A self-retrying debt that no process can
 * inherit is a comment about retrying.
 *
 * The second half was recurrence. The runner created ONE WorkItem and ONE
 * RouteTask per standing obligation and reused them every cycle. That only
 * appeared to work because the executor never disposed of anything — a
 * disposed RouteTask is settled, `reclaim` refuses to reopen it, and it cannot
 * be the container for the next occurrence. Fixing the executor (W3.A) makes
 * the reuse fail immediately, which is why both halves are one module.
 *
 * ## The model
 *
 * ```
 *   StandingObligation      never completes. Comes due, is worked, comes due
 *                           again. Carries next_due_at, which is INDEXED.
 *        |
 *        +-- occurrence 1   its own WorkItem, RouteTask, Attempt, disposition
 *        +-- occurrence 2   a DIFFERENT WorkItem and RouteTask
 *        +-- ...
 * ```
 *
 * The occurrence is the thing that completes. The obligation is the thing that
 * recurs. Modelling them as one row is what forced the reuse, and modelling
 * the obligation as a WorkItem would make "complete" mean two different things
 * in one store — which is the reason `obligation.ts` says it is deliberately
 * not a WorkItem.
 *
 * **Identity is DERIVED, and that is what makes no-RouteTask-reuse structural
 * rather than a rule somebody must remember.** An occurrence's WorkItem id is
 * derived from the obligation id AND the sequence number, and a RouteTask id is
 * derived from its WorkItem id. Two occurrences cannot collide on a RouteTask
 * without colliding on a sequence number first, and the sequence number comes
 * from the durable obligation row.
 */

import { createRouteTask, type RouteDisposition, type RouteTask } from "../route-task.ts";
import { createWorkItem, type WorkItem } from "../work-item.ts";
import { inheritPublicationConnection } from "../workers/autonomous-plan.ts";
import { questionOfObligation } from "../work-question.ts";
import { registerRouteTask, registerWorkItem } from "../repository/coordinator.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";

import type { FreshnessDebt } from "./debt.ts";
import { DISCHARGING_DISPOSITIONS } from "./dispatch.ts";
import type { FreshnessObligation } from "./obligation.ts";
import { runPool } from "./shadow-loop.ts";
import { absenceHold } from "./absence-hold.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";

/** The project every freshness WorkItem is filed under. One string, one place. */
export const FRESHNESS_PROJECT = "freshness";

/**
 * A standing obligation as the control plane holds it.
 *
 * `nextDueAt` is STORED rather than only derived, and the Postgres provider
 * indexes it. Deriving it per cycle is correct and is what `scheduleAll` does;
 * storing it is what lets a due-time query ask the database for the work that
 * is due instead of loading every obligation and filtering in the process. At
 * 78 obligations the difference is nothing. The reason to build it now is that
 * the shape which does not scale is the shape that gets shipped.
 */
export interface StandingObligation extends FreshnessObligation {
  /** The derived next-due, as of the last cycle that scheduled it. */
  readonly nextDueAt: string | null;
  /** How many occurrences this obligation has opened. Monotonic. */
  readonly occurrenceCount: number;
  /** The occurrence currently open, if one is. */
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

/**
 * ONE DUE OCCURRENCE of a standing obligation.
 *
 * This is the thing that has a lifecycle. It opens when the obligation comes
 * due, owns exactly one WorkItem and one RouteTask, and closes when that
 * RouteTask reaches a terminal disposition — or is abandoned, in which case it
 * closes unresolved and the obligation opens a NEW one next time rather than
 * reusing a settled task.
 */
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
  /** The terminal disposition, when one was committed. Null otherwise. */
  readonly disposition: string | null;
  /** Why it closed without one. Null when it closed WITH one, or is open. */
  readonly unresolvedReason: string | null;
}

export function occurrenceId(obligationId: string, sequence: number): string {
  return `occ-${obligationId}-${String(sequence).padStart(6, "0")}`;
}

/**
 * The obligation clause of the occurrence's WorkItem, and the reason the
 * sequence number is in it.
 *
 * `workItemId` is a fingerprint over (project, subject, obligation). Putting
 * the sequence in the obligation clause is what makes occurrence 2's WorkItem
 * a different aggregate from occurrence 1's — and therefore what makes its
 * RouteTask a different aggregate, since a RouteTask id is derived from its
 * WorkItem id. Without it, every occurrence would derive the same two ids and
 * the reuse this module exists to end would come back silently.
 */
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

/**
 * The fields a durable row owns because THIS PROCESS DID NOT PRODUCE THEM.
 *
 * Runtime state, every one: how many occurrences have opened, which is open,
 * when the obligation was last actually worked to a disposition, and the
 * next-due derived from that. A registration pass that re-put the corpus
 * version of these would silently reset the schedule on every start, which is
 * the same defect as having no durable state at all, wearing a store.
 */
const RUNTIME_OWNED = [
  "nextDueAt",
  "occurrenceCount",
  "openOccurrenceId",
  "lastWorkedAt",
  /* A recorded expiring absence (RULING 52/53) is runtime state a scout produced,
     not a corpus signal; a registration pass must never reset it. */
  "absentUntil",
  "absenceUnlock",
  "absenceReopened",
  /* The owner's dispatch materialized this row (MW-028). A provider that
     re-emits it without the mark must not erase the mark that keeps it owed. */
  "materializedBy",
  /* The owner's Sends that reached this row (MW-001). The runner appends them;
     no provider emits them, and a registration pass must never drop them. */
  "assignments",
  /* Which registry the dispatch materialized it from (2026-09-25): kept with the mark. */
  "materializedFrom",
  "autonomousPlan",
] as const;

/**
 * Register what is new, and REFRESH THE SIGNALS on what is not.
 *
 * ## The defect this closes, found by hitting it
 * (Session C, PART D, 2026-08-31.)
 *
 * This function used to READ an existing row and return it untouched. That is
 * right for the four runtime fields above and wrong for everything else, and
 * the difference showed up the first time a provider CORRECTED a cadence
 * signal: the campaign-finance records were registered with `readerImpactAt`
 * set to the 2026 general election, that was diagnosed as a misreading of the
 * field — campaign-finance staleness costs a reader today, not in November —
 * and the corrected provider emitted `null`. **The correction could not reach
 * the durable rows.** They kept deriving a thirty-day cadence from a signal the
 * code no longer produces, and nothing anywhere reported a disagreement.
 *
 * A provider's signals are DERIVED FROM COMMITTED INPUTS on every pass, so the
 * corpus is authoritative for them and the store is authoritative for runtime
 * state. Splitting on that line is what makes a corrected derivation take
 * effect without resetting a clock.
 *
 * `refreshed` names every row whose signals actually moved, so a cycle that
 * silently re-cadenced 78 obligations is visible rather than inferred.
 */
export async function syncObligations(
  repos: ControlPlaneRepositories,
  corpus: readonly FreshnessObligation[],
  now: string,
  options: { readonly exactReads?: boolean } = {},
): Promise<{
  readonly all: readonly StandingObligation[];
  readonly registered: readonly string[];
  readonly alreadyDurable: readonly string[];
  /** Durable rows whose provider-derived signals changed this pass. */
  readonly refreshed: readonly { readonly id: string; readonly changed: readonly string[] }[];
  /**
   * The durable rows this pass read that the corpus did NOT name, which is the
   * input `planSupersededRetirement` judges (2026-09-23). Null under
   * `exactReads`, which reads only the corpus's own rows and so cannot see
   * what the registry stopped emitting.
   */
  readonly outside: readonly StandingObligation[] | null;
}> {
  const registered: string[] = [];
  const alreadyDurable: string[] = [];
  const refreshed: { id: string; changed: string[] }[] = [];
  const all: StandingObligation[] = [];

  /*
   * ONE READ OF THE WHOLE TABLE, not one read per obligation.
   * (Session C3, lane C, 2026-09-01.)
   *
   * This loop used to issue `repos.obligations.read(o.id)` per row, which is one
   * network round trip per obligation against the Postgres control plane. That
   * was invisible at 99 obligations and became the binding constraint the
   * moment RULING 229 was taken seriously: acquiring to the AUTHORITATIVE
   * SOURCE UNIVERSE means the corpus is thousands of rows, not dozens, and a
   * scheduler whose registration cost is linear in round trips would have made
   * "name every government" cost minutes per cycle.
   *
   * `list()` is on the same interface, is ordered by id, and both stores
   * implement it. The semantics below are unchanged — same CAS, same revisions,
   * same refusal to touch runtime-owned fields — because the only thing that
   * moved is WHERE the existing row is found.
   */
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
    const next: StandingObligation = {
      ...o,
      nextDueAt: held.nextDueAt,
      occurrenceCount: held.occurrenceCount,
      openOccurrenceId: held.openOccurrenceId,
      lastWorkedAt: held.lastWorkedAt,
      absentUntil: held.absentUntil,
      ...(held.absenceUnlock !== undefined ? { absenceUnlock: held.absenceUnlock } : {}),
      ...(held.materializedBy !== undefined ? { materializedBy: held.materializedBy } : {}),
      ...(held.assignments !== undefined ? { assignments: held.assignments } : {}),
      ...(held.materializedFrom !== undefined ? { materializedFrom: held.materializedFrom } : {}),
      ...(held.autonomousPlan !== undefined ? { autonomousPlan: held.autonomousPlan } : {}),
      updatedAt: now,
    };

    const changed: string[] = [];
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

/**
 * Permanently stop clocks whose executable provider has been retired.
 *
 * Aggregate repositories intentionally have no delete operation: the owner
 * must retain the historical occurrence/debt trail. Retirement therefore has
 * one precise durable representation — inactive, no next due, and an explicit
 * reason/time. The call is idempotent and reports both rows it changed and
 * rows a prior cycle had already retired.
 */
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

/**
 * **AN OBLIGATION THE REGISTRY NO LONGER EMITS IS RETIRED, NEVER LEFT LIVE.**
 * (2026-09-23.)
 *
 * `syncObligations` walks the corpus, so a durable row the registry stopped
 * emitting stayed `active` forever: never scheduled, never retired, and any
 * occurrence it held stayed open. The shape seen on 2026-09-23: a candidate
 * whose site was recorded is owed under `#candidate-site-recorded`, and its
 * `#candidate-authored-awaits-site` row lived on. Ten of those held open
 * occurrences that no recovery could reach. And every count read from the
 * store rather than the corpus included such rows.
 *
 * A row outside the corpus is RETIRED only when all of these hold:
 *
 * - it is active;
 * - its namespace (`freshness:<namespace>:`) belongs to exactly one provider
 *   this cycle;
 * - that provider read cleanly: no `readFailure`, no `emptyReason`, and at
 *   least one unit;
 * - retiring it keeps that provider under `SUPERSEDED_RETIREMENT_BOUND` this
 *   cycle.
 *
 * Every other row outside the corpus is HELD BACK by name. A provider that
 * could not read its input, or read nothing, or suddenly emits far less, is
 * never evidence that its obligations ended. A retirement also reverses
 * itself: when the registry emits the id again, `syncObligations` finds
 * `active` changed and writes the row live.
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

/** One row to retire, or to settle if already retired, and the reason its row, occurrence and debt carry. */
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

/**
 * Which rows outside the corpus to retire, and which to hold back and why.
 * PURE: the caller passes the rows `syncObligations` read (`outside`), the
 * cycle's FULL, unfiltered registry units, and the provider reports.
 */
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

/**
 * **A NEED THAT MOVED RETIRES NAMING WHERE IT NOW LIVES.** (2026-09-23.)
 *
 * Since 902f5c50 the local-jurisdictions provider opens no MEETINGS source, so
 * no freshness clock carries a jurisdiction's meetings discovery, and the old
 * `freshness:jurisdiction:<id>#meetings-N` rows sit outside the corpus. On
 * 2026-09-23, 484 were still active. That was more than
 * `SUPERSEDED_RETIREMENT_BOUND` allows, so `planSupersededRetirement` held
 * them all. They are not superseded: the need did not end. The committed gap
 * ledger now records it (`meetingsDiscovery.needs`).
 *
 * This planner owns every such row outside the corpus, and
 * `planSupersededRetirement` is given none of them. A row is RETIRED, with a
 * reason naming the ledger entry, only when all of these hold:
 *
 * - it is active;
 * - the provider that owns `freshness:jurisdiction:` read cleanly this cycle;
 * - the ledger could be read, and lists the row's jurisdiction.
 *
 * Every other such row stays active and is held back by name. A retirement
 * discovers nothing and says so: no scheduler walks the ledger's needs yet.
 * If a provider emits the id again, `syncObligations` writes the row live.
 */
const JURISDICTION_MEETINGS_OBLIGATION = /^freshness:jurisdiction:([^#]+)#meetings-\d+$/;

/** The jurisdiction a `freshness:jurisdiction:<id>#meetings-N` row was owed for; null for any other id. */
export function jurisdictionMeetingsSubject(id: string): string | null {
  return JURISDICTION_MEETINGS_OBLIGATION.exec(id)?.[1] ?? null;
}

export type MovedHold = SupersededHold | "LEDGER_UNREADABLE" | "NOT_RECORDED_IN_LEDGER";

/** Why a jurisdiction meetings row was retired, naming the ledger entry that now records the need. */
export function movedToGapLedgerReason(ledgerPath: string, jurisdictionId: string): string {
  return (
    `MOVED TO THE GAP LEDGER: this jurisdiction's meetings discovery is still owed. ${ledgerPath} records it ` +
    `(meetingsDiscovery.needs, ${jurisdictionId}), and no freshness clock carries it. Nothing was discovered`
  );
}

export function planMovedToGapLedger(input: {
  readonly outside: readonly StandingObligation[];
  readonly corpus: readonly { readonly providerId: string; readonly obligationId: string }[];
  readonly providers: readonly ProviderReading[];
  /** The committed ledger's path, and the jurisdictions it lists or why it could not be read. */
  readonly ledger: {
    readonly path: string;
    readonly recorded: { readonly jurisdictionIds: ReadonlySet<string> } | { readonly unreadable: string };
  };
}): {
  /** Every row this planner owns. None of them is given to `planSupersededRetirement`. */
  readonly owned: ReadonlySet<string>;
  readonly retire: readonly RetirementItem[];
  readonly heldBack: readonly { readonly obligationId: string; readonly code: MovedHold; readonly why: string }[];
} {
  const inCorpus = new Set(input.corpus.map((u) => u.obligationId));
  const ownerOf = cleanOwnerOf(input.corpus, input.providers);
  const { path, recorded } = input.ledger;
  const owned = new Set<string>();
  const retire: RetirementItem[] = [];
  const heldBack: { obligationId: string; code: MovedHold; why: string }[] = [];
  for (const row of input.outside) {
    const jurisdictionId = jurisdictionMeetingsSubject(row.id);
    if (jurisdictionId === null || inCorpus.has(row.id)) continue;
    owned.add(row.id);
    if (!row.active) continue;
    const owner = ownerOf(row.id);
    if ("code" in owner) {
      heldBack.push({ obligationId: row.id, ...owner });
    } else if ("unreadable" in recorded) {
      heldBack.push({
        obligationId: row.id,
        code: "LEDGER_UNREADABLE",
        why: `the gap ledger could not be read (${recorded.unreadable}), so nothing shows this need is recorded`,
      });
    } else if (!recorded.jurisdictionIds.has(jurisdictionId)) {
      heldBack.push({
        obligationId: row.id,
        code: "NOT_RECORDED_IN_LEDGER",
        why: `${path} does not list ${jurisdictionId}, so retiring this row would drop a need nothing records`,
      });
    } else {
      retire.push({ obligationId: row.id, reason: movedToGapLedgerReason(path, jurisdictionId) });
    }
  }
  retire.sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
  heldBack.sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
  return { owned, retire, heldBack };
}

/**
 * **A RETIRED ROW HOLDS NO OPEN OCCURRENCE.** `retireObligationsByPrefix`
 * retires a row and leaves its occurrence open. On 2026-09-23 the legacy
 * meetings retirements held 20 that way. Any inactive row still pointing at
 * an occurrence is settled under its own retirement reason. It is found from
 * the rows `syncObligations` already read, with no extra read.
 */
export function planRetiredResidue(outside: readonly StandingObligation[]): readonly RetirementItem[] {
  return outside
    .filter((row) => !row.active && row.openOccurrenceId !== null)
    .map((row) => ({ obligationId: row.id, reason: row.retirementReason ?? "RETIRED: this obligation was retired" }))
    .sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
}

/**
 * Retire each row, or settle one already retired, in this order:
 *
 * 1. close EVERY open occurrence it owns, including one its pointer lost,
 *    UNRESOLVED under the item's reason and never with a disposition, so the
 *    anchor does not move. The query is bounded to that one obligation;
 *    nothing loads every occurrence;
 * 2. an active row is retired: inactive, no next-due, no open occurrence, and
 *    the reason. An already-retired row keeps its own retirement and only
 *    loses a dangling occurrence pointer.
 *
 * Its freshness debt is not written here. The cycle keeps a retired row's debt
 * out of the schedule, and `persistDebts` writes it as a tombstone that names
 * the retirement.
 *
 * Nothing is deleted, and the RouteTask, its Attempts, commits and artifacts
 * are never written. An interruption is safe: the row stays active until the
 * last step, so the next cycle plans it again and finds the earlier step
 * already done. One row's throw is isolated and named, never the cycle's.
 *
 * **A cycle spends a bounded share of its wall here.** (2026-09-23.) Each row
 * costs three store round trips, and five more for each occurrence it closes;
 * 43 rows took 34 s in production, and 484 would take minutes out of a cycle
 * with a 15-minute wall. The caller's
 * `budget` is asked before each row; once it is spent, the rest are returned
 * as `deferred`, untouched, and planned again next cycle. Items are taken in
 * the caller's order. This module reads no clock: the caller owns the budget.
 */
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

      /* Every open occurrence the row owns, not only the one it points at: on
         2026-09-23 one superseded row held an occurrence its pointer had lost. */
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

/**
 * **RESUME THE OCCURRENCE THIS OBLIGATION ALREADY HAS OPEN.**
 * (Session C3, lane C, 2026-09-01.)
 *
 * ## The state this exists to stop accumulating
 *
 * `openOccurrence` always opens sequence N+1. That was right while every due
 * obligation was dispatched in the same cycle that opened it — the occurrence
 * was opened, worked and closed before the next cycle looked.
 *
 * Under RULING 229 the corpus is the authoritative source universe and a cycle
 * carries a stated dispatch ceiling, so an occurrence can now be opened and not
 * reached. Opening a fresh one next cycle strands the first: an occurrence with
 * an open WorkItem and an open RouteTask that nothing will ever dispatch, which
 * **reads back as a worker that abandoned a route** — a false statement about a
 * worker, produced by arithmetic in the runner.
 *
 * So a cycle RESUMES what is open before it opens anything. Returns null when
 * there is nothing open, which is the normal case and the one that opens.
 *
 * ## An OPEN occurrence can hold a SETTLED RouteTask
 * (2026-09-22.)
 *
 * A dispatch commits its disposition while it runs; the cycle closes the
 * occurrence afterwards, in its occurrence-and-debt phase. A cycle that ends
 * between the two (a supervisor kill, a crash) leaves the occurrence open on a
 * RouteTask that is already disposed. Every disposition a cycle commits carries
 * that cycle's start time, so the production residue came in batches sharing
 * one timestamp: 83 dispositions at 2026-09-01T19:36:07.092Z from a cycle that
 * left no cycle record, 62 of whose occurrences were still open on 2026-09-22.
 *
 * Returning such an occurrence for dispatch walked the settled route again. The
 * claim overwrote DISPOSED with CLAIMED, a second Attempt opened, its
 * disposition was refused as a second one, and its lease was left behind. So a
 * settled occurrence comes back as SETTLED, carrying the disposition the
 * RouteTask holds, verbatim, and the caller closes it with
 * `closeSettledOccurrence` instead of dispatching it.
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
  // A new Send can connect an already-open occurrence. Retain its captured
  // evidence and attempts; do not force a second discovery just to attach the
  // missing worker instructions. Existing/repaired instructions stay immutable.
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
  /* `disposition !== null` is the test `reclaim` and `disposeRoute` apply, and it
     is read rather than `state`: 65 production tasks carry a disposition under a
     state a later claim overwrote. */
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

/** What resuming an obligation's open occurrence found. */
export type ResumedOccurrence =
  /** Owed work: the RouteTask carries no disposition yet, so the occurrence is dispatched. */
  | { readonly kind: "OPEN"; readonly id: string; readonly routeTaskId: string }
  /** The route was already settled by the cycle that walked it. */
  | { readonly kind: "SETTLED"; readonly settled: SettledOccurrence };

/**
 * **EVERY SETTLED OPEN OCCURRENCE, FOUND BEFORE ANY LANE RUNS.** (2026-09-23.)
 *
 * A lane recovers a settled occurrence only when it reaches that row, and it
 * reaches a row only through admission: the deterministic ceiling, the
 * dispatch budget, the Scout lane's state. Recovery walks nothing and spends
 * nothing, so it must not wait on dispatch capacity. On 2026-09-23 the 62
 * production recoveries sat at due-queue ranks 17 to 2,621 of about 2,865,
 * with about 25 dispatched per cycle, and those on the model lane sat behind a
 * closed Scout lane.
 *
 * `settledRouteTaskIds` comes from a listing the caller already holds
 * (`settledRouteTaskIds` below). A disposition is only ever added, never
 * cleared, so an earlier listing never names a task that has since become
 * unsettled. That listing only narrows the candidates: each one is confirmed
 * by `resumeOpenOccurrence`, which reads the occurrence and its RouteTask
 * again, so what comes back meets exactly the test a lane applies.
 */
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
 * **ONE PASS OVER THE OCCURRENCES, TWO FINDINGS.** (2026-09-23.) It is the pass
 * `findSettledOccurrences` already made each cycle, so finding abandoned
 * occurrences adds no read.
 *
 * - **settled**: an open occurrence its obligation points at, on a RouteTask
 *   that already carries a disposition. See `findSettledOccurrences`.
 * - **abandoned**: an OPEN occurrence where all of these hold:
 *   - its obligation (in `obligations`) does not point to it;
 *   - its obligation has already opened a later sequence;
 *   - its RouteTask was never claimed (PENDING in the caller's listing, so no
 *     lease, no Attempt and no disposition).
 *   Nothing will resume it, and no work was ever started on it. An open
 *   occurrence that is the latest its obligation opened is never abandoned,
 *   even with its pointer lost; the obligation has not moved on.
 */
export async function scanOccurrences(
  repos: ControlPlaneRepositories,
  input: {
    readonly obligations: readonly StandingObligation[];
    readonly settledRouteTaskIds: ReadonlySet<string>;
    readonly neverClaimedRouteTaskIds: ReadonlySet<string>;
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
  for (const occurrence of await repos.occurrences.list()) {
    if (occurrence.value.closedAt !== null) continue;
    const pointedBy = byOpenOccurrence.get(occurrence.id);
    if (pointedBy !== undefined) {
      if (!input.settledRouteTaskIds.has(occurrence.value.routeTaskId)) continue;
      const resumed = await resumeOpenOccurrence(repos, pointedBy);
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

/**
 * **CLOSE AN ABANDONED OCCURRENCE, AND WRITE NOTHING ELSE.** (2026-09-23.)
 *
 * Every condition is read again at write time: the occurrence is still open,
 * its obligation still points elsewhere and has moved past it, and its
 * RouteTask is still PENDING with no disposition. Anything else is skipped by
 * name.
 *
 * Only the occurrence row is written: closed UNRESOLVED, never with a
 * disposition. The obligation keeps its pointer and its anchor, so this is
 * never `closeOccurrence`, which would clear a live pointer. The RouteTask, its
 * WorkItem, Attempts and leases are not written, and nothing is deleted.
 */
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
      closed.push(occurrence.id);
    } catch (error) {
      failed.push({ occurrenceId, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { closed, skipped, failed };
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

/**
 * Open the next occurrence of a due obligation, with its own WorkItem and
 * RouteTask.
 *
 * Returns null when the obligation names no route — there is nothing to build a
 * RouteTask against, and inventing one would produce a task that can only ever
 * be disposed `NOT_APPLICABLE` for a reason that is about us.
 */
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

  /*
   * **NEVER OPEN PAST AN OCCURRENCE THAT IS STILL OPEN.** (2026-09-23.)
   *
   * Before `resumeOpenOccurrence` existed (24ff5cf2), a cycle that opened an
   * occurrence and never reached it was followed by one that opened sequence
   * N+1 and moved the pointer. That stranded the first: on 2026-09-23, twenty
   * occurrence 1s from 2026-09-01T14:30:45Z were still open. Resuming first is
   * the caller's rule, and this makes it the function's too. It is checked
   * against the row as it is now, not as the caller last read it, and the
   * sequence comes from the same read.
   */
  const current = await repos.obligations.mustRead(o.id);
  if (current.value.openOccurrenceId !== null) {
    const held = await repos.occurrences.read(current.value.openOccurrenceId);
    if (held !== null && held.value.closedAt === null) throw new OccurrenceStillOpen(o.id, held.id);
  }
  const sequence = current.value.occurrenceCount + 1;
  /* MW-002: the round names its question from the row as it is now — never read,
     an argued absence, discovery, or a recheck — and none when that is not on the row. */
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
 * Close an occurrence.
 *
 * `disposition` non-null means the route reached a terminal conclusion and the
 * obligation was DISCHARGED — `lastWorkedAt` moves and the next-due recomputes
 * from it. `disposition` null means it did not, and `lastWorkedAt` does NOT
 * move: an occurrence that was abandoned is not work, and advancing the anchor
 * on it would push the next check further out for having failed, which is the
 * one direction a freshness clock must never drift.
 *
 * `workedAt` is when the reading happened, when that was not `now`. A settled
 * occurrence recovered after an interrupted cycle was worked by that cycle, and
 * its anchor is the committed disposition's time: exactly what that cycle would
 * have written. Absent, the anchor is `now`, the cycle that worked it closing it.
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
      /* A productive disposition also clears any standing absence: a record that
         was argued absent and is now found is no longer absent (RULING 52/53). */
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
 * **CLOSE A SETTLED OCCURRENCE WITHOUT WALKING ITS ROUTE AGAIN.** (2026-09-22.)
 *
 * The disposition the RouteTask already carries is judged by the rule a
 * dispatch's own disposition is judged by (`DISCHARGING_DISPOSITIONS`, which
 * `dischargesObligation` reads):
 *
 * ```
 *   INGESTED, WALKED_NO_YIELD   a reading of the record happened. The occurrence
 *                               closes DISCHARGED; the anchor is the reading's
 *                               own time, `disposition.at`, not now.
 *   anything else               a fact about the route, not a reading. The
 *                               occurrence closes UNRESOLVED, the anchor does not
 *                               move, and the obligation stays due.
 * ```
 *
 * ## What discharge closes, and what it leaves owed
 *
 * It closes THIS OCCURRENCE: `closedAt` and `disposition` on the occurrence,
 * and on the obligation `openOccurrenceId` cleared, `lastWorkedAt` moved and
 * any argued absence (`absentUntil`) cleared; the cycle clears the freshness
 * debt beside it. That is all. The standing obligation never completes — it
 * recurs from the moved anchor. The RouteTask, its Attempts, the disposition
 * commit and the artifact records are neither read for a decision nor written
 * here, so the retrieved bytes stay where the held-evidence workers and the
 * promotion tail read them: their parsing, verification and publication are
 * owed exactly as before. A WALKED_NO_YIELD discharges this period's reading of
 * this one route; the record is not thereby absent, and the next occurrence
 * walks again.
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

/**
 * Record an EXPIRING absence against the durable row (RULING 52/53).
 *
 * A scout that walked the field and argued the record absent sets `absentUntil`;
 * `scheduleObligation` then owes the next reading THEN rather than on the
 * ordinary cadence, so a proven negative is not re-walked every cycle. This is
 * NOT a debt (debt is a failed reading that retries fast); it is a completed,
 * correct negative that rechecks on a clock and is visible as a scheduled row,
 * never an incident. The next productive disposition clears it (disposeRouteTask).
 */
export async function recordArguedAbsence(
  repos: ControlPlaneRepositories,
  input: { readonly obligationId: string; readonly absentUntil: string; readonly now: string; readonly unlockWhen?: import("./absence.ts").AbsenceUnlock },
): Promise<void> {
  const row = await repos.obligations.mustRead(input.obligationId);
  /* DP-11: the hold is the owner's setting tied to the source's pace, never longer than the caller's own expiry. */
  const configRow = await repos.adminConfig.read(ADMIN_CONFIG_ID).catch(() => null);
  const hold = absenceHold(row.value, input.now, configRow && isAdminConfig(configRow.value) ? configRow.value : null);
  const absentUntil = hold.until < input.absentUntil ? hold.until : input.absentUntil;
  if (row.value.absentUntil === absentUntil && row.value.nextDueAt === absentUntil) return;
  /* The unlock keeps when the absence was argued (a later capability reopens it, DP-10) and its real recheck date. */
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

/** ------------------------------------------------------------------ debt */

/**
 * Every debt row this control plane holds.
 *
 * THE ENTRY POINT FOR THE SEEDED FAILURE: a debt created in process 1 is
 * loaded by process 2 through this function, with no shared memory between
 * them. If this returns an empty list where process 1 wrote a row, the debt was
 * never durable and the retry logic above it is decoration.
 */
export async function loadDebts(
  repos: ControlPlaneRepositories,
): Promise<readonly FreshnessDebt[]> {
  const rows = await repos.debts.list();
  return rows.map((r) => r.value);
}

/**
 * Persist this cycle's debt set: write what is owed, clear what is discharged.
 *
 * The clearing half is as important as the writing half and is easier to get
 * wrong. A cycle that only ever wrote debt would accumulate rows for
 * obligations that have since succeeded, and the incident aggregate would
 * report an outage that ended days ago.
 */
export async function persistDebts(
  repos: ControlPlaneRepositories,
  next: readonly FreshnessDebt[],
  now: string,
  scope: readonly string[] | null = null,
  /**
   * Retired obligations, id → reason (2026-09-23). A retired obligation owes no
   * freshness, so the cycle keeps its debt out of `next`. Its tombstone names
   * the retirement and says it is not a reading. A retirement never reads as a
   * discharge.
   */
  retired: ReadonlyMap<string, string> = new Map(),
  /** Independent stored debt IDs can share the caller's repository concurrency. */
  concurrency = 1,
): Promise<{
  readonly written: number;
  readonly cleared: readonly string[];
  readonly clearedAsRetired: readonly string[];
}> {
  const byId = new Map(next.map((d) => [d.obligationId, d]));
  const existing = scope === null
    ? await repos.debts.list()
    : (await Promise.all(scope.map((id) => repos.debts.read(id)))).filter((row) => row !== null);
  const existingById = new Map(existing.map(row => [row.id, row]));
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
    /*
     * A cleared debt is written as a TOMBSTONE rather than deleted, because
     * `AggregateRepository` has no delete and should not grow one: an
     * append-shaped store whose rows can vanish cannot be replayed, and the
     * history of what was behind and recovered is exactly what an operator
     * asks for after an outage. `loadDebts` above returns the tombstone too;
     * `retryable` ignores it because a zero-failure row has no retry due.
     */
    if (row.value.consecutiveFailures === 0) continue;
    operations.push({ id: row.id, obligationId: row.value.obligationId, kind: "CLEARED", run: () => repos.debts.compareAndSet(
      row.id,
      row.revision,
      { ...row.value, consecutiveFailures: 0, detail: `cleared at ${now}: the obligation was discharged` },
      now,
    ) });
  }

  for (const debt of next) {
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
        // A failed write is not retried by a later operation on the same row.
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

/**
 * The obligations whose stored next-due has passed.
 *
 * The provider-neutral form is a filter over `list()`; the Postgres provider
 * has an index on `next_due_at` that makes the same question a range scan. Both
 * answer identically, which is the property the conformance suite checks.
 */
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
