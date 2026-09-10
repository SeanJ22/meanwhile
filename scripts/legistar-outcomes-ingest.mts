/**
 * Owner-invoked Pima Legistar acquisition and canonical promotion.
 *
 * Every changed sitting becomes its own candidate. A failed items/votes read
 * is therefore a durable refused attempt while the prior GOOD pointer stays
 * live; a later unaffected sitting may still promote. This command writes no
 * tracked file and never invokes software CI or release machinery.
 *
 * @freshness-reads-here — event and sitting timestamps are captured only
 * after their corresponding official Legistar read has returned.
 */
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { captureSourceAcquisitions, type SourceAcquisitionEvidence } from "../lib/sources/acquisition-trace.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import {
  fetchEventItemVotes,
  fetchEventItems,
  fetchEvents,
} from "../lib/sources/legistar/client.ts";
import { findClient } from "../lib/sources/legistar/client-registry.ts";
import { legistarStartsAt } from "../lib/sources/legistar/index.ts";
import { collectEventOutcomes } from "../lib/sources/legistar/outcomes.ts";
import type { LegistarEvent, LegistarEventItem, LegistarVote } from "../lib/sources/legistar/types.ts";
import {
  countSitting,
  emptyTally,
  mergeSnapshot,
  refreshDecision,
  toPersistedSitting,
} from "../lib/outcomes/ingest.ts";
import {
  PIMA_LEGISTAR_OUTCOMES_CONTRACT,
  pimaLegistarOutcomesCandidate,
} from "../lib/outcomes/data-plane.ts";
import { readOutcomeProjection } from "../lib/outcomes/store.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../lib/outcomes/types.ts";

interface Args {
  readonly slug: string;
  readonly bodyId: number | null;
  readonly from: string;
  readonly to: string;
  readonly maxSittings: number;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly promote: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const read = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at >= 0 && at + 1 < argv.length ? String(argv[at + 1]) : null;
  };
  const observedDay = new Date().toISOString().slice(0, 10);
  const body = read("--body");
  const max = read("--max-sittings");
  return {
    slug: read("--slug") ?? "pima",
    bodyId: body === null ? null : Number(body),
    from: read("--from") ?? "2026-01-01",
    to: read("--to") ?? observedDay,
    maxSittings: max === null ? 40 : Number(max),
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    promote: argv.includes("--promote"),
  };
}

const EMPTY: OutcomeSnapshot = { generatedOn: "UNKNOWN", generatedAt: "UNKNOWN", tenants: [], sittings: [] };

function newestSourceStamp(events: readonly LegistarEvent[], fallback: string): string {
  return events
    .map((event) => event.EventLastModifiedUtc)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? fallback;
}

async function currentSnapshot(): Promise<OutcomeSnapshot> {
  const read = await readOutcomeProjection({ bypassCache: true });
  if (read.kind === "PROMOTED") return read.value;
  if (read.kind === "NOT_RECORDED") return EMPTY;
  if (read.kind === "BOOTSTRAP") throw new Error("PIMA_OUTCOME_PRODUCTION_BOOTSTRAP_FORBIDDEN");
  throw new Error(`PIMA_OUTCOME_STORE_UNREACHABLE:${read.code}:${read.detail}`);
}

async function persistCandidate(input: {
  readonly store: PostgresRoutineDataStore;
  readonly snapshot: OutcomeSnapshot;
  readonly acquisitions: readonly SourceAcquisitionEvidence[];
  readonly retrievedAt: string;
  readonly sourceThrough: string;
  readonly failureDetail?: string;
}) {
  const candidate = pimaLegistarOutcomesCandidate(input);
  return processRegisteredManualCandidate(
    input.store,
    PIMA_LEGISTAR_OUTCOMES_CONTRACT.contractId,
    candidate,
    input.retrievedAt,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.slug !== "pima") {
    throw new Error("PIMA_OUTCOME_CONTRACT_SCOPE_MISMATCH: add a separate tenant contract before acquiring another Legistar client.");
  }
  if (!args.promote && !args.dryRun) {
    throw new Error("PIMA_OUTCOME_PROMOTION_REQUIRED: use --promote, or --dry-run for a read-only plan.");
  }
  if (args.promote) prepareProductionCivicDataWrite();
  if (!Number.isInteger(args.maxSittings) || args.maxSittings < 1) throw new Error("--max-sittings must be a positive integer");
  const client = findClient(args.slug);
  if (!client) throw new Error("PIMA_LEGISTAR_CLIENT_NOT_REGISTERED");

  let snapshot = await currentSnapshot();
  const heldById = new Map(snapshot.sittings.map((sitting) => [sitting.meetingId, sitting]));
  const canonicalStore = new PostgresRoutineDataStore();
  const attemptedAt = new Date().toISOString();

  let eventEvidence: readonly SourceAcquisitionEvidence[] = [];
  let events: readonly LegistarEvent[] = [];
  try {
    const captured = await captureSourceAcquisitions((runForSource) =>
      runForSource(PIMA_LEGISTAR_OUTCOMES_CONTRACT.sourceId, () =>
        fetchEvents<LegistarEvent>(args.slug, { from: args.from, to: args.to }),
      ),
    );
    events = captured.value;
    eventEvidence = captured.evidence;
  } catch (error) {
    if (args.promote) {
      await persistCandidate({
        store: canonicalStore,
        snapshot,
        acquisitions: [],
        retrievedAt: attemptedAt,
        sourceThrough: attemptedAt,
        failureDetail: `Pima events acquisition failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    throw error;
  }
  const eventsRetrievedAt = new Date().toISOString();

  const sittings = (args.bodyId === null ? events : events.filter((event) => event.EventBodyId === args.bodyId))
    .slice()
    .sort((left, right) => String(right.EventDate).localeCompare(String(left.EventDate)));
  const population = floored(
    `sittings for pima${args.bodyId === null ? "" : ` body ${args.bodyId}`}`,
    `webapi.legistar.com events ${args.from}..${args.to}`,
    events.length,
    sittings.length,
    events.length === 0 ? "the events route returned no rows; this establishes no fact about the body" : undefined,
  );
  console.log(`pima: ${sittings.length} sitting(s) ${args.from}..${args.to}\n${floorLine(population)}`);

  if (sittings.length === 0) {
    if (args.promote) {
      await persistCandidate({
        store: canonicalStore,
        snapshot,
        acquisitions: eventEvidence,
        retrievedAt: eventsRetrievedAt,
        sourceThrough: eventsRetrievedAt,
        failureDetail: "The bounded Pima events query returned zero sittings; no governmental absence is inferred.",
      });
    }
    throw new Error("PIMA_LEGISTAR_ZERO_SITTINGS_HELD");
  }

  const tally = emptyTally();
  let budgetExhausted = false;
  let promoted = 0;
  for (const event of sittings) {
    tally.sittingsSeen += 1;
    const meetingId = `legistar:pima:${event.EventId}`;
    const decision = args.force ? ({ walk: true, reason: "FORCED" } as const) : refreshDecision(event, heldById.get(meetingId));
    if (!decision.walk) {
      tally.skippedUnchanged += 1;
      continue;
    }
    if (tally.walked >= args.maxSittings) {
      budgetExhausted = true;
      break;
    }
    if (args.dryRun) {
      console.log(`  would walk ${meetingId} — ${decision.reason}`);
      tally.walked += 1;
      continue;
    }

    const detail = await captureSourceAcquisitions((runForSource) =>
      runForSource(PIMA_LEGISTAR_OUTCOMES_CONTRACT.sourceId, async () => {
        try {
          const collected = await collectEventOutcomes(args.slug, event.EventId, {
            sourceOrg: client.publishingOrg,
            fetchItems: (slug, id) => fetchEventItems<LegistarEventItem>(slug, id),
            fetchVotes: (slug, id) => fetchEventItemVotes<LegistarVote>(slug, id),
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
    const observedAt = new Date().toISOString();
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
    const outcome = await persistCandidate({
      store: canonicalStore,
      snapshot: proposed,
      acquisitions: [...eventEvidence, ...detail.evidence],
      retrievedAt: observedAt,
      sourceThrough: newestSourceStamp([event], observedAt),
      ...(detail.value.error ? { failureDetail: `Sitting ${meetingId} acquisition failed: ${detail.value.error}` } : {}),
    });
    if (outcome.promoted) {
      snapshot = proposed;
      heldById.set(meetingId, persisted);
      promoted += 1;
    }
    console.log(
      `  ${meetingId} ${String(event.EventDate).slice(0, 10)} (${decision.reason}): ` +
        `${persisted.agenda.length} item(s), ${persisted.outcomes.length} action(s), ` +
        `${persisted.rollCalls.length} roll call(s) — ${outcome.promoted ? "PROMOTED" : `HELD ${outcome.candidate.failureCode ?? outcome.candidate.state}`}`,
    );
  }

  if (args.promote && promoted === 0 && tally.skippedUnchanged > 0) {
    const observedAt = new Date().toISOString();
    const unchanged = await persistCandidate({
      store: canonicalStore,
      snapshot,
      acquisitions: eventEvidence,
      retrievedAt: observedAt,
      sourceThrough: newestSourceStamp(events, observedAt),
    });
    if (!unchanged.promoted) throw new Error(`PIMA_UNCHANGED_RECEIPT_REFUSED:${unchanged.candidate.failureCode}`);
  }

  console.log("MEASURED, not estimated:");
  for (const [key, count] of Object.entries(tally)) console.log(`  ${key.padEnd(28)} ${count}`);
  if (budgetExhausted) {
    console.log(`STOPPED AT THE PER-RUN BUDGET of ${args.maxSittings}; the remaining sittings stay due and no completion is inferred.`);
  }
}

await main();
