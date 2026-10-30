import { plainCode } from "./plain-words.ts";

/** Keys are the exact record-class strings providers stamp; a class with no entry falls through to `plainCode`. */
export const RECORD_CLASS_WORDS: Readonly<Record<string, string>> = {
  "campaign-finance": "campaign finance filings",
  "candidate-enrichment": "candidate record",
  "local-jurisdiction": "local government record",
  meetings: "meeting list",
  "meeting-times": "meeting times",
  agendas: "agendas",
  tracker: "record named on the tracker",
  MEETINGS: "meeting list",
  AGENDA: "agenda",
  AGENDA_PACKET: "agenda packet",
  MINUTES: "minutes",
  MINUTES_OR_ACTION_SUMMARY: "minutes",
  ACTION_SUMMARY: "action summary",
  ROLL_CALL: "recorded vote",
  MEETING_NOTICE: "meeting notice",
  ROSTER: "list of who sits on the body",
  RECORDING_OR_TRANSCRIPT: "recording or transcript",
  CAMPAIGN_FINANCE: "campaign finance filings",
  BALLOT_AND_CANDIDATES: "ballot and candidate list",
  CANDIDATE_FILINGS: "candidate filings",
  CANDIDATE_FILING_DOCUMENT: "candidate filing document",
  OFFICIAL_BOARD_DIRECTORY: "official board directory",
  OFFICIAL_MEETING_DOCUMENT_INVENTORY: "list of the meeting documents published",
  OFFICIAL_SOURCE_SCHEMA: "source's own published schema",
  GOVERNMENT_IDENTITY: "official identity of the body",
  LEGISTAR_EVENTS: "meeting list",
  CIVICCLERK_EVENTS: "meeting list",
  INTERNAL_METHOD_KNOWLEDGE: "reusable method",
};

export function recordClassWords(recordClass: string | null | undefined): string {
  const raw = (recordClass ?? "").trim();
  if (raw === "") return "public record";
  const known = RECORD_CLASS_WORDS[raw];
  if (known !== undefined) return known;
  const words = plainCode(raw).toLowerCase();
  return words === "" ? "public record" : words;
}

