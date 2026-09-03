/**
 * **WHAT A CANDIDATE POPULATION MAY BE CALLED.**
 * (Session C final, lane 1, 2026-09-01. R-C9.)
 *
 * ## The rule this file is
 *
 * > An obligation, registry, corpus, or report line may be labelled "statewide"
 * > or "source-universe" only when its subject population was acquired from the
 * > authoritative source's complete applicable universe. A pilot-derived
 * > population with a statewide-shaped key is pilot-derived and is labelled so.
 * > **"No ZIP in the key" is a property of the key, not of the population.**
 *
 * ## What went wrong, in numbers rather than in principle
 *
 * Every Arizona, New Hampshire and New Jersey candidate artifact in this
 * repository was derived from ONE COUNTY'S BALLOT — Pima's 55 candidacies,
 * Merrimack's 47, Morris's 276 — and every one of them was labelled STATEWIDE,
 * including the string a report quotes as the acquisition denominator's
 * AUTHORITY: `"NH statewide candidate universe, cycle 2026"` over 47 people who
 * were on one county's ballot.
 *
 * Nothing lied on purpose. The keys had genuinely been de-ZIPped, and the
 * de-ZIPping was real work that mattered. What happened is that the property of
 * the KEY got read as a property of the POPULATION, and after that every
 * downstream count inherited a word nobody re-checked.
 *
 * ## Why the register is a list and why unknown means PILOT_DERIVED
 *
 * The honest label cannot be computed from a filename. It depends on whether
 * somebody actually went and got the authority's complete applicable universe,
 * which is a fact about an acquisition, not about a path. So it is DECLARED,
 * once, beside the acquisition that earned it — and **anything not declared is
 * PILOT_DERIVED**, because the failure this file exists to prevent is a
 * population quietly inheriting a word it did not earn.
 *
 * Adding a row here costs a diff and a citation. That is the point.
 */

/** Where a candidate population came from, and therefore what it may be called. */
export type PopulationProvenance =
  /**
   * Acquired from the authority's COMPLETE APPLICABLE UNIVERSE for the offices
   * that authority is the filing officer for. May be called source-universe.
   */
  | "SOURCE_UNIVERSE_ACQUIRED"
  /**
   * Acquired from an authority whose universe is one PART of the state's — a
   * county clerk, or a state office that files only some offices. Real, cited,
   * and NOT the state's universe.
   */
  | "PARTIAL_AUTHORITY_ACQUIRED"
  /**
   * Derived from a pilot ballot. The population is whoever happened to be on
   * the ballot this project looked at first.
   */
  | "PILOT_DERIVED";

export interface AcquiredCorpus {
  /** The `derivedFrom` path, exactly as the universe artifact records it. */
  readonly path: string;
  readonly authority: string;
  /** What the authority's complete applicable universe covers. */
  readonly covers: string;
  readonly provenance: Exclude<PopulationProvenance, "PILOT_DERIVED">;
  /** Where the acquisition is recorded, so the claim is checkable. */
  readonly citation: string;
}

/**
 * Every committed document acquired from an election authority as a CORPUS.
 *
 * A path absent from this list contributes a PILOT_DERIVED population. That is
 * deliberate and it is the safe direction to be wrong in.
 */
export const ACQUIRED_CORPORA: readonly AcquiredCorpus[] = [
  {
    path: "data/states/az/candidates/az-2026-sos-candidate-filings.json",
    authority: "Arizona Secretary of State",
    covers:
      "every candidate listed as qualified for the July 21, 2026 primary ballot, for every office the " +
      "Secretary is the filing officer for: federal congressional, statewide executive, and " +
      "legislative. NOT county-and-below, which is each county officer in charge of elections; NOT " +
      "independent and no-party candidates, write-in nominees, or nonpartisan and judicial offices.",
    provenance: "SOURCE_UNIVERSE_ACQUIRED",
    citation:
      "pnpm acquire:az-sos-candidates · HTTP 200, 183,097 B, sha256 " +
      "a13d2a82f83b52206d3697a840382403b1c3d5cb6c80481e383b42d360669016, read 2026-09-01; extracted " +
      "twice by independent mechanisms, both returning 266 rows across 76 contests",
  },
];

const BY_PATH = new Map(ACQUIRED_CORPORA.map((c) => [c.path, c]));

export interface PopulationLabel {
  readonly provenance: PopulationProvenance;
  /**
   * The one-line label a report or an `AcquisitionUniverse.authority` may use.
   * It never contains the word "statewide" unless the population earned it.
   */
  readonly authorityLine: string;
  /** Every acquired corpus that contributed, and every document that did not. */
  readonly acquiredFrom: readonly string[];
  readonly pilotDocuments: readonly string[];
}

/**
 * Label a population from the documents it was derived from.
 *
 * PURE — it takes the `derivedFrom` list as a value and touches no filesystem,
 * so `projectOntoZip` can call it without acquiring a dependency on disk.
 *
 * A population with even one pilot document in it is not the authority's
 * universe, and saying so is the whole job: a mixed population is exactly the
 * shape that reads as complete because part of it is.
 */
export function populationLabel(input: {
  readonly stateCode: string;
  readonly cycle: number;
  readonly derivedFrom: readonly { readonly path: string }[];
}): PopulationLabel {
  const acquiredFrom: string[] = [];
  const pilotDocuments: string[] = [];
  const corpora: AcquiredCorpus[] = [];
  for (const d of input.derivedFrom) {
    const corpus = BY_PATH.get(d.path);
    if (corpus) {
      acquiredFrom.push(d.path);
      corpora.push(corpus);
    } else {
      pilotDocuments.push(d.path);
    }
  }

  const state = input.stateCode.toUpperCase();
  if (corpora.length === 0) {
    return {
      provenance: "PILOT_DERIVED",
      authorityLine:
        `${state} PILOT-DERIVED candidate population, cycle ${input.cycle} — derived from ` +
        `${pilotDocuments.join(", ") || "no committed document"}. NOT the state's candidate universe: ` +
        "no election authority's complete applicable universe has been acquired for this state, and " +
        "the key having no ZIP in it is a property of the key rather than of the population.",
      acquiredFrom,
      pilotDocuments,
    };
  }

  const authorities = [...new Set(corpora.map((c) => c.authority))].join("; ");
  const anyPartial = corpora.some((c) => c.provenance === "PARTIAL_AUTHORITY_ACQUIRED");
  if (pilotDocuments.length > 0 || anyPartial) {
    return {
      provenance: "PARTIAL_AUTHORITY_ACQUIRED",
      authorityLine:
        `${state} candidate population, cycle ${input.cycle} — acquired from ${authorities}, PLUS ` +
        `${pilotDocuments.length} pilot ballot document(s) (${pilotDocuments.join(", ")}). PART of the ` +
        "state's candidate universe: the acquired corpora do not cover every office, and the balance " +
        "is whoever happened to be on a ballot this project already held.",
      acquiredFrom,
      pilotDocuments,
    };
  }

  return {
    provenance: "SOURCE_UNIVERSE_ACQUIRED",
    authorityLine:
      `${state} candidate source universe, cycle ${input.cycle} — acquired from ${authorities}. ` +
      `${corpora.map((c) => c.covers).join(" ")}`,
    acquiredFrom,
    pilotDocuments,
  };
}
