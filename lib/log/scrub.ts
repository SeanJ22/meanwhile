/**
 * The free-text scrub (session brief 4, wall clock 2026-08-14): the
 * refusal log captures raw typed questions, the store is publicly
 * described as identifier-free, and a reader WILL type an address or a
 * phone number into a question box. The author's decision: keep the
 * capture, scrub first — before storage, mechanically, with no judgment
 * calls.
 *
 * What gets replaced with `[#]`:
 *  - digit runs totalling 7+ digits, separators allowed (phone numbers,
 *    SSNs, account numbers — "973-627-2000" and "9736272000" both);
 *  - email-shaped tokens (anything@anything.tld);
 *  - street-address-shaped tokens (a number followed by capitalized
 *    words — "123 Main Street").
 *
 * The scrub is deliberately blunt: it will occasionally eat something
 * harmless (a bill number long enough to look like a phone number), and
 * that is the correct direction — the log's value is the topic of the
 * question, never its digits. It runs server-side at the single write
 * path (lib/db/search-log.ts) so nothing unscrubbed can reach the store
 * whatever the client sends.
 */

const EMAIL_SHAPED = /\S+@\S+\.\S+/g;

// 7+ digits total, allowing common phone separators between groups.
// The count is of DIGITS, not characters — "(973) 627-2000" scrubs.
// The trailing class carries no whitespace so the match never eats the
// space separating the run from the next word.
const LONG_DIGIT_RUN = /\(?(?:\d[\s().-]{0,2}){6}\d[\d().-]*/g;

// A short number followed by 1–4 Capitalized words: the street-address
// shape. Word-boundary anchored so mid-sentence numbers with lowercase
// continuations ("3 potholes on my street") survive.
const STREET_ADDRESS_SHAPED = /\b\d{1,6}(?:\s+[A-Z][A-Za-z]+){1,4}\b/g;

export const SCRUB_MARK = "[#]";

export function scrubFreeText(text: string): string {
  return text
    .replace(EMAIL_SHAPED, SCRUB_MARK)
    .replace(LONG_DIGIT_RUN, SCRUB_MARK)
    .replace(STREET_ADDRESS_SHAPED, SCRUB_MARK)
    .replace(/\s+/g, " ")
    .trim();
}
