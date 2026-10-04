import { formatDateLong } from "../text/format-date.ts";
import { asksForPersonalStance } from "./stance-answerability.ts";
import type { EvidenceRecord, EvidenceSubject } from "./evidence.ts";

/**
 * **A PERSON'S EXACT WORDS ARE QUOTED BY CODE, NOT PARAPHRASED BY A MODEL.** (CA-12.)
 *
 * When the only stance evidence is a verbatim passage held with its address and
 * date, taken from a page that is the person's own (the held campaign or
 * official page linked to them), the answer is the quote, the date we read it
 * and the page it is on. No model writes it. A passage that is only a phrase
 * hit on someone else's page is not composed here, and a model paraphrase
 * without a second source is still refused by `stance-answerability.ts`.
 *
 * Returns null whenever the pack holds anything else a stance answer could
 * rest on, or any passage that is not a clean own-page quotation.
 */

const MAX_PASSAGES = 3;

/** The own-page passage records `statements.ts` mints: "...a held campaign page linked to NAME for TOPIC found this passage: "QUOTE". ..." */
const OWN_PAGE = /^Searching a held (?:campaign|official) page linked to .+? for .+? found this passage: "([\s\S]+?)"\. (?:Latest captured version\.|Earlier captured version, not the latest captured page\.|Source version status unknown\.)/;

export interface OwnWordsPassage {
  quote: string;
  url: string;
  retrievedAt: string;
}

/** Clean own-page quotations (the same quote on the same page, captured twice, is one), and how many passage records were not clean. */
export function ownWordsPassages(records: readonly EvidenceRecord[], subjectId: string): { passages: OwnWordsPassage[]; unclean: number } {
  const passages: OwnWordsPassage[] = [];
  let unclean = 0;
  for (const record of records) {
    if (record.kind !== "SOURCE_PASSAGE") continue;
    const quote = record.subjectId === subjectId ? OWN_PAGE.exec(record.text)?.[1]?.trim() : undefined;
    if (!quote || !record.sourceUrl || !record.retrievedAt || !formatDateLong(record.retrievedAt.slice(0, 10))) { unclean += 1; continue; }
    if (passages.some((p) => p.quote === quote && p.url === record.sourceUrl)) continue;
    passages.push({ quote, url: record.sourceUrl, retrievedAt: record.retrievedAt });
  }
  return { passages, unclean };
}

export function composeOwnWordsAnswer(input: {
  subject: EvidenceSubject | null;
  question: string;
  records: readonly EvidenceRecord[];
}): { answer: string; citedUrls: string[] } | null {
  const { subject } = input;
  if (!subject || subject.kind !== "PERSON" || !asksForPersonalStance(input.question)) return null;
  const { passages, unclean } = ownWordsPassages(input.records, subject.id);
  // Every passage in the pack must be a clean own-page quotation; a mixed pack is for the existing path.
  if (passages.length === 0 || unclean > 0) return null;
  const shown = passages.slice(0, MAX_PASSAGES);
  const lines = shown.map((p) =>
    `On ${formatDateLong(p.retrievedAt.slice(0, 10))}, we read this on a page of theirs: “${p.quote}”`);
  const answer = `${subject.name}'s own words, exactly as published. ${lines.join(" ")}`;
  return { answer, citedUrls: [...new Set(shown.map((p) => p.url))] };
}
