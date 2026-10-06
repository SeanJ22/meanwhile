/**
 * **EVERY BODY WE WATCH, AS THE DESIGN DRAWS IT.** (Admin redesign,
 * 2026-09-23 — Fleet · Now, the body list and the opened body.)
 *
 * A body we watch is a public body with a registered meeting source (one
 * routine meeting contract per source and body). For each one this projects
 * the facts the production data plane actually records — its current
 * published version, its last reads, the typed Reader readback, the last 24
 * hours — onto the design's six standing questions:
 *
 * ```
 *   Don't have yet     how many meetings exist that we do not hold: nothing
 *                      measures it, so it is the named unknown
 *   Confirmed right    meetings the last successful read re-confirmed
 *   Has gaps           past meetings in the version we hold with no agenda —
 *                      neither a link nor an attached document
 *   Changed            records added, revised or removed in the last 24 hours
 *   Reader can see     meetings in a version the typed Reader read back
 *   Disagrees          no cross-source check exists: the named unknown
 * ```
 *
 * Nothing here is estimated. A body whose last read failed shows what it
 * last held beside the failure; a body never read says so; a count that
 * cannot be taken is `null` and the page prints its reason. Every sentence is
 * generated from the figures beside it.
 *
 * PURE: rows in, views out; the only clock is `nowIso`.
 *
 * **When we look** (C6). A meeting source is not read on its contract's
 * `cadence`: that is how old a Reader may see a record before it reads stale.
 * The runner reads it on the contract's sitting-window `schedule`, so a body
 * whose contract carries one is described by that schedule, and its next read
 * is worked out with the runner's own functions from the facts the runner
 * reads: the last attempt, the current version's first event, and the
 * sittings that version lists.
 */

import { displayNameOf } from "../display-name.ts";
import type { SittingWindowSchedule } from "../../civic-data/contracts.ts";
import {
  sittingWindowHotByConclusion,
  sittingWindowObligation,
  sittingWindowRetryMs,
  statedSittingEndsByScope,
} from "../../civic-data/sitting-window-admission.ts";
import { routineRuledOut, type DeadEndGaps } from "./dead-ends.ts";

export type BodyStatus = "WORKING" | "NEEDS ATTENTION" | "STUCK" | "NOT READ YET";
export type ViewTone = "teal" | "gold" | "amber" | "cyan" | "slate" | "stone";
export type FigureTone = "text" | "muted" | "gold" | "amber" | "teal" | "accent";

/** The contract facts the model needs (a structural subset of a meeting partition contract). */
export interface WatchedContract {
  readonly id: string;
  readonly scope: string;
  readonly bodyId: string;
  readonly ocdId: string | null;
  readonly meetingSource: string;
  readonly jurisdiction: string | null;
  readonly publishingOrg: string | null;
  readonly sourceUrl: string | null;
  readonly verifiedAt: string | null;
  readonly cadence: {
    readonly description: string;
    readonly defaultEveryMs: number;
    /** Absent when the cadence never changes. */
    readonly phases?: readonly { readonly through: string; readonly everyMs: number }[];
  };
  readonly retry: { readonly afterMs: number; readonly description: string };
  /** The runner's re-read schedule when it is not `cadence` (every meeting partition: C6). */
  readonly schedule?: SittingWindowSchedule;
}

/** A sitting as the current version lists it: its start and any publisher-stated end, both as stored. */
export interface SittingFacts {
  readonly startsAt: string;
  readonly endsAt: string | null;
}

/**
 * What the runner schedules a meeting source's next read from, read off the
 * current version (`RoutineStoreClock` in lib/civic-data/store.ts).
 */
export interface VersionClockFacts {
  /** The version's store-observed first event: the runner's success instant. */
  readonly observedAt: string | null;
  /** The version's newest unchanged confirmation, which counts as a later success. */
  readonly confirmedAt: string | null;
  /** A trusted-LKG import: never a success, and never an attempt, on the runner's clock. */
  readonly imported: boolean;
  /** Every sitting the version lists. */
  readonly sittings: readonly SittingFacts[];
}

export interface VersionFacts {
  readonly scope: string;
  readonly versionId: string;
  readonly promotedAt: string;
  readonly meetings: number;
  readonly fresh: number | null;
  readonly carried: number | null;
  readonly docs: number;
  /** Meetings already held with neither an agenda link nor an attached agenda document. */
  readonly noAgendaLink: number;
  /** Meetings still ahead with no agenda yet: not a gap, agendas post shortly before a sitting. */
  readonly noAgendaAhead: number;
  readonly upcoming: number;
  readonly furthestAhead: string | null;
  readonly bodyName: string | null;
  readonly jurisdiction: string | null;
  readonly outcome: "CHANGED" | "UNCHANGED" | null;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly held: number;
  /**
   * MW-017: the promoted candidate's horizon evidence. Null when the candidate
   * records none; absent on a reading taken before it was read. Only a bounded
   * read that claims it holds everything the publisher lists lets the page say
   * where the publisher's own list ends.
   */
  readonly horizon?: PublisherHorizon | null;
  /** The runner's clock facts; absent on a reading taken before they were read. */
  readonly clock?: VersionClockFacts;
}

/** The horizon slice of a civic-data candidate (`HorizonEvidence` in lib/civic-data/types.ts), as Admin reads it. */
export interface PublisherHorizon {
  readonly kind: "BOUNDED" | "OPEN_FACT_SET";
  readonly returnedRecords: number | null;
  readonly declaredTotal: number | null;
  readonly paginationComplete: boolean;
  readonly claimsComplete: boolean;
}

/**
 * The horizon from its query columns (`horizon_kind`, `horizon_returned`,
 * `horizon_declared`, `horizon_paginated`, `horizon_complete`). A kind this
 * page does not know reads as no horizon, never as bounded; a flag that is not
 * plainly true reads as false.
 */
export function horizonFromColumns(r: Readonly<Record<string, unknown>>): PublisherHorizon | null {
  const kind = r.horizon_kind;
  if (kind !== "BOUNDED" && kind !== "OPEN_FACT_SET") return null;
  const n = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    kind,
    returnedRecords: n(r.horizon_returned),
    declaredTotal: n(r.horizon_declared),
    paginationComplete: r.horizon_paginated === "true" || r.horizon_paginated === true,
    claimsComplete: r.horizon_complete === "true" || r.horizon_complete === true,
  };
}

/** A horizon the page may call the publisher's own limit: bounded, paginated to its end, and claiming completeness. */
export function horizonIsPublishersLimit(h: PublisherHorizon | null | undefined): boolean {
  return h !== null && h !== undefined && h.kind === "BOUNDED" && h.paginationComplete && h.claimsComplete;
}

export interface AttemptFacts {
  readonly scope: string;
  readonly candidateId: string;
  readonly state: string;
  readonly failureCode: string | null;
  readonly failureDetail: string | null;
  readonly acquisitionSucceeded: boolean;
  readonly attemptedAt: string;
}

export interface ReadbackFacts {
  readonly candidateId: string;
  readonly at: string;
  readonly passed: boolean;
}

/** A source's latest version that changed what readers are served, with its own events. */
export interface ChangeFacts {
  readonly scope: string;
  readonly versionId: string;
  readonly retrievedAt: string;
  readonly promotedAt: string | null;
  readonly validatedAt: string | null;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly held: number;
  readonly meetingsAdded: number;
  readonly named: readonly { readonly title: string | null; readonly startsAt: string | null }[];
  /** Optional: a reading taken before changed meetings were named. */
  readonly meetingsChanged?: number;
  readonly changedNamed?: readonly { readonly title: string | null; readonly startsAt: string | null }[];
}

export interface DayFacts {
  readonly scope: string;
  readonly reads: number;
  readonly gotIn: number;
  readonly versions: number;
  readonly changedVersions: number;
  /** Reads that got in but found the source listing no meetings. Optional: a reading taken before it was counted. */
  readonly cannotTell?: number;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
}

export interface BodyStoreFacts {
  readonly asOf: string;
  readonly versions: readonly VersionFacts[];
  readonly attempts: readonly AttemptFacts[];
  readonly readbacks: readonly ReadbackFacts[];
  readonly day: readonly DayFacts[];
  /** Each source's latest changing version; null (or absent, in a reading taken before it was read) when it was not read. */
  readonly changes?: readonly ChangeFacts[] | null;
}

export interface BodyCell {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly tone: FigureTone;
  readonly unknown: string;
}

export interface BodyQuestion {
  readonly pill: string;
  readonly tone: ViewTone;
  readonly text: string;
  readonly detail: string;
}

export interface BodyLane {
  readonly name: string;
  readonly pill: string;
  readonly tone: ViewTone;
  readonly counts: string;
  readonly note: string;
}

export interface BodyActivity {
  readonly at: string;
  readonly what: string;
  readonly pill: string;
  readonly tone: ViewTone;
  readonly cost: string;
}

export interface BodyDeadEnd {
  readonly pill: string;
  readonly title: string;
  readonly ruledOut: string | null;
  readonly wouldSettle: string | null;
  readonly whoMoves: string | null;
  /** Why a null field is missing, named (MW-016); absent on a field that has a value. */
  readonly gaps?: DeadEndGaps;
}

export interface BodyView {
  readonly id: string;
  readonly name: string;
  readonly stateCode: string | null;
  readonly ocdId: string | null;
  readonly status: BodyStatus;
  readonly statusTone: ViewTone;
  readonly summary: string;
  /** At the body's own last read. */
  readonly access: "GOT_IN" | "COULD_NOT" | "NOT_READ";
  readonly cells: readonly BodyCell[];
  readonly questions: readonly BodyQuestion[];
  readonly lanes: readonly BodyLane[];
  readonly schedule: readonly (readonly [string, string])[];
  readonly costs: readonly { readonly pill: string; readonly tone: ViewTone; readonly amount: string; readonly note: string }[];
  readonly deadEnd: BodyDeadEnd | null;
  readonly activity: readonly BodyActivity[];
  readonly escalationNote: string;
  readonly contractIds: readonly string[];
  /**
   * Meetings in the version we hold, or null when nothing was ever published.
   * Read through more than one source, the largest source's count: a floor,
   * since the sources may list the same sitting under different keys.
   */
  readonly records: number | null;
  /** How many of the body's sources hold a published version; more than one makes `records` a floor. */
  readonly recordSources: number;
  /** Meetings in a version the typed Reader read back (the largest such, read through more than one source). */
  readonly readerVisible: number | null;
  readonly held: number | null;
  readonly noAgendaLink: number | null;
  /** Last 24 hours; null when the body was not read in the window. */
  readonly day: {
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
    readonly reads: number;
    readonly gotIn: number;
    /** Reads that promoted a version with a changed record. */
    readonly changedReads: number;
    /** Reads that promoted a version: with changedReads, the rest confirmed nothing changed. */
    readonly versions: number;
    /** Reads that got in but found the source listing no meetings — they confirm nothing. */
    readonly cannotTell: number;
  } | null;
  readonly lastReadAt: string | null;
  /** The last read that confirmed the data (published or validated) in the seven days read; null when none did. */
  readonly lastSuccessAt: string | null;
  /**
   * Whether a failure to get in cleared by itself, over the reads held (each
   * source's last five in seven days): RECOVERED when a later read got in after
   * one that could not, STILL_FAILING when the latest read could not get in,
   * NO_FAILURE when every read held got in, NOT_READ when none was held.
   */
  readonly recovery: "RECOVERED" | "STILL_FAILING" | "NO_FAILURE" | "NOT_READ";
  /** The version readers are served now: its id, when it was promoted, and the change it carried. */
  readonly current: {
    readonly versionId: string;
    readonly promotedAt: string;
    readonly outcome: "CHANGED" | "UNCHANGED" | null;
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
    readonly held: number;
  } | null;
  /** The typed Reader's readback of that version, when one is recorded. */
  readonly readback: { readonly at: string; readonly passed: boolean } | null;
  /** A ZIP whose readers are served this body, for the public destination. */
  readonly publicZip: PublicZip;
  /**
   * The latest version that changed what readers are served, with its trail:
   * the source and when it was read, what changed, when it validated and was
   * promoted, and when the typed Reader first read it back — plus the version
   * serving readers now, which re-confirmed it when later reads changed
   * nothing. Null when no change is on record for any of the body's sources,
   * or the store was read without its changes.
   */
  readonly lastChange: {
    readonly versionId: string;
    readonly source: string;
    readonly sourceUrl: string | null;
    readonly retrievedAt: string;
    readonly promotedAt: string | null;
    readonly validatedAt: string | null;
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
    readonly held: number;
    readonly meetingsAdded: number;
    readonly named: readonly { readonly title: string; readonly startsAt: string | null }[];
    readonly meetingsChanged: number;
    readonly changedNamed: readonly { readonly title: string; readonly startsAt: string | null }[];
    /** The first passing readback of that version, else its latest. */
    readonly readback: { readonly at: string; readonly passed: boolean } | null;
    /** The version of the same source readers are served now, and its latest readback. */
    readonly servedNow: {
      readonly versionId: string;
      readonly promotedAt: string;
      readonly readback: { readonly at: string; readonly passed: boolean } | null;
    } | null;
  } | null;
  /** Whether the change history was read at all: false means `lastChange` is unknown, not absent. */
  readonly changeRead: boolean;
}

const DAY_MS = 86_400_000;

function ms(iso: string | null | undefined): number {
  return typeof iso === "string" ? Date.parse(iso) : Number.NaN;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "Newbury, NH — Planning Board". The source's own words, never a name invented from a slug. */
export function bodyDisplayName(contract: WatchedContract, version: VersionFacts | null): string {
  const raw = version?.jurisdiction ?? contract.jurisdiction ?? contract.publishingOrg ?? null;
  // A jurisdiction that arrives as a key ("az:county:county-of-cochise") is named the way the rest of Admin names it.
  const where = raw !== null && /^[a-z]{2}:[a-z_]+:/.test(raw) ? displayNameOf(raw).name : raw;
  const what = version?.bodyName ?? suffixWords(contract.bodyId);
  return where ? `${where} — ${what}` : what;
}

function suffixWords(bodyId: string): string {
  const hash = bodyId.lastIndexOf("#");
  const raw = hash >= 0 ? bodyId.slice(hash + 1) : bodyId;
  const words = raw.replace(/^body:/, "").replace(/[-_]+/g, " ").trim();
  if (words === "" || words === "governing") return "Governing body";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function stateCodeOf(bodyId: string, ocdId: string | null): string | null {
  const m = /state:([a-z]{2})/.exec(ocdId ?? bodyId) ?? /^curated:([a-z]{2})\//.exec(bodyId);
  return m ? m[1] : null;
}

/** The cadence in force at `atMs`: the first phase not yet past, else the default. */
function cadenceMs(c: WatchedContract, atMs: number): number {
  for (const phase of c.cadence.phases ?? []) if (atMs < ms(phase.through)) return phase.everyMs;
  return c.cadence.defaultEveryMs;
}

/* ==================================================================== *
 * THE SITTING-WINDOW CLOCK (C6), AS THE RUNNER KEEPS IT
 * ==================================================================== */

const HOUR_MS = 3_600_000;
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function countWords(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < COUNT_WORDS.length ? COUNT_WORDS[n] : n.toLocaleString("en-US");
}

/** A span in words: "an hour", "twelve hours", "seven days", "25 minutes". */
function spanWords(span: number): string {
  if (span > 0 && span % DAY_MS === 0) return span === DAY_MS ? "a day" : `${countWords(span / DAY_MS)} days`;
  if (span > 0 && span % HOUR_MS === 0) return span === HOUR_MS ? "an hour" : `${countWords(span / HOUR_MS)} hours`;
  const minutes = Math.round(span / 60_000);
  return minutes === 1 ? "a minute" : `${countWords(minutes)} minutes`;
}

/** A period as a rate: "hourly", "twice a day", else "every <span>". */
function everyWords(period: number): string {
  if (period >= HOUR_MS && DAY_MS % period === 0) {
    const times = DAY_MS / period;
    if (times === 24) return "hourly";
    if (times === 1) return "once a day";
    if (times === 2) return "twice a day";
    return `${countWords(times)} times a day`;
  }
  return `every ${spanWords(period)}`;
}

/**
 * The runner's sitting-window rule in words, from the schedule's own numbers:
 * "twice a day, and within the hour while a sitting is within seven days ahead
 * or behind".
 */
export function sittingWindowRuleWords(schedule: SittingWindowSchedule): string {
  const within = schedule.hotEveryMs === HOUR_MS ? "the hour" : spanWords(schedule.hotEveryMs);
  return `${everyWords(schedule.baseEveryMs)}, and within ${within} while a sitting is within ${spanWords(schedule.windowMs)} ahead or behind`;
}

/** One meeting source on the runner's sitting-window clock at `nowMs`. */
export interface SittingClock {
  readonly source: string;
  readonly schedule: SittingWindowSchedule;
  /** The facts were not in this reading, so nothing below was worked out. */
  readonly unread: boolean;
  readonly published: boolean;
  /** How long the runner waits after each attempt while nothing from the source is published (R20). */
  readonly unpublishedWaitMs: number;
  /** Hourly (true), twice a day (false), or not known (undefined, which the runner reads hourly). */
  readonly hot: boolean | undefined;
  /** The sitting that holds the source hourly: the next one ahead, else the latest behind. */
  readonly holding: { readonly startsAt: string; readonly ahead: boolean } | null;
  /** The first sitting after now that the version lists. */
  readonly nextSitting: string | null;
  /**
   * The next read the runner owes (`sittingWindowObligation`) and what it
   * counts from; null when no attempt is on record to count from, which the
   * runner treats as owed at once.
   */
  readonly owed: {
    readonly deadlineMs: number;
    readonly eligibleAtMs: number;
    readonly from: "SUCCESS" | "RETRY" | "UNPUBLISHED";
    readonly periodMs: number;
  } | null;
}

/**
 * A meeting source's clock, from the facts the runner schedules by
 * (`RoutineStoreClock`) and the runner's own functions. The last attempt is
 * the newest read's first event, or the version's own, or its confirmation;
 * the success is the version's first event or its confirmation; a trusted-LKG
 * import is neither, and only a read after it counts as an attempt. Every
 * deadline here is at most twelve hours after its read, so a source with no
 * read in the seven days held is owed at once, as the runner would find it.
 */
export function sittingClockOf(
  contract: WatchedContract & { readonly schedule: SittingWindowSchedule },
  version: VersionFacts | null,
  attempts: readonly AttemptFacts[],
  nowMs: number,
): SittingClock {
  const schedule = contract.schedule;
  const source = sourceWords(contract.meetingSource);
  const published = version !== null;
  const unpublishedWaitMs = sittingWindowRetryMs(schedule, contract.retry.afterMs, false);
  if (version !== null && version.clock === undefined) {
    return { source, schedule, unread: true, published, unpublishedWaitMs, hot: undefined, holding: null, nextSitting: null, owed: null };
  }
  const clock = version?.clock ?? null;
  const sittings = clock?.sittings ?? null;
  const ends = sittings === null
    ? new Map<string, number>()
    : statedSittingEndsByScope([{ scope: contract.scope, pairs: sittings.map((s) => [s.startsAt, s.endsAt]) }]).get(contract.scope) ?? new Map<string, number>();
  const hotAt = (starts: readonly string[] | undefined) => sittingWindowHotByConclusion(schedule, [starts], nowMs, ends);
  const hot = hotAt(sittings?.map((s) => s.startsAt));

  const dated = (sittings ?? []).filter((s) => Number.isFinite(ms(s.startsAt))).sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
  const next = dated.find((s) => ms(s.startsAt) > nowMs) ?? null;
  const holdingAhead = dated.find((s) => ms(s.startsAt) > nowMs && hotAt([s.startsAt]) === true) ?? null;
  const holdingBehind = [...dated].reverse().find((s) => ms(s.startsAt) <= nowMs && hotAt([s.startsAt]) === true) ?? null;
  const holding = hot !== true ? null : holdingAhead ? { startsAt: holdingAhead.startsAt, ahead: true } : holdingBehind ? { startsAt: holdingBehind.startsAt, ahead: false } : null;

  const imported = clock?.imported === true;
  const importedMs = imported ? ms(version!.promotedAt) : Number.NaN;
  const reads = attempts.map((a) => ms(a.attemptedAt)).filter((t) => Number.isFinite(t) && (!imported || t > importedMs));
  const observedMs = !imported && clock?.observedAt ? ms(clock.observedAt) : Number.NaN;
  const confirmedMs = !imported && clock?.confirmedAt ? ms(clock.confirmedAt) : Number.NaN;
  const attemptedMs = Math.max(...reads, ...[observedMs, confirmedMs].filter(Number.isFinite));
  const succeededMs = Number.isFinite(observedMs) ? Math.max(observedMs, ...[confirmedMs].filter(Number.isFinite)) : Number.NaN;

  let owed: SittingClock["owed"] = null;
  if (Number.isFinite(attemptedMs)) {
    const { deadlineMs, eligibleAtMs } = sittingWindowObligation(schedule, contract.retry.afterMs, { attemptedMs, succeededMs, published }, hot);
    // Which reading of `sittingWindowObligation` applied, for the words only; the instants are its own.
    const from = !Number.isFinite(succeededMs) ? (published ? "RETRY" : "UNPUBLISHED") : attemptedMs > succeededMs ? "RETRY" : "SUCCESS";
    owed = { deadlineMs, eligibleAtMs, from, periodMs: deadlineMs - (from === "SUCCESS" ? succeededMs : attemptedMs) };
  }
  return { source, schedule, unread: false, published, unpublishedWaitMs, hot, holding, nextSitting: next?.startsAt ?? null, owed };
}

/** "Hourly now — the next sitting, Sep 30, 2026, is within seven days." One source's standing on the rule. */
function sittingStandingWords(c: SittingClock): string {
  if (c.unread) return "Whether it is read hourly now was not read this time";
  const window = spanWords(c.schedule.windowMs);
  const nextWords = c.nextSitting === null ? "no sitting ahead is listed" : `the next one listed is ${fmtDate(c.nextSitting)}`;
  if (!c.published) {
    return `${cap(everyWords(c.unpublishedWaitMs))} until something from it is published: with no meeting on record, the runner waits ${spanWords(c.unpublishedWaitMs)} after each attempt`;
  }
  if (c.hot === false) return `${cap(everyWords(c.schedule.baseEveryMs))} now — no sitting is within ${window} ahead or behind; ${nextWords}`;
  const hourly = cap(everyWords(c.schedule.hotEveryMs));
  if (c.hot === undefined) return `${hourly} now — its sittings could not be read, and the runner reads an unknown as hourly`;
  if (c.holding === null) return `${hourly} now`;
  return c.holding.ahead
    ? `${hourly} now — the next sitting, ${fmtDate(c.holding.startsAt)}, is within ${window}`
    : `${hourly} now — the ${fmtDate(c.holding.startsAt)} sitting is within ${window} behind; ${nextWords}`;
}

/** When one source's next read is owed, and why. */
function sittingOwedWords(c: SittingClock, nowMs: number): string {
  if (c.unread) return "Not worked out — this reading did not include the runner's clock facts";
  if (c.owed === null) return "Owed now — no read in the last seven days is on record to count from, so the runner owes one at once";
  const period = spanWords(c.owed.periodMs);
  const why =
    c.owed.from === "SUCCESS"
      ? `${period} after the last good read`
      : c.owed.from === "RETRY"
        ? `the retry ${period} after a read that published nothing`
        : `${period} after the last attempt, since nothing from it is published yet`;
  if (c.owed.deadlineMs <= nowMs) return `Overdue — owed by ${fmt(new Date(c.owed.deadlineMs).toISOString())}, ${why}`;
  return `Owed by ${fmt(new Date(c.owed.deadlineMs).toISOString())}, ${why}; the runner may read it from ${fmt(new Date(c.owed.eligibleAtMs).toISOString())}`;
}

/** Per source when the sources differ, once when they agree. */
function perSource(clocks: readonly SittingClock[], words: (c: SittingClock) => string, joiner: string): string {
  const said = clocks.map((c) => ({ source: c.source, text: words(c) }));
  if (new Set(said.map((s) => s.text)).size === 1) return said[0].text;
  return said.map((s) => `${cap(s.source)}: ${s.text}`).join(joiner);
}

/** "How often": each source's standing now, then the rule itself. */
export function sittingHowOftenWords(clocks: readonly SittingClock[]): string {
  return `${perSource(clocks, sittingStandingWords, ". ")}. The rule: ${sittingWindowRuleWords(clocks[0].schedule)}.`;
}

/** "Next look": the next read each source owes, soonest first. */
export function sittingNextLookWords(clocks: readonly SittingClock[], nowMs: number): string {
  const soonest = [...clocks].sort((a, b) => (a.owed?.deadlineMs ?? Number.NEGATIVE_INFINITY) - (b.owed?.deadlineMs ?? Number.NEGATIVE_INFINITY));
  return perSource(soonest, (c) => sittingOwedWords(c, nowMs), "; ");
}

/** How a failed read is retried: the contract's retry, or the twice-daily wait while a sitting-window source has nothing published (R20). */
function retryWords(contract: WatchedContract, published: boolean): string {
  if (contract.schedule?.kind !== "SITTING_WINDOW" || published) return contract.retry.description;
  return `${spanWords(sittingWindowRetryMs(contract.schedule, contract.retry.afterMs, false))} after each attempt while nothing from it is published`;
}

const FAILED_STATES = new Set([
  "SOURCE_BLOCKED",
  "PARSE_INVALID",
  "IDENTITY_UNRESOLVED",
  "TEMPORAL_INVALID",
  "SEMANTIC_INVALID",
  "HORIZON_UNRESOLVED",
  "DEPENDENT_CONSUMER_INVALID",
  "CANNOT_TELL",
]);

/** What a candidate state means, in the owner's words. */
/**
 * What a read's state means, in the owner's words. The state is the FIRST
 * validation check that did not pass (`failureStateFor` in
 * lib/civic-data/validate.ts); the failure code narrows it where the code is
 * one this page knows.
 */
/**
 * A read our own code or configuration failed before the publisher could answer. The ingest marks it
 * by starting the failure detail with this prefix (lib/sources/composite/failure-kind.ts) while the
 * state and code stay SOURCE_BLOCKED / SOURCE_RETRIEVAL_FAILED, so this page reads the detail, and
 * never shows our own failure as a site that refused us.
 */
const JOB_FAILURE_PREFIX = "JOB_FAILURE:";
const JOB_FAILURE_SENTENCE_END = "this is not a publisher wall.";

export function isJobFailure(failureDetail: string | null | undefined): boolean {
  return typeof failureDetail === "string" && failureDetail.startsWith(JOB_FAILURE_PREFIX);
}

/** A failure detail for display: the ingest's fixed JOB_FAILURE sentence gives way to the words above, leaving the original error. */
function detailWords(failureDetail: string): string {
  if (!isJobFailure(failureDetail)) return failureDetail;
  const cut = failureDetail.indexOf(JOB_FAILURE_SENTENCE_END);
  return (cut < 0 ? failureDetail.slice(JOB_FAILURE_PREFIX.length) : failureDetail.slice(cut + JOB_FAILURE_SENTENCE_END.length)).trim();
}

export function readStateWords(state: string, failureCode: string | null, failureDetail: string | null = null): string {
  if (isJobFailure(failureDetail)) return "did not reach the site: our own code or configuration failed first, so this is not the site refusing us";
  switch (state) {
    case "PROMOTED":
      return "read it and published the new version";
    case "VALIDATED":
      return "read it and every check passed";
    case "NORMALIZED":
      return "read it and put it in standard form";
    case "FETCHED":
      return "fetched it";
    case "SOURCE_BLOCKED":
      return failureCode === "SOURCE_RETRIEVAL_FAILED" ? "could not get in: the site refused or failed the request" : "could not get in";
    case "PARSE_INVALID":
      return "got in but could not read the page";
    case "IDENTITY_UNRESOLVED":
      return "got in but could not tell which body a record belongs to";
    case "TEMPORAL_INVALID":
      return "got in but a date or time failed its check";
    case "SEMANTIC_INVALID":
      return "got in but a record failed its meaning check";
    case "HORIZON_UNRESOLVED":
      /* A check we could not complete, not a limit the publisher set (MW-017). */
      return "got in, but our check of how far ahead the source publishes could not be completed";
    case "DEPENDENT_CONSUMER_INVALID":
      return "got in but the reader's view of it failed its check";
    case "CANNOT_TELL":
      /* The absence check: a zero without bounded evidence is not proof of none. */
      return failureCode === "ZERO_IS_NOT_ABSENCE" || failureCode === null
        ? "got in, but the source listed no meetings — and a zero is not proof there are none, so nothing was published"
        : "got in, but the source's evidence that it has no meetings was incomplete, so nothing was published";
    default:
      return `ended ${state.toLowerCase()}`;
  }
}

/** What would settle a failed read: the rule the failing check states, never a guess. */
function wouldSettleWords(state: string, failureCode: string | null, source: string, url: string | null, failureDetail: string | null = null): string {
  const where = url ?? `the ${source}`;
  if (isJobFailure(failureDetail)) return `A fix to our adapter or its configuration for ${where}; the site itself was never asked.`;
  if (state === "CANNOT_TELL") {
    return `A meeting listed at ${where}, or bounded evidence that the body publishes none there (a complete calendar for a stated period, or an official statement).`;
  }
  if (state === "SOURCE_BLOCKED") return `A read of ${where} that the site answers.`;
  if (state === "PARSE_INVALID") return `A page at ${where} the adapter can read — if the page changed shape, the adapter has to change with it.`;
  return `A read of ${where} whose records pass the ${failureCode ?? state.toLowerCase().replace(/_/g, " ")} check.`;
}

function sourceWords(source: string): string {
  const s = source.toLowerCase();
  const known: Record<string, string> = {
    ical: "calendar feed",
    legistar: "Legistar meeting portal",
    "legistar-insite": "Legistar InSite portal",
    diligent: "Diligent board portal",
    civicplus: "CivicPlus agenda centre",
    clerksboards: "clerk's board page",
    civicclerk: "CivicClerk portal",
    apptegy: "district website",
    onbase: "OnBase agenda site",
    revize: "town website",
    iqm2: "IQM2 portal",
    schedulepage: "schedule page",
  };
  return known[s] ?? `${source} source`;
}

function titled(meetings: readonly { readonly title: string | null; readonly startsAt: string | null }[]): { readonly title: string; readonly startsAt: string | null }[] {
  return meetings.flatMap((m) => (m.title === null ? [] : [{ title: m.title, startsAt: m.startsAt }]));
}

function lastChangeOf(c: WatchedContract, f: ChangeFacts, l: Lookups): NonNullable<BodyView["lastChange"]> {
  const first = l.firstPassByCandidate.get(f.versionId) ?? l.readbackByCandidate.get(f.versionId) ?? null;
  const now = l.versionByScope.get(c.scope) ?? null;
  const nowReadback = now ? l.readbackByCandidate.get(now.versionId) ?? null : null;
  return {
    versionId: f.versionId,
    source: sourceWords(c.meetingSource),
    sourceUrl: c.sourceUrl,
    retrievedAt: f.retrievedAt,
    promotedAt: f.promotedAt,
    validatedAt: f.validatedAt,
    added: f.added,
    changed: f.changed,
    removed: f.removed,
    held: f.held,
    meetingsAdded: f.meetingsAdded,
    named: titled(f.named),
    meetingsChanged: f.meetingsChanged ?? 0,
    changedNamed: titled(f.changedNamed ?? []),
    readback: first ? { at: first.at, passed: first.passed } : null,
    servedNow: now ? { versionId: now.versionId, promotedAt: now.promotedAt, readback: nowReadback ? { at: nowReadback.at, passed: nowReadback.passed } : null } : null,
  };
}

interface BodyGroup {
  readonly bodyId: string;
  readonly contracts: WatchedContract[];
}

export interface BodyModelInput {
  readonly contracts: readonly WatchedContract[];
  readonly store: BodyStoreFacts;
  readonly nowIso: string;
  /** A ZIP whose readers are served this body's division, for the public destination; unread when not given. */
  readonly zipOf?: (ocdId: string | null) => PublicZip;
}

/** Where a body's readers are served: a ZIP the index gives its division, none, or an index that was not read. */
export type PublicZip = { readonly kind: "ZIP"; readonly zip: string } | { readonly kind: "NONE" } | { readonly kind: "UNREAD" };

/** Every watched body, in the order the page lists them: needing attention first, then by name. */
export function buildBodyViews(input: BodyModelInput): BodyView[] {
  const nowMs = ms(input.nowIso);
  const versionByScope = new Map(input.store.versions.map((v) => [v.scope, v]));
  const dayByScope = new Map(input.store.day.map((d) => [d.scope, d]));
  const attemptsByScope = new Map<string, AttemptFacts[]>();
  for (const a of input.store.attempts) {
    const list = attemptsByScope.get(a.scope) ?? [];
    list.push(a);
    attemptsByScope.set(a.scope, list);
  }
  for (const list of attemptsByScope.values()) list.sort((x, y) => ms(y.attemptedAt) - ms(x.attemptedAt));
  const readbackByCandidate = new Map<string, ReadbackFacts>();
  const firstPassByCandidate = new Map<string, ReadbackFacts>();
  for (const r of input.store.readbacks) {
    const held = readbackByCandidate.get(r.candidateId);
    if (!held || ms(held.at) < ms(r.at)) readbackByCandidate.set(r.candidateId, r);
    const first = firstPassByCandidate.get(r.candidateId);
    if (r.passed && (!first || ms(r.at) < ms(first.at))) firstPassByCandidate.set(r.candidateId, r);
  }
  const changeRead = Array.isArray(input.store.changes);
  const changeByScope = new Map((input.store.changes ?? []).map((c) => [c.scope, c]));

  const groups = new Map<string, BodyGroup>();
  for (const c of input.contracts) {
    const g = groups.get(c.bodyId) ?? { bodyId: c.bodyId, contracts: [] };
    g.contracts.push(c);
    groups.set(c.bodyId, g);
  }

  const views = [...groups.values()].map((g) =>
    bodyView(g, { versionByScope, dayByScope, attemptsByScope, readbackByCandidate, firstPassByCandidate, changeByScope, changeRead, nowMs, zipOf: input.zipOf ?? (() => ({ kind: "UNREAD" })) }),
  );
  const order: Record<BodyStatus, number> = { STUCK: 0, "NEEDS ATTENTION": 1, "NOT READ YET": 2, WORKING: 3 };
  return views.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

interface Lookups {
  readonly versionByScope: ReadonlyMap<string, VersionFacts>;
  readonly dayByScope: ReadonlyMap<string, DayFacts>;
  readonly zipOf: (ocdId: string | null) => PublicZip;
  readonly attemptsByScope: ReadonlyMap<string, readonly AttemptFacts[]>;
  readonly readbackByCandidate: ReadonlyMap<string, ReadbackFacts>;
  readonly firstPassByCandidate: ReadonlyMap<string, ReadbackFacts>;
  readonly changeByScope: ReadonlyMap<string, ChangeFacts>;
  readonly changeRead: boolean;
  readonly nowMs: number;
}

function bodyView(g: BodyGroup, l: Lookups): BodyView {
  /*
   * A body read through two sources is one body (MW-003). Its standing is
   * taken from the contract holding the newest published version, and the
   * reads and the day are the union of both.
   */
  const withVersion = g.contracts
    .map((c) => ({ c, v: l.versionByScope.get(c.scope) ?? null }))
    .sort((a, b) => ms(b.v?.promotedAt) - ms(a.v?.promotedAt) || a.c.id.localeCompare(b.c.id));
  const primary = withVersion[0];
  const contract = primary.c;
  const version = primary.v;
  const attempts = g.contracts.flatMap((c) => l.attemptsByScope.get(c.scope) ?? []).sort((x, y) => ms(y.attemptedAt) - ms(x.attemptedAt));
  const last = attempts[0] ?? null;
  const lastSuccess = attempts.find((a) => a.acquisitionSucceeded) ?? null;
  const days = g.contracts.map((c) => l.dayByScope.get(c.scope)).filter((d): d is DayFacts => d !== undefined);
  const day =
    days.length === 0
      ? null
      : days.reduce(
          (acc, d) => ({
            added: acc.added + d.added,
            changed: acc.changed + d.changed,
            removed: acc.removed + d.removed,
            reads: acc.reads + d.reads,
            gotIn: acc.gotIn + d.gotIn,
            changedReads: acc.changedReads + d.changedVersions,
            versions: acc.versions + d.versions,
            cannotTell: acc.cannotTell + (d.cannotTell ?? 0),
          }),
          { added: 0, changed: 0, removed: 0, reads: 0, gotIn: 0, changedReads: 0, versions: 0, cannotTell: 0 },
        );
  const readback = version ? l.readbackByCandidate.get(version.versionId) ?? null : null;
  // Across the body's sources, the newest version that changed something readers are served.
  const change =
    g.contracts
      .flatMap((c) => {
        const f = l.changeByScope.get(c.scope);
        return f === undefined ? [] : [{ c, f }];
      })
      .sort((a, b) => ms(b.f.retrievedAt) - ms(a.f.retrievedAt))[0] ?? null;
  const name = bodyDisplayName(contract, version);
  const stateCode = stateCodeOf(g.bodyId, contract.ocdId);
  /*
   * Every meeting partition is read on the sitting-window schedule (C6), not
   * on its `cadence`: each source keeps its own clock, from its own reads and
   * the sittings its own version lists.
   */
  const sittingContracts = g.contracts.filter((c): c is WatchedContract & { readonly schedule: SittingWindowSchedule } => c.schedule?.kind === "SITTING_WINDOW");
  const clocks =
    sittingContracts.length === g.contracts.length
      ? sittingContracts.map((c) => sittingClockOf(c, l.versionByScope.get(c.scope) ?? null, l.attemptsByScope.get(c.scope) ?? [], l.nowMs))
      : [];

  const lastFailed = last !== null && (!last.acquisitionSucceeded || FAILED_STATES.has(last.state));
  const access: BodyView["access"] = last === null ? "NOT_READ" : last.acquisitionSucceeded ? "GOT_IN" : "COULD_NOT";

  let status: BodyStatus;
  if (last === null && version === null) status = "NOT READ YET";
  else if (version === null) status = "STUCK";
  else if (lastFailed || readback === null || !readback.passed) status = "NEEDS ATTENTION";
  else status = "WORKING";
  const statusTone: ViewTone = status === "WORKING" ? "teal" : status === "STUCK" ? "amber" : status === "NOT READ YET" ? "slate" : "gold";

  /*
   * A body read through two sources holds a version from each, and both may
   * list the same sitting under different keys, so neither the newest one
   * alone (an undercount: Pima's Board of Supervisors holds 12 through InSite
   * and 15 through Legistar) nor their sum is right. The larger is shown, and
   * `recordSources` tells every total over it that it is a floor.
   */
  const heldVersions = withVersion.flatMap((x) => (x.v === null ? [] : [x.v]));
  const records = heldVersions.length === 0 ? null : Math.max(...heldVersions.map((v) => v.meetings));
  const readBack = heldVersions.filter((v) => l.readbackByCandidate.get(v.versionId)?.passed === true);
  const readerVisible = readBack.length === 0 ? null : Math.max(...readBack.map((v) => v.meetings));
  const source = sourceWords(contract.meetingSource);

  /* ---------------------------------------------------------------- summary */
  const parts: string[] = [];
  if (last === null) {
    parts.push(`No read of its ${source} is recorded in the last seven days.`);
  } else {
    parts.push(`Last read ${readStateWords(last.state, last.failureCode, last.failureDetail)}.`);
  }
  if (version) {
    parts.push(
      `The version we hold lists ${plural(version.meetings, "meeting")}${version.upcoming > 0 ? `, ${plural(version.upcoming, "still ahead", "still ahead")}` : ""}.`,
    );
    if (readback?.passed) parts.push("A reader can open it: the typed Reader read that version back.");
    else if (readback) parts.push("The typed Reader's readback of that version failed, so whether a reader can open it is not confirmed.");
    else parts.push("No readback of that version is recorded, so whether a reader can open it is not confirmed.");
  } else if (last !== null) {
    parts.push("Nothing from this body has ever been published for a reader.");
  }
  if (day && day.added + day.changed + day.removed > 0) {
    parts.push(`In the last 24 hours: ${plural(day.added, "record")} added, ${day.changed.toLocaleString("en-US")} revised, ${day.removed.toLocaleString("en-US")} removed.`);
  }
  const summary = parts.join(" ");

  /* ---------------------------------------------------------------- the six cells */
  const cells: BodyCell[] = [
    { key: "missing", label: "Don't have yet", value: null, tone: "text", unknown: "NOT MEASURED" },
    {
      key: "confirmed",
      label: "Confirmed right",
      value: version && version.fresh !== null && !lastFailed ? version.fresh : null,
      tone: "text",
      unknown: version ? "NOT CONFIRMED" : "NOTHING HELD",
    },
    {
      key: "gaps",
      label: "Has gaps",
      value: version ? version.noAgendaLink : null,
      tone: version && version.noAgendaLink > 0 ? "gold" : "text",
      unknown: "NOTHING HELD",
    },
    {
      key: "changed",
      label: "Changed",
      value: day ? day.added + day.changed + day.removed : null,
      tone: "text",
      unknown: "NOT READ IN 24H",
    },
    { key: "reader", label: "Reader can see", value: readerVisible, tone: "text", unknown: version ? "NOT READ BACK" : "NOTHING PUBLISHED" },
    { key: "disagrees", label: "Disagrees", value: null, tone: "text", unknown: "NOT CHECKED" },
  ];

  /* ---------------------------------------------------------------- the six questions */
  const questions: BodyQuestion[] = [
    {
      pill: "CAN'T TELL",
      tone: "gold",
      text: "Do we have this record at all?",
      detail: version
        ? `${plural(version.meetings, "meeting")} held; how many exist that we do not hold is not measured`
        : "nothing held; how many meetings exist is not measured",
    },
    lastFailed || !version
      ? {
          pill: "CAN'T TELL",
          tone: "gold",
          text: "Is what we hold still correct?",
          detail: last ? `the last read ${readStateWords(last.state, last.failureCode, last.failureDetail)}` : "not read in seven days",
        }
      : {
          pill: "UP TO DATE",
          tone: "teal",
          text: "Is what we hold still correct?",
          detail:
            version.fresh !== null
              ? `${version.fresh} of ${version.meetings} re-confirmed at the last read`
              : "confirmed at the last read",
        },
    version && version.noAgendaLink > 0
      ? {
          pill: "HAS GAPS",
          tone: "gold",
          text: "Is anything missing from the record we hold?",
          detail: `${plural(version.noAgendaLink, "past meeting")} carry no agenda${version.noAgendaAhead > 0 ? `; ${version.noAgendaAhead} ahead have none yet` : ""}${version.held > 0 ? `; ${version.held} held back by a check` : ""}`,
        }
      : {
          pill: version ? "UP TO DATE" : "NOT STARTED",
          tone: version ? "teal" : "slate",
          text: "Is anything missing from the record we hold?",
          detail: version ? `every past meeting carries an agenda${version.noAgendaAhead > 0 ? `; ${version.noAgendaAhead} ahead have none yet` : ""}${version.held > 0 ? `; ${version.held} held back by a check` : ""}` : "nothing held",
        },
    day === null
      ? { pill: "CAN'T TELL", tone: "gold", text: "Has it changed since we last looked?", detail: "not read in the last 24 hours" }
      : {
          pill: "UP TO DATE",
          tone: "teal",
          text: "Has it changed since we last looked?",
          detail: `${day.added} added, ${day.changed} revised, ${day.removed} removed in 24 hours`,
        },
    !version
      ? { pill: "NOT STARTED", tone: "slate", text: "Can a reader actually see it?", detail: "nothing published" }
      : readback?.passed
        ? { pill: "CONFIRMED", tone: "teal", text: "Can a reader actually see it?", detail: "the typed Reader read the version back" }
        : { pill: "CAN'T TELL", tone: "gold", text: "Can a reader actually see it?", detail: readback ? "the readback failed" : "no readback recorded" },
    { pill: "NOT CHECKED", tone: "slate", text: "Is it consistent with what we hold elsewhere?", detail: "no cross-source check exists for meetings" },
  ];

  /* ---------------------------------------------------------------- lanes */
  const lanes: BodyLane[] = [
    {
      name: "Discovery",
      pill: "IDLE",
      tone: "slate",
      counts: `${g.contracts.length} ${g.contracts.length === 1 ? "source" : "sources"} known`,
      note: `A way in is recorded (${source}), so nothing is left to discover about where this body publishes.`,
    },
    {
      name: "Acquisition",
      pill: last === null ? "NOT READ" : lastFailed && !last.acquisitionSucceeded ? "RETRYING" : "RUNNING",
      tone: last === null ? "slate" : lastFailed && !last.acquisitionSucceeded ? "amber" : "teal",
      counts: day ? `${day.gotIn} of ${day.reads} reads got in · 24h` : "no reads in 24h",
      note:
        clocks.length > 0 && contract.schedule
          ? `Runs on the standing runner's clock: ${sittingWindowRuleWords(contract.schedule)}; a failed read is retried ${retryWords(contract, version !== null)}.`
          : `Runs on the standing runner's clock (${contract.cadence.description}); a failed read is retried ${contract.retry.description}.`,
    },
    {
      name: "Validation",
      pill: last === null ? "IDLE" : FAILED_STATES.has(last.state) && last.acquisitionSucceeded ? "BLOCKED" : "PASSED",
      tone: last === null ? "slate" : FAILED_STATES.has(last.state) && last.acquisitionSucceeded ? "amber" : "teal",
      counts: version ? `${version.held} held back` : "nothing published",
      note: "Every record is checked before it is published; a record that fails a check is held back, never promoted.",
    },
  ];

  /* ---------------------------------------------------------------- when we look */
  const lastLook = last ? `${fmt(last.attemptedAt)} — ${last.acquisitionSucceeded && !lastFailed ? "worked" : readStateWords(last.state, last.failureCode, last.failureDetail)}` : "No read in the last seven days";
  let nextLook: string;
  if (clocks.length > 0) nextLook = sittingNextLookWords(clocks, l.nowMs);
  else if (last === null) nextLook = "Whenever the runner next reaches it — no read is recorded to count from";
  else if (lastFailed) nextLook = `Due ${fmt(new Date(ms(last.attemptedAt) + contract.retry.afterMs).toISOString())} — the retry after a failed read`;
  else {
    const from = lastSuccess ?? last;
    nextLook = `Due ${fmt(new Date(ms(from.attemptedAt) + cadenceMs(contract, l.nowMs)).toISOString())}`;
  }
  const schedule: [string, string][] = [
    ["Last look", lastLook],
    ["Next look", nextLook],
    ["How often", clocks.length > 0 ? sittingHowOftenWords(clocks) : cap(contract.cadence.description)],
    ["Reads that got in", day ? `${day.gotIn} of ${day.reads} in the last 24 hours` : "None in the last 24 hours"],
    ["Publishes ahead", publishesAheadWords(version, last, l.nowMs)],
  ];

  const costs = [
    {
      pill: "FREE",
      tone: "slate" as ViewTone,
      amount: day ? `${plural(day.reads, "read")} · 24h` : "no reads · 24h",
      note: "Meeting reads run plain code on a known route; they never reach a paid model. Their time and requests are real, and are not dollars.",
    },
    {
      pill: "PAID",
      tone: "cyan" as ViewTone,
      amount: "none",
      note: "No paid model work runs on this lane. The database and host it uses are shared with the whole site and are not split per body.",
    },
  ];

  /* ---------------------------------------------------------------- dead end */
  let deadEnd: BodyDeadEnd | null = null;
  // A sitting-window source with nothing published waits twelve hours between attempts, not its one-hour retry (R20).
  const retryClause = clocks.length > 0 && version === null ? retryWords(contract, false) : `${contract.retry.description} after a failure`;
  if (last !== null && lastFailed) {
    /* What the run of reads ruled out, from the reads themselves (MW-016); a gap is named, never left blank. */
    const ruled = routineRuledOut(
      attempts.map((a) => ({
        state: a.state,
        failureCode: a.failureCode,
        acquisitionSucceeded: a.acquisitionSucceeded,
        attemptedAt: a.attemptedAt,
        failed: !a.acquisitionSucceeded || FAILED_STATES.has(a.state),
        jobFailure: isJobFailure(a.failureDetail),
      })),
      (a) => readStateWords(a.state, a.failureCode),
    );
    deadEnd = {
      pill: version ? "LAST READ FAILED" : "CANNOT FINISH",
      title: `The last read ${readStateWords(last.state, last.failureCode, last.failureDetail)}${last.failureDetail ? ` — ${detailWords(last.failureDetail)}` : ""}`,
      ruledOut: ruled.ruledOut,
      ...(ruled.gap !== null ? { gaps: { ruledOut: ruled.gap } } : {}),
      wouldSettle: wouldSettleWords(last.state, last.failureCode, source, contract.sourceUrl, last.failureDetail),
      whoMoves: isJobFailure(last.failureDetail)
        ? `Engineering: our adapter or its configuration has to change. The runner retries on its clock (${retryClause}), but the same code fails the same way${version ? "; the last good version keeps serving meanwhile" : ""}.`
        : `The runner reads it again on its clock (${retryClause})${version ? "; the last good version keeps serving meanwhile" : ""}. Nothing else is scheduled to change it.`,
    };
  }

  /* ---------------------------------------------------------------- activity */
  const activity: BodyActivity[] = attempts.slice(0, 5).map((a) => ({
    at: a.attemptedAt,
    what: `Read the ${source} — ${readStateWords(a.state, a.failureCode, a.failureDetail)}`,
    pill: "NO AI NEEDED",
    tone: "slate",
    cost: "no cost",
  }));

  return {
    id: g.bodyId,
    name,
    stateCode,
    ocdId: contract.ocdId,
    status,
    statusTone,
    summary,
    access,
    cells,
    questions,
    lanes,
    schedule,
    costs,
    deadEnd,
    activity,
    escalationNote: "No model runs on this lane, so nothing here escalates; a failed read records its state and is retried on the clock.",
    contractIds: g.contracts.map((c) => c.id),
    records,
    recordSources: heldVersions.length,
    readerVisible,
    held: version ? version.held : null,
    noAgendaLink: version ? version.noAgendaLink : null,
    day,
    lastReadAt: last?.attemptedAt ?? null,
    lastSuccessAt: attempts.find((a) => a.state === "PROMOTED" || a.state === "VALIDATED")?.attemptedAt ?? null,
    current: version
      ? { versionId: version.versionId, promotedAt: version.promotedAt, outcome: version.outcome, added: version.added, changed: version.changed, removed: version.removed, held: version.held }
      : null,
    readback: readback ? { at: readback.at, passed: readback.passed } : null,
    publicZip: l.zipOf(contract.ocdId),
    lastChange: change === null ? null : lastChangeOf(change.c, change.f, l),
    changeRead: l.changeRead,
    recovery:
      last === null
        ? "NOT_READ"
        : !last.acquisitionSucceeded
          ? "STILL_FAILING"
          : attempts.some((a) => !a.acquisitionSucceeded)
            ? "RECOVERED"
            : "NO_FAILURE",
  };
}

function cap(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * **A PUBLISHING LIMIT, OR A CHECK WE DID NOT MAKE.** (MW-017.)
 *
 * The furthest meeting in the version we hold is a fact about what WE hold.
 * It is the publisher's own limit only when the read that produced it was
 * bounded, paginated to its end, and claims it holds everything the publisher
 * lists — then "the publisher lists through <date>" is true. Otherwise how far
 * ahead the publisher lists was not checked, and the sentence says so beside
 * what we hold, never as the publisher's limit. A read that failed its horizon
 * check is our check failing, not the publisher stopping.
 */
export function publishesAheadWords(
  version: Pick<VersionFacts, "furthestAhead" | "horizon"> | null,
  last: Pick<AttemptFacts, "state"> | null,
  nowMs: number,
): string {
  if (version === null) return "Unknown — nothing has been read from this source";
  const furthest = version.furthestAhead ? Math.round((ms(version.furthestAhead) - nowMs) / DAY_MS) : null;
  const held =
    furthest === null
      ? "the version we hold lists no dated meeting"
      : furthest >= 0
        ? `the version we hold lists meetings through ${fmtDate(version.furthestAhead)}, ${furthest} days ahead`
        : `the latest meeting in the version we hold was ${fmtDate(version.furthestAhead)}`;
  if (last?.state === "HORIZON_UNRESOLVED") {
    return `Not checked — the last read could not complete our check of how far ahead the publisher lists (our check is incomplete; this is not a limit the publisher set); ${held}`;
  }
  const h = version.horizon;
  if (horizonIsPublishersLimit(h)) {
    const counted = h!.declaredTotal !== null && h!.returnedRecords !== null ? ` (the read holds ${h!.returnedRecords} of the ${h!.declaredTotal} it lists)` : "";
    if (furthest === null) return `The publisher lists no dated meeting${counted}`;
    return furthest >= 0
      ? `The publisher lists through ${fmtDate(version.furthestAhead)} — ${furthest} days ahead${counted}`
      : `The publisher lists nothing ahead — its latest meeting was ${fmtDate(version.furthestAhead)}${counted}`;
  }
  if (h === undefined) return `Unknown — whether the read holds everything the publisher lists was not read this time; ${held}`;
  if (h === null) return `Unknown — the read records no horizon, so where the publisher's list ends is not known; ${held}`;
  return `Not checked — the read does not claim it holds everything the publisher lists, so the publisher's own limit is unknown; ${held}`;
}

const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const FMT_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });

function fmt(iso: string | null | undefined): string {
  const t = ms(iso);
  return Number.isFinite(t) ? FMT.format(new Date(t)) : "at no recorded time";
}
function fmtDate(iso: string | null | undefined): string {
  const t = ms(iso);
  return Number.isFinite(t) ? FMT_DATE.format(new Date(t)) : "no recorded date";
}

/* ==================================================================== *
 * THE THREE CARDS AT THE TOP OF FLEET · NOW
 * ==================================================================== */

export interface NowFigures {
  readonly bodies: number;
  readonly gotIn: number;
  readonly couldNot: number;
  readonly notRead: number;
  /** Records added / revised / removed across the scope in 24 hours. Null when no body in scope was read. */
  readonly day: { readonly added: number; readonly changed: number; readonly removed: number; readonly bodiesRead: number } | null;
  /** The share of revisions carried by the three bodies with the most, so the page can say where they concentrate. */
  readonly revisionsTopThree: { readonly count: number; readonly bodies: readonly string[] } | null;
  readonly records: number;
  /** Bodies read through more than one source count their largest source, so the records total is a floor. */
  readonly recordsFloor: boolean;
  readonly readerVisible: number;
  readonly held: number;
  readonly noAgendaLink: number;
  /** Bodies whose last read failed: their counts are what they last held, so every total over them is a floor. */
  readonly floor: boolean;
}

export function nowFigures(views: readonly BodyView[]): NowFigures {
  const read = views.filter((v) => v.day !== null);
  const day =
    read.length === 0
      ? null
      : read.reduce(
          (acc, v) => ({ added: acc.added + v.day!.added, changed: acc.changed + v.day!.changed, removed: acc.removed + v.day!.removed, bodiesRead: acc.bodiesRead + 1 }),
          { added: 0, changed: 0, removed: 0, bodiesRead: 0 },
        );
  const byRevisions = [...read].sort((a, b) => b.day!.changed - a.day!.changed).slice(0, 3).filter((v) => v.day!.changed > 0);
  return {
    bodies: views.length,
    gotIn: views.filter((v) => v.access === "GOT_IN").length,
    couldNot: views.filter((v) => v.access === "COULD_NOT").length,
    notRead: views.filter((v) => v.access === "NOT_READ").length,
    day,
    revisionsTopThree:
      byRevisions.length === 0 ? null : { count: byRevisions.reduce((n, v) => n + v.day!.changed, 0), bodies: byRevisions.map((v) => v.name) },
    records: views.reduce((n, v) => n + (v.records ?? 0), 0),
    recordsFloor: views.some((v) => v.recordSources > 1),
    readerVisible: views.reduce((n, v) => n + (v.readerVisible ?? 0), 0),
    held: views.reduce((n, v) => n + (v.held ?? 0), 0),
    noAgendaLink: views.reduce((n, v) => n + (v.noAgendaLink ?? 0), 0),
    floor: views.some((v) => v.access !== "GOT_IN"),
  };
}
