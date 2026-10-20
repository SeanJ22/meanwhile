/**
 * Did the whole bulk file arrive? Completeness checks for the bulk-file pullers that hand-roll their own
 * `fetch` (congress, plural and dotgov). Kept out of `http.ts` and the census
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
