/**
 * The free-text scrub used for comment detail and model input. Ask question
 * and answer storage preserve the words exactly. Replaced with `[#]`:
 *  - digit runs totalling 7+ digits, separators allowed (phone, SSN, account
 *    numbers: "973-627-2000" and "9736272000" both);
 *  - email-shaped tokens (anything@anything.tld);
 *  - street-address-shaped tokens (a number followed by capitalized words:
 *    "123 Main Street").
 * Deliberately blunt: it may eat a harmless long number.
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
