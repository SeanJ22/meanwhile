/**
 * A buyer account holds a place, topics and a time window, never a side: a stored `BuyerSlice`. When the audience is the dashboard or a customer and a slice is held for them, the request is confined to it:
 * the window is clamped into the held window, the held place and topics fill in what the request left out, and a request for a
 * place or topic outside what they hold is refused, never widened. `BuyerSlice` has no field for support, oppose or any sentiment,
 * so an account cannot be built around a side.
 */
import type { BuyerSlice, PlaceFilter, Slice } from "./types.ts";
import type { PlaceIndex } from "./places.ts";
import { stateOfDivision } from "./slice.ts";

export type Confined = { readonly ok: true; readonly slice: Slice } | { readonly ok: false; readonly says: string };

/** Is `inner` the same place as, or entirely inside, `outer`? A state holds its counties, ZIPs and districts; other pairs must match. */
async function within(inner: PlaceFilter, outer: PlaceFilter, places: PlaceIndex): Promise<boolean> {
  if (inner.kind === outer.kind) return inner.id === outer.id;
  if (outer.kind === "state") {
    if (inner.kind === "district") return stateOfDivision(inner.id) === outer.id;
    if (inner.kind === "county") return stateOfDivision(inner.id) === outer.id;
    return (await places.of([inner.id])).get(inner.id)?.state === outer.id;
  }
  if (outer.kind === "county" && inner.kind === "zip") {
    // A ZIP reaching a second county is not entirely inside this one.
    const counties = (await places.of([inner.id])).get(inner.id)?.counties ?? [];
    return counties.length > 0 && counties.every((c) => c === outer.id);
  }
  return false;
}

export async function confineToBuyer(requested: Slice, held: BuyerSlice, places: PlaceIndex): Promise<Confined> {
  let place = requested.place ?? null;
  if (held.place != null) {
    if (place === null) place = held.place;
    else if (!(await within(place, held.place, places))) return { ok: false, says: "That place is outside the place this account holds." };
  }
  let topics = requested.topics ?? null;
  if (held.topics != null) {
    if (topics === null) topics = held.topics;
    else if (!topics.every((t) => held.topics!.includes(t))) return { ok: false, says: "Those topics are outside the topics this account holds." };
  }
  const from = held.from != null && requested.from < held.from ? held.from : requested.from;
  const to = held.to != null && requested.to > held.to ? held.to : requested.to;
  if (from > to) return { ok: false, says: "That time window is outside the window this account holds." };
  return { ok: true, slice: { ...requested, from, to, place, topics } };
}
