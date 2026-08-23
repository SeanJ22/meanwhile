/**
 * The one place the outbound contact address is written.
 *
 * Two routes call the Census Bureau's geocoder on a reader's behalf —
 * `/api/geocode` (M80) and `/api/voting-sites` (B19) — and both must identify
 * themselves with somewhere to write, as every retrieval in this product does.
 *
 * **Why a module rather than a second string literal.** R40 removed the
 * author's personal address from everything a browser can reach, and
 * `tests/feedback.test.ts` holds that with one exemption. The second route
 * copied the literal, and the guard caught it. Widening the exemption to two
 * files would have been the wrong fix: the address would then live in two
 * places, and the next route would make it three. One module, one exemption,
 * and the guard stays as tight as it was.
 *
 * This file is server-only. Nothing a browser imports may reach it.
 */
export const OUTBOUND_USER_AGENT =
  "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";

/**
 * The contact address ALONE, so a caller that needs a different product string
 * can compose one without writing the address a second time.
 *
 * Added 2026-08-22 (NJ Hunt 5). `lib/hunt/wikipedia.ts` needs an identified
 * `User-Agent` for the Wikipedia API and for the primary sources it fetches to
 * confirm citations, and it copied the literal — which is exactly the mistake
 * the note above records `/api/voting-sites` making, and the guard caught it
 * the same way. The fix is the same one: compose from here, do not widen the
 * exemption.
 */
export const OUTBOUND_CONTACT = "seanj22@gmail.com";
