/**
 * The canonical candidate universe, keyed to the state and not to a ZIP or
 * county, so a second ZIP in the same state never looks like new candidates.
 *
 * ```
 *   az:2026:state-az:governor:<slug>          canonical: office and
 *                                             jurisdiction, no ZIP or county
 *   ballot-az-<county>:governor:<slug>        a projection onto one county's
 *                                             certified ballot
 * ```
 *
 * The canonical row keeps every ballot id it was seen under (`pilotIds`), so
 * the projection is a join, not a rename. `deriveCandidateUniverse` takes
 * ballot documents and enrichment stores as values.
 *
 * Absence is never asserted: `SEARCHED_NO_RESULT` carries its date, and a
 * field nobody looked for is `UNWORKED`.
 */

/** The enrichment fields a candidate card is made of. */
export type EnrichmentField = "campaignSite" | "positions" | "bio" | "photo" | "contact";

export const ENRICHMENT_FIELDS: readonly EnrichmentField[] = [
  "campaignSite",
  "positions",
  "bio",
  "photo",
  "contact",
];

/** What this project knows about one field for one candidate. `SEARCHED_NO_RESULT` and `UNWORKED` stay distinct. */
export type EnrichmentState = "FOUND" | "SEARCHED_NO_RESULT" | "UNWORKED";

export interface EnrichmentReading {
  readonly state: EnrichmentState;
  /** When the state was last established. Null only when UNWORKED. */
  readonly checkedAt: string | null;
  /** Where it came from, when FOUND. */
  readonly sourceUrl: string | null;
}

export interface CanonicalCandidacy {
  /** `az:2026:state-az:governor:<slug>`. No ZIP or county. */
  readonly id: string;
  readonly stateCode: string;
  readonly cycle: number;
  readonly canonicalContestId: string;
  readonly officeTitle: string;
  readonly ocdId: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly partyLabel: string | null;
  /** Every ballot id this person was seen under. The join, kept. */
  readonly pilotIds: readonly string[];
  /** Where the CANDIDACY itself came from. A citation, never a claim. */
  readonly provenance: readonly string[];
  readonly enrichment: Readonly<Record<EnrichmentField, EnrichmentReading>>;
}

export interface CandidateUniverse {
  readonly formatVersion: 1;
  readonly stateCode: string;
  readonly cycle: number;
  readonly generatedBy: string;
  readonly generatedOn: string;
  readonly _note: readonly string[];
  /** Every committed document the denominator was derived from, with its count. */
  readonly derivedFrom: readonly {
    readonly path: string;
    readonly candidaciesContributed: number;
  }[];
  /** The acquisition denominator, stated. */
  readonly candidacies: readonly CanonicalCandidacy[];
}

/* --------------------------------------------------------------- slugging */

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The OCD division, shortened but still distinct per district:
 * `ocd-division/country:us/state:az/sldl:19` becomes `state-az-sldl-19`.
 */
export function ocdSlug(ocdId: string): string {
  return slug(ocdId.replace(/^ocd-division\/country:us\//, ""));
}

export function canonicalContestId(
  stateCode: string,
  cycle: number,
  contest: { readonly ocdId: string; readonly title: string },
): string {
  return `${stateCode.toLowerCase()}:${cycle}:${ocdSlug(contest.ocdId)}:${slug(contest.title)}`;
}

export function canonicalCandidacyId(
  contestId: string,
  familyName: string,
  givenName: string,
): string {
  return `${contestId}:${slug(familyName)}-${slug(givenName)}`;
}

/* ------------------------------------------------------------ the inputs */

export interface BallotDocument {
  readonly path: string;
  readonly contests: readonly {
    readonly id: string;
    readonly ocdId: string;
    readonly title: string;
    readonly provenance?: { readonly sourceUrl?: string | null; readonly sourceOrg?: string | null };
  }[];
  readonly candidacies: readonly {
    readonly id: string;
    readonly contestId: string;
    readonly familyName: string;
    readonly givenName: string;
    readonly partyLabel?: string | null;
    readonly websiteUrl?: string | null;
    readonly provenance?: { readonly sourceUrl?: string | null; readonly sourceOrg?: string | null };
  }[];
}

/** The enrichment stores, as values, keyed by ballot id. */
export interface EnrichmentStores {
  /** `candidates[pilotId][field]`, with an explicit per-field state. */
  readonly huntState: Record<string, Record<string, { state?: string; checkedAt?: string }>>;
  /** `cards[pilotId]`. */
  readonly cards: Record<string, Record<string, unknown>>;
  /** `links["<contestId>|<Name>"]`. */
  readonly links: Record<string, unknown>;
  /** `links.hunts[]`: a MISS carries the date it was searched. */
  readonly linkHunts: readonly { key?: string; note?: string; attemptedAt?: string }[];
}

const EMPTY: EnrichmentReading = { state: "UNWORKED", checkedAt: null, sourceUrl: null };

/**
 * One field's reading for one person. The hunt state carries an explicit
 * per-field state and wins where it speaks; cards and links fill in a FOUND.
 * A field no store mentions is UNWORKED.
 */
function readField(
  field: EnrichmentField,
  pilotIdsIn: readonly string[],
  linkKeys: readonly string[],
  stores: EnrichmentStores,
): EnrichmentReading {
  /*
   * The stores key one person two ways (ballot candidacy id, and
   * `<contestId>|Display Name`); both are tried.
   */
  const pilotIds = [...pilotIdsIn, ...linkKeys];
  for (const pid of pilotIds) {
    const row = stores.huntState[pid];
    const cell = row?.[field === "positions" ? "blurb" : field];
    if (cell?.state === "FOUND") {
      return { state: "FOUND", checkedAt: cell.checkedAt ?? null, sourceUrl: null };
    }
  }

  if (field === "campaignSite") {
    for (const key of linkKeys) {
      const url = stores.links[key];
      if (typeof url === "string" && url.length > 0) {
        return { state: "FOUND", checkedAt: null, sourceUrl: url };
      }
      if (url && typeof url === "object") {
        return { state: "FOUND", checkedAt: null, sourceUrl: null };
      }
    }
    for (const hunt of stores.linkHunts) {
      if (!hunt.key || !linkKeys.includes(hunt.key)) continue;
      /* A searched miss is a dated fact about a search, never about the candidate. */
      if (/\bMISS\b/i.test(hunt.note ?? "")) {
        return { state: "SEARCHED_NO_RESULT", checkedAt: hunt.attemptedAt ?? null, sourceUrl: null };
      }
    }
  }

  if (field === "bio" || field === "photo" || field === "contact") {
    for (const pid of pilotIds) {
      const card = stores.cards[pid];
      if (!card) continue;
      const value =
        field === "bio" ? card.bio : field === "photo" ? card.photoUrl : (card.email ?? card.phone);
      if (typeof value === "string" && value.length > 0) {
        const src = field === "bio" ? card.bioSourceUrl : null;
        return { state: "FOUND", checkedAt: null, sourceUrl: typeof src === "string" ? src : null };
      }
    }
  }

  for (const pid of pilotIds) {
    const cell = stores.huntState[pid]?.[field === "positions" ? "blurb" : field];
    if (cell?.state && cell.state !== "FOUND") {
      /* An explicit non-FOUND state that carries a date is a searched miss; one
         without a date has not actually been looked for. */
      return cell.checkedAt
        ? { state: "SEARCHED_NO_RESULT", checkedAt: cell.checkedAt, sourceUrl: null }
        : EMPTY;
    }
  }
  return EMPTY;
}

/* ------------------------------------------------------------ the derivation */

export function deriveCandidateUniverse(input: {
  readonly stateCode: string;
  readonly cycle: number;
  readonly generatedBy: string;
  readonly generatedOn: string;
  readonly documents: readonly BallotDocument[];
  readonly stores: EnrichmentStores;
}): CandidateUniverse {
  const byId = new Map<string, CanonicalCandidacy>();
  const contributed = new Map<string, number>();
  /* Local, not module-scoped: two derivations must not share state. */
  const linkKeysById = new Map<string, string[]>();

  for (const doc of input.documents) {
    const contestById = new Map(doc.contests.map((c) => [c.id, c]));
    let n = 0;
    for (const cand of doc.candidacies) {
      const contest = contestById.get(cand.contestId);
      if (!contest) continue;
      const contestId = canonicalContestId(input.stateCode, input.cycle, contest);
      const id = canonicalCandidacyId(contestId, cand.familyName, cand.givenName);
      const linkKey = `${cand.contestId}|${cand.givenName} ${cand.familyName}`;

      const existing = byId.get(id);
      if (existing) {
        byId.set(id, {
          ...existing,
          pilotIds: [...new Set([...existing.pilotIds, cand.id])],
          provenance: [...new Set([...existing.provenance, provenanceOf(doc, cand, contest)])],
        });
        continue;
      }
      n += 1;
      byId.set(id, {
        id,
        stateCode: input.stateCode,
        cycle: input.cycle,
        canonicalContestId: contestId,
        officeTitle: contest.title,
        ocdId: contest.ocdId,
        givenName: cand.givenName,
        familyName: cand.familyName,
        partyLabel: cand.partyLabel ?? null,
        pilotIds: [cand.id],
        provenance: [provenanceOf(doc, cand, contest)],
        /* Filled below, once every pilot id for this person is collected. */
        enrichment: {
          campaignSite: EMPTY,
          positions: EMPTY,
          bio: EMPTY,
          photo: EMPTY,
          contact: EMPTY,
        },
      });
      /* The link store is keyed by pilot contest and display name; remember the
         key so the second pass can find it without re-deriving. */
      linkKeysById.set(id, [...(linkKeysById.get(id) ?? []), linkKey]);
    }
    contributed.set(doc.path, n);
  }

  const candidacies = [...byId.values()]
    .map((c) => ({
      ...c,
      enrichment: Object.fromEntries(
        ENRICHMENT_FIELDS.map((f) => [f, readField(f, c.pilotIds, linkKeysById.get(c.id) ?? [], input.stores)]),
      ) as Record<EnrichmentField, EnrichmentReading>,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    formatVersion: 1,
    stateCode: input.stateCode,
    cycle: input.cycle,
    generatedBy: input.generatedBy,
    generatedOn: input.generatedOn,
    _note: [
      "DERIVED VIEW — production derives this in memory from proof-validated canonical projections.",
      "",
      "RULING 229: this is the ACQUISITION DENOMINATOR for candidate enrichment in this state. It is",
      "keyed to the STATE and the OFFICE, never to a ZIP, a county or a pilot ballot. `pilotIds` keeps",
      "the join to the certified ballots this identity was seen on, so a reader projection is a JOIN and",
      "never a rename.",
      "",
      "IT IS THE LARGEST DENOMINATOR DERIVABLE FROM THE PROMOTED AUTHORITIES, and it is not the state's",
      "candidate universe. `derivedFrom` names every canonical projection represented. A candidate absent",
      "from all of them is absent from THIS VIEW — never absent from the ballot.",
      "",
      "FOUND / SEARCHED_NO_RESULT / UNWORKED are three different facts. A field nobody looked for is",
      "UNWORKED. A field searched and not found carries the date it was searched. Neither is ever a",
      "statement that the candidate has no such thing.",
    ],
    derivedFrom: [...contributed].map(([path, candidaciesContributed]) => ({ path, candidaciesContributed })),
    candidacies,
  };
}

function provenanceOf(
  doc: BallotDocument,
  cand: BallotDocument["candidacies"][number],
  contest: BallotDocument["contests"][number],
): string {
  const src = cand.provenance?.sourceUrl ?? contest.provenance?.sourceUrl ?? null;
  const org = cand.provenance?.sourceOrg ?? contest.provenance?.sourceOrg ?? null;
  return `${doc.path}${org ? ` — ${org}` : ""}${src ? ` — ${src}` : ""}`;
}

/* ------------------------------------------------------------- arithmetic */

export interface EnrichmentSplit {
  readonly total: number;
  readonly found: number;
  readonly searchedNoResult: number;
  readonly unworked: number;
}

export function enrichmentSplit(u: CandidateUniverse, field: EnrichmentField): EnrichmentSplit {
  let found = 0;
  let searched = 0;
  for (const c of u.candidacies) {
    const s = c.enrichment[field].state;
    if (s === "FOUND") found += 1;
    else if (s === "SEARCHED_NO_RESULT") searched += 1;
  }
  return {
    total: u.candidacies.length,
    found,
    searchedNoResult: searched,
    unworked: u.candidacies.length - found - searched,
  };
}
