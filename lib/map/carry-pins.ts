/**
 * R47 (2026-08-18) — what the map shows while its next answer is in flight.
 *
 * ## The defect
 *
 * `map-entry.tsx` derives the meetings it pins from `current`, the answer
 * keyed to the view being shown. Between a settle and its reply `current` is
 * null — that gap is documented in that file for the who-governs CARD, which
 * was given a carry-forward in 6f. The PINS never were, so they emptied to
 * `[]` for the whole gap and every pin left the map.
 *
 * ## Why it read as a race, and was not one
 *
 * `pnpm walk:all` samples the pin count once per zoom level with a fixed wait
 * and reported the wipe on one run and not the next, same build, minutes
 * apart — which reads as a timing race. Sampling every 100 ms instead
 * (`pnpm probe:r47`) showed it on 4 of 4 runs against production: the pool
 * sits at ZERO for 200–500 ms on every zoom-out that re-queries, while an
 * `/api/meetings` request is in flight. The defect was deterministic; the
 * INSTRUMENT was intermittent, because one sample lands inside a 300 ms
 * window only sometimes.
 *
 * ## The rule
 *
 * CLAUDE.md's refresh corollary, one layer up from the snapshot it was
 * written for: a retrieval in progress may not be written into the render as
 * an absence. The map keeps the pins it already had until the new answer
 * replaces them. Nothing new is claimed — these are the pins that were on
 * screen a moment ago.
 *
 * ## The scope, which is the part that needs care
 *
 * It is NARROWER than the card's. The card holds its last answer across
 * anything, including a new zip. Pins may not: holding one area's entities
 * while another area loads is the stale-data bug `map-entry.tsx` names at
 * `search()` — Tucson's pins under a New Hampshire zip. So a held answer is
 * carried only while it belongs to the zip still being shown, and a zip
 * change drops it on the same render it always did.
 *
 * A FAILED fetch also holds, deliberately. The failure card renders beside
 * the map and names the status, so this is the carry-forward doctrine and not
 * a silent one: the reader is told the refresh failed and still sees what was
 * last known, rather than being shown an empty map that asserts there is
 * nothing here.
 */

export interface CarryPinsInput<T> {
  /** The answer keyed to the view being shown, or null while one is in flight. */
  current: T | null;
  /** The last answer that arrived, with the zip it belongs to. */
  held: { result: T; forZip: string | null } | null;
  /** The zip the reader is looking at now, or null before one resolves. */
  locationZip: string | null;
}

/**
 * The answer the PINS should render from: the current one, or the last one
 * while it still describes the same area.
 */
export function carryPins<T>({
  current,
  held,
  locationZip,
}: CarryPinsInput<T>): T | null {
  if (current) return current;
  if (!held || locationZip === null) return null;
  // Same area, so the previous answer is still about where the reader is.
  return held.forZip === locationZip ? held.result : null;
}
