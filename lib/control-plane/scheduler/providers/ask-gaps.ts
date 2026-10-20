/**
 * Turns the gaps Ask states for a held body (`heldBodyGaps`) into tracked work, one obligation per body and
 * gap code. Derived from held data, never from questions; counts of what readers were told only raise reader
 * impact or create a `MEETINGS_NOT_HELD` obligation. Reads open the registered publisher source;
 * a contract's existence is never a substitute for acquisition. A failed read is a `readFailure`, so no gap retires
 * on it. Pure.
 *
 *   id       freshness:ask-gap:<body id>#<code>
 *   route    <code>
 *   class    ask-gap
 *   subject  the body id
 */

import {
  ASK_GAP_RECORD_CLASS,
  meetingsNotHeldGap,
  type AskGapCode,
  type AskGapRecordClass,
  type HeldAskGap,
} from "../../../ask/held-gaps.ts";
import {
  ASK_GAP_OBSERVATION_WINDOW_DAYS,
  askedGapKey,
  askedWords,
  foldAskGapObservations,
  observationDayStart,
  type AskedGap,
  type AskGapObservationReading,
} from "../../ask-gap-observations.ts";
import { ROUTINE_SOURCE_CONTRACTS, currentMeetingClock, type RoutineSourceContract } from "../../../civic-data/contracts.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "../../../civic-data/runtime-routine-contracts.ts";
import { MEETING_PARTITION_CONTRACTS, type MeetingPartitionContract } from "../../../civic-data/meeting-partitions.ts";
import { displayNameOf } from "../../display-name.ts";
import { ASK_GAPS_PROVIDER_ID, ASK_GAP_OBLIGATION_CLASS, NEXT_READ_MARK } from "../../ask-gap-id.ts";
import { sourceRequestHeaders } from "../../../sources/http.ts";
import type { ObligationProvider, ProvidedObligation, ProviderContext, ProviderYield, RouteDescriptor } from "../registry.ts";

export { ASK_GAPS_PROVIDER_ID, ASK_GAP_NAMESPACE, askGapObligationId, parseAskGapObligationId } from "../../ask-gap-id.ts";


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
  readonly source: string;
  /** Each body with held meetings and the gaps Ask would state for it, decided one state at a time. */
  readonly bodies: readonly { readonly bodyId: string; readonly gaps: readonly HeldAskGap[] }[];
  /** How many meetings are held for a body readers were told we hold none of. */
  readonly meetingCountOf: (bodyId: string) => number;
  /** Null when the recorded outcomes were read; why not, otherwise. */
  readonly outcomesUnreadable: string | null;
  readonly clockOf: (contractId: string) => CarrierClock;
}

export type AskGapHoldingsReading = AskGapHoldings | { readonly unreadable: string };

/** Nothing was handed in: a named failure, never an empty domain. */
export const UNREAD_ASK_GAP_HOLDINGS: AskGapHoldingsReading = {
  unreadable: "no held-meetings reading was handed to this provider",
};


/** `US-XX` from `ocd-division/country:us/state:xx/...`; null when the id names no state. */
function stateOfBody(bodyId: string): string | null {
  const m = /(?:\/(?:state|district|territory):|^curated:)([a-z]{2})(?=[/#]|$)/.exec(bodyId);
  return m ? `US-${m[1]!.toUpperCase()}` : null;
}

function divisionsOfBody(bodyId: string): readonly string[] {
  if (bodyId.startsWith("ocd-division/")) return [bodyId.split("#")[0]!];
  const held = [...new Set(MEETING_PARTITION_CONTRACTS.filter(partition => partition.bodyId === bodyId)
    .flatMap(partition => partition.ocdId ? [partition.ocdId] : []))];
  const state = stateOfBody(bodyId);
  return held.length ? held : state ? [state] : [];
}

/**
 * The routine contracts whose reads close a gap of this record class for this body: for MEETING, the body's
 * own meeting partitions or else its state's derived family; for MEETING_OUTCOME, every contract that follows
 * one of the body's partitions. Empty means an adapter is owed.
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
  const contracts = registered.contracts ?? [...ROUTINE_SOURCE_CONTRACTS, ...RUNTIME_ROUTINE_CONTRACTS];
  if (recordClass === "MEETING") {
    const own = ownMeetingPartitions(bodyId, partitions);
    if (own.length > 0) return own;
    const state = stateOfBody(bodyId);
    return partitions.filter((p) => p.derivedFamily !== null && p.derivedFamily === state).map((p) => p.id);
  }
  return contracts
    .filter((c) => c.recordClass === "MEETING_OUTCOME" && (c.schedule?.follows ?? []).some((f) => f.bodyId === bodyId))
    .map((c) => c.id)
    .sort();
}

/** The body's own meeting partitions (never a state's derived family), sorted. */
function ownMeetingPartitions(bodyId: string, partitions: readonly Pick<MeetingPartitionContract, "id" | "bodyId" | "derivedFamily">[]): string[] {
  return partitions.filter((p) => p.derivedFamily === null && p.bodyId === bodyId).map((p) => p.id).sort();
}

/** The carriers of one gap code. `MEETINGS_NOT_HELD` is carried only by the body's own partitions. */
export function askGapCarriersFor(
  bodyId: string,
  code: AskGapCode,
  registered: Parameters<typeof askGapCarriers>[2] = {},
): readonly string[] {
  if (code === "MEETINGS_NOT_HELD") return ownMeetingPartitions(bodyId, registered.partitions ?? MEETING_PARTITION_CONTRACTS);
  return askGapCarriers(bodyId, ASK_GAP_RECORD_CLASS[code], registered);
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


function sittingWords(gaps: readonly HeldAskGap[]): string {
  const listed = gaps.flatMap((g) => (g.sitting ? [g.sitting] : []));
  const shown = listed.slice(0, 6).map((s) =>
    `${s.localDay} (${s.meetingId}; ${s.past ? "held" : "upcoming"}${s.agendaLinkListed ? ", agenda link listed" : ", no agenda link listed"})`);
  return `${shown.join(", ")}${listed.length > shown.length ? ` and ${listed.length - shown.length} more` : ""}`;
}

/** What Ask states, in the obligation's own words: which sittings, since when, and how often readers were told it. */
export function askGapEvidence(code: AskGapCode, gaps: readonly HeldAskGap[], nowMs: number, asked: AskedGap | null = null): string {
  const told = asked === null ? "" : ` ${askedWords(asked)}`;
  return `${heldEvidence(code, gaps, nowMs)}${told}`;
}

function heldEvidence(code: AskGapCode, gaps: readonly HeldAskGap[], nowMs: number): string {
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
    case "MEETINGS_NOT_HELD":
      return "Ask states that we have not recorded any meetings for this body: no held meeting names it in this reading.";
  }
}


/** The publisher address already registered for this exact body. Never choose a different body's source. */
export function askGapSourceUrl(bodyId: string, carriers: readonly string[], nowMs: number): string | null {
  const own = MEETING_PARTITION_CONTRACTS.filter(partition => partition.bodyId === bodyId && partition.derivedFamily === null);
  const source = own.find(partition => carriers.includes(partition.id)) ?? own[0];
  const wiring = source?.wiring;
  if (source?.meetingSource === "legistar" && wiring) {
    const slug = wiring.config.slug;
    const nativeBody = Number(wiring.config.eventBodyId);
    if (slug && /^[a-z0-9_-]+$/i.test(slug) && Number.isSafeInteger(nativeBody) && nativeBody > 0) {
      const day = (offset: number) => new Date(nowMs + offset * 86_400_000).toISOString().slice(0, 10);
      const filter = `EventId gt 0 and EventDate ge datetime'${day(-120)}' and EventDate le datetime'${day(120)}' and EventBodyId eq ${nativeBody}`;
      return `https://webapi.legistar.com/v1/${slug}/events?$filter=${encodeURIComponent(filter)}&$orderby=EventId&$top=1000`;
    }
  }
  const registered = [...ROUTINE_SOURCE_CONTRACTS, ...RUNTIME_ROUTINE_CONTRACTS].filter(contract => carriers.includes(contract.id));
  const urls = [
    ...registered.flatMap(contract => contract.acquisitionAdapter.authorityMode === "SINGLE_ROUTE" ? [contract.acquisitionAdapter.requestedUrl] : []),
    ...(wiring ? [
      ...(wiring.config.insiteHost ? [`https://${wiring.config.insiteHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}/Calendar.aspx`] : []),
      ...["feedUrl", "schedulePage", "pageUrl", "calendarUrl", "agendaCenterUrl", "icalUrl", "portalUrl", "documentsUrl", "publisherUrl", "baseUrl"].map(key => wiring.config[key]), wiring.noticeUrl] : []),
  ];
  for (const candidate of urls) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* A template or missing address is still owed; it is never a fetched source. */ }
  }
  return null;
}

/** The one route for a body's gap opens its real source. */
export function askGapRoute(input: {
  readonly bodyId: string;
  readonly code: AskGapCode;
  readonly gaps: readonly HeldAskGap[];
  readonly carriers: readonly string[];
  readonly clockOf: (contractId: string) => CarrierClock;
  readonly nowMs: number;
  readonly source: string;
  /** What readers were told of this gap in the observation window; null when none were, or none were read. */
  readonly asked?: AskedGap | null;
  /** Inject a registered publisher address for an isolated provider test. */
  readonly sourceUrl?: string | null;
}): RouteDescriptor {
  const { bodyId, code, gaps, carriers } = input;
  const recordClass = ASK_GAP_RECORD_CLASS[code];
  const name = displayNameOf(bodyId);
  const place = name.short.split(" — ")[0] || name.short;
  const evidence = askGapEvidence(code, gaps, input.nowMs, input.asked ?? null);
  const label = `${name.short} — ${code.replace(/_/g, " ").toLowerCase()}`;
  const citation =
    `lib/ask/held-gaps.ts decides the gap over ${input.source}; ` +
    (carriers.length > 0
      ? `${carriers.join(", ")} carr${carriers.length === 1 ? "ies" : "y"} ${recordClass} for ${bodyId} (lib/civic-data/meeting-partitions.ts, lib/civic-data/contracts.ts)`
      : `no registered routine contract carries ${recordClass} for ${bodyId} (lib/civic-data/meeting-partitions.ts, lib/civic-data/contracts.ts)`);

  const sourceUrl = input.sourceUrl === undefined ? askGapSourceUrl(bodyId, carriers, input.nowMs) : input.sourceUrl;
  if (sourceUrl === null) {
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
          `${evidence} No registered publisher address reads ${what} for ${name.name}. ` +
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
    executorReason: "the body's registered publisher source is read with plain code; verified details remain independent of the rest of its checklist",
    open: {
      kind: "HTTP_GET",
      url: sourceUrl,
      headers: sourceRequestHeaders(),
    },
    citation: `${citation}. ${evidence} ${cadences.map(c => c.words).join("; ")}. ` +
      (failures.length ? `CADENCE_BROKEN: ${failures.join("; ")}. ` : "") +
      `${NEXT_READ_MARK}${next === null ? "no carrying clock states when its next read is owed" : `owed by ${next.nextReadDueAt}, by ${next.id}`}`,
  };
}


export interface AskGapsInput {
  readonly holdings?: () => AskGapHoldingsReading;
  /** The registered contracts carriage is read from; the committed registries by default. */
  readonly registered?: Parameters<typeof askGapCarriers>[2];
  /**
   * What readers were told, counted per body, gap and day (`ask-gap-observations.ts`).
   * Absent: the held derivation alone, exactly as before. Unreadable: a named read failure.
   */
  readonly observations?: () => AskGapObservationReading;
}

/** The earlier of two instants, either of which may be absent. */
function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
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

/** Reuse the installed Admin meeting clock, including the rolling hot window read by the carrier. */
function readCycleHours(bodyId: string, code: AskGapCode, reading: AskGapHoldings, registered: AskGapsInput["registered"]): number {
  const clocks = askGapCarriersFor(bodyId, code, registered).map(id => reading.clockOf(id));
  const every = clocks.flatMap(clock => clock.kind === "READ" ? [clock.requiredEveryMs] : []);
  return Math.min(...(every.length ? every : [currentMeetingClock().hotEveryMs])) / 3_600_000;
}

export function askGapsProvider(input: AskGapsInput = {}): ObligationProvider {
  const readHoldings = input.holdings ?? (() => UNREAD_ASK_GAP_HOLDINGS);
  return {
    id: ASK_GAPS_PROVIDER_ID,
    describe:
      "every gap Ask would state about a body with held meetings — an agenda not held, an outcome not read, a stale " +
      "calendar read, an unreadable outcome store — decided by Ask's own held-gaps rule, one obligation per body and code; " +
      "gaps readers were told about in the last 30 days are reader impact now, and a body readers were told we hold no " +
      "meeting of is created from those counts",

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
      const records: ProvidedObligation[] = [];
      let unroutedOutcomeFailures = 0;

      /* What readers were told, folded over the window. Absent is the held derivation alone; unreadable is named. */
      const observed = input.observations?.() ?? null;
      const observationsDown = observed !== null && "unreadable" in observed ? observed.unreadable : null;
      const asked: ReadonlyMap<string, AskedGap> =
        observed !== null && !("unreadable" in observed) ? foldAskGapObservations(observed.rows, ctx.nowIso).asked : new Map();
      const askedFor = (bodyId: string, code: AskGapCode): AskedGap | null => asked.get(askedGapKey(bodyId, code)) ?? null;
      /* A reader was hurt on the latest day they were told it: reader impact now. */
      const toldAt = (told: AskedGap | null): string | null => (told === null ? null : observationDayStart(told.lastDay));

      for (const { bodyId, gaps: bodyGaps } of [...reading.bodies].sort((a, b) => (a.bodyId < b.bodyId ? -1 : a.bodyId > b.bodyId ? 1 : 0))) {
        for (const [code, gaps] of groupBy(bodyGaps, (g) => g.code) as Map<AskGapCode, HeldAskGap[]>) {
          const carriers = askGapCarriersFor(bodyId, code, input.registered);
          /* An unreadable outcome store is our read failing once for every body: work only where a routine outcomes read exists. */
          if (code === "OUTCOMES_UNREADABLE" && carriers.length === 0) {
            unroutedOutcomeFailures += 1;
            continue;
          }
          const upcoming = gaps.flatMap((g) => (g.sitting && !g.sitting.past ? [g.sitting.startsAt] : [])).sort()[0] ?? null;
          const told = askedFor(bodyId, code);
          records.push({
            recordClass: ASK_GAP_OBLIGATION_CLASS,
            subjectId: bodyId,
            scopeDivisions: divisionsOfBody(bodyId),
            /* Reader impact is the earlier of the next sitting with its agenda unheld and the latest day readers were told. */
            readerImpactAt: earliest(code === "AGENDA_NOT_HELD" ? upcoming : null, toldAt(told)),
            observedChangeRateHours: null,
            declaredCycleHours: readCycleHours(bodyId, code, reading, input.registered),
            lastWorkedAt: null,
            routes: [askGapRoute({ bodyId, code, gaps, carriers, clockOf: reading.clockOf, nowMs, source: reading.source, asked: told })],
          });
        }
      }

      /* A body readers were told we hold no meeting of creates its work until a meeting of it is held. */
      const observedSource = observed !== null && !("unreadable" in observed) ? observed.source : "";
      for (const told of [...asked.values()].filter((a) => a.code === "MEETINGS_NOT_HELD").sort((a, b) => (a.bodyId < b.bodyId ? -1 : a.bodyId > b.bodyId ? 1 : 0))) {
        const gap = meetingsNotHeldGap(told.bodyId, reading.meetingCountOf(told.bodyId));
        if (gap === null) continue;
        records.push({
          recordClass: ASK_GAP_OBLIGATION_CLASS,
          subjectId: told.bodyId,
          scopeDivisions: divisionsOfBody(told.bodyId),
          readerImpactAt: toldAt(told),
          observedChangeRateHours: null,
          declaredCycleHours: readCycleHours(told.bodyId, "MEETINGS_NOT_HELD", reading, input.registered),
          lastWorkedAt: null,
          routes: [askGapRoute({
            bodyId: told.bodyId,
            code: "MEETINGS_NOT_HELD",
            gaps: [gap],
            carriers: askGapCarriersFor(told.bodyId, "MEETINGS_NOT_HELD", input.registered),
            clockOf: reading.clockOf,
            nowMs,
            source: `${reading.source}, and ${observedSource}`,
            asked: told,
          })],
        });
      }

      const failures = [
        ...(outcomesDown
          ? [`the recorded outcomes Ask reads could not be read (${reading.outcomesUnreadable}): no body's OUTCOME_NOT_READ could be decided, ` +
            "so no Ask-gap row retires on this reading" +
            (unroutedOutcomeFailures > 0 ? `; ${unroutedOutcomeFailures} bod${unroutedOutcomeFailures === 1 ? "y" : "ies"} with no outcomes route carry no row for it` : "")]
          : []),
        ...(observationsDown !== null
          ? [`the Ask-gap observations could not be read (${observationsDown}): what readers were told neither raises nor creates work this cycle, ` +
            "so no Ask-gap row retires on this reading"]
          : []),
      ];
      const readFailure = failures.length > 0 ? failures.join("; ") : null;
      return {
        obligations: records,
        readFailure,
        emptyReason:
          records.length === 0 && readFailure === null
            ? `${reading.source} was read and no body with held meetings carries a gap Ask would state` +
              (observed !== null ? `, and no body readers were told we hold no meeting of is still without one (${ASK_GAP_OBSERVATION_WINDOW_DAYS}-day window)` : "")
            : null,
      };
    },
  };
}
