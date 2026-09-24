/**
 * **THE MORRIS COUNTY CLERK'S TWO FILING DOCUMENTS, BY NAME: ONE RULE.**
 * (2026-09-24, C17; RULING 103.)
 *
 * The clerk publishes the 2026 general-election filing as two PDFs: the
 * general candidate list and the school candidate list. On 2026-09-18 the
 * clerk revised the general list and renamed it `2026-general-candidates.pdf`
 * at `/v/12/`, dropping the date stamp every earlier revision carried
 * (`-082126`, `-9012026`).
 *
 * Two copies of the naming rule existed: the selector in
 * `lib/hunt/nj-filing.ts` and the validator in `candidate-builders.ts`. #403
 * fixed the selector, and the validator's copy still demanded a stamp, so the
 * clerk's current list was refused as "not both acquired". This module is the
 * one rule both read. A stamp of any shape is optional; the school list is
 * never taken for the general one.
 */

/** The clerk's general-election candidate list, stamped or not. */
export function isMorrisGeneralCandidatesDocument(url: string): boolean {
  return /(?:^|\/)2026-general(?:-election)?-candidates(?:-(?![^/]*school)[^/]*)?\.pdf(?:$|[?#])/i.test(url) &&
    !/general-school-candidates/i.test(url);
}

/** The clerk's general-election school candidate list, stamped or not. */
export function isMorrisSchoolCandidatesDocument(url: string): boolean {
  return /(?:^|\/)2026-general-school-candidates(?:-[^/]*)?\.pdf(?:$|[?#])/i.test(url);
}
