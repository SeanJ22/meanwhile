import { US_JURISDICTIONS } from "../coverage/states.ts";
import { stateName } from "../facts/entity-read.ts";
import { normalizeName } from "../routing/exact-name.ts";
import { readBallotNavigationProjection } from "../civic-data/curated-reader-read-model.ts";
import { electionFieldIssue, sourcedElectionDate, type PublishedElectionField } from "../civic-data/election-fields.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { formatDateLong } from "../text/format-date.ts";
import { composeBallotSummary, type BallotComposition } from "./ballot-summary.ts";
import type { BallotForDivisions } from "./server-sources.ts";
import type { EvidencePack, EvidenceRecord } from "./evidence.ts";
import { validateAnswer } from "./validate.ts";

type ElectionInformationField = "ELECTION_DAY" | "early_voting" | "registration_deadline" | "election_office";
export interface ElectionInformationAsk {
  readonly field: ElectionInformationField;
  readonly state: string | null;
  readonly divisionId: string | null;
}

/** Whole questions only: qualifiers, named counties and other subjects keep the ordinary reader. */
export function electionInformationQuestion(question: string): ElectionInformationAsk | null {
  const words = normalizeName(question);
  if (/^when is (?:the )?(?:next )?election day$/.test(words)) return { field: "ELECTION_DAY", state: null, divisionId: null };
  const forms: readonly [ElectionInformationField, RegExp][] = [
    ["early_voting", /^when (?:did|does|will) early voting (?:start|begin) in (.+)$/],
    ["registration_deadline", /^what (?:is|s) the voter registration deadline in (.+)$/],
    ["election_office", /^how can i contact (?:the )?(.+?) election office$/],
  ];
  for (const [field, form] of forms) {
    const place = form.exec(words)?.[1]?.replace(/ s$/, "");
    if (!place) continue;
    const state = US_JURISDICTIONS.find(row => place === row.usps.toLowerCase() || place === normalizeName(stateName(row.usps) ?? ""));
    if (state) return { field, state: state.usps, divisionId: `ocd-division/country:us/${state.prefix}:${state.slug}` };
  }
  return null;
}

function answer(input: { question: string; today: string; ask: ElectionInformationAsk }, composed: BallotComposition, missingAnswer = false) {
  const pack: EvidencePack = { question: input.question, intent: "CIVICS", temporal: { kind: "NONE" }, subject: null,
    records: composed.records, gaps: composed.gaps.map(statement => ({ whose: "OURS", statement })), denominators: {}, today: input.today };
  const verdict = validateAnswer(composed.answer, composed.citedUrls, pack);
  return verdict.kind === "PASSED" ? { pack, composed, verdict, missingAnswer,
    shape: { kind: "ELECTION_INFORMATION" as const, field: input.ask.field } } : null;
}

/** Quotes and date conditions stay whole; an absent field is still an acquisition gap. */
export function composeElectionInformation(input: {
  readonly question: string; readonly today: string; readonly ask: ElectionInformationAsk;
  readonly ballot: BallotForDivisions; readonly fields: readonly PublishedElectionField[];
}) {
  if (input.ask.field === "ELECTION_DAY") {
    if (!input.ballot.sets.length || input.ballot.loaderFailures.length) return null;
    const parts = input.ballot.sets.map(set => {
      if (!sourcedElectionDate(set.election.date) || set.election.date < input.today) return null;
      const summary = composeBallotSummary({ contests: set.contests, election: set.election });
      if (!summary?.citedUrls.length) return null;
      return { ...summary, answer: `${input.ballot.sets.length > 1 ? `${set.election.state}: ` : ""}${set.election.name} is on ${formatDateLong(set.election.date)}.` };
    });
    if (parts.some(part => !part)) return null;
    const held = parts.flatMap(part => part ? [part] : []);
    return answer(input, { answer: held.map(part => part.answer).join("\n\n"),
      records: held.flatMap(part => part.records), citedUrls: [...new Set(held.flatMap(part => part.citedUrls))], gaps: [] });
  }
  const election = input.ballot.sets.find(set => set.election.state.toUpperCase() === input.ask.state)?.election;
  if (input.ask.field !== "election_office" && (!election || !sourcedElectionDate(election.date) || election.date < input.today)) return null;
  const fields = input.fields.filter(row => row.kind === "ELECTION_FIELD" && row.value.state === input.ask.state &&
    row.value.divisionId === input.ask.divisionId && row.value.fieldKind === input.ask.field &&
    (input.ask.field === "election_office" || row.value.electionDate === election!.date));
  if (fields.some(row => electionFieldIssue(row))) return null;
  if (!fields.length) return answer(input, { answer: "We don't have that answer yet.", records: [], citedUrls: [],
    gaps: ["We have not recorded that election information for this place and election."] }, true);
  const records: EvidenceRecord[] = fields.map(row => ({ kind: "SOURCE_PASSAGE", id: row.id, subjectId: null,
    text: [row.value.text, row.value.quote, row.value.phone, row.value.electionDate ? `Election: ${formatDateLong(row.value.electionDate)}.` : null,
      ...row.value.dates.map(date => formatDateLong(date))].filter(Boolean).join(" "),
    sourceUrl: row.value.url, sourceOrg: row.value.sourceOrg, retrievedAt: row.value.collectedAt }));
  const text = input.ask.field === "election_office"
    ? fields.map(row => `${row.value.text}: ${row.value.phone}.`).join(" ")
    : fields.map(row => `${row.value.fieldKind === "early_voting" ? "Early voting" : "Voter registration"} for the ${formatDateLong(row.value.electionDate!)} election: ${row.value.quote}`).join("\n\n");
  return answer(input, { answer: text, records, citedUrls: [...new Set(records.map(row => row.sourceUrl!))], gaps: [] });
}

export async function readElectionInformation(input: Omit<Parameters<typeof composeElectionInformation>[0], "fields">,
  options: PromotedCivicDataReadOptions = {}) {
  if (input.ask.field === "ELECTION_DAY") return composeElectionInformation({ ...input, fields: [] });
  const read = await readBallotNavigationProjection(input.ask.state!, options);
  // An unavailable or not-yet-published navigation still uses the ordinary reader and its held fallbacks.
  if (read.kind !== "PROMOTED") return null;
  const fields = read.value.records.filter((row): row is PublishedElectionField & Readonly<Record<string, unknown>> => row.kind === "ELECTION_FIELD");
  return composeElectionInformation({ ...input, fields });
}
