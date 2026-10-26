import memory from "./memory.json" with { type: "json" };

const STATES: Readonly<Record<string, { readonly reservationMiB: number }>> = memory.states;

/** A state map's memory reservation: its own measured peak, or one derived from its Census block file (memory.json). */
export function placeMapReservationMiB(state: string): number {
  const row = STATES[state.toUpperCase()];
  if (!row) throw new Error(`PLACE_MAP_RESERVATION_UNKNOWN:${state}`);
  return row.reservationMiB;
}
