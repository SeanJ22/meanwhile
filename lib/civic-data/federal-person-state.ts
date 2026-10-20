import { federalDirectoryScope } from "../officials/federal-directory-data-plane.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import { REGISTRY_STATES, requireRegistryState } from "./state-scopes.ts";
import { PUBLISHED_NATIVE_STATE_LOOKUP_SQL } from "./published-array-slice.ts";
import { currentNationalShelf } from "../reader/national.ts";

/** A native member profile has its own place even without a reader ZIP.
 * All pointer/proof and native-ID filtering happens inside the database; only
 * the exact member's two-character state key crosses the connection. */
export async function publishedFederalPersonState(id: string, query: ReadOnlyQuery | null = readerDatabaseQuery()): Promise<string | null> {
  if (!/^congress:[A-Z]\d{6}$/.test(id)) throw new Error("FEDERAL_PERSON_ID_INVALID");
  const held = currentNationalShelf();
  if (held) {
    const states = [...held.federalByState].filter(([, model]) => model.roster.officeholders.some(holder => holder.id === id)).map(([state]) => state);
    if (states.length > 1) throw new Error("FEDERAL_PERSON_STATE_AMBIGUOUS");
    if (states.length === 1) return requireRegistryState(states[0]);
  }
  if (!query) return null;
  const [rows] = await query([{ text: PUBLISHED_NATIVE_STATE_LOOKUP_SQL,
    params: ["FEDERAL_DIRECTORY", REGISTRY_STATES.map(federalDirectoryScope), ["roster", "officeholders"], ["id"], `^${id}$`, false, [], null, false, false, null] }]);
  const states = [...new Set(rows.map(row => requireRegistryState(String(row.state))))];
  if (states.length > 1) throw new Error("FEDERAL_PERSON_STATE_AMBIGUOUS");
  return states[0] ?? null;
}
