/**
 * What the map shows while its next answer is in flight. A retrieval in
 * progress is never rendered as an absence: the map keeps the pins it had
 * until the new answer replaces them, but only while the held answer belongs
 * to the zip still shown, so a zip change drops it at once. A failed fetch
 * also holds; the failure card says the refresh failed.
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
