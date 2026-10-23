import { createHash } from "node:crypto";
import { readZipEntries } from "../archive.ts";

import { sourceAcquisitionFailure } from "../../civic-data/source-acquisition-failure.ts";
import { officialStateOfficeholderId } from "../../state-rollcalls/authority.ts";
import type { StateMemberVote, StateRollCall, StateVotePosition } from "../legiscan/types.ts";
import { njSecondTuesday } from "./roster.ts";

export const NJ_VOTING_RECORDS_INDEX_URL = "https://www.njleg.state.nj.us/api/votingRecords";
export const NJ_MEMBER_REQUEST_CONCURRENCY = 8;

export interface NjVotingSession {
  readonly display: string;
  readonly value: number;
}

export interface NjSessionParticipant {
  readonly rosterKey: number;
  readonly title: string;
  readonly house: "A" | "S";
  readonly fullName: string;
  readonly sessionYear: number;
  readonly houseDescription: "Assembly" | "Senate";
}

export interface NjVotingRecordsIndex {
  readonly session: NjVotingSession;
  readonly participants: readonly NjSessionParticipant[];
  readonly participantSourceVersion: string;
}

export interface NjMemberVoteRow {
  readonly detailType: "F" | "C";
  readonly rosterKey: number;
  readonly billType: string;
  readonly billNumber: number;
  readonly orderedAt: string;
  readonly sequence: number;
  readonly sessionDate: string;
  readonly bill: string;
  readonly abstract: string;
  readonly fullName: string;
  readonly transHouse: string;
  readonly action: string;
  readonly publisherPosition: NjPublisherVoteLabel;
  readonly sessionYear: number;
  readonly synopsis: string;
}

export interface NjMemberVotingRecord {
  readonly participant: NjSessionParticipant;
  readonly displayName: string;
  readonly votes: readonly NjMemberVoteRow[];
}

export const NJ_PUBLISHER_VOTE_LABELS = [
  "Yes",
  "No",
  "Abstain",
  "No Vote",
  "Not Voting",
] as const;
export type NjPublisherVoteLabel = (typeof NJ_PUBLISHER_VOTE_LABELS)[number];

export type NjArchiveKind = "ASSEMBLY_FLOOR" | "SENATE_FLOOR" | "ASSEMBLY_COMMITTEE" | "SENATE_COMMITTEE";

export interface NjVoteArchiveDefinition {
  readonly kind: NjArchiveKind;
  readonly chamber: "Assembly" | "Senate";
  readonly detailType: "F" | "C";
  readonly url: string;
  readonly entryName: string;
}

export interface NjFloorArchiveRow {
  readonly bill: string;
  readonly fullName: string;
  readonly sessionDate: string;
  readonly currentStatus: string;
  readonly abstract: string;
  readonly action: string;
  readonly voteCode: "Y" | "N" | "A" | "";
}

export interface NjCommitteeArchiveRow {
  readonly billType: string;
  readonly billNumber: number;
  readonly abstract: string;
  readonly agendaDate: string;
  readonly committeeHouse: string;
  readonly agendaType: string;
  readonly agendaSequence: number;
  readonly action: string;
  readonly fullName: string;
  readonly party: string;
  readonly publisherPosition: NjPublisherVoteLabel | "";
}

export type ParsedNjVoteArchive =
  | {
      readonly definition: NjVoteArchiveDefinition;
      readonly sha256: string;
      readonly rows: readonly NjFloorArchiveRow[];
    }
  | {
      readonly definition: NjVoteArchiveDefinition;
      readonly sha256: string;
      readonly rows: readonly NjCommitteeArchiveRow[];
    };

export interface NjOfficialRollCallProjection {
  readonly rolls: readonly (StateRollCall & {
    readonly sourceId: "nj-legislature";
    readonly officialRollCallId: string;
    readonly eventId: string;
    readonly chamber: "Assembly" | "Senate";
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
  readonly sourceAudit: {
    readonly sessionIndexUrl: string;
    readonly sessionDisplay: string;
    readonly expectedParticipantRequests: number;
    readonly completedParticipantRequests: number;
    readonly apiRollCalls: number;
    readonly apiPositions: number;
    readonly reconciledArchivePositions: number;
    readonly archives: readonly {
      readonly kind: NjArchiveKind;
      readonly url: string;
      readonly sha256: string;
      readonly rollCalls: number;
      readonly positions: number;
    }[];
  };
}

function invalid(detail: string): never {
  throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `New Jersey Legislature voting records: ${detail}`);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} is not an object.`);
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string, label: string, allowEmpty = false): string {
  const value = row[key];
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    invalid(`${label} has invalid ${key}.`);
  }
  return allowEmpty ? value : value.trim();
}

function integer(row: Record<string, unknown>, key: string, label: string, minimum = 0): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(`${label} has invalid ${key}.`);
  return Number(value);
}

function json(textValue: string, label: string): unknown {
  if (textValue.trim() === "") invalid(`${label} is empty.`);
  try {
    return JSON.parse(textValue);
  } catch {
    invalid(`${label} is not valid JSON.`);
  }
}

/** The active NJ session is biennial and changes on the second Tuesday in January. */
export function currentNjVotingSessionYear(at: string): number {
  const instant = new Date(at);
  if (!Number.isFinite(instant.getTime())) invalid(`retrieval instant is invalid: ${at}.`);
  const year = instant.getUTCFullYear();
  let start = year % 2 === 0 ? year : year - 1;
  if (year % 2 === 0 && instant < njSecondTuesday(year)) start -= 2;
  return start;
}

function exactHttpsUrl(value: string, expected: URL, label: string): string {
  let actual: URL;
  try {
    actual = new URL(value);
  } catch {
    invalid(`${label} final URL is invalid: ${value}.`);
  }
  if (actual.href !== expected.href || actual.protocol !== "https:") {
    invalid(`${label} final URL is ${actual.href}; expected ${expected.href}.`);
  }
  return actual.href;
}

export function njMemberVotingRecordsUrl(sessionYear: number, rosterKey: number): string {
  if (!Number.isSafeInteger(sessionYear) || sessionYear < 2000 || sessionYear % 2 !== 0) {
    throw new Error(`NJ_VOTING_SESSION_INVALID:${sessionYear}`);
  }
  if (!Number.isSafeInteger(rosterKey) || rosterKey <= 0) throw new Error(`NJ_ROSTER_KEY_INVALID:${rosterKey}`);
  return `${NJ_VOTING_RECORDS_INDEX_URL}/${sessionYear}/${rosterKey}/Bills`;
}

export function njVoteArchiveDefinitions(sessionYear: number): readonly NjVoteArchiveDefinition[] {
  if (!Number.isSafeInteger(sessionYear) || sessionYear < 2000 || sessionYear % 2 !== 0) {
    throw new Error(`NJ_VOTING_SESSION_INVALID:${sessionYear}`);
  }
  const term = `${sessionYear}-${sessionYear + 1}`;
  return [
    { kind: "ASSEMBLY_FLOOR", chamber: "Assembly", detailType: "F", url: `https://pub.njleg.gov/votes/A${sessionYear}.zip`, entryName: `A${sessionYear}.txt` },
    { kind: "SENATE_FLOOR", chamber: "Senate", detailType: "F", url: `https://pub.njleg.gov/votes/S${sessionYear}.zip`, entryName: `S${sessionYear}.txt` },
    { kind: "ASSEMBLY_COMMITTEE", chamber: "Assembly", detailType: "C", url: `https://pub.njleg.gov/votes/CA${term}.zip`, entryName: `CA${term}.txt` },
    { kind: "SENATE_COMMITTEE", chamber: "Senate", detailType: "C", url: `https://pub.njleg.gov/votes/CS${term}.zip`, entryName: `CS${term}.txt` },
  ];
}

export function validateNjVotingRecordsIndexFinalUrl(value: string): string {
  return exactHttpsUrl(value, new URL(NJ_VOTING_RECORDS_INDEX_URL), "session index");
}

export function validateNjMemberVotingRecordsFinalUrl(value: string, sessionYear: number, rosterKey: number): string {
  return exactHttpsUrl(value, new URL(njMemberVotingRecordsUrl(sessionYear, rosterKey)), `member ${rosterKey}`);
}

export function validateNjVoteArchiveFinalUrl(value: string, definition: NjVoteArchiveDefinition): string {
  return exactHttpsUrl(value, new URL(definition.url), `${definition.kind} archive`);
}

/** Select the named official current session; numeric maxima include legacy pseudo-years. */
export function parseNjVotingRecordsIndex(raw: string, expectedSessionYear: number): NjVotingRecordsIndex {
  const root = json(raw, "session index");
  if (!Array.isArray(root) || root.length !== 2 || !Array.isArray(root[0]) || !Array.isArray(root[1])) {
    invalid("session index must be exactly [participant rows, official session rows].");
  }

  const sessions: NjVotingSession[] = root[1].map((value, index) => {
    const row = object(value, `session row ${index + 1}`);
    const display = text(row, "display", `session row ${index + 1}`);
    const sessionValue = integer(row, "value", `session row ${index + 1}`, 2000);
    return { display, value: sessionValue };
  });
  if (new Set(sessions.map(({ value }) => value)).size !== sessions.length) invalid("official session rows repeat a value.");
  const session = sessions.find(({ value }) => value === expectedSessionYear);
  if (!session || session.display !== `${expectedSessionYear}-${expectedSessionYear + 1} Session`) {
    invalid(`the official session list does not name exact current session ${expectedSessionYear}-${expectedSessionYear + 1}.`);
  }

  const allParticipants: NjSessionParticipant[] = root[0].map((value, index) => {
    const row = object(value, `participant row ${index + 1}`);
    const house = text(row, "House", `participant row ${index + 1}`);
    const houseDescription = text(row, "HouseDescription", `participant row ${index + 1}`);
    if (!((house === "A" && houseDescription === "Assembly") || (house === "S" && houseDescription === "Senate"))) {
      invalid(`participant row ${index + 1} has inconsistent House/HouseDescription.`);
    }
    return {
      rosterKey: integer(row, "Roster_Key", `participant row ${index + 1}`, 1),
      title: text(row, "Title", `participant row ${index + 1}`).trim(),
      house,
      fullName: text(row, "FullName", `participant row ${index + 1}`),
      sessionYear: integer(row, "SessionYear", `participant row ${index + 1}`, 1900),
      houseDescription,
    } as NjSessionParticipant;
  });
  const participants = allParticipants.filter(({ sessionYear }) => sessionYear === expectedSessionYear);
  const rosterKeys = new Set(participants.map(({ rosterKey }) => rosterKey));
  if (rosterKeys.size !== participants.length) invalid(`session ${expectedSessionYear} repeats a Roster_Key.`);
  const assembly = participants.filter(({ house }) => house === "A").length;
  const senate = participants.filter(({ house }) => house === "S").length;
  if (participants.length !== 120 || assembly !== 80 || senate !== 40) {
    invalid(`session ${expectedSessionYear} participant horizon is ${participants.length} (${assembly} Assembly/${senate} Senate); expected 120 (80/40).`);
  }
  const sorted = [...participants].sort((a, b) => a.rosterKey - b.rosterKey);
  return {
    session,
    participants: sorted,
    participantSourceVersion: sha256(canonical({ session, participants: sorted })),
  };
}

function exactSourceDate(value: string, label: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) invalid(`${label} has unsupported Session_Date ${JSON.stringify(value)}.`);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    invalid(`${label} has impossible Session_Date ${JSON.stringify(value)}.`);
  }
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function exactOrderedAt(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    invalid(`${label} has unsupported OrdDateTime ${JSON.stringify(value)}.`);
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    invalid(`${label} has invalid OrdDateTime ${JSON.stringify(value)}.`);
  }
  return value;
}

export function parseNjMemberVotingRecord(
  raw: string,
  participant: NjSessionParticipant,
  sessionYear: number,
): NjMemberVotingRecord {
  const root = json(raw, `member ${participant.rosterKey} response`);
  if (!Array.isArray(root) || root.length !== 2 || !Array.isArray(root[0]) || !Array.isArray(root[1]) || root[0].length !== 1) {
    invalid(`member ${participant.rosterKey} response must be exactly [[one member header], [vote rows]].`);
  }
  const header = object(root[0][0], `member ${participant.rosterKey} header`);
  const title = text(header, "TitleOfLeg", `member ${participant.rosterKey} header`).trim();
  if (!title || !participant.title.startsWith(title.split(/\s+/)[0]!)) {
    invalid(`member ${participant.rosterKey} header title does not match the session participant.`);
  }
  text(header, "ByFirst_Name", `member ${participant.rosterKey} header`);
  text(header, "Last_Name", `member ${participant.rosterKey} header`);
  const displayName = text(header, "ByFirst_Name", `member ${participant.rosterKey} header`);

  let exactVoteName: string | null = null;
  const votes: NjMemberVoteRow[] = root[1].map((value, index) => {
    const label = `member ${participant.rosterKey} vote row ${index + 1}`;
    const row = object(value, label);
    const detailType = text(row, "DetailType", label);
    if (detailType !== "F" && detailType !== "C") invalid(`${label} has unsupported DetailType ${JSON.stringify(detailType)}.`);
    const rosterKey = integer(row, "Roster_Key", label, 1);
    if (rosterKey !== participant.rosterKey) invalid(`${label} crosses into Roster_Key ${rosterKey}.`);
    const billType = text(row, "Bill_Type", label).trim();
    if (!/^[A-Z]{1,4}$/.test(billType)) invalid(`${label} has invalid Bill_Type ${JSON.stringify(billType)}.`);
    const billNumber = integer(row, "Bill_Number", label, 1);
    const bill = text(row, "Bill", label);
    if (bill !== `${billType}${billNumber}`) invalid(`${label} has Bill ${bill} inconsistent with its type/number.`);
    const orderedAt = exactOrderedAt(text(row, "OrdDateTime", label), label);
    const publishedSessionDate = text(row, "Session_Date", label);
    const sessionDate = exactSourceDate(publishedSessionDate, label);
    if (sessionDate !== orderedAt.slice(0, 10)) invalid(`${label} disagrees between OrdDateTime and Session_Date.`);
    const sequence = integer(row, "Seq_Order", label);
    if ((detailType === "F" && sequence === 0) || (detailType === "C" && sequence !== 0)) {
      invalid(`${label} has a sequence inconsistent with its floor/committee detail type.`);
    }
    const sessionValue = integer(row, "SessionYear", label, 2000);
    if (sessionValue !== sessionYear) invalid(`${label} belongs to session ${sessionValue}, expected ${sessionYear}.`);
    const fullName = text(row, "Full_Name", label);
    if (exactVoteName !== null && fullName !== exactVoteName) invalid(`member ${participant.rosterKey} response changes Full_Name between vote rows.`);
    exactVoteName = fullName;
    const transHouse = text(row, "TransHouse", label).trim();
    if (detailType === "F" ? transHouse !== participant.houseDescription : !transHouse.startsWith(`${participant.houseDescription} `)) {
      invalid(`${label} has TransHouse ${JSON.stringify(transHouse)} inconsistent with ${participant.houseDescription}.`);
    }
    const publisherPosition = text(row, "VoteDescription", label);
    if (!(NJ_PUBLISHER_VOTE_LABELS as readonly string[]).includes(publisherPosition)) {
      invalid(`${label} has unsupported VoteDescription ${JSON.stringify(publisherPosition)}.`);
    }
    return {
      detailType,
      rosterKey,
      billType,
      billNumber,
      orderedAt,
      sequence,
      sessionDate,
      bill,
      abstract: text(row, "Abstract", label),
      fullName,
      transHouse,
      action: text(row, "Action", label),
      publisherPosition: publisherPosition as NjPublisherVoteLabel,
      sessionYear: sessionValue,
      synopsis: text(row, "Synopsis", label, true).trim(),
    };
  });
  return { participant, displayName, votes };
}

/** The official OLS artifact is exactly one bounded, verified UTF-8 member. */
export function decodeNjVoteArchive(bytes: Uint8Array, expectedEntryName: string): string {
  let opened: Uint8Array;
  try {
    const entries = readZipEntries(bytes, { maxEntries: 1, maxMemberBytes: 128 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 });
    if (entries.length !== 1 || entries[0].name !== expectedEntryName || /[/\\]/.test(entries[0].name)) invalid(`${expectedEntryName} ZIP contains an unexpected entry.`);
    opened = entries[0].data;
  } catch (error) { invalid(`${expectedEntryName} ZIP size, CRC or directory does not reconcile: ${error instanceof Error ? error.message : String(error)}`); }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(opened).replace(/^\uFEFF/, "");
  } catch {
    invalid(`${expectedEntryName} is not valid UTF-8 text.`);
  }
  if (decoded.trim() === "" || decoded.includes("\u0000")) invalid(`${expectedEntryName} is empty or contains a NUL byte.`);
  return decoded;
}

function csvRows(raw: string, label: string): readonly string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (quoted) {
      if (char === '"') {
        if (raw[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (closedQuote && char !== "," && char !== "\r" && char !== "\n") invalid(`${label} has bytes after a closing quote.`);
    if (char === '"') {
      if (field !== "" || closedQuote) invalid(`${label} has a quote inside an unquoted field.`);
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      closedQuote = false;
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && raw[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      else if (row.length > 1 || rows.length === 0) invalid(`${label} contains a blank logical row.`);
      row = [];
      field = "";
      closedQuote = false;
      continue;
    }
    field += char;
  }
  if (quoted) invalid(`${label} ends inside a quoted field.`);
  if (field !== "" || row.length > 0 || closedQuote) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  if (rows.length < 2) invalid(`${label} contains no data rows.`);
  return rows;
}

function exactArchiveDate(value: string, sessionYear: number, label: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const year = Number(match?.[3]);
  if (!match || (year !== sessionYear && year !== sessionYear + 1)) {
    invalid(`${label} has invalid biennial-session date ${JSON.stringify(value)}.`);
  }
  const padded = `${match[3]}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
  exactSourceDate(`${match[1]!.padStart(2, "0")}/${match[2]!.padStart(2, "0")}/${match[3]}`, label);
  return padded;
}

function exactArchiveDateTime(value: string, sessionYear: number, label: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  const year = Number(match?.[3]);
  if (!match || (year !== sessionYear && year !== sessionYear + 1) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) {
    invalid(`${label} has invalid agenda date ${JSON.stringify(value)}.`);
  }
  exactArchiveDate(`${match[1]}/${match[2]}/${match[3]}`, sessionYear, label);
  return `${match[3]}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}T${match[4]!.padStart(2, "0")}:${match[5]}:${match[6]}.000Z`;
}

function csvInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) invalid(`${label} is not an unsigned integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) invalid(`${label} is outside the supported integer range.`);
  return parsed;
}

export function parseNjVoteArchive(
  raw: string,
  definition: NjVoteArchiveDefinition,
  sessionYear: number,
): ParsedNjVoteArchive {
  const rows = csvRows(raw.replace(/^\uFEFF/, ""), definition.entryName);
  if (definition.detailType === "F") {
    const header = ["Bill", "Full_Name", "Session_Date", "CurrentStatus", "Abstract", "Action", "Legislator_Vote"];
    if (canonical(rows[0]) !== canonical(header)) invalid(`${definition.entryName} header changed.`);
    const parsed: NjFloorArchiveRow[] = rows.slice(1).map((values, index) => {
      if (values.length !== header.length) invalid(`${definition.entryName} row ${index + 2} has ${values.length} columns, expected ${header.length}.`);
      const bill = values[0]!.trim();
      if (!/^[A-Z]{1,4}\d+$/.test(bill)) invalid(`${definition.entryName} row ${index + 2} has invalid Bill.`);
      const voteCode = values[6]!;
      if (voteCode !== "" && voteCode !== "Y" && voteCode !== "N" && voteCode !== "A") invalid(`${definition.entryName} row ${index + 2} has unknown Legislator_Vote.`);
      if (!values[1]!.trim() || !values[4]!.trim() || !values[5]!.trim()) invalid(`${definition.entryName} row ${index + 2} lacks a required identity/action field.`);
      return {
        bill,
        fullName: values[1]!.trim(),
        sessionDate: exactArchiveDate(values[2]!, sessionYear, `${definition.entryName} row ${index + 2}`),
        currentStatus: values[3]!.trim(),
        abstract: values[4]!.trim(),
        action: values[5]!.trim(),
        voteCode,
      };
    });
    return { definition, sha256: sha256(raw), rows: parsed };
  }

  const header = ["Bill_Type", "Bill_Number", "Abstract", "Agenda_Date", "Committee_House", "Agenda_Type", "Agenda_Sequence", "BillAction", "Name", "Party", "LegislatorVote"];
  if (canonical(rows[0]) !== canonical(header)) invalid(`${definition.entryName} header changed.`);
  const parsed: NjCommitteeArchiveRow[] = rows.slice(1).map((values, index) => {
    if (values.length !== header.length) invalid(`${definition.entryName} row ${index + 2} has ${values.length} columns, expected ${header.length}.`);
    const billType = values[0]!.trim();
    if (!/^[A-Z]{1,4}$/.test(billType) || !values[2]!.trim() || !values[4]!.trim() || !values[5]!.trim() || !values[7]!.trim() || !values[8]!.trim() || !values[9]!.trim()) {
      invalid(`${definition.entryName} row ${index + 2} lacks a required bill/committee/person field.`);
    }
    const publisherPosition = values[10]!;
    if (publisherPosition !== "" && !(NJ_PUBLISHER_VOTE_LABELS as readonly string[]).includes(publisherPosition)) {
      invalid(`${definition.entryName} row ${index + 2} has unknown LegislatorVote ${JSON.stringify(publisherPosition)}.`);
    }
    return {
      billType,
      billNumber: csvInteger(values[1]!, `${definition.entryName} row ${index + 2} Bill_Number`),
      abstract: values[2]!.trim(),
      agendaDate: exactArchiveDateTime(values[3]!, sessionYear, `${definition.entryName} row ${index + 2}`),
      committeeHouse: values[4]!.trim(),
      agendaType: values[5]!.trim(),
      agendaSequence: csvInteger(values[6]!, `${definition.entryName} row ${index + 2} Agenda_Sequence`),
      action: values[7]!.trim(),
      fullName: values[8]!.trim(),
      party: values[9]!.trim(),
      publisherPosition: publisherPosition as NjPublisherVoteLabel | "",
    };
  });
  return { definition, sha256: sha256(raw), rows: parsed };
}

const NORMALIZED_NJ_POSITION: Readonly<Record<NjPublisherVoteLabel, StateVotePosition>> = {
  Yes: "YES",
  No: "NO",
  Abstain: "ABSTAIN",
  "No Vote": "NOT_VOTING",
  "Not Voting": "NOT_VOTING",
};

function archiveVote(label: NjPublisherVoteLabel): string {
  if (label === "Yes") return "Y";
  if (label === "No") return "N";
  if (label === "Abstain") return "A";
  return "";
}

function apiArchiveFingerprint(row: NjMemberVoteRow): string {
  return row.detailType === "F"
    ? canonical([row.bill, row.fullName, row.sessionDate, row.abstract, row.action, archiveVote(row.publisherPosition)])
    : canonical([row.bill, row.abstract, row.orderedAt, row.action, row.fullName, archiveVote(row.publisherPosition)]);
}

function archiveFingerprint(row: NjFloorArchiveRow | NjCommitteeArchiveRow): string {
  if ("voteCode" in row) return canonical([row.bill, row.fullName, row.sessionDate, row.abstract, row.action, row.voteCode]);
  return canonical([
    `${row.billType}${row.billNumber}`,
    row.abstract,
    row.agendaDate,
    row.action,
    row.fullName,
    row.publisherPosition === "" ? "" : archiveVote(row.publisherPosition),
  ]);
}

function multiset(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function reconcileRows(kind: NjArchiveKind, apiRows: readonly NjMemberVoteRow[], archiveRows: readonly (NjFloorArchiveRow | NjCommitteeArchiveRow)[]): void {
  const api = multiset(apiRows.map(apiArchiveFingerprint));
  const archive = multiset(archiveRows.map(archiveFingerprint));
  const keys = new Set([...api.keys(), ...archive.keys()]);
  const mismatch = [...keys].find((key) => api.get(key) !== archive.get(key));
  if (mismatch !== undefined) {
    invalid(`${kind} API/archive position multiset disagrees at ${mismatch}: api=${api.get(mismatch) ?? 0}, archive=${archive.get(mismatch) ?? 0}.`);
  }
}

function eventKey(row: NjMemberVoteRow): string {
  return canonical([
    row.sessionYear,
    row.detailType,
    row.transHouse,
    row.orderedAt,
    row.sequence,
    row.bill,
    row.action,
  ]);
}

function committeeArchiveEventKey(row: NjCommitteeArchiveRow): string {
  return canonical([row.billType, row.billNumber, row.agendaDate, row.committeeHouse, row.agendaType, row.agendaSequence, row.action]);
}

export function buildNjOfficialRollCallProjection(input: {
  readonly index: NjVotingRecordsIndex;
  readonly memberRecords: readonly NjMemberVotingRecord[];
  readonly archives: readonly ParsedNjVoteArchive[];
  readonly retrievedAt: string;
}): NjOfficialRollCallProjection {
  const expectedParticipants = new Map(input.index.participants.map((row) => [row.rosterKey, row]));
  if (input.memberRecords.length !== expectedParticipants.size) {
    invalid(`completed member responses are ${input.memberRecords.length}/${expectedParticipants.size}.`);
  }
  const completedKeys = new Set<number>();
  const apiRows: NjMemberVoteRow[] = [];
  for (const record of input.memberRecords) {
    const expected = expectedParticipants.get(record.participant.rosterKey);
    if (!expected || canonical(expected) !== canonical(record.participant)) invalid(`member response ${record.participant.rosterKey} is outside the selected session participant set.`);
    if (completedKeys.has(record.participant.rosterKey)) invalid(`member response ${record.participant.rosterKey} is duplicated.`);
    completedKeys.add(record.participant.rosterKey);
    apiRows.push(...record.votes);
  }
  if (apiRows.length === 0) invalid(`session ${input.index.session.value} returned no exact member positions.`);

  const definitions = njVoteArchiveDefinitions(input.index.session.value);
  if (input.archives.length !== definitions.length) invalid(`archive responses are ${input.archives.length}/${definitions.length}.`);
  const archiveByKind = new Map(input.archives.map((archive) => [archive.definition.kind, archive]));
  if (archiveByKind.size !== definitions.length || definitions.some((definition) => {
    const actual = archiveByKind.get(definition.kind);
    return !actual || canonical(actual.definition) !== canonical(definition);
  })) invalid("archive response set does not equal the four registered session archives.");

  const rowsByEvent = new Map<string, NjMemberVoteRow[]>();
  const positionKeys = new Set<string>();
  for (const row of apiRows) {
    const participant = expectedParticipants.get(row.rosterKey);
    if (!participant) invalid(`vote row names Roster_Key ${row.rosterKey} outside the selected session.`);
    const key = eventKey(row);
    const positionKey = `${key}\u0000${row.rosterKey}`;
    if (positionKeys.has(positionKey)) invalid(`Roster_Key ${row.rosterKey} repeats a position on one event.`);
    positionKeys.add(positionKey);
    rowsByEvent.set(key, [...(rowsByEvent.get(key) ?? []), row]);
  }

  for (const definition of definitions) {
    const archive = archiveByKind.get(definition.kind)!;
    const subset = apiRows.filter((row) => row.detailType === definition.detailType && row.transHouse.startsWith(definition.chamber));
    reconcileRows(definition.kind, subset, archive.rows);
  }

  const rolls: NjOfficialRollCallProjection["rolls"][number][] = [];
  const positions: NjOfficialRollCallProjection["positions"][number][] = [];
  const eventKinds = new Map<NjArchiveKind, number>();
  for (const [key, rows] of [...rowsByEvent.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = rows[0]!;
    const chamber = first.transHouse.startsWith("Assembly") ? "Assembly" : "Senate";
    const kind: NjArchiveKind = first.detailType === "F"
      ? chamber === "Assembly" ? "ASSEMBLY_FLOOR" : "SENATE_FLOOR"
      : chamber === "Assembly" ? "ASSEMBLY_COMMITTEE" : "SENATE_COMMITTEE";
    eventKinds.set(kind, (eventKinds.get(kind) ?? 0) + 1);
    if (rows.some((row) => row.abstract !== first.abstract || row.synopsis !== first.synopsis)) {
      invalid(`${kind} event ${key} changes its bill text between member rows.`);
    }
    if (first.detailType === "F") {
      const expectedSeats = chamber === "Assembly" ? 80 : 40;
      if (rows.length !== expectedSeats) invalid(`${kind} event ${key} has ${rows.length}/${expectedSeats} seat positions.`);
      const expectedIds = new Set(input.index.participants.filter((row) => row.houseDescription === chamber).map((row) => row.rosterKey));
      if (rows.some((row) => !expectedIds.has(row.rosterKey))) invalid(`${kind} event ${key} crosses its chamber participant set.`);
    }
    const labels = new Map<string, number>();
    for (const row of rows) labels.set(row.publisherPosition, (labels.get(row.publisherPosition) ?? 0) + 1);
    const officialRollCallId = key;
    const digest = sha256(key).slice(0, 32);
    const id = `nj-legislature:roll:${digest}`;
    const archive = archiveByKind.get(kind)!;
    const yes = labels.get("Yes") ?? 0;
    const no = labels.get("No") ?? 0;
    const abstain = labels.get("Abstain") ?? 0;
    const noVote = labels.get("No Vote") ?? 0;
    const notVoting = labels.get("Not Voting") ?? 0;
    const publisherTally = { Yes: yes, No: no, Abstain: abstain, "No Vote": noVote, "Not Voting": notVoting };
    rolls.push({
      id,
      sourceId: "nj-legislature",
      officialRollCallId,
      eventId: `nj-legislature:event:${digest}`,
      chamber,
      term: `${input.index.session.value}-${input.index.session.value + 1}`,
      session: input.index.session.display,
      actionStage: first.action,
      expectedActionStage: first.action,
      officialEventKind: kind,
      state: "NJ",
      sessionId: 0,
      billNumber: first.bill,
      billTitle: first.synopsis || first.abstract,
      motion: first.action,
      date: first.orderedAt.slice(0, 10),
      yea: yes,
      nay: no,
      absent: notVoting,
      nv: abstain + noVote,
      result: `Yes ${yes}; No ${no}; Abstain ${abstain}; No Vote ${noVote}; Not Voting ${notVoting}`,
      publisherTally,
      billUrl: null,
      rollCallUrl: archive.definition.url,
      retrievedAt: input.retrievedAt,
    });
    for (const row of rows) {
      const officialPersonId = String(row.rosterKey);
      positions.push({
        officeholderId: officialStateOfficeholderId("nj-legislature", officialPersonId),
        officialPersonId,
        rollCallId: id,
        position: NORMALIZED_NJ_POSITION[row.publisherPosition],
        publisherPosition: row.publisherPosition,
      });
    }
  }

  const archiveAudit = definitions.map((definition) => {
    const archive = archiveByKind.get(definition.kind)!;
    const rollCalls = eventKinds.get(definition.kind) ?? 0;
    if (definition.detailType === "F") {
      const seats = definition.chamber === "Assembly" ? 80 : 40;
      if (archive.rows.length % seats !== 0 || archive.rows.length / seats !== rollCalls) {
        invalid(`${definition.kind} archive has ${archive.rows.length} positions for ${rollCalls} complete ${seats}-seat events.`);
      }
    } else {
      const committeeEvents = new Set((archive.rows as readonly NjCommitteeArchiveRow[]).map(committeeArchiveEventKey)).size;
      if (committeeEvents !== rollCalls) invalid(`${definition.kind} archive exposes ${committeeEvents} events while the API exposes ${rollCalls}.`);
    }
    return { kind: definition.kind, url: definition.url, sha256: archive.sha256, rollCalls, positions: archive.rows.length };
  });

  const participantIds = input.index.participants.map(({ rosterKey }) => officialStateOfficeholderId("nj-legislature", String(rosterKey)));
  positions.sort((a, b) => a.rollCallId.localeCompare(b.rollCallId) || a.officialPersonId.localeCompare(b.officialPersonId, undefined, { numeric: true }));
  return {
    rolls,
    positions,
    participantIds,
    participantSourceVersion: input.index.participantSourceVersion,
    sourceAudit: {
      sessionIndexUrl: NJ_VOTING_RECORDS_INDEX_URL,
      sessionDisplay: input.index.session.display,
      expectedParticipantRequests: expectedParticipants.size,
      completedParticipantRequests: completedKeys.size,
      apiRollCalls: rolls.length,
      apiPositions: apiRows.length,
      reconciledArchivePositions: archiveAudit.reduce((sum, row) => sum + row.positions, 0),
      archives: archiveAudit,
    },
  };
}
