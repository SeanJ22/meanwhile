import { createHash } from "node:crypto";
import type { BallotSet } from "../ballot/types.ts";
import { workList, type WorkInput } from "../core/work.ts";
import { stateName } from "../facts/entity-read.ts";
import { pageCopy, saveSourceReference } from "../facts/source-copy.ts";
import type { Decision } from "../core/door.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import { publishResultWrites, type ResultWrite } from "./bulk-publish.ts";
import type { SavedCopy } from "../facts/check.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { allVoteGettersMatched, matchElectionResultAcrossBallots, type ElectionMatch } from "./matcher.ts";
import { nextElectionResultCheck } from "./schedule.ts";
import type { DoorRecord } from "../doors/registry.ts";
import type { ReaderCachePurger } from "../reader/cache.ts";
import type { ElectionResult, ElectionResultBatch } from "./types.ts";
import { updateCongressResults, type CongressRaceResult } from "./summary.ts";

export interface RaceClock {
  readonly fingerprint: string;
  readonly status: string;
  readonly statusChangedAt: string;
  readonly lastCheckedAt: string;
  readonly nextCheckAt: string | null;
  readonly values?: Readonly<Record<string, string>>;
}
export interface ResultProgress {
  readonly races: Readonly<Record<string, RaceClock>>;
  readonly summaries: Readonly<Record<string, string>>;
  readonly federalResults?: Readonly<Record<string, CongressRaceResult>>;
}
export interface ResultCounts {
  matched: number;
  unmatched: number;
  ambiguous: number;
  published: number;
  unchanged: number;
}
/** Connections one state's result writes use at once (the reader pool holds four). */
const RESULT_WRITE_LANES = 4;
const clocks = { windowHours: () => 24, retryMinutes: () => 360 };
const statePlace = (state: string) => state === "US" ? "ocd-division/country:us" : `ocd-division/country:us/state:${state.toLowerCase()}`;
const fingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const raceClockKey = (race: Pick<ElectionResult, "sourceId" | "sourceRaceId" | "electionDate">) => `${race.sourceId}:${race.electionDate}:${race.sourceRaceId}`;
const sources = (race: ElectionResult) => [{ name: race.sourceName, url: race.sourceUrl }, ...race.creditedSources];

/** Identity and result values, excluding evidence bytes and the time a source was checked. */
function resultFingerprint(race: ElectionResult, match: ElectionMatch): string {
  const { quote: _quote, checkedAt: _checked, ...value } = race;
  return fingerprint({ rule: "all-vote-getters-matched", ...value, candidates: value.candidates.map(({ quote: _candidateQuote, ...candidate }) => candidate),
    match: match.kind === "matched" ? { contest: match.contest.id, candidates: match.candidates.map(row => [row.resultIndex, row.candidacy.id]),
      measure: match.measure?.id, missing: match.unmatchedCandidates, ambiguous: match.ambiguousCandidates } : match });
}

export async function electionResultFix(query: Query, race: ElectionResult, reason: string, kind: "fix" | "detect" = "fix",
  details: Readonly<Record<string, unknown>> = {}, writeFix?: (row: WorkInput) => Promise<void>): Promise<void> {
  const row: WorkInput = {
    kind, tier: "coverage", state: race.state, placeId: statePlace(race.state),
    subjectId: `election-results:${race.state}:${race.sourceRaceId}`, field: `election_result:${reason}`,
    url: race.sourceUrl, sources: sources(race).flatMap(source => source.url ? [source.url] : []),
    value: { sourceRaceId: race.sourceRaceId, office: race.officeName, district: race.districtHint,
      candidates: race.candidates.map(candidate => candidate.name), reason, ...details },
    source: { source: race.sourceName, reason }, origin: { from: kind === "detect" ? "detective" : "loader" },
  };
  if (kind === "fix" && writeFix) await writeFix(row);
  else await workList(query, { owner: "election-results" }).ensure([row]);
}

interface QueuedValue {
  readonly write: ResultWrite; readonly input: unknown;
  readonly done: (decision: Decision) => void;
}

/** The Slide's own §3 guard: every quote is on the saved page before a value is queued; the door's check then runs again in memory at write time. */
function resultWrite(input: {
  copy: SavedCopy; race: ElectionResult; id: string; kind: "contest" | "candidacy" | "measure" | "place"; name: string; parentId: string | null;
  sourceId: string; value: unknown; quote: string; quotes?: readonly string[]; field?: string;
}): ResultWrite {
  const { race } = input;
  const quotes = input.quotes?.length ? input.quotes : [input.quote];
  if (quotes.some(quote => !quote || !input.copy.text.includes(quote))) throw new Error("ELECTION_RESULT_EVIDENCE_MISMATCH");
  const { checkedAt: _checkedAt, ...value } = input.value as Record<string, unknown>;
  return { id: input.id, kind: input.kind, name: input.name, parentId: input.parentId, state: race.state === "US" ? null : race.state,
    aliasScheme: `election-results:${race.sourceId}:${race.state}:${input.kind}:${race.sourceRaceId}`, sourceId: input.sourceId,
    field: input.field ?? "election_result", value, quotes };
}

/** One state at a time, against its current served ballot. Only the Slide writes result facts. */
export async function publishElectionResultBatch(input: {
  query: Query;
  /** The control-plane query: the `work` table exists only there. Defaults to `query` for single-database callers. */
  workQuery?: Query; db: FactDb; batch: ElectionResultBatch; ballots: readonly BallotSet[]; state: string;
  prior?: ResultProgress; door?: DoorRecord; now?: Date; purge?: ReaderCachePurger; more?: () => boolean;
  /** One runner-owned allowance handles every kind of fix; queued work never delays a fact. */
  writeFix?: (row: WorkInput) => Promise<void>;
  /** Only values the Slide published or confirmed enter the job-built reader slice. */
  accepted?: (id: string, field: string, value: unknown) => void;
}): Promise<{ counts: ResultCounts; progress: ResultProgress; nextCheckAt: string | null; deferred: boolean }> {
  const now = input.now ?? new Date(), at = now.toISOString(), counts: ResultCounts = { matched: 0, unmatched: 0, ambiguous: 0, published: 0, unchanged: 0 };
  const progress: { races: Record<string, RaceClock>; summaries: Record<string, string>; federalResults?: Readonly<Record<string, CongressRaceResult>> } = {
    races: { ...input.prior?.races }, summaries: { ...input.prior?.summaries },
    ...(input.prior?.federalResults ? { federalResults: input.prior.federalResults } : {}),
  };
  let deferred = false;
  let copy: SavedCopy | undefined;
  /** Every value this state publishes is queued first and written together; work-list upkeep follows once the facts are down. */
  const resolves: { subjectId: string; fieldPrefix: string; exceptFields?: string[] }[] = [];
  const queue: QueuedValue[] = [], afterWrites: Array<() => Promise<void>> = [];
  const observed = async () => {
    if (copy) return copy;
    const hash = createHash("sha256").update(input.batch.evidence.text).digest("hex");
    if (hash !== input.batch.evidence.contentHash.replace(/^sha256-/, "")) throw new Error("ELECTION_RESULT_SOURCE_HASH_MISMATCH");
    // This is a URL/hash/check receipt. No response body, vault artifact or source snapshot is stored.
    const addressHash = createHash("sha256").update(input.batch.source.url ?? "").digest("hex");
    const id = await input.db.transaction(query => saveSourceReference(query, { key: `observed:${addressHash}:${hash}:${at}`,
      url: input.batch.source.url!, finalUrl: input.batch.source.url!, fetchedAt: at, httpStatus: 200, contentHash: hash }));
    copy = { ...pageCopy({ finalUrl: input.batch.source.url!, body: input.batch.evidence.text,
      contentType: input.batch.evidence.contentType, fetchedAt: at }), id };
    return copy;
  };
  for (const raw of input.batch.races.filter(race => race.state === input.state)) {
    if (input.more?.() === false) { deferred = true; break; }
    const key = raceClockKey(raw), previous = progress.races[key];
    if (previous?.status === "certified") { counts.unchanged++; continue; }
    if (previous) {
      const nextCheckAt = nextElectionResultCheck(previous, input.door, now);
      if (nextCheckAt === null || nextCheckAt > at && !input.door?.readNow) {
        progress.races[key] = { ...previous, nextCheckAt }; continue;
      }
    }
    const match = matchElectionResultAcrossBallots(raw, input.ballots);
    const race = { ...raw, statusChangedAt: raw.statusChangedAt ?? (previous?.status === raw.status ? previous.statusChangedAt : raw.checkedAt) };
    const nextCheckAt = nextElectionResultCheck({ ...race, lastCheckedAt: at }, input.door, now);
    const hash = resultFingerprint(raw, match);
    if (race.sourceId === "ballotpedia" && (race.office === "us_senate" || race.office === "us_house")) {
      const [federalKey, federal] = Object.entries(updateCongressResults(undefined, [race]))[0];
      const { checkedAt: _at, ...value } = federal;
      const summaryKey = `congress:${federalKey}`, federalHash = fingerprint(value);
      if (progress.summaries[summaryKey] === federalHash && progress.federalResults?.[federalKey]) {
        progress.federalResults = { ...progress.federalResults, [federalKey]: { ...progress.federalResults[federalKey], checkedAt: at } };
      } else {
        const field = `election_congress:${race.sourceRaceId}`, id = statePlace(race.state);
        queue.push({ input: federal, write: resultWrite({ copy: await observed(), race, id,
          kind: "place", name: stateName(race.state) ?? race.state, parentId: statePlace("US"), sourceId: race.sourceRaceId,
          value: federal, quote: race.quote, field }),
        done: decision => {
          if (decision === "PUBLISH") counts.published++;
          if (decision !== "PUBLISH" && decision !== "CONFIRM") return;
          input.accepted?.(id, field, federal);
          progress.federalResults = { ...progress.federalResults, [federalKey]: federal };
          progress.summaries[summaryKey] = federalHash;
        } });
      }
    }
    if (match.kind === "matched") counts.matched++;
    else if (match.kind === "ambiguous") counts.ambiguous++;
    else counts.unmatched++;
    if (previous?.fingerprint === hash) { counts.unchanged++; progress.races[key] = { ...previous, lastCheckedAt: at, nextCheckAt }; continue; }
    const incumbentConflictReason = "Source incumbent flags disagree";
    const incumbentConflictKey = `incumbent-conflict:${key}`;
    const conflictingCandidates = race.sourceId === "multistate" && race.incumbentLost === false
      && (race.status === "called" || race.status === "certified")
      ? race.candidates.filter(candidate => candidate.incumbent === true && candidate.won === false) : [];
    const updateIncumbentConflict = async () => {
      if (conflictingCandidates.length) {
        await electionResultFix(input.workQuery ?? input.query, race, incumbentConflictReason, "fix", {
          reportedIncumbentLost: false, candidateNames: conflictingCandidates.map(candidate => candidate.name),
        }, input.writeFix);
        progress.summaries[incumbentConflictKey] = hash;
      } else if (progress.summaries[incumbentConflictKey]) {
        await workList(input.workQuery ?? input.query, { owner: "election-results" }).resolve({ subjectId: `election-results:${race.state}:${race.sourceRaceId}`,
          fieldPrefix: `election_result:${incumbentConflictReason}` });
        delete progress.summaries[incumbentConflictKey];
      }
    };
    if (match.kind !== "matched") {
      await electionResultFix(input.workQuery ?? input.query, race, match.reason, match.kind === "ambiguous" ? "detect" : "fix", { contestIds: match.contestIds }, input.writeFix);
      await updateIncumbentConflict();
    } else {
      const evidence = await observed(), citation = { sources: sources(race), checkedAt: at,
        sourceId: race.sourceId, sourceRaceId: race.sourceRaceId, electionDate: race.electionDate };
      const values = { ...previous?.values };
      const write = (args: Pick<Parameters<typeof resultWrite>[0], "id" | "kind" | "name" | "parentId" | "sourceId" | "value" | "quote">) => {
        const { checkedAt: _checkedAt, ...value } = args.value as Record<string, unknown>;
        const fieldKey = `${args.kind}:${args.id}`, valueHash = fingerprint(value);
        if (values[fieldKey] === valueHash) return;
        queue.push({ input: args.value, write: resultWrite({ ...args, copy: evidence, race }), done: decision => {
          if (decision === "PUBLISH") counts.published++;
          if (decision === "PUBLISH" || decision === "CONFIRM") input.accepted?.(args.id, "election_result", args.value);
          values[fieldKey] = valueHash;
        } });
      };
      const measureValue = race.measure ? { yesVotes: race.measure.yesVotes ?? null, noVotes: race.measure.noVotes ?? null,
        yesPercent: race.measure.yesPercent ?? null, outcome: race.measure.outcome } : undefined;
      // A captured Ballotpedia page is a substring that never spells its own URL id, so the saved copy can only name this contest by the seat it prints.
      const congress = race.sourceId === "ballotpedia" && (race.office === "us_house" || race.office === "us_senate");
      // RT-05: an outcome is published only when every candidate with votes matched our ballot.
      const complete = allVoteGettersMatched(race, match);
      const outcome = complete ? { status: race.status, percentCounted: race.percentCounted ?? null, statusChangedAt: raw.statusChangedAt ?? null,
        seatsToFill: race.seatsToFill ?? match.contest.voteFor, flipped: race.flipped ?? null,
        gainedByParty: race.gainedByParty ?? null, incumbentLost: race.incumbentLost ?? null,
        seatsFlipped: race.seatsFlipped ?? null, incumbentsLost: race.incumbentsLost ?? null, allCandidatesMatched: true }
        : { status: "counting", statusChangedAt: raw.statusChangedAt ?? null, seatsToFill: race.seatsToFill ?? match.contest.voteFor };
      write({ id: match.contest.id, kind: "contest", name: match.contest.title, parentId: match.contest.ocdId,
        sourceId: congress ? `U.S. ${race.office === "us_house" ? "House" : "Senate"} ${stateName(race.state) ?? race.state}` : race.sourceRaceId, quote: race.quote,
        value: { ...outcome, ...measureValue, ...citation } });
      for (const row of match.candidates) {
        const candidate = race.candidates[row.resultIndex];
        write({ id: row.candidacy.id, kind: "candidacy", name: candidate.name, parentId: match.contest.id,
          sourceId: candidate.name, quote: candidate.quote ?? race.quote,
          value: { votes: candidate.votes ?? null, percent: candidate.percent ?? null, won: complete ? candidate.won ?? null : null,
            runoff: complete ? candidate.runoff ?? null : null, ...citation } });
      }
      if (race.measure && match.measure) write({ id: match.measure.id, kind: "measure", name: race.measure.name,
        parentId: match.contest.id, sourceId: race.sourceRaceId, quote: race.quote,
        value: { ...measureValue, ...citation } });
      afterWrites.push(async () => {
        if (match.unmatchedCandidates.length) await electionResultFix(input.workQuery ?? input.query, race, "Candidate missing from served ballot", "fix",
          { candidateNames: match.unmatchedCandidates.map(index => race.candidates[index].name) }, input.writeFix);
        if (match.ambiguousCandidates.length) await electionResultFix(input.workQuery ?? input.query, race, "Candidate identity tie", "detect",
          { candidateNames: match.ambiguousCandidates.map(index => race.candidates[index].name) });
        await updateIncumbentConflict();
        resolves.push({ subjectId: `election-results:${race.state}:${race.sourceRaceId}`, fieldPrefix: "election_result:",
          exceptFields: [...match.unmatchedCandidates.length ? ["election_result:Candidate missing from served ballot"] : [],
            ...match.ambiguousCandidates.length ? ["election_result:Candidate identity tie"] : [],
            ...conflictingCandidates.length ? [`election_result:${incumbentConflictReason}`] : []] },
          { subjectId: match.contest.id, fieldPrefix: "election_result" });
        progress.races[key] = { fingerprint: hash, status: race.status, statusChangedAt: race.statusChangedAt,
          lastCheckedAt: at, nextCheckAt, values };
      });
      continue;
    }
    progress.races[key] = { fingerprint: hash, status: race.status, statusChangedAt: race.statusChangedAt,
      lastCheckedAt: at, nextCheckAt };
  }
  for (const summary of input.batch.summaries.filter(row => row.state === input.state)) {
    if (input.more?.() === false) { deferred = true; break; }
    const chamber = summary.state === "US" && summary.chambers.length === 1 ? summary.chambers[0].name : null;
    const chamberKey = chamber && /senat/i.test(chamber) ? "us_senate" : chamber && /house/i.test(chamber) ? "us_house" : null;
    const { checkedAt: _at, quote, quotes, ...value } = summary, key = `${input.batch.source.name}:${summary.state}${chamberKey ? `:${chamberKey}` : ""}`, hash = fingerprint(value);
    if (progress.summaries[key] === hash) continue;
    const sourceId = input.batch.races[0]?.sourceId ?? (/ballotpedia\.org/i.test(input.batch.source.url ?? "") ? "ballotpedia" : "multistate");
    const id = statePlace(summary.state), race: ElectionResult = { sourceId,
      sourceName: summary.source.name, sourceUrl: summary.source.url!, sourceRaceId: summary.state, creditedSources: summary.creditedSources,
      state: summary.state, office: "summary", officeName: "Election summary", electionDate: "2026-11-03", status: "counting", candidates: [], checkedAt: at, quote };
    const field = chamberKey ? `election_summary:${chamberKey}` : "election_summary", summaryValue = { ...value, checkedAt: at, sourceClockKey: `${sourceId}${chamberKey ? `:${chamberKey}` : ""}` };
    queue.push({ input: summaryValue, write: resultWrite({ copy: await observed(), race, id, kind: "place", name: summary.state,
      parentId: summary.state === "US" ? null : statePlace("US"), sourceId: summary.state, value: summaryValue, quote, quotes, field }),
    done: decision => {
      if (decision === "PUBLISH") counts.published++;
      if (decision === "PUBLISH" || decision === "CONFIRM") input.accepted?.(id, field, summaryValue);
      progress.summaries[key] = hash;
    } });
  }
  // One pass writes everything this state queued; the first refused fact is raised once the rest are down.
  if (queue.length) {
    const outcomes = await publishResultWrites(input.db, queue.map(item => item.write), await observed(), clocks, now, input.purge);
    let refused: string | undefined;
    outcomes.forEach((outcome, index) => {
      if ("blank" in outcome) refused ??= outcome.blank; else queue[index].done(outcome.decision);
    });
    if (refused !== undefined) throw new Error(`ELECTION_RESULT_REFUSED:${refused}`);
  }
  {
    let next = 0, failure: unknown;
    const lane = async () => {
      while (next < afterWrites.length && failure === undefined) {
        try { await afterWrites[next++](); } catch (error) { failure ??= error ?? new Error("ELECTION_RESULT_WRITE_FAILED"); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(RESULT_WRITE_LANES, afterWrites.length) }, lane));
    if (failure !== undefined) throw failure;
    await workList(input.workQuery ?? input.query, { owner: "election-results" }).resolveMany(resolves);
  }
  const due = Object.values(progress.races).flatMap(row => row.nextCheckAt ? [row.nextCheckAt] : []).sort();
  return { counts, progress, nextCheckAt: deferred ? at : due[0] ?? null, deferred };
}

/** Local contests remain standing acquisition work until a results source is available. */
export async function ensureOpenElectionResults(query: Query, ballots: readonly BallotSet[], covered: ReadonlySet<string>): Promise<void> {
  const list = workList(query, { owner: "election-results" });
  const rows = ballots.flatMap(ballot => ballot.contests.filter(contest => !covered.has(contest.id)).map(contest => ({
    kind: "hunt" as const, state: ballot.election.state, placeId: contest.ocdId, subjectId: contest.id, field: "election_result",
    value: { reason: "No matching result has been acquired", office: contest.title },
    source: { source: "Election results", reason: "Results remain owed" }, origin: { from: "loader" as const },
  })));
  for (let offset = 0; offset < rows.length; offset += 1000) await list.ensure(rows.slice(offset, offset + 1000));
}
