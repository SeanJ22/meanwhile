/**
 * **WHAT A PIECE OF WORK IS ABOUT, READ FROM ITS OWN ID.** (Expansion controls, 2026-09-23.)
 *
 * The join key every expansion-scope reading uses is the obligation's
 * `subjectId` — the value the standing obligation registers under, and the
 * value `dispatch.ts` writes into every cost-ledger row's `jurisdiction`
 * field. Membership, spend and the assignment filter therefore all key on the
 * same string, and none of them re-derives it from a name.
 *
 * The standing providers build their obligation ids as
 * `freshness:<provider>:<subjectId>#<routeId>` (`scheduledId` in each provider),
 * so the subject is recoverable from an assignment row's id without a read.
 * The meetings-discovery rows the owner's dispatch materialized (MW-028) are
 * about a jurisdiction in the same way.
 *
 * PURE.
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
 * does not say.
 *
 * The registry ids (`az:county:county-of-pima`), candidacy ids
 * (`az:2026:state-az:governor:…`), statewide finance subjects
 * (`az-sos-cfs-2026`) and ballot contests (`ballot-az-pima:prop-423`) all carry
 * their state in a fixed place. Anything else answers null — an unknown state,
 * never a guessed one.
 */
export function stateOfSubject(subjectId: string): string | null {
  const lower = subjectId.toLowerCase();
  const ballot = /^ballot-([a-z]{2})[-:]/.exec(lower);
  const lead = ballot ?? /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(lower) ?? /^([a-z]{2})[:-]/.exec(lower);
  if (lead === null) return null;
  return US_STATE_CODES.has(lead[1]) ? lead[1].toUpperCase() : null;
}
