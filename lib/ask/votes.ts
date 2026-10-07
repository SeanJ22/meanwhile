import { nameParts, splitDisplayName } from "../ballot/incumbency.ts";
import { getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import { formatDateLong } from "../text/format-date.ts";
import {
  getStateVotesSnapshot,
  type OfficialStateVoteScope,
} from "../sources/legiscan/snapshot.ts";
import { stateRollPublisher } from "../sources/legiscan/types.ts";
import type { StateRollCall, StateVotesSnapshot } from "../sources/legiscan/types.ts";
import {
  officialStateVoteScopeForOfficeholderId,
} from "../state-rollcalls/authority.ts";
import { getVotesSnapshot, readFederalRollCallsProjection } from "../votes/snapshot.ts";
import { readHistoricalFederalVotesForMember } from "../votes/history.ts";
import type { RollCallVote, VotesSnapshot } from "../votes/types.ts";

import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";

interface RosterRow {
  id: string;
  name: string;
  officeTitle: string;
  state?: string | null;
  chamber?: string | null;
  provenance?: { sourceUrl?: string | null; sourceOrg?: string | null; collectedAt?: string | null } | null;
}

interface RosterSet {
  scope: string;
  officeholders: RosterRow[];
  divisions: { officeholderId: string; ocdId: string }[];
}

export interface VoteSubjectSeat {
  officeholderId: string;
  name: string;
  officeTitle: string;
  /** `us`, or the official state vote scope. Picks the vote store. */
  rosterScope: string;
  state: string | null;
  chamber: string | null;
  ocdIds: string[];
  sourceUrl: string | null;
  sourceOrg: string | null;
  retrievedAt: string | null;
}

let rosterCache: { readonly federal: RosterSet; readonly rows: VoteSubjectSeat[] } | null = null;

function loadRoster(): VoteSubjectSeat[] {
  const federal = getFederalOfficeholderSet() as RosterSet;
  if (rosterCache?.federal === federal) return rosterCache.rows;
  const divisions = new Map<string, string[]>();
  for (const link of federal.divisions ?? []) {
    const arr = divisions.get(link.officeholderId) ?? [];
    arr.push(link.ocdId);
    divisions.set(link.officeholderId, arr);
  }
  const out: VoteSubjectSeat[] = (federal.officeholders ?? []).map((row) => ({
    officeholderId: row.id,
    name: row.name,
    officeTitle: row.officeTitle,
    rosterScope: "us",
    state: row.state ? row.state.toUpperCase() : null,
    chamber: row.chamber ?? null,
    ocdIds: divisions.get(row.id) ?? [],
    sourceUrl: row.provenance?.sourceUrl ?? null,
    sourceOrg: row.provenance?.sourceOrg ?? null,
    retrievedAt: row.provenance?.collectedAt ?? null,
  }));
  rosterCache = { federal, rows: out };
  return out;
}

export function resetVoteRosterCache(): void {
  rosterCache = null;
}

/** Only case, accents, punctuation and generational suffixes come off; middle names, initials, aliases and variants stay. */
export function identityKey(display: string): string {
  const { givenName, familyName } = splitDisplayName(display);
  const parts = nameParts(givenName, familyName);
  const all = [parts.first, ...parts.middles, parts.last].filter(Boolean).join(" ");
  return all
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'"`‘’“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function surnameKey(display: string): string {
  const { givenName, familyName } = splitDisplayName(display);
  return nameParts(givenName, familyName)
    .last.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'"`‘’“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type VoteIdentity =
  | { kind: "JOINED"; seat: VoteSubjectSeat }
  | { kind: "NO_ROSTER_ROW" }
  | { kind: "NAME_FORM_UNCONFIRMED"; sharedSurnames: number }
  | { kind: "AMBIGUOUS_NAME"; count: number }
  | { kind: "HOLDING_UNAVAILABLE"; scope: OfficialStateVoteScope };

function officialStateVoteSeat(
  personName: string,
  officeholderId: string,
  scope: OfficialStateVoteScope,
): VoteIdentity {
  const state = scope.slice(-2);
  const snapshot = stateSnapshot(state);
  if (!snapshot) return { kind: "HOLDING_UNAVAILABLE", scope };
  const position = snapshot.positions.find((row) => row.officeholderId === officeholderId);
  if (!position) return { kind: "NO_ROSTER_ROW" };
  const roll = snapshot.rollCalls.find((row) => row.id === position.rollCallId);
  if (!roll) return { kind: "HOLDING_UNAVAILABLE", scope };
  const chamber = roll.chamber ?? null;
  const officeTitle = chamber === "Senate"
    ? "State Senator"
    : chamber === "Assembly"
      ? "Assemblymember"
      : "State Representative";
  return {
    kind: "JOINED",
    seat: {
      officeholderId,
      name: personName,
      officeTitle,
      rosterScope: scope,
      state,
      chamber,
      ocdIds: [],
      sourceUrl: roll.rollCallUrl,
      sourceOrg: stateRollPublisher(roll),
      retrievedAt: roll.retrievedAt,
    },
  };
}

export function resolveVoteIdentity(
  personName: string,
  options: { withinStates?: readonly string[]; officeholderId?: string } = {},
): VoteIdentity {
  if (options.officeholderId) {
    const stateScope = officialStateVoteScopeForOfficeholderId(options.officeholderId);
    if (stateScope) return officialStateVoteSeat(personName, options.officeholderId, stateScope);
    const seat = loadRoster().find((row) => row.officeholderId === options.officeholderId);
    return seat ? { kind: "JOINED", seat } : { kind: "NO_ROSTER_ROW" };
  }
  const key = identityKey(personName);
  if (!key) return { kind: "NO_ROSTER_ROW" };

  const states = options.withinStates?.length ? new Set(options.withinStates) : null;
  const inScope = loadRoster().filter(
    (seat) => !states || seat.state === null || states.has(seat.state),
  );

  const exact = inScope.filter((seat) => identityKey(seat.name) === key);
  if (exact.length === 1) return { kind: "JOINED", seat: exact[0] };
  if (exact.length > 1) return { kind: "AMBIGUOUS_NAME", count: exact.length };

  const surname = surnameKey(personName);
  const shared = surname
    ? inScope.filter((seat) => surnameKey(seat.name) === surname).length
    : 0;
  return shared > 0
    ? { kind: "NAME_FORM_UNCONFIRMED", sharedSurnames: shared }
    : { kind: "NO_ROSTER_ROW" };
}

function federalSnapshot(): VotesSnapshot | null {
  try {
    return getVotesSnapshot();
  } catch {
    return null;
  }
}

function stateSnapshot(state: string | null): StateVotesSnapshot | null {
  const scope = state ? `US-${state}` : null;
  if (scope !== "US-AZ" && scope !== "US-NH" && scope !== "US-NJ") return null;
  try {
    return getStateVotesSnapshot(scope as OfficialStateVoteScope);
  } catch {
    return null;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The two publisher shapes, `2026-06-13` and `21-Jul-2026`; anything else is null rather than a guessed date. */
export function isoDateOf(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmy = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!dmy) return null;
  const month = MONTHS.findIndex((m) => m.toLowerCase() === dmy[2].toLowerCase());
  if (month < 0) return null;
  return `${dmy[3]}-${String(month + 1).padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
}

function federalPublisher(chamber: string): string {
  return chamber === "senate" ? "U.S. Senate" : "U.S. House of Representatives";
}

function readableDate(raw: string): string {
  return formatDateLong(isoDateOf(raw)) ?? raw;
}

function federalRollCall(vote: RollCallVote, position: string): NonNullable<EvidenceRecord["rollCall"]> {
  return { position, what: `${vote.title}${vote.legisNum ? ` (${vote.legisNum})` : ""}`, when: readableDate(vote.date), result: String(vote.result) };
}

function federalVoteText(seat: VoteSubjectSeat, vote: RollCallVote, position: string): string {
  const designation = vote.legisNum ? ` (${vote.legisNum})` : "";
  return `${seat.name}, ${seat.officeTitle}: voted ${position} on ${vote.title}${designation} — ${vote.question}, ${readableDate(vote.date)}. ${vote.result}.`;
}

function stateVoteText(seat: VoteSubjectSeat, roll: StateRollCall, position: string): string {
  return `${seat.name}, ${seat.officeTitle}: voted ${position} on ${roll.billNumber} — ${roll.billTitle} (${roll.motion}), ${readableDate(roll.date)}. ${roll.result}.`;
}

export interface VoteEvidence {
  identity: VoteIdentity;
  records: EvidenceRecord[];
  gaps: EvidenceGap[];
  denominators: Record<string, number>;
}

export function federalVoteDenominatorsWithHistory(
  recent: Record<string, number>, earlierCount: number,
): Record<string, number> {
  const { rollCallsHeldForTheirChamber, ...rest } = recent;
  const recentRecorded = recent.rollCallVotesRecorded ?? 0;
  return { ...rest,
    ...(rollCallsHeldForTheirChamber === undefined ? {} :
      { recentRollCallsHeldForTheirChamber: rollCallsHeldForTheirChamber }),
    recentRollCallVotesRecorded: recentRecorded,
    rollCallVotesRecorded: recentRecorded + earlierCount,
    rollCallVotesShown: (recent.rollCallVotesShown ?? 0) + earlierCount,
    earlierRollCallVotesShown: earlierCount };
}

export function voteEvidenceReadsStateRollCalls(
  personName: string,
  options: { withinStates?: readonly string[]; officeholderId?: string } = {},
): boolean {
  if (options.officeholderId) {
    if (officialStateVoteScopeForOfficeholderId(options.officeholderId)) return true;
    const seat = loadRoster().find((row) => row.officeholderId === options.officeholderId);
    return Boolean(seat && seat.rosterScope !== "us");
  }
  const identity = resolveVoteIdentity(personName, options);
  return identity.kind === "JOINED" && identity.seat.rosterScope !== "us";
}

export function voteEvidenceFor(
  personName: string,
  options: { withinStates?: readonly string[]; officeholderId?: string } = {},
): VoteEvidence {
  const identity = resolveVoteIdentity(personName, options);
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};

  if (identity.kind === "AMBIGUOUS_NAME") {
    gaps.push({
      whose: "OURS",
      statement: `${identity.count} people we hold go by exactly that name, so we cannot say which voting record belongs to ${personName}. We have not attached one.`,
    });
    return { identity, records, gaps, denominators };
  }

  if (identity.kind === "HOLDING_UNAVAILABLE") {
    gaps.push({
      whose: "OURS",
      statement: `We identified ${personName}'s ${identity.scope} voting-record authority, but could not read its current proof-validated holding just now, so no votes are shown.`,
    });
    return { identity, records, gaps, denominators };
  }

  if (identity.kind === "NAME_FORM_UNCONFIRMED") {
    gaps.push({
      whose: "OURS",
      statement: `We have not recorded a voting record for ${personName}. Our roster holds a similarly-named officeholder and we could not confirm from the records we hold that it is the same person, so we have not attached that record here.`,
    });
    return { identity, records, gaps, denominators };
  }

  if (identity.kind === "NO_ROSTER_ROW") {
    gaps.push({
      whose: "OURS",
      statement: `We have not recorded a voting record for ${personName}. A voting record exists only for a seat we hold in one of the chambers we cover.`,
    });
    return { identity, records, gaps, denominators };
  }

  const seat = identity.seat;
  denominators.officeholderSeatsMatched = 1;

  if (seat.rosterScope === "us") {
    const snapshot = federalSnapshot();
    if (!snapshot) {
      gaps.push({
        whose: "OURS",
        statement: `We hold ${seat.name} as ${seat.officeTitle}, but could not read our roll-call records just now, so no votes are shown.`,
      });
      return { identity, records, gaps, denominators };
    }
    const byId = new Map(snapshot.votes.map((v) => [v.id, v]));
    const chamberRolls = seat.chamber
      ? snapshot.votes.filter((v) => v.chamber === seat.chamber)
      : snapshot.votes;
    denominators.rollCallsHeldForTheirChamber = chamberRolls.length;

    const mine = snapshot.positions.filter((p) => p.officeholderId === seat.officeholderId);
    denominators.rollCallVotesRecorded = mine.length;

    const ordered = mine
      .map((p) => ({ position: p.position, vote: byId.get(p.voteId) }))
      .flatMap((x) => (x.vote ? [{ position: x.position as string, vote: x.vote }] : []))
      .sort((a, b) => ((isoDateOf(a.vote.date) ?? "") < (isoDateOf(b.vote.date) ?? "") ? 1 : -1));

    for (const { position, vote } of ordered) {
      records.push({
        kind: "ROLL_CALL_VOTE",
        id: `${seat.officeholderId}#${vote.id}`,
        text: federalVoteText(seat, vote, position),
        rollCall: federalRollCall(vote, position),
        occurredAt: isoDateOf(vote.date),
        sourceUrl: vote.rollCallUrl,
        sourceOrg: federalPublisher(vote.chamber),
        retrievedAt: vote.retrievedAt,
      });
    }
    denominators.rollCallVotesShown = records.length;

    if (ordered.length === 0) {
      gaps.push({
        whose: "OURS",
        statement: `We hold ${seat.name} as ${seat.officeTitle}. None of the ${chamberRolls.length} roll call${chamberRolls.length === 1 ? "" : "s"} we have recorded for that chamber carries a vote by them, so we have no voting record to show yet.`,
      });
    }
    return { identity, records, gaps, denominators };
  }

  const snapshot = stateSnapshot(seat.state);
  if (!snapshot) {
    gaps.push({
      whose: "OURS",
      statement: `We hold ${seat.name} as ${seat.officeTitle}, but could not read our roll-call records just now, so no votes are shown.`,
    });
    return { identity, records, gaps, denominators };
  }
  const byId = new Map(snapshot.rollCalls.map((r) => [r.id, r]));
  const stateRolls = seat.state
    ? snapshot.rollCalls.filter((r) => r.state === seat.state)
    : snapshot.rollCalls;
  denominators.rollCallsHeldForTheirLegislature = stateRolls.length;

  const mine = snapshot.positions.filter((p) => p.officeholderId === seat.officeholderId);
  denominators.rollCallVotesRecorded = mine.length;

  const ordered = mine
    .map((p) => ({ position: p.position, roll: byId.get(p.rollCallId) }))
    .flatMap((x) => (x.roll ? [{ position: x.position as string, roll: x.roll }] : []))
    .sort((a, b) => (a.roll.date < b.roll.date ? 1 : -1));

  for (const { position, roll } of ordered) {
    records.push({
      kind: "ROLL_CALL_VOTE",
      id: `${seat.officeholderId}#${roll.id}`,
      text: stateVoteText(seat, roll, position),
      rollCall: { position, what: `${roll.billNumber} — ${roll.billTitle}`, when: readableDate(roll.date), result: String(roll.result) },
      occurredAt: isoDateOf(roll.date),
      sourceUrl: roll.rollCallUrl,
      sourceOrg: stateRollPublisher(roll),
      retrievedAt: roll.retrievedAt,
    });
  }
  denominators.rollCallVotesShown = records.length;

  if (ordered.length === 0) {
    gaps.push({
      whose: "OURS",
      statement: `We hold ${seat.name} as ${seat.officeTitle}. None of the ${stateRolls.length} roll call${stateRolls.length === 1 ? "" : "s"} we have recorded for that legislature carries a vote by them, so we have no voting record to show yet.`,
    });
  }
  return { identity, records, gaps, denominators };
}

export async function voteEvidenceForIncludingHistory(
  personName: string,
  options: { withinStates?: readonly string[]; officeholderId?: string } = {},
): Promise<VoteEvidence> {
  const current = voteEvidenceFor(personName, options);
  if (current.identity.kind !== "JOINED" || current.identity.seat.rosterScope !== "us") return current;
  const seat = current.identity.seat;
  const promoted = await readFederalRollCallsProjection();
  if (promoted.kind !== "PROMOTED") return { ...current, gaps: [...current.gaps, {
    whose: "OURS", statement: `Earlier voting records for ${seat.name} could not be checked against a durable approved source just now. The recent records above remain available.`,
  }] };
  const records = [...current.records];
  const gaps = [...current.gaps];
  const seenVoteIds = new Set(records.filter((record) => record.kind === "ROLL_CALL_VOTE")
    .map((record) => record.id));
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = await readHistoricalFederalVotesForMember(seat.officeholderId, promoted,
      { cursor, pageSize: 16 });
    for (const vote of page.votes) {
      const id = `${seat.officeholderId}#${vote.id}`;
      if (seenVoteIds.has(id)) continue;
      seenVoteIds.add(id);
      records.push({ kind: "ROLL_CALL_VOTE", id,
        text: `${federalVoteText(seat, vote, vote.position)} Earlier recorded vote.`,
        rollCall: federalRollCall(vote, vote.position),
        occurredAt: isoDateOf(vote.date), sourceUrl: vote.rollCallUrl,
        sourceOrg: federalPublisher(vote.chamber), retrievedAt: vote.retrievedAt });
    }
    if (page.status === "COMPLETE") break;
    if (page.status !== "MORE" || !page.nextVersionId || seenCursors.has(page.nextVersionId)) {
      gaps.push({ whose: "OURS", statement: `More earlier voting records for ${seat.name} could not be checked just now; the proven records above remain available.` });
      break;
    }
    cursor = page.nextVersionId;
    seenCursors.add(cursor);
  }
  const earlierCount = records.length - current.records.length;
  const accurateGaps = earlierCount > 0
    ? gaps.filter((gap) => !gap.statement.includes("so we have no voting record to show yet.")) : gaps;
  return { identity: current.identity, records, gaps: accurateGaps,
    denominators: federalVoteDenominatorsWithHistory(current.denominators, earlierCount) };
}

export function statesOf(ocdIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ocdIds) {
    const match = /\/state:([a-z]{2})\b/.exec(id);
    if (match) out.add(match[1].toUpperCase());
  }
  return [...out];
}
