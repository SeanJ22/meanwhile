/**
 * **ONE STATE'S REGISTRATION, AS A PROMOTION CANDIDATE.** (2026-09-23.)
 *
 * Pure. From the committed reference, the pinned Census source receipt and
 * the promoted reviewed registry, it builds the state's REGISTRATION
 * candidate: every Census division in the state and a body for each
 * government the Census ties to a division — the ids the rest of the product
 * already joins on (`<ocdId>#governing`, `<ocdId>#board`).
 *
 * ```
 *   reviewed wins       a division or body id the reviewed registry holds is
 *                       never written here (one writer per id); a government
 *                       whose body the reviewed registry keys on its other
 *                       division (a place that is also a county subdivision)
 *                       gets no second body
 *   no stamps           records carry the reference's build date, never the
 *                       run's clock, so an unchanged month promotes UNCHANGED
 *   bounded             over REGISTRATION_MAX_CANDIDATE_BYTES escaped, or a
 *                       state with no government, is a named violation
 *   one id, one body    a second government on a body id already minted is
 *                       counted, never a second body
 * ```
 *
 * It writes nothing; the promotion engine is the only door.
 */
import { sha256 } from "../civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../civic-data/types.ts";
import type { RegistrationSourceReceipt } from "./acquire.ts";
import {
  REGISTRATION_MAX_CANDIDATE_BYTES,
  REGISTRATION_PARSER_VERSION,
  REGISTRATION_RECORD_CLASS,
  REGISTRATION_SCHEMA_VERSION,
  REGISTRATION_SOURCE_ID,
  REGISTRATION_SOURCE_THROUGH,
  type RegistrationTarget,
} from "./publication.ts";
import type { LoadedReference, ReferenceLayer } from "./reference.ts";
import type { Body, Division, DivisionType } from "../registry/types.ts";

/**
 * A registered division, in the registry's own shape (`lib/registry/types.ts`), so the reader
 * composes it beside the reviewed registry without translation. Its geography is the 2023 Census
 * cartographic boundary layer it came from; no canonical OCD match was attempted.
 */
export type RegistrationDivision = Division & {
  readonly geoid: string;
  readonly sourceDataset: "TIGER_CB2023";
  readonly canonicalOcdId: null;
  readonly canonicalMatch: "none";
  readonly canonicalGap: "UNDETERMINED";
};

/**
 * A registered body, in the registry's own shape: a government the Census lists (or a school district
 * no listed government claimed), on its Census division, with nothing sourced beyond that. Its name is
 * null until sourced, as the registry requires.
 */
export type RegistrationBody = Body & {
  readonly ocdId: string;
  readonly name: null;
  readonly bodyClass: "GOVERNING";
  readonly bodyOrigin: "REGISTERED_FROM_CENSUS_OF_GOVERNMENTS" | "DERIVED_FROM_DIVISION_TYPE";
  readonly coverageStatus: "NOT_ATTEMPTED";
  readonly agendaSourceType: "NONE";
  readonly sourceDataset: "COG_2022" | "TIGER_CB2023";
  /** The operational jurisdiction id, when the Census lists this government. */
  readonly jurisdictionId: string | null;
};

export interface RegistrationReadModel {
  readonly formatVersion: 1;
  readonly state: string;
  readonly scope: string;
  readonly vintage: {
    readonly governments: "2022 Census of Governments";
    readonly geography: "2023 Census cartographic boundary files";
    readonly sourceSha256: string;
    readonly referenceSha256: string;
  };
  /** The reviewed registry version this state was derived against; its ids are never written here. */
  readonly reviewedRegistryVersionId: string;
  readonly divisions: readonly RegistrationDivision[];
  readonly bodies: readonly RegistrationBody[];
  readonly counts: {
    readonly governments: number;
    readonly pairedGovernments: number;
    readonly unpairedByReason: Readonly<Record<string, number>>;
    readonly heldByReviewedRegistry: { readonly divisions: number; readonly bodies: number };
    /** Governments whose body id another government already took (the committed geometry's one shared id: New Jersey's Union Township districts). The first keeps the body. */
    readonly sharedBodyClaims: number;
  };
}

export interface ReviewedRegistryIds {
  readonly versionId: string;
  readonly divisionIds: ReadonlySet<string>;
  readonly bodyIds: ReadonlySet<string>;
  /** Divisions the reviewed registry holds a body on. */
  readonly bodyDivisionIds: ReadonlySet<string>;
}

/** The registry holds no state division (its states are the scope), so the state layer registers none. */
const DIVISION_TYPE: Readonly<Record<Exclude<ReferenceLayer, "state">, DivisionType>> = {
  county: "county",
  place: "place",
  cousub: "place",
  unsd: "school_district",
  elsd: "school_district",
  scsd: "school_district",
};
const SCHOOL_LAYERS = new Set<ReferenceLayer>(["unsd", "elsd", "scsd"]);
const SCHOOL_TYPES = new Set(["SCHOOL DISTRICT", "DEPENDENT SCHOOL SYSTEM"]);

/** The 2023 cartographic boundary file a layer's divisions were read from (`scripts/fetch-tiger-national.mts`). */
function boundaryUrl(layer: Exclude<ReferenceLayer, "state">): string {
  return `https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_${layer}_500k.zip`;
}

function parentOf(ocdId: string, stateOcdId: string): string | null {
  if (ocdId === stateOcdId) return null;
  const nested = /^(.*\/county:[^/]+)\/place:[^/]+$/.exec(ocdId);
  return nested ? nested[1] : stateOcdId;
}

/** The escaped JSON size a Neon response carries for this value: its text plus one escape per quote or backslash. */
export function escapedJsonBytes(value: unknown): number {
  const text = JSON.stringify(value);
  let escapes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 34 || c === 92) escapes++;
  }
  return Buffer.byteLength(text, "utf8") + escapes;
}

export function registrationCandidate(input: {
  readonly target: RegistrationTarget;
  readonly reference: LoadedReference;
  readonly receipt: RegistrationSourceReceipt;
  readonly reviewed: ReviewedRegistryIds;
}): RoutineCandidate {
  const { target, reference: loaded, receipt, reviewed } = input;
  const ref = loaded.reference;
  const provenance = { sourceUrl: receipt.requestedUrl, sourceOrg: "U.S. Census Bureau" as const, collectedAt: loaded.generatedAt, verifiedAt: null };
  const stateOcdId = ref.divisions[0]?.[0] ?? "";

  const allDivisions: RegistrationDivision[] = ref.divisions.flatMap(([ocdId, layer, geoid, censusName]): RegistrationDivision[] =>
    layer === "state"
      ? []
      : [{
          ocdId,
          divisionType: DIVISION_TYPE[layer],
          tier: "local",
          state: target.state,
          label: censusName,
          parentOcdId: parentOf(ocdId, stateOcdId),
          lsad: null,
          funcstat: null,
          classfp: null,
          geoid,
          canonicalOcdId: null,
          canonicalMatch: "none",
          canonicalGap: "UNDETERMINED",
          sourceDataset: "TIGER_CB2023",
          provenance: { sourceUrl: boundaryUrl(layer), sourceOrg: "U.S. Census Bureau", collectedAt: loaded.generatedAt, verifiedAt: null },
        }],
  );

  // Bodies: a paired government's, then every Census school district no government claimed.
  const candidates: RegistrationBody[] = [];
  const minted = new Set<string>();
  let duplicates = 0;
  const mint = (ocdId: string, slot: "governing" | "board", origin: RegistrationBody["bodyOrigin"], gov: readonly [string, string, string] | null, source: RegistrationBody["provenance"]) => {
    const id = `${ocdId}#${slot}`;
    if (minted.has(id)) {
      duplicates++;
      return;
    }
    minted.add(id);
    candidates.push({
      id,
      ocdId,
      name: null,
      bodyClass: "GOVERNING",
      bodyOrigin: origin,
      coverageStatus: "NOT_ATTEMPTED",
      agendaSourceType: "NONE",
      agendaSourceRef: null,
      meetingCadence: null,
      homepageUrl: null,
      demandCount: 0,
      sourceDataset: gov ? "COG_2022" : "TIGER_CB2023",
      ...(gov ? { censusId: gov[0], censusUnitType: gov[2] } : {}),
      jurisdictionId: gov ? gov[1] : null,
      provenance: source,
    });
  };
  const unpairedByReason: Record<string, number> = {};
  const claimedSchools = new Set<number>();
  let governments = 0;
  let paired = 0;
  for (const [pid6, jurisdictionId, , govType, division, how, alternate] of ref.governments) {
    if (govType === "STATE") continue;
    governments++;
    if (division < 0) {
      unpairedByReason[how] = (unpairedByReason[how] ?? 0) + 1;
      continue;
    }
    paired++;
    const primary = ref.divisions[division][0];
    const other = alternate >= 0 ? ref.divisions[alternate][0] : null;
    // The reviewed registry already registers this government, on either of its divisions.
    if (reviewed.bodyDivisionIds.has(primary) || (other !== null && reviewed.bodyDivisionIds.has(other))) continue;
    if (SCHOOL_TYPES.has(govType)) claimedSchools.add(division);
    mint(primary, SCHOOL_TYPES.has(govType) ? "board" : "governing", "REGISTERED_FROM_CENSUS_OF_GOVERNMENTS", [pid6, jurisdictionId, govType], provenance);
  }
  ref.divisions.forEach(([ocdId, layer, , censusName], i) => {
    if (!SCHOOL_LAYERS.has(layer) || claimedSchools.has(i) || /not defined/i.test(censusName)) return;
    if (reviewed.bodyDivisionIds.has(ocdId)) return;
    mint(ocdId, "board", "DERIVED_FROM_DIVISION_TYPE", null, { sourceUrl: boundaryUrl(layer as Exclude<ReferenceLayer, "state">), sourceOrg: "U.S. Census Bureau", collectedAt: loaded.generatedAt, verifiedAt: null });
  });

  // Reviewed wins: never write an id the reviewed registry holds.
  const divisions = allDivisions.filter((d) => !reviewed.divisionIds.has(d.ocdId));
  const bodies = candidates.filter((b) => !reviewed.bodyIds.has(b.id)).sort((a, b) => a.id.localeCompare(b.id));
  const readModel: RegistrationReadModel = {
    formatVersion: 1,
    state: target.state.toLowerCase(),
    scope: target.scope,
    vintage: { governments: "2022 Census of Governments", geography: "2023 Census cartographic boundary files", sourceSha256: receipt.sha256, referenceSha256: loaded.sha256 },
    reviewedRegistryVersionId: reviewed.versionId,
    divisions,
    bodies,
    counts: {
      governments,
      pairedGovernments: paired,
      unpairedByReason,
      heldByReviewedRegistry: { divisions: allDivisions.length - divisions.length, bodies: candidates.length - bodies.length },
      sharedBodyClaims: duplicates,
    },
  };

  const violations: string[] = [];
  if (governments === 0) violations.push(`The reference lists no government in ${target.state}: a failed extraction, never a state with no government (RULING 269).`);

  const readModelHash = sha256(canonicalCivicDataJson(readModel));
  const rawHash = sha256(`${receipt.sha256}\n${loaded.sha256}\n${reviewed.versionId}`);
  const records = divisions.length + bodies.length;
  const considered = allDivisions.length + candidates.length;
  const normalizedPayload = {
    formatVersion: 1,
    state: readModel.state,
    readModelHash,
    sourceSha256: receipt.sha256,
    referenceSha256: loaded.sha256,
    reviewedRegistryVersionId: reviewed.versionId,
    divisions: divisions.length,
    bodies: bodies.length,
  };
  const id = `cv-${sha256(`${REGISTRATION_SOURCE_ID}${target.scope}${rawHash}${receipt.retrievedAt}`).slice(0, 32)}`;
  const geoidOf = new Map(allDivisions.map((d) => [d.ocdId, d.geoid]));
  const candidate: RoutineCandidate = {
    id,
    sourceId: REGISTRATION_SOURCE_ID,
    recordClass: REGISTRATION_RECORD_CLASS,
    scope: target.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(REGISTRATION_SOURCE_ID, REGISTRATION_RECORD_CLASS, target.scope),
    retrieval: {
      succeeded: true,
      requestedUrl: receipt.requestedUrl,
      finalUrl: receipt.finalUrl,
      httpStatus: receipt.httpStatus,
      retrievedAt: receipt.retrievedAt,
      rawHash,
    },
    normalization: {
      succeeded: true,
      parserVersion: REGISTRATION_PARSER_VERSION,
      schemaVersion: REGISTRATION_SCHEMA_VERSION,
      normalizedHash: readModelHash,
      normalizedPayloadHash: sha256(canonicalCivicDataJson(normalizedPayload)),
      inputRecords: considered,
      outputRecords: records,
      droppedRecords: considered - records,
      missingRequiredFields: [],
    },
    identities: bodies.map((b) => ({
      subjectId: b.id,
      jurisdiction: target.jurisdiction,
      identifiers: { ocd_id: b.ocdId, geoid: geoidOf.get(b.ocdId) ?? "", ...(b.censusId ? { census_id: b.censusId } : {}) },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
    })),
    temporal: { version: "cog-2022+cb-2023", expectedVersion: "cog-2022+cb-2023", sourceThrough: REGISTRATION_SOURCE_THROUGH, staleAtRetrieval: false },
    semantics: {
      factKind: "The governments the 2022 Census of Governments lists in one state, each on the Census division that is its territory, and every Census division in the state",
      violations,
    },
    horizon: {
      kind: "BOUNDED",
      query: `every government the 2022 Census of Governments lists in ${target.state}, and every 2023 Census division in it`,
      returnedRecords: records,
      declaredTotal: records,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "lib/registration/reader.ts",
        passed: governments > 0 && bodies.every((b) => geoidOf.has(b.ocdId)),
        detail: `${bodies.length} bodies and ${divisions.length} divisions for ${target.state}; every body sits on a Census division of the state.`,
      },
    ],
    normalizedPayload,
    readModel,
  };
  // The bound is measured on what the store will hold: this candidate as built, plus one more copy of its records for the engine's change set.
  const bytes = escapedJsonBytes(candidate) + escapedJsonBytes({ divisions, bodies });
  if (bytes > REGISTRATION_MAX_CANDIDATE_BYTES) {
    violations.push(`The ${target.state} registration would carry ${bytes} escaped bytes with its change set, over the ${REGISTRATION_MAX_CANDIDATE_BYTES}-byte bound (half the 64 MiB response cap).`);
  }
  return candidate;
}
