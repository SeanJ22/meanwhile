import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MEETING_PARTITION_CONTRACTS,
  observableRoutineContracts,
} from "../lib/civic-data/meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  deploymentBoundaryIssue,
  postDeploymentAttemptEvidenceIssue,
  postDeploymentGoodEvidenceIssue,
  routineLiveAcceptanceDisposition,
  routineLiveAcceptanceStateIssue,
} from "../lib/civic-data/live-acceptance.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import {
  pdc12CanaryAuthorityIssue,
  pdc12CanaryRequestIssue,
  redactPdc12CanaryChildError,
} from "../scripts/routine-civic-data-live-canary-child.mts";

const source = readFileSync("scripts/routine-civic-data-live-acceptance.mts", "utf8");
const childSource = readFileSync("scripts/routine-civic-data-live-canary-child.mts", "utf8");
const readerClosureSource = readFileSync("scripts/reader-last-mile-census.mts", "utf8");
const packageScripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
const targets = source.slice(
  source.indexOf("const targets:"),
  source.indexOf("const results:"),
);

test("terminal Reader production authority is a post-evidence gate, not a circular dependency inside the clean detached live harness", () => {
  assert.doesNotMatch(source, /reader-last-mile-final-closure-receipt/);
  assert.match(readerClosureSource, /Fresh Reader closure requires --authority-evidence/);
  assert.match(readerClosureSource, /--require-authority-phase/);
  assert.match(readerClosureSource, /validateReaderProductionClosureReceipt/);
  assert.match(readerClosureSource, /readerExecutionAuthorityLiveProblems/);
  assert.match(readerClosureSource, /createNeonReaderAuthoritySql\(productionReadConnection\)/);
  assert.match(packageScripts["reader:production-closure"], /--require-authority-phase PRODUCTION/);
  assert.match(packageScripts["reader:production-closure"], /reader-last-mile-final-closure-receipt\.json/);
});

test("PDC-12 acceptance covers each non-meeting contract and enumerates every exact meeting partition", () => {
  const expected = [
    ["FEC", "FEC_FUNDING", "federal-supported"],
    ["STATE_LEGISLATOR", "STATE_LEGISLATOR", "US-NH"],
    ["CENSUS_REFERENCE", "CENSUS_REFERENCE", "acs-population"],
    ["BALLOT_FILING", "BALLOT_FILING", "US-NJ:county:morris:2026-general"],
    ["DOTGOV_REFERENCE", "DOTGOV_REFERENCE", "US:current-full:election-domains"],
  ] as const;

  for (const [name, recordClass, scope] of expected) {
    assert.equal((targets.match(new RegExp(`name: "${name}"`, "g")) ?? []).length, 1, `${name} target must appear exactly once`);
    assert.match(targets, new RegExp(`recordClass: "${recordClass}"[\\s\\S]{0,80}scope: "${scope.replaceAll(":", "\\:")}"`));
  }
  for (const [name, contractId, scope] of [
    ["AZ_STATE_LEGISLATOR", "az-state-legislators", "US-AZ"],
    ["NJ_STATE_LEGISLATOR", "nj-state-legislators", "US-NJ"],
    ["NH_STATE_ROLL_CALL", "nh-state-rollcalls", "US-NH"],
    ["NJ_STATE_ROLL_CALL", "nj-state-rollcalls", "US-NJ"],
  ]) {
    assert.match(targets, new RegExp(`name: "${name}"[\\s\\S]{0,100}contractId: "${contractId}"[\\s\\S]{0,100}scope: "${scope}"`));
  }
  assert.match(targets, /name: "AZ_STATE_ROLL_CALL"[\s\S]{0,100}contractId: "az-state-rollcalls"[\s\S]{0,100}scope: "US-AZ"/);
  assert.match(targets, /recordClass: "STATE_LEGISLATOR"/);
  assert.match(targets, /readOfficialStateLegislatorsProjection\("US-AZ", \{ store, bypassCache: true \}\)/);
  assert.match(targets, /readOfficialStateLegislatorsProjection\("US-NJ", \{ store, bypassCache: true \}\)/);
  assert.match(targets, /recordClass: "STATE_ROLL_CALL"/);
  for (const scope of ["US-AZ", "US-NH", "US-NJ"]) {
    assert.match(targets, new RegExp(`readOfficialStateVotesProjection\\("${scope}", \\{ store, bypassCache: true \\}\\)`));
  }
  assert.match(targets, /\.\.\.MEETING_PARTITION_CONTRACTS\.flatMap\(\(partition\): AcceptanceTarget\[\]/);
  assert.match(targets, /contractId: partition\.id/);
  assert.match(targets, /scope: partition\.scope/);
  assert.match(targets, /read\.partitions\.find\(\(\{ contractId \}\) => contractId === partition\.id\)/);
  assert.ok(MEETING_PARTITION_CONTRACTS.length > 100);
  assert.doesNotMatch(source, /supported-bodies/);
  assert.match(source, /requiredAssignment\(process\.argv, "meetings-version-manifest"/);
  assert.match(source, /requiredAssignment\(process\.argv, "deployment-completed-at"/);
  assert.match(source, /meetingManifest: meetingManifest\.deploymentCompletedAt/);
  assert.match(source, /parsed\.formatVersion !== 2/);
  assert.match(source, /deploymentCompletedAt/);
  assert.match(source, /PROMOTED_TWO_GOOD/);
  assert.match(source, /AUTHENTICATED_EMPTY_ATTEMPT/);
  assert.match(source, /HELD_LKG_ATTEMPT/);
  assert.match(source, /byId\.size !== expectedIds\.size/);
});

test("PDC-12 live-attempt denominator is exactly the 134 routine contracts and never counts a trusted manual transfer", () => {
  const routine = observableRoutineContracts();
  assert.equal(routine.length, 134);
  assert.equal(MANUAL_PRODUCTION_SOURCE_CONTRACTS.length, 23);
  assert.ok(MANUAL_PRODUCTION_SOURCE_CONTRACTS.every(({ execution }) => execution === "EXPLICIT_OWNER_INVOCATION_ONLY"));
  assert.equal(
    new Set([
      ...routine.map(({ id }) => id),
      ...MANUAL_PRODUCTION_SOURCE_CONTRACTS.map(({ id }) => id),
    ]).size,
    routine.length + MANUAL_PRODUCTION_SOURCE_CONTRACTS.length,
  );
  assert.match(source, /const routineDenominatorIds = observableRoutineContracts\(\)\.map/);
  assert.match(source, /\.\.\.expectedMeetingVersions\.keys\(\)/);
  assert.match(source, /PDC-12 live evidence must account for every and only canonical routine contract/);
  assert.match(source, /their deliberately non-source-authenticated trusted imports must never be/);
  assert.doesNotMatch(source, /MANUAL_PRODUCTION_SOURCE_CONTRACTS/);
});

test("promotable state rosters and bounded NH/NJ rolls require GOOD live proof while unavailable AZ rolls remain fail closed", () => {
  const heldIds = new Set([
    "az-state-rollcalls",
  ]);
  for (const contract of ROUTINE_SOURCE_CONTRACTS) {
    const disposition = routineLiveAcceptanceDisposition(contract);
    assert.equal(
      disposition.kind,
      heldIds.has(contract.id) ? "AUTHENTICATED_FAIL_CLOSED_ATTEMPT" : "POST_DEPLOY_NEW_GOOD",
      contract.id,
    );
    if (heldIds.has(contract.id)) {
      assert.equal(routineLiveAcceptanceStateIssue(contract, "SOURCE_BLOCKED"), null);
      assert.equal(routineLiveAcceptanceStateIssue(contract, "HORIZON_UNRESOLVED"), null);
      assert.match(routineLiveAcceptanceStateIssue(contract, "PROMOTED") ?? "", /NOT_ALLOWED/);
    }
  }
  for (const contractId of ["az-state-legislators", "nj-state-legislators", "nh-state-rollcalls", "nj-state-rollcalls"]) {
    const contract = ROUTINE_SOURCE_CONTRACTS.find(({ id }) => id === contractId);
    assert.ok(contract);
    assert.equal(routineLiveAcceptanceDisposition(contract).kind, "POST_DEPLOY_NEW_GOOD");
  }
  assert.match(source, /lkg === "NOT_RECORDED" \? null : lkg/);
  assert.match(source, /trusted import cannot count as a live source attempt/);
  assert.match(source, /pointer, null, `\$\{target\.name\}: expectation says NOT_RECORDED/);
  assert.match(source, /fail-closed attempt moved the canonical pointer/);
});

test("a held or unavailable live attempt must be a canonical post-deploy event", () => {
  const boundary = "2026-09-09T12:00:00.000Z";
  assert.equal(postDeploymentAttemptEvidenceIssue({
    contractId: "az-state-rollcalls",
    deploymentCompletedAt: boundary,
    attemptedAt: boundary,
  }), null);
  assert.equal(postDeploymentAttemptEvidenceIssue({
    contractId: "az-state-rollcalls",
    deploymentCompletedAt: boundary,
    attemptedAt: "2026-09-09T11:59:59.999Z",
  }), "az-state-rollcalls:ATTEMPT_PREDATES_DEPLOYMENT");
});

test("PDC-12 uses one canonical, non-future deployment boundary for the whole denominator", () => {
  const boundary = "2026-09-09T12:00:00.000Z";
  assert.equal(deploymentBoundaryIssue({ requested: boundary, meetingManifest: boundary, nowMs: Date.parse(boundary) }), null);
  assert.equal(
    deploymentBoundaryIssue({
      requested: "2026-09-09T12:00:01.000Z",
      meetingManifest: "2026-09-09T12:00:01.000Z",
      nowMs: Date.parse(boundary),
    }),
    "DEPLOYMENT_COMPLETED_AT_IS_FUTURE",
  );
  assert.equal(
    deploymentBoundaryIssue({ requested: boundary, meetingManifest: "2026-09-09T12:00:00Z", nowMs: Date.parse(boundary) }),
    "MEETING_MANIFEST_DEPLOYMENT_COMPLETED_AT_NOT_CANONICAL_ISO",
  );
  assert.equal(
    deploymentBoundaryIssue({
      requested: boundary,
      meetingManifest: "2026-09-09T11:59:59.000Z",
      nowMs: Date.parse(boundary),
    }),
    "DEPLOYMENT_COMPLETED_AT_DISAGREES_WITH_MEETING_MANIFEST",
  );
});

test("PDC-12 refuses a pre-boundary durable GOOD attempt or promotion for every non-meeting source", () => {
  const deploymentCompletedAt = "2026-09-09T12:00:00.000Z";
  const contracts = ["fec-funding", "nh-members", "az-state-legislators", "nj-state-legislators", "az-state-rollcalls", "nh-state-rollcalls", "nj-state-rollcalls", "census-acs-population", "nj-morris-filing", "dotgov"];
  for (const contractId of contracts) {
    assert.equal(
      postDeploymentGoodEvidenceIssue({
        contractId,
        deploymentCompletedAt,
        attemptedAt: "2026-09-09T11:59:59.999Z",
        promotedAt: "2026-09-09T12:00:00.001Z",
      }),
      `${contractId}:ATTEMPT_PREDATES_DEPLOYMENT`,
    );
    assert.equal(
      postDeploymentGoodEvidenceIssue({
        contractId,
        deploymentCompletedAt,
        attemptedAt: "2026-09-09T12:00:00.001Z",
        promotedAt: "2026-09-09T11:59:59.999Z",
      }),
      `${contractId}:PROMOTION_PREDATES_DEPLOYMENT`,
    );
  }
  assert.doesNotMatch(source, /target\.recordClass\s*!==\s*"MEETING"/);
  assert.match(source, /postDeploymentGoodEvidenceIssue\(\{/);
  assert.match(source, /deploymentCompletedAt,/);
  assert.match(source, /attemptedAt: attemptEvent!\.at/);
  assert.doesNotMatch(source, /attemptedAt: valid\.candidate\.retrieval\.retrievedAt/);
});

test("PDC-12 accepts no fabricated GOOD/LKG for genuinely empty meeting partitions", () => {
  assert.match(source, /attempt\.state, "CANNOT_TELL"/);
  assert.match(source, /attempt\.failureCode, "ZERO_IS_NOT_ABSENCE"/);
  assert.match(source, /attempt\.lastKnownGoodVersion, null/);
  assert.match(source, /store\.readPromotion\("MEETING", partition\.scope\), null/);
  assert.match(source, /AUTHORITY_AND_RAW_PROVENANCE_VALID/);
  assert.match(source, /events\.map\(\(\{ state \}\) => state\), \["FETCHED", "NORMALIZED", "CANNOT_TELL"\]/);
  assert.match(source, /everyPartitionHasPostDeployAttempt: true/);
  assert.match(source, /classHasSourceAuthenticatedPromotion: true/);
});

test("PDC-12 accepts an exact post-deploy refusal only when its pointer, payload, and LKG remain live", () => {
  assert.match(source, /attempt\.lastKnownGoodVersion, expectation\.lkg/);
  assert.match(source, /pointer\.versionId, expectation\.lkg/);
  assert.match(source, /pointer\.lastKnownGoodVersionId, expectation\.lkg/);
  assert.match(source, /pointer\.payload, lkg\.candidate\.readModel/);
  assert.match(source, /attempt\.promotedVersion, null/);
  assert.match(source, /events\.at\(-1\)\?\.state, attempt\.state/);
  assert.match(source, /clock\.lastAttemptedAt, firstEvent\.at/);
  assert.match(source, /typed Reader serves a version other than the exact held LKG/);
  assert.match(source, /lkgIsBootstrap \? undefined : lkg\.candidate\.retrieval\.retrievedAt/);
  assert.match(source, /heldMeetingLkgAttempts/);
  assert.match(source, /lkgIsTrustedImport/);
});

test("PDC-12 acceptance uses six materially different refusal families", () => {
  const refusals = [
    ["PARSE_INVALID", "PARSER_FAILED"],
    ["IDENTITY_UNRESOLVED", "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE"],
    ["TEMPORAL_INVALID", "WRONG_PERIOD_OR_VINTAGE"],
    ["SEMANTIC_INVALID", "SEMANTIC_CONTRACT_VIOLATION"],
    ["HORIZON_UNRESOLVED", "COMPLETE_UNIVERSE_UNBOUNDED"],
    ["DEPENDENT_CONSUMER_INVALID", "DEPENDENT_CONSUMER_REJECTED"],
  ] as const;

  for (const [state, code] of refusals) {
    assert.match(targets, new RegExp(`expectedInvalidState: "${state}"[\\s\\S]{0,100}expectedFailureCode: "${code}"`));
  }
  assert.equal(new Set(refusals.map(([state]) => state)).size, 6);
  assert.match(source, /invalidCanaryTargets\.length,\s*6/);
  assert.match(source, /new Set\(invalidCanaryTargets\.map\(\(\{ expectedInvalidState \}\) => expectedInvalidState\)\)\.size,\s*6/);
});

test("PDC-12 coordinator delegates each mutation to one exact normal contract child", () => {
  assert.doesNotMatch(source, /processRegistered(?:MeetingPartition)?RoutineCandidate|recordRegisteredSourceAcquisitionFailure/);
  assert.doesNotMatch(source, /resolveProductionWriteHandle|prepareProductionCivicDataWrite|assertWriteAllowed/);
  assert.match(source, /process\.env\.DATABASE_URL = readonlyConnection/);
  assert.match(source, /capability:\s*"ROUTINE_CONTRACT"/);
  assert.match(source, /contract:\s*contractId/);
  assert.match(source, /parentPid:\s*process\.pid/);
  assert.match(source, /receipt\.authorityContract, contractId/);
  assert.match(childSource, /assertRuntimeAuthority\(\{ capabilities: \["ROUTINE_CONTRACT"\], contract: request\.contractId \}\)/);
  assert.doesNotMatch(childSource, /TRUSTED_LKG_IMPORT/);
  assert.ok(
    childSource.indexOf('assertRuntimeAuthority({ capabilities: ["ROUTINE_CONTRACT"]') <
      childSource.indexOf("prepareProductionCivicDataWrite();"),
    "the child opens production before exact checkout/parent/contract authority is proved",
  );
});

test("PDC-12 canary request and authority refuse a cross-contract capability", () => {
  const request = {
    contractId: "fec-funding",
    kind: "PARSER_INVALID",
    expectedVersionId: "fec-good-version",
  } as const;
  assert.equal(pdc12CanaryRequestIssue(request), null);
  assert.equal(
    pdc12CanaryRequestIssue({ ...request, kind: "IDENTITY_INVALID" }),
    "PDC12_CANARY_KIND_CONTRACT_MISMATCH",
  );
  const baseEnvelope = {
    repo: process.cwd(),
    sha: "a".repeat(40),
    capability: "ROUTINE_CONTRACT" as const,
    contract: request.contractId,
    parentPid: 42,
    nonce: "b".repeat(64),
  };
  assert.equal(pdc12CanaryAuthorityIssue(request, baseEnvelope), null);
  assert.equal(
    pdc12CanaryAuthorityIssue(request, { ...baseEnvelope, contract: "nh-members" }),
    "PDC12_CANARY_AUTHORITY_CONTRACT_MISMATCH",
  );
  assert.equal(
    pdc12CanaryAuthorityIssue(request, { ...baseEnvelope, capability: "ROUTINE_SUPERVISOR", contract: null }),
    "PDC12_CANARY_AUTHORITY_NOT_ROUTINE_CONTRACT",
  );
});

test("PDC-12 one-contract child redacts write credentials from a refused result", () => {
  const secret = "postgresql://pdc_owner:do-not-print@example.invalid/civic";
  const safe = redactPdc12CanaryChildError(
    new Error(`connection refused at ${secret}; password=also-do-not-print`),
    { WTP_PRODUCTION_DATABASE_URL_WRITE: secret },
  );
  assert.doesNotMatch(safe, /pdc_owner|do-not-print|also-do-not-print/);
  assert.match(safe, /\[REDACTED_DATABASE_URL\]/);
  assert.doesNotMatch(redactPdc12CanaryChildError("first\nsecond"), /[\r\n]/);
  assert.match(childSource, /console\.error\(`PDC12_CANARY_CHILD_REFUSED:\$\{redactPdc12CanaryChildError\(error\)\}`\)/);
  assert.match(source, /const detail = redactPdc12CanaryChildError\(`/);
});

test("PDC-12 reads every promoted meeting partition but injects only one representative semantic canary", () => {
  assert.match(source, /meetingSemanticCanaryContractId/);
  assert.match(source, /injectInvalidCanary: partition\.id === meetingSemanticCanaryContractId/);
  assert.match(source, /if \(!target\.injectInvalidCanary\)/);
  assert.match(source, /NOT_INJECTED_VALIDATION_FAMILY_ALREADY_PROVEN/);
  assert.match(source, /deliberatelyRefusedMeetingPartitions: 1/);
  assert.doesNotMatch(source, /MEETING_PARTITION_CONTRACTS\.flatMap[\s\S]{0,1200}injectInvalidCanary: true/);
});

test("PDC-12 verifies every typed Reader family and explicitly treats dotgov as non-Reader", () => {
  assert.equal((targets.match(/kind: "READER"/g) ?? []).length, 10);
  assert.equal((targets.match(/kind: "NON_READER"/g) ?? []).length, 1);
  assert.match(targets, /readMeetingsProjection\(\{ store, bypassCache: true \}\)/);
  assert.match(targets, /readNjMorrisFiling\(\{ store, bypassCache: true \}\)/);
  assert.match(targets, /readOfficialStateLegislatorsProjection\("US-AZ", \{ store, bypassCache: true \}\)/);
  assert.match(targets, /readOfficialStateLegislatorsProjection\("US-NJ", \{ store, bypassCache: true \}\)/);
  assert.match(targets, /readOfficialStateVotesProjection\("US-NH", \{ store, bypassCache: true \}\)/);
  assert.match(targets, /readOfficialStateVotesProjection\("US-NJ", \{ store, bypassCache: true \}\)/);
  assert.match(targets, /DOTGOV_REFERENCE has no Reader projection; acceptance is durable pointer\/receipt only\./);
});

test("PDC-12 accepts only the latest append-only Reader readback for the current version", () => {
  assert.match(source, /filter\(\(event\) => isReaderProjectionReadbackDetail\(event\.detail\)\)/);
  assert.match(source, /sort\(\(left, right\) => right\.sequence - left\.sequence/);
  assert.match(source, /parseReaderProjectionReadback\(readbackEvent\.detail\)/);
  assert.match(source, /receipt\.contractId, task\.id/);
  assert.match(source, /receipt\.versionId, before\.versionId/);
  assert.match(source, /receipt\.projectionId, task\.contract\.readerProjection\.id/);
  assert.match(source, /receipt\.observedAt, readbackEvent\.at/);
  assert.doesNotMatch(source, /flatMap\(\(event\)[\s\S]{0,240}\.find\(\(item\)/);
});

test("PDC-12 proves authenticated promotion durability and exact LKG hold without claiming external closure", () => {
  assert.match(source, /AUTHORITY_AND_RAW_PROVENANCE_VALID/);
  assert.match(source, /store\.events\(valid\.candidate\.id\)/);
  assert.match(source, /store\.readCandidate\(canary\.candidateId\)/);
  assert.match(source, /normalizedHash\(after\.payload\), normalizedHash\(before\.payload\)/);
  assert.match(source, /after\.lastKnownGoodVersionId, before\.lastKnownGoodVersionId/);
  assert.match(source, /PDC12_INVALID_LKG_CANARY=/);
  assert.match(source, /externalReleaseEvidence:\s*"REQUIRED_SEPARATELY"/);
  assert.match(source, /deployedAppShaEvidence:\s*\{/);
  assert.match(source, /production app SHA changed while PDC-12 data-plane canaries ran/);
  assert.doesNotMatch(source, /pdc12Complete:/);
  assert.doesNotMatch(source, /RCD-?10|rcd10/i);
});

test("PDC-12 proves a pre-byte source outage is durable, isolated, and retry-backed", () => {
  assert.match(childSource, /recordRegisteredSourceAcquisitionFailure/);
  assert.match(childSource, /sourceAcquisitionFailure\(\s*"PUBLISHER_UNAVAILABLE"/);
  assert.match(source, /sourceFailureReceipt\.state, "SOURCE_BLOCKED"/);
  assert.match(source, /store\.readCandidate\(sourceFailureReceipt\.candidateId\)/);
  assert.match(source, /source outage changed canonical dotgov LKG/);
  assert.match(source, /routineTaskDue\(sourceFailureTask, sourceFailureClock, attemptedMs \+ sourceFailureTask\.retryMs - 1\)/);
  assert.match(source, /routineTaskDue\(sourceFailureTask, sourceFailureClock, attemptedMs \+ sourceFailureTask\.retryMs\)/);
  assert.match(source, /promotionEngineIsolationAfterInjectedSourceFailure/);
  assert.match(source, /unaffectedContractsVerified: Object\.keys\(results\)/);
  assert.match(source, /standingRunnerSameCycleEvidence:\s*"REQUIRED_SEPARATELY/);
  assert.doesNotMatch(source, /unaffectedContractsStillProcessed/);
  assert.ok(
    source.indexOf("const sourceFailureReceipt = runCanaryChild(") > source.indexOf("for (const target of targets)"),
    "the retry-backed source outage must be the final data-plane mutation so Admin cannot be left showing a later synthetic refusal",
  );
  assert.ok(
    source.indexOf("const sourceFailureReceipt = runCanaryChild(") > source.indexOf("target.canaryKind"),
    "every validation-family canary must precede the terminal source-outage proof",
  );
  assert.ok(
    source.indexOf("const servedAfterCanaries") > source.indexOf("const sourceFailureReceipt = runCanaryChild("),
    "the unchanged deployed-SHA readback must include the final source-outage mutation",
  );
});
