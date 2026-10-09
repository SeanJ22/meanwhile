import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNhOfficialRollCallProjection,
  decodeNhPublisherBytes,
  joinNhCurrentMemberIdentities,
  NH_PUBLISHER_REQUEST_DELAY_MS,
  nhParticipantSourceVersion,
  parseNhLegislators,
  parseNhRollCallHistory,
  parseNhRollCallSummary,
  readNhOfficialDocumentsSerially,
  type NhLegislatorIdentityRow,
} from "../lib/sources/nh-general-court/official-data.ts";
import type { GencourtMember, MembersExtraction } from "../scripts/nh-gencourt-members.mts";

const SUMMARY = [
  "\uFEFF2026|H|1|1/7/2026 11:12:09 AM|HB1|1|1|2|1|||OTPA|official House title||",
  "2026|S|62|5/14/2026 2:05:00 PM|HB2|1|1|2|1|||OTP|official Senate title||",
].join("\r\n");

const HISTORY = [
  "\uFEFF2026|H|1|1001|1|HB1|Yea|",
  "2026|H|1|1002|2|HB1|Nay|",
  "2026|H|1|1003|3|HB1|Not Voting/Excused|",
  "2026|H|1|1004|4|HB1|Not Voting/Not Excused|",
  "2026|H|1|1005|5|HB1|Presiding|",
  "2026|S|62|1001|1|HB2|Yea|",
  "2026|S|62|1002|2|HB2|Nay|",
  "2026|S|62|1003|3|HB2|Not Voting/Excused|",
  "2026|S|62|1006|6|HB2||5/15/2026 8:31:40 AM",
].join("\r\n");

function legislatorLine(personId: string, familyName: string, givenName: string, body: "H" | "S", email = ""): string {
  return [personId, familyName, givenName, "", body, body === "H" ? `30${personId}` : "", "7", personId, "R", "", "", "Concord", "NH", "03301", email].join("|");
}

const LEGISLATORS = [
  legislatorLine("1", "Current", "One", "H", "one@gc.nh.gov"),
  legislatorLine("2", "Current", "Two", "H", "two@gc.nh.gov"),
  legislatorLine("3", "Current", "Three", "H", "three@gc.nh.gov"),
  legislatorLine("4", "Current", "Four", "H", "four@gc.nh.gov"),
  legislatorLine("5", "Current", "Five", "H", "five@gc.nh.gov"),
  // PersonID 6 is deliberately outside a current roster: historical/session
  // participants are source-versioned independently rather than discarded.
  legislatorLine("6", "Former", "Participant", "S", "former@gc.nh.gov"),
].join("\r\n");

test("NH publisher bytes strip a UTF-8 BOM and preserve Windows-1252 text", () => {
  const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x52, 0x69, 0x63, 0x68, 0xe9]);
  assert.equal(decodeNhPublisherBytes(bytes), "Riché");
});

test("NH same-host reads are serial with the publisher's fixed 11-second delay and a no-sleep test seam", async () => {
  const events: string[] = [];
  const values = await readNhOfficialDocumentsSerially(
    ["summary", "history", "people"],
    async (url) => {
      events.push(`read:${url}`);
      return url;
    },
    {
      sleep: async (ms) => {
        events.push(`sleep:${ms}`);
      },
    },
  );
  assert.deepEqual(values, ["summary", "history", "people"]);
  assert.deepEqual(events, [
    "read:summary",
    `sleep:${NH_PUBLISHER_REQUEST_DELAY_MS}`,
    "read:history",
    `sleep:${NH_PUBLISHER_REQUEST_DELAY_MS}`,
    "read:people",
  ]);
});

test("NH 2026 roll exports reconcile every source row and preserve publisher blank as UNKNOWN", () => {
  const projection = buildNhOfficialRollCallProjection({
    summaries: parseNhRollCallSummary(SUMMARY),
    history: parseNhRollCallHistory(HISTORY),
    legislators: parseNhLegislators(LEGISLATORS),
    retrievedAt: "2026-09-09T12:00:00.000Z",
    participantSourceVersion: nhParticipantSourceVersion(HISTORY),
  });
  assert.equal(projection.rolls.length, 2);
  assert.equal(projection.positions.length, 9);
  assert.deepEqual(projection.rolls[0]?.publisherTally, { Yea: 1, Nay: 1, Present: 2, Absent: 1 });
  assert.deepEqual(projection.rolls[1]?.publisherTally, { Yea: 1, Nay: 1, Present: 2, Absent: 1 });
  assert.equal(projection.rolls[0]?.nv, 3);
  assert.equal(projection.rolls[1]?.nv, 2);
  const blank = projection.positions.find((row) => row.officialPersonId === "6");
  assert.equal(blank?.publisherPosition, "");
  assert.equal(blank?.position, "UNKNOWN");
  assert.ok(projection.participantIds.includes("nh-general-court:6"), "a former current-roster member remains in the exact session participant set");
  assert.deepEqual(projection.participantAudit, {
    historyParticipantCount: 6,
    legislatorsIdentityCount: 6,
    enrichedParticipantCount: 6,
    historyOnlyParticipantCount: 0,
    historyOnlyPersonIds: [],
  });
  assert.match(projection.participantSourceVersion, /^[0-9a-f]{64}$/);
});

test("NH roll parsing fails closed on duplicates, orphan rolls, pair conflicts, unknown labels, and tally loss", () => {
  assert.throws(() => parseNhRollCallSummary("\r\n"), /contains no logical rows/);
  assert.throws(() => parseNhRollCallSummary(`${SUMMARY}\r\n${SUMMARY.split("\r\n")[0]!.replace(/^\uFEFF/, "")}`), /repeats 2026:H:1/);
  assert.throws(() => parseNhRollCallHistory(HISTORY.replace("|Yea|", "|Maybe|")), /unknown publisher vote label/);
  const parsedSummary = parseNhRollCallSummary(SUMMARY);
  const parsedHistory = parseNhRollCallHistory(HISTORY);
  const parsedLegislators = parseNhLegislators(LEGISLATORS);
  assert.throws(() => buildNhOfficialRollCallProjection({
    summaries: parsedSummary,
    history: parseNhRollCallHistory(HISTORY.replace("2026|H|1|1002|2", "2026|H|9|1002|2")),
    legislators: parsedLegislators,
    retrievedAt: "2026-09-09T12:00:00.000Z",
    participantSourceVersion: nhParticipantSourceVersion(HISTORY),
  }), /outside RollCallSummary/);
  const historyOnly = buildNhOfficialRollCallProjection({
    summaries: parsedSummary,
    history: parsedHistory,
    legislators: parsedLegislators.filter((row) => row.personId !== "6"),
    retrievedAt: "2026-09-09T12:00:00.000Z",
    participantSourceVersion: nhParticipantSourceVersion(HISTORY),
  });
  assert.deepEqual(historyOnly.participantAudit.historyOnlyPersonIds, ["6"]);
  assert.ok(historyOnly.positions.some((row) => row.officialPersonId === "6"), "a history-only official pair is preserved, never dropped");
  assert.throws(() => buildNhOfficialRollCallProjection({
    summaries: parsedSummary,
    history: parsedHistory.slice(1),
    legislators: parsedLegislators,
    retrievedAt: "2026-09-09T12:00:00.000Z",
    participantSourceVersion: nhParticipantSourceVersion(HISTORY),
  }), /Yea\/Nay positions do not reconcile/);
  assert.throws(() => parseNhRollCallHistory(`${HISTORY}\r\n${HISTORY.split("\r\n")[0]!.replace(/^\uFEFF/, "")}`), /repeats person\/roll position/);
  assert.throws(() => buildNhOfficialRollCallProjection({
    summaries: parsedSummary,
    history: parsedHistory.map((row, index) => index === 1 ? { ...row, employeeNumber: "1001" } : row),
    legislators: parsedLegislators,
    retrievedAt: "2026-09-09T12:00:00.000Z",
    participantSourceVersion: nhParticipantSourceVersion(HISTORY),
  }), /not one-to-one/);
});

function currentMember(index: number): GencourtMember {
  return {
    chamber: "H",
    familyName: `Family-${index}`,
    givenName: `Given-${index}`,
    middleName: null,
    seatNo: String(10_000 + index),
    county: "Merrimack",
    district: String((index % 20) + 1),
    electedStatus: "INCUMBENT",
    party: "R",
    title: "Representative",
    phone: null,
    email: `person-${index}@gc.nh.gov`,
    town: "Concord",
    committees: [],
  };
}

function identityForMember(member: GencourtMember, personId: string): NhLegislatorIdentityRow {
  return {
    personId,
    familyName: member.familyName,
    givenName: member.givenName,
    middleName: member.middleName ?? "",
    legislativeBody: "H",
    seatNo: member.seatNo,
    countyCode: "7",
    district: member.district,
    party: "R",
    address1: "",
    address2: "",
    city: "Concord",
    state: "NH",
    zip: "03301",
    email: member.email ?? "",
  };
}

test("NH current roster replaces synthetic IDs with 386 strict official joins plus two exact reviewed publisher exceptions", () => {
  const ordinary = Array.from({ length: 386 }, (_, index) => currentMember(index + 1));
  const charlie: GencourtMember = {
    ...currentMember(387), familyName: "St. Clair", givenName: "Charlie", middleName: "G.",
    seatNo: "4092", county: "Belknap", district: "5", email: "charlie.stclair@gc.nh.gov",
  };
  const michael: GencourtMember = {
    ...currentMember(388), familyName: "Vose", givenName: "Michael", middleName: null,
    seatNo: "3042", county: "Rockingham", district: "5", email: "michael.vose@gc.nh.gov",
  };
  const identityRows = [
    ...ordinary.map((member, index) => identityForMember(member, String(index + 1))),
    { ...identityForMember(charlie, "8956"), familyName: "publisher-exception-8956", email: "" },
    { ...identityForMember(michael, "909"), familyName: "publisher-exception-909", email: "" },
  ];
  const exceptionHistoryText = [
    "2026|H|1|408811|8956||Yea|",
    "2026|H|1|377272|909||Nay|",
  ].join("\r\n");
  const exceptionHistory = parseNhRollCallHistory(exceptionHistoryText);
  const extraction: Pick<MembersExtraction, "members"> = { members: [...ordinary, charlie, michael] };
  const joined = joinNhCurrentMemberIdentities(extraction, identityRows, "exact official identity bytes", exceptionHistory, exceptionHistoryText);
  assert.equal(joined.matches.length, 388);
  assert.equal(joined.ordinaryMatches, 386);
  assert.equal(joined.reviewedExceptionMatches, 2);
  assert.equal(joined.matches.at(-2)?.officeholderId, "nh-general-court:8956");
  assert.equal(joined.matches.at(-1)?.officeholderId, "nh-general-court:909");

  const partial = joinNhCurrentMemberIdentities(
    extraction,
    identityRows.filter((row) => row.personId !== "8956"),
    "missing exact official row",
    exceptionHistory.filter((row) => row.personId !== "8956"),
    "missing exact official history pair",
  );
  assert.equal(partial.matches.length,387);
  assert.ok(partial.unresolved?.some(row=>row.includes("lacks exact official History pair")));
});

test("NH source session years advance without changing code and mixed sessions remain refused", () => {
  const summary = SUMMARY.replaceAll("2026", "2027"), history = HISTORY.replaceAll("2026", "2027");
  const input = { summaries: parseNhRollCallSummary(summary), history: parseNhRollCallHistory(history),
    legislators: parseNhLegislators(LEGISLATORS), retrievedAt: "2027-09-09T12:00:00.000Z", participantSourceVersion: nhParticipantSourceVersion(history) };
  assert.ok(buildNhOfficialRollCallProjection(input).rolls.every(roll => roll.term === "2027" && roll.id.includes(":2027:")));
  assert.throws(() => buildNhOfficialRollCallProjection({ ...input, history: parseNhRollCallHistory(HISTORY) }), /exact source session year/);
});
