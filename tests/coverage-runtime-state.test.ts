import assert from "node:assert/strict";
import test from "node:test";

import type { CivicDataReadMetadata, CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";
import type { OfficeholderIndex } from "../lib/officials/lookup.ts";
import {
  summarizeCoverage,
} from "../lib/registry/coverage.ts";
import {
  settleCoverageStateLegislators,
  type CoverageStateLegislatorReader,
} from "../lib/registry/server.ts";
import type { Division } from "../lib/registry/types.ts";
import type { StatePeopleJurisdiction } from "../lib/officials/people-identity.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

const NOW = "2026-09-09T12:00:00.000Z";

await installRegistryAuthority();

function metadata(
  scope: StatePeopleJurisdiction,
  overrides: Partial<CivicDataReadMetadata> = {},
): CivicDataReadMetadata {
  return {
    recordClass: "STATE_LEGISLATOR",
    scope,
    sourceId: null,
    version: null,
    versionId: null,
    lastKnownGoodVersionId: null,
    sourceThrough: null,
    retrievedAt: null,
    promotedAt: null,
    stale: "UNKNOWN",
    staleAt: null,
    ...overrides,
  };
}

function division(
  state: "az" | "nj",
  chamber: "sldl" | "sldu",
  district: number,
): Division {
  return {
    ocdId: `ocd-division/country:us/state:${state}/${chamber}:${district}`,
    divisionType: chamber,
    tier: "state",
    state: state.toUpperCase(),
    label: `${chamber === "sldl" ? "State House" : "State Senate"} District ${district}`,
    parentOcdId: null,
    lsad: null,
    funcstat: null,
    classfp: null,
    geoid: null,
    canonicalOcdId: null,
    canonicalMatch: "none",
    canonicalGap: "UNDETERMINED",
    sourceDataset: "DERIVED",
    provenance: {
      sourceUrl: "https://www.census.gov/",
      sourceOrg: "U.S. Census Bureau",
      collectedAt: NOW,
      verifiedAt: NOW,
    },
  };
}

function emptyRead(
  kind: "NOT_RECORDED" | "STORE_UNREACHABLE",
  scope: StatePeopleJurisdiction,
): CivicDataReadResult<OfficialStateLegislatorReadModel> {
  if (kind === "NOT_RECORDED") {
    return {
      kind,
      value: null,
      metadata: metadata(scope),
      detail: `The canonical ${scope} pointer was not recorded.`,
    };
  }
  return {
    kind,
    value: null,
    metadata: metadata(scope),
    code: "STORE_READ_FAILED",
    detail: `The canonical ${scope} store could not be read.`,
  };
}

function availableAzRead(
  ocdId: string,
): CivicDataReadResult<OfficialStateLegislatorReadModel> {
  const sourceUrl = "https://www.azleg.gov/MemberRoster/";
  const versionId = "test:az-roster";
  const value: OfficialStateLegislatorReadModel = {
    formatVersion: 1,
    sourceId: "az-legislature",
    jurisdiction: "US-AZ",
    term: "2025-2026",
    generatedAt: NOW,
    roster: {
      scope: "AZ",
      generatedAt: NOW,
      officeholders: [{
        id: "az-legislature:person-1",
        name: "Official Person",
        officeTitle: "State Representative",
        level: "STATE",
        termStart: "2025-01-01",
        termEnd: "2026-12-31",
        birthDate: null,
        partyLabel: null,
        websiteUrl: sourceUrl,
        contactFormUrl: null,
        phone: null,
        email: null,
        campaignUrl: null,
        photo: null,
        state: "AZ",
        chamber: "lower",
        provenance: {
          sourceUrl,
          sourceOrg: "Arizona State Legislature",
          collectedAt: NOW,
          verifiedAt: NOW,
        },
      }],
      divisions: [{
        officeholderId: "az-legislature:person-1",
        ocdId,
        bodyId: null,
      }],
      unmatched: [],
    },
  };
  const receipt = {
    contractVersion: 2 as const,
    decision: "GOOD" as const,
    candidateId: versionId,
    sourceId: "az-legislature",
    recordClass: "STATE_LEGISLATOR" as const,
    scope: "US-AZ",
    validatedAt: NOW,
    checks: [],
    excludedFacts: [],
  };
  return {
    kind: "PROMOTED",
    value,
    metadata: metadata("US-AZ", {
      sourceId: "az-legislature",
      version: value.term,
      versionId,
      lastKnownGoodVersionId: versionId,
      sourceThrough: NOW,
      retrievedAt: NOW,
      promotedAt: NOW,
      stale: "CURRENT",
    }),
    projection: {
      key: "STATE_LEGISLATOR:US-AZ",
      sourceId: "az-legislature",
      recordClass: "STATE_LEGISLATOR",
      scope: "US-AZ",
      versionId,
      lastKnownGoodVersionId: versionId,
      promotedAt: NOW,
      payload: value,
      receipt,
    },
  };
}

test("coverage preserves NOT_RECORDED and STORE_UNREACHABLE as independent exact-scope facts", async () => {
  const az = division("az", "sldl", 17);
  const nj = division("nj", "sldu", 25);
  const reader: CoverageStateLegislatorReader = async (scope) =>
    emptyRead(scope === "US-AZ" ? "NOT_RECORDED" : "STORE_UNREACHABLE", scope);

  const settled = await settleCoverageStateLegislators([az, nj], new Map(), reader);
  assert.deepEqual(
    settled.authorities.map(({ scope, kind, code }) => ({ scope, kind, code })),
    [
      { scope: "US-AZ", kind: "NOT_RECORDED", code: null },
      { scope: "US-NJ", kind: "STORE_UNREACHABLE", code: "STORE_READ_FAILED" },
    ],
  );

  const summary = summarizeCoverage(
    [0, 0],
    [],
    new Map([[az.ocdId, az], [nj.ocdId, nj]]),
    [],
    0,
    settled.officials,
    [az, nj],
    null,
    settled.authorities,
  );
  assert.deepEqual(summary.seats.map(({ representatives }) => representatives), [[], []]);
  assert.deepEqual(
    summary.stateLegislatorAuthorities.map(({ scope, kind }) => ({ scope, kind })),
    [
      { scope: "US-AZ", kind: "NOT_RECORDED" },
      { scope: "US-NJ", kind: "STORE_UNREACHABLE" },
    ],
  );
});

test("a healthy exact-scope roster still populates its seat and has no gap notice", async () => {
  const az = division("az", "sldl", 17);
  const existing: OfficeholderIndex = new Map();
  const reader: CoverageStateLegislatorReader = async () => availableAzRead(az.ocdId);

  const settled = await settleCoverageStateLegislators([az], existing, reader);
  const summary = summarizeCoverage(
    [0, 0],
    [],
    new Map([[az.ocdId, az]]),
    [],
    0,
    settled.officials,
    [az],
    null,
    settled.authorities,
  );

  assert.equal(existing.size, 0, "settlement must not mutate the independently loaded base roster");
  assert.equal(summary.stateLegislatorAuthorities[0]?.kind, "PROMOTED");
  assert.equal(summary.seats[0]?.representatives[0]?.id, "az-legislature:person-1");
});
