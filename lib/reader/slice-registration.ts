import type { Query } from "../facts/publish.ts";
import { PLACE_REGISTRATION_SQL } from "../registration/reader.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { Division } from "../registry/types.ts";
import { runtimeOf, type PlaceRuntime } from "./slice-runtime.ts";

/** What the registration holds for a place: the governments that name it and its own division row. */
export interface PlaceRegistration {
  readonly governments: readonly RegistrationGovernmentListing[];
  readonly divisions: readonly Division[];
  /** Each government's place in the state's list ordered by the name it is paid under, in step with `governments`: readers list governments in that order. */
  readonly order: readonly number[];
  /** What the state's reviewed registry holds for the boards filed here and the divisions above (the state's own card also holds what is statewide). */
  readonly rt?: PlaceRuntime;
}

/**
 * The registration of governments for these places, one statement. A government that names several of the places is held by each.
 * (A state's whole registration is megabytes; a place takes only what names it.)
 */
export async function registrationOf(query: Query, places: readonly string[]): Promise<Map<string, PlaceRegistration>> {
  const out = new Map<string, PlaceRegistration>();
  const named = await query("SELECT id,upper(btrim(state)) AS state FROM entity WHERE id=ANY($1::text[]) AND state IS NOT NULL", [places]);
  if (!named.length) return out;
  const found = await query(PLACE_REGISTRATION_SQL, [named.map(row => String(row.state)), named.map(row => String(row.id))]);
  const runtime = new Map<string, PlaceRuntime>();
  for (const state of new Set(named.map(row => String(row.state)))) for (const [id, rt] of await runtimeOf(query, state, named.filter(row => row.state === state).map(row => String(row.id)))) runtime.set(id, rt);
  for (const { id } of named) {
    const mine = found.filter(row => row.kind === "government" && (row.value as RegistrationGovernmentListing).associations.some(association => association.divisionId === id));
    const governments = mine.map(row => row.value as RegistrationGovernmentListing), order = mine.map(row => Number(row.ordinal));
    const divisions = found.filter(row => row.kind === "division" && (row.value as Division).ocdId === id).map(row => row.value as Division);
    const rt = runtime.get(String(id));
    if (governments.length || divisions.length || rt) out.set(String(id), { governments, divisions, order, ...rt ? { rt } : {} });
  }
  return out;
}
