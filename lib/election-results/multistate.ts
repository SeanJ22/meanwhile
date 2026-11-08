import { createHash } from "node:crypto";
import type { ElectionResult, ElectionResultBatch, ElectionResultStatus, ElectionSummary, ResultSource } from "./types.ts";

export const MULTISTATE_RESULTS_URL = "https://multistate.us/elections/data/live_results_general_2026.json";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const list = (value: unknown): ObjectValue[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const number = (value: unknown): number | undefined => value !== null && value !== "" && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : undefined;
const optionalNumber = (key: string, value: unknown) => number(value) === undefined ? {} : { [key]: number(value) };

/** Keep exact source substrings while reading the JSON once, including pretty-printed sources. */
function sourceObjects(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const stack: { start: number; seat?: string; id?: string; state?: string; candidate?: string; measure?: boolean; race?: boolean; election?: string; type?: string }[] = [];
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (char === "{") stack.push({ start: at });
    else if (char === "}") {
      const entry = stack.pop();
      if (entry) {
        // A seatless special can list its primary after its general results.
        // Only the general contest identifies the source evidence for that race.
        if (entry.election && /^General(?:_Runoff)?$/.test(entry.type ?? "")) {
          const race = stack.findLast(item => item.race);
          if (race) race.election = entry.election;
          found.set(`contest:${entry.election}`, source.slice(entry.start, at + 1));
        }
        const key = entry.seat ? `race:${entry.seat}` : entry.race && entry.election ? `election:${entry.election}` : entry.measure && entry.id ? `measure:${entry.id}` : entry.state ? `summary:${entry.state}` : entry.candidate ? `candidate:${entry.candidate}` : null;
        if (key && (!found.has(key) || key.startsWith("candidate:"))) found.set(key, source.slice(entry.start, at + 1));
      }
    } else if (char === '"') {
      const start = at++;
      for (; at < source.length; at++) {
        if (source[at] === "\\") at++;
        else if (source[at] === '"') break;
      }
      let after = at + 1;
      while (/\s/.test(source[after] ?? "") && after < source.length) after++;
      if (source[after] !== ":" || !stack.length) continue;
      const key = JSON.parse(source.slice(start, at + 1)) as string;
      const entry = stack[stack.length - 1];
      if (key === "measure_number") entry.measure = true;
      if (key === "office") entry.race = true;
      if (key === "seat_id" || key === "id" || key === "st" || key === "candidate_id" || key === "election_id" || key === "type") {
        const match = /^\s*("(?:[^"\\]|\\.)*"|\d+)/.exec(source.slice(after + 1));
        if (!match) continue;
        const value = String(JSON.parse(match[1]));
        if (key === "seat_id") entry.seat = value;
        else if (key === "id") entry.id = value;
        else if (key === "st") entry.state = value;
        else if (key === "candidate_id") entry.candidate = value;
        else if (key === "type") entry.type = value;
        else entry.election = value;
      }
    }
  }
  return found;
}

function arrayText(source: string, key: string): string {
  const field = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(source);
  if (!field) return "[]";
  const start = field.index + field[0].length - 1;
  const tokens = /"(?:[^"\\]|\\.)*"|[\[\]]/g;
  tokens.lastIndex = start;
  let depth = 0;
  for (let token = tokens.exec(source); token; token = tokens.exec(source)) {
    if (token[0] === "[") depth++;
    else if (token[0] === "]" && --depth === 0) return source.slice(start, token.index + 1);
  }
  throw new Error(`MultiState ${key} source array is incomplete`);
}

/** Select every event for a state before JSON.parse, regardless of source ordering. */
function stateObjectTexts(array: string, state: string | undefined, key: string): string[] {
  const tokens = /"(?:[^"\\]|\\.)*"|[{}]/g;
  const selectedObjects: string[] = [];
  let depth = 0, start = 0, selected = false;
  for (let token = tokens.exec(array); token; token = tokens.exec(array)) {
    if (token[0] === "{") { if (depth++ === 0) { start = token.index; selected = state === undefined; } }
    else if (token[0] === "}") { if (--depth === 0 && selected) selectedObjects.push(array.slice(start, token.index + 1)); }
    else if (depth === 1 && JSON.parse(token[0]) === key) {
      const value = /^\s*:\s*"([^"\\]*)"/.exec(array.slice(token.index + token[0].length));
      if (value?.[1] === state) selected = true;
    }
  }
  return selectedObjects;
}
const stateObjectText = (array: string, state: string, key: string): string | undefined => stateObjectTexts(array, state, key)[0];

function office(value: string): string {
  if (/^lt\.? governor$/i.test(value)) return "lieutenant_governor";
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function status(value: unknown, race: ObjectValue, candidates: ObjectValue[]): ElectionResultStatus {
  if (value === "Certified") return "certified";
  if (race.has_pending_runoff === true || candidates.some(candidate => candidate.result === "Runoff")) return "runoff";
  if (value === "Called") return /^(uncontested|deemed_elected)$/.test(text(race.result_status_source)) ? "unopposed" : "called";
  if (value === "Counting") return "counting";
  return "pending";
}
function credits(value: unknown): ResultSource[] {
  if (value === "sos") return [{ name: "State election office (sos)" }];
  if (value === "ap_feed") return [{ name: "Associated Press (ap_feed)" }];
  return typeof value === "string" && value ? [{ name: value }] : [];
}
function seats(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(object(value)).flatMap(([party, count]) => number(count) === undefined ? [] : [[party, number(count)!]]));
}

/** Parses only general_events, never the primary-election `events` lookalike. */
export function parseMultiStateResults(sourceText: string, checkedAt: string, electionDate = "2026-11-03", stateSelector?: string): ElectionResultBatch {
  const state = stateSelector?.toUpperCase(), eventsText = arrayText(sourceText, "general_events");
  const eventTexts = stateObjectTexts(eventsText, state, "state");
  const scoreText = state ? stateObjectText(arrayText(sourceText, "states"), state, "st")
    ?? stateObjectText(arrayText(sourceText, "special_only"), state, "st") : undefined;
  if (state && !eventTexts.length) throw new Error(`MultiState state is missing: ${state}`);
  const document = state ? { general_events: eventTexts.map(event => JSON.parse(event)), scorecard: { states: scoreText ? [JSON.parse(scoreText)] : [] } }
    : object(JSON.parse(sourceText));
  if (!Array.isArray(document.general_events)) throw new Error("MultiState general_events is missing");
  const summaryQuotes = sourceObjects(state ? scoreText ?? "{}" : sourceText);
  const source = { name: "MultiState", url: MULTISTATE_RESULTS_URL };
  const races: ElectionResult[] = [], summaries: ElectionSummary[] = [];
  const scoreStates = [...list(object(document.scorecard).states), ...list(object(document.scorecard).special_only)];
  for (const [eventIndex, event] of list(document.general_events).entries()) {
    const state = text(event.state).toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) throw new Error("MultiState state is missing");
    const quotes = sourceObjects(eventTexts[eventIndex] ?? eventsText);
    for (const race of [...list(event.statewide_races), ...list(event.races)]) {
      if (text(race.election_date) !== electionDate) continue;
      const general = list(object(race.general_results).contests).filter(contest => /^General(?:_Runoff)?$/.test(text(contest.type)));
      if (general.length !== 1) throw new Error(`MultiState general results changed shape: ${state} ${race.seat_id}`);
      const result = general[0], candidates = list(result.candidates), flipped = object(race.flipped_seat);
      const hasSeat = race.seat_id !== undefined && race.seat_id !== null;
      const sourceObjectId = String(hasSeat ? race.seat_id : result.election_id);
      const sourceRaceId = hasSeat ? sourceObjectId : `election:${sourceObjectId}`;
      const quote = quotes.get(`${hasSeat ? "race" : "election"}:${sourceObjectId}`);
      if (!quote) throw new Error(`MultiState source evidence missing: ${sourceRaceId}`);
      const raceQuotes = sourceObjects(quote);
      const candidateQuotes = sourceObjects(raceQuotes.get(`contest:${result.election_id}`) ?? quote);
      races.push({ sourceId: "multistate", sourceName: source.name, sourceUrl: source.url, creditedSources: credits(result.vote_source ?? race.vote_source),
        sourceRaceId, state, office: office(text(race.office)), officeName: text(race.office),
        ...(race.district !== undefined ? { districtHint: String(race.district) } : {}), electionDate,
        status: status(result.result_status ?? race.result_status, race, candidates),
        ...optionalNumber("percentCounted", result.votes_pct_in),
        ...(text(race.result_status_set_at) ? { statusChangedAt: text(race.result_status_set_at) } : {}),
        ...optionalNumber("seatsToFill", race.num_seats ?? race.seats_up),
        ...(race.flipped_seat === undefined ? {} : { flipped: Boolean(race.flipped_seat) }), ...(text(flipped.to) ? { gainedByParty: text(flipped.to) } : {}),
        ...(typeof race.incumbent_defeated === "boolean" ? { incumbentLost: race.incumbent_defeated } : {}),
        candidates: candidates.map(candidate => ({ name: text(candidate.name), ...(text(candidate.party) ? { party: text(candidate.party) } : {}),
          ...optionalNumber("votes", candidate.votes), ...optionalNumber("percent", candidate.pct),
          won: candidate.result === "Won", runoff: candidate.result === "Runoff",
          ...(candidateQuotes.has(`candidate:${candidate.candidate_id}`) ? { quote: candidateQuotes.get(`candidate:${candidate.candidate_id}`) } : {}) })), checkedAt, quote });
    }
    for (const measure of list(event.ballot_measures)) {
      if (text(measure.election_date) !== electionDate) continue;
      const sourceRaceId = String(measure.id), quote = quotes.get(`measure:${sourceRaceId}`);
      if (!quote) throw new Error(`MultiState measure evidence missing: ${sourceRaceId}`);
      const outcome = measure.result === "Passed" ? "passed" : measure.result === "Failed" ? "failed" : "counting";
      races.push({ sourceId: "multistate", sourceName: source.name, sourceUrl: source.url, creditedSources: credits(measure.vote_source),
        sourceRaceId, state, office: "measure", officeName: text(measure.measure_number), electionDate,
        status: status(measure.result_status, measure, []), candidates: [],
        measure: { name: text(measure.short_title), ...(text(measure.measure_number) ? { number: text(measure.measure_number) } : {}),
          ...optionalNumber("yesVotes", measure.votes_yes), ...optionalNumber("noVotes", measure.votes_no),
          ...optionalNumber("yesPercent", measure.yes_percentage), outcome }, checkedAt, quote });
    }
    const score = scoreStates.find(row => row.st === state);
    if (score) {
      const statewide = list(score.statewide), governor = statewide.find(row => row.office === "Governor");
      const governorElection = governor || list(event.statewide_races).some(race => race.office === "Governor" && race.election_date === electionDate);
      const primaryText = stateObjectText(arrayText(sourceText, "events"), state, "state");
      const governorQuote = primaryText ? /"gov_status"\s*:\s*(\{[^{}]*\})/.exec(primaryText)?.[1] : undefined;
      const heldGovernorParty = governorQuote ? text(object(JSON.parse(governorQuote)).gov_party) : "";
      const chambers = list(score.chambers).map(chamber => ({ name: text(chamber.name),
        seatsBefore: seats(object(chamber.before).composition), seatsNow: seats(object(chamber.after).composition),
        stillCounting: number(chamber.counting) ?? 0, controlBefore: text(object(chamber.before).control) || null,
        controlNow: text(object(chamber.after).control) || null }));
      for (const [name, value] of Object.entries(object(event.legislature))) {
        const held = object(value);
        if (!chambers.some(chamber => chamber.name === name) && held.seats_up_2026 === 0) chambers.push({ name,
          seatsBefore: seats(held.composition), seatsNow: seats(held.composition), stillCounting: 0,
          controlBefore: text(held.control) || null, controlNow: text(held.control) || null });
      }
      summaries.push({ state, chambers,
        governor: { before: text(governor?.prev) || heldGovernorParty || null,
          now: governorElection ? text(governor?.win) || null : heldGovernorParty || null },
        statewideOfficesFlipped: statewide.filter(row => row.cls === "flip").map(row => ({ office: text(row.office), from: text(row.prev), to: text(row.win) })),
        source, creditedSources: [], checkedAt, quote: summaryQuotes.get(`summary:${state}`) ?? "",
        ...(governorQuote && (!governor || !text(governor.prev)) ? { quotes: [summaryQuotes.get(`summary:${state}`) ?? "", governorQuote] } : {}) });
    }
  }
  return { source, races, summaries, evidence: { text: sourceText, contentType: "application/json", contentHash: createHash("sha256").update(sourceText).digest("hex") } };
}

export async function readMultiStateResults(checkedAt: string, fetcher: typeof fetch = fetch, state?: string): Promise<ElectionResultBatch> {
  const response = await fetcher(MULTISTATE_RESULTS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`MultiState HTTP ${response.status}`);
  return parseMultiStateResults(await response.text(), checkedAt, "2026-11-03", state);
}
