import type { Query } from "../facts/publish.ts";
import { PLACE_REGISTRATION_SQL } from "../registration/reader.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { Division } from "../registry/types.ts";
import { groupedBy } from "./slices.ts";

/** What the registration holds for a place: the governments that name it and its own division row. */
export interface PlaceRegistration {
  readonly governments: readonly RegistrationGovernmentListing[];
  readonly divisions: readonly Division[];
  /** Each government's place in the state's list ordered by the name it is paid under, in step with `governments`: readers list governments in that order. */
  readonly order: readonly number[];
}

/**
 * The registration of governments for these places, one statement a state. A government that names several of the places is held by each.
 * (A state's whole registration is megabytes; a place takes only what names it.)
 */
export async function registrationOf(query: Query, places: readonly string[]): Promise<Map<string, PlaceRegistration>> {
  const out = new Map<string, PlaceRegistration>();
  const states = groupedBy(await query("SELECT id,state FROM entity WHERE id=ANY($1::text[]) AND state IS NOT NULL", [places]), "state");
  for (const [state, rows] of states) {
    const ids = rows.map(row => String(row.id)), found = await query(PLACE_REGISTRATION_SQL, [state.trim().toUpperCase(), ids]);
    for (const id of ids) {
      const mine = found.filter(row => row.kind === "government" && (row.value as RegistrationGovernmentListing).associations.some(association => association.divisionId === id));
      const governments = mine.map(row => row.value as RegistrationGovernmentListing), order = mine.map(row => Number(row.ordinal));
      const divisions = found.filter(row => row.kind === "division" && (row.value as Division).ocdId === id).map(row => row.value as Division);
      if (governments.length || divisions.length) out.set(id, { governments, divisions, order });
    }
  }
  return out;
}
