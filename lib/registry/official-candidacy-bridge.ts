import { isOfficialSource } from "../civic-data/source-authority.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { sameSeatDiscriminators } from "../officials/office-seat.ts";
import { samePerson } from "../identity/match-person.ts";
import { nameParts, splitDisplayName } from "../identity/name-parts.ts";
import { ballotCandidateDisplayName } from "../ballot/name-case.ts";
import { withCandidateTickets } from "../ballot/tickets.ts";
import type { BallotSet, Candidacy, Contest } from "../ballot/types.ts";
import { sameSourcedExecutivePerson } from "./candidacy-holder-identity.ts";


/** Two names standing in one exact seat (a division and an office), which the surrounding code has already established. */
const seatedName = (division: string, office: string | null, id: string, name: ReturnType<typeof nameParts>) => ({ id, name, seats: [`${division}\u0000${office}`] });

export interface OfficialCandidacyBridgeRow {
  readonly holder: {
    readonly id: string;
    readonly personId?: string;
    readonly nativeIds?: Readonly<Record<string, readonly string[]>>;
    readonly name: string;
    readonly officeTitle: string;
    readonly divisions: readonly string[];
    readonly authority: "FEDERAL_DIRECTORY" | "STATE_PEOPLE" | "REGISTRY_STATEWIDE_EXECUTIVE" | "REGISTRY_BODY_ROSTER";
    readonly sourceUrl: string | null;
    /** The held person's own official profile, distinct from its source feed. */
    readonly officialProfileUrl?: string | null;
  };
  readonly status: "RESOLVED" | "NO_APPLICABLE_CANDIDACY" | "IDENTITY_UNRESOLVED" | "NOT_CHECKED";
  readonly candidacy: {
    readonly candidacyId: string;
    /** Earlier source and reader targets for this same person in this race. */
    readonly aliases?: readonly string[];
    readonly personId?: string;
    readonly contestId: string;
    readonly contestTitle: string;
    readonly divisionId: string;
    readonly electionId: string;
    readonly candidateName: string;
    readonly sourceUrl: string;
  } | null;
  readonly reason: string;
  readonly unresolvedCandidacyIds: readonly string[];
  readonly ballotSourceUrls?: readonly string[];
}

export interface OfficialCandidacyBridge {
  readonly formatVersion: 1;
  readonly rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE";
  readonly rows: readonly OfficialCandidacyBridgeRow[];
}

function personSeatMatches(title: string, holder: OfficialCandidacyBridgeRow["holder"], divisionId: string): boolean {
  const officialProfile = Boolean(holder.officialProfileUrl && isOfficialSource(holder.officialProfileUrl));
  return sameSeatDiscriminators(title, holder.officeTitle, divisionId, { allowUnspecified: officialProfile });
}

export function officialCandidacySeatMatches(row: OfficialCandidacyBridgeRow): boolean {
  const candidacy = row.status === "RESOLVED" ? row.candidacy : null;
  const office = officeIdentity(row.holder.officeTitle, candidacy?.divisionId);
  if (!candidacy || !office || !row.holder.divisions.includes(candidacy.divisionId) || officeIdentity(candidacy.contestTitle, candidacy.divisionId) !== office ||
    !personSeatMatches(candidacy.contestTitle, row.holder, candidacy.divisionId)) return false;
  const holder = splitDisplayName(row.holder.name), candidate = splitDisplayName(candidacy.candidateName);
  const left = nameParts(holder.givenName, holder.familyName), right = nameParts(candidate.givenName, candidate.familyName);
  return samePerson(seatedName(candidacy.divisionId, office, "holder", left), seatedName(candidacy.divisionId, office, "candidacy", right), { shortFirstNames: true });
}

/** A ticket elects two people. A joint label never becomes a person's name. */
function ballotPeople(ballot: BallotSet) {
  const contests = new Map(ballot.contests.map(contest => [contest.id, contest]));
  const rows: { ballot: BallotSet; contest: Contest; candidate: Candidacy; display: string; name: ReturnType<typeof nameParts>; office: string | null }[] = [];
  const add = (candidate: Candidacy, contest: Contest) => {
    const display = ballotCandidateDisplayName({ ...candidate, ticket: undefined });
    if (!display || display.includes(" / ")) return;
    const parts = candidate.givenName ? candidate : splitDisplayName(display);
    rows.push({ ballot, contest, candidate, display, name: nameParts(parts.givenName, parts.familyName), office: officeIdentity(contest.title, contest.ocdId) });
  };
  for (const candidate of ballot.candidacies) {
    const contest = contests.get(candidate.contestId);
    if (!contest || contest.type !== "CANDIDACY") continue;
    const ticket = candidate.ticket;
    const jointOffice = officeIdentity(contest.title, contest.ocdId) === "governor_and_lieutenant_governor" || /governor\s*\/\s*(?:lieutenant|lt\.?) governor/i.test(contest.title);
    add(candidate, ticket && jointOffice ? { ...contest, title: "Governor" } : contest);
    if (!ticket) continue;
    const mate = ticket.runningMate;
    const mateContest = contests.get(mate.contestId);
    const title = mate.office ?? mateContest?.title ?? (jointOffice || officeIdentity(contest.title, contest.ocdId) === "governor" ? "Lieutenant Governor" : null);
    if (!title) continue;
    add(mate, { ...(mateContest ?? contest), id: mate.contestId, title });
  }
  return rows;
}

function candidateIds(candidate: Candidacy): string[] {
  return [...new Set([candidate.id, ...candidate.aliases ?? []])];
}

export function reconcileOfficialCandidacies(input: {
  readonly bridge: OfficialCandidacyBridge;
  readonly ballots: readonly BallotSet[];
  readonly holders?: readonly OfficialCandidacyBridgeRow["holder"][];
}): OfficialCandidacyBridge {
  const holders = new Map(input.bridge.rows.map(row => [row.holder.id, row.holder]));
  for (const holder of input.holders ?? []) holders.set(holder.id, holder);
  const contests = input.ballots.map(withCandidateTickets).flatMap(ballot => {
    const people = ballotPeople(ballot);
    const seats = new Map(ballot.contests.filter(contest => contest.type === "CANDIDACY").map(contest => {
      const lead = people.find(row => row.candidate.ticket && row.candidate.contestId === contest.id);
      const current = lead?.contest ?? contest;
      return [`${current.id}\u0000${current.title}`, current];
    }));
    for (const person of people) seats.set(`${person.contest.id}\u0000${person.contest.title}`, person.contest);
    return [...seats.values()].map(contest => ({ ballot, contest, office: officeIdentity(contest.title, contest.ocdId),
      candidates: people.filter(person => person.contest.id === contest.id && person.contest.title === contest.title) }));
  });
  const bySeat = new Map<string, typeof contests>();
  for (const contest of contests) if (contest.office) {
    const key = `${contest.contest.ocdId}\u0000${contest.office}`;
    bySeat.set(key, [...bySeat.get(key) ?? [], contest]);
  }
  const inheritedRows = new Map(input.bridge.rows.map(row => [row.holder.id, row]));
  const rows = new Map(inheritedRows);
  const committedMatch = (holder: OfficialCandidacyBridgeRow["holder"], current: ReturnType<typeof ballotPeople>[number]) => {
    const prior = inheritedRows.get(holder.id);
    if (!prior?.candidacy || !officialCandidacySeatMatches(prior) || prior.holder.name !== holder.name ||
        prior.holder.officeTitle !== holder.officeTitle ||
        JSON.stringify([...new Set(prior.holder.divisions)].sort()) !== JSON.stringify([...new Set(holder.divisions)].sort()) ||
        prior.candidacy.electionId !== current.ballot.election.id) return false;
    const ids = new Set([prior.candidacy.candidacyId, ...prior.candidacy.aliases ?? []]);
    if (!candidateIds(current.candidate).some(id => ids.has(id))) return false;
    const previous = splitDisplayName(prior.candidacy.candidateName);
    return samePerson(seatedName(prior.candidacy.divisionId, current.office, "prior", nameParts(previous.givenName, previous.familyName)),
      seatedName(prior.candidacy.divisionId, current.office, "current", current.name));
  };
  for (const holder of holders.values()) {
    const office = officeIdentity(holder.officeTitle, holder.divisions[0]);
    if (!office) continue;
    const exact = holder.divisions.flatMap(division => bySeat.get(`${division}\u0000${office}`) ?? [])
      .filter(({ contest }) => personSeatMatches(contest.title, holder, contest.ocdId));
    if (!exact.length) continue;
    const latest = exact.map(row => row.ballot.election.date).sort().at(-1);
    const current = exact.filter(row => row.ballot.election.date === latest);
    const parts = splitDisplayName(holder.name), name = nameParts(parts.givenName, parts.familyName);
    const found = current.flatMap(row => row.candidates.filter(candidate =>
      samePerson(seatedName(row.contest.ocdId, office, holder.id, name), seatedName(row.contest.ocdId, office, candidate.candidate.id, candidate.name)) || committedMatch(holder, candidate)));
    // Source normalization retains explicit aliases for duplicate entries.
    // Distinct native person identities remain separate despite a shared name.
    const groups: { row: typeof found[number]; ids: Set<string>; sources: Set<string> }[] = [];
    for (const match of found) {
      const ids = candidateIds(match.candidate);
      const linked = groups.filter(group => (!group.row.candidate.personId || !match.candidate.personId ||
        group.row.candidate.personId === match.candidate.personId) && ids.some(id => group.ids.has(id)));
      const sources = httpsUrls([match.candidate.provenance.sourceUrl, ...match.candidate.sources?.map(source => source.sourceUrl) ?? []]);
      if (!linked.length) groups.push({ row: match, ids: new Set(ids), sources: new Set(sources) });
      else {
        const group = linked[0];
        for (const id of ids) group.ids.add(id);
        for (const source of sources) group.sources.add(source);
        for (const duplicate of linked.slice(1)) {
          for (const id of duplicate.ids) group.ids.add(id);
          for (const source of duplicate.sources) group.sources.add(source);
          groups.splice(groups.indexOf(duplicate), 1);
        }
      }
    }
    const matches = groups.map(group => group.row);
    if (matches.length !== 1) {
      if (matches.length) rows.set(holder.id, { holder, status: "IDENTITY_UNRESOLVED", candidacy: null,
        reason: "The exact seat has more than one ballot candidacy matching this officeholder.",
        unresolvedCandidacyIds: matches.map(row => row.candidate.id).sort(),
        ballotSourceUrls: httpsUrls(current.map(row => row.contest.provenance.sourceUrl)) });
      else if (current.every(row => row.contest.candidateListComplete === true)) rows.set(holder.id, { holder,
        status: "NO_APPLICABLE_CANDIDACY", candidacy: null, reason: "The complete sourced ballot for this exact seat does not list the current officeholder.",
        unresolvedCandidacyIds: [], ballotSourceUrls: httpsUrls(current.map(row => row.contest.provenance.sourceUrl)) });
      continue;
    }
    const match = matches[0];
    if (!match.candidate.provenance.sourceUrl) continue;
    const seatHolders = [...holders.values()].filter(other => other.divisions.includes(match.contest.ocdId) &&
      officeIdentity(other.officeTitle, match.contest.ocdId) === office &&
      personSeatMatches(match.contest.title, other, match.contest.ocdId));
    const matchingHolders = seatHolders.filter(other => {
      const parts = splitDisplayName(other.name), otherName = nameParts(parts.givenName, parts.familyName);
      return samePerson(seatedName(match.contest.ocdId, office, other.id, otherName), seatedName(match.contest.ocdId, office, match.candidate.id, match.name)) || committedMatch(other, match);
    });
    const onePerson = matchingHolders.length === 1 || matchingHolders.length > 1 &&
      matchingHolders.every(left => matchingHolders.every(right => sameSourcedExecutivePerson(left, right)));
    if (!onePerson) {
      rows.set(holder.id, { holder, status: "IDENTITY_UNRESOLVED", candidacy: null,
        reason: "The candidacy's exact seat has more than one matching current officeholder.", unresolvedCandidacyIds: [match.candidate.id],
        ballotSourceUrls: httpsUrls([match.contest.provenance.sourceUrl]) });
      continue;
    }
    const aliases = [...groups[0].ids].filter(id => id !== match.candidate.id).sort();
    const committedPeople = matchingHolders.filter(other => committedMatch(other, match))
      .flatMap(other => inheritedRows.get(other.id)?.candidacy?.personId ?? []);
    const canonicalHolder = matchingHolders.find(other => committedPeople.includes(other.personId ?? other.id))
      ?? matchingHolders.find(other => committedMatch(other, match)) ?? matchingHolders[0];
    rows.set(holder.id, { holder, status: "RESOLVED", candidacy: {
      candidacyId: match.candidate.id, ...(aliases.length ? { aliases } : {}), personId: canonicalHolder.personId ?? canonicalHolder.id,
      contestId: match.contest.id, contestTitle: match.contest.title,
      divisionId: match.contest.ocdId, electionId: match.ballot.election.id, candidateName: match.display,
      sourceUrl: match.candidate.provenance.sourceUrl,
    }, reason: "The current officeholder and a unique candidate on the sourced ballot agree on name, exact division and office; known seat details do not conflict.",
      ballotSourceUrls: httpsUrls([...groups[0].sources]), unresolvedCandidacyIds: [] });
  }
  return { ...input.bridge, rows: [...rows.values()] };
}


export function httpsUrls(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && /^https:\/\//.test(value)
  ))].sort();
}
