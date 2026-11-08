import { createHash } from "node:crypto";
import { electionResultClockRows, readCanonicalShelf } from "../reader/canonical.ts";
import { readGenericBallotProjection } from "../ballot/generic-projection.ts";
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
import { readBallotpediaResults, readBallotpediaCongressSummary, ballotpediaRaceId, type BallotpediaRace } from "./ballotpedia.ts";
import { PUBLIC_SITE_ORIGIN } from "../ops/origins.ts";
import { ensureOpenElectionResults, publishElectionResultBatch, raceClockKey, type ResultProgress, type ResultCounts } from "./publisher.ts";
import { matchElectionResult } from "./matcher.ts";
import { nextElectionResultCheck } from "./schedule.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import type { Persisted } from "../control-plane/repository/types.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { runtimeCivicReadCache, type CivicReadCache } from "../db/civic-read-cache.ts";
import type { ElectionResult, ElectionResultBatch } from "./types.ts";

const STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const cursorName = (state: string) => `election-results:${state}`;
const empty = (): ResultProgress => ({ races: {}, summaries: {} });
interface StateProgress extends ResultProgress {
  readonly sourceChecks?: Readonly<Record<string, { readonly checkedAt: string; readonly failed?: boolean; readonly lastSucceededAt?: string }>>;
  readonly coveredContestIds?: readonly string[];
  readonly standingFingerprint?: string;
  readonly sourceFingerprints?: Readonly<Record<string, string>>;
  readonly federalRoutes?: readonly BallotpediaRace[];
  readonly ballotVersion?: string | null;
  readonly pendingSources?: readonly string[];
  readonly pendingFixes?: readonly WorkInput[];
}
type CachedClock = { readonly position: string; readonly hashMD5: string };
const progressHash = (position: string) => createHash("md5").update(position).digest("hex");
const CLOCK_CACHE_NAMESPACE = "election-results-progress";
const CLOCK_CACHE_KEY = "source-clocks-v1";

/** Select the same promoted ballot authority readers use, restricted to one state. */
export async function servedBallots(query: Query, state: string): Promise<readonly BallotSet[]> {
  const scope = stateBallotScope("ballot-contests", state);
  const store = await readCanonicalShelf([{ recordClass: "BALLOT_CANDIDACY", scope }], async statements => {
    const results = [];
    for (const statement of statements) results.push(await query(statement.text, statement.params));
    return results;
  });
  const read = await readGenericBallotProjection(state, { store });
  if (read.kind === "NOT_RECORDED") return [];
  if (read.kind !== "PROMOTED") throw new Error(`Election results cannot read ${state}'s served ballot: ${read.kind}`);
  return Object.values(read.value.ballots).map(ballot => withCandidateTickets(withCurrentCandidacies(ballot)));
}

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
  query: Query; db: FactDb; doors?: DoorRepository; now?: Date; fetch?: typeof fetch;
  states?: readonly string[];
  /** Local test adapters supply the reader authority; no repository ballot file is used. */
  ballotsForState?: (state: string) => Promise<readonly BallotSet[]>;
  multistate?: ElectionResultBatch;
  congressSummaries?: readonly ElectionResultBatch[];
  purge?: ReaderCachePurger;
  deadlineMs?: number;
  clock?: () => number;
  cache?: CivicReadCache;
  /** Bounds all fix upserts across both sources and every state in one turn. Detectives are separate. */
  maxFixRows?: number;
}): Promise<ResultCounts & { reads: number; nextCheckAt: string | null; fixRowsWritten: number; pendingFixRows: number }> {
  const maxFixRows = input.maxFixRows ?? 100;
  if (!Number.isSafeInteger(maxFixRows) || maxFixRows < 1) throw new RangeError("maxFixRows must be a positive integer");
  let fixRowsWritten = 0;
  const now = input.now ?? new Date(), at = now.toISOString(), states = input.states ?? STATES;
  const more = () => (input.clock ?? Date.now)() < (input.deadlineMs ?? Number.POSITIVE_INFINITY);
  const result: ResultCounts = { matched: 0, unmatched: 0, ambiguous: 0, published: 0, unchanged: 0 };
  if (!more()) return { ...result, reads: 0, nextCheckAt: at, fixRowsWritten, pendingFixRows: 0 };
  let reads = 0;
  const count = (query: Query): Query => async (text, params) => {
    if (/^\s*(?:SELECT|WITH)\b/i.test(text)) reads++;
    return query(text, params);
  };
  const query = count(input.query), db: FactDb = { transaction: work => input.db.transaction(tx => work(count(tx))) };
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
  for (const row of cursorRows) {
    const name = String(row.name), state = name.slice("election-results:".length);
    ballotVersions.set(state, row.ballot_version == null ? null : String(row.ballot_version));
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
      await workList(query, { owner: "election-results" }).ensure([row]);
      writtenFixes.add(id);
      if (queue.delete(id)) dirtyFixStates.add(state);
    } else {
      queue.set(id, row); dirtyFixStates.add(state);
    }
  };
  const saveProgress = async (state: string, value: StateProgress) => {
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
  let multistateText: string | undefined, multistateFailure: unknown;
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
  // National results have their own clocks and cannot wait behind the initial state backfill.
  let nation: StateProgress = progress.get("US") ?? empty();
  const congressCertified = STATES.every(state => states.includes(state) && progress.get(state)?.sourceChecks?.ballotpedia
    && !progress.get(state)?.sourceChecks?.ballotpedia.failed && Object.entries(progress.get(state)!.races)
      .some(([key]) => key.startsWith("ballotpedia:"))) && [...progress.values()].every(prior =>
        Object.entries(prior.races).filter(([key]) => key.startsWith("ballotpedia:")).every(([, clock]) => clock.status === "certified"));
  const lastCertification = [...progress.values()].flatMap(prior => Object.entries(prior.races)
    .filter(([key]) => key.startsWith("ballotpedia:")).map(([, clock]) => clock.lastCheckedAt)).sort().at(-1);
  for (const office of ["us_senate", "us_house"] as const) {
    if (!more()) { unfinished = true; break; }
    const key = `ballotpedia:${office}`, next = sourceNext(nation, key);
    if (!nation.pendingSources?.includes(key) && congressCertified && lastCertification && (nation.sourceChecks?.[key]?.checkedAt ?? "") >= lastCertification) continue;
    if (next === null) continue;
    if (next > at) { due.push(next); continue; }
    try {
      const batch = input.congressSummaries?.find(batch => batch.summaries.some(summary => summary.chambers.some(chamber => chamber.name === office)))
        ?? await readBallotpediaCongressSummary(office, at, input.fetch, office === "us_house" &&
          ((nation.federalRoutes?.filter(race => race.office === "us_house").length ?? 0) < 435 || doors.get("ballotpedia")?.readNow === true));
      if (batch.racePages) nation = { ...nation, federalRoutes: [...new Map([
        ...nation.federalRoutes ?? [], ...batch.racePages,
      ].map(page => [ballotpediaRaceId(page.url), page])).values()] };
      const changed = await publishElectionResultBatch({ query, db, batch, ballots: [], state: "US", prior: nation, now,
        door: doors.get("ballotpedia"), purge: input.purge, more, writeFix });
      nation = checked(pending({ ...nation, ...changed.progress }, key, changed.deferred), key, Boolean(batch.catalogErrors?.length));
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
  for (const state of states) {
    if (!more()) { unfinished = true; break; }
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
    if (!sourceDue("multistate") && !sourceDue("ballotpedia")) {
      due.push(...["multistate", "ballotpedia"].flatMap(source => sourceNext(prior, source, false) ?? [])); continue;
    }
    try {
      await withBatchedReaderInvalidation(async purge => {
      let ballots: readonly BallotSet[] | undefined;
      const getBallots = async () => ballots ??= await (input.ballotsForState?.(state) ?? servedBallots(query, state));
      const covered = new Set<string>(prior.coveredContestIds);
      const publish = async (batch: ElectionResultBatch, source: string): Promise<boolean> => {
        const fingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
        const sourceFingerprints = { ...prior.sourceFingerprints };
        const eligible: ElectionResult[] = [];
        for (const race of batch.races.filter(race => race.state === state)) {
          const key = raceClockKey(race), previous = prior.races[key];
          if (previous && !doors.get(source)?.readNow && (nextElectionResultCheck(previous, doors.get(source), now) ?? "~") > at) continue;
          const { checkedAt: _at, quote: _quote, ...value } = race;
          const hash = fingerprint({ ...value, candidates: value.candidates.map(({ quote: _quote, ...candidate }) => candidate) });
          if (previous && sourceFingerprints[key] === hash && !changedBallot) {
            const nextCheckAt = nextElectionResultCheck({ ...previous, lastCheckedAt: at }, doors.get(source), now);
            prior = { ...prior, races: { ...prior.races, [key]: { ...previous, lastCheckedAt: at, nextCheckAt } } };
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
        const changed = await publishElectionResultBatch({ query, db, batch: { ...batch, races: eligible, summaries }, ballots: held,
          state, prior, now, door: doors.get(source), purge, more, writeFix });
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
      if (sourceDue("multistate")) {
        if (!more()) { prior = pending(prior, "multistate", true); unfinished = true; }
        else {
        try {
          let firstState: ElectionResultBatch | undefined;
          if (!input.multistate && multistateText === undefined) {
            if (multistateFailure) throw multistateFailure;
            try {
              firstState = await readMultiStateResults(at, input.fetch, state);
              multistateText = firstState.evidence.text;
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
      if (sourceDue("ballotpedia")) {
        if (!more()) { prior = pending(prior, "ballotpedia", true); unfinished = true; }
        else {
        const visited = new Set<string>();
        let failed = false, deferred = false;
        const routes = federalRoutes(catalog, prior.federalRoutes ?? (await getBallots()).filter(row => row.election.date === "2026-11-03")
          .flatMap(ballot => ballot.contests.flatMap(contest => federalRace(ballot, contest) ?? [])));
        for (const race of routes) {
          if (!more()) { deferred = true; break; }
          if (!race || visited.has(race.url)) continue;
          visited.add(race.url);
          const previous = prior.races[raceClockKey({ sourceId: "ballotpedia", sourceRaceId: ballotpediaRaceId(race.url), electionDate: race.electionDate ?? "2026-11-03" })];
          if (previous?.status === "certified" || previous && !doors.get("ballotpedia")?.readNow &&
            (nextElectionResultCheck(previous, doors.get("ballotpedia"), now) ?? "~") > at) continue;
          try { if (!await publish(await readBallotpediaResults(race, at, input.fetch), "ballotpedia")) deferred = true; }
          catch (error) { failed = true; await failure(state, race.url, String(error)); }
        }
        prior = checked(pending({ ...prior, federalRoutes: routes }, "ballotpedia", deferred), "ballotpedia", failed);
        unfinished ||= deferred;
        if (visited.size && !failed) noteOutcome("ballotpedia", null);
        }
      }
      if (ballots && !ballots.length) await failure(state, `${PUBLIC_SITE_ORIGIN}/ballot`, "No served ballot is held for this state; source races remain on the fix list.");
      const standingFingerprint = createHash("sha256").update(JSON.stringify([
        ballots?.flatMap(ballot => ballot.contests.map(contest => contest.id)).sort(), [...covered].sort(),
      ])).digest("hex");
      if (ballots && prior.standingFingerprint !== standingFingerprint) await ensureOpenElectionResults(query, ballots, covered);
      prior = { ...prior, coveredContestIds: [...covered].sort(), ...(ballots ? { standingFingerprint } : {}), ballotVersion };
      await saveProgress(state, prior);
      progress.set(state, prior);
      due.push(...["multistate", "ballotpedia"].flatMap(source => sourceNext(prior, source, false) ?? []));
      }, input.purge);
    } catch (error) { await failure(state, `${PUBLIC_SITE_ORIGIN}/ballot`, String(error)); }
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
  const pendingFixRows = [...queuedFixes.values()].reduce((count, queue) => count + queue.size, 0);
  await cache.checkpoint(CLOCK_CACHE_NAMESPACE, CLOCK_CACHE_KEY, cached);
  return { ...result, reads, nextCheckAt: unfinished || pendingFixRows ? at : due.sort()[0] ?? null, fixRowsWritten, pendingFixRows };
}
