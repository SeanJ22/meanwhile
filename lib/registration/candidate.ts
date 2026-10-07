/**
 * One state's Census-backed registration, independent of reviewed-registry editions.
 * Keep every sourced division and government body. Reader composition gives
 * reviewed records precedence and resolves the exact primary/alternate pairing.
 * An unpaired government gets no invented division; territory bodies require
 * governing functional status. Records carry the source reference's build date.
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
import { isCensusPlaceholderDivision } from "../registry/census-placeholders.ts";
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
 * no listed government claimed, or a territory division TIGER/Line records as governing), on its Census
 * division, with nothing sourced beyond that. Its name is null until sourced, as the registry requires.
 */
export type RegistrationBody = Body & {
  readonly ocdId: string;
  readonly name: null;
  readonly bodyClass: "GOVERNING";
  readonly bodyOrigin: "REGISTERED_FROM_CENSUS_OF_GOVERNMENTS" | "REGISTERED_FROM_TIGER_FUNCSTAT" | "DERIVED_FROM_DIVISION_TYPE";
  readonly coverageStatus: "NOT_ATTEMPTED";
  readonly agendaSourceType: "NONE";
  readonly sourceDataset: "COG_2022" | "TIGER_CB2023" | "TIGER_LINE2023";
  /** The operational jurisdiction id, when the Census lists this government. */
  readonly jurisdictionId: string | null;
};

export interface RegistrationReadModel {
  readonly formatVersion: 1;
  readonly state: string;
  readonly scope: string;
  readonly vintage: {
    readonly governments: "2022 Census of Governments" | "2023 TIGER/Line functional status";
    readonly geography: "2023 Census cartographic boundary files";
    readonly sourceSha256: string;
    readonly referenceSha256: string;
  };
  /** Historical compatibility: new registrations have no reviewed-registry dependency. */
  readonly reviewedRegistryVersionId: string | null;
  readonly divisions: readonly RegistrationDivision[];
  readonly bodies: readonly RegistrationBody[];
  readonly counts: {
    readonly governments: number;
    readonly pairedGovernments: number;
    readonly unpairedByReason: Readonly<Record<string, number>>;
    /** Governments whose body id another government already took (the committed geometry's one shared id: New Jersey's Union Township districts). The first keeps the body. */
    readonly sharedBodyClaims: number;
  };
  /**
   * A territory only: the TIGER/Line functional status its governments were read from. `noLocalGovernment` is the
   * evidenced statement for a territory whose every county, county-subdivision and place division carries a
   * non-governing status, and null wherever one governs.
   */
  readonly functionalStatus?: {
    readonly source: string;
    readonly sourceSha256: string;
    /** FUNCSTAT code → how many of the territory's county, county-subdivision and place divisions carry it. */
    readonly divisionsByStatus: Readonly<Record<string, number>>;
    readonly governing: number;
    readonly noLocalGovernment: string | null;
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
/** The functional statuses that govern: active, partially consolidated, consolidated, subordinate. */
const GOVERNING_FUNCSTAT = new Set(["A", "B", "C", "G"]);
/** The layers a territory's functional status is read for. */
const STATUS_LAYERS = new Set<ReferenceLayer>(["county", "cousub", "place"]);

/** The 2023 cartographic boundary file a layer's divisions were read from. */
function boundaryUrl(layer: Exclude<ReferenceLayer, "state">): string {
  return `https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_${layer}_500k.zip`;
}

/**
 * A county subdivision's parent is the county its GEOID names (its first five digits, state and county FIPS), read
 * off the code rather than off the id. The id's county segment is slugged from the subdivision layer's own county
 * name, which in Puerto Rico, the other territories, Connecticut's planning regions and the independent cities is not
 * the county layer's (`county:adjuntas_municipio/place:…` beside `county:adjuntas`), and the id is committed (the ZIP
 * index names it), so it never moves to match. Any other division nests as its id says, or under the state.
 */
function parentOf(ocdId: string, layer: ReferenceLayer, geoid: string, stateOcdId: string, countyByGeoid: ReadonlyMap<string, string>): string | null {
  if (ocdId === stateOcdId) return null;
  const county = layer === "cousub" ? countyByGeoid.get(geoid.slice(0, 5)) : undefined;
  if (county !== undefined) return county;
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
  /** Accepted for older callers; registration does not use it. */
  readonly reviewed?: ReviewedRegistryIds;
}): RoutineCandidate {
  const { target, reference: loaded, receipt } = input;
  const ref = loaded.reference;
  const provenance = { sourceUrl: receipt.requestedUrl, sourceOrg: "U.S. Census Bureau" as const, collectedAt: loaded.generatedAt, verifiedAt: null };
  const stateOcdId = ref.divisions[0]?.[0] ?? "";
  // Present only for a territory, whose governments are its divisions' TIGER/Line functional status.
  const territory = ref.functionalStatus;
  const countyByGeoid = new Map(ref.divisions.filter(([, layer]) => layer === "county").map(([ocdId, , geoid]) => [geoid, ocdId]));
  const violations: string[] = [];

  const allDivisions: RegistrationDivision[] = ref.divisions.flatMap(([ocdId, layer, geoid, censusName, lsad, funcstat, classfp]): RegistrationDivision[] =>
    layer === "state"
      ? []
      : [{
          ocdId,
          divisionType: DIVISION_TYPE[layer],
          tier: "local",
          state: target.state,
          label: censusName,
          parentOcdId: parentOf(ocdId, layer, geoid, stateOcdId, countyByGeoid),
          lsad: lsad ?? null,
          funcstat: funcstat ?? null,
          classfp: classfp ?? null,
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
  const mint = (
    ocdId: string,
    slot: "governing" | "board",
    origin: RegistrationBody["bodyOrigin"],
    gov: { readonly sourceDataset: RegistrationBody["sourceDataset"]; readonly jurisdictionId: string; readonly census: readonly [id: string, unitType: string] | null; readonly alsoServesOcdIds?: readonly string[] } | null,
    source: RegistrationBody["provenance"],
  ) => {
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
      sourceDataset: gov ? gov.sourceDataset : "TIGER_CB2023",
      // The Census of Governments id and unit type; a TIGER/Line government has neither, only its division's GEOID.
      ...(gov?.census ? { censusId: gov.census[0], censusUnitType: gov.census[1] } : {}),
      jurisdictionId: gov ? gov.jurisdictionId : null,
      ...(gov?.alsoServesOcdIds?.length ? { alsoServesOcdIds: [...gov.alsoServesOcdIds] } : {}),
      provenance: source,
    });
  };
  const unpairedByReason: Record<string, number> = {};
  const claimedSchools = new Set<number>();
  let governments = 0;
  let paired = 0;
  let statusGovernments = 0;
  for (const [pid6, jurisdictionId, , govType, division, how, alternate] of ref.governments) {
    if (govType === "STATE") continue;
    governments++;
    if (division < 0) {
      unpairedByReason[how] = (unpairedByReason[how] ?? 0) + 1;
      continue;
    }
    paired++;
    const [primary, layer, , , , funcstat] = ref.divisions[division];
    const other = alternate >= 0 ? ref.divisions[alternate][0] : null;
    if (how === "TIGER_FUNCSTAT") {
      statusGovernments++;
      // Never a body on a division whose own status does not govern, whatever the government row says.
      if (!territory || !GOVERNING_FUNCSTAT.has(funcstat ?? "")) {
        violations.push(`${pid6} is registered from TIGER/Line functional status on ${primary}, which carries ${funcstat ?? "no"} status${territory ? "" : " in a reference with no status source"}: no government is minted from geography.`);
        continue;
      }
    }
    if (how === "TIGER_FUNCSTAT") {
      mint(primary, "governing", "REGISTERED_FROM_TIGER_FUNCSTAT", { sourceDataset: "TIGER_LINE2023", jurisdictionId, census: null, ...(other === null ? {} : { alsoServesOcdIds: [other] }) }, {
        sourceUrl: territory?.sources[layer] ?? null,
        sourceOrg: "U.S. Census Bureau",
        collectedAt: loaded.generatedAt,
        verifiedAt: null,
      });
      continue;
    }
    if (SCHOOL_TYPES.has(govType)) claimedSchools.add(division);
    mint(primary, SCHOOL_TYPES.has(govType) ? "board" : "governing", "REGISTERED_FROM_CENSUS_OF_GOVERNMENTS", { sourceDataset: "COG_2022", jurisdictionId, census: [pid6, govType], ...(other === null ? {} : { alsoServesOcdIds: [other] }) }, provenance);
  }
  // A territory's school district is its own department of education, a territorial agency with no functional status of its
  // own here: in a territory a body comes only from a governing status, never from a division's type.
  if (!territory) {
    ref.divisions.forEach(([ocdId, layer, geoid], i) => {
      // A Census placeholder is geography, never a government: no board is minted on it (lib/registry/census-placeholders.ts).
      if (!SCHOOL_LAYERS.has(layer) || claimedSchools.has(i) || isCensusPlaceholderDivision({ ocdId, divisionType: "school_district", geoid })) return;
      mint(ocdId, "board", "DERIVED_FROM_DIVISION_TYPE", null, { sourceUrl: boundaryUrl(layer as Exclude<ReferenceLayer, "state">), sourceOrg: "U.S. Census Bureau", collectedAt: loaded.generatedAt, verifiedAt: null });
    });
  }

  /*
   * A territory's evidence, counted from its own divisions. Every county, county-subdivision and place division must
   * carry a status, and every one whose status governs must be a government row (and only those): then a territory with
   * none is the Census's affirmative record, stated, rather than a failed extraction.
   */
  let functionalStatus: RegistrationReadModel["functionalStatus"];
  if (territory) {
    const byStatus: Record<string, number> = {};
    let unstated = 0;
    let governing = 0;
    for (const [, layer, , , , funcstat] of ref.divisions) {
      if (!STATUS_LAYERS.has(layer)) continue;
      if (!funcstat) unstated++;
      else byStatus[funcstat] = (byStatus[funcstat] ?? 0) + 1;
      if (GOVERNING_FUNCSTAT.has(funcstat ?? "")) governing++;
    }
    const statuses = Object.entries(byStatus).sort(([a], [b]) => a.localeCompare(b));
    const counted = statuses.reduce((n, [, v]) => n + v, 0);
    if (unstated > 0) violations.push(`${unstated} of ${target.state}'s county, county-subdivision and place divisions carry no TIGER/Line functional status: its governments cannot be read completely.`);
    if (statusGovernments !== governing) violations.push(`${target.state} has ${governing} divisions with a governing status but ${statusGovernments} government rows read from them.`);
    const none = governments === 0 && unstated === 0 && counted > 0;
    const codes = statuses.map(([code, n]) => `${code} ${n}`).join(", ");
    functionalStatus = {
      source: territory.dataset,
      sourceSha256: territory.sha256,
      divisionsByStatus: Object.fromEntries(statuses),
      governing,
      noLocalGovernment: none
        ? `No local government recorded by the Census for ${ref.divisions[0]?.[3] ?? target.state}: none of its ${counted} county, county-subdivision or place divisions carries a governing functional status in TIGER/Line 2023 (${codes}), and the Census of Governments does not enumerate the territories.`
        : null,
    };
  }

  // These are source holdings. Current reviewed precedence belongs to composition.
  const divisions = allDivisions;
  const bodies = candidates.sort((a, b) => a.id.localeCompare(b.id));
  const readModel: RegistrationReadModel = {
    formatVersion: 1,
    state: target.state.toLowerCase(),
    scope: target.scope,
    vintage: {
      governments: territory ? "2023 TIGER/Line functional status" : "2022 Census of Governments",
      geography: "2023 Census cartographic boundary files",
      sourceSha256: receipt.sha256,
      referenceSha256: loaded.sha256,
    },
    reviewedRegistryVersionId: null,
    divisions,
    bodies,
    counts: {
      governments,
      pairedGovernments: paired,
      unpairedByReason,
      sharedBodyClaims: duplicates,
    },
    ...(functionalStatus ? { functionalStatus } : {}),
  };

  // Zero governments is a failed extraction unless the source affirmatively records none (a territory's statuses, above).
  const evidencedNone = (functionalStatus?.noLocalGovernment ?? null) !== null;
  if (governments === 0 && !evidencedNone) {
    violations.push(
      territory
        ? `The reference lists no government in ${target.state}, and its TIGER/Line functional status does not show that none governs: a failed extraction.`
        : `The reference lists no government in ${target.state}: a failed extraction, never a state with no government.`,
    );
  }

  const readModelHash = sha256(canonicalCivicDataJson(readModel));
  const rawHash = sha256(`${receipt.sha256}\n${loaded.sha256}\n${null}`);
  const records = divisions.length + bodies.length;
  const considered = allDivisions.length + candidates.length;
  const normalizedPayload = {
    formatVersion: 1,
    state: readModel.state,
    readModelHash,
    sourceSha256: receipt.sha256,
    referenceSha256: loaded.sha256,
    reviewedRegistryVersionId: null,
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
    // A territory the Census records with no local government has divisions and no body: its divisions carry the receipt.
    identities: evidencedNone && bodies.length === 0
      ? divisions.map((d) => ({
          subjectId: d.ocdId,
          jurisdiction: target.jurisdiction,
          identifiers: { ocd_id: d.ocdId, geoid: d.geoid },
          matchBasis: "OFFICIAL_ID" as const,
          ambiguous: false,
        }))
      : bodies.map((b) => ({
          subjectId: b.id,
          jurisdiction: target.jurisdiction,
          identifiers: { ocd_id: b.ocdId, geoid: geoidOf.get(b.ocdId) ?? "", ...(b.censusId ? { census_id: b.censusId } : {}) },
          matchBasis: "OFFICIAL_ID" as const,
          ambiguous: false,
        })),
    temporal: territory
      ? { version: "tl-2023+cb-2023", expectedVersion: "tl-2023+cb-2023", sourceThrough: REGISTRATION_SOURCE_THROUGH, staleAtRetrieval: false }
      : { version: "cog-2022+cb-2023", expectedVersion: "cog-2022+cb-2023", sourceThrough: REGISTRATION_SOURCE_THROUGH, staleAtRetrieval: false },
    semantics: {
      factKind: territory
        ? "The local governments TIGER/Line 2023 records as functioning in one territory (which the Census of Governments does not enumerate), each on its own Census division, and every Census division in the territory"
        : "The governments the 2022 Census of Governments lists in one state, each on the Census division that is its territory, and every Census division in the state",
      violations,
    },
    horizon: {
      kind: "BOUNDED",
      query: territory
        ? `every division of ${target.state} TIGER/Line 2023 gives a governing functional status, and every 2023 Census division in it`
        : `every government the 2022 Census of Governments lists in ${target.state}, and every 2023 Census division in it`,
      returnedRecords: records,
      declaredTotal: records,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "lib/registration/reader.ts",
        passed: (governments > 0 || evidencedNone) && bodies.every((b) => geoidOf.has(b.ocdId)),
        detail: evidencedNone
          ? `${divisions.length} divisions and no body for ${target.state}: ${functionalStatus!.noLocalGovernment}`
          : `${bodies.length} bodies and ${divisions.length} divisions for ${target.state}; every body sits on a Census division of the state.`,
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
