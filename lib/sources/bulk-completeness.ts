/**
 * **DID THE WHOLE BULK FILE ARRIVE?** The completeness checks for the bulk-file
 * pullers that hand-roll their own `fetch` — congress, plural, dotgov and the
 * Census ACS promotion — rather than going through `lib/sources/http.ts`.
 *
 * These live in their own module, not in `http.ts`, on purpose: `http.ts` and
 * `census-acs-population/index.ts` are bound by the Reader Last-Mile closure
 * receipt (`docs/evidence/reader-last-mile-final-closure-receipt.json` — the
 * meeting adapters reach `http.ts`, and `candidate-builders.ts` reaches the
 * census adapter), and `readerSourceImpact` classes `lib/sources/*` OUTSIDE the
 * frozen invalidation boundary, so a byte change there forces the heaviest
 * reader re-proof. This module is reached only from the bulk pullers and the
 * acquisition scripts — never from a reader surface — so the guard can grow here
 * without disturbing that receipt.
 *
 * The two shapes a truncated bulk file takes, and the check for each:
 *  - a transfer cut short of its declared length → `shortTransfer`
 *  - a complete-but-short table (an error page that still parses, a partial
 *    body whose Content-Length matched it) → a record-count floor
 * Both exist because a truncated CSV/JSON still parses into a smaller document,
 * the silent-wrong-data "correct first" forbids (CLAUDE.md, RULING 273).
 */

/**
 * Was the transfer cut short of the length the server declared? Returns the
 * reason it fell short, or `null` when the length reconciles — or cannot be.
 *
 * **Meaningful only for an IDENTITY-coded response, and the reason is a
 * measurement, not a guess (2026-09-18).** `fetch` (undici) transparently
 * decodes a compressed body but leaves `Content-Length` describing the WIRE
 * bytes — `content-encoding: gzip` with `content-length: 177` for a 55 KB body
 * — so comparing the declared length to the decoded size would refuse every
 * gzip response. When the transfer is compressed this defers to the caller's
 * record-count floor, which is what attests a complete decoded body.
 *
 * **A belt, not the only strap.** undici already rejects a truncated identity
 * transfer with `TypeError: terminated`, so against undici in production this
 * rarely fires. It is the explicit, testable refusal for a body an injected
 * `fetch` or a non-undici runtime handed back without the transport's
 * enforcement — and it never fires on a complete transfer, so it cannot turn a
 * healthy source red.
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
 * The floor of DATA rows the Census ACS table must return for each scope, or
 * the acquisition is refused as truncated. Kept here rather than in the reader-
 * bound census adapter, and enforced by `scripts/acs-population-promote.mts` —
 * the one production caller of the adapter's `fetch`.
 *
 * Set well below what the 2024 release actually tabulates and far above zero,
 * the same shape as the dotgov thin-guard. Measured directly on 2026-09-18 with
 * this repository's key: `for=state:*` returns 52 data rows (50 states, DC and
 * Puerto Rico) and `for=zip code tabulation area:*` returns 33,772.
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
