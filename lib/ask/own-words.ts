import { formatDateLong } from "../text/format-date.ts";
import { asksForPersonalStance } from "./stance-answerability.ts";
import type { EvidenceRecord, EvidenceSubject } from "./evidence.ts";

const MAX_PASSAGES = 3;

const PAGE_FURNITURE = /\b(?:read more|press releases?|skip to|menu|subscribe|sign up|share this|all rights reserved|privacy policy|view all|learn more|click here|back to top)\b/i;
const MONTH_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}\b/i;
const TITLE_ABBREVIATION_END = /\b(?:rep|sen|dr|mr|mrs|ms|gov|hon|st|jr|sr|no)\.$/i;

export function readsAsSpokenSentence(quote: string): boolean {
  const text = quote.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 6 || words.length > 120) return false;
  if (!/^[“"'A-Z0-9]/.test(text) || !/[.!?][”"')]*$/.test(text)) return false;
  if (TITLE_ABBREVIATION_END.test(text.replace(/[”"')]+$/, ""))) return false;
  if (PAGE_FURNITURE.test(text) || MONTH_DATE.test(text)) return false;
  if (/[”"]\s*[—–]\s*\S/.test(text) || /…|\.\.\./.test(text) || /”\s+\S/.test(text)) return false;
  const capitalised = words.filter((w) => /^[“"'(]?[A-Z]/.test(w)).length;
  if (capitalised / words.length > 0.6) return false;
  return true;
}

export interface OwnWordsPassage {
  quote: string;
  url: string;
  retrievedAt: string;
  date: string;
  attribution: string;
}

export function ownWordsPassages(records: readonly EvidenceRecord[], subjectId: string): { passages: OwnWordsPassage[]; unclean: number; garbled: number } {
  const passages: OwnWordsPassage[] = [];
  let unclean = 0;
  let garbled = 0;
  for (const record of records) {
    if (record.kind !== "SOURCE_PASSAGE") continue;
    const verified = record.verifiedStatement;
    const quote = record.subjectId === subjectId && verified?.speakerId === subjectId && verified.nativeSourceId && verified.attribution ? verified.quote.trim() : undefined;
    if (!quote || !record.sourceUrl || !record.retrievedAt || !formatDateLong(record.retrievedAt.slice(0, 10))) { unclean += 1; continue; }
    if (!verified || !/^\d{4}-\d{2}-\d{2}$/.test(verified.date) || !formatDateLong(verified.date)) { unclean += 1; continue; }
    if (!readsAsSpokenSentence(quote)) { unclean += 1; garbled += 1; continue; }
    if (passages.some((p) => p.quote === quote && p.url === record.sourceUrl)) continue;
    passages.push({ quote, url: record.sourceUrl, retrievedAt: record.retrievedAt, date: verified.date, attribution: verified.attribution });
  }
  return { passages, unclean, garbled };
}

export function composeOwnWordsAnswer(input: {
  subject: EvidenceSubject | null;
  question: string;
  records: readonly EvidenceRecord[];
}): { answer: string; citedUrls: string[] } | null {
  const { subject } = input;
  if (!subject || subject.kind !== "PERSON" || !asksForPersonalStance(input.question)) return null;
  const { passages, garbled } = ownWordsPassages(input.records, subject.id);
  if (passages.length === 0 || garbled > 0) return null;
  const shown = passages.slice(0, MAX_PASSAGES);
  const lines = shown.map((p) =>
    `On ${formatDateLong(p.date)}, ${p.attribution} recorded: “${p.quote}”`);
  const answer = `Statements attributed to ${subject.name}. ${lines.join(" ")}`;
  return { answer, citedUrls: [...new Set(shown.map((p) => p.url))] };
}
