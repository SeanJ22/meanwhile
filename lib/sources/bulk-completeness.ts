/**
 * Did the whole bulk file arrive? Completeness checks for the bulk-file pullers that hand-roll their own
 * `fetch` (congress, plural, dotgov and the Census ACS promotion). Kept out of `http.ts` and the census
 * adapter, which are reader-bound; this module is reached only from bulk pullers and acquisition scripts.
 *
 * A truncated CSV/JSON still parses into a smaller document, so each shape gets a check:
 *  - a transfer cut short of its declared length → `shortTransfer`
 *  - a complete-but-short table (an error page that still parses, a partial body whose Content-Length
 *    matched it) → a record-count floor
 */

/**
 * Was the transfer cut short of the length the server declared? Returns the reason, or `null` when the
 * length reconciles or cannot be checked. Meaningful only for an identity-coded response: `fetch` decodes
 * compressed bodies but leaves `Content-Length` describing the wire bytes, so a compressed transfer
 * defers to the caller's record-count floor. It never fires on a complete transfer.
 */
export function shortTransfer(
  headers: { get(name: string): string | null },
  body: string,
): string | null {
  const encoding = (headers.get("content-encoding") ?? "").trim().toLowerCase();
  // A compressed transfer's Content-Length is the compressed size; it is not
  // comparable to the decoded body, and undici rejects a truncated compressed
  // stream at decode time. Completeness there is a record-count question.
  if (encoding !== "" && encoding !== "identity") return null;
  const declared = (headers.get("content-length") ?? "").trim();
  // No declared length (chunked, or a HEAD-style response) — nothing to check.
  if (!/^\d+$/.test(declared)) return null;
  const expected = Number(declared);
  if (!Number.isSafeInteger(expected)) return null;
  const received = Buffer.byteLength(body, "utf8");
  if (received < expected) {
    return `a short read: the server declared Content-Length ${expected} but ${received} byte(s) arrived`;
  }
  return null;
}

/**
 * The floor of data rows the Census ACS table must return for each scope, or the acquisition is refused
 * as truncated. Enforced by `scripts/acs-population-promote.mts`. Well below the current release (52
 * state rows, ~33,772 ZCTAs) and far above zero.
 */
export const ACS_ROW_FLOOR: Record<"zcta" | "state", number> = { zcta: 30_000, state: 50 };

/**
 * Is the acquired ACS table too short to be the complete geography? Returns the
 * reason it is, or null. A valid-but-short JSON array — an error object served
 * as JSON, a partial page, a genuinely truncated file whose Content-Length
 * matched its short body — parses cleanly and would render as a country with
 * almost no ZCTAs; the floor refuses it rather than promote it.
 */
export function acsTableTooShort(scope: "zcta" | "state", dataRows: number): string | null {
  const floor = ACS_ROW_FLOOR[scope];
  if (dataRows < floor) {
    return `Census ACS ${scope} returned ${dataRows} data row(s), below the floor of ${floor} — refusing a truncated or partial table (the 2024 release tabulates 52 states/DC/PR and ~33,772 ZCTAs)`;
  }
  return null;
}
