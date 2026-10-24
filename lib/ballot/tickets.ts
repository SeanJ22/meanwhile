import { ballotCandidateDisplayName } from "./name-case.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { sameSeatDiscriminators } from "../officials/office-seat.ts";
import type { BallotSet, Candidacy, Contest } from "./types.ts";
import type { Provenance } from "../sources/types.ts";

export type BallotWithTickets = BallotSet;

const nameKey = (name: string) => name.normalize("NFKC").toLocaleLowerCase("en-US")
  .replace(/[.’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const personName = (candidate: Candidacy) => ballotCandidateDisplayName({ ...candidate, ticket: undefined });
const jointOffice = /governor\s*(?:and|&|\/)\s*(?:lieutenant|lt\.?)\s*governor|president\s*(?:and|&|\/)\s*vice\s*president/i;
const sources = (...rows: readonly (readonly Provenance[])[]) => [...new Map(rows.flat().map(row =>
  [JSON.stringify(row), row])).values()];

/** Person aliases exclude the running mate: a ticket is a choice, never a person. */
export function ballotCandidateAliases(candidate: Candidacy): string[] {
  const name = personName(candidate), ticketName = candidate.ticket && name.trim() && personName(candidate.ticket.runningMate).trim()
    ? ballotCandidateDisplayName(candidate) : "";
  return [...new Set([candidate.id, ...(name.trim() ? [`${candidate.contestId}|${name}`] : []),
    ...candidate.aliases ?? [], ...(ticketName.trim() ? [`${candidate.contestId}|${ticketName}`] : [])])];
}

export function ballotCandidatePeople(candidate: Candidacy): Candidacy[] {
  return [{ ...candidate, ticket: undefined }, ...(candidate.ticket ? [candidate.ticket.runningMate] : [])];
}

function mergePerson(kept: Candidacy, other: Candidacy): Candidacy {
  const parties = [...new Set([kept.partyLabel, other.partyLabel].flatMap(label => label?.split(/\s*\/\s*/) ?? []))];
  const slogans = [...new Set([kept.slogan, other.slogan].filter((label): label is string => Boolean(label)))];
  const ticket = kept.ticket && other.ticket ? { ...kept.ticket,
    runningMate: { ...mergePerson(kept.ticket.runningMate, other.ticket.runningMate),
      office: kept.ticket.runningMate.office ?? other.ticket.runningMate.office } } : kept.ticket ?? other.ticket;
  return { ...other, ...kept,
    websiteUrl: kept.websiteUrl ?? other.websiteUrl, slogan: slogans.join(" · ") || null,
    partyLabel: parties.join(" / ") || null,
    incumbent: kept.incumbent ?? other.incumbent, identity: kept.identity ?? other.identity,
    filing: kept.filing ?? other.filing, personId: kept.personId ?? other.personId,
    ticket,
    ...(ticket ? { runningMateAliases: ballotCandidateAliases(ticket.runningMate) } : {}),
    aliases: [...new Set([...ballotCandidateAliases(kept), ...ballotCandidateAliases(other)])],
    sources: sources([kept.provenance, ...kept.sources ?? []], [other.provenance, ...other.sources ?? []]),
  };
}

function raceOffice(contest: Contest): string {
  const office = officeIdentity(contest.title.replace(/\s*\/\s*/g, " and "), contest.ocdId);
  return office === "governor_and_lieutenant_governor" ? "governor" : office ?? nameKey(contest.title);
}

/** An authority sometimes puts both people in one name cell of a joint office. */
function inlineTicket(candidate: Candidacy, contest: Contest): Candidacy {
  if (candidate.ticket) return { ...candidate, ticket: { ...candidate.ticket, runningMate: { ...candidate.ticket.runningMate,
    aliases: [...new Set([...ballotCandidateAliases(candidate.ticket.runningMate), ...candidate.runningMateAliases ?? []])] } } };
  if (!jointOffice.test(contest.title)) return candidate;
  const published = candidate.givenName.trim() ? `${candidate.givenName} ${candidate.familyName}` : candidate.familyName;
  const names = published.split(/\s*\/\s*|\s+and\s+|\s*&\s*|\r?\n+/i)
    .map(name => ballotCandidateDisplayName({ givenName: "", familyName: name.trim() }));
  if (names.length !== 2 || names.some(name => !name.trim())) return candidate;
  const office = /governor/i.test(contest.title) ? "Lieutenant Governor" : "Vice President";
  const parties = candidate.partyLabel?.split(/\s*\/\s*/);
  const mate: Candidacy & { office: string } = { ...candidate, id: `${candidate.id}:running-mate`,
    givenName: "", familyName: names[1].trim(), office, aliases: candidate.runningMateAliases ?? [], ticket: undefined, runningMateAliases: undefined,
    personId: undefined, identity: undefined, filing: undefined, websiteUrl: null, incumbent: null,
    partyLabel: parties?.length === 2 ? parties[1] : candidate.partyLabel };
  mate.aliases = ballotCandidateAliases(mate);
  const result = { ...candidate, givenName: "", familyName: names[0].trim(),
    partyLabel: parties?.length === 2 ? parties[0] : candidate.partyLabel,
    aliases: ballotCandidateAliases(candidate), ticket: { id: candidate.id, runningMate: mate, provenance: candidate.provenance } };
  return { ...result, aliases: ballotCandidateAliases(result) };
}

/** One person per exact election/office/division, retaining every published key and source.
 * This same projection reads older publications and runs after every source refresh. */
export function withCandidateTickets(set: BallotSet): BallotSet {
  const contests: Contest[] = [], contestById = new Map<string, Contest>();
  const raceGroups = new Map<string, Contest[]>();
  for (const contest of set.contests) {
    // A shared board/division can elect separate seats for its constituent towns.
    // The published scope and term are part of the race, not interchangeable sources.
    const race = JSON.stringify([contest.electionId, contest.ocdId, raceOffice(contest),
      contest.scopeNote?.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US") || null,
      contest.voteFor, contest.termYears, /unexpired|special/i.test(contest.title)]);
    const group = raceGroups.get(race) ?? [];
    const kept = contest.type === "CANDIDACY" ? group.find(row => row.type === contest.type &&
      sameSeatDiscriminators(row.title, contest.title, row.ocdId)) : undefined;
    if (kept) {
      kept.aliases = [...new Set([kept.id, ...kept.aliases ?? [], contest.id, ...contest.aliases ?? []])];
      kept.sources = sources([kept.provenance, ...kept.sources ?? []], [contest.provenance, ...contest.sources ?? []]);
      contestById.set(contest.id, kept);
    } else {
      const next = { ...contest };
      contests.push(next); contestById.set(contest.id, next);
      group.push(next); raceGroups.set(race, group);
    }
  }
  const rows = set.candidacies.map(candidate => {
    const contest = contestById.get(candidate.contestId);
    return inlineTicket({ ...candidate, contestId: contest?.id ?? candidate.contestId,
      aliases: ballotCandidateAliases(candidate) }, contest ?? { title: "" } as Contest);
  });
  const leadCounts = new Map<string, number>(), mateCounts = new Map<string, number>();
  for (const ticket of set.candidateTickets ?? []) {
    leadCounts.set(ticket.leadCandidacyId, (leadCounts.get(ticket.leadCandidacyId) ?? 0) + 1);
    mateCounts.set(ticket.runningMate.id, (mateCounts.get(ticket.runningMate.id) ?? 0) + 1);
  }
  const pairedMates = new Map<string, string>();
  for (const ticket of set.candidateTickets ?? []) {
    const lead = rows.find(row => row.id === ticket.leadCandidacyId), mate = ticket.runningMate;
    const leadContest = lead && contestById.get(lead.contestId), mateContest = contestById.get(mate.contestId);
    if (!lead || !leadContest || !mateContest || !mate.familyName?.trim() || mate.id === lead.id ||
        leadCounts.get(lead.id) !== 1 || mateCounts.get(mate.id) !== 1 ||
        !ticket.provenance.sourceUrl || !ticket.provenance.quote?.trim() ||
        leadContest.type !== "CANDIDACY" || mateContest.type !== "CANDIDACY" ||
        leadContest.electionId !== mateContest.electionId || leadContest.ocdId !== mateContest.ocdId) continue;
    const leadName = personName(lead).split(/\s*\/\s*/)[0];
    lead.aliases = [...new Set([...ballotCandidateAliases(lead), `${lead.contestId}|${leadName}`,
      `${lead.contestId}|${leadName} / ${personName(mate)}`])];
    lead.givenName = ""; lead.familyName = leadName;
    lead.ticket = { id: ticket.id, runningMate: { ...mate, aliases: ballotCandidateAliases(mate),
      office: mate.office ?? mateContest.title }, provenance: ticket.provenance };
    lead.ticket.runningMate.aliases = [...new Set([...ballotCandidateAliases(mate), ...lead.runningMateAliases ?? []])];
    pairedMates.set(mate.id, lead.contestId);
  }
  const byName = new Map<string, Candidacy[]>();
  const addName = (row: Candidacy) => {
    for (const name of new Set([nameKey(personName(row)), nameKey(ballotCandidateDisplayName(row))])) {
      const key = `${row.contestId}\0${name}`;
      byName.set(key, [...byName.get(key) ?? [], row]);
    }
  };
  for (const row of rows) addName(row);
  for (const lineup of set.generalLineup?.contests ?? []) {
    const contest = contestById.get(lineup.contestId);
    if (!contest) continue;
    for (const nominee of lineup.nominees) {
      const name = nameKey(nominee.name), leadName = nameKey(nominee.name.split(/\s*\/\s*/)[0]);
      const matching = [...new Set([...(byName.get(`${contest.id}\0${name}`) ?? []),
        ...(byName.get(`${contest.id}\0${leadName}`) ?? [])])].filter(row =>
        (nameKey(ballotCandidateDisplayName(row)) === name || nameKey(personName(row)) === name ||
          row.ticket && nameKey(personName(row)) === leadName));
      const provenance = nominee.provenance ?? { sourceUrl: set.generalLineup!.canvass.url,
        sourceOrg: set.generalLineup!.canvass.issuedBy, collectedAt: set.generalLineup!.canvass.readAt, verifiedAt: null };
      const key = `${lineup.contestId}|${nominee.name}`;
      const candidate: Candidacy = { id: key, contestId: contest.id, givenName: "", familyName: nominee.name,
        partyLabel: nominee.partyLabel || null, slogan: nominee.note, incumbent: null, websiteUrl: null, provenance };
      if (matching.length) for (const row of matching) {
        row.aliases = [...new Set([...ballotCandidateAliases(row), key])];
        row.sources = sources([row.provenance, ...row.sources ?? []], [provenance]);
        row.slogan ??= nominee.note;
      } else { const row = inlineTicket(candidate, contest); rows.push(row); addName(row); }
    }
  }
  const candidacies: Candidacy[] = [];
  const personGroups = new Map<string, Candidacy[]>();
  for (const row of rows) {
    if (pairedMates.has(row.id)) continue;
    const key = `${row.contestId}\0${nameKey(personName(row))}`;
    const group = personGroups.get(key) ?? [];
    const samePerson = group.find(candidate =>
      (!candidate.personId || !row.personId || candidate.personId === row.personId) &&
      (!candidate.ticket || !row.ticket || nameKey(personName(candidate.ticket.runningMate)) === nameKey(personName(row.ticket.runningMate))));
    if (samePerson) Object.assign(samePerson, mergePerson(samePerson, row));
    else { candidacies.push(row); group.push(row); personGroups.set(key, group); }
  }
  const suppressed = new Set(contests.filter(contest => {
    const raw = set.candidacies.filter(row => row.contestId === contest.id);
    return raw.length > 0 && raw.every(row => pairedMates.has(row.id) && pairedMates.get(row.id) !== contest.id);
  }).map(row => row.id));
  for (const contest of contests) {
    const mates = [...new Set(candidacies.filter(row => row.contestId === contest.id && row.ticket)
      .map(row => row.ticket!.runningMate.office).filter((office): office is string => Boolean(office)))];
    if (mates.length === 1 && !jointOffice.test(contest.title) &&
        !contest.title.toLocaleLowerCase("en-US").includes(mates[0].toLocaleLowerCase("en-US")))
      contest.title += ` / ${mates[0]}`;
  }
  return { ...set, contests: contests.filter(row => !suppressed.has(row.id)), candidacies,
    ...(set.filingCandidacies ? { filingCandidacies: set.filingCandidacies.map(row => {
      const contestId = contestById.get(row.contestId)?.id ?? row.contestId;
      return contestId === row.contestId ? row : { ...row, contestId, aliases: ballotCandidateAliases(row) };
    }) } : {}),
    ...(set.generalLineup ? { generalLineup: { ...set.generalLineup, contests: contests.filter(row => !suppressed.has(row.id) &&
      set.generalLineup!.contests.some(lineup => contestById.get(lineup.contestId)?.id === row.id)).map(contest => ({
        contestId: contest.id, nominees: candidacies.filter(row => row.contestId === contest.id).map(row => ({
          name: ballotCandidateDisplayName(row), partyLabel: row.ticket && row.partyLabel !== row.ticket.runningMate.partyLabel
            ? [row.partyLabel, row.ticket.runningMate.partyLabel].filter(Boolean).join(" / ") : row.partyLabel ?? "",
          note: row.slogan, provenance: row.ticket?.provenance ?? row.provenance,
        })),
      })) } } : {}),
  };
}
