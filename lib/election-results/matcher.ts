import { ballotCandidateDisplayName } from "../ballot/name-case.ts";
import type { BallotSet, Candidacy, Contest, Measure } from "../ballot/types.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import type { ElectionResult } from "./types.ts";

export type ElectionMatch = {
  readonly kind: "matched";
  readonly contest: Contest;
  readonly candidates: readonly { readonly resultIndex: number; readonly candidacy: Candidacy }[];
  readonly measure?: Measure;
  readonly unmatchedCandidates: readonly number[];
  readonly ambiguousCandidates: readonly number[];
} | {
  readonly kind: "unmatched" | "ambiguous";
  readonly contestIds: readonly string[];
  readonly reason: string;
};

type ServedBallot = Pick<BallotSet, "election" | "contests" | "candidacies" | "measures">;
const key = (value: string): string => value.normalize("NFKC").toLocaleLowerCase("en-US")
  .replace(/[.’'`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const nameKey = (value: string): string => key(ballotCandidateDisplayName({ givenName: "", familyName: value }));
const aliases: Readonly<Record<string, string>> = {
  us_senator: "us_senate", us_representative: "us_house", state_senator: "state_senate",
  state_lower_house: "state_house", state_treasurer: "treasurer", state_auditor: "auditor",
  state_legislature: "state_senate",
  governor_and_lieutenant_governor: "governor",
};
const stateOfficeAliases: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  AL: { "commissioner of agriculture and industries": "agriculture_commissioner" },
  DE: { "auditor of accounts": "auditor" },
  FL: { "chief financial officer": "treasurer" },
  GA: { "insurance and fire safety commissioner": "insurance_commissioner", "state school superintendent": "superintendent_of_public_instruction" },
  IN: { "state comptroller auditor of state": "auditor", "treasurer of state": "treasurer" },
  IA: { "secretary of agriculture": "agriculture_commissioner", "treasurer of state": "treasurer" },
  NE: { "auditor of public accounts": "auditor" },
  OH: { "treasurer of state": "treasurer" },
  SC: { "state superintendent of education": "superintendent_of_public_instruction" },
  TX: { "comptroller of public accounts": "state_comptroller" },
  VT: { "auditor of accounts": "auditor" },
};
const officeTitle = (office: string): string => office.replace(/_/g, " ")
  .replace(/\bunexpired\s+(?:\d+\s*[- ]?\s*year\s+)?term\b/gi, " ")
  .replace(/\s*[—–-]\s*special\s+election\b/gi, " ")
  .replace(/\b(?:place|seat|position)\s+(?:no\.?\s*)?\d+\b/gi, " ").trim();
const officeKey = (office: string, state: string): string => {
  const title = officeTitle(office);
  const normalized = stateOfficeAliases[state]?.[key(title)] ?? officeIdentity(title) ?? key(title).replaceAll(" ", "_");
  return aliases[normalized] ?? normalized;
};

function contestOffice(contest: Contest): string | null {
  if (contest.type === "MEASURE") return "measure";
  const state = /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/i.exec(contest.ocdId)?.[1]?.toUpperCase() ?? "";
  const statewide = /\/(?:state|district|territory):[a-z]{2}$/i.test(contest.ocdId);
  const held = officeIdentity(officeTitle(contest.title), contest.ocdId);
  if (statewide) return officeKey(contest.title, state);
  if (held) return officeKey(held, state);
  // Named legislative districts are ordinary; their names are not office names.
  const district = /\/(sldl|sldu|cd):/.exec(contest.ocdId)?.[1];
  if (district === "cd" && /\b(?:congress|representative|house)\b/i.test(contest.title)) return "us_house";
  if (district === "sldu" && /\b(?:senat(?:e|or)|legislature)\b/i.test(contest.title)) return "state_senate";
  if (district === "sldl" && /\b(?:house|representative|assembly|delegate|legislature)\b/i.test(contest.title)) return "state_house";
  return null;
}

function names(candidate: Candidacy, office: string): ReadonlySet<string> {
  const person = office === "lieutenant_governor" && candidate.ticket ? candidate.ticket.runningMate : candidate;
  const values = [ballotCandidateDisplayName({ ...person, ticket: undefined }), person.filing?.publishedName,
    ...person.aliases?.flatMap(alias => alias.includes("|") ? [alias.slice(alias.lastIndexOf("|") + 1)] : []) ?? []];
  if (office === "governor") values.push(ballotCandidateDisplayName(person));
  return new Set(values.filter((value): value is string => !!value?.trim()).map(nameKey));
}

function sourceName(name: string, office: string): string {
  // The source can print the joint choice as two full names. The governor is its lead.
  return nameKey(office === "governor" ? name.split(/\s*\/\s*|\s+and\s+|\s*&\s*/i)[0] : name);
}

function districtHint(contest: Contest, hint: string | undefined): boolean {
  if (!hint?.trim()) return false;
  const clean = (value: string) => key(value).replace(/\b(?:district|dist|no)\b/g, " ")
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1").replace(/\s+/g, " ").trim();
  const wanted = clean(hint), division = decodeURIComponent(contest.ocdId.split(":").at(-1) ?? "");
  const titleHint = /\b(?:district|dist\.?)\s+(.+)$/i.exec(contest.title)?.[1];
  return [division, titleHint].some(value => value !== undefined && clean(value) === wanted);
}

function measureMatch(result: ElectionResult, contest: Contest, ballot: ServedBallot): readonly Measure[] {
  if (!result.measure) return [];
  const designation = (value: string): string => {
    const normalized = key(value);
    const number = /\b(proposition|prop|question|measure|referendum|amendment|initiative)\s+(?:(?:no|number)\s*)?([a-z]|\d+)\b/.exec(normalized);
    return number ? `${number[1] === "prop" ? "proposition" : number[1]} ${number[2]}` : normalized;
  };
  const published = [result.measure.name, result.measure.number].filter((value): value is string => !!value);
  const designations = new Set(published.flatMap(value => [key(value), designation(value)]));
  return ballot.measures.filter(measure => {
    const officialNumber = measure.officialNumber;
    return measure.contestId === contest.id &&
    ([contest.title, officialNumber].some(value => value !== undefined &&
      (designations.has(key(value)) || designations.has(designation(value)))) ||
      // A bare official number belongs to this state's measure; no candidate district is consulted.
      !!officialNumber && /^\d+$/.test(key(officialNumber)) && published.some(value =>
        /\b(?:proposition|prop|question|measure|referendum|amendment|initiative)\s+(?:(?:no|number)\s*)?(\d+)\b/.exec(key(value))?.[1] === key(officialNumber)));
  });
}

/** Only the ballot currently served is supplied here. Full names establish identity; district labels only help a tie. */
export function matchElectionResult(result: ElectionResult, ballot: ServedBallot): ElectionMatch {
  if (ballot.election.state.toUpperCase() !== result.state.toUpperCase() || ballot.election.date !== result.electionDate)
    return { kind: "unmatched", contestIds: [], reason: "STATE_OR_ELECTION_MISMATCH" };
  const office = officeKey(result.office, result.state.toUpperCase());
  const eligible = ballot.contests.filter(contest => {
    const state = /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/i.exec(contest.ocdId)?.[1];
    return state?.toUpperCase() === result.state.toUpperCase() && contest.electionId === ballot.election.id &&
      contestOffice(contest) === office && (office !== "measure" || /\/(?:state|district|territory):[a-z]{2}$/i.test(contest.ocdId));
  });
  if (office === "measure") {
    const matches = eligible.flatMap(contest => measureMatch(result, contest, ballot).map(measure => ({ contest, measure })));
    if (matches.length !== 1) return { kind: matches.length ? "ambiguous" : "unmatched", contestIds: [...new Set(matches.map(row => row.contest.id))],
      reason: matches.length ? "MEASURE_IDENTITY_TIE" : "MEASURE_NOT_ON_SERVED_BALLOT" };
    return { kind: "matched", ...matches[0], candidates: [], unmatchedCandidates: [], ambiguousCandidates: [] };
  }
  const scored = eligible.map(contest => {
    const candidates = ballot.candidacies.filter(candidate => candidate.contestId === contest.id);
    const resolved = result.candidates.map((candidate, resultIndex) => {
      const wanted = sourceName(candidate.name, office);
      const found = /^(?:write ins?|other|scattering|none of (?:these|the above))$/.test(wanted) ? []
        : candidates.filter(candidate => names(candidate, office).has(wanted));
      return { resultIndex, found };
    });
    return { contest, resolved, score: resolved.filter(row => row.found.length > 0).length,
      hint: districtHint(contest, result.districtHint) ? 1 : 0 };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || b.hint - a.hint);
  const first = scored[0];
  if (!first) return { kind: "unmatched", contestIds: eligible.map(row => row.id), reason: "FULL_CANDIDATE_NAMES_NOT_MATCHED" };
  const tied = scored.filter(row => row.score === first.score && row.hint === first.hint);
  if (tied.length > 1) return { kind: "ambiguous", contestIds: tied.map(row => row.contest.id), reason: "CONTEST_IDENTITY_TIE" };
  return { kind: "matched", contest: first.contest,
    candidates: first.resolved.flatMap(row => row.found.length === 1 ? [{ resultIndex: row.resultIndex, candidacy: row.found[0] }] : []),
    unmatchedCandidates: first.resolved.filter(row => row.found.length === 0).map(row => row.resultIndex),
    ambiguousCandidates: first.resolved.filter(row => row.found.length > 1).map(row => row.resultIndex) };
}

/** A missing-race decision considers every promoted ballot for its state and election. */
export function matchElectionResultAcrossBallots(result: ElectionResult, ballots: readonly ServedBallot[]): ElectionMatch {
  const matches = ballots.filter(ballot => ballot.election.state.toUpperCase() === result.state.toUpperCase() &&
    ballot.election.date === result.electionDate).map(ballot => matchElectionResult(result, ballot));
  const winners = matches.filter((match): match is Extract<ElectionMatch, { kind: "matched" }> => match.kind === "matched");
  return winners.length === 1 ? winners[0] : winners.length > 1
    ? { kind: "ambiguous", contestIds: winners.map(row => row.contest.id), reason: "Multiple served ballots match this race" }
    : matches.find(row => row.kind === "ambiguous") ?? { kind: "unmatched", contestIds: [], reason: "No served contest matches this race" };
}
