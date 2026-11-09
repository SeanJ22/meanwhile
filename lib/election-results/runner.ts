import { createHash } from "node:crypto";
import { electionResultClockRows } from "../reader/canonical.ts";
import { withCandidateTickets } from "../ballot/tickets.ts";
import { withCurrentCandidacies } from "../ballot/filing-changes.ts";
import type { BallotSet } from "../ballot/types.ts";
import { stateBallotScope } from "../civic-data/state-scopes.ts";
import { stateName } from "../facts/entity-read.ts";
import { writePassCursor } from "../facts/db.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import { withBatchedReaderInvalidation, type ReaderCachePurger } from "../reader/cache.ts";
import { workId, workList, type WorkInput } from "../core/work.ts";
import type { DoorRepository, DoorRecord } from "../doors/registry.ts";
import { isDoorRecord } from "../doors/registry.ts";
import { parseMultiStateResults, readMultiStateResults } from "./multistate.ts";
import { CAPTURED_BALLOTPEDIA_URL, fetchCapturedBallotpediaText } from "./captured-source.ts";
import { ballotpediaRaceId, parseCapturedBallotpedia, readCapturedBallotpediaResults, readCapturedCongressSummary, type CapturedBallotpedia, type BallotpediaRace } from "./ballotpedia.ts";
import { PUBLIC_SITE_ORIGIN } from "../ops/origins.ts";
import { ensureOpenElectionResults, publishElectionResultBatch, raceClockKey, type ResultProgress, type ResultCounts } from "./publisher.ts";
import { matchElectionResult } from "./matcher.ts";
import { nextElectionResultCheck } from "./schedule.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import type { Persisted } from "../control-plane/repository/types.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { runtimeCivicReadCache, type CivicReadCache } from "../db/civic-read-cache.ts";
import type { ElectionResult, ElectionResultBatch } from "./types.ts";
import type { BallotResultFacts, BallotElectionSummary } from "../ballot/election-results.ts";
import { readResultProjection, readResultProjections, refreshedResultFacts, preparedStateResultFeed, projectionBallots, type ResultProjection } from "./materialize.ts";
import { runnerResultFeedStore, type ElectionResultFeedStore } from "./feed-store.ts";
import type { StateResultFeed } from "./feed-types.ts";
import { summarizeCongressResults, type NationalCongressSummary } from "./summary.ts";

const STATES_BASE = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const STATES = STATES_BASE;
/** Codes a served ballot may carry: the fifty states, the District and the territories. A state is read only when a ballot is served for it. */
const BALLOT_CODES = [...STATES_BASE, "DC", "AS", "GU", "MP", "PR", "VI"];
/** States whose results are read, matched and written side by side. */
const STATE_LANES = 4;
const cursorName = (state: string) => `election-results:${state}`;
const empty = (): ResultProgress => ({ races: {}, summaries: {} });
interface StateProgress extends ResultProgress {
  readonly sourceChecks?: Readonly<Record<string, { readonly checkedAt: string; readonly failed?: boolean; readonly lastSucceededAt?: string }>>;
  readonly coveredContestIds?: readonly string[];
  readonly standingFingerprint?: string;
  readonly sourceFingerprints?: Readonly<Record<string, string>>;
  readonly federalRoutes?: readonly BallotpediaRace[];
  /** The newest browser-capture time this state's Senate and House results were read from. */
  readonly capturedBallotpediaAt?: string;
  /** Newest capture each national overview (Senate, House) was published from. */
  readonly capturedSummaryAt?: Partial<Record<"us_house" | "us_senate", string>>;
  readonly ballotVersion?: string | null;
  readonly pendingSources?: readonly string[];
  readonly pendingFixes?: readonly WorkInput[];
  readonly readerFacts?: BallotResultFacts;
  readonly nationalSummary?: NationalCongressSummary;
  readonly stateSummary?: BallotElectionSummary;
  readonly readerPending?: boolean;
  readonly readerSlice?: StateResultFeed;
  readonly nationalFeedFingerprint?: string;
  readonly nationalFeedPending?: boolean;
}
type CachedClock = { readonly position: string; readonly hashMD5: string };
const progressHash = (position: string) => createHash("md5").update(position).digest("hex");
const CLOCK_CACHE_NAMESPACE = "election-results-progress";
const CLOCK_CACHE_KEY = "source-clocks-v1";

/** Congress page routes are discovered from held source links, with the ordinary national page names as fallback. */
function federalRace(ballot: BallotSet, contest: BallotSet["contests"][number]): BallotpediaRace | null {
  const title = contest.title.toLowerCase(), state = ballot.election.state;
  const identity = officeIdentity(contest.title, contest.ocdId);
  const house = identity === "us_representative" || /\/(?:cd):/.test(contest.ocdId) && /congress|u\.?\s*s\.?|united states/i.test(title);
  const senate = identity === "us_senator" || /(?:united states|u\.?\s*s\.?)\s+(?:senat)/i.test(title);
  if (!house && !senate) return null;
  const district = /\/cd:([^/]+)/.exec(contest.ocdId)?.[1];
  const number = district === "0" || district === "00" || district === "at-large" || !district && ["AK", "DE", "ND", "SD", "VT", "WY"].includes(state)
    ? "at-large" : district && String(Number(district));
  const ordinal = (value: string) => `${value}${[11, 12, 13].includes(Number(value) % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[Number(value) % 10] ?? "th")}`;
  const name = stateName(state)?.replaceAll(" ", "_");
  if (!name) return null;
  const held = [contest.provenance.sourceUrl, ...contest.sources?.map(source => source.sourceUrl) ?? [],
    ...ballot.candidacies.filter(candidate => candidate.contestId === contest.id)
      .flatMap(candidate => [candidate.provenance.sourceUrl, ...candidate.sources?.map(source => source.sourceUrl) ?? []])]
    .find(url => url && /^https:\/\/(?:www\.)?ballotpedia\.org\//.test(url) && /2026/.test(url)
      && (senate ? /United_States_Senate.*_election(?:s)?_in_/i.test(url) : /_Congressional_District_election,/i.test(url)));
  const possessive = name.endsWith("s") ? `${name}'` : `${name}'s`;
  const path = senate ? `United_States_Senate_${/special/i.test(contest.title) ? "special_" : ""}election_in_${name},_2026`
    : `${possessive}_${number === "at-large" ? "At-Large" : ordinal(number ?? "1")}_Congressional_District_election,_2026`;
  return { state, office: senate ? "us_senate" : "us_house", electionDate: ballot.election.date,
    ...(house ? { districtHint: number } : {}), url: (held ?? `https://ballotpedia.org/${path}`).replaceAll("'", "%27") };
}

/** Source-owned race pages replace synthesized routes for the same seat; matching still uses full candidate names. */
function federalRoutes(catalog: readonly BallotpediaRace[], held: readonly BallotpediaRace[]): BallotpediaRace[] {
  const seat = (race: BallotpediaRace) => {
    const district = (race.districtHint ?? "").toLowerCase().replace(/[\s-]/g, "");
    const atLarge = ["0", "00", "atlarge"].includes(district) || !district && ["AK", "DE", "ND", "SD", "VT", "WY"].includes(race.state);
    return `${race.state}:${race.office}:${race.office === "us_senate" ? "" : atLarge ? "0" : String(Number(district))}`;
  };
  const catalogSeats = new Set(catalog.map(seat));
  return [...new Map([...catalog, ...held.filter(race => !catalogSeats.has(seat(race)))]
    .map(race => [ballotpediaRaceId(race.url), race])).values()];
}

export async function runElectionResults(input: {
  query: Query;
  /** The control-plane query: fix-list (`work`) rows live only in the control-plane database. Defaults to `query` for single-database callers. */
  workQuery?: Query;
  db: FactDb; doors?: DoorRepository; now?: Date; fetch?: typeof fetch;
  states?: readonly string[];
  /** Browser-captured Ballotpedia pages (file text) used when the live read is blocked. Defaults to GitHub when no fetch is injected. */
  captured?: () => Promise<string>;
  /** Local test adapters supply the reader authority; no repository ballot file is used. */
  ballotsForState?: (state: string) => Promise<readonly BallotSet[]>;
  multistate?: ElectionResultBatch;
  congressSummaries?: readonly ElectionResultBatch[];
  purge?: ReaderCachePurger;
  deadlineMs?: number;
  clock?: () => number;
  cache?: CivicReadCache;
  feedStore?: ElectionResultFeedStore;
  /** Bounds all fix upserts across both sources and every state in one turn. Detectives are separate. */
  maxFixRows?: number;
  /** States read, matched and written side by side; one keeps them strictly in order. */
  stateLanes?: number;
}): Promise<ResultCounts & { reads: number; nextCheckAt: string | null; fixRowsWritten: number; pendingFixRows: number }> {
  const maxFixRows = input.maxFixRows ?? 100;
  if (!Number.isSafeInteger(maxFixRows) || maxFixRows < 1) throw new RangeError("maxFixRows must be a positive integer");
  let fixRowsWritten = 0;
  const now = input.now ?? new Date(), at = now.toISOString();
  // The MultiState download is time-limited (a caller's own fetch is used as given); a timeout is that read's ordinary failure.
  const limited = (ms: number): typeof fetch => (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  const multistateFetch = input.fetch ?? limited(120_000);
  const more = () => (input.clock ?? Date.now)() < (input.deadlineMs ?? Number.POSITIVE_INFINITY);
  const result: ResultCounts = { matched: 0, unmatched: 0, ambiguous: 0, published: 0, unchanged: 0 };
  if (!more()) return { ...result, reads: 0, nextCheckAt: at, fixRowsWritten, pendingFixRows: 0 };
  let reads = 0;
  const count = (query: Query): Query => async (text, params) => {
    if (/^\s*(?:SELECT|WITH)\b/i.test(text)) reads++;
    return query(text, params);
  };
  const query = count(input.query), db: FactDb = { transaction: work => input.db.transaction(tx => work(count(tx))) };
  const workQuery = input.workQuery ?? query;
  // Every state, the District and the territories that have a served ballot, taken from the served scopes rather than a fixed list.
  const states: readonly string[] = input.states ?? await (async () => {
    const served = new Set((await query("SELECT scope FROM civic_data_promotions WHERE record_class='BALLOT_CANDIDACY'")).map(row => String(row.scope)));
    const held = BALLOT_CODES.filter(code => served.has(stateBallotScope("ballot-contests", code)));
    return held.length ? held : STATES;
  })();
  const cache = (input.cache ?? runtimeCivicReadCache()).jobState();
  const savedClocks = await cache.readCheckpoint<unknown>(CLOCK_CACHE_NAMESPACE, CLOCK_CACHE_KEY);
  const cached: Record<string, CachedClock> = {};
  if (savedClocks && typeof savedClocks === "object" && !Array.isArray(savedClocks)) {
    for (const [name, value] of Object.entries(savedClocks)) {
      if (!value || typeof value !== "object" || typeof value.position !== "string" || typeof value.hashMD5 !== "string") continue;
      if (/^[a-f0-9]{32}$/.test(value.hashMD5) && progressHash(value.position) === value.hashMD5) cached[name] = value;
    }
  }
  const cursorRows = await electionResultClockRows(query, [...states.map(state => ({ name: cursorName(state),
    scope: stateBallotScope("ballot-contests", state), hashMD5: cached[cursorName(state)]?.hashMD5 })),
    { name: cursorName("US"), scope: null, hashMD5: cached[cursorName("US")]?.hashMD5 }]);
  const progress = new Map<string, StateProgress>();
  const ballotVersions = new Map<string, string | null>();
  const resultHashes = new Map<string, string | null>();
  for (const row of cursorRows) {
    const name = String(row.name), state = name.slice("election-results:".length);
    ballotVersions.set(state, row.ballot_version == null ? null : String(row.ballot_version));
    resultHashes.set(state, row.reader_slice_hash == null ? null : String(row.reader_slice_hash));
    if (row.clock_hash == null) { delete cached[name]; continue; }
    const hashMD5 = String(row.clock_hash);
    const position = row.position == null && cached[name]?.hashMD5 === hashMD5 ? cached[name].position : row.position;
    if (typeof position !== "string" || !/^[a-f0-9]{32}$/.test(hashMD5) || progressHash(position) !== hashMD5) {
      throw new Error(`Election result clock fingerprint does not match its saved progress: ${name}`);
    }
    const saved: unknown = JSON.parse(position);
    if (!saved || typeof saved !== "object" || !("races" in saved) || !("summaries" in saved)
      || !saved.races || typeof saved.races !== "object" || !saved.summaries || typeof saved.summaries !== "object") {
      throw new Error(`Invalid election result clock: ${name}`);
    }
    progress.set(state, saved as StateProgress);
    cached[name] = { position, hashMD5 };
  }
  const queuedFixes = new Map<string, Map<string, WorkInput>>();
  for (const [state, prior] of progress) queuedFixes.set(state, new Map((prior.pendingFixes ?? []).map(row => [workId(row), row])));
  const dirtyFixStates = new Set<string>(), writtenFixes = new Set<string>();
  const writeFix = async (row: WorkInput) => {
    if (row.kind !== "fix") throw new Error("Election result fix allowance accepts only fix work");
    const state = row.state ?? "US", id = workId(row);
    let queue = queuedFixes.get(state);
    if (!queue) { queue = new Map(); queuedFixes.set(state, queue); }
    if (writtenFixes.has(id)) return;
    if (fixRowsWritten < maxFixRows && more()) {
      fixRowsWritten++;
      await workList(workQuery, { owner: "election-results" }).ensure([row]);
      writtenFixes.add(id);
      if (queue.delete(id)) dirtyFixStates.add(state);
    } else {
      queue.set(id, row); dirtyFixStates.add(state);
    }
  };
  const saveProgress = async (state: string, value: StateProgress) => {
    const queue = queuedFixes.get(state);
    for (const [id, row] of queue ?? []) if (row.field === "election_result:Source incumbent flags disagree") {
      const raceId = row.value && typeof row.value === "object" ? (row.value as Record<string, unknown>).sourceRaceId : undefined;
      const key = Object.keys(value.races).find(key => key.startsWith("multistate:") && key.endsWith(`:${raceId}`));
      if (key && !value.summaries[`incumbent-conflict:${key}`]) queue!.delete(id);
    }
    const saved = { ...value, pendingFixes: [...queuedFixes.get(state)?.values() ?? []] };
    const name = cursorName(state), position = JSON.stringify(saved);
    await writePassCursor(query, name, position);
    cached[name] = { position, hashMD5: progressHash(position) };
    progress.set(state, saved); dirtyFixStates.delete(state);
  };
  const doors = new Map<string, DoorRecord>();
  const doorRows = new Map<string, Persisted<DoorRecord>>();
  if (input.doors) {
    const ids = ["multistate", "ballotpedia"].map(source => `feed:election-results:${source}`);
    const rows = input.doors.readMany ? await (async () => {
      reads++;
      return input.doors!.readMany!(ids);
    })() : await Promise.all(ids.map(async id => { reads++; return input.doors!.read(id); }));
    for (const row of rows) if (row && isDoorRecord(row.value)) {
      const source = row.id.slice("feed:election-results:".length);
      doors.set(source, row.value); doorRows.set(source, row as Persisted<DoorRecord>);
    }
  }
  let unfinished = false;
  // These descriptors already passed matching. Their source clocks need no extra read, even after certification.
  for (const queue of queuedFixes.values()) for (const row of [...queue.values()]) {
    if (fixRowsWritten >= maxFixRows || !more()) break;
    await writeFix(row);
  }
  let multistateText: string | undefined, multistateFailure: unknown, multistateRead: Promise<ElectionResultBatch> | undefined, multistateFirst = "";
  const due: string[] = [];
  const sourceNext = (prior: StateProgress, source: string, requested = true): string | null => {
    const door = doors.get(source.split(":")[0]);
    if (door?.status === "SUSPENDED") return null;
    if (prior.pendingSources?.includes(source)) return at;
    if (requested && door?.readNow) return at;
    const checked = prior.sourceChecks?.[source];
    const clocks = Object.entries(prior.races).filter(([key]) => key.startsWith(`${source}:`)).map(([, clock]) => clock);
    if (checked?.failed || clocks.length === 0) return nextElectionResultCheck({ status: "pending", lastCheckedAt: checked?.checkedAt }, door, now);
    return clocks.flatMap(clock => nextElectionResultCheck(clock, door, now) ?? []).sort()[0] ?? null;
  };
  // Ballotpedia keeps race clocks only once a capture has been read; before that a newer capture, not a clock, is its due time.
  const sourceDues = (prior: StateProgress) => ["multistate", ...Object.keys(prior.races).some(key => key.startsWith("ballotpedia:")) || prior.sourceChecks?.ballotpedia
    ? ["ballotpedia"] : []].flatMap(source => sourceNext(prior, source, false) ?? []);
  const checked = (prior: StateProgress, source: string, failed: boolean): StateProgress => {
    const previous = prior.sourceChecks?.[source];
    const lastSucceededAt = failed ? previous?.lastSucceededAt ?? (previous?.failed !== true ? previous?.checkedAt : undefined) : at;
    return { ...prior, sourceChecks: { ...prior.sourceChecks, [source]: { checkedAt: at,
      ...(lastSucceededAt ? { lastSucceededAt } : {}), ...(failed ? { failed: true } : {}) } } };
  };
  const pending = (prior: StateProgress, source: string, remains: boolean): StateProgress => ({ ...prior,
    pendingSources: [...new Set([...(prior.pendingSources ?? []).filter(key => key !== source), ...remains ? [source] : []])] });
  const outcomes = new Map<string, string | null>();
  const noteOutcome = (source: string, reason: string | null) => {
    if (!outcomes.has(source) || reason) outcomes.set(source, reason);
  };
  const failure = async (state: string, url: string, reason: string) => {
    const safeReason = reason.replace(/postgres(?:ql)?:\/\/\S+/g, "database connection");
    if (url.includes("ballotpedia.org")) noteOutcome("ballotpedia", safeReason);
    if (url.includes("multistate.us")) noteOutcome("multistate", safeReason);
    await writeFix({ kind: "fix", state,
      placeId: state === "US" ? "ocd-division/country:us" : `ocd-division/country:us/state:${state.toLowerCase()}`, subjectId: `election-results:${state}`,
      field: `source:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`, url,
      source: { source: "Election results", reason: safeReason }, value: { reason: safeReason }, origin: { from: "loader" } });
    const next = nextElectionResultCheck({ status: "pending", lastCheckedAt: at }, doors.get(url.includes("ballotpedia.org") ? "ballotpedia" : "multistate"), now);
    if (next) due.push(next);
  };
  const finishFeedFailure = async (state: string, url: string) => {
    const subjectId = `election-results:${state}`, field = `source:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
    const queue = queuedFixes.get(state);
    for (const [id, row] of queue ?? []) if (row.subjectId === subjectId && row.field === field) {
      queue!.delete(id); dirtyFixStates.add(state);
    }
    await workList(workQuery, { owner: "election-results" }).resolve({ subjectId, fieldPrefix: field });
  };
  // National results have their own clocks and cannot wait behind the initial state backfill.
  let nation: StateProgress = progress.get("US") ?? empty();
  const congressCertified = STATES.every(state => states.includes(state) && progress.get(state)?.sourceChecks?.ballotpedia
    && !progress.get(state)?.sourceChecks?.ballotpedia.failed && Object.entries(progress.get(state)!.races)
      .some(([key]) => key.startsWith("ballotpedia:"))) && [...progress.values()].every(prior =>
        Object.entries(prior.races).filter(([key]) => key.startsWith("ballotpedia:")).every(([, clock]) => clock.status === "certified"));
  const lastCertification = [...progress.values()].flatMap(prior => Object.entries(prior.races)
    .filter(([key]) => key.startsWith("ballotpedia:")).map(([, clock]) => clock.lastCheckedAt)).sort().at(-1);
  // Senate and House results come from the browser-captured Ballotpedia pages, read from GitHub once at every check; ballotpedia.org is never fetched.
  let captured: CapturedBallotpedia | null = null;
  if (more() && (input.captured || !input.fetch)) {
    try { captured = parseCapturedBallotpedia(await (input.captured ?? fetchCapturedBallotpediaText)()); }
    catch (error) {
      noteOutcome("ballotpedia", String(error));
      await failure("US", CAPTURED_BALLOTPEDIA_URL, String(error));
      const retry = nextElectionResultCheck({ status: "pending", lastCheckedAt: at }, doors.get("ballotpedia"), now);
      if (retry) due.push(retry);
    }
  }
  if (captured) nation = { ...nation, federalRoutes: [...new Map([...nation.federalRoutes ?? [], ...captured.races]
    .map(page => [ballotpediaRaceId(page.url), page])).values()] };
  // Race pages the overviews name are known before any state reads its routes; the summaries themselves publish while the states run.
  for (const batch of input.congressSummaries ?? []) if (batch.racePages) nation = { ...nation, federalRoutes: [...new Map([
    ...nation.federalRoutes ?? [], ...batch.racePages].map(page => [ballotpediaRaceId(page.url), page])).values()] };
  // The national Senate and House summaries are read and published while the states run, not before them.
  const nationalTask = async (): Promise<void> => {
    for (const office of ["us_senate", "us_house"] as const) {
      if (!more()) { unfinished = true; break; }
      const key = `ballotpedia:${office}`, next = sourceNext(nation, key);
      const injected = input.congressSummaries?.find(batch => batch.summaries.some(summary => summary.chambers.some(chamber => chamber.name === office)));
      // Without an injected batch the overview comes from the captured file, and only when that capture is newer than the one last published (certified or not).
      const capturedNew = !injected && captured !== null && captured.capturedAt > (nation.capturedSummaryAt?.[office] ?? "");
      if (!injected && captured !== null && !captured.overviews[office]) {
        console.log(`Ballotpedia ${office} overview page is not in the captured file yet; the chamber summary waits for the next refresh.`);
        continue;
      }
      if (!capturedNew && !nation.pendingSources?.includes(key) && congressCertified && lastCertification && (nation.sourceChecks?.[key]?.checkedAt ?? "") >= lastCertification) continue;
      if (!capturedNew) {
        if (next === null) continue;
        if (next > at) { due.push(next); continue; }
      }
      try {
        const batch = injected ?? (capturedNew ? await readCapturedCongressSummary(captured!, office) : null);
        if (!batch) continue;
        if (batch.racePages) nation = { ...nation, federalRoutes: [...new Map([
          ...nation.federalRoutes ?? [], ...batch.racePages,
        ].map(page => [ballotpediaRaceId(page.url), page])).values()] };
        const readerFacts = { ...nation.readerFacts };
        const changed = await publishElectionResultBatch({ query, workQuery, db, batch, ballots: [], state: "US", prior: nation, now,
          door: doors.get("ballotpedia"), purge: input.purge, more, writeFix,
          accepted: (id, field, value) => { readerFacts[field.startsWith("election_summary:") ? `${id}#${field}` : id] = value; } });
        nation = checked(pending({ ...nation, ...changed.progress, readerFacts, ...capturedNew && !changed.deferred
          ? { capturedSummaryAt: { ...nation.capturedSummaryAt, [office]: captured!.capturedAt } } : {} }, key, changed.deferred), key, Boolean(batch.catalogErrors?.length));
        unfinished ||= changed.deferred;
        for (const issue of batch.catalogErrors ?? []) await failure("US", issue.url, issue.reason);
        noteOutcome("ballotpedia", null);
        for (const count of Object.keys(result) as (keyof ResultCounts)[]) result[count] += changed.counts[count];
      } catch (error) {
        nation = checked(pending(nation, key, false), key, true);
        await failure("US", `https://ballotpedia.org/United_States_${office === "us_house" ? "House_of_Representatives" : "Senate"}_elections,_2026`, String(error));
      }
      const nextCheck = sourceNext(nation, key, false);
      if (nextCheck) due.push(nextCheck);
    }
    await saveProgress("US", nation);
  };
  const projections = new Map<string, ResultProjection | null>(), preparedStates = new Set<string>();
  // One read returns every state's ballot and filed facts; a state whose saved copy still matches is not read again.
  if (!input.ballotsForState && more()) {
    const missing: string[] = [];
    for (const state of states) {
      if (!ballotVersions.get(state)) continue;
      const held = await cache.readCheckpoint<ResultProjection>("election-results-reader", state);
      if (held && held.versionId === ballotVersions.get(state) && held.hash === resultHashes.get(state)) projections.set(state, { ...held, hash: resultHashes.get(state) ?? null });
      else missing.push(state);
    }
    if (missing.length) for (const [state, projection] of await readResultProjections(query, missing))
      projections.set(state, projection ? { ...projection, hash: resultHashes.get(state) ?? null } : null);
  }
  const getProjection = async (state: string) => {
    if (projections.has(state)) return projections.get(state)!;
    const held = await cache.readCheckpoint<ResultProjection>("election-results-reader", state);
    let projection = held && held.versionId === ballotVersions.get(state) && held.hash === resultHashes.get(state)
      ? held : await readResultProjection(query, state);
    if (projection) projection = { ...projection, hash: resultHashes.get(state) ?? null };
    projections.set(state, projection);
    return projection;
  };
  /** Each state's accepted facts; its feed is prepared and every feed is written together once all states are done. */
  const feedQueue = new Map<string, BallotResultFacts>();
  const standing: { ballots: readonly BallotSet[]; covered: ReadonlySet<string> }[] = [];
  // Every state's MultiState results are published before any Ballotpedia request, so a slow Ballotpedia cannot keep them off the feeds.
  const ballotsRead = new Map<string, readonly BallotSet[]>();
  const runState = async (state: string): Promise<void> => {
    if (!more()) { unfinished = true; return; }
    let prior: StateProgress = progress.get(state) ?? empty();
    const ballotVersion = ballotVersions.get(state) ?? null;
    const changedBallot = prior.ballotVersion !== ballotVersion;
    if (changedBallot) prior = { ...prior, sourceFingerprints: {}, federalRoutes: undefined, ballotVersion };
    const catalog = nation.federalRoutes?.filter(race => race.state === state) ?? [];
    if (catalog.some(race => !prior.races[raceClockKey({ sourceId: "ballotpedia", sourceRaceId: ballotpediaRaceId(race.url),
      electionDate: race.electionDate ?? "2026-11-03" })] &&
      !prior.federalRoutes?.some(held => ballotpediaRaceId(held.url) === ballotpediaRaceId(race.url)))) {
      prior = pending(prior, "ballotpedia", true);
    }
    const sourceDue = (source: string) => { const next = sourceNext(prior, source); return next !== null && next <= at; };
    // Ballotpedia is due whenever the capture is newer than the one this state last read (or its ballot changed): the read is a no-op otherwise.
    const capturedDue = captured !== null && (captured.capturedAt > (prior.capturedBallotpediaAt ?? "") || changedBallot);
    // MultiState and the captured Ballotpedia pages are both read for this state in the same pass.
    const multistateDue = sourceDue("multistate");
    if (!multistateDue && !capturedDue) {
      due.push(...sourceDues(prior)); return;
    }
    try {
      await withBatchedReaderInvalidation(async purge => {
      let ballots: readonly BallotSet[] | undefined;
      const acceptedFacts: Record<string, unknown> = {};
      const getBallots = async () => {
        if (ballots) return ballots;
        if (input.ballotsForState) { ballots = ballotsRead.get(state) ?? await input.ballotsForState(state); ballotsRead.set(state, ballots); return ballots; }
        const held = await getProjection(state);
        return ballots = held ? projectionBallots(held).map(ballot => withCandidateTickets(withCurrentCandidacies(ballot))) : [];
      };
      const covered = new Set<string>(prior.coveredContestIds);
      const publish = async (batch: ElectionResultBatch, source: string): Promise<boolean> => {
        const fingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
        const sourceFingerprints = { ...prior.sourceFingerprints };
        const eligible: ElectionResult[] = [];
        for (const race of batch.races.filter(race => race.state === state)) {
          const key = raceClockKey(race), previous = prior.races[key];
          if (source !== "ballotpedia" && previous && !doors.get(source)?.readNow && (nextElectionResultCheck(previous, doors.get(source), now) ?? "~") > at) continue;
          const { checkedAt: _at, quote: _quote, ...value } = race;
          const hash = fingerprint({ ...value, candidates: value.candidates.map(({ quote: _quote, ...candidate }) => candidate) });
          const missingCongressSummary = race.sourceId === "ballotpedia" && !prior.federalResults?.[`${race.electionDate}:${race.sourceRaceId}`];
          if (previous && sourceFingerprints[key] === hash && !changedBallot && !missingCongressSummary) {
            const nextCheckAt = nextElectionResultCheck({ ...previous, lastCheckedAt: at }, doors.get(source), now);
            const federalKey = `${race.electionDate}:${race.sourceRaceId}`, federal = prior.federalResults?.[federalKey];
            prior = { ...prior, races: { ...prior.races, [key]: { ...previous, lastCheckedAt: at, nextCheckAt } },
              ...(federal ? { federalResults: { ...prior.federalResults, [federalKey]: { ...federal, checkedAt: at } } } : {}) };
            result.unchanged++; continue;
          }
          sourceFingerprints[key] = hash;
          eligible.push(race);
        }
        const summaryKeys: string[] = [];
        const summaries = batch.summaries.filter(summary => summary.state === state || summary.state === "US").filter(summary => {
          const { checkedAt: _at, quote: _quote, quotes: _quotes, ...value } = summary;
          const key = `summary:${source}:${summary.state}:${summary.chambers.map(chamber => chamber.name).join(":")}`, hash = fingerprint(value);
          if (sourceFingerprints[key] === hash && !changedBallot) return false;
          sourceFingerprints[key] = hash; summaryKeys.push(key); return true;
        });
        if (!eligible.length && !summaries.length) { prior = pending({ ...prior, sourceFingerprints }, source, false); return true; }
        if (!more()) { prior = pending(prior, source, true); unfinished = true; return false; }
        const held = await getBallots();
        const newlyCovered = new Map<string, string[]>();
        for (const race of eligible) for (const ballot of held) {
          const match = matchElectionResult(race, ballot);
          if (match.kind === "matched") {
            const key = raceClockKey(race);
            newlyCovered.set(key, [...newlyCovered.get(key) ?? [], match.contest.id]);
          }
        }
        const changed = await publishElectionResultBatch({ query, workQuery, db, batch: { ...batch, races: eligible, summaries }, ballots: held,
          state, prior, now, door: doors.get(source), purge, more, writeFix,
          accepted: (id, field, value) => {
            if (field === "election_result" || field === "election_summary" || field.startsWith("election_summary:"))
              acceptedFacts[field.startsWith("election_summary:") ? `${id}#${field}` : id] = value;
            if (field === "election_summary") prior = { ...prior, stateSummary: value as BallotElectionSummary };
          } });
        for (const race of eligible) {
          const key = raceClockKey(race);
          if (changed.progress.races[key]?.lastCheckedAt === at) for (const id of newlyCovered.get(key) ?? []) covered.add(id);
          else if (prior.sourceFingerprints?.[key] !== undefined) sourceFingerprints[key] = prior.sourceFingerprints[key];
          else delete sourceFingerprints[key];
        }
        if (changed.deferred) for (const key of summaryKeys) {
          if (prior.sourceFingerprints?.[key] !== undefined) sourceFingerprints[key] = prior.sourceFingerprints[key];
          else delete sourceFingerprints[key];
        }
        prior = pending({ ...prior, ...changed.progress, sourceFingerprints }, source, changed.deferred);
        unfinished ||= changed.deferred;
        for (const key of Object.keys(result) as (keyof ResultCounts)[]) result[key] += changed.counts[key];
        return !changed.deferred;
      };
      if (multistateDue) {
        if (!more()) { prior = pending(prior, "multistate", true); unfinished = true; }
        else {
        try {
          let firstState: ElectionResultBatch | undefined;
          if (!input.multistate && multistateText === undefined) {
            if (multistateFailure) throw multistateFailure;
            try {
              if (!multistateRead) { multistateFirst = state; multistateRead = readMultiStateResults(at, multistateFetch, state); }
              const read = await multistateRead;
              if (multistateFirst === state) firstState = read;
              multistateText = read.evidence.text;
            } catch (error) { multistateFailure = error; throw error; }
          }
          await publish(input.multistate ?? firstState ?? parseMultiStateResults(multistateText!, at, "2026-11-03", state), "multistate");
          prior = checked(prior, "multistate", false);
          noteOutcome("multistate", null);
        } catch (error) {
          prior = checked(pending(prior, "multistate", false), "multistate", true);
          await failure(state, "https://multistate.us/elections/data/live_results_general_2026.json", String(error));
        }
        }
      }
      if (capturedDue && captured) {
        if (!more()) { prior = pending(prior, "ballotpedia", true); unfinished = true; }
        else {
        const visited = new Set<string>();
        let failed = false, deferred = false;
        const routes = federalRoutes([...catalog, ...captured.races.filter(race => race.state === state)],
          prior.federalRoutes ?? (await getBallots()).filter(row => row.election.date === "2026-11-03")
            .flatMap(ballot => ballot.contests.flatMap(contest => federalRace(ballot, contest) ?? [])));
        for (const race of routes) {
          if (!more()) { deferred = true; break; }
          if (!race || visited.has(race.url)) continue;
          visited.add(race.url);
          const previous = prior.races[raceClockKey({ sourceId: "ballotpedia", sourceRaceId: ballotpediaRaceId(race.url), electionDate: race.electionDate ?? "2026-11-03" })];
          if (previous?.status === "certified") continue;
          let batch: ElectionResultBatch | null;
          try { batch = readCapturedBallotpediaResults(captured, race); }
          catch (error) { failed = true; await failure(state, race.url, String(error)); continue; }
          if (!batch) { console.warn(`Ballotpedia race missing from the captured file: ${race.url}`); continue; }
          try { if (!await publish(batch, "ballotpedia")) deferred = true; }
          catch (error) { failed = true; await failure(state, race.url, String(error)); }
        }
        prior = checked(pending({ ...prior, federalRoutes: routes }, "ballotpedia", deferred), "ballotpedia", failed);
        if (!deferred && !failed) prior = { ...prior, capturedBallotpediaAt: captured.capturedAt };
        unfinished ||= deferred;
        if (visited.size && !failed) noteOutcome("ballotpedia", null);
        }
      }
      if (ballots && !ballots.length) await failure(state, `${PUBLIC_SITE_ORIGIN}/ballot`, "No served ballot is held for this state; source races remain on the fix list.");
      const standingFingerprint = createHash("sha256").update(JSON.stringify([
        ballots?.flatMap(ballot => ballot.contests.map(contest => contest.id)).sort(), [...covered].sort(),
      ])).digest("hex");
      if (ballots && prior.standingFingerprint !== standingFingerprint) standing.push({ ballots, covered });
      prior = { ...prior, coveredContestIds: [...covered].sort(), ...(ballots ? { standingFingerprint } : {}), ballotVersion };
      if (prior.stateSummary) prior = { ...prior,
        stateSummary: refreshedResultFacts({ state: prior.stateSummary }, prior).state as BallotElectionSummary };
      feedQueue.set(state, acceptedFacts);
      await saveProgress(state, prior);
      progress.set(state, prior);
      due.push(...sourceDues(prior));
      }, input.purge);
    } catch (error) { await failure(state, `${PUBLIC_SITE_ORIGIN}/ballot`, String(error)); }
  };
  // Every state runs at once (bounded by the reader pool) beside the national task; no state waits for another state's phase.
  let nextState = 0;
  await Promise.all([nationalTask(), ...Array.from({ length: Math.min(input.stateLanes ?? STATE_LANES, states.length) }, async () => {
    while (nextState < states.length) {
      if (!more()) { unfinished = true; return; }
      await runState(states[nextState++]);
    }
  })]);
  // One work-list write for every state's standing hunts.
  if (standing.length) await ensureOpenElectionResults(workQuery, standing.flatMap(row => row.ballots), new Set(standing.flatMap(row => [...row.covered])));
  // A national check also reaches states whose own called races are not due today. Every state feed is prepared now and written together.
  const checkedNation = Object.values(nation.sourceChecks ?? {}).some(check => check.lastSucceededAt === at);
  if (!input.ballotsForState) {
    const feeds: { state: string; prior: StateProgress; held: ResultProjection; facts: BallotResultFacts; feed: StateResultFeed }[] = [];
    for (const state of states) {
      const prior: StateProgress = progress.get(state) ?? empty();
      if (!ballotVersions.get(state) || !feedQueue.has(state) && !checkedNation && !prior.readerPending) continue;
      if (!more()) { unfinished = true; await saveProgress(state, { ...prior, readerPending: true }); continue; }
      try {
        const held = await getProjection(state);
        if (!held) continue;
        const facts = refreshedResultFacts({ ...held.facts, ...feedQueue.get(state), ...nation.readerFacts }, prior, nation);
        feeds.push({ state, prior, held, facts, feed: preparedStateResultFeed(held, facts, state, at) });
      } catch (error) {
        unfinished = true;
        await saveProgress(state, { ...prior, readerPending: true });
        await failure(state, `${PUBLIC_SITE_ORIGIN}/ballot`, String(error));
      }
    }
    const store = input.feedStore ?? runnerResultFeedStore();
    const failed = new Set<string>();
    let nextFeed = 0;
    await Promise.all(Array.from({ length: Math.min(8, feeds.length) }, async () => {
      while (nextFeed < feeds.length) {
        const { state, prior, feed } = feeds[nextFeed++];
        try {
          if (prior.readerPending || prior.readerSlice?.fingerprint !== feed.fingerprint) await store.writeState(state, feed);
          if (prior.readerPending) await finishFeedFailure(state, `${PUBLIC_SITE_ORIGIN}/api/election-results?state=${state}`);
        } catch (error) {
          unfinished = true; failed.add(state);
          await failure(state, `${PUBLIC_SITE_ORIGIN}/api/election-results?state=${state}`, `Prepared results feed could not be published: ${String(error)}`);
        }
      }
    }));
    for (const { state, prior, held, facts, feed } of feeds) {
      projections.set(state, { ...held, facts, hash: feed.fingerprint }); resultHashes.set(state, feed.fingerprint); preparedStates.add(state);
      await cache.checkpoint("election-results-reader", state, { ...held, facts, hash: feed.fingerprint });
      await saveProgress(state, { ...prior, readerPending: failed.has(state), readerSlice: feed });
    }
  }
  // A capture newer than the last read is the Senate and House clock: keep the turn coming back at the Ballotpedia cadence until every captured race is certified.
  if (captured && !captured.races.every(race => progress.get(race.state)?.races[raceClockKey({ sourceId: "ballotpedia",
    sourceRaceId: ballotpediaRaceId(race.url), electionDate: race.electionDate ?? "2026-11-03" })]?.status === "certified")) {
    const next = nextElectionResultCheck({ status: "pending", lastCheckedAt: at }, doors.get("ballotpedia"), now);
    if (next) due.push(next);
  }
  for (const [source, reason] of outcomes) {
    const row = doorRows.get(source);
    if (!row || !input.doors) continue;
    try {
      await input.doors.compareAndSet(row.id, row.revision, { ...row.value, readNow: false, updatedAt: at,
        ...(reason ? { lastFailureAt: at, lastFailureReason: reason } : { lastSuccessAt: at, lastFailureReason: null }) }, at);
    } catch {
      console.warn(`Election results source clock changed during its read: ${source}; the current Admin setting is retained.`);
    }
  }
  for (const state of [...dirtyFixStates]) await saveProgress(state, progress.get(state) ?? empty());
  const previousSummary = progress.get("US")?.nationalSummary;
  const checkedSource = [...progress.values()].some(value => Object.values(value.sourceChecks ?? {}).some(check => check.lastSucceededAt === at));
  const nationalSummary = summarizeCongressResults([...progress.values()].flatMap(row => Object.values(row.federalResults ?? {})), checkedSource ? at : previousSummary?.checkedAt ?? at,
    nation.federalRoutes?.filter(route => states.includes(route.state)), previousSummary);
  const nationalFeed = { ...nationalSummary,
    statewide: { ...previousSummary?.statewide, ...Object.fromEntries([...progress].flatMap(([state, value]) =>
      value.stateSummary ? [[state, value.stateSummary]] : [])) } };
  const nationalFeedFingerprint = createHash("sha256").update(canonicalJson(nationalFeed)).digest("hex");
  let nationalFeedPending = false;
  try {
    if (progress.get("US")?.nationalFeedPending || progress.get("US")?.nationalFeedFingerprint !== nationalFeedFingerprint)
      await (input.feedStore ?? runnerResultFeedStore()).writeNation(nationalFeed);
    if (progress.get("US")?.nationalFeedPending) await finishFeedFailure("US", `${PUBLIC_SITE_ORIGIN}/api/election-results?scope=nation`);
  } catch (error) {
    unfinished = true; nationalFeedPending = true;
    await failure("US", `${PUBLIC_SITE_ORIGIN}/api/election-results?scope=nation`, `Prepared national results feed could not be published: ${String(error)}`);
  }
  await saveProgress("US", { ...progress.get("US") ?? nation, nationalSummary: nationalFeed, nationalFeedFingerprint, nationalFeedPending });
  const pendingFixRows = [...queuedFixes.values()].reduce((count, queue) => count + queue.size, 0);
  await cache.checkpoint(CLOCK_CACHE_NAMESPACE, CLOCK_CACHE_KEY, cached);
  return { ...result, reads, nextCheckAt: unfinished || pendingFixRows ? at : due.sort()[0] ?? null, fixRowsWritten, pendingFixRows };
}
