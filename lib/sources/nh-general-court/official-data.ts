import { createHash } from "node:crypto";

import type { GencourtMember, MembersExtraction } from "../../../scripts/nh-gencourt-members.mts";
import { sourceAcquisitionFailure } from "../../civic-data/source-acquisition-failure.ts";
import { officialStateOfficeholderId } from "../../state-rollcalls/authority.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";
import type { StateMemberVote, StateRollCall } from "../legiscan/types.ts";

export const NH_MEMBERS_URL = "https://gc.nh.gov/downloads/Members.txt";
export const NH_ROLL_SUMMARY_URL = "https://gc.nh.gov/dynamicdatadump/RollCallSummary.txt";
export const NH_ROLL_HISTORY_URL = "https://gc.nh.gov/dynamicdatadump/RollCallHistory.txt";
export const NH_LEGISLATORS_URL = "https://gc.nh.gov/dynamicdatadump/legislators.txt";
export const NH_PUBLISHER_REQUEST_DELAY_MS = 11_000;
const INVALID_PUBLISHER_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\uFFFD]/;

export interface NhOfficialDocument {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly body: string;
  readonly retrievedAt?:string;
  readonly sourceCheck?:import("../../civic-data/types.ts").SourceCheckEvidence;
}

/**
 * Execute one same-host request at a time and honor the publisher's eleven
 * second crawl delay. Tests inject a settling sleep; production cannot lower
 * the delay because the duration is not an argument.
 */
export async function readNhOfficialDocumentsSerially<T>(
  urls: readonly string[],
  read: (url: string, index: number) => Promise<T>,
  options: {
    readonly signal?: AbortSignal;
    readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
): Promise<readonly T[]> {
  const sleep = options.sleep ?? sourceAcquisitionSleep;
  const records: T[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    if (index > 0) await sleep(NH_PUBLISHER_REQUEST_DELAY_MS, options.signal);
    options.signal?.throwIfAborted();
    records.push(await read(urls[index]!, index));
    options.signal?.throwIfAborted();
  }
  return records;
}

/** Windows-1252 is the publisher's actual byte encoding; UTF-8 is lossy here. */
export function decodeNhPublisherBytes(bytes: ArrayBuffer | Uint8Array): string {
  const full = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // The live dumps carry a UTF-8 BOM in front of Windows-1252-compatible
  // rows. Strip the byte marker before decoding the actual publisher bytes.
  const view = full[0] === 0xef && full[1] === 0xbb && full[2] === 0xbf ? full.subarray(3) : full;
  const text = new TextDecoder("windows-1252").decode(view).replace(/^\uFEFF/, "");
  if (INVALID_PUBLISHER_TEXT.test(text)) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      "NH General Court export contains an undecodable or NUL byte.",
    );
  }
  return text;
}

function fail(detail: string): never {
  throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `NH General Court export: ${detail}`);
}

function exactLines(text: string, label: string): readonly string[] {
  const body = text.replace(/^\uFEFF/, "");
  if (INVALID_PUBLISHER_TEXT.test(body)) fail(`${label} contains invalid text bytes.`);
  const lines = body.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) fail(`${label} contains no logical rows.`);
  return lines;
}

function unsignedInteger(raw: string, field: string, allowZero = true): number {
  if (!/^\d+$/.test(raw)) fail(`${field} is not an unsigned integer: ${JSON.stringify(raw)}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (!allowZero && value === 0)) {
    fail(`${field} is outside the supported integer range: ${JSON.stringify(raw)}.`);
  }
  return value;
}

function sourceDate(raw: string, key: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)$/i.exec(raw.trim());
  if (!match) fail(`${key} has an unsupported publisher date: ${JSON.stringify(raw)}.`);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    fail(`${key} has an impossible publisher date: ${JSON.stringify(raw)}.`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface NhRollSummaryRow {
  readonly sessionYear: string;
  readonly legislativeBody: "H" | "S";
  readonly voteSequenceNumber: number;
  readonly voteDate: string;
  readonly condensedBillNo: string;
  readonly yea: number;
  readonly nay: number;
  /** Publisher field whose semantics differ by chamber; never reinterpreted. */
  readonly present: number;
  readonly absent: number;
  readonly titleCode1: string;
  readonly titleCode2: string;
  readonly motion: string;
  readonly billTitle: string;
  readonly secondaryTitle: string;
  readonly lastModified: string;
}

export interface NhRollHistoryRow {
  readonly sessionYear: string;
  readonly legislativeBody: "H" | "S";
  readonly voteSequenceNumber: number;
  readonly employeeNumber: string;
  readonly personId: string;
  readonly condensedBillNo: string;
  readonly vote: NhPublisherVoteLabel;
  readonly lastModified: string;
}

export interface NhLegislatorIdentityRow {
  readonly personId: string;
  readonly familyName: string;
  readonly givenName: string;
  readonly middleName: string;
  readonly legislativeBody: "H" | "S";
  readonly seatNo: string;
  readonly countyCode: string;
  readonly district: string;
  readonly party: string;
  readonly address1: string;
  readonly address2: string;
  readonly city: string;
  readonly state: string;
  readonly zip: string;
  readonly email: string;
}

export const NH_PUBLISHER_VOTE_LABELS = [
  "Yea",
  "Nay",
  "Not Voting/Excused",
  "Not Voting/Not Excused",
  "Presiding",
  "",
] as const;
export type NhPublisherVoteLabel = (typeof NH_PUBLISHER_VOTE_LABELS)[number];

function exactBody(raw: string, key: string): "H" | "S" {
  if (raw !== "H" && raw !== "S") fail(`${key} has unsupported legislative body ${JSON.stringify(raw)}.`);
  return raw;
}

function exactSessionYear(raw: string, key: string): string {
  if (!/^20\d{2}$/.test(raw)) fail(`${key} has an invalid source session year ${JSON.stringify(raw)}.`);
  return raw;
}

export function parseNhRollCallSummary(text: string): readonly NhRollSummaryRow[] {
  const rows: NhRollSummaryRow[] = [];
  const keys = new Set<string>();
  for (const [index, line] of exactLines(text, "RollCallSummary.txt").entries()) {
    const fields = line.split("|");
    if (fields.length !== 15) fail(`RollCallSummary.txt row ${index + 1} has ${fields.length} fields, expected 15.`);
    const sessionYear = exactSessionYear(fields[0]!, `summary row ${index + 1}`);
    const legislativeBody = exactBody(fields[1]!, `summary row ${index + 1}`);
    const voteSequenceNumber = unsignedInteger(fields[2]!, `summary row ${index + 1} sequence`, false);
    const key = `${sessionYear}:${legislativeBody}:${voteSequenceNumber}`;
    if (keys.has(key)) fail(`RollCallSummary.txt repeats ${key}.`);
    keys.add(key);
    const motion = fields[11]!.trim();
    if (motion === "") fail(`RollCallSummary.txt ${key} has no exact publisher motion.`);
    rows.push({
      sessionYear,
      legislativeBody,
      voteSequenceNumber,
      voteDate: fields[3]!.trim(),
      condensedBillNo: fields[4]!.trim(),
      yea: unsignedInteger(fields[5]!, `${key} yea`),
      nay: unsignedInteger(fields[6]!, `${key} nay`),
      present: unsignedInteger(fields[7]!, `${key} present`),
      absent: unsignedInteger(fields[8]!, `${key} absent`),
      titleCode1: fields[9]!.trim(),
      titleCode2: fields[10]!.trim(),
      motion,
      billTitle: fields[12]!.trim(),
      secondaryTitle: fields[13]!.trim(),
      lastModified: fields[14]!.trim(),
    });
  }
  return rows;
}

export function parseNhRollCallHistory(text: string): readonly NhRollHistoryRow[] {
  const rows: NhRollHistoryRow[] = [];
  const keys = new Set<string>();
  for (const [index, line] of exactLines(text, "RollCallHistory.txt").entries()) {
    const fields = line.split("|");
    if (fields.length !== 8) fail(`RollCallHistory.txt row ${index + 1} has ${fields.length} fields, expected 8.`);
    const sessionYear = exactSessionYear(fields[0]!, `history row ${index + 1}`);
    const legislativeBody = exactBody(fields[1]!, `history row ${index + 1}`);
    const voteSequenceNumber = unsignedInteger(fields[2]!, `history row ${index + 1} sequence`, false);
    const employeeNumber = fields[3]!.trim();
    const personId = fields[4]!.trim();
    if (!/^\d+$/.test(employeeNumber) || !/^\d+$/.test(personId)) {
      fail(`history row ${index + 1} lacks exact numeric EmployeeNumber/PersonID.`);
    }
    const vote = fields[6]! as NhPublisherVoteLabel;
    if (!(NH_PUBLISHER_VOTE_LABELS as readonly string[]).includes(vote)) {
      fail(`history row ${index + 1} carries unknown publisher vote label ${JSON.stringify(fields[6])}.`);
    }
    const key = `${sessionYear}:${legislativeBody}:${voteSequenceNumber}:${personId}`;
    if (keys.has(key)) fail(`RollCallHistory.txt repeats person/roll position ${key}.`);
    keys.add(key);
    rows.push({
      sessionYear,
      legislativeBody,
      voteSequenceNumber,
      employeeNumber,
      personId,
      condensedBillNo: fields[5]!.trim(),
      vote,
      lastModified: fields[7]!.trim(),
    });
  }
  return rows;
}

export function parseNhLegislators(text: string): readonly NhLegislatorIdentityRow[] {
  const rows: NhLegislatorIdentityRow[] = [];
  const personIds = new Set<string>();
  for (const [index, line] of exactLines(text, "legislators.txt").entries()) {
    const fields = line.split("|");
    if (fields.length !== 15) fail(`legislators.txt row ${index + 1} has ${fields.length} fields, expected 15.`);
    const personId = fields[0]!.trim();
    if (!/^\d+$/.test(personId)) fail(`legislators.txt row ${index + 1} has invalid PersonID.`);
    if (personIds.has(personId)) fail(`legislators.txt repeats PersonID ${personId}.`);
    personIds.add(personId);
    const familyName = fields[1]!.trim();
    const givenName = fields[2]!.trim();
    if (!familyName || !givenName) fail(`legislators.txt PersonID ${personId} lacks an exact name.`);
    rows.push({
      personId,
      familyName,
      givenName,
      middleName: fields[3]!.trim(),
      legislativeBody: exactBody(fields[4]!, `legislators.txt PersonID ${personId}`),
      seatNo: fields[5]!.trim(),
      countyCode: fields[6]!.trim(),
      district: fields[7]!.trim(),
      party: fields[8]!.trim(),
      address1: fields[9]!.trim(),
      address2: fields[10]!.trim(),
      city: fields[11]!.trim(),
      state: fields[12]!.trim(),
      zip: fields[13]!.trim(),
      email: fields[14]!.trim(),
    });
  }
  return rows;
}

function normalizeExact(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

function memberNameBodyKey(member: Pick<GencourtMember, "familyName" | "givenName" | "chamber">): string {
  return `${normalizeExact(member.familyName)}\u001f${normalizeExact(member.givenName)}\u001f${member.chamber}`;
}

function identityNameBodyKey(row: NhLegislatorIdentityRow): string {
  return `${normalizeExact(row.familyName)}\u001f${normalizeExact(row.givenName)}\u001f${row.legislativeBody}`;
}

export interface NhCurrentMemberIdentityMatch {
  readonly member: GencourtMember;
  readonly officialPersonId: string;
  readonly officeholderId: string;
  readonly matchBasis: "EXACT_OFFICIAL_EMAIL" | "EXACT_OFFICIAL_NAME_BODY" | "REVIEWED_EXACT_OFFICIAL_EXCEPTION" | "EXACT_OFFICIAL_ROSTER_ID";
}

export interface NhCurrentMemberIdentityCrosswalk {
  readonly unresolved?: readonly string[];
  readonly matches: readonly NhCurrentMemberIdentityMatch[];
  readonly sourceVersion: string;
  readonly observedIdentityRows: number;
  readonly ordinaryMatches: number;
  readonly reviewedExceptionMatches: number;
}

const REVIEWED_CURRENT_MEMBER_EXCEPTIONS = [
  { familyName: "St. Clair", givenName: "Charlie", middleName: "G.", body: "H", seatNo: "4092", county: "Belknap", district: "5", personId: "8956", employeeNumber: "408811" },
  { familyName: "Vose", givenName: "Michael", middleName: "", body: "H", seatNo: "3042", county: "Rockingham", district: "5", personId: "909", employeeNumber: "377272" },
] as const;

function exactHistoryIdentityPairs(rows: readonly NhRollHistoryRow[]): {
  readonly employeeToPerson: ReadonlyMap<string, string>;
  readonly personToEmployee: ReadonlyMap<string, string>;
} {
  const employeeToPerson = new Map<string, string>();
  const personToEmployee = new Map<string, string>();
  for (const row of rows) {
    const person = employeeToPerson.get(row.employeeNumber);
    const employee = personToEmployee.get(row.personId);
    if ((person && person !== row.personId) || (employee && employee !== row.employeeNumber)) {
      fail(`EmployeeNumber/PersonID is not one-to-one at ${row.employeeNumber}/${row.personId}.`);
    }
    employeeToPerson.set(row.employeeNumber, row.personId);
    personToEmployee.set(row.personId, row.employeeNumber);
  }
  return { employeeToPerson, personToEmployee };
}

function reviewedExceptionPersonId(
  member: GencourtMember,
  identities: ReadonlyMap<string, NhLegislatorIdentityRow>,
  historyPairs: ReturnType<typeof exactHistoryIdentityPairs>,
): string | null {
  const exception = REVIEWED_CURRENT_MEMBER_EXCEPTIONS.find((row) =>
    member.familyName === row.familyName && member.givenName === row.givenName && (member.middleName ?? "") === row.middleName &&
    member.chamber === row.body && member.seatNo === row.seatNo && member.county === row.county && member.district === row.district
  );
  if (!exception) return null;
  const officialRow = identities.get(exception.personId);
  if (officialRow && officialRow.legislativeBody !== exception.body) {
    fail(`reviewed current-member exception PersonID ${exception.personId} has the wrong official chamber.`);
  }
  if (
    historyPairs.personToEmployee.get(exception.personId) !== exception.employeeNumber ||
    historyPairs.employeeToPerson.get(exception.employeeNumber) !== exception.personId
  ) {
    fail(
      `reviewed current-member exception ${exception.givenName} ${exception.familyName} lacks exact official ` +
        `History pair PersonID ${exception.personId}/EmployeeNumber ${exception.employeeNumber}.`,
    );
  }
  return exception.personId;
}

function uniqueMap<T>(rows: readonly T[], key: (row: T) => string, label: string): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    if (map.has(value)) ambiguous.add(value);
    else map.set(value, row);
  }
  for (const value of ambiguous) map.delete(value);
  if (ambiguous.size > 0 && label === "PersonID") fail(`${label} is not unique.`);
  return map;
}

export function joinNhCurrentMemberIdentities(
  extraction: Pick<MembersExtraction, "members">,
  identityRows: readonly NhLegislatorIdentityRow[],
  identityText: string,
  historyRows: readonly NhRollHistoryRow[],
  historyText: string,
): NhCurrentMemberIdentityCrosswalk {
  const current = extraction.members.filter((member) => member.electedStatus === "INCUMBENT" || member.electedStatus === "NEW");
  const byPerson = uniqueMap(identityRows, (row) => row.personId, "PersonID");
  const byEmail = uniqueMap(identityRows, (row) => normalizeExact(row.email), "email");
  const byNameBody = uniqueMap(identityRows, identityNameBodyKey, "name/body");
  const historyPairs = exactHistoryIdentityPairs(historyRows);
  const matches: NhCurrentMemberIdentityMatch[] = [];
  const unresolved: string[] = [];
  let ordinaryMatches = 0;
  let reviewedExceptionMatches = 0;

  for (const member of current) {
    const email = member.email ? byEmail.get(normalizeExact(member.email)) : undefined;
    const name = byNameBody.get(memberNameBodyKey(member));
    if (email && name && email.personId !== name.personId) {
      unresolved.push(`${member.givenName} ${member.familyName}: conflicting exact official identities`); continue;
    }
    let row = email ?? name;
    let matchBasis: NhCurrentMemberIdentityMatch["matchBasis"] = email ? "EXACT_OFFICIAL_EMAIL" : "EXACT_OFFICIAL_NAME_BODY";
    if (!row) {
      let exceptionPersonId: string | null = null;
      try {exceptionPersonId = reviewedExceptionPersonId(member, byPerson, historyPairs);} catch (error) {unresolved.push(error instanceof Error ? error.message : String(error));continue;}
      if (exceptionPersonId) {
        const officialRow = byPerson.get(exceptionPersonId);
        row = officialRow ?? {
          personId: exceptionPersonId,
          familyName: member.familyName,
          givenName: member.givenName,
          middleName: member.middleName ?? "",
          legislativeBody: member.chamber as "H" | "S",
          seatNo: member.seatNo,
          countyCode: "",
          district: member.district,
          party: member.party ?? "",
          address1: "",
          address2: "",
          city: member.town ?? "",
          state: "NH",
          zip: "",
          email: member.email ?? "",
        };
        matchBasis = "REVIEWED_EXACT_OFFICIAL_EXCEPTION";
      }
    }
    if (!row) {
      unresolved.push(`${member.givenName} ${member.familyName} (${member.chamber}/${member.seatNo}/${member.county} ${member.district})`);
      continue;
    }
    if (row.legislativeBody !== member.chamber) {unresolved.push(`PersonID ${row.personId}: current chamber mismatch`);continue;}
    matches.push({
      member,
      officialPersonId: row.personId,
      officeholderId: officialStateOfficeholderId("nh-general-court", row.personId),
      matchBasis,
    });
    if (matchBasis === "REVIEWED_EXACT_OFFICIAL_EXCEPTION") reviewedExceptionMatches += 1;
    else ordinaryMatches += 1;
  }

  if (new Set(matches.map((match) => match.officialPersonId)).size !== matches.length) {
    fail("current roster identity join assigns one official PersonID to multiple current members.");
  }
  const sourceVersion = digest({
    legislators: identityText.replace(/^\uFEFF/, ""),
    history: historyText.replace(/^\uFEFF/, ""),
  });
  return { matches, unresolved, sourceVersion, observedIdentityRows: identityRows.length, ordinaryMatches, reviewedExceptionMatches };
}

function rollKey(row: Pick<NhRollSummaryRow | NhRollHistoryRow, "sessionYear" | "legislativeBody" | "voteSequenceNumber">): string {
  return `${row.sessionYear}:${row.legislativeBody}:${row.voteSequenceNumber}`;
}

function normalizedVote(label: NhPublisherVoteLabel): StateMemberVote["position"] {
  if (label === "Yea") return "YES";
  if (label === "Nay") return "NO";
  if (label === "Not Voting/Excused") return "NOT_VOTING";
  if (label === "Not Voting/Not Excused" || label === "Presiding") return "PRESENT";
  return "UNKNOWN";
}

function digest(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail("source-version evidence is not durable JSON.");
  return createHash("sha256").update(encoded, "utf8").digest("hex");
}

export interface NhOfficialRollCallProjection {
  readonly rolls: readonly (StateRollCall & {
    readonly sourceId: "nh-general-court";
    readonly officialRollCallId: string;
    readonly eventId: string;
    readonly chamber: "House" | "Senate";
    readonly term: string;
    readonly session: string;
    readonly actionStage: string;
    readonly expectedActionStage: string;
  })[];
  readonly positions: readonly (Omit<StateMemberVote, "legiscanPeopleId" | "officialPersonId" | "publisherPosition"> & {
    readonly officialPersonId: string;
    readonly publisherPosition: string;
  })[];
  readonly participantIds: readonly string[];
  readonly participantSourceVersion: string;
  readonly participantAudit: {
    readonly historyParticipantCount: number;
    readonly legislatorsIdentityCount: number;
    readonly enrichedParticipantCount: number;
    readonly historyOnlyParticipantCount: number;
    readonly historyOnlyPersonIds: readonly string[];
  };
  readonly tallyAudit: {
    readonly rollCount: number;
    readonly positionCount: number;
    readonly exactPublisherCategoryMatches: number;
    readonly publisherCategoryDrift: readonly {
      readonly officialRollCallId: string;
      readonly publisherPresent: number;
      readonly publisherAbsent: number;
      readonly historyNotExcusedOrPresiding: number;
      readonly historyExcused: number;
    }[];
  };
}

export function buildNhOfficialRollCallProjection(input: {
  readonly summaries: readonly NhRollSummaryRow[];
  readonly history: readonly NhRollHistoryRow[];
  readonly legislators: readonly NhLegislatorIdentityRow[];
  readonly retrievedAt: string;
  readonly participantSourceVersion: string;
}): NhOfficialRollCallProjection {
  const sourceYears = new Set([...input.summaries, ...input.history].map(row => row.sessionYear));
  if (sourceYears.size !== 1) fail("The official summary and history do not describe one exact source session year.");
  const summaries = new Map(input.summaries.map((row) => [rollKey(row), row]));
  const identities = new Map(input.legislators.map((row) => [row.personId, row]));
  const histories = new Map<string, NhRollHistoryRow[]>();
  const historyPairs = exactHistoryIdentityPairs(input.history);
  const employeeToPerson = historyPairs.employeeToPerson;
  const personToEmployee = historyPairs.personToEmployee;

  for (const row of input.history) {
    const key = rollKey(row);
    const summary = summaries.get(key);
    if (!summary) fail(`RollCallHistory.txt row points outside RollCallSummary.txt at ${key}.`);
    if (row.condensedBillNo !== summary.condensedBillNo) {
      fail(`${key} disagrees on condensed bill number between summary and history.`);
    }
    histories.set(key, [...(histories.get(key) ?? []), row]);
  }

  const rolls: NhOfficialRollCallProjection["rolls"][number][] = [];
  const positions: NhOfficialRollCallProjection["positions"][number][] = [];
  const publisherCategoryDrift: NhOfficialRollCallProjection["tallyAudit"]["publisherCategoryDrift"][number][] = [];
  for (const summary of input.summaries) {
    const key = rollKey(summary);
    const rows = histories.get(key);
    if (!rows || rows.length === 0) fail(`RollCallSummary.txt ${key} has no member-position horizon.`);
    const labels = new Map<string, number>();
    for (const row of rows) labels.set(row.vote, (labels.get(row.vote) ?? 0) + 1);
    const yea = labels.get("Yea") ?? 0;
    const nay = labels.get("Nay") ?? 0;
    const excused = labels.get("Not Voting/Excused") ?? 0;
    const notExcused = labels.get("Not Voting/Not Excused") ?? 0;
    const presiding = labels.get("Presiding") ?? 0;
    const unknown = labels.get("") ?? 0;
    if (yea !== summary.yea || nay !== summary.nay) fail(`${key} Yea/Nay positions do not reconcile to the publisher summary.`);
    if (summary.legislativeBody === "H") {
      if (summary.present + summary.absent !== notExcused + presiding + excused + unknown || rows.length !== yea + nay + summary.present + summary.absent) {
        fail(`${key} House published Present+Absent denominator does not reconcile to every non-Yea/Nay member position.`);
      }
      if (summary.present !== notExcused + presiding || summary.absent !== excused) {
        // Some publisher history rows have a later exact Excused disposition
        // while the summary retains the earlier Present/Absent split. Keep
        // both official facts and expose the discrepancy; never rewrite a
        // member label to manufacture category equality.
        publisherCategoryDrift.push({
          officialRollCallId: key,
          publisherPresent: summary.present,
          publisherAbsent: summary.absent,
          historyNotExcusedOrPresiding: notExcused + presiding,
          historyExcused: excused,
        });
      }
    } else if (summary.present !== yea + nay || summary.absent !== excused || rows.length !== summary.present + summary.absent + unknown) {
      fail(`${key} Senate Present/Absent semantics do not reconcile to every member position.`);
    }

    const officialRollCallId = key;
    const id = `nh-general-court:roll:${key}`;
    const chamber = summary.legislativeBody === "H" ? "House" : "Senate";
    rolls.push({
      id,
      sourceId: "nh-general-court",
      officialRollCallId,
      eventId: `nh-general-court:event:${key}`,
      chamber,
      term: summary.sessionYear,
      session: "regular",
      actionStage: summary.motion,
      expectedActionStage: summary.motion,
      state: "NH",
      sessionId: 0,
      billNumber: summary.condensedBillNo,
      billTitle: summary.billTitle || summary.secondaryTitle || summary.condensedBillNo || summary.motion,
      motion: summary.motion,
      date: sourceDate(summary.voteDate, key),
      yea: summary.yea,
      nay: summary.nay,
      absent: summary.absent,
      nv: rows.filter((row) => normalizedVote(row.vote) !== "YES" && normalizedVote(row.vote) !== "NO").length,
      result: `Yea ${summary.yea}; Nay ${summary.nay}; Present ${summary.present}; Absent ${summary.absent}`,
      publisherTally: { Yea: summary.yea, Nay: summary.nay, Present: summary.present, Absent: summary.absent },
      billUrl: null,
      rollCallUrl: NH_ROLL_SUMMARY_URL,
      retrievedAt: input.retrievedAt,
    });
    for (const row of rows) {
      positions.push({
        officeholderId: officialStateOfficeholderId("nh-general-court", row.personId),
        officialPersonId: row.personId,
        rollCallId: id,
        position: normalizedVote(row.vote),
        publisherPosition: row.vote,
      });
    }
  }

  const participantPairs = [...personToEmployee.entries()].sort(([a], [b]) => a.localeCompare(b));
  const historyOnlyPersonIds = participantPairs.map(([personId]) => personId).filter((personId) => !identities.has(personId));
  if (!/^[0-9a-f]{64}$/.test(input.participantSourceVersion)) {
    fail("the exact RollCallHistory.txt acquisition has no lowercase SHA-256 source version.");
  }
  return {
    rolls,
    positions,
    participantIds: participantPairs.map(([personId]) => officialStateOfficeholderId("nh-general-court", personId)),
    participantSourceVersion: input.participantSourceVersion,
    participantAudit: {
      historyParticipantCount: participantPairs.length,
      legislatorsIdentityCount: input.legislators.length,
      enrichedParticipantCount: participantPairs.length - historyOnlyPersonIds.length,
      historyOnlyParticipantCount: historyOnlyPersonIds.length,
      historyOnlyPersonIds,
    },
    tallyAudit: {
      rollCount: rolls.length,
      positionCount: positions.length,
      exactPublisherCategoryMatches: rolls.length - publisherCategoryDrift.length,
      publisherCategoryDrift,
    },
  };
}

/** Exact decoded publisher body version used by the session participant set. */
export function nhParticipantSourceVersion(historyText: string): string {
  return digest({
    sourceUrl: NH_ROLL_HISTORY_URL,
    body: historyText.replace(/^\uFEFF/, ""),
  });
}
