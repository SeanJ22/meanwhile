import { readStateMemberVoteSnapshot } from "./member-votes.ts";
import { readArizonaPluralVotesForPerson, AZ_PLURAL_VOTES_SCOPE } from "../sources/plural/votes.ts";
import { seatHolderById } from "../registry/server.ts";
import type { SeatHolder } from "../officials/lookup.ts";

export interface NativeReaderVote {
  id: string; title: string; titleSource: "BILL_TITLE"; question: string; result: string;
  legisNum: string | null; billUrl: string | null; rollCallUrl: string; date: string; position: string;
  retrievedAt: string; sourceOrg: string; partyBreakdown: null; billSummary: null; billSummaryPending: false;
}
export interface NativeMemberVoteRead {
  member: string; status: "HELD" | "NOT_HELD" | "IDENTITY_UNRESOLVED"; authorityScope: string;
  canonicalVersionId: string | null; generatedAt: string | null; votes: NativeReaderVote[];
}
export interface NativeMemberVoteReaders {
  holder: (id: string) => Promise<SeatHolder | null>;
  nh: typeof readStateMemberVoteSnapshot;
  az: typeof readArizonaPluralVotesForPerson;
}

/** These source scopes publish independently of a complete state/session fan-out. */
export async function readNativeMemberVotes(member: string, readers: NativeMemberVoteReaders = {
  holder: seatHolderById, nh: readStateMemberVoteSnapshot, az: readArizonaPluralVotesForPerson,
}): Promise<NativeMemberVoteRead | null> {
  const state = /^(?:plural:|)(az|nh)(?::|-legislature:|-general-court:)/.exec(member)?.[1];
  if (!state) return null;
  const authorityScope = state === "az" ? AZ_PLURAL_VOTES_SCOPE : "US-NH";
  const base = { member, authorityScope, canonicalVersionId: null, generatedAt: null, votes: [] };
  if (state === "nh") {
    const native = /^nh-general-court:\d+$/.test(member) ? member : await readers.holder(member).then(holder => {
      const ids = holder?.nativeIds?.["nh-general-court"] ?? [];
      return ids.length === 1 && /^\d+$/.test(ids[0]) ? `nh-general-court:${ids[0]}` : null;
    });
    if (!native) return { ...base, status: "IDENTITY_UNRESOLVED" };
    const held = await readers.nh(native);
    if (!held) return { ...base, status: "NOT_HELD" };
    const positions = new Map(held.snapshot.positions.map(row => [row.rollCallId, row.publisherPosition ?? row.position]));
    return { ...base, status: "HELD", canonicalVersionId: held.versionId, generatedAt: held.snapshot.generatedAt,
      votes: held.snapshot.rollCalls.filter(row => positions.has(row.id)).map((row): NativeReaderVote => ({ id: row.id, title: row.billTitle,
        titleSource: "BILL_TITLE", question: row.motion, result: row.result, legisNum: row.billNumber || null,
        billUrl: row.billUrl, rollCallUrl: row.rollCallUrl, date: row.date, position: positions.get(row.id)!,
        retrievedAt: row.retrievedAt, sourceOrg: "New Hampshire General Court", partyBreakdown: null, billSummary: null, billSummaryPending: false,
      })).sort((a, b) => b.date.localeCompare(a.date)) };
  }
  const uuid = /^plural:az:([0-9a-f-]{36})$/.exec(member)?.[1];
  const personId = uuid ? `ocd-person/${uuid}` : await readers.holder(member).then(holder => {
    const ids = holder?.nativeIds?.["ocd-person"] ?? [];
    return ids.length === 1 ? ids[0] : null;
  });
  if (!personId) return { ...base, status: "IDENTITY_UNRESOLVED" };
  const rows = await readers.az(personId);
  return { ...base, status: rows.length ? "HELD" : "NOT_HELD", generatedAt: rows.map(row => row.retrievedAt).sort().at(-1) ?? null,
    votes: rows.map(row => ({ id: row.id, title: row.billTitle, titleSource: "BILL_TITLE", question: row.motion,
      result: row.result, legisNum: row.billNumber, billUrl: row.sourceUrls[0] ?? null, rollCallUrl: row.sourceUrls[0] ?? row.sourceApiUrl,
      date: row.date, position: row.position, retrievedAt: row.retrievedAt, sourceOrg: "Plural / Open States",
      partyBreakdown: null, billSummary: null, billSummaryPending: false })) };
}
