/**
 * **THE PROVENANCE CONTRACT — what every locally held artifact must be able to
 * say about itself, independently of where it is stored.**
 * (2026-08-27, the coverage-truth session.)
 *
 * ## The defect this is written against
 *
 * This repository holds a great deal of retrieved material — boundary files,
 * meeting snapshots, census extracts, plat polygons, ballot corpora — and each
 * class records its own provenance in its own way, or does not record it at
 * all. The instance that forced this: **`public/geo/*.geojson` carries no
 * recorded retrieval date anywhere in the repository.**
 *
 * That absence had a visible consequence. `scripts/build-registry.ts` stamped
 * every derived row's `provenance.collectedAt` with the moment the DERIVER ran,
 * which asserted a retrieval that never happened — the polygons were fetched on
 * some earlier day nobody wrote down. Repairing it (carrying the prior stamp
 * forward) stopped the false claim and did not supply the missing fact, because
 * the missing fact does not exist anywhere to supply.
 *
 * A contract is what stops the next class arriving the same way.
 *
 * ## Storage-engine independent, on purpose
 *
 * Nothing here says JSON, or a table, or a directory layout. The artifact
 * classes this repository holds are a committed `.geojson`, a committed
 * `.json`, an append-only snapshot list and a generated `.ts` module, and a
 * contract that assumed any one of those shapes would exclude the others. What
 * it constrains is the QUESTIONS an artifact must be able to answer:
 *
 * ```
 * FETCH          where did this come from, and where did that redirect to
 * ATTRIBUTE      who published it, under what permission, for which place
 * HASH           what exactly did we receive
 * REUSE          can this be used again without re-fetching
 * DETECT CHANGE  has the publisher's copy moved since
 * RECONCILE      does what we hold still match what they publish
 * ```
 *
 * **DuckDB is deliberately absent, and this contract is designed to stand
 * without an analytical engine.** An engine is a way of querying artifacts that
 * already describe themselves; introducing one first would make the engine's
 * schema the contract, and then the contract would be unavailable to everything
 * that does not live in the engine.
 *
 * ## Conformance is REPORTED, never assumed
 *
 * `pnpm corpus:check` walks the artifact classes the product actually consumes
 * and reports each against this contract. Several do not conform today. That is
 * the point of measuring: an unconformant class is named, with the exact field
 * it cannot answer, rather than being quietly assumed fine.
 */

/** How an artifact came to be here. */
export type SourceClass =
  /** Fetched over the network from the publisher. */
  | "RETRIEVED"
  /** Derived by this repository from something else it holds. */
  | "DERIVED"
  /** Read by a human from a published document and typed in, with a citation. */
  | "CURATED";

/**
 * Everything an artifact must be able to answer about itself.
 *
 * Fields are nullable where a null is a REAL state rather than a missing value,
 * and each null carries its meaning in the comment. A contract whose fields are
 * all required forces a fabricated value into whichever one is unknown, which
 * is the failure it exists to prevent.
 */
export interface ArtifactProvenance {
  /** Where the artifact lives, repo-relative. */
  localPath: string;
  /** What it is, in one clause a person can read. */
  what: string;
  sourceClass: SourceClass;

  /**
   * The URL asked for. **Null only for `CURATED` and `DERIVED`**, where there
   * was no single request — and a derived artifact must then name its inputs.
   */
  sourceUrl: string | null;
  /**
   * Where that request ENDED. A redirect is a fact about the publisher and a
   * retrieval recorded only by its request URL cannot be re-walked honestly.
   * Null when it equals `sourceUrl`.
   */
  resolvedUrl: string | null;
  /** Who published it. The government, never the vendor hosting it. */
  sourceOrg: string | null;

  /**
   * **The day the bytes were actually retrieved from the publisher.**
   *
   * The field the boundary files cannot answer. It is NOT the day a deriver
   * ran, not the day a file was committed, and not today: each of those is a
   * different fact, and writing one of them here is the exact substitution this
   * contract exists to refuse.
   */
  retrievedAt: string | null;
  /** The content type the publisher served, verbatim. */
  contentType: string | null;
  /** SHA-256 of what was received. The basis of REUSE and DETECT CHANGE. */
  contentHash: string | null;

  /** Which place this is about, as an OCD id or a state code. Null when national. */
  jurisdiction: string | null;
  /** The publisher's own identity for the dataset or document, where it has one. */
  datasetId: string | null;

  /**
   * What makes this artifact go stale, in the publisher's terms.
   *
   * A meeting snapshot is stale in a day; a 2022 Census of Governments extract
   * is not stale until 2027. A single global freshness rule would either
   * re-fetch the census weekly or let the meetings rot, so the artifact carries
   * its own.
   */
  freshness: {
    /** How long the artifact is good for, in days. Null when it never staleness. */
    staleAfterDays: number | null;
    /** The command that refreshes it. A file nobody can refresh is a dead end. */
    refreshedBy: string;
  };

  /**
   * What the publisher permits, and how that was established.
   *
   * **Permission state and transport state are orthogonal** (RULING 182): a
   * failure to read `robots.txt` is `CANNOT_TELL`, never `ALLOWED` and never
   * `DISALLOWED`. A licence obligation recorded here is law, not a note.
   */
  permission: {
    state: "ALLOWED" | "DISALLOWED" | "CANNOT_TELL" | "NOT_APPLICABLE";
    /** How that was established — the robots read, the terms, the licence. */
    basis: string;
    /** An attribution the licence requires, shipped with the data it describes. */
    attribution: string | null;
  };

  /** For `DERIVED`: the artifacts it was built from. Empty otherwise. */
  derivedFrom: readonly string[];
}

export type Conformance = "CONFORMS" | "PARTIAL" | "ABSENT";

export interface ConformanceReport {
  localPath: string;
  what: string;
  level: Conformance;
  /** Exactly which contract questions this artifact cannot answer. */
  missing: string[];
  /** Why each missing field is missing, where that is known. */
  notes: string[];
}

/**
 * Which fields a class of artifact must answer.
 *
 * A `DERIVED` artifact has no `sourceUrl` and must name `derivedFrom`; a
 * `CURATED` one has a citation rather than a hash. Applying one requirement set
 * to all three would make two thirds of the repository permanently
 * non-conformant for reasons that are not defects.
 */
export function requiredFields(sourceClass: SourceClass): readonly (keyof ArtifactProvenance)[] {
  const common: (keyof ArtifactProvenance)[] = ["localPath", "what", "sourceClass", "freshness", "permission"];
  if (sourceClass === "RETRIEVED") {
    return [...common, "sourceUrl", "sourceOrg", "retrievedAt", "contentType", "contentHash"];
  }
  if (sourceClass === "DERIVED") return [...common, "derivedFrom"];
  return [...common, "sourceUrl", "sourceOrg", "retrievedAt"];
}

function answered(p: Partial<ArtifactProvenance>, field: keyof ArtifactProvenance): boolean {
  const v = p[field];
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (field === "freshness") {
    const f = v as ArtifactProvenance["freshness"];
    return typeof f.refreshedBy === "string" && f.refreshedBy.trim().length > 0;
  }
  if (field === "permission") {
    const q = v as ArtifactProvenance["permission"];
    return typeof q.state === "string" && typeof q.basis === "string" && q.basis.trim().length > 0;
  }
  return true;
}

/** Measure one artifact against the contract. Reports; never repairs. */
export function conformanceOf(
  p: Partial<ArtifactProvenance> & Pick<ArtifactProvenance, "localPath" | "what" | "sourceClass">,
  notes: string[] = [],
): ConformanceReport {
  const required = requiredFields(p.sourceClass);
  const missing = required.filter((f) => !answered(p, f)).map(String);

  /*
   * **`ABSENT` IS MEASURED AGAINST THE PROVENANCE FIELDS, NOT ALL OF THEM.**
   *
   * The first version compared `missing.length` to `required.length`, which
   * made `ABSENT` unreachable: `localPath`, `what` and `sourceClass` are the
   * identity of the row and are always present, so an artifact that answers
   * NOTHING about its provenance still scored PARTIAL. A level nothing can ever
   * reach is a level that never fires, and a conformance report whose worst
   * verdict is unreachable understates every artifact it grades.
   *
   * So the three identity fields are excluded from the denominator. An artifact
   * that answers no provenance question at all is ABSENT, which is what the
   * word means.
   */
  const IDENTITY = new Set(["localPath", "what", "sourceClass"]);
  const provenanceRequired = required.filter((f) => !IDENTITY.has(String(f)));
  const provenanceMissing = missing.filter((f) => !IDENTITY.has(f));

  return {
    localPath: p.localPath,
    what: p.what,
    level:
      missing.length === 0
        ? "CONFORMS"
        : provenanceMissing.length === provenanceRequired.length
          ? "ABSENT"
          : "PARTIAL",
    missing,
    notes,
  };
}

/**
 * Can this artifact be REUSED without re-fetching, and can a CHANGE be
 * detected in it?
 *
 * Both answers turn on the same field, which is why they are one function: a
 * hash is what lets a re-fetch append nothing when the publisher has not moved,
 * and it is what makes "their copy changed" a fact rather than an impression.
 * Without one, every refresh is a full re-read and no change is ever detectable.
 */
export function supportsChangeDetection(p: Partial<ArtifactProvenance>): boolean {
  return answered(p, "contentHash");
}

/** Whether an artifact is past the freshness its own publisher implies. */
export function isStale(p: Pick<ArtifactProvenance, "retrievedAt" | "freshness">, today: string): boolean | null {
  /* Null, not false. "We cannot tell whether this is stale" is a different
   * answer from "this is fresh", and only one of them is a reason to relax. */
  if (!p.retrievedAt || p.freshness.staleAfterDays === null) return null;
  const days = (Date.parse(today) - Date.parse(p.retrievedAt)) / 86_400_000;
  return Number.isFinite(days) ? days > p.freshness.staleAfterDays : null;
}
