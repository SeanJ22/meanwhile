import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalCivicDataJson, civicRecordsFor } from "../lib/civic-data/changes.ts";
import {
  processRoutineCandidate,
  type PromotionOutcome,
} from "../lib/civic-data/promotion.ts";
import { projectRoutineDataObservability } from "../lib/civic-data/observability.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { promotionProofIssue, readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore, trustedLkgImportClock } from "../lib/civic-data/store.ts";
import { routineTaskDue, type RoutineSourceTask } from "../lib/civic-data/runner.ts";
import {
  PDC_V2_FROZEN_BASE_SHA,
  TRUSTED_LKG_IMPORT_AUTHORIZATION,
  TRUSTED_LKG_IMPORT_PURPOSE,
  trustedLkgCandidateId,
  trustedLkgCandidateEnvelopeSha256,
  trustedLkgFixtureSetSha256,
  trustedLkgImportEvidenceIssue,
  trustedLkgImportUrl,
  trustedLkgValidatorIds,
} from "../lib/civic-data/trusted-lkg-import.ts";
import {
  sourceProjectionEvidence,
  type CandidateVersionRecord,
  type RoutineCandidate,
  type CandidateEvent,
  type TrustedLkgImportEvidence,
} from "../lib/civic-data/types.ts";

const FIRST = "2026-09-09T12:00:00.000Z";
const SECOND = "2026-09-09T13:00:00.000Z";
const MANUAL_CONTRACT_ID = "comment-access" as const;
const MANUAL_SOURCE_ID = "curated-reader-primary-sources" as const;
const MANUAL_RECORD_CLASS = "CURATED_READER_RECORD" as const;
const MANUAL_SCOPE = "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies" as const;
const MANUAL_BODY_ID = "ocd-division/country:us/state:az/county:example" as const;
const MANUAL_RECORD_ID = `comment-access:${MANUAL_BODY_ID}` as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidate(
  importedAt = FIRST,
  importerCodeSha = "a".repeat(40),
  door: "MANUAL" | "ROUTINE" = "MANUAL",
): RoutineCandidate {
  const manual = door === "MANUAL";
  const contractId = manual ? MANUAL_CONTRACT_ID : "dotgov";
  const sourceId = manual ? MANUAL_SOURCE_ID : "cisa-dotgov-registry";
  const recordClass = manual ? MANUAL_RECORD_CLASS : "DOTGOV_REFERENCE";
  const scope = manual ? MANUAL_SCOPE : "US:current-full:election-domains";
  const parserVersion = manual ? "curated-reader-records/2" : "cisa-dotgov/2";
  const payload = manual
    ? {
        kind: MANUAL_CONTRACT_ID,
        records: [{
          id: MANUAL_RECORD_ID,
          bodyId: MANUAL_BODY_ID,
          publicComment: "Published exact frozen public-comment rule.",
        }],
      }
    : {
        source: { commit: "fixture-source-version" },
        electionDomains: [{ domain: "elections.example.gov", organization: "Example Election Authority" }],
      };
  const civicRecords = civicRecordsFor(recordClass, payload);
  const fixtures = [{
    path: manual ? "lib/registry/comment-access.ts" : "lib/civic-data/contracts.ts",
    sha256: sha256("exact frozen fixture bytes"),
    bytes: Buffer.byteLength("exact frozen fixture bytes"),
  }] as const;
  const fixtureSetSha256 = trustedLkgFixtureSetSha256(fixtures);
  const normalizedPayloadSha256 = sha256(canonicalCivicDataJson(payload));
  const partial: RoutineCandidate = {
    id: "pending-content-address",
    sourceId,
    recordClass,
    scope,
    retrieval: {
      succeeded: true,
      requestedUrl: trustedLkgImportUrl(contractId),
      finalUrl: null,
      httpStatus: null,
      retrievedAt: importedAt,
      rawHash: fixtureSetSha256,
    },
    normalization: {
      succeeded: true,
      parserVersion,
      schemaVersion: `${contractId}:trusted-lkg:1`,
      normalizedHash: normalizedPayloadSha256,
      normalizedPayloadHash: normalizedPayloadSha256,
      inputRecords: civicRecords.length,
      outputRecords: civicRecords.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{
      subjectId: manual ? MANUAL_RECORD_ID : "elections.example.gov",
      jurisdiction: "US",
      identifiers: manual
        ? { record_id: MANUAL_RECORD_ID, body_id: MANUAL_BODY_ID }
        : { domain: "elections.example.gov", source_sha: "fixture-source-version" },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
    }],
    temporal: {
      version: "fixture-source-version",
      expectedVersion: "fixture-source-version",
      sourceThrough: "2026-09-08T00:00:00.000Z",
      staleAtRetrieval: true,
    },
    semantics: { factKind: `frozen ${contractId} LKG`, violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "exact frozen LKG members without a current publisher-universe claim",
      returnedRecords: civicRecords.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(
      sourceId,
      recordClass,
      scope,
    ),
    dependentChecks: [{
      consumer: `${contractId} Reader projection`,
      passed: true,
      detail: "The exact frozen projection satisfies its contract-specific Reader shape.",
    }],
    normalizedPayload: payload,
    readModel: payload,
    civicRecords,
  };
  const evidence: TrustedLkgImportEvidence = {
    contractVersion: 1,
    kind: "TRUSTED_LKG_IMPORT",
    authorization: TRUSTED_LKG_IMPORT_AUTHORIZATION,
    purpose: TRUSTED_LKG_IMPORT_PURPOSE,
    sourceAuthenticated: false,
    contractId,
    sourceId: partial.sourceId,
    recordClass: partial.recordClass,
    scope: partial.scope,
    parserVersion: partial.normalization.parserVersion,
    sourceVersion: partial.temporal.version,
    sourceThrough: partial.temporal.sourceThrough,
    importedAt,
    frozenBaseSha: PDC_V2_FROZEN_BASE_SHA,
    importerCodeSha,
    fixtureSetSha256,
    fixtures,
    normalizedPayloadSha256,
    readModelSha256: sha256(canonicalCivicDataJson(payload)),
    candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(partial),
    validatorIds: trustedLkgValidatorIds(partial),
  };
  return { ...partial, id: trustedLkgCandidateId(evidence), bootstrapImport: evidence };
}

const RETAINED_LKG_FIXTURE: {
  readonly outcome: PromotionOutcome;
  readonly events: readonly CandidateEvent[];
} = {
  "outcome": {
    "candidate": {
      "candidate": {
        "id": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
        "sourceId": "curated-reader-primary-sources",
        "recordClass": "CURATED_READER_RECORD",
        "scope": "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies",
        "retrieval": {
          "succeeded": true,
          "requestedUrl": "pdc-v2-trusted-lkg:comment-access",
          "finalUrl": null,
          "httpStatus": null,
          "retrievedAt": "2026-09-09T12:00:00.000Z",
          "rawHash": "4ba6632478f4d8b3922a4e2cb241abfe79eec5e5c00792757b43bcd8e099d675"
        },
        "normalization": {
          "succeeded": true,
          "parserVersion": "curated-reader-records/2",
          "schemaVersion": "comment-access:trusted-lkg:1",
          "normalizedHash": "72a7f779487fb872f83ea12f073139067d9d6e3776eacbb9a7c47a750026b400",
          "normalizedPayloadHash": "72a7f779487fb872f83ea12f073139067d9d6e3776eacbb9a7c47a750026b400",
          "inputRecords": 1,
          "outputRecords": 1,
          "droppedRecords": 0,
          "missingRequiredFields": []
        },
        "identities": [
          {
            "subjectId": "comment-access:ocd-division/country:us/state:az/county:example",
            "jurisdiction": "US",
            "identifiers": {
              "record_id": "comment-access:ocd-division/country:us/state:az/county:example",
              "body_id": "ocd-division/country:us/state:az/county:example"
            },
            "matchBasis": "OFFICIAL_ID",
            "ambiguous": false
          }
        ],
        "temporal": {
          "version": "fixture-source-version",
          "expectedVersion": "fixture-source-version",
          "sourceThrough": "2026-09-08T00:00:00.000Z",
          "staleAtRetrieval": true
        },
        "semantics": {
          "factKind": "frozen comment-access LKG",
          "violations": []
        },
        "horizon": {
          "kind": "OPEN_FACT_SET",
          "query": "exact frozen LKG members without a current publisher-universe claim",
          "returnedRecords": 1,
          "declaredTotal": null,
          "paginationComplete": false,
          "claimsComplete": false
        },
        "absence": {
          "claimsAbsence": false,
          "basis": "NONE",
          "exactSubject": null,
          "exactHorizon": null
        },
        "sourceProjectionEvidence": {
          "kind": "SOURCE_PROJECTION_CONTRACT",
          "sourceId": "curated-reader-primary-sources",
          "recordClass": "CURATED_READER_RECORD",
          "scope": "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies"
        },
        "dependentChecks": [
          {
            "consumer": "comment-access Reader projection",
            "passed": true,
            "detail": "The exact frozen projection satisfies its contract-specific Reader shape."
          }
        ],
        "normalizedPayload": {
          "kind": "comment-access",
          "records": [
            {
              "id": "comment-access:ocd-division/country:us/state:az/county:example",
              "bodyId": "ocd-division/country:us/state:az/county:example",
              "publicComment": "Published exact frozen public-comment rule."
            }
          ]
        },
        "readModel": {
          "kind": "comment-access",
          "records": [
            {
              "id": "comment-access:ocd-division/country:us/state:az/county:example",
              "bodyId": "ocd-division/country:us/state:az/county:example",
              "publicComment": "Published exact frozen public-comment rule."
            }
          ]
        },
        "civicRecords": [
          {
            "key": "curated-reader:comment-access:ocd-division/country:us/state:az/county:example",
            "record": {
              "id": "comment-access:ocd-division/country:us/state:az/county:example",
              "bodyId": "ocd-division/country:us/state:az/county:example",
              "publicComment": "Published exact frozen public-comment rule."
            }
          }
        ],
        "bootstrapImport": {
          "contractVersion": 1,
          "kind": "TRUSTED_LKG_IMPORT",
          "authorization": "PDC_V2_FROZEN_LKG_CUTOVER",
          "purpose": "PRESERVE_EXISTING_READER_LKG_DURING_AUTHORITY_TRANSFER",
          "sourceAuthenticated": false,
          "contractId": "comment-access",
          "sourceId": "curated-reader-primary-sources",
          "recordClass": "CURATED_READER_RECORD",
          "scope": "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies",
          "parserVersion": "curated-reader-records/2",
          "sourceVersion": "fixture-source-version",
          "sourceThrough": "2026-09-08T00:00:00.000Z",
          "importedAt": "2026-09-09T12:00:00.000Z",
          "frozenBaseSha": "fc67e8cd34c489590c403f7b4a0d6008fa755296",
          "importerCodeSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "fixtureSetSha256": "4ba6632478f4d8b3922a4e2cb241abfe79eec5e5c00792757b43bcd8e099d675",
          "fixtures": [
            {
              "path": "lib/registry/comment-access.ts",
              "sha256": "609dc874e438bfb74fbfa012bb178fec38e8e0462bc2d0af5e8d821be5916d92",
              "bytes": 26
            }
          ],
          "normalizedPayloadSha256": "72a7f779487fb872f83ea12f073139067d9d6e3776eacbb9a7c47a750026b400",
          "readModelSha256": "72a7f779487fb872f83ea12f073139067d9d6e3776eacbb9a7c47a750026b400",
          "candidateEnvelopeSha256": "b0e68b8bf95880bff16ddd20541875444bc0eacbb2c1971575f89eced54de020",
          "validatorIds": [
            "parser:curated-reader-records/2",
            "reader:comment-access Reader projection",
            "source-projection:curated-reader-primary-sources:CURATED_READER_RECORD:US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies"
          ]
        },
        "changeSet": {
          "outcome": "CHANGED",
          "added": [
            {
              "key": "curated-reader:comment-access:ocd-division/country:us/state:az/county:example",
              "before": null,
              "after": {
                "id": "comment-access:ocd-division/country:us/state:az/county:example",
                "bodyId": "ocd-division/country:us/state:az/county:example",
                "publicComment": "Published exact frozen public-comment rule."
              }
            }
          ],
          "changed": [],
          "removed": [],
          "held": []
        }
      },
      "state": "PROMOTED",
      "acquisitionSucceeded": true,
      "receipt": {
        "contractVersion": 2,
        "decision": "GOOD",
        "candidateId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
        "sourceId": "curated-reader-primary-sources",
        "recordClass": "CURATED_READER_RECORD",
        "scope": "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies",
        "validatedAt": "2026-09-09T12:00:00.000Z",
        "checks": [
          {
            "check": "SOURCE_AUTHENTICITY",
            "verdict": "PASS",
            "code": "TRUSTED_LKG_IMPORT_PROVENANCE_VALID",
            "detail": "Explicitly non-source-authenticated PDC-v2 LKG import from 1 immutable file(s), manifest 4ba6632478f4d8b3922a4e2cb241abfe79eec5e5c00792757b43bcd8e099d675, at code aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa."
          },
          {
            "check": "SCHEMA_PARSE_VALIDITY",
            "verdict": "PASS",
            "code": "SCHEMA_AND_DISPOSITION_VALID",
            "detail": "1/1 records normalized; 0 explicitly dropped."
          },
          {
            "check": "IDENTITY_JURISDICTION_VALIDITY",
            "verdict": "PASS",
            "code": "IDENTITY_AND_JURISDICTION_EXACT",
            "detail": "1 exact identity binding(s); no name-only inheritance."
          },
          {
            "check": "TEMPORAL_VALIDITY",
            "verdict": "PASS",
            "code": "TRUSTED_LKG_IMPORT_STALENESS_RECORDED",
            "detail": "The frozen LKG is explicitly stale at import (source through 2026-09-08T00:00:00.000Z); it may preserve service but cannot prove current publisher freshness."
          },
          {
            "check": "SEMANTIC_VALIDITY",
            "verdict": "PASS",
            "code": "FACT_INTERPRETATION_VALID",
            "detail": "frozen comment-access LKG."
          },
          {
            "check": "COMPLETENESS_HORIZON_VALIDITY",
            "verdict": "PASS",
            "code": "INDIVIDUAL_FACTS_NO_UNIVERSE_CLAIM",
            "detail": "Valid individual facts may promote; broader completeness remains open."
          },
          {
            "check": "ABSENCE_VALIDITY",
            "verdict": "PASS",
            "code": "NO_ABSENCE_CLAIM",
            "detail": "The projection makes no absence claim."
          },
          {
            "check": "DEPENDENT_READ_MODEL_VALIDITY",
            "verdict": "PASS",
            "code": "DEPENDENT_CONSUMERS_ACCEPT",
            "detail": "comment-access Reader projection, lib/civic-data/curated-reader-read-model.ts#readCuratedReaderProjection (source-scoped pre-promotion)"
          }
        ],
        "excludedFacts": []
      },
      "promotedVersion": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "lastKnownGoodVersion": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "failureCode": null,
      "failureDetail": null
    },
    "promoted": {
      "key": "CURATED_READER_RECORD:US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies",
      "sourceId": "curated-reader-primary-sources",
      "recordClass": "CURATED_READER_RECORD",
      "scope": "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies",
      "versionId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "lastKnownGoodVersionId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "promotedAt": "2026-09-09T12:00:00.000Z",
      "payload": {
        "kind": "comment-access",
        "records": [
          {
            "id": "comment-access:ocd-division/country:us/state:az/county:example",
            "bodyId": "ocd-division/country:us/state:az/county:example",
            "publicComment": "Published exact frozen public-comment rule."
          }
        ]
      },
      "receipt": {
        "contractVersion": 2,
        "decision": "GOOD",
        "candidateId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
        "sourceId": "curated-reader-primary-sources",
        "recordClass": "CURATED_READER_RECORD",
        "scope": "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies",
        "validatedAt": "2026-09-09T12:00:00.000Z",
        "checks": [
          {
            "check": "SOURCE_AUTHENTICITY",
            "verdict": "PASS",
            "code": "TRUSTED_LKG_IMPORT_PROVENANCE_VALID",
            "detail": "Explicitly non-source-authenticated PDC-v2 LKG import from 1 immutable file(s), manifest 4ba6632478f4d8b3922a4e2cb241abfe79eec5e5c00792757b43bcd8e099d675, at code aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa."
          },
          {
            "check": "SCHEMA_PARSE_VALIDITY",
            "verdict": "PASS",
            "code": "SCHEMA_AND_DISPOSITION_VALID",
            "detail": "1/1 records normalized; 0 explicitly dropped."
          },
          {
            "check": "IDENTITY_JURISDICTION_VALIDITY",
            "verdict": "PASS",
            "code": "IDENTITY_AND_JURISDICTION_EXACT",
            "detail": "1 exact identity binding(s); no name-only inheritance."
          },
          {
            "check": "TEMPORAL_VALIDITY",
            "verdict": "PASS",
            "code": "TRUSTED_LKG_IMPORT_STALENESS_RECORDED",
            "detail": "The frozen LKG is explicitly stale at import (source through 2026-09-08T00:00:00.000Z); it may preserve service but cannot prove current publisher freshness."
          },
          {
            "check": "SEMANTIC_VALIDITY",
            "verdict": "PASS",
            "code": "FACT_INTERPRETATION_VALID",
            "detail": "frozen comment-access LKG."
          },
          {
            "check": "COMPLETENESS_HORIZON_VALIDITY",
            "verdict": "PASS",
            "code": "INDIVIDUAL_FACTS_NO_UNIVERSE_CLAIM",
            "detail": "Valid individual facts may promote; broader completeness remains open."
          },
          {
            "check": "ABSENCE_VALIDITY",
            "verdict": "PASS",
            "code": "NO_ABSENCE_CLAIM",
            "detail": "The projection makes no absence claim."
          },
          {
            "check": "DEPENDENT_READ_MODEL_VALIDITY",
            "verdict": "PASS",
            "code": "DEPENDENT_CONSUMERS_ACCEPT",
            "detail": "comment-access Reader projection, lib/civic-data/curated-reader-read-model.ts#readCuratedReaderProjection (source-scoped pre-promotion)"
          }
        ],
        "excludedFacts": []
      }
    },
    "readerReadback": {
      "contractVersion": 2,
      "kind": "READER_PROJECTION_READBACK",
      "contractId": "comment-access",
      "sourceId": "curated-reader-primary-sources",
      "recordClass": "CURATED_READER_RECORD",
      "scope": "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies",
      "projectionId": "public-comment-access",
      "versionId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "pointerKey": "CURATED_READER_RECORD:US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies",
      "observedAt": "2026-09-09T12:00:00.000Z",
      "evidenceKind": "TYPED_READER_READ_MODEL",
      "verifierId": "lib/civic-data/curated-reader-read-model.ts#readCuratedReaderProjection",
      "verifierCodeSha": "667c533274eabe7e66b7d37b782eed10fef7654d",
      "status": "PASS",
      "detail": "The typed comment-access Reader read canonical version curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de."
    }
  },
  "events": [
    {
      "candidateId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "sequence": 1,
      "state": "FETCHED",
      "at": "2026-09-09T12:00:00.000Z",
      "detail": "Acquired raw 4ba6632478f4d8b3922a4e2cb241abfe79eec5e5c00792757b43bcd8e099d675."
    },
    {
      "candidateId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "sequence": 2,
      "state": "NORMALIZED",
      "at": "2026-09-09T12:00:00.000Z",
      "detail": "Normalized 1/1 records as 72a7f779487fb872f83ea12f073139067d9d6e3776eacbb9a7c47a750026b400."
    },
    {
      "candidateId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "sequence": 3,
      "state": "VALIDATED",
      "at": "2026-09-09T12:00:00.000Z",
      "detail": "Every applicable GOOD check passed."
    },
    {
      "candidateId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "sequence": 4,
      "state": "PROMOTED",
      "at": "2026-09-09T12:00:00.000Z",
      "detail": "Atomic pointer CURATED_READER_RECORD:US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies moved from bootstrap/no-version to curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de."
    },
    {
      "candidateId": "curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de",
      "sequence": 5,
      "state": "PROMOTED",
      "at": "2026-09-09T12:00:00.000Z",
      "detail": "READER_PROJECTION_READBACK_V2 {\"contractVersion\":2,\"kind\":\"READER_PROJECTION_READBACK\",\"contractId\":\"comment-access\",\"sourceId\":\"curated-reader-primary-sources\",\"recordClass\":\"CURATED_READER_RECORD\",\"scope\":\"US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies\",\"projectionId\":\"public-comment-access\",\"versionId\":\"curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de\",\"pointerKey\":\"CURATED_READER_RECORD:US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies\",\"observedAt\":\"2026-09-09T12:00:00.000Z\",\"evidenceKind\":\"TYPED_READER_READ_MODEL\",\"verifierId\":\"lib/civic-data/curated-reader-read-model.ts#readCuratedReaderProjection\",\"verifierCodeSha\":\"667c533274eabe7e66b7d37b782eed10fef7654d\",\"status\":\"PASS\",\"detail\":\"The typed comment-access Reader read canonical version curated-reader-primary-sources:trusted-lkg:92dec011b269cb1dc77667f2d91018de.\"}"
    }
  ]
};

function retainedHistoricalLkg() {
  const { outcome, events } = structuredClone(RETAINED_LKG_FIXTURE);
  assert.ok(outcome.promoted);
  assert.equal(promotionProofIssue(MANUAL_RECORD_CLASS, MANUAL_SCOPE, outcome.promoted, outcome.candidate), null);
  assert.deepEqual(events.map(({ sequence }) => sequence), [1, 2, 3, 4, 5]);
  const store = new MemoryRoutineDataStore();
  Object.assign(store, {
    candidates: new Map([[outcome.candidate.candidate.id, outcome.candidate]]),
    history: new Map([[outcome.candidate.candidate.id, [...events]]]),
    promotions: new Map([[outcome.promoted.key, outcome.promoted]]),
  });
  return { store, outcome };
}

test("retired trusted-LKG doors refuse new imports while retained history remains due", async () => {
  const directStore = new MemoryRoutineDataStore();
  await assert.rejects(
    processRoutineCandidate(directStore, candidate(), FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );
  assert.equal(await directStore.readPromotion(MANUAL_RECORD_CLASS, MANUAL_SCOPE), null);

  const ordinaryRoutineStore = new MemoryRoutineDataStore();
  await assert.rejects(
    processRoutineCandidate(ordinaryRoutineStore, candidate(FIRST, "a".repeat(40), "ROUTINE"), FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
    "retained routine-source markers cannot create a new promotion",
  );
  assert.equal(await ordinaryRoutineStore.readPromotion("DOTGOV_REFERENCE", "US:current-full:election-domains"), null);
  const retiredManualStore = new MemoryRoutineDataStore();
  await assert.rejects(
    processRoutineCandidate(retiredManualStore, candidate(), FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );
  assert.equal(await retiredManualStore.readPromotion(MANUAL_RECORD_CLASS, MANUAL_SCOPE), null);
  for (const marker of [null, { kind: "TRUSTED_LKG_REATTESTATION" }]) {
    const malformed = { ...candidate(), bootstrapImport: marker } as unknown as RoutineCandidate;
    await assert.rejects(processRoutineCandidate(new MemoryRoutineDataStore(), malformed, FIRST), /TRUSTED_LKG_ADMISSION_RETIRED/);
  }


  const { store, outcome } = retainedHistoricalLkg();
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.promoted?.versionId, outcome.candidate.candidate.id);
  assert.equal(
    outcome.candidate.receipt?.checks.find((check) => check.check === "SOURCE_AUTHENTICITY")?.code,
    "TRUSTED_LKG_IMPORT_PROVENANCE_VALID",
  );
  assert.match(
    outcome.candidate.receipt?.checks.find((check) => check.check === "SOURCE_AUTHENTICITY")?.detail ?? "",
    /non-source-authenticated/i,
  );
  const clock = await store.clock(MANUAL_SOURCE_ID, MANUAL_RECORD_CLASS, MANUAL_SCOPE);
  assert.equal(clock.lastAttemptedAt, undefined, "the import is not a publisher attempt and cannot own the source retry clock");
  assert.equal(clock.lastSucceededAt, undefined, "the import cannot defer the first live publisher acquisition");

  const read = await readPromotedCivicData(MANUAL_RECORD_CLASS, MANUAL_SCOPE, {
    store,
    now: SECOND,
    bypassCache: true,
  });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.stale, "STALE", "Reader serves the LKG but never confuses it with current source truth");
});

test("trusted LKG evidence is content-bound and cannot replace an existing authority", async () => {
  const { store, outcome: first } = retainedHistoricalLkg();
  assert.ok(first.promoted);

  const replacement = candidate(SECOND, "b".repeat(40));
  await assert.rejects(
    processRoutineCandidate(store, replacement, SECOND),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );
  assert.equal(
    (await store.readPromotion(MANUAL_RECORD_CLASS, MANUAL_SCOPE))?.versionId,
    first.promoted!.versionId,
  );

  const wrongContract = candidate();
  const mismatched = {
    ...wrongContract,
    bootstrapImport: { ...wrongContract.bootstrapImport!, contractId: "campaign-sites" },
  };
  await assert.rejects(
    processRoutineCandidate(new MemoryRoutineDataStore(), mismatched, FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );

  const invalid = structuredClone(first.candidate.candidate);
  const invalidEvidence = invalid.bootstrapImport;
  assert.ok(invalidEvidence);
  if (invalidEvidence.kind !== "TRUSTED_LKG_IMPORT") assert.fail("test candidate is not a first-seed import");
  assert.equal(trustedLkgImportEvidenceIssue(invalid), null, "untampered historical evidence remains valid");
  const corrupt = {
    ...invalid,
    bootstrapImport: {
      ...invalidEvidence,
      fixtures: [{ ...invalidEvidence.fixtures[0]!, sha256: "f".repeat(64) }],
    },
  };
  assert.match(trustedLkgImportEvidenceIssue(corrupt) ?? "", /fixture-set digest does not match/, "historical evidence still rejects the exact changed fixture hash");
  await assert.rejects(
    processRoutineCandidate(new MemoryRoutineDataStore(), corrupt, FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );
});

test("Reader proof fails closed if durable trusted-LKG evidence is altered", async () => {
  const { store, outcome } = retainedHistoricalLkg();
  assert.ok(outcome.promoted);
  const altered = {
    ...outcome.candidate,
    candidate: {
      ...outcome.candidate.candidate,
      bootstrapImport: {
        ...outcome.candidate.candidate.bootstrapImport!,
        sourceAuthenticated: true,
      },
    },
  } as unknown as typeof outcome.candidate;
  assert.match(
    promotionProofIssue(MANUAL_RECORD_CLASS, MANUAL_SCOPE, outcome.promoted!, altered) ?? "",
    /trusted-LKG import evidence is invalid/i,
  );

  const exactCandidate = outcome.candidate.candidate;
  const firstRecord = exactCandidate.civicRecords?.[0];
  const firstAdded = exactCandidate.changeSet?.added[0];
  assert.ok(firstRecord && firstAdded);
  const fabricatedMemberAndDelta = {
    ...outcome.candidate,
    candidate: {
      ...exactCandidate,
      civicRecords: [
        { ...firstRecord, record: { fabricated: true } },
        ...exactCandidate.civicRecords!.slice(1),
      ],
      changeSet: {
        ...exactCandidate.changeSet!,
        added: [
          { ...firstAdded, after: { fabricated: true } },
          ...exactCandidate.changeSet!.added.slice(1),
        ],
      },
    },
  };
  assert.match(
    promotionProofIssue(
      MANUAL_RECORD_CLASS,
      MANUAL_SCOPE,
      outcome.promoted!,
      fabricatedMemberAndDelta,
    ) ?? "",
    /civic-record members do not exactly equal/i,
    "a matching fabricated member and delta cannot falsify Admin while the Reader payload stays intact",
  );

  const fabricatedDeltaOnly = {
    ...outcome.candidate,
    candidate: {
      ...exactCandidate,
      changeSet: {
        ...exactCandidate.changeSet!,
        added: [
          { ...firstAdded, after: { fabricated: true } },
          ...exactCandidate.changeSet!.added.slice(1),
        ],
      },
    },
  };
  assert.match(
    promotionProofIssue(
      MANUAL_RECORD_CLASS,
      MANUAL_SCOPE,
      outcome.promoted!,
      fabricatedDeltaOnly,
    ) ?? "",
    /change set does not exactly equal/i,
    "the durable first-pointer delta is derived evidence, not an independently mutable claim",
  );

  const fabricatedCandidateProof = {
    ...outcome.candidate,
    candidate: {
      ...exactCandidate,
      dependentChecks: exactCandidate.dependentChecks.map((check, index) => index === 0
        ? { ...check, passed: false, detail: "fabricated durable failure" }
        : check),
    },
  };
  assert.match(
    promotionProofIssue(
      MANUAL_RECORD_CLASS,
      MANUAL_SCOPE,
      outcome.promoted!,
      fabricatedCandidateProof,
    ) ?? "",
    /complete persisted candidate proof envelope/i,
    "durable candidate provenance and validator outcomes cannot change beneath an unchanged GOOD receipt",
  );

  const completeClaim = exactCandidate;
  const completeClaimWithoutUpdatedEvidence = {
    ...completeClaim,
    horizon: {
      kind: "BOUNDED" as const,
      query: "fabricated complete publisher universe",
      returnedRecords: completeClaim.normalization.outputRecords,
      declaredTotal: completeClaim.normalization.outputRecords,
      paginationComplete: true,
      claimsComplete: true,
    },
  };
  const completeClaimEvidence = {
    ...completeClaim.bootstrapImport!,
    candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(completeClaimWithoutUpdatedEvidence),
  };
  const selfConsistentCompleteClaim = {
    ...completeClaimWithoutUpdatedEvidence,
    id: trustedLkgCandidateId(completeClaimEvidence),
    bootstrapImport: completeClaimEvidence,
  };
  assert.match(
    trustedLkgImportEvidenceIssue(selfConsistentCompleteClaim) ?? "",
    /must make no publisher-universe completeness claim/i,
    "even self-consistent bootstrap evidence cannot turn a frozen snapshot into current completeness proof",
  );
});

test("Admin exposes imported LKG without claiming freshness or a source-authenticated success", async () => {
  const { store, outcome } = retainedHistoricalLkg();
  assert.ok(outcome.promoted);
  const row = outcome.candidate;
  const events = await store.events(row.candidate.id);
  const view = projectRoutineDataObservability({
    candidates: [{
      id: row.candidate.id,
      sourceId: row.candidate.sourceId,
      recordClass: row.candidate.recordClass,
      scope: row.candidate.scope,
      state: row.state,
      acquisitionSucceeded: row.acquisitionSucceeded,
      retrievedAt: row.candidate.retrieval.retrievedAt,
      sourceThrough: row.candidate.temporal.sourceThrough,
      candidate: row.candidate,
      validationReceipt: row.receipt,
      promotedVersionId: row.promotedVersion,
      lastKnownGoodVersionId: row.lastKnownGoodVersion,
      failureCode: row.failureCode,
      failureDetail: row.failureDetail,
    }],
    events: events.map((event) => ({ ...event, id: `${event.candidateId}:${event.sequence}` })),
    promotions: [{
      key: outcome.promoted!.key,
      sourceId: outcome.promoted!.sourceId,
      recordClass: outcome.promoted!.recordClass,
      scope: outcome.promoted!.scope,
      currentVersionId: outcome.promoted!.versionId,
      lastKnownGoodVersionId: outcome.promoted!.lastKnownGoodVersionId,
      promotedAt: outcome.promoted!.promotedAt,
      payload: outcome.promoted!.payload,
      validationReceipt: outcome.promoted!.receipt,
    }],
  }, SECOND, [requiredManualProductionContract(MANUAL_CONTRACT_ID)]);
  const observed = view.contracts[0];
  assert.equal(observed.canonicalPromotion.kind, "MEASURED");
  if (observed.canonicalPromotion.kind === "MEASURED") {
    assert.equal(observed.canonicalPromotion.value.authorityOrigin, "TRUSTED_LKG_IMPORT");
  }
  assert.equal(observed.cadence.freshness, "STALE", "the imported LKG remains explicitly stale");
  assert.equal(observed.cadence.operationalState, "UNKNOWN", "an owner-invoked source has no fabricated routine clock");
  assert.equal(observed.lastSuccessfulAcquisition.kind, "NOT_RECORDED");
  assert.equal(observed.histories["24h"].counts.successfulAcquisitions.kind, "MEASURED");
  assert.equal(observed.histories["24h"].counts.successfulAcquisitions.value, 0);
  assert.equal(observed.histories["24h"].attempts[0]?.authorityOrigin, "TRUSTED_LKG_IMPORT");
  assert.equal(observed.lkg.kind, "MEASURED");
  if (observed.lkg.kind === "MEASURED") {
    assert.equal(observed.lkg.value.state, "TRUSTED_LKG_IMPORT");
    assert.equal(observed.lkg.value.currentlyServing, true);
  }
  assert.equal(view.summary.healthy.kind, "MEASURED");
  assert.equal(view.summary.stale.kind, "MEASURED");
  assert.equal(view.summary.lkgServing.kind, "MEASURED");
  if (view.summary.healthy.kind === "MEASURED") assert.equal(view.summary.healthy.value, 0);
  if (view.summary.stale.kind === "MEASURED") assert.equal(view.summary.stale.value, 1);
  if (view.summary.lkgServing.kind === "MEASURED") assert.equal(view.summary.lkgServing.value, 1);
});

function withLiveAttempt(store: MemoryRoutineDataStore, template: CandidateVersionRecord, id: string, at: string): void {
  const { bootstrapImport: _import, ...live } = structuredClone(template.candidate);
  const rows = store as unknown as {
    candidates: Map<string, CandidateVersionRecord>;
    history: Map<string, CandidateEvent[]>;
  };
  rows.candidates.set(id, {
    ...structuredClone(template),
    candidate: { ...live, id },
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: null,
    promotedVersion: null,
    failureCode: "SOURCE_BLOCKED",
    failureDetail: "the live read was refused",
  });
  rows.history.set(id, [{ candidateId: id, sequence: 1, state: "FETCHED", at, detail: "attempted" }]);
}

test("a failed live read after a trusted-LKG import waits its retry clock; an earlier attempt never postpones the first live read", async () => {
  const { store, outcome } = retainedHistoricalLkg();
  const importedAt = outcome.promoted!.promotedAt;
  const retry = { retryMs: 60 * 60 * 1000 } as RoutineSourceTask;

  withLiveAttempt(store, outcome.candidate, "live-before-import", "2026-09-09T11:00:00.000Z");
  assert.ok(Date.parse("2026-09-09T11:00:00.000Z") < Date.parse(importedAt));
  const beforeImport = await store.clock(MANUAL_SOURCE_ID, MANUAL_RECORD_CLASS, MANUAL_SCOPE);
  assert.deepEqual(beforeImport, {}, "an attempt older than the import does not delay the first live read");
  assert.equal(routineTaskDue(retry, beforeImport, Date.parse(SECOND)), true);

  withLiveAttempt(store, outcome.candidate, "live-after-import", SECOND);
  const afterImport = await store.clock(MANUAL_SOURCE_ID, MANUAL_RECORD_CLASS, MANUAL_SCOPE);
  assert.deepEqual(afterImport, { lastAttemptedAt: SECOND }, "the failed live read is the attempt");
  assert.equal(routineTaskDue(retry, afterImport, Date.parse(SECOND) + 5 * 60 * 1000), false, "the next pass does not re-fetch");
  assert.equal(routineTaskDue(retry, afterImport, Date.parse(SECOND) + retry.retryMs), true, "the retry clock owns the next attempt");
});

test("the trusted-LKG import clock counts only attempts strictly after the import's pointer move", () => {
  const importedAt = "2026-09-14T04:24:22.927Z";
  assert.deepEqual(trustedLkgImportClock(undefined, importedAt), {});
  assert.deepEqual(trustedLkgImportClock("2026-09-14T04:24:22.927Z", importedAt), {}, "the import's own instant is not an attempt");
  assert.deepEqual(trustedLkgImportClock("2026-09-14T04:00:00.000Z", importedAt), {});
  assert.deepEqual(
    trustedLkgImportClock("2026-09-24T05:15:59.400Z", importedAt),
    { lastAttemptedAt: "2026-09-24T05:15:59.400Z" },
  );
  assert.deepEqual(trustedLkgImportClock("not a time", importedAt), {}, "an unreadable attempt decides nothing");
  assert.deepEqual(trustedLkgImportClock("2026-09-24T05:15:59.400Z", "not a time"), {}, "an unreadable import time decides nothing");
});

test("an import is read whole by its proof: its evidence binds the complete envelope", async () => {
  const { store, outcome } = retainedHistoricalLkg();
  assert.ok(outcome.promoted);
  const whole = outcome.candidate;
  const narrowed = await store.readCandidateProof(whole.candidate.id);
  assert.ok(narrowed);
  assert.deepEqual(narrowed, whole, "the envelope hash covers every field, identities included");
  const decide = (record: typeof whole) => promotionProofIssue(MANUAL_RECORD_CLASS, MANUAL_SCOPE, outcome.promoted!, record);
  assert.equal(decide(narrowed), null);
  const tampers: readonly ((record: typeof whole) => typeof whole)[] = [
    (record) => ({ ...record, candidate: { ...record.candidate, readModel: { tampered: true } } }) as typeof whole,
    (record) => ({ ...record, candidate: { ...record.candidate, normalizedPayload: { tampered: true } } }) as typeof whole,
    (record) => ({ ...record, candidate: { ...record.candidate, civicRecords: [] } }) as typeof whole,
    (record) => ({ ...record, candidate: { ...record.candidate, changeSet: undefined } }) as unknown as typeof whole,
    (record) => ({ ...record, state: "VALIDATED" }) as typeof whole,
  ];
  for (const tamper of tampers) {
    const issue = decide(tamper(whole));
    assert.ok(issue, "the whole row refuses the tamper");
    assert.equal(decide(tamper(narrowed)), issue);
  }
  const read = await readPromotedCivicData(MANUAL_RECORD_CLASS, MANUAL_SCOPE, { store, bypassCache: true, now: SECOND });
  assert.equal(read.kind, "PROMOTED", "the Reader proves an import through the narrowed door");
});
