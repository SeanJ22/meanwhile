/**
 * Pima Legistar outcome acquisition and canonical promotion on the standing
 * routine clock.
 *
 * `pima-legistar-outcomes` is a routine contract (ROUTINE_SOURCE_CONTRACTS in
 * lib/civic-data/contracts.ts). The standing routine runner invokes this
 * internal adapter as `--promote --slug pima` on the contract's cadence.
 * Owner-initiated work enters through the installed runtime dispatcher as a
 * routine-refresh request that the same standing parent executes. This scope
 * has no manual promotion door.
 *
 * Every changed sitting becomes its own candidate. A failed items/votes read
 * is therefore a durable refused attempt while the prior GOOD pointer stays
 * live; a later unaffected sitting may still promote. The run then prints
 * exactly one `RCD_RECEIPT`, naming the last candidate it wrote:
 *
 * - exit 0 only when that candidate is the GOOD promoted pointer: the last
 *   changed sitting, or the validated no-change receipt written when every
 *   sitting in the window is held and unchanged;
 * - exit 2 when the events read failed, returned zero sittings, or any walked
 *   sitting was refused. A refusal followed by a later promotion writes one
 *   refused run record against the moved pointer, so the receipt still says
 *   HELD and the retry clock, not the cadence, owns the next attempt.
 *
 * The default window is rolling and bounded: the last
 * OUTCOME_ROUTINE_WINDOW_DAYS days through today in the body's own zone,
 * because outcomes exist only for sittings already held. `refreshDecision`
 * skips every held sitting whose publisher `EventLastModifiedUtc` is unchanged,
 * so an unchanged day costs one events request.
 *
 * This command writes no tracked file and never invokes software CI or
 * release machinery.
 *
 * @freshness-reads-here — event and sitting timestamps are captured only
 * after their corresponding official Legistar read has returned.
 */
import { processRegisteredRoutineCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import type { RoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { captureSourceAcquisitions, type SourceAcquisitionEvidence } from "../lib/sources/acquisition-trace.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { isDirectModuleExecution } from "../lib/ops/main-module.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import {
  fetchEventItemVotes,
  fetchEventItems,
  fetchEvents,
} from "../lib/sources/legistar/client.ts";
import { findClient, resolveNativeBody, type LegistarClient } from "../lib/sources/legistar/client-registry.ts";
import { legistarMeetingId, legistarStartsAt } from "../lib/sources/legistar/index.ts";
import { collectEventOutcomes } from "../lib/sources/legistar/outcomes.ts";
import type { LegistarEvent, LegistarEventItem, LegistarVote } from "../lib/sources/legistar/types.ts";
import {
  countSitting,
  emptyTally,
  mergeSnapshot,
  refreshDecision,
  toPersistedSitting,
  type IngestTally,
} from "../lib/outcomes/ingest.ts";
import {
  PIMA_OUTCOME_TENANT,
  legistarOutcomesCandidate,
  type OutcomeTenant,
} from "../lib/outcomes/data-plane.ts";
import { readDoorOutcomeProjection } from "../lib/outcomes/store.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { legistarClientsFromWiring } from "../lib/sources/legistar/client-registry.ts";
import { ensureMeetingDoors } from "../lib/doors/meeting-doors.ts";
import { loadOutcomePartitionForDoor } from "../lib/doors/outcome-door-load.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../lib/outcomes/types.ts";
import { rollingOutcomeWindow, type OutcomeWindow } from "../lib/outcomes/window.ts";

/** Outcomes exist only for held sittings; the routine window looks back this far. */
export const OUTCOME_ROUTINE_WINDOW_DAYS = 120;
const DEFAULT_MAX_SITTINGS = 40;

export interface PimaOutcomeIngestArgs {
  readonly slug: string;
  /** The door whose outcomes this run reads; null for Pima's own contract. */
  readonly door: string | null;
  readonly bodyId: number | null;
  /** Explicit operator bounds; null takes the rolling routine window. */
  readonly from: string | null;
  readonly to: string | null;
  readonly maxSittings: number;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly promote: boolean;
}

export function parsePimaOutcomeIngestArgs(argv: readonly string[]): PimaOutcomeIngestArgs {
  const read = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at >= 0 && at + 1 < argv.length ? String(argv[at + 1]) : null;
  };
  const body = read("--body");
  const max = read("--max-sittings");
  return {
    slug: read("--slug") ?? "pima",
    door: read("--door"),
    bodyId: body === null ? null : Number(body),
    from: read("--from"),
    to: read("--to"),
    maxSittings: max === null ? DEFAULT_MAX_SITTINGS : Number(max),
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    promote: argv.includes("--promote"),
  };
}

export type { OutcomeWindow };

/**
 * The rolling routine window: today in the body's zone back
 * OUTCOME_ROUTINE_WINDOW_DAYS days. `--from`/`--to` remain explicit overrides.
 */
export function pimaOutcomeWindow(
  args: Pick<PimaOutcomeIngestArgs, "from" | "to">,
  timeZone: string,
  at: Date,
): OutcomeWindow {
  return rollingOutcomeWindow(args, timeZone, at, OUTCOME_ROUTINE_WINDOW_DAYS, "PIMA_OUTCOME_WINDOW_INVALID");
}

/**
 * Legistar's `...Utc` stamps carry no zone designator. Read them as the UTC
 * instant their field name states rather than in whatever zone the host runs.
 */
export function legistarUtcInstant(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  const at = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function newestSourceStamp(events: readonly LegistarEvent[]): string | null {
  return events
    .map((event) => legistarUtcInstant(event.EventLastModifiedUtc))
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
}

/**
 * Every candidate this contract writes is the WHOLE held projection plus the
 * sittings this run changed, so its source-through may never precede the
 * pointer it extends. Sittings are walked newest-sitting-first, not
 * newest-modification-first: stamping each candidate with its own sitting's
 * modification time made the GOOD contract refuse every later, older-modified
 * sitting of the same run as a version regression. The observed stamp wins
 * only when it is later by both the instant order and the string order the
 * GOOD contract applies; otherwise the pointer's own value is kept.
 */
export function outcomeSourceThrough(prior: string | null, observed: string): string {
  if (prior === null || prior === "") return observed;
  const priorAt = Date.parse(prior);
  const observedAt = Date.parse(observed);
  const laterInstant = Number.isFinite(observedAt) && (!Number.isFinite(priorAt) || observedAt > priorAt);
  return laterInstant && observed > prior ? observed : prior;
}

/** The one protocol line the standing runner correlates to this exact task. */
export function pimaOutcomeRunnerReceiptLine(outcome: PromotionOutcome, source?: string): string {
  return "RCD_RECEIPT=" + JSON.stringify({
    source: "pima-legistar-outcomes",
    ...(source === undefined || source === "pima-legistar-outcomes" ? {} : { source }),
    candidateId: outcome.candidate.candidate.id,
    acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: outcome.promoted?.versionId ?? null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  } satisfies RoutineRunnerReceipt);
}

const EMPTY: OutcomeSnapshot = { generatedOn: "UNKNOWN", generatedAt: "UNKNOWN", tenants: [], sittings: [] };

async function currentProjection(store: RoutineDataStore, tenant: OutcomeTenant): Promise<{
  readonly snapshot: OutcomeSnapshot;
  readonly sourceThrough: string | null;
}> {
  // Pima's own pointer keeps its reader; a door's outcomes are read from the door's own scope.
  const read = tenant.contractId === PIMA_OUTCOME_TENANT.contractId
    ? await readDoorOutcomeProjection(tenant.scope, { store, bypassCache: true })
    : await readPromotedCivicData<OutcomeSnapshot>(tenant.recordClass, tenant.scope, { store, bypassCache: true });
  if (read.kind === "PROMOTED") return { snapshot: read.value, sourceThrough: read.metadata.sourceThrough };
  if (read.kind === "NOT_RECORDED") return { snapshot: EMPTY, sourceThrough: null };
  if (read.kind === "BOOTSTRAP") throw new Error("PIMA_OUTCOME_PRODUCTION_BOOTSTRAP_FORBIDDEN");
  throw new Error(`PIMA_OUTCOME_STORE_UNREACHABLE:${read.code}:${read.detail}`);
}

export interface PimaOutcomeIngestInput {
  readonly store: RoutineDataStore;
  readonly client: LegistarClient;
  readonly args: PimaOutcomeIngestArgs;
  readonly window: OutcomeWindow;
  /** The tenant whose pointer this run extends; Pima's own unless a door names another. */
  readonly tenant?: OutcomeTenant;
  /** The observation clock; production reads the wall clock after each read returns. */
  readonly now?: () => string;
  readonly log?: (line: string) => void;
}

export interface PimaOutcomeIngestResult {
  /** Exactly one runner receipt for a promoting run; null for a read-only plan. */
  readonly receiptLine: string | null;
  readonly exitCode: 0 | 2;
  readonly tally: IngestTally;
  readonly promotedSittings: number;
  readonly refusedSittings: readonly string[];
}

/** One bounded routine pass over the Pima events window. */
export async function runPimaLegistarOutcomeIngest(input: PimaOutcomeIngestInput): Promise<PimaOutcomeIngestResult> {
  const { store, client, args, window: eventsWindow } = input;
  const tenant = input.tenant ?? PIMA_OUTCOME_TENANT;
  const now = input.now ?? (() => new Date().toISOString());
  const log = input.log ?? ((line: string) => console.log(line));
  const writes = args.promote && !args.dryRun;
  const tally = emptyTally();
  const refusedSittings: string[] = [];
  let promotedSittings = 0;

  const current = await currentProjection(store, tenant);
  let snapshot = current.snapshot;
  let sourceThrough = current.sourceThrough;
  const heldById = new Map(snapshot.sittings.map((sitting) => [sitting.meetingId, sitting]));

  const persist = (candidate: {
    readonly snapshot: OutcomeSnapshot;
    readonly acquisitions: readonly SourceAcquisitionEvidence[];
    readonly retrievedAt: string;
    readonly sourceThrough: string;
    readonly failureDetail?: string;
  }): Promise<PromotionOutcome> => processRegisteredRoutineCandidate(
    store,
    tenant.contractId,
    legistarOutcomesCandidate(candidate, tenant),
    candidate.retrievedAt,
  );
  const settle = (last: PromotionOutcome): PimaOutcomeIngestResult => ({
    receiptLine: pimaOutcomeRunnerReceiptLine(last, tenant.contractId),
    exitCode: last.promoted ? 0 : 2,
    tally,
    promotedSittings,
    refusedSittings,
  });

  const attemptedAt = now();
  let eventEvidence: readonly SourceAcquisitionEvidence[] = [];
  let events: readonly LegistarEvent[] = [];
  try {
    const captured = await captureSourceAcquisitions((runForSource) =>
      runForSource(tenant.sourceId, async () => {
        const bodyId = await resolveNativeBody(client);
        if (client.slug !== args.slug || (args.bodyId !== null && args.bodyId !== bodyId)) throw new Error("LEGISTAR_OUTCOME_BODY_IDENTITY_MISMATCH");
        return fetchEvents<LegistarEvent>(args.slug, { from: eventsWindow.from, to: eventsWindow.to, bodyId });
      }),
    );
    events = captured.value;
    eventEvidence = captured.evidence;
  } catch (error) {
    if (!writes) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    log(`${args.slug}: events acquisition failed — ${detail}`);
    return settle(await persist({
      snapshot,
      acquisitions: [],
      retrievedAt: attemptedAt,
      sourceThrough: attemptedAt,
      failureDetail: `${tenant.label} events acquisition failed: ${detail}`,
    }));
  }
  const eventsRetrievedAt = now();

  const sittings = events.filter((event) => event.EventBodyId === client.eventBodyId)
    .slice()
    .sort((left, right) => String(right.EventDate).localeCompare(String(left.EventDate)));
  const population = floored(
    `sittings for ${args.slug}${args.bodyId === null ? "" : ` body ${args.bodyId}`}`,
    `webapi.legistar.com events ${eventsWindow.from}..${eventsWindow.to}`,
    events.length,
    sittings.length,
    events.length === 0 ? "the events route returned no rows; this establishes no fact about the body" : undefined,
  );
  log(`${args.slug}: ${sittings.length} sitting(s) ${eventsWindow.from}..${eventsWindow.to}\n${floorLine(population)}`);

  if (sittings.length === 0) {
    if (!writes) throw new Error("PIMA_LEGISTAR_ZERO_SITTINGS_HELD");
    log("PIMA_LEGISTAR_ZERO_SITTINGS_HELD: a zero-row events read is a failed extraction.");
    return settle(await persist({
      snapshot,
      acquisitions: eventEvidence,
      retrievedAt: eventsRetrievedAt,
      sourceThrough: eventsRetrievedAt,
      failureDetail: `The bounded ${tenant.label} events query returned zero sittings; no governmental absence is inferred.`,
    }));
  }

  let last: PromotionOutcome | null = null;
  let budgetExhausted = false;
  for (const event of sittings) {
    tally.sittingsSeen += 1;
    const meetingId = legistarMeetingId(args.slug, event.EventId);
    const decision = args.force ? ({ walk: true, reason: "FORCED" } as const) : refreshDecision(event, heldById.get(meetingId));
    if (!decision.walk) {
      tally.skippedUnchanged += 1;
      continue;
    }
    if (tally.walked >= args.maxSittings) {
      budgetExhausted = true;
      break;
    }
    if (!writes) {
      log(`  would walk ${meetingId} — ${decision.reason}`);
      tally.walked += 1;
      continue;
    }

    const detail = await captureSourceAcquisitions((runForSource) =>
      runForSource(tenant.sourceId, async () => {
        try {
          const collected = await collectEventOutcomes(args.slug, event.EventId, {
            sourceOrg: client.publishingOrg,
            fetchItems: (slug, id) => fetchEventItems<LegistarEventItem>(slug, id),
            fetchVotes: (slug, id) => fetchEventItemVotes<LegistarVote>(slug, id),
            now: () => new Date(now()),
          });
          return { collected, error: null as string | null };
        } catch (error) {
          return {
            collected: {
              slug: args.slug,
              eventId: event.EventId,
              agenda: [],
              outcomes: [],
              rollCalls: [],
              failedRollCallExtractions: [],
              voteRequestFailures: [],
            },
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const observedAt = now();
    const persisted: PersistedSittingOutcomes = toPersistedSitting({
      event,
      client,
      collected: detail.value.collected,
      observedAt,
      startsAt: legistarStartsAt(event, client.timeZone),
      routesWalked: detail.value.error ? ["WEBAPI_EVENTS"] : ["WEBAPI_EVENTS", "WEBAPI_EVENTITEMS", "WEBAPI_EVENTITEM_VOTES"],
      ...(detail.value.error ? { requestError: detail.value.error } : {}),
    });
    countSitting(tally, persisted);
    const proposed = mergeSnapshot(snapshot, [persisted], {
      generatedOn: observedAt.slice(0, 10),
      generatedAt: observedAt,
    });
    const outcome = await persist({
      snapshot: proposed,
      acquisitions: [...eventEvidence, ...detail.evidence],
      retrievedAt: observedAt,
      sourceThrough: outcomeSourceThrough(sourceThrough, legistarUtcInstant(event.EventLastModifiedUtc) ?? observedAt),
      ...(detail.value.error ? { failureDetail: `Sitting ${meetingId} acquisition failed: ${detail.value.error}` } : {}),
    });
    last = outcome;
    if (outcome.promoted) {
      snapshot = proposed;
      sourceThrough = outcome.candidate.candidate.temporal.sourceThrough;
      heldById.set(meetingId, persisted);
      promotedSittings += 1;
    } else {
      refusedSittings.push(`${meetingId} (${outcome.candidate.failureCode ?? outcome.candidate.state})`);
    }
    log(
      `  ${meetingId} ${String(event.EventDate).slice(0, 10)} (${decision.reason}): ` +
        `${persisted.agenda.length} item(s), ${persisted.outcomes.length} action(s), ` +
        `${persisted.rollCalls.length} roll call(s) — ${outcome.promoted ? "PROMOTED" : `HELD ${outcome.candidate.failureCode ?? outcome.candidate.state}`}`,
    );
  }

  log("MEASURED, not estimated:");
  for (const [key, count] of Object.entries(tally)) log(`  ${key.padEnd(28)} ${count}`);
  if (budgetExhausted) {
    log(`STOPPED AT THE PER-RUN BUDGET of ${args.maxSittings}; the remaining sittings stay due and no completion is inferred.`);
  }
  if (!writes) {
    return { receiptLine: null, exitCode: 0, tally, promotedSittings, refusedSittings };
  }

  if (last === null) {
    // Every sitting in the window is held and its publisher stamp is
    // unchanged: one validated no-change receipt against the live pointer.
    const observedAt = now();
    last = await persist({
      snapshot,
      acquisitions: eventEvidence,
      retrievedAt: observedAt,
      sourceThrough: outcomeSourceThrough(sourceThrough, newestSourceStamp(events) ?? eventsRetrievedAt),
    });
    log(`  no-change receipt: ${last.promoted ? "PROMOTED" : `HELD ${last.candidate.failureCode ?? last.candidate.state}`}`);
  } else if (refusedSittings.length > 0 && last.promoted) {
    // A refused sitting's durable candidate was followed by a promotion, so it
    // no longer describes the live pointer. Record the run's held disposition
    // against the pointer as it now stands; the refused sittings stay due.
    const observedAt = now();
    last = await persist({
      snapshot,
      acquisitions: eventEvidence,
      retrievedAt: observedAt,
      sourceThrough: sourceThrough ?? eventsRetrievedAt,
      failureDetail:
        `${refusedSittings.length} ${tenant.label} sitting acquisition(s) were refused in this run: ${refusedSittings.join("; ")}. ` +
        "Every sitting that validated is live in the canonical pointer; the refused sittings stay due for the next attempt.",
    });
    log(`  run held: ${refusedSittings.length} refused sitting(s) recorded against the moved pointer`);
  }
  return settle(last);
}

async function main(): Promise<void> {
  const args = parsePimaOutcomeIngestArgs(process.argv.slice(2));
  // Any other body is read through the door that names it; Pima's own contract serves only Pima.
  if (args.door === null && args.slug !== "pima") {
    throw new Error("PIMA_OUTCOME_CONTRACT_SCOPE_MISMATCH: another Legistar body is read through its own door (--door).");
  }
  if (!args.promote && !args.dryRun) {
    throw new Error("PIMA_OUTCOME_PROMOTION_REQUIRED: use --promote, or --dry-run for a read-only plan.");
  }
  if (args.promote && args.dryRun) {
    throw new Error("PIMA_OUTCOME_MODE_AMBIGUOUS: --promote writes and --dry-run never does; pass exactly one.");
  }
  if (!Number.isInteger(args.maxSittings) || args.maxSittings < 1) throw new Error("--max-sittings must be a positive integer");
  if (args.bodyId !== null && !Number.isInteger(args.bodyId)) throw new Error("--body must be an integer Legistar body id");
  installNeonRequestDeadline();
  if (args.promote) prepareProductionCivicDataWrite();
  let tenant: OutcomeTenant = PIMA_OUTCOME_TENANT;
  let client: LegistarClient | undefined;
  if (args.door !== null) {
    const partition = await loadOutcomePartitionForDoor(args.door);
    if (partition.kind !== "legistar" || partition.tenant.slug !== args.slug) {
      throw new Error(`OUTCOME_DOOR_MISMATCH: ${args.door} is not the Legistar Web API door of ${args.slug}.`);
    }
    tenant = partition.tenant;
    client = legistarClientsFromWiring([partition.wiring])[0];
  } else {
    // Pima's own contract: its client is read off the published meeting doors.
    const doors = await ensureMeetingDoors();
    if (!doors.ready) throw new Error(`MEETING_DOORS_UNREADABLE: ${doors.reason}`);
    client = findClient(args.slug, "ocd-division/country:us/state:az/county:pima#governing");
  }
  if (!client) throw new Error("PIMA_LEGISTAR_CLIENT_NOT_REGISTERED");
  const run = await runPimaLegistarOutcomeIngest({
    store: new PostgresRoutineDataStore(),
    client,
    args,
    tenant,
    window: pimaOutcomeWindow(args, client.timeZone, new Date()),
  });
  if (run.receiptLine !== null) console.log(run.receiptLine);
  process.exitCode = run.exitCode;
}

if (isDirectModuleExecution(import.meta.url)) await main();
