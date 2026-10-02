import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { stateBase } from "../../ocd/divisions.ts";
import type { Division } from "../../registry/types.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../../registry/runtime-data-plane.ts";
import { readPlacePayloadParts } from "../../civic-data/place-payload-slices.ts";
import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import type { ReadOnlyQuery } from "../admin-view/promoted-slices.ts";

// The directory publisher uses this same exact comparison: punctuation and
// case are immaterial; abbreviations, suffixes and similar names are not.
const words = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Published territory candidates for a directory's explicit coverage names.
 * Return all exact matches, including ambiguous ones, so the publisher can
 * retain its existing unique-match and coverage-evidence requirements. No
 * national payload, label-based identity, or partial-name fallback is used. */
export async function readStateDivisionsByName(stateCode: string, names: readonly string[],
  options: { readonly query?: ReadOnlyQuery } = {}): Promise<readonly Division[]> {
  const entry = Object.entries(FIPS_TO_STATE).find(([, state]) => state.postal === stateCode.trim().toUpperCase());
  const root = entry && stateBase(entry[0])?.base;
  if (!root) throw new Error(`TERRITORY_NAME_STATE_INVALID:${stateCode}`);
  const wanted = [...new Set(names.map(words).filter(Boolean))];
  if (!wanted.length) return [];
  const query = options.query ?? readerQuery();
  if (!query) throw new Error("TERRITORY_NAME_STORE_UNCONFIGURED");
  const values = await readPlacePayloadParts(query, "REGISTRY_RUNTIME_BINDING", [REGISTRY_RUNTIME_SCOPE], [], [], [],
    { divisionNames: { root, names: wanted } });
  const value = values.get(REGISTRY_RUNTIME_SCOPE) as { registry?: { divisions?: Division[] } } | undefined;
  return (value?.registry?.divisions ?? []).filter(division =>
    (division.ocdId === root || division.ocdId.startsWith(`${root}/`)) && wanted.includes(words(division.label)))
    .sort((a, b) => a.ocdId.localeCompare(b.ocdId));
}
