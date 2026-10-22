/** Resolve an Admin place against held Census geography. No source request or caller-supplied division is used. */
import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import { censusWorkDivision } from "../../census-geography/division-id.ts";
import { containersOfCode, oneContainer, type ReadOnlyQuery } from "./promoted-slices.ts";
import { parseV6PlaceKey } from "./v6-hunts-read.ts";
import { stateDivisionId } from "./v6-national-geography.ts";

export type OfficialsScope = { readonly ok: true; readonly placeKey: string; readonly label: string; readonly divisions: readonly string[] }
  | { readonly ok: false; readonly says: string };

export async function resolveOfficialsScope(placeKey: string, query: ReadOnlyQuery | null = readerQuery(2_000)): Promise<OfficialsScope> {
  const place = parseV6PlaceKey(placeKey);
  if (place === null || place.kind === "country") return { ok: false, says: "Choose a state, county, district or ZIP." };
  const state = stateDivisionId(place.state);
  if (state === null) return { ok: false, says: "That state is not recognized." };
  if (place.kind === "state") return { ok: true, placeKey, label: place.state.toUpperCase(), divisions: [state] };
  if (place.type === "zcta") {
    if (!/^\d{5}$/.test(place.geoid)) return { ok: false, says: "Choose a five-digit ZIP." };
    const held = await containersOfCode(place.geoid, ["county", "congressional_district", "state_leg_upper", "state_leg_lower"], query);
    if (held.kind !== "HELD" || !held.value.known) return { ok: false, says: "The saved Census boundaries for this ZIP could not be read." };
    const states = [...new Set(held.value.containers.filter(c => c.ref.type === "county").map(c => c.ref.stateAbbr.toLowerCase()))];
    if (!states.includes(place.state)) return { ok: false, says: "This ZIP's saved boundaries do not touch that state." };
    const divisions = [...new Set([...states.flatMap(st => stateDivisionId(st) ?? []),
      ...held.value.containers.flatMap(c => censusWorkDivision(c.ref) ?? [])])];
    return { ok: true, placeKey, label: `ZIP ${place.geoid}`, divisions };
  }
  if (!["county", "congressional_district", "state_leg_upper", "state_leg_lower"].includes(place.type)) return { ok: false, says: "Choose a state, county, district or ZIP." };
  const held = await oneContainer(place.type as "county" | "congressional_district" | "state_leg_upper" | "state_leg_lower", place.geoid, query);
  if (held.kind !== "HELD") return { ok: false, says: "The saved Census boundaries for this place could not be read." };
  const matches = held.value.containers.filter(c => c.ref.stateAbbr.toLowerCase() === place.state && c.ref.type === place.type && c.ref.geoid === place.geoid);
  if (matches.length !== 1) return { ok: false, says: "This place does not have one matching saved Census boundary." };
  const division = censusWorkDivision(matches[0].ref);
  if (division === null) return { ok: false, says: "This place's saved boundary has no government division." };
  return { ok: true, placeKey, label: matches[0].ref.label, divisions: [state, division] };
}
