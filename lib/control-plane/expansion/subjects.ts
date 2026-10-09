/**
 * What a piece of work is about, read from its own id. Every expansion-scope
 * reading keys on the obligation's `subjectId`, the same value written into
 * every cost-ledger row's `jurisdiction`. Standing obligation ids are
 * `freshness:<provider>:<subjectId>#<routeId>`.
 *
 * Pure.
 */

import { FIPS_TO_STATE } from "../../ocd/fips.ts";

/** The obligation-id prefixes of the standing providers, each followed by the subject. */
const STANDING_PREFIXES = [
  "freshness:jurisdiction:",
  "freshness:campaign-finance:",
  "freshness:candidate-enrichment:",
  "freshness:tracker:",
  "freshness:meetings-discovery:",
] as const;

/** The subject a standing obligation id names, or null for any other kind of id. */
export function subjectOfObligationId(id: string): string | null {
  for (const prefix of STANDING_PREFIXES) {
    if (!id.startsWith(prefix)) continue;
    const rest = id.slice(prefix.length);
    const hash = rest.indexOf("#");
    const subject = hash < 0 ? rest : rest.slice(0, hash);
    return subject === "" ? null : subject;
  }
  return null;
}

/** Every state/territory postal code, lower-case, from the one Census FIPS table (`lib/ocd/fips.ts`). */
const US_STATE_CODES = new Set(Object.values(FIPS_TO_STATE).map((entry) => entry.postal.toLowerCase()));

/**
 * The two-letter state a subject belongs to, uppercased, or null when its id
 * does not say. Registry ids (`<st>:county:…`), candidacy ids, statewide
 * finance subjects (`<st>-sos-…`) and ballot contests (`ballot-<st>-…`) carry
 * it in a fixed place.
 */
export function stateOfSubject(subjectId: string): string | null {
  const lower = subjectId.toLowerCase();
  const ballot = /^ballot-([a-z]{2})[-:]/.exec(lower);
  const lead = /^government:us-([a-z]{2}):/.exec(lower) ?? ballot ?? /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(lower) ?? /^([a-z]{2})[:-]/.exec(lower);
  if (lead === null) return null;
  return US_STATE_CODES.has(lead[1]) ? lead[1].toUpperCase() : null;
}
