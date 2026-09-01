/**
 * **THE CANONICAL CANDIDATE UNIVERSE, keyed to the STATE and not to a ZIP.**
 * (Session C3, lane C, 2026-09-01. RULING 229.)
 *
 * ## The defect, in one identifier
 *
 * Every candidate this project holds is keyed `ballot-az-pima:governor:hobbs-katie`.
 * Katie Hobbs is running for Governor of **Arizona**. She is not the Pima
 * ballot's candidate; she is on the Pima ballot, and on the ballot of every
 * other Arizona ZIP. An identity that names the pilot county has one predictable
 * consequence: **activating a second Arizona ZIP looks like a new candidate**,
 * because the corpus is keyed by where we happened to look first.
 *
 * That is what turned candidate enrichment into per-ZIP work. Campaign sites,
 * candidate-authored positions, bios, photos and published contact were hunted
 * for the VISIBLE candidate universe — 68 acquisition attempts — and a reader
 * arriving from a ZIP outside 85641/85701 would trigger the hunt again for
 * people whose records the state authority already published.
 *
 * ## What a canonical identity is here, and what it is NOT
 *
 * ```
 *   az:2026:state-az:governor:hobbs-katie          canonical — office and
 *                                                  jurisdiction, no ZIP, no
 *                                                  county, no pilot
 *   ballot-az-pima:governor:hobbs-katie            a PROJECTION of it onto one
 *                                                  county's certified ballot
 * ```
 *
 * The canonical row keeps every pilot id it was seen under (`pilotIds`), so the
 * projection is a JOIN rather than a rename. Nothing downstream loses the
 * ability to answer "what does 85641's ballot say" — it gains the ability to
 * answer "what does Arizona's candidate universe say", which is the question
 * the acquisition denominator is about.
 *
 * ## THE DERIVATION RE-DERIVES; IT DOES NOT HARDCODE
 *
 * `deriveCandidateUniverse` is given ballot documents and enrichment stores as
 * VALUES. `scripts/candidate-universe.mts` finds them by globbing
 * `data/ballot/<state>-*.json` for any document carrying a `candidacies` array,
 * so a statewide identity registry that lands under a new filename is picked up
 * without an edit here. That is deliberate: this lane's denominator is the
 * largest one derivable from committed sources TODAY, and it must grow the
 * moment a larger committed source exists rather than when somebody remembers
 * to change a constant.
 *
 * ## Absence is never asserted
 *
 * A candidate whose campaign site was searched for and not found is
 * `SEARCHED_NO_RESULT` and carries the date. A candidate nobody has looked for
 * is `UNWORKED`. Those are different facts, they are owed to a reader as
 * different sentences, and a corpus that stored them the same way would let the
 * second impersonate the first.
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

/**
 * What this project knows about ONE field for ONE candidate.
 *
 * `SEARCHED_NO_RESULT` and `UNWORKED` are kept apart on purpose. Collapsing them
 * is how a hunt nobody ran comes to read as a hunt that found nothing, which is
 * an absence asserted about a person.
 */
export type EnrichmentState = "FOUND" | "SEARCHED_NO_RESULT" | "UNWORKED";

export interface EnrichmentReading {
  readonly state: EnrichmentState;
  /** When the state was last established. Null only when UNWORKED. */
  readonly checkedAt: string | null;
  /** Where it came from, when FOUND. */
  readonly sourceUrl: string | null;
}

export interface CanonicalCandidacy {
  /** `az:2026:state-az:governor:hobbs-katie`. No ZIP, no county, no pilot. */
  readonly id: string;
  readonly stateCode: string;
  readonly cycle: number;
  readonly canonicalContestId: string;
  readonly officeTitle: string;
  readonly ocdId: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly partyLabel: string | null;
  /** Every pilot-ballot id this person was seen under. The join, kept. */
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
 * The OCD division, shortened to something readable, WITHOUT losing the
 * distinction between two districts of the same office.
 *
 * `ocd-division/country:us/state:az/sldl:19` becomes `state-az-sldl-19`. Two
 * State Representative contests in different districts therefore get different
 * canonical contest ids, which is the whole reason the division is in the key
 * rather than only the title.
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
    readonly provenance?: { readonly sourceUrl?: string; readonly sourceOrg?: string };
  }[];
  readonly candidacies: readonly {
    readonly id: string;
    readonly contestId: string;
    readonly familyName: string;
    readonly givenName: string;
    readonly partyLabel?: string | null;
    readonly websiteUrl?: string | null;
    readonly provenance?: { readonly sourceUrl?: string; readonly sourceOrg?: string };
  }[];
}

/** The three committed enrichment stores, as values. Keyed by PILOT id. */
export interface EnrichmentStores {
  /** `data/ballot/candidate-hunt-state.json` — `candidates[pilotId][field]`. */
  readonly huntState: Record<string, Record<string, { state?: string; checkedAt?: string }>>;
  /** `data/ballot/candidate-cards-2026.json` — `cards[pilotId]`. */
  readonly cards: Record<string, Record<string, unknown>>;
  /** `data/ballot/candidate-links-2026.json` — `links["<contestId>|<Name>"]`. */
  readonly links: Record<string, unknown>;
  /** `links.hunts[]` — a MISS carries the date it was searched. */
  readonly linkHunts: readonly { key?: string; note?: string; attemptedAt?: string }[];
}

const EMPTY: EnrichmentReading = { state: "UNWORKED", checkedAt: null, sourceUrl: null };

/**
 * One field's reading for one person, from whichever store answers it.
 *
 * The stores were written by different sessions for different purposes and they
 * do not agree on vocabulary. `candidate-hunt-state.json` is the one that
 * carries an explicit per-field state, so it wins where it speaks; the cards and
 * the links fill in a FOUND that predates it. **Nothing here upgrades an absence
 * into a finding**: a field no store mentions is UNWORKED, which is a statement
 * about us.
 */
function readField(
  field: EnrichmentField,
  pilotIdsIn: readonly string[],
  linkKeys: readonly string[],
  stores: EnrichmentStores,
): EnrichmentReading {
  /*
   * **THE STORES USE TWO KEY FORMS FOR ONE PERSON, AND BOTH ARE TRIED.**
   *
   * `data/ballot/candidate-cards-2026.json` carries 39 Arizona keys of which
   * only 19 are ballot candidacy ids; the rest are `<contestId>|Display Name`,
   * the form the LINK store uses. A lookup that tried one form found 19 of 39
   * cards and reported the other 20 people as having no bio, no photo and no
   * contact — an absence manufactured by a key convention. Both forms are tried,
   * and a person found under either is found.
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
      /* "MISS — searched 2026-08-13; no campaign site found". A searched miss is
         a DATED fact about a search; it is never a fact about the candidate. */
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
  /* LOCAL, deliberately. A module-scoped cache here would be shared state
     between two derivations of two states, which is the kind of thing that
     works until the day something runs both. */
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
      "GENERATED ARTIFACT — never hand-edited (RULING 92). Regenerate with `pnpm candidates:universe`.",
      "",
      "RULING 229: this is the ACQUISITION DENOMINATOR for candidate enrichment in this state. It is",
      "keyed to the STATE and the OFFICE, never to a ZIP, a county or a pilot ballot. `pilotIds` keeps",
      "the join to the certified ballots this identity was seen on, so a reader projection is a JOIN and",
      "never a rename.",
      "",
      "IT IS THE LARGEST DENOMINATOR DERIVABLE FROM COMMITTED SOURCES TODAY, and it is not the state's",
      "candidate universe. `derivedFrom` names every document it was built from. A candidate absent from",
      "all of them is absent from THIS FILE — never absent from the ballot.",
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
