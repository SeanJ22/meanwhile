/**
 * **PROVIDER SEVEN — THE GAPS ASK STATES, AS TRACKED WORK.** (2026-09-25.)
 *
 * The owner's civic accuracy brief: *"A discrepancy must create tracked
 * acquisition work that flows through publication"*, and *"Say 'still
 * looking' only when real work exists."* Ask tells a reader what we do not
 * hold for a body — an agenda not read, an outcome not read, a calendar read
 * days old, a recorded-outcome store that could not be read. Before this
 * provider nothing turned those sentences into work, so "we have not read it"
 * could stand forever with nobody owing the read.
 *
 * ## Derived from what we HOLD, never from what a reader asked
 *
 * For every body with held meetings, this provider evaluates
 * `heldBodyGaps` — the ONE function Ask's topic timeline states its gaps from
 * (`lib/ask/held-gaps.ts`, RULING 103) — over the same promoted meetings,
 * agenda documents and recorded outcomes Ask reads. It reads no question, no
 * reader, no log and no browser event: a gap exists here exactly when Ask
 * would state it to anyone who asked about that body, whether or not anyone
 * did. No collection changes (RULING 259).
 *
 * ```
 *   id          freshness:ask-gap:<body id>#<code>        one per body and code
 *   route       <code>
 *   class       ask-gap
 *   subject     the body id
 * ```
 *
 * ## Who owes the read
 *
 * - **A routine contract carries the record** (a meeting partition for the
 *   body's calendar and agendas; a MEETING_OUTCOME contract that follows the
 *   body's partitions for its decisions): the work is that contract's own
 *   routine read, owned by the RUNNER. The route is `ROUTINE_READ`: this
 *   process opens nothing — the partition is the one clock (RULING 282/283) —
 *   and the obligation records the gap, the sittings it names, and when the
 *   carrying read is next owed. A carrying read that has not succeeded within
 *   the owner's cadence (hourly while a sitting is within seven days, twice
 *   daily otherwise; docs/rulings.md §4) is a named failure,
 *   `CADENCE_BROKEN`, never a quiet wait.
 * - **No routine contract carries it** (a body with no outcomes route, like
 *   Mesa's council today): the work is NOT_MACHINE_EXECUTABLE, awaiting an
 *   adapter, owned by ENGINEERING, with the adapter named ("Mesa: minutes
 *   reader"). When a contract that follows the body's partitions is
 *   registered, the same obligation becomes RUNNER work on the next cycle with
 *   no edit here.
 *
 * ## How it closes
 *
 * When a read holds the record, `heldBodyGaps` stops returning the gap, this
 * provider stops emitting the obligation, and `planSupersededRetirement`
 * retires it with its named reason (#368). A reading that could not be taken —
 * the meetings, or the recorded outcomes — is a `readFailure`, so a failed
 * read never retires a gap that is still open.
 *
 * PURE: the holdings, the clocks and the registered contracts are handed in
 * (`ask-gap-holdings.ts` reads them); no clock and no store is read here.
 */

import {
  ASK_GAP_RECORD_CLASS,
  heldBodyGaps,
  type AskGapCode,
  type AskGapRecordClass,
  type HeldAskGap,
  type HeldGapMeetingLike,
} from "../../../ask/held-gaps.ts";
import type { AgendaDocumentLike } from "../../../routing/agenda-search.ts";
import type { PersistedSittingOutcomes } from "../../../outcomes/types.ts";
import { ROUTINE_SOURCE_CONTRACTS, type RoutineSourceContract } from "../../../civic-data/contracts.ts";
import { MEETING_PARTITION_CONTRACTS, type MeetingPartitionContract } from "../../../civic-data/meeting-partitions.ts";
import { displayNameOf } from "../../display-name.ts";
import { ASK_GAPS_PROVIDER_ID, ASK_GAP_OBLIGATION_CLASS, NEXT_READ_MARK } from "../../ask-gap-id.ts";
import type { ObligationProvider, ProvidedObligation, ProviderContext, ProviderYield, RouteDescriptor } from "../registry.ts";

export { ASK_GAPS_PROVIDER_ID, ASK_GAP_NAMESPACE, askGapObligationId, parseAskGapObligationId } from "../../ask-gap-id.ts";

/* ------------------------------------------------------------- the inputs --- */

/** A held meeting, as the provider needs it: the gap fields and its body. */
export type AskGapMeeting = HeldGapMeetingLike & { readonly bodyId?: string | null };

/**
 * Where one carrying routine read stands, as the runner read its clock.
 * `READ` carries the store-observed instants and the cadence the owner's rule
 * requires of it now; `UNREAD` names why its clock could not be read.
 */
export type CarrierClock =
  | {
      readonly kind: "READ";
      readonly lastSucceededAt: string | null;
      readonly lastAttemptedAt: string | null;
      /** The owner's cadence for it now: an hour while hot (or when that cannot be told), twelve hours otherwise. */
      readonly requiredEveryMs: number;
      /** When the routine runner next owes the read (its own admission deadline); null when its clock states none. */
      readonly nextReadDueAt: string | null;
    }
  | { readonly kind: "UNREAD"; readonly why: string };

/** Everything the provider reads, taken once a cycle by `readAskGapHoldings`. */
export interface AskGapHoldings {
  /** Where the reading came from, in words a digest prints. */
  readonly source: string;
  readonly meetings: readonly AskGapMeeting[];
  readonly documents: readonly AgendaDocumentLike[];
  /** The recorded-outcome sittings Ask reads (`lib/outcomes/store.ts`). */
  readonly sittings: readonly PersistedSittingOutcomes[];
  /** Null when the recorded outcomes were read; why not, otherwise. */
  readonly outcomesUnreadable: string | null;
  readonly clockOf: (contractId: string) => CarrierClock;
}

export type AskGapHoldingsReading = AskGapHoldings | { readonly unreadable: string };

/** Nothing was handed in: a named failure, never an empty domain. */
export const UNREAD_ASK_GAP_HOLDINGS: AskGapHoldingsReading = {
  unreadable: "no held-meetings reading was handed to this provider",
};

/* ------------------------------------------------------------- carriage --- */

/** `US-AZ` from `ocd-division/country:us/state:az/...`; null when the id names no state. */
function stateOfBody(bodyId: string): string | null {
  const m = /\/state:([a-z]{2})(?=[/#]|$)/.exec(bodyId);
  return m ? `US-${m[1]!.toUpperCase()}` : null;
}

/**
 * The routine contracts whose reads close a gap of this record class for this
 * body, from the registered contracts (never a list of ours):
 *
 * - MEETING: the body's own meeting partitions; with none, its state's derived
 *   family, which is where a reviewed calendar with no partition of its own is
 *   read (C16).
 * - MEETING_OUTCOME: every MEETING_OUTCOME contract that follows one of the
 *   body's partitions (`schedule.follows`) — how an outcome routine names the
 *   body whose sittings it reads.
 *
 * Empty means no scheduled read can close it: an adapter is owed.
 */
export function askGapCarriers(
  bodyId: string,
  recordClass: AskGapRecordClass,
  registered: {
    readonly partitions?: readonly Pick<MeetingPartitionContract, "id" | "bodyId" | "derivedFamily">[];
    readonly contracts?: readonly Pick<RoutineSourceContract, "id" | "recordClass" | "schedule">[];
  } = {},
): readonly string[] {
  const partitions = registered.partitions ?? MEETING_PARTITION_CONTRACTS;
  const contracts = registered.contracts ?? ROUTINE_SOURCE_CONTRACTS;
  if (recordClass === "MEETING") {
    const own = partitions.filter((p) => p.derivedFamily === null && p.bodyId === bodyId).map((p) => p.id).sort();
    if (own.length > 0) return own;
    const state = stateOfBody(bodyId);
    return partitions.filter((p) => p.derivedFamily !== null && p.derivedFamily === state).map((p) => p.id);
  }
  return contracts
    .filter((c) => c.recordClass === "MEETING_OUTCOME" && (c.schedule?.follows ?? []).some((f) => f.bodyId === bodyId))
    .map((c) => c.id)
    .sort();
}

const hours = (ms: number): string => `${(ms / 3_600_000).toFixed(1)} hours`;

/**
 * Where one carrying read stands against the owner's cadence. `failure` is one
 * sentence with no inner full stop, or null when the cadence holds (or cannot
 * be told: an unread clock is said, and is not a failure of the read).
 */
export function carrierCadence(
  contractId: string,
  clock: CarrierClock,
  nowMs: number,
): { readonly failure: string | null; readonly words: string; readonly nextReadDueAt: string | null } {
  if (clock.kind === "UNREAD") {
    return { failure: null, nextReadDueAt: null, words: `${contractId}: its clock could not be read (${clock.why}), so whether its cadence holds cannot be told this cycle` };
  }
  const cadence = clock.requiredEveryMs <= 3_600_000 ? "hourly while a sitting is within seven days" : `every ${hours(clock.requiredEveryMs)}`;
  const succeeded = clock.lastSucceededAt === null ? Number.NaN : Date.parse(clock.lastSucceededAt);
  const attempted = clock.lastAttemptedAt === null ? Number.NaN : Date.parse(clock.lastAttemptedAt);
  const failedSince = Number.isFinite(attempted) && (!Number.isFinite(succeeded) || attempted > succeeded)
    ? `; its last attempt, ${clock.lastAttemptedAt}, did not succeed`
    : "";
  const due = clock.nextReadDueAt === null ? "" : `; its next read is owed by ${clock.nextReadDueAt}`;
  if (!Number.isFinite(succeeded)) {
    const failure = `${contractId} holds no successful read${failedSince}, and the owner's cadence requires one ${cadence}`;
    return { failure, words: failure, nextReadDueAt: clock.nextReadDueAt };
  }
  const age = nowMs - succeeded;
  if (age > clock.requiredEveryMs) {
    const failure = `${contractId} last succeeded ${clock.lastSucceededAt}, ${hours(age)} before this reading, and the owner's cadence requires a read ${cadence}${failedSince}`;
    return { failure, words: `${failure}${due}`, nextReadDueAt: clock.nextReadDueAt };
  }
  return { failure: null, nextReadDueAt: clock.nextReadDueAt, words: `${contractId} last succeeded ${clock.lastSucceededAt} (${cadence})${due}` };
}

/* ------------------------------------------------------------- evidence --- */

function sittingWords(gaps: readonly HeldAskGap[]): string {
  const listed = gaps.flatMap((g) => (g.sitting ? [g.sitting] : []));
  const shown = listed.slice(0, 6).map((s) =>
    `${s.localDay} (${s.meetingId}; ${s.past ? "held" : "upcoming"}${s.agendaLinkListed ? ", agenda link listed" : ", no agenda link listed"})`);
  return `${shown.join(", ")}${listed.length > shown.length ? ` and ${listed.length - shown.length} more` : ""}`;
}

/** What Ask states, in the obligation's own words: which sittings, and since when. */
export function askGapEvidence(code: AskGapCode, gaps: readonly HeldAskGap[], nowMs: number): string {
  const since = gaps.map((g) => g.since).filter((s): s is string => s !== null).sort()[0] ?? null;
  switch (code) {
    case "AGENDA_NOT_HELD":
      return `Ask states that we hold no readable agenda for ${gaps.length} sitting${gaps.length === 1 ? "" : "s"} in its window: ${sittingWords(gaps)}.`;
    case "OUTCOME_NOT_READ":
      return `Ask states that the outcome is not read for ${gaps.length} concluded sitting${gaps.length === 1 ? "" : "s"} whose agenda we hold and whose recorded decision we do not: ${sittingWords(gaps)}; outstanding since ${since}.`;
    case "CALENDAR_STALE":
      return `Ask states that the body's calendar was last read ${since}${since ? `, ${hours(nowMs - Date.parse(since))} before this reading` : ""}; a read older than 36 hours is stated to readers.`;
    case "OUTCOMES_UNREADABLE":
      return "Ask states that the recorded actions and votes we hold could not be read: the recorded-outcome projection was unreadable when this reading was taken.";
  }
}

/* --------------------------------------------------------------- routes --- */

/** The one route for a body's gap: its routine read, or the adapter owed. */
export function askGapRoute(input: {
  readonly bodyId: string;
  readonly code: AskGapCode;
  readonly gaps: readonly HeldAskGap[];
  readonly carriers: readonly string[];
  readonly clockOf: (contractId: string) => CarrierClock;
  readonly nowMs: number;
  readonly source: string;
}): RouteDescriptor {
  const { bodyId, code, gaps, carriers } = input;
  const recordClass = ASK_GAP_RECORD_CLASS[code];
  const name = displayNameOf(bodyId);
  const place = name.short.split(" — ")[0] || name.short;
  const evidence = askGapEvidence(code, gaps, input.nowMs);
  const label = `${name.short} — ${code.replace(/_/g, " ").toLowerCase()}`;
  const citation =
    `lib/ask/held-gaps.ts decides the gap over ${input.source}; ` +
    (carriers.length > 0
      ? `${carriers.join(", ")} carr${carriers.length === 1 ? "ies" : "y"} ${recordClass} for ${bodyId} (lib/civic-data/meeting-partitions.ts, lib/civic-data/contracts.ts)`
      : `no registered routine contract carries ${recordClass} for ${bodyId} (lib/civic-data/meeting-partitions.ts, lib/civic-data/contracts.ts)`);

  if (carriers.length === 0) {
    const what = recordClass === "MEETING_OUTCOME" ? "recorded outcomes — decisions, votes or minutes —" : "a meeting calendar";
    return {
      routeId: code,
      label,
      executorClass: "DETERMINISTIC",
      executorReason:
        "reading this record once its adapter exists is deterministic; no model is spent standing in for a route engineering has not built",
      open: {
        kind: "NOT_MACHINE_EXECUTABLE",
        target: name.name,
        reason:
          `${evidence} No routine contract reads ${what} for ${name.name}, so no scheduled read can close this gap. ` +
          "REQUIRES_NEW_ADAPTER: this is a fact about our tooling and our reading, never about the record.",
      },
      citation,
      awaitingAdapter: `${place}: ${recordClass === "MEETING_OUTCOME" ? "minutes reader" : "meeting calendar route"}`,
    };
  }

  const cadences = carriers.map((id) => ({ id, ...carrierCadence(id, input.clockOf(id), input.nowMs) }));
  const failures = cadences.flatMap((c) => (c.failure === null ? [] : [c.failure]));
  const next = cadences.filter((c) => c.nextReadDueAt !== null).sort((a, b) => a.nextReadDueAt!.localeCompare(b.nextReadDueAt!))[0] ?? null;
  return {
    routeId: code,
    label,
    executorClass: "DETERMINISTIC",
    executorReason:
      "a routine contract reads this record on its own clock; this obligation opens nothing, so neither a model nor a second fetch of the same feed is ever spent on it",
    open: {
      kind: "ROUTINE_READ",
      contractIds: carriers,
      target: bodyId,
      reason:
        `${evidence} ${cadences.map((c) => c.words).join("; ")}. ` +
        `${NEXT_READ_MARK}${next === null ? "no carrying clock states when its next read is owed" : `owed by ${next.nextReadDueAt}, by ${next.id}`}`,
      cadenceFailure: failures.length === 0 ? null : `${failures.join("; ")}.`,
    },
    citation,
  };
}

/* ------------------------------------------------------------- provider --- */

export interface AskGapsInput {
  readonly holdings?: () => AskGapHoldingsReading;
  /** The registered contracts carriage is read from; the committed registries by default. */
  readonly registered?: Parameters<typeof askGapCarriers>[2];
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export function askGapsProvider(input: AskGapsInput = {}): ObligationProvider {
  const readHoldings = input.holdings ?? (() => UNREAD_ASK_GAP_HOLDINGS);
  return {
    id: ASK_GAPS_PROVIDER_ID,
    describe:
      "every gap Ask would state about a body with held meetings — an agenda not held, an outcome not read, a stale " +
      "calendar read, an unreadable outcome store — decided by Ask's own held-gaps rule, one obligation per body and code",

    /* The template `askGapObligationId` restates (the route id is the gap code); the assignment view's prefix table reads it here. */
    scheduledId: (record, route) => `freshness:ask-gap:${record.subjectId}#${route.routeId}`,

    enumerate(ctx: ProviderContext): ProviderYield {
      const reading = readHoldings();
      if ("unreadable" in reading) {
        return {
          obligations: [],
          readFailure: `the held meetings Ask reads could not be read (${reading.unreadable}); no gap is decided and none retires on this reading`,
          emptyReason: null,
        };
      }
      const nowMs = Date.parse(ctx.nowIso);
      const outcomesDown = reading.outcomesUnreadable !== null;
      const documentsByMeeting = groupBy(reading.documents, (d) => d.meetingId);
      const sittingsByBody = groupBy(reading.sittings, (s) => s.bodyId);
      const records: ProvidedObligation[] = [];
      let unroutedOutcomeFailures = 0;

      for (const [bodyId, meetings] of [...groupBy(reading.meetings, (m) => m.bodyId)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const held = heldBodyGaps({
          bodyId,
          meetings,
          documents: meetings.flatMap((m) => documentsByMeeting.get(m.id) ?? []),
          sittings: sittingsByBody.get(bodyId) ?? [],
          now: nowMs,
          outcomesUnavailable: outcomesDown,
        });
        for (const [code, gaps] of groupBy(held.gaps, (g) => g.code) as Map<AskGapCode, HeldAskGap[]>) {
          const carriers = askGapCarriers(bodyId, ASK_GAP_RECORD_CLASS[code], input.registered);
          /*
           * An unreadable outcome store is OUR read failing, once, for every
           * body. It is work only where a routine outcomes read exists to fix;
           * a body with no outcomes route is not given a row per transient
           * failure, and the failure is named on the reading instead.
           */
          if (code === "OUTCOMES_UNREADABLE" && carriers.length === 0) {
            unroutedOutcomeFailures += 1;
            continue;
          }
          const upcoming = gaps.flatMap((g) => (g.sitting && !g.sitting.past ? [g.sitting.startsAt] : [])).sort()[0] ?? null;
          records.push({
            recordClass: ASK_GAP_OBLIGATION_CLASS,
            subjectId: bodyId,
            /* A reader is hurt when an upcoming sitting arrives with its agenda still unheld; the other gaps name no deadline. */
            readerImpactAt: code === "AGENDA_NOT_HELD" ? upcoming : null,
            observedChangeRateHours: null,
            lastWorkedAt: null,
            routes: [askGapRoute({ bodyId, code, gaps, carriers, clockOf: reading.clockOf, nowMs, source: reading.source })],
          });
        }
      }

      const readFailure = outcomesDown
        ? `the recorded outcomes Ask reads could not be read (${reading.outcomesUnreadable}): no body's OUTCOME_NOT_READ could be decided, ` +
          "so no Ask-gap row retires on this reading" +
          (unroutedOutcomeFailures > 0 ? `; ${unroutedOutcomeFailures} bod${unroutedOutcomeFailures === 1 ? "y" : "ies"} with no outcomes route carry no row for it` : "")
        : null;
      return {
        obligations: records,
        readFailure,
        emptyReason:
          records.length === 0 && readFailure === null
            ? `${reading.source} was read and no body with held meetings carries a gap Ask would state`
            : null,
      };
    },
  };
}
