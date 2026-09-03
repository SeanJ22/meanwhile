import type { ArtifactProvenance } from "./contract.ts";
import { stateDomainFiles } from "../holdings/files.ts";

/**
 * **THE ARTIFACT CLASSES `pnpm coverage` ACTUALLY CONSUMES, each measured
 * against the provenance contract.**
 * (2026-08-27, the coverage-truth session.)
 *
 * The brief asked for the contract to be proven against every artifact class
 * the coverage implementation consumes, and this is that list. It is
 * deliberately the CONSUMED set rather than every file in the repository: a
 * contract proven against artifacts nothing reads is a contract proven against
 * nothing.
 *
 * **Several of these do not conform, and the non-conformance is the finding.**
 * Each row records what the artifact can actually answer today, so
 * `pnpm corpus:check` reports the gap by name rather than by absence. Filling a
 * row in without the underlying fact would make the report agree with itself,
 * which is the failure mode this whole session was about.
 *
 * Adding a row is not the same as fixing one. A row here describes what IS.
 */
const RECORDED_CORPUS_ARTIFACTS: readonly (Partial<ArtifactProvenance> &
  Pick<ArtifactProvenance, "localPath" | "what" | "sourceClass"> & { notes?: string[] })[] = [
  {
    localPath: "data/meetings-snapshot.json",
    what: "every meeting the wired adapters could reach, plus a per-source run report",
    sourceClass: "DERIVED",
    derivedFrom: ["lib/registry/source-wiring.ts", "the twelve vendor adapters under lib/sources/"],
    sourceUrl: null,
    resolvedUrl: null,
    sourceOrg: "each body's own publisher, recorded per meeting in `provenance`",
    /* The snapshot DOES carry this, at the top level, and each meeting carries
     * its own `provenance.collectedAt`. This is the class that conforms best,
     * because it was built by an ingestion path rather than committed by hand. */
    retrievedAt: null,
    contentType: "application/json",
    contentHash: null,
    jurisdiction: null,
    datasetId: null,
    freshness: { staleAfterDays: 1, refreshedBy: "pnpm ingest composite" },
    permission: {
      state: "ALLOWED",
      basis: "per-source, recorded in docs/sources.md; every adapter fetches through the identified ladder in lib/sources/http.ts",
      attribution: null,
    },
    notes: [
      "carries `generatedAt` and a per-source ok/error/fetched/normalized report, which is what let `pnpm coverage` tell 'this source returned nothing' from 'this source was never asked'.",
      "no contentHash: the snapshot is rewritten whole each run rather than diffed, so a change is detected by re-running rather than by comparison.",
    ],
  },
  {
    localPath: "public/geo/*.geojson",
    what: "the Census boundary polygons every division resolution is decided by",
    sourceClass: "RETRIEVED",
    sourceUrl: "https://www2.census.gov/geo/tiger/GENZ2025/shp/",
    resolvedUrl: null,
    sourceOrg: "U.S. Census Bureau",
    /*
     * **THE FIELD THIS CONTRACT WAS WRITTEN OVER.** Nothing in this repository
     * records when these were retrieved. `scripts/build-registry.ts` used to
     * stamp every derived row with the moment the DERIVER ran, which asserted a
     * retrieval that never happened; that is now carried forward per row
     * instead, which stops the false claim and does not supply the fact.
     */
    retrievedAt: null,
    contentType: null,
    contentHash: null,
    jurisdiction: null,
    datasetId: "TIGER/Line GENZ2025",
    freshness: { staleAfterDays: 365, refreshedBy: "pnpm states:fetch / pnpm tiger:fetch" },
    permission: {
      state: "ALLOWED",
      basis: "U.S. Census Bureau products are in the public domain; docs/sources.md carries the row",
      attribution: "U.S. Census Bureau, TIGER/Line",
    },
    notes: [
      "NON-CONFORMANT ON retrievedAt, contentType and contentHash. The vintage (GENZ2025) is known and the retrieval date is not, so nothing can say whether a newer vintage has shipped without re-fetching everything and diffing.",
      "this is the class that forced the contract to exist.",
    ],
  },
  {
    localPath: "data/states/az/geo/body-territories.geojson",
    what: "recorded plat polygons for governments the Census enumerates no division for",
    sourceClass: "RETRIEVED",
    sourceUrl:
      "https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/LandRecords/MapServer/15/query",
    resolvedUrl: null,
    sourceOrg: "Pima County GIS, Land Records — Subdivisions layer",
    /* Written the day it was created, and every FEATURE carries its formation
     * instrument and source as well — so the provenance is per-polygon, not
     * only per-file. */
    retrievedAt: "2026-08-27",
    contentType: "application/json",
    contentHash: null,
    jurisdiction: "ocd-division/country:us/state:az/county:pima",
    datasetId: "Pima County Subdivisions, layer 15",
    freshness: { staleAfterDays: 180, refreshedBy: "pnpm cfd:territory --geojson data/states/az/geo/body-territories.geojson" },
    permission: {
      state: "ALLOWED",
      basis: "gisdata.pima.gov robots.txt is HTTP 404 (NO_ROBOTS, nothing forbids the path); docs/sources.md carries the row, walked 2026-08-27",
      attribution: "Pima County GIS",
    },
    notes: [
      "each FEATURE additionally carries formationInstrument, formationSource, platSource and platSourceOrg, so a polygon can be traced to the resolution that made it this body's land.",
      "no contentHash yet: a re-recorded plat would be detected by re-running, not by comparison.",
    ],
  },
  {
    localPath: "data/derived/census-unit-zips.json",
    what: "the ZIP-to-government crosswalk that gives coverage its external denominator",
    sourceClass: "DERIVED",
    derivedFrom: ["data/reference/census_govt_units_2022.csv", "data/derived/zip-governments.json"],
    sourceUrl: null,
    resolvedUrl: null,
    sourceOrg: "U.S. Census Bureau, 2022 Census of Governments",
    retrievedAt: null,
    contentType: "application/json",
    contentHash: null,
    jurisdiction: null,
    datasetId: "2022 Census of Governments",
    freshness: { staleAfterDays: null, refreshedBy: "pnpm crosswalk:build" },
    permission: {
      state: "ALLOWED",
      basis: "public domain federal statistical product",
      attribution: "U.S. Census Bureau, 2022 Census of Governments",
    },
    notes: [
      "carries its own `totals.byType` resolution rates, which is how `pnpm coverage` knows this enumerator resolves 0 of 39,555 special districts and says so rather than reporting them as absent.",
      "never stale by date: the 2022 vintage is the 2022 vintage until the 2027 census.",
    ],
  },
  {
    localPath: "data/audit/gus-2022-clip-counties.json",
    what: "the 2022 Census of Governments clipped to the three pilot counties",
    sourceClass: "DERIVED",
    derivedFrom: ["data/reference/census_govt_units_2022.csv"],
    sourceUrl: null,
    resolvedUrl: null,
    sourceOrg: "U.S. Census Bureau, 2022 Census of Governments",
    retrievedAt: null,
    contentType: "application/json",
    contentHash: null,
    jurisdiction: null,
    datasetId: "2022 Census of Governments",
    freshness: { staleAfterDays: null, refreshedBy: "regenerated from the reference CSV" },
    permission: {
      state: "ALLOWED",
      basis: "public domain federal statistical product",
      attribution: "U.S. Census Bureau, 2022 Census of Governments",
    },
    notes: [
      "carries each unit's censusId and the website the government itself reported, which is what `pnpm bodies:census-gap` walks.",
    ],
  },
  {
    localPath: "data/ballot/*.json",
    what: "the certified contests, candidacies and measures for each pilot",
    sourceClass: "CURATED",
    sourceUrl: "each election authority's own certified filing, cited per row in `provenance`",
    resolvedUrl: null,
    sourceOrg: "the county or state election authority, per row",
    retrievedAt: null,
    contentType: null,
    contentHash: null,
    jurisdiction: null,
    datasetId: null,
    freshness: { staleAfterDays: 30, refreshedBy: "per-state hunt; there is no single command" },
    permission: {
      state: "ALLOWED",
      basis: "public election records; docs/sources.md carries the per-authority rows",
      attribution: null,
    },
    notes: [
      "PARTIAL: provenance is per CANDIDACY (sourceUrl, sourceOrg, collectedAt, verifiedAt) and not per FILE, so the file itself cannot say when it was last reconciled against the authority.",
      "no single refresh command — this is the class where `refreshedBy` is honest about there not being one.",
    ],
  },
  {
    localPath: "data/corpus/statements.json",
    what: "append-only snapshots of what candidates and officials publish",
    sourceClass: "RETRIEVED",
    sourceUrl: "each subject's campaign site or official page, recorded per snapshot",
    resolvedUrl: null,
    sourceOrg: "the subject's own publisher, per snapshot",
    retrievedAt: "recorded per snapshot as `retrievedAt`",
    contentType: "text/html",
    contentHash: "recorded per snapshot as `contentHash`",
    jurisdiction: null,
    datasetId: null,
    freshness: { staleAfterDays: 30, refreshedBy: "pnpm corpus:fetch" },
    permission: {
      state: "ALLOWED",
      basis: "public pages, fetched through the identified ladder; docs/sources.md carries the hosts",
      attribution: null,
    },
    notes: [
      "THE CLASS THAT ALREADY CONFORMS, and the model for the rest: it is append-only, content-addressed, and an unchanged hash for the same (subject, url) appends nothing while a changed one appends a new snapshot beside the old. FETCH, ATTRIBUTE, HASH, REUSE and DETECT CHANGE are all answerable from the store itself.",
    ],
  },
];

// The national corpus remains in its domain; canonical state geometry is
// enumerated independently of reader coverage, so new holdings cannot disappear.
const censusGeometry = RECORDED_CORPUS_ARTIFACTS.find((a) => a.localPath === "public/geo/*.geojson")!;
export const CORPUS_ARTIFACTS = [
  ...RECORDED_CORPUS_ARTIFACTS,
  ...stateDomainFiles(process.cwd(), "geo").filter((p) => !p.endsWith("/body-territories.geojson"))
    .map((localPath) => ({ ...censusGeometry, localPath })),
];
