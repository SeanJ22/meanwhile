import { nameParts, splitDisplayName } from "../ballot/incumbency.ts";
import { getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import { formatDateLong } from "../text/format-date.ts";
import {
  getStateVotesSnapshot,
  OFFICIAL_STATE_VOTE_SCOPES,
  type OfficialStateVoteScope,
} from "../sources/legiscan/snapshot.ts";
import { stateRollPublisher } from "../sources/legiscan/types.ts";
import type { StateRollCall, StateVotesSnapshot } from "../sources/legiscan/types.ts";
import {
  officialStateVoteScopeForOfficeholderId,
} from "../state-rollcalls/authority.ts";
import { getVotesSnapshot, readFederalMemberVotes, readFederalRollCallsProjection } from "../votes/snapshot.ts";
import type { FederalMemberVotesReadModel, FederalRollCallWindow } from "../votes/data-plane.ts";
import { readHistoricalFederalVotesForMember } from "../votes/history.ts";
import { matchingPersonVotes } from "./person-votes.ts";
import { keyVoteEvidenceFor } from "./key-votes.ts";
import type { RollCallVote } from "../votes/types.ts";

import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import { readNativeMemberVotes, type NativeMemberVoteReaders } from "../state-rollcalls/reader-votes.ts";
import { stateVoteStateForMember } from "../state-rollcalls/reader-vote-visibility.ts";

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
  | { kind: "HOLDING_UNAVAILABLE"; scope: string };

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

function federalSnapshot(): FederalRollCallWindow | null {
  try {
    return getVotesSnapshot();
  } catch {
    return null;
  }
}

function stateSnapshot(state: string | null): StateVotesSnapshot | null {
  const scope = state ? `US-${state}` : null;
  if (!scope || !OFFICIAL_STATE_VOTE_SCOPES.includes(scope as OfficialStateVoteScope)) return null;
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
    if (stateVoteStateForMember(options.officeholderId, options.withinStates?.length === 1 ? options.withinStates[0] : undefined)) return false;
    const seat = loadRoster().find((row) => row.officeholderId === options.officeholderId);
    return Boolean(seat && seat.rosterScope !== "us");
  }
  const identity = resolveVoteIdentity(personName, options);
  return identity.kind === "JOINED" && identity.seat.rosterScope !== "us";
}

/** `memberVotes`: the federal member's own record, null when none is held, undefined when it could not be read. */
export function voteEvidenceFor(
  personName: string,
  options: { withinStates?: readonly string[]; officeholderId?: string; memberVotes?: FederalMemberVotesReadModel | null } = {},
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
    const snapshot = federalSnapshot(), record = options.memberVotes;
    if (!snapshot || record === undefined) {
      gaps.push({
        whose: "OURS",
        statement: `We hold ${seat.name} as ${seat.officeTitle}, but could not read our roll-call records just now, so no votes are shown.`,
      });
      return { identity, records, gaps, denominators };
    }
    const byId = new Map((record?.votes ?? []).map((v) => [v.id, v]));
    const chamberRolls = seat.chamber
      ? snapshot.votes.filter((v) => v.chamber === seat.chamber)
      : snapshot.votes;
    denominators.rollCallsHeldForTheirChamber = chamberRolls.length;

    const mine = record?.positions ?? [];
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
  options: { withinStates?: readonly string[]; officeholderId?: string; topic?: string | null; onRecentMiss?: () => void } = {},
  readers?: NativeMemberVoteReaders,
): Promise<VoteEvidence> {
  const stateHint = options.withinStates?.length === 1 ? options.withinStates[0] : undefined;
  const state = options.officeholderId ? stateVoteStateForMember(options.officeholderId, stateHint) : null;
  if (options.officeholderId && state) {
    const member = options.officeholderId;
    try {
      const native = await readNativeMemberVotes(member, readers, { state });
      if (native) {
        const records: EvidenceRecord[] = native.votes.map(vote => ({ kind: "ROLL_CALL_VOTE", id: `${member}#${vote.id}`,
          subjectId: member, text: `${personName}: recorded ${vote.position} on ${vote.legisNum} — ${vote.title} (${vote.question}), ${readableDate(vote.date)}. ${vote.result}.`,
          rollCall: { position: vote.position, what: `${vote.legisNum} — ${vote.title}`, when: readableDate(vote.date), result: vote.result },
          occurredAt: vote.date, sourceUrl: vote.rollCallUrl, sourceOrg: vote.sourceOrg, retrievedAt: vote.retrievedAt }));
        const gaps: EvidenceGap[] = records.length ? [] : [{ whose: "OURS", statement: `We have not acquired an exact voting record for ${personName} from this source yet.` }];
        if (native.unavailableScopes.length) gaps.push({ whose: "OURS", statement: `Some sources for ${personName}'s voting record could not be checked just now. Any recorded votes above remain available.` });
        return { identity: native.status === "IDENTITY_UNRESOLVED" ? { kind: "NO_ROSTER_ROW" }
          : native.status === "HOLDING_UNAVAILABLE" ? { kind: "HOLDING_UNAVAILABLE", scope: `US-${state}` } : { kind: "JOINED", seat: {
          officeholderId: member, name: personName, officeTitle: "State legislator", rosterScope: native.authorityScope, state,
          chamber: null, ocdIds: [], sourceUrl: records[0]?.sourceUrl ?? null, sourceOrg: records[0]?.sourceOrg ?? null,
          retrievedAt: native.generatedAt } }, records,
          gaps,
          denominators: { rollCallVotesRecorded: records.length, rollCallVotesShown: records.length } };
      }
    } catch {
      return { identity: { kind: "HOLDING_UNAVAILABLE", scope: `US-${state}` }, records: [], denominators: {},
        gaps: [{ whose: "OURS", statement: `We could not load the voting record for ${personName} just now.` }] };
    }
  }
  const identity = resolveVoteIdentity(personName, options);
  const memberVotes = identity.kind === "JOINED" && identity.seat.rosterScope === "us"
    ? await readFederalMemberVotes(identity.seat.officeholderId).then(read => read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? read.value
      : read.kind === "NOT_RECORDED" ? null : undefined, () => undefined) : null;
  const current = voteEvidenceFor(personName, { ...options, memberVotes });
  if (options.topic !== undefined && matchingPersonVotes(current.records, options.topic)?.length) return current;
  if (current.identity.kind !== "JOINED" || current.identity.seat.rosterScope !== "us") return current;
  if (options.topic) {
    const key = await keyVoteEvidenceFor({ kind: "PERSON", id: current.identity.seat.officeholderId, name: current.identity.seat.name },
      [current.identity.seat.officeholderId], undefined, { includeSummaries: false });
    const matching = matchingPersonVotes(key.records, options.topic);
    if (matching?.length) return { ...current, records: [...current.records, ...matching],
      denominators: { ...current.denominators, keyVotePositionsShown: matching.length } };
  }
  options.onRecentMiss?.();
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
  const bill = options.topic && /\b(h\s*r|hr|s|h\s*(?:con\s*)?res|s\s*(?:con\s*)?res)\s*(\d+)\b/i.exec(options.topic);
  const voteBill = bill ? `${bill[1].toLowerCase().replace(/\s/g, "")}${bill[2]}` : undefined;
  for (;;) {
    const page = await readHistoricalFederalVotesForMember(seat.officeholderId, promoted,
      { cursor, pageSize: 16, voteBill });
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
    const match = /\/(?:state|district|territory):([a-z]{2})\b/.exec(id);
    if (match) out.add(match[1].toUpperCase());
  }
  return [...out];
}
