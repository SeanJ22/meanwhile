import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecentVoteRecords, type MemberRollCall } from "../components/map/popup/official-popup.tsx";

import { officialStateRollCallsCandidate } from "../lib/civic-data/candidate-builders.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import {
  buildNjOfficialRollCallProjection,
  currentNjVotingSessionYear,
  decodeNjVoteArchive,
  njMemberVotingRecordsUrl,
  njVoteArchiveDefinitions,
  parseNjMemberVotingRecord,
  parseNjVoteArchive,
  parseNjVotingRecordsIndex,
  validateNjMemberVotingRecordsFinalUrl,
  validateNjVoteArchiveFinalUrl,
  validateNjVotingRecordsIndexFinalUrl,
  type NjFloorArchiveRow,
  type NjMemberVoteRow,
  type NjSessionParticipant,
  type ParsedNjVoteArchive,
} from "../lib/sources/nj-legislature/rollcalls.ts";

const T0 = "2026-09-09T12:00:00.000Z";

function sessionParticipants(): readonly NjSessionParticipant[] {
  return Array.from({ length: 120 }, (_, index) => {
    const assembly = index < 80;
    return {
      rosterKey: 1_001 + index,
      title: assembly ? "Assemblyman" : "Senator",
      house: assembly ? "A" : "S",
      fullName: `Member ${index + 1}, Official`,
      sessionYear: 2026,
      houseDescription: assembly ? "Assembly" : "Senate",
    };
  });
}

function indexBody(participants = sessionParticipants()): string {
  return JSON.stringify([
    [
      { Roster_Key: 999, Title: "Senator ", House: "S", FullName: "Legacy, Pseudo", SessionYear: 9899, HouseDescription: "Senate" },
      ...participants.map((row) => ({
        Roster_Key: row.rosterKey,
        Title: `${row.title} `,
        House: row.house,
        FullName: row.fullName,
        SessionYear: row.sessionYear,
        HouseDescription: row.houseDescription,
      })),
    ],
    [
      { display: "2026-2027 Session", value: 2026 },
      { display: "2024-2025 Session", value: 2024 },
    ],
  ]);
}

function vote(
  participant: NjSessionParticipant,
  input: {
    detailType: "F" | "C";
    bill: string;
    orderedAt: string;
    sequence: number;
    abstract: string;
    action: string;
    publisherPosition: "Yes" | "No" | "Abstain" | "No Vote" | "Not Voting";
    committee?: string;
  },
): Record<string, unknown> {
  const billMatch = /^([A-Z]+)(\d+)$/.exec(input.bill)!;
  return {
    DetailType: input.detailType,
    Roster_Key: participant.rosterKey,
    Bill_Type: billMatch[1],
    Bill_Number: Number(billMatch[2]),
    OrdDateTime: input.orderedAt,
    Seq_Order: input.sequence,
    Session_Date: `${input.orderedAt.slice(5, 7)}/${input.orderedAt.slice(8, 10)}/${input.orderedAt.slice(0, 4)}`,
    Bill: input.bill,
    Abstract: input.abstract,
    Full_Name: participant.fullName,
    TransHouse: input.detailType === "F"
      ? `${participant.houseDescription} `
      : `${participant.houseDescription}  ${input.committee ?? "Judiciary"}`,
    Action: input.action,
    VoteDescription: input.publisherPosition,
    SessionYear: 2026,
    Synopsis: `${input.abstract}.`,
  };
}

function memberBody(participant: NjSessionParticipant, votes: readonly Record<string, unknown>[]): string {
  const parts = participant.fullName.split(",");
  return JSON.stringify([
    [{
      TitleOfLeg: `${participant.title} `,
      ByFirst_Name: parts[1]?.trim() || "Official",
      Suffix: "",
      Roster_District: participant.house === "A" ? ((participant.rosterKey - 1_001) % 40) + 1 : ((participant.rosterKey - 1_081) % 40) + 1,
      Party: participant.rosterKey % 2 === 0 ? "D" : "R",
      Legislative_Position: null,
      MessageTitle: "Member Votes - Floor and Committee - by Bill Number",
      NoVotesMessageTitle: "No Votes Available at this Time.",
      Last_Name: parts[0],
    }],
    votes,
  ]);
}

function csvCell(value: unknown): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function csv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function agendaDate(iso: string): string {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return `${month}/${day}/${iso.slice(0, 4)} ${Number(iso.slice(11, 13))}:${iso.slice(14, 19)}`;
}

function archiveVote(label: string): string {
  if (label === "Yes") return "Y";
  if (label === "No") return "N";
  if (label === "Abstain") return "A";
  return "";
}

function fixture() {
  const index = parseNjVotingRecordsIndex(indexBody(), 2026);
  const rawByKey = new Map<number, readonly Record<string, unknown>[]>();
  const add = (participant: NjSessionParticipant, row: Record<string, unknown>) => {
    rawByKey.set(participant.rosterKey, [...(rawByKey.get(participant.rosterKey) ?? []), row]);
  };
  for (const [positionIndex, participant] of index.participants.entries()) {
    const publisherPosition = positionIndex === 0 ? "Abstain" : positionIndex === 1 ? "No Vote" : positionIndex === 80 ? "Not Voting" : positionIndex % 7 === 0 ? "No" : "Yes";
    add(participant, vote(participant, {
      detailType: "F",
      bill: participant.house === "A" ? "A100" : "S200",
      orderedAt: participant.house === "A" ? "2026-06-01T17:01:02.000Z" : "2026-06-02T18:02:03.000Z",
      sequence: participant.house === "A" ? 10 : 20,
      abstract: participant.house === "A" ? "Assembly floor control" : "Senate floor control",
      action: "3RDG FINAL PASSAGE",
      publisherPosition,
    }));
  }
  for (const participant of index.participants.filter(({ house }) => house === "A").slice(0, 3)) {
    add(participant, vote(participant, {
      detailType: "C", bill: "A300", orderedAt: "2026-06-03T10:00:00.000Z", sequence: 0,
      abstract: "Assembly committee control", action: "r/favorably", publisherPosition: participant.rosterKey % 2 ? "Yes" : "Abstain", committee: "Appropriations",
    }));
  }
  for (const participant of index.participants.filter(({ house }) => house === "S").slice(0, 2)) {
    add(participant, vote(participant, {
      detailType: "C", bill: "S400", orderedAt: "2026-06-04T13:00:00.000Z", sequence: 0,
      abstract: "Senate committee control", action: "r/Sca", publisherPosition: participant.rosterKey % 2 ? "No" : "Not Voting", committee: "Budget and Appropriations",
    }));
  }
  const memberBodies = index.participants.map((participant) => memberBody(participant, rawByKey.get(participant.rosterKey) ?? []));
  const memberRecords = index.participants.map((participant, index) => parseNjMemberVotingRecord(
    memberBodies[index]!, participant, 2026,
  ));
  const apiRows = memberRecords.flatMap(({ votes }) => votes);
  const definitions = njVoteArchiveDefinitions(2026);
  const archiveBodies: string[] = [];
  const archives = definitions.map((definition) => {
    const rows = apiRows.filter((row) => row.detailType === definition.detailType && row.transHouse.startsWith(definition.chamber));
    const raw = definition.detailType === "F"
      ? csv(
        ["Bill", "Full_Name", "Session_Date", "CurrentStatus", "Abstract", "Action", "Legislator_Vote"],
        rows.map((row) => [row.bill, row.fullName, `${row.sessionDate.slice(5, 7)}/${row.sessionDate.slice(8, 10)}/${row.sessionDate.slice(0, 4)}`, "2RS", row.abstract, row.action, archiveVote(row.publisherPosition)]),
      )
      : csv(
        ["Bill_Type", "Bill_Number", "Abstract", "Agenda_Date", "Committee_House", "Agenda_Type", "Agenda_Sequence", "BillAction", "Name", "Party", "LegislatorVote"],
        rows.map((row) => [row.billType, row.billNumber, row.abstract, agendaDate(row.orderedAt), definition.chamber === "Assembly" ? "AAP" : "SBA", "M", 0, row.action, row.fullName, row.rosterKey % 2 === 0 ? "D" : "R", row.publisherPosition === "No Vote" || row.publisherPosition === "Not Voting" ? "" : row.publisherPosition]),
      );
    archiveBodies.push(raw);
    return parseNjVoteArchive(raw, definition, 2026);
  });
  return { index, memberBodies, memberRecords, archiveBodies, archives };
}

/**
 * Independent ZIP-fixture oracle. Importing the production checksum would let
 * the decoder manufacture the CRC it is meant to verify in this test.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entryName: string, content: string): Uint8Array {
  const name = Buffer.from(entryName, "utf8");
  const data = Buffer.from(content, "utf8");
  const local = Buffer.alloc(30 + name.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  data.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

test("NJ session admission selects the named current session instead of pseudo-year numeric maxima", () => {
  assert.equal(currentNjVotingSessionYear("2026-01-12T12:00:00.000Z"), 2024);
  assert.equal(currentNjVotingSessionYear("2026-01-13T12:00:00.000Z"), 2026);
  const parsed = parseNjVotingRecordsIndex(indexBody(), 2026);
  assert.equal(parsed.session.value, 2026);
  assert.equal(parsed.participants.length, 120);
  assert.deepEqual(parsed.participants.map(({ house }) => house).reduce((counts, house) => ({ ...counts, [house]: (counts[house] ?? 0) + 1 }), {} as Record<string, number>), { A: 80, S: 40 });
  assert.match(parsed.participantSourceVersion, /^[a-f0-9]{64}$/);
});

test("NJ registered endpoints reject redirects, query broadening, and cross-member final URLs", () => {
  const archive = njVoteArchiveDefinitions(2026)[0]!;
  assert.equal(validateNjVotingRecordsIndexFinalUrl("https://www.njleg.state.nj.us/api/votingRecords"), "https://www.njleg.state.nj.us/api/votingRecords");
  assert.equal(validateNjMemberVotingRecordsFinalUrl(njMemberVotingRecordsUrl(2026, 1001), 2026, 1001), njMemberVotingRecordsUrl(2026, 1001));
  assert.equal(validateNjVoteArchiveFinalUrl(archive.url, archive), archive.url);
  assert.throws(() => validateNjVotingRecordsIndexFinalUrl("https://www.njleg.state.nj.us/api/votingRecords?year=2026"), /expected/);
  assert.throws(() => validateNjMemberVotingRecordsFinalUrl(njMemberVotingRecordsUrl(2026, 1002), 2026, 1001), /expected/);
  assert.throws(() => validateNjVoteArchiveFinalUrl("https://example.org/A2026.zip", archive), /expected/);
});

test("NJ ZIP admission proves the one exact entry, size, CRC, and UTF-8 body", () => {
  const content = '"Bill","Full_Name"\r\n"A1","Official, One"\r\n';
  const zip = storedZip("A2026.txt", content);
  assert.equal(decodeNjVoteArchive(zip, "A2026.txt"), content);
  const corrupt = new Uint8Array(zip);
  corrupt[30 + Buffer.byteLength("A2026.txt") + 1] ^= 1;
  assert.throws(() => decodeNjVoteArchive(corrupt, "A2026.txt"), /CRC/);
  assert.throws(() => decodeNjVoteArchive(storedZip("other.txt", content), "A2026.txt"), /unexpected entry/);
});

test("NJ biennial archives admit both session years and reject dates outside the exact term", () => {
  const [floor, , committee] = njVoteArchiveDefinitions(2026);
  assert.ok(floor);
  assert.ok(committee);
  const floor2027 = parseNjVoteArchive(csv(
    ["Bill", "Full_Name", "Session_Date", "CurrentStatus", "Abstract", "Action", "Legislator_Vote"],
    [["A1", "Member, Official", "1/12/2027", "2RS", "Biennial floor", "3RDG FINAL PASSAGE", "A"]],
  ), floor, 2026);
  const committee2027 = parseNjVoteArchive(csv(
    ["Bill_Type", "Bill_Number", "Abstract", "Agenda_Date", "Committee_House", "Agenda_Type", "Agenda_Sequence", "BillAction", "Name", "Party", "LegislatorVote"],
    [["A", 2, "Biennial committee", "1/13/2027 10:00:00", "AAP", "M", 0, "r/favorably", "Member, Official", "D", "Abstain"]],
  ), committee, 2026);
  assert.equal(floor2027.rows[0] && "sessionDate" in floor2027.rows[0] ? floor2027.rows[0].sessionDate : null, "2027-01-12");
  assert.equal(committee2027.rows[0] && "agendaDate" in committee2027.rows[0] ? committee2027.rows[0].agendaDate : null, "2027-01-13T10:00:00.000Z");
  assert.throws(() => parseNjVoteArchive(csv(
    ["Bill", "Full_Name", "Session_Date", "CurrentStatus", "Abstract", "Action", "Legislator_Vote"],
    [["A1", "Member, Official", "1/12/2028", "2RS", "Wrong term", "3RDG FINAL PASSAGE", "Y"]],
  ), floor, 2026), /biennial-session date/);
});

test("NJ API and all four archives reconcile exactly before producing a promotable projection", () => {
  const source = fixture();
  const built = buildNjOfficialRollCallProjection({ ...source, retrievedAt: T0 });
  assert.equal(built.rolls.length, 4);
  assert.equal(built.positions.length, 125);
  assert.equal(built.participantIds.length, 120);
  assert.equal(built.sourceAudit.expectedParticipantRequests, 120);
  assert.equal(built.sourceAudit.completedParticipantRequests, 120);
  assert.equal(built.sourceAudit.apiPositions, 125);
  assert.equal(built.sourceAudit.reconciledArchivePositions, 125);
  assert.deepEqual(built.sourceAudit.archives.map(({ rollCalls, positions }) => [rollCalls, positions]), [[1, 80], [1, 40], [1, 3], [1, 2]]);
  assert.equal(built.positions.find(({ publisherPosition }) => publisherPosition === "Abstain")?.position, "ABSTAIN");
  assert.equal(built.positions.find(({ publisherPosition }) => publisherPosition === "Not Voting")?.position, "NOT_VOTING");
  assert.ok(built.rolls.every(({ rollCallUrl }) => rollCallUrl.startsWith("https://pub.njleg.gov/votes/")));

  const candidateInput = {
    sourceId: "nj-legislature",
    jurisdiction: "US-NJ",
    rawBodies: [indexBody(), ...source.memberBodies, ...source.archiveBodies],
    requestedUrl: "https://www.njleg.state.nj.us/api/votingRecords",
    finalUrl: "https://www.njleg.state.nj.us/api/votingRecords",
    httpStatus: 200,
    retrievedAt: T0,
    term: "2026-2027",
    expectedTerm: "2026-2027",
    session: "2026-2027 Session",
    rolls: built.rolls,
    positions: built.positions,
    declaredRollTotal: built.rolls.length,
    horizonAudit: { authorityMode: "API_ARCHIVE_EXACT_RECONCILIATION", ...built.sourceAudit },
    identityAuthority: {
      contractId: "nj-state-legislators",
      versionId: "canonical-nj-roster-version",
      currentOfficeholderIds: built.participantIds,
      sessionParticipantIds: built.participantIds,
      sessionParticipantSourceVersion: built.participantSourceVersion,
    },
  } satisfies Parameters<typeof officialStateRollCallsCandidate>[0];
  const candidate = officialStateRollCallsCandidate(candidateInput);
  assert.deepEqual(candidate.semantics.violations, []);
  assert.equal(candidate.horizon.returnedRecords, 129);
  assert.equal(candidate.horizon.declaredTotal, 129);

  const wrongTally = officialStateRollCallsCandidate({
    ...candidateInput,
    rolls: candidateInput.rolls.map((roll, index) => index === 0
      ? { ...roll, publisherTally: { ...roll.publisherTally, Abstain: (roll.publisherTally?.Abstain ?? 0) + 1 } }
      : roll),
  });
  assert.match(wrongTally.semantics.violations.join("\n"), /publisher vocabulary, and reconciled per-roll tallies/);
});

test("NJ partial member acquisition and any API/archive disagreement fail closed", () => {
  const good = fixture();
  assert.throws(
    () => buildNjOfficialRollCallProjection({ ...good, memberRecords: good.memberRecords.slice(0, -1), retrievedAt: T0 }),
    /member responses are 119\/120/,
  );
  const archives: ParsedNjVoteArchive[] = structuredClone(good.archives);
  const floor = archives[0]! as ParsedNjVoteArchive & { readonly rows: readonly NjFloorArchiveRow[] };
  if (floor.definition.detailType !== "F") throw new Error("fixture floor archive missing");
  const rows: NjFloorArchiveRow[] = [...floor.rows];
  rows[0] = { ...rows[0]!, voteCode: rows[0]!.voteCode === "Y" ? "N" : "Y" };
  archives[0] = { ...floor, rows };
  assert.throws(
    () => buildNjOfficialRollCallProjection({ ...good, archives, retrievedAt: T0 }),
    /API\/archive position multiset disagrees/,
  );
});

test("ready Arizona native votes replace the retired landing-page probe", () => {
  const nj = ROUTINE_SOURCE_CONTRACTS.find(({ id }) => id === "nj-state-rollcalls");
  const az = ROUTINE_SOURCE_CONTRACTS.find(({ id }) => id === "openstates-votes-az");
  assert.ok(nj);
  assert.ok(az);
  assert.equal(az.sourceId, "plural-openstates-votes");
  assert.equal(az.scope, "US-AZ:openstates-votes:v1");
  assert.deepEqual(az.acquisitionAdapter.command, ["scripts/openstates-votes-refresh.mts", "--promote", "--state=az"]);
  assert.equal(ROUTINE_SOURCE_CONTRACTS.some(({ id }) => id === "az-state-rollcalls"), false);
});

test("ABSTAIN remains its own exact Reader disposition in rendered and census paths", () => {
  const vote: MemberRollCall = { id: "synthetic:abstain", title: "Synthetic abstention rendering case", titleSource: "BILL_TITLE",
    question: "Third reading", result: "Passed", date: "2026-09-01", position: "ABSTAIN", legisNum: "S 1",
    billUrl: null, rollCallUrl: "https://example.gov/roll", retrievedAt: T0, partyBreakdown: null, billSummary: null, billSummaryPending: false };
  const html = renderToStaticMarkup(createElement(RecentVoteRecords, { votes: [vote], attribution: null, failed: false, reactionContext: null }));
  assert.match(html, /vote-pill--neutral[^>]*>Abstained</);
  assert.doesNotMatch(html, /Did not vote/);
});
