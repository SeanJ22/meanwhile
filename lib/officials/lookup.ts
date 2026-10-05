import { isJurisdictionSegment } from "../ocd/fips.ts";
import type { Provenance } from "../sources/types.ts";

import { campaignSiteFor } from "./campaign-sites.ts";
import type {
  Officeholder,
  OfficeholderSet,
  SocialAccounts,
} from "./types.ts";

/**
 * Turning the officeholder roster into an answer for a point.
 *
 * Pure, and separate from the loading, so it runs in a test without touching
 * the filesystem — the same split `lib/registry/resolve.ts` uses.
 */

/**
 * What a surface needs to render a person honestly: who they are, and where
 * that claim came from.
 *
 * Trimmed from `Officeholder` on purpose. Term dates and phone numbers belong
 * on the officeholder panel in Phase 5.3, not on a coverage notice, and
 * shipping the full record to the client would put the whole roster shape in
 * the bundle for no benefit.
 */
export interface SeatHolder {
  fieldSources?: Record<string, Provenance>;
  id: string;
  name: string;
  officeTitle: string;
  /**
   * The jurisdiction that owns this office when the holder came from a
   * body-scoped roster. This is presentation context, not a replacement for
   * the many-to-many officeholder/division join.
   *
   * Projected on the server so client components never need to import the
   * canonical registry read model merely to choose jurisdiction-specific
   * explanatory copy.
   */
  officeJurisdictionOcdId?: string | null;
  /** Display only. Never used to infer a position or a vote. */
  partyLabel: string | null;
  /**
   * 6d (2026-08-15): "In seat until", on the small card AND the battlecard.
   * The date the SOURCE publishes for the end of the current term. Never
   * computed from an election cycle: a term that ended early, a seat filled
   * by appointment, or a state with an unusual calendar would all be quietly
   * wrong, and a wrong date about a government is the one failure this
   * product cannot survive. No sourced term, nothing renders.
   */
  termEnd: string | null;
  /** Where the source states one: the ISO date this term starts. */
  termStart?: string | null;
  /** Verbatim sourced term/appointment wording; never parsed into a term date. */
  termNote?: string | null;
  /**
   * 6d: the ONLY basis on which an age may render, and it is a DATE rather
   * than an age so the number is computed fresh at every render and cannot
   * drift. Federal members carry the bioguide's; state and local rosters
   * publish none and render no age.
   */
  birthDate: string | null;
  websiteUrl: string | null;
  /** Where the record was read from. Rendered, not just stored. */
  sourceUrl: string | null;
  /**
   * The FULL record behind this row — publisher, read date, verification —
   * not just its URL (item 1, 2026-08-16).
   *
   * `sourceUrl` alone was enough for the inline "source" tag and nothing
   * else, which is why every battlecard's Sources tab had to be fed from
   * somewhere other than the rows it was describing. It was fed from nowhere,
   * and the tab told readers that a card built entirely from external records
   * came from none. A row that carries its own provenance cannot be listed
   * without it.
   *
   * Null only where a row genuinely has no publisher on record.
   */
  provenance: Provenance | null;
  /** Published official contact (3a). Absences are absences. */
  email: string | null;
  phone: string | null;
  /** Distinguishes a shared public office channel from a direct office line. */
  contactScope?: "SHARED_OFFICE" | "INDIVIDUAL_OFFICE";
  /** Earlier verified sources for optional facts retained after an incomplete update. */
  retainedFieldSources?: Partial<Record<"termNote" | "termStart" | "termEnd" | "email" | "phone" | "websiteUrl", { sourceUrl: string; sourceOrg: string; collectedAt: string }>>;
  contactFormUrl: string | null;
  /** Portrait on our origin (3b), from the licensed-photos manifest. */
  photoUrl: string | null;
  /**
   * The campaign/personal site (3e) — always rendered labeled as such,
   * never as the primary link. From the curated, verified overlay.
   */
  campaignUrl: string | null;
  /**
   * Official accounts (item 7, 2026-08-16). Sitting federal members only —
   * that is the source's scope, and a scope is not widened by wanting it to
   * be. Other tiers carry none until an equivalent source exists, and their
   * cards render the pills they do have rather than an emptier row dressed
   * up as a complete one.
   */
  social?: SocialAccounts;
  /**
   * The state and chamber the member's OWN current term states (item 7).
   * Federal only — a curated local roster publishes neither, and the
   * identity header renders the tier instead rather than guessing one out of
   * a seat label.
   */
  state?: string;
  chamber?: string;
}

export type OfficeholderIndex = Map<string, SeatHolder[]>;

/** Person lookup is independent of whether their district geometry is held. */
export function indexByOfficeholderId(sets: readonly OfficeholderSet[], photos?: PhotoIndex): Map<string, SeatHolder> {
  const out = new Map<string, SeatHolder>();
  for (const set of sets) for (const person of set.officeholders) {
    if (!out.has(person.id)) out.set(person.id, toSeatHolder(person, photos));
  }
  return out;
}

/** officeholderId → path on our origin, from official-photos.json. */
export type PhotoIndex = Map<string, string>;

function toSeatHolder(person: Officeholder, photos?: PhotoIndex): SeatHolder {
  return {
    id: person.id,
    name: person.name,
    officeTitle: person.officeTitle,
    partyLabel: person.partyLabel,
    termEnd: person.termEnd || null,
    birthDate: person.birthDate ?? null,
    websiteUrl: person.websiteUrl,
    sourceUrl: person.provenance.sourceUrl,
    provenance: person.provenance,
    email: person.email,
    phone: person.phone,
    contactFormUrl: person.contactFormUrl,
    photoUrl: photos?.get(person.id) ?? null,
    campaignUrl: campaignSiteFor(person.id)?.url ?? null,
    social: person.social,
    state: person.state,
    chamber: person.chamber,
  };
}

/**
 * Index a roster by the division each person represents.
 *
 * Many-to-many in both directions: a division can elect several people, and a
 * person can represent several divisions. The value is an array for the first
 * reason and the join table exists for the second.
 */
export function indexByDivision(
  sets: OfficeholderSet[],
  photos?: PhotoIndex,
): OfficeholderIndex {
  const index: OfficeholderIndex = new Map();

  for (const set of sets) {
    const byId = new Map(set.officeholders.map((o) => [o.id, o]));

    for (const link of set.divisions) {
      const person = byId.get(link.officeholderId);
      // A link with no matching person is a broken artifact, not something to
      // paper over. Skipping it is right; rendering an empty name is not.
      if (!person) continue;

      const existing = index.get(link.ocdId);
      if (existing) existing.push(toSeatHolder(person, photos));
      else index.set(link.ocdId, [toSeatHolder(person, photos)]);
    }
  }

  // Stable order so the same point renders the same way twice. Alphabetical by
  // name, deliberately: any order derived from the data would be an ordering
  // the reader could read meaning into, and CLAUDE.md forbids ordering by fit.
  for (const holders of index.values()) {
    holders.sort((a, b) => a.name.localeCompare(b.name));
  }

  return index;
}

/**
 * The state division identifier implied by any division identifier.
 *
 * Senators represent a whole state, and the registry holds no state-level
 * division rows — it is generated from boundary layers and there is no state
 * layer. It does not need one: OCD-IDs are hierarchical, so the state is a
 * prefix of every division inside it. This reads that prefix.
 *
 * That is the identifier hierarchy doing its job, not a name-string join, which
 * is the thing CLAUDE.md actually forbids.
 *
 * DC and the territories are roots too (`district:dc`, `territory:pr`, as
 * `lib/ocd/fips.ts` mints them; 2026-09-25). None has senators or a statewide
 * executive on file, so their root answers with nobody rather than with a
 * state's officials, and a division inside one still names where it sits.
 */
export function stateOcdIdFrom(ocdId: string): string | null {
  const match = /^(ocd-division\/country:us\/(state|district|territory):([a-z]{2}))(\/|$)/.exec(ocdId);
  return match && isJurisdictionSegment(match[2], match[3]) ? match[1] : null;
}

/** Everyone holding a seat for this division. Empty is a real answer. */
export function holdersFor(
  index: OfficeholderIndex,
  ocdId: string,
): SeatHolder[] {
  return index.get(ocdId) ?? [];
}

/**
 * The senators for whichever state these divisions sit in.
 *
 * Takes the set of divisions covering a point rather than a state code, because
 * the caller has identifiers and not postal abbreviations, and because a point
 * near a state line resolves to divisions in one state only — the geometry
 * already answered that question.
 */
export function senatorsFor(
  index: OfficeholderIndex,
  ocdIds: string[],
): SeatHolder[] {
  const states = new Set<string>();
  for (const ocdId of ocdIds) {
    const state = stateOcdIdFrom(ocdId);
    if (state) states.add(state);
  }

  const seen = new Set<string>();
  const holders: SeatHolder[] = [];
  for (const state of states) {
    for (const holder of holdersFor(index, state)) {
      if (seen.has(holder.id)) continue;
      seen.add(holder.id);
      holders.push(holder);
    }
  }

  return holders.sort((a, b) => a.name.localeCompare(b.name));
}
