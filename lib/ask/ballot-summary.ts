import type { Candidacy, Contest, Election } from "../ballot/types.ts";
import { officeIdentity, type OfficeKey } from "../officials/office-identity.ts";
import { normalizeName } from "../routing/exact-name.ts";
import { formatDateLong } from "../text/format-date.ts";
import { candidacyDisplayName, measureDesignations, type AskNominee } from "./ballot-inventory.ts";
import type { EvidenceRecord } from "./evidence.ts";

/**
 * **"WHAT IS ON MY BALLOT?" AND "WHO IS RUNNING FOR STATE SENATE IN MY
 * DISTRICT?" ARE THE BALLOT WE HOLD FOR THE READER'S DIVISIONS.** (2026-09-29, S3.)
 *
 * Measured on staging that day, at 85635 and 85641, both questions returned no
 * answer: the first names nothing, and the second names an OFFICE ("state senate")
 * where the binder wants a contest's own title ("State Senator, District 19"). §0
 * lists "what is on the ballot to keep or replace them" among the things a
 * resident must see. So the two are read from their words and answered from the
 * contests the reader's own divisions reach — the same contests `/ballot` renders.
 *
 * - **The summary** counts the races and the measures and names them: each race by
 *   its own title, each measure by its designation ("Proposition 141").
 * - **An office's field** names every contest of that office the reader's divisions
 *   reach — two, for a ZIP that reaches two districts — with its candidates and
 *   parties as the certified lineup (or, where none is held, the filing) records
 *   them. The contest's own sentence (its election, its date, how many seats, its
 *   term, the source's scope note) is the record's, verbatim, and so is the
 *   qualification that the nominees come from the certified canvass.
 *
 * The composed prose faces the same validator a model answer does. A contest with
 * no candidate held says so as a gap of ours, never as "no one is running".
 */

export type BallotAsk =
  | { kind: "SUMMARY" }
  | { kind: "OFFICE"; key: OfficeKey | null; phrase: string };

/** Written against `normalizeName`. */
const SUMMARY_FORMS: readonly RegExp[] = [
  /^what (?:s|is|will be|are) on (?:my|the) ballot(?: (?:for me|near me|in my area|this year|this november|in november))?$/,
  /^what (?:races|contests|offices|measures|propositions|questions|issues|things) (?:are|will be) on (?:my|the) ballot(?: (?:this year|this november|in november|near me))?$/,
  /^what (?:am|will) i (?:be )?voting (?:on|for)(?: (?:this year|this november|in november))?$/,
  /^what do i (?:vote|get to vote) (?:on|for)(?: (?:this year|this november|in november))?$/,
  /^(?:show|list|tell) me (?:what is on )?my ballot$/,
  /^what(?: s| is) on the ballot(?: (?:for me|near me|in my area|this year|this november))?$/,
];

/** Office words a reader uses, closed, mapped to the ballot's own office vocabulary. */
const OFFICE_WORDS: readonly { readonly pattern: RegExp; readonly key: OfficeKey }[] = [
  { pattern: /^(?:the )?governor$/, key: "governor" },
  { pattern: /^(?:the )?secretary of state$/, key: "secretary_of_state" },
  { pattern: /^(?:the )?attorney general$/, key: "attorney_general" },
  { pattern: /^(?:the )?(?:state )?treasurer$/, key: "state_treasurer" },
  { pattern: /^(?:the )?(?:state )?superintendent(?: of public instruction)?$/, key: "superintendent_of_public_instruction" },
  { pattern: /^(?:the )?(?:state )?mine inspector$/, key: "state_mine_inspector" },
  { pattern: /^(?:the )?corporation commission(?:er)?s?$/, key: "corporation_commissioner" },
  { pattern: /^(?:congress|(?:the )?(?:u s |us |united states )?house(?: of representatives)?|(?:the )?(?:u s |us |united states )?representative|(?:a )?congressional seat|(?:the )?house seat)$/, key: "us_representative" },
  { pattern: /^(?:the )?(?:u s |us |united states )senate$|^(?:u s |us |united states )senator$/, key: "us_senator" },
  { pattern: /^(?:the )?state senate(?: seat)?$|^(?:the )?state senator$/, key: "state_senator" },
  { pattern: /^(?:the )?state house(?: seat)?$|^(?:the )?state representative$|^(?:the )?state legislature$/, key: "state_lower_house" },
];

const OFFICE_FORMS: readonly RegExp[] = [
  /^who (?:is|s|are) running for (.+?)(?: (?:in|for) my (?:district|area|zip|zip code|ballot)| (?:on|in) my ballot| near me| in my area)?$/,
  /^who (?:is|s|are) on the ballot for (.+?)(?: (?:in|for) my (?:district|area|zip|zip code)| near me| in my area)?$/,
  /^who (?:are|is) the candidates? for (.+?)(?: (?:in|for) my (?:district|area|zip|zip code)| near me| in my area)?$/,
];

/** A scheduling hint only: a local title is confirmed against held contests later. */
export function ballotQuestionHint(question: string): boolean {
  const normalized = normalizeName(question);
  return Boolean(normalized && normalized.length <= 100 &&
    [...SUMMARY_FORMS, ...OFFICE_FORMS].some(form => form.test(normalized)));
}

/** The ballot question this is, or null. Nothing is bound here; an office the table does not hold is the model's. */
export function ballotQuestionShape(question: string, contests: readonly Contest[] = []): BallotAsk | null {
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 100) return null;
  if (SUMMARY_FORMS.some((form) => form.test(normalized))) return { kind: "SUMMARY" };
  for (const form of OFFICE_FORMS) {
    const phrase = form.exec(normalized)?.[1]?.trim();
    if (!phrase) continue;
    const found = OFFICE_WORDS.find((entry) => entry.pattern.test(phrase));
    if (found) return { kind: "OFFICE", key: found.key, phrase };
    if (contestsForOfficePhrase(contests, phrase).length > 0) return { kind: "OFFICE", key: null, phrase };
  }
  return null;
}

/** An office named by this ballot, including local offices outside the synonym table. */
export function contestsForOfficePhrase(contests: readonly Contest[], phrase: string): Contest[] {
  const words = (value: string) => normalizeName(value).replace(/\b(members?|of|the|for|a|an|seat)\b/g, " ")
    .replace(/\bcommissioners\b/g, "commissioner").replace(/\s+/g, " ").trim();
  const requested = words(phrase);
  if (!requested) return [];
  const exact = contests.filter(contest => contest.type === "CANDIDACY" && words(contest.title) === requested);
  if (exact.length) return exact;
  const tokens = requested.split(" ");
  return contests.filter(contest => {
    if (contest.type !== "CANDIDACY") return false;
    const title = words(contest.title).split(" ");
    // A publisher can omit the place from an office title. The contest's
    // division supplies that place, without accepting a different county.
    const place = [...contest.ocdId.matchAll(/\/(county|place|school_district|special_district):([^/]+)/g)]
      .flatMap(match => words(`${match[2].replaceAll("_", " ")} ${match[1].replaceAll("_", " ")}`).split(" "));
    return tokens.some(token => title.includes(token)) && tokens.every(token => title.includes(token) || place.includes(token));
  });
}

export function contestsForBallotAsk(contests: readonly Contest[], ask: Extract<BallotAsk, { kind: "OFFICE" }>): Contest[] {
  return ask.key === null ? contestsForOfficePhrase(contests, ask.phrase) : contestsOfOffice(contests, ask.key);
}

/** The contests of one office, in the ballot's own vocabulary. */
export function contestsOfOffice(contests: readonly Contest[], key: OfficeKey): Contest[] {
  return contests.filter((contest) => contest.type === "CANDIDACY" && officeIdentity(contest.title) === key);
}

/** "United States" for "U.S.": the length contract counts every "U.S. " as a sentence end. */
const spelled = (text: string): string => text.replace(/\bU\.S\./g, "United States");

const list = (items: readonly string[]): string =>
  items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;

/** A contest as a light record: its own title, its election and its source. */
function contestRecord(contest: Contest, election: Election): EvidenceRecord {
  return {
    kind: "CONTEST", id: contest.id, subjectId: null,
    text: `${contest.title} appears on this ballot for ${election.name}${electionDate(election)}.`,
    occurredAt: election.date,
    sourceUrl: contest.provenance?.sourceUrl ?? null, sourceOrg: contest.provenance?.sourceOrg ?? null, retrievedAt: contest.provenance?.collectedAt ?? null,
  };
}

export interface BallotComposition {
  answer: string;
  citedUrls: string[];
  records: EvidenceRecord[];
  /** Gaps of ours the answer states. */
  gaps: string[];
}

/** "the 2026 General Election": the election's own name, with its article. */
const electionDate = (election: Election): string => election.date ? ` on ${formatDateLong(election.date) ?? election.date}` : "";
const electionName = (election: Election): string => /^the /i.test(election.name) ? election.name : `the ${election.name}`;

/** The measure's designation ("Proposition 141") or its title when it has none. */
const measureName = (title: string): string => measureDesignations(title)[0] ?? title.split(":")[0]!.trim();

/**
 * The reader's ballot in one sentence per kind: how many races and measures, each
 * race by its title, each measure by its designation. Null when the reader's
 * divisions reach no contest we hold.
 */
export function composeBallotSummary(input: { contests: readonly Contest[]; election: Election }): BallotComposition | null {
  const races = input.contests.filter((contest) => contest.type !== "MEASURE");
  const measures = input.contests.filter((contest) => contest.type === "MEASURE");
  if (races.length + measures.length === 0) return null;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const sentences = [`Your ballot for ${electionName(input.election)}${electionDate(input.election)} has ${count(races.length, "race", "races")} and ${count(measures.length, "ballot measure", "ballot measures")}`];
  if (races.length > 0) sentences.push(`The races are ${list(races.map((race) => spelled(race.title)))}`);
  if (measures.length > 0) sentences.push(`The measures are ${list(measures.map((measure) => measureName(measure.title)))}`);
  const records = [...races, ...measures].map((contest) => contestRecord(contest, input.election));
  return { answer: `${sentences.join(". ")}.`, citedUrls: [...new Set(records.flatMap((record) => record.sourceUrl ? [record.sourceUrl] : []))], records, gaps: [] };
}

export interface OfficeFieldInput {
  contests: readonly Contest[];
  election: Election;
  /** The certified lineup for a contest, where one is held. */
  nominees: (contestId: string) => readonly AskNominee[];
  /** The filed candidacies, used only for a contest with no certified lineup. */
  candidacies: readonly Candidacy[];
  /** Filing ids a removal names: a candidate the current filing no longer lists is not a candidate. */
  removedCandidacyIds: ReadonlySet<string>;
}

/**
 * Every contest of an office the reader's divisions reach, with its candidates.
 * Null when the ballot holds no such contest (the caller says so as a gap of ours).
 */
export function composeOfficeField(input: OfficeFieldInput & { key: OfficeKey | null; phrase?: string }): BallotComposition | null {
  const matched = input.key === null ? contestsForOfficePhrase(input.contests, input.phrase ?? "") : contestsOfOffice(input.contests, input.key);
  if (matched.length === 0) return null;
  const records: EvidenceRecord[] = [];
  const gaps: string[] = [];
  const clauses: string[] = [];
  for (const contest of matched) {
    const lineup = input.nominees(contest.id);
    const fielded = lineup.length > 0
      ? lineup.map((nominee) => ({ name: nominee.name, party: nominee.partyLabel ?? null, url: nominee.sourceUrl ?? null, org: nominee.sourceOrg ?? null, at: nominee.retrievedAt ?? null }))
      : input.candidacies.filter((candidacy) => candidacy.contestId === contest.id && !input.removedCandidacyIds.has(candidacy.id))
        .map((candidacy) => ({ name: candidacyDisplayName(candidacy), party: candidacy.partyLabel, url: candidacy.provenance?.sourceUrl ?? null, org: candidacy.provenance?.sourceOrg ?? null, at: candidacy.provenance?.collectedAt ?? null }));
    records.push(contestRecord(contest, input.election));
    const title = spelled(contest.title);
    if (fielded.length === 0) {
      const statement = `We have not recorded who is running for ${title}.`;
      gaps.push(statement);
      clauses.push(statement.slice(0, -1).replace(/^We/, "we"));
      continue;
    }
    for (const candidate of fielded) {
      records.push({
        kind: "CANDIDACY", id: `${contest.id}|${candidate.name}`,
        text: `${candidate.name} is on the ballot for ${contest.title}${candidate.party ? `, filed as ${candidate.party}` : ""}.`,
        sourceUrl: candidate.url, sourceOrg: candidate.org, retrievedAt: candidate.at,
      });
    }
    clauses.push(`${title}: ${list(fielded.map((candidate) => candidate.party ? `${candidate.name} (${candidate.party})` : candidate.name))}`);
  }
  const lead = `On your ballot for ${electionName(input.election)}${electionDate(input.election)}`;
  const answer = `${lead}, ${clauses.join("; ")}.`;
  return { answer, citedUrls: [...new Set(records.flatMap((record) => record.sourceUrl ? [record.sourceUrl] : []))], records, gaps };
}
