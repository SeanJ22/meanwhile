import { readStateMemberVoteSnapshot } from "./member-votes.ts";
import { readPluralVotesForPerson, pluralVotesScope, type PluralVoteFact } from "../sources/plural/votes.ts";
import { readLegiscanVotesForPerson, legiscanVotesScope } from "../sources/legiscan/votes.ts";
import { OFFICIAL_STATE_VOTE_SCOPES, readOfficialStateVotesProjection } from "../sources/legiscan/snapshot.ts";
import { LEGISCAN_ATTRIBUTION, stateRollPublisher, type StateVotesSnapshot } from "../sources/legiscan/types.ts";
import { officialStateRollCallTargetByState, type OfficialStateVoteScope } from "./authority.ts";
import { stateVoteStateForMember } from "./reader-vote-visibility.ts";
import { seatHolderById } from "../registry/server.ts";
import type { SeatHolder } from "../officials/lookup.ts";

export interface NativeReaderVote {
  id: string; title: string; titleSource: "BILL_TITLE"; question: string; result: string;
  legisNum: string | null; billUrl: string | null; rollCallUrl: string; date: string; position: string;
  retrievedAt: string; sourceOrg: string; partyBreakdown: null; billSummary: null; billSummaryPending: false;
  session: string | null; chamber: string | null;
}
export interface NativeMemberVoteRead {
  member: string; status: "HELD" | "NOT_HELD" | "IDENTITY_UNRESOLVED" | "HOLDING_UNAVAILABLE"; authorityScope: string;
  canonicalVersionId: string | null; generatedAt: string | null; votes: NativeReaderVote[];
  unavailableScopes: string[];
  attribution: typeof LEGISCAN_ATTRIBUTION | { text: string; url: string } | null;
}
export interface NativeMemberVoteReaders {
  holder: (id: string) => Promise<SeatHolder | null>;
  nh: typeof readStateMemberVoteSnapshot;
  official: (scope: OfficialStateVoteScope) => Promise<{ snapshot: StateVotesSnapshot; versionId: string | null } | null>;
  plural: typeof readPluralVotesForPerson;
  legiscan: typeof readLegiscanVotesForPerson;
}

const PERSON_ID = /^ocd-person\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultReaders: NativeMemberVoteReaders = {
  holder: seatHolderById,
  nh: readStateMemberVoteSnapshot,
  official: async scope => {
    if (!OFFICIAL_STATE_VOTE_SCOPES.includes(scope)) return null;
    const read = await readOfficialStateVotesProjection(scope);
    if (read.kind === "NOT_RECORDED") return null;
    if (read.kind !== "PROMOTED") throw new Error("OFFICIAL_STATE_VOTES_UNAVAILABLE");
    return { snapshot: read.value, versionId: read.metadata.versionId };
  },
  plural: readPluralVotesForPerson,
  legiscan: readLegiscanVotesForPerson,
};

function exactPersonId(member: string, holder: SeatHolder | null): string | null {
  const uuid = /^plural:(?:[a-z]{2}:)?([0-9a-f-]{36})$/i.exec(member)?.[1];
  const direct = uuid ? `ocd-person/${uuid}` : member;
  if (PERSON_ID.test(direct)) return direct;
  const ids = [...new Set(holder?.nativeIds?.["ocd-person"] ?? [])];
  return ids.length === 1 && PERSON_ID.test(ids[0]) ? ids[0] : null;
}

function nativeMemberId(member: string, holder: SeatHolder | null, source: string): string | null {
  if (member.startsWith(`${source}:`) && member.length > source.length + 1) return member;
  const ids = [...new Set(holder?.nativeIds?.[source] ?? [])];
  return ids.length === 1 && ids[0] ? `${source}:${ids[0]}` : null;
}

function officialRows(snapshot: StateVotesSnapshot, member: string): NativeReaderVote[] {
  const positions = new Map(snapshot.positions.filter(row => row.officeholderId === member)
    .map(row => [row.rollCallId, row.publisherPosition ?? row.position]));
  return snapshot.rollCalls.filter(row => positions.has(row.id)).map(row => ({
    id: row.id, title: row.billTitle, titleSource: "BILL_TITLE", question: row.motion, result: row.result,
    legisNum: row.billNumber || null, billUrl: row.billUrl, rollCallUrl: row.rollCallUrl, date: row.date,
    position: positions.get(row.id)!, retrievedAt: row.retrievedAt, sourceOrg: stateRollPublisher(row),
    session: row.session ?? null, chamber: row.chamber === "Senate" ? "upper" : row.chamber ? "lower" : null,
    partyBreakdown: null, billSummary: null, billSummaryPending: false,
  }));
}

function nationalRows(rows: (PluralVoteFact & { position: string })[], sourceOrg: string): NativeReaderVote[] {
  return rows.map(row => ({
    id: row.id, title: row.billTitle, titleSource: "BILL_TITLE", question: row.motion, result: row.result,
    legisNum: row.billNumber, billUrl: row.sourceUrls[0] ?? null,
    rollCallUrl: row.sourceUrls[0] ?? row.sourceApiUrl, date: row.date, position: row.position,
    retrievedAt: row.retrievedAt, sourceOrg, session: row.session, chamber: row.chamber,
    partyBreakdown: null, billSummary: null, billSummaryPending: false,
  }));
}

/** Compare only complete event fields; repeated events within a source stay distinct. */
function eventKey(row: NativeReaderVote): string | null {
  if (!row.session || !row.chamber || !row.legisNum || !row.question) return null;
  return JSON.stringify([row.session, row.chamber, row.date, row.legisNum.replace(/\s+/g, "").toUpperCase(), row.question]);
}

function preferredRows(groups: NativeReaderVote[][]): NativeReaderVote[] {
  const output: NativeReaderVote[] = [];
  const seenIds = new Set<string>();
  const heldKeys = new Set<string>();
  for (const rows of groups) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = eventKey(row);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const row of rows) {
      const key = eventKey(row);
      if (seenIds.has(row.id) || key && counts.get(key) === 1 && heldKeys.has(key)) continue;
      seenIds.add(row.id);
      output.push(row);
    }
    // An ambiguous same-day pair never authorizes discarding another source's event.
    for (const [key, count] of counts) if (count === 1) heldKeys.add(key);
  }
  return output.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Read one state's exact linked person; independent sources keep their own attribution. */
export async function readNativeMemberVotes(
  member: string,
  readers: NativeMemberVoteReaders = defaultReaders,
  options: { state?: string } = {},
): Promise<NativeMemberVoteRead | null> {
  const state = stateVoteStateForMember(member, options.state);
  if (!state) return null;
  const authorityScope = `US-${state}`;
  const base: NativeMemberVoteRead = { member, authorityScope, canonicalVersionId: null, generatedAt: null,
    status: "NOT_HELD", votes: [], unavailableScopes: [], attribution: null };
  const holder = await readers.holder(member).catch(() => null);
  const personId = exactPersonId(member, holder);
  const target = officialStateRollCallTargetByState(state);
  const native = target ? nativeMemberId(member, holder, target.sourceId) : null;
  if (!personId && !native) return { ...base, status: "IDENTITY_UNRESOLVED" };

  const reads: { scope: string; read: () => Promise<{ votes: NativeReaderVote[]; versionId?: string | null; generatedAt?: string | null }> }[] = [];
  if (native && target) reads.push({ scope: target.jurisdiction, read: async () => {
    const held = target.state === "NH" ? await readers.nh(native) : await readers.official(target.jurisdiction);
    return held ? { votes: officialRows(held.snapshot, native), versionId: held.versionId, generatedAt: held.snapshot.generatedAt } : { votes: [] };
  } });
  if (personId) {
    reads.push({ scope: pluralVotesScope(state), read: async () => ({ votes: nationalRows(await readers.plural(state, personId), "Plural / Open States") }) });
    reads.push({ scope: legiscanVotesScope(state), read: async () => ({ votes: nationalRows(await readers.legiscan(state, personId), `${LEGISCAN_ATTRIBUTION.text} (${LEGISCAN_ATTRIBUTION.licence})`) }) });
  }
  const settled = await Promise.allSettled(reads.map(source => source.read()));
  const groups: NativeReaderVote[][] = [];
  let fulfilled = 0;
  for (const [index, result] of settled.entries()) {
    if (result.status === "rejected") { base.unavailableScopes.push(reads[index].scope); continue; }
    fulfilled++;
    groups.push(result.value.votes);
    base.canonicalVersionId ??= result.value.versionId ?? null;
    const at = result.value.generatedAt;
    if (at && (!base.generatedAt || at > base.generatedAt)) base.generatedAt = at;
  }
  base.votes = preferredRows(groups);
  base.generatedAt = [base.generatedAt, ...base.votes.map(row => row.retrievedAt)].filter((at): at is string => Boolean(at)).sort().at(-1) ?? null;
  base.status = base.votes.length ? "HELD" : fulfilled ? "NOT_HELD" : "HOLDING_UNAVAILABLE";
  base.attribution = base.votes.some(row => row.sourceOrg.startsWith("LegiScan")) ? LEGISCAN_ATTRIBUTION
    : base.votes.some(row => row.sourceOrg === "Plural / Open States") ? { text: "Plural / Open States", url: "https://openstates.org/" } : null;
  return base;
}
