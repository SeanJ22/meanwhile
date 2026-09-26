import type { ZipDivisionEntry } from "../../geo/zip-division-index.ts";

/** Shared state and federal records also apply to a local US hunt. Derive
 * their identities from held division IDs, never a geographic label. A ZIP
 * crossing states keeps each state partial; local boundaries stay unchanged. */
export function withSharedScopeDivisions(entry: ZipDivisionEntry): ZipDivisionEntry {
  const states = [...new Set(entry.ids.flatMap(id => /^ocd-division\/country:us\/state:[a-z]{2}(?=\/|$)/.exec(id)?.[0] ?? []))];
  const country = entry.ids.some(id => /^ocd-division\/country:us(?:\/|$)/.test(id)) ? ["ocd-division/country:us"] : [];
  return { ...entry, ids: [...new Set([...country, ...states, ...entry.ids])], partial: [...new Set([...entry.partial, ...(states.length > 1 ? states : [])])] };
}
