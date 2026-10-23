export interface CarryPinsInput<T> {
  /** The answer keyed to the view being shown, or null while one is in flight. */
  current: T | null;
  /** The last answer that arrived, with the zip it belongs to. */
  held: { result: T; forZip: string | null; stateOcdId: string | null } | null;
  /** The zip the reader is looking at now, or null before one resolves. */
  locationZip: string | null;
  stateOcdId: string | null;
}

export function carryPins<T>({
  current,
  held,
  locationZip,
  stateOcdId,
}: CarryPinsInput<T>): T | null {
  if (current) return current;
  if (!held || locationZip === null) return null;
  // Same area, so the previous answer is still about where the reader is.
  return held.forZip === locationZip && held.stateOcdId === stateOcdId ? held.result : null;
}
