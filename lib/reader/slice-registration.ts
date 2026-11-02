import type { Query } from "../facts/publish.ts";
import { PLACE_REGISTRATION_SQL } from "../registration/reader.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { Division } from "../registry/types.ts";

/** What the registration holds for a place: the governments that name it and its own division row. */
export interface PlaceRegistration { readonly governments: readonly RegistrationGovernmentListing[]; readonly divisions: readonly Division[] }

/**
 * The registration of governments for these places, one statement. A government that names several of the places is held by each.
 * (A state's whole registration is megabytes; a place takes only what names it.)
 */
export async function registrationOf(query: Query, places: readonly string[]): Promise<Map<string, PlaceRegistration>> {
  const out = new Map<string, PlaceRegistration>();
  const named = await query("SELECT id,upper(btrim(state)) AS state FROM entity WHERE id=ANY($1::text[]) AND state IS NOT NULL", [places]);
  if (!named.length) return out;
  const found = await query(PLACE_REGISTRATION_SQL, [named.map(row => String(row.state)), named.map(row => String(row.id))]);
  for (const { id } of named) {
    const governments = found.filter(row => row.kind === "government" && (row.value as RegistrationGovernmentListing).associations.some(association => association.divisionId === id)).map(row => row.value as RegistrationGovernmentListing);
    const divisions = found.filter(row => row.kind === "division" && (row.value as Division).ocdId === id).map(row => row.value as Division);
    if (governments.length || divisions.length) out.set(String(id), { governments, divisions });
  }
  return out;
}
