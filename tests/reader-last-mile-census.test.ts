import { isRenderable, stateMoneyRecordsForDisplay } from "../lib/funding/state-money-reader.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { applyReaderApplicability, ballotAbsenceAuthorityRelation, buildReaderCensus, canonicalReaderAuthorityJson, classifyReaderEligibility, compareFrozenBodyRosterAuthority, compareFrozenBodyRosterAuthorityUniverse, compareFrozenOfficeholderStatementAuthority, composeReaderComponentProofs, datasetSurfaceCoverageProblems, importReachability, inspectReaderMarkup, packReaderEvidence, readReaderEvidence, reconcileDelivery, sha256, stateMoneyAuthorityRelation, type CensusRow, type EligibilityFacts, type ReaderDeliveryProof, type ReaderCensus, type ReaderProjectionReport, type ReaderSurfaceClassWitness } from "../lib/holdings/reader-census.ts";
import { type StateMoneyRecord } from "../lib/funding/state-money.ts";
import { stateMoneyForTarget, resetStateMoneyCache } from "../lib/funding/state-snapshot.ts";
import { currentOfficeholderStatements } from "../lib/corpus/data-plane.ts";
import { currentBodyRosters, currentRosterMemberReaderDisposition } from "../lib/registry/body-rosters.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { proveVotingSites } from "../scripts/reader-last-mile-voting-sites.mts";
import { registerReaderRenderHooks } from "../lib/holdings/reader-census.ts";
import { readerSourceFingerprint, readerSourceHashProblems } from "../lib/holdings/reader-census.ts";
import { ballotHolderObligationFailures } from "../lib/holdings/reader-census.ts";
import { isKnownLegacyReaderClosureReceipt, readerClosureExecutionAuthorityEvidenceProblems, readerClosureExecutionAuthorityProblems, readerClosureReadConnectionIdentity, validateReaderClosureReceipt, type ReaderClosureExecutionAuthorityEvidence, type ReaderClosureReceipt } from "../lib/holdings/reader-census.ts";
import { readerAcquisitionBoundaryProblems } from "../lib/holdings/reader-census.ts";
import { ballotQualificationFailures, type BallotQualificationObligation } from "../lib/holdings/reader-census.ts";
import { sourceEolEquivalenceProblems, type ReaderSourceEolEquivalence } from "../lib/holdings/reader-census.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
import ts from "typescript";
import { PDC_NEON_PROJECT_ID, PDC_PRODUCTION_BRANCH_ID, readerAuthorityIdentityHash } from "../lib/holdings/reader-execution-authority.ts";

await installRegistryRuntimeFirstSeeds();

const canonical: EligibilityFacts = { held: true, source: "CANONICAL_READER_SNAPSHOT", relationship: "CANONICAL_READER_RECORD", identity: "RESOLVED" };
const staged: EligibilityFacts = { ...canonical, source: "AUTONOMOUS_STAGING", relationship: "ACQUISITION_INPUT" };

const authorityHash = (character: string) => character.repeat(64);
const authorityHead = "a".repeat(40);
const authorityProductionHead = "b".repeat(40);
function authorityEvidence(phase: "REHEARSAL" | "PRODUCTION"): ReaderClosureExecutionAuthorityEvidence {
  const slug = phase.toLowerCase();
  return {
    formatVersion: 1,
    phase,
    exactHead: phase === "PRODUCTION" ? authorityProductionHead : authorityHead,
    store: {
      kind: "NEON_POSTGRES",
      authority: phase === "REHEARSAL" ? "ISOLATED_PRODUCTION_CLONE" : "STANDING_PRODUCTION",
      projectIdentitySha256: readerAuthorityIdentityHash("project", PDC_NEON_PROJECT_ID),
      branchIdentitySha256: phase === "PRODUCTION" ? readerAuthorityIdentityHash("branch", PDC_PRODUCTION_BRANCH_ID) : authorityHash("2"),
      endpointIdentitySha256: authorityHash("3"),
      databaseIdentitySha256: authorityHash("4"),
      schemaIdentitySha256: authorityHash("5"),
      providerMetadataPath: `docs/evidence/reader-last-mile-${slug}-provider-metadata.json`,
      providerMetadataSha256: authorityHash("c"),
    },
    readOnly: {
      roleIdentitySha256: authorityHash("6"),
      roleWritePrivilegesRefused: true,
      attemptedWriteRefused: true,
      roleSuperuser: false,
      roleCreateRole: false,
      roleCreateDatabase: false,
      roleReplication: false,
      roleBypassRls: false,
      databaseCreate: false,
      schemaCreate: false,
      relationOwnershipCount: 0,
      columnWritePrivilegeCount: 0,
      sequenceWritePrivilegeCount: 0,
      writeCapableMemberRoleCount: 0,
      executableSecurityDefinerFunctionCount: 0,
      relations: [
        { relation: "public.civic_data_candidate_events", select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
        { relation: "public.civic_data_candidates", select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
        { relation: "public.civic_data_promotions", select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
      ],
    },
    import: {
      importerCodeSha: authorityHead,
      receiptPath: `docs/evidence/reader-last-mile-${slug}-import-receipt.json`,
      receiptSha256: authorityHash("7"),
      resultSha256: authorityHash("f"),
      dispositionSetSha256: authorityHash("1"),
      canonicalPointerSetSha256: authorityHash("8"),
      canonicalPointerCount: 157,
      durableImport: {
        authorization: "PDC_V2_FROZEN_LKG_CUTOVER",
        candidateCount: 95,
        currentPointerLinkCount: 95,
        promotedDispositionCount: 91,
        reattestedDispositionCount: 7,
        skippedDispositionCount: 4,
        candidateSetSha256: authorityHash("d"),
        eventCandidateCount: 95,
        eventCount: 475,
        terminalPromotedEventCount: 95,
        eventSetSha256: authorityHash("e"),
        predecessorCandidateCount: 7,
        predecessorEventCount: 35,
        predecessorEventSetSha256: authorityHash("9"),
        importerCodeShas: [authorityHead],
      },
    },
    clone: phase === "REHEARSAL" ? {
      parentProductionBranchIdentitySha256: readerAuthorityIdentityHash("branch", PDC_PRODUCTION_BRANCH_ID),
      sourceSnapshotSha256: authorityHash("a"),
      controlPlaneReceiptSha256: authorityHash("b"),
    } : null,
  };
}

test("Reader execution authority labels an isolated child rehearsal without letting it masquerade as terminal production", () => {
  const rehearsal = authorityEvidence("REHEARSAL");
  assert.deepEqual(readerClosureExecutionAuthorityEvidenceProblems(rehearsal, {
    phase: "REHEARSAL",
    provedHead: authorityHead,
    importerIsAncestor: true,
  }), []);
  assert.ok(readerClosureExecutionAuthorityEvidenceProblems(rehearsal, {
    phase: "REHEARSAL",
    provedHead: authorityHead,
    importerIsAncestor: true,
    requiredPhase: "PRODUCTION",
  }).some((failure) => failure.includes("requires PRODUCTION")));

  const relabeled = { ...rehearsal, phase: "PRODUCTION" as const };
  const relabeledProblems = readerClosureExecutionAuthorityEvidenceProblems(relabeled, {
    phase: "PRODUCTION",
    provedHead: authorityHead,
    importerIsAncestor: true,
    requiredPhase: "PRODUCTION",
  });
  assert.ok(relabeledProblems.some((failure) => failure.includes("standing production store")));
  assert.ok(relabeledProblems.some((failure) => failure.includes("rehearsal clone claim")));

  const production = authorityEvidence("PRODUCTION");
  assert.deepEqual(readerClosureExecutionAuthorityEvidenceProblems(production, {
    phase: "PRODUCTION",
    provedHead: authorityProductionHead,
    importerIsAncestor: true,
    requiredPhase: "PRODUCTION",
  }), []);

  assert.ok(readerClosureExecutionAuthorityEvidenceProblems({ ...production, plantedSecret: "postgresql://owner:password@db.example/civic" }, {
    phase: "PRODUCTION", provedHead: authorityProductionHead, importerIsAncestor: true,
  }).some((failure) => failure.includes("credential-bearing") || failure.includes("fields differ")), "a planted connection secret cannot enter committed authority evidence");
  assert.ok(readerClosureExecutionAuthorityEvidenceProblems({
    ...production,
    import: { ...production.import, durableImport: { ...production.import.durableImport, skippedDispositionCount: 5 } },
  }, {
    phase: "PRODUCTION", provedHead: authorityProductionHead, importerIsAncestor: true,
  }).some((failure) => failure.includes("pointer/event/disposition denominator")), "durable disposition counts cannot drift from the exact candidate set");

  const activeProduction = readerClosureReadConnectionIdentity("postgresql://readonly_reader:never-serialized@production.example.test/civic");
  assert.throws(() => readerClosureReadConnectionIdentity("postgresql://owner:secret@production.example.test/civic"), /read-only role/);
  assert.deepEqual(
    readerClosureReadConnectionIdentity("postgresql://readonly_reader:one@ep-example.us-east-2.aws.neon.tech/civic"),
    readerClosureReadConnectionIdentity("postgresql://readonly_reader:two@ep-example-pooler.us-east-2.aws.neon.tech/civic"),
    "the provider's direct and pooled hosts identify the same Neon endpoint/role/database",
  );
  const boundProduction: ReaderClosureExecutionAuthorityEvidence = {
    ...production,
    store: {
      ...production.store,
      endpointIdentitySha256: activeProduction.endpointIdentitySha256,
      databaseIdentitySha256: activeProduction.databaseIdentitySha256,
      schemaIdentitySha256: activeProduction.schemaIdentitySha256,
    },
    readOnly: { ...production.readOnly, roleIdentitySha256: activeProduction.roleIdentitySha256 },
  };
  assert.deepEqual(readerClosureExecutionAuthorityEvidenceProblems(boundProduction, {
    phase: "PRODUCTION",
    provedHead: authorityProductionHead,
    importerIsAncestor: true,
    requiredPhase: "PRODUCTION",
    requiredReadConnectionIdentity: activeProduction,
  }), []);
  const fullyRelabeledChild: ReaderClosureExecutionAuthorityEvidence = {
    ...rehearsal,
    phase: "PRODUCTION",
    store: { ...rehearsal.store, authority: "STANDING_PRODUCTION" },
    clone: null,
  };
  assert.ok(readerClosureExecutionAuthorityEvidenceProblems(fullyRelabeledChild, {
    phase: "PRODUCTION",
    provedHead: authorityHead,
    importerIsAncestor: true,
    requiredPhase: "PRODUCTION",
    requiredReadConnectionIdentity: activeProduction,
  }).some((failure) => failure.includes("active production read handle")), "a child endpoint cannot become production by relabeling every phase field");
});

test("fresh Reader closure admission requires authority while inherited historical receipts retain compatibility", () => {
  const census = { rows: [] } as unknown as ReaderCensus;
  assert.deepEqual(readerClosureExecutionAuthorityProblems(process.cwd(), census, undefined, []), ["Fresh Reader closure requires exact execution-authority evidence"]);
});

test("legacy execution-authority compatibility is pinned to exact pre-seam path and bytes", () => {
  const root = process.cwd();
  const path = "docs/evidence/reader-last-mile-closure-receipt.json";
  const bytes = readReaderEvidence(root, path);
  assert.equal(sha256(bytes), "3aa9b15510ef18786b67e8b0781151caac6432fd2d963f4fba741195681f6f51");
  const receipt = JSON.parse(bytes.toString("utf8")) as ReaderClosureReceipt;
  assert.equal(isKnownLegacyReaderClosureReceipt(root, path, receipt), true);
  assert.equal(isKnownLegacyReaderClosureReceipt(root, "docs/evidence/reader-last-mile-forged-receipt.json", receipt), false);
  assert.equal(isKnownLegacyReaderClosureReceipt(root, "docs/evidence/reader-last-mile-final-closure-receipt.json", receipt), false);
  assert.equal(isKnownLegacyReaderClosureReceipt(root, path, { ...receipt, holdingsDigest: "0".repeat(64) }), false);
});

test("receipt EOL equivalence accepts only archived executed bytes and their exact Git LF form",()=>{
 const path="app/api/ask/grounded/route.ts" as const;
 const raw=Buffer.from("export const held = 17;\r\nexport const source = 'canonical';\n");
 const canonical=Buffer.from(raw.toString().replace(/\r\n/g,"\n"));
 const archive=Buffer.from(JSON.stringify({path,rawSourceBase64:raw.toString("base64")}));
 const emitted=ts.transpileModule(raw.toString(),{fileName:path,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,newLine:ts.NewLineKind.LineFeed,sourceMap:false,inlineSourceMap:false}});
 const proof:ReaderSourceEolEquivalence={path,recordedSha256:sha256(raw),canonicalLfSha256:sha256(canonical),archivePath:"docs/evidence/reader-last-mile-executed-source-grounded.json",archiveSha256:sha256(archive),gitEol:"lf",typescriptVersion:ts.version,emittedJsSha256:sha256(emitted.outputText)};
 assert.deepEqual(sourceEolEquivalenceProblems(proof,archive,raw,"lf"),[]);
 assert.deepEqual(sourceEolEquivalenceProblems(proof,archive,canonical,"lf"),[]);
 assert.ok(sourceEolEquivalenceProblems(proof,archive,Buffer.from(canonical.toString().replace("17","18")),"lf").some(row=>row.includes("neither the exact")),"A changed civic fact is never an EOL conversion");
 const forged=Buffer.from(JSON.stringify({path,rawSourceBase64:raw.toString().replace("17","18")}));
 assert.ok(sourceEolEquivalenceProblems(proof,forged,canonical,"lf").some(row=>row.includes("archive hash differs")));
 assert.ok(sourceEolEquivalenceProblems({...proof,archiveSha256:sha256(forged)},forged,canonical,"lf").some(row=>row.includes("recorded hash")),"Rehashing a forged archive cannot replace the original execution hash");
 assert.ok(sourceEolEquivalenceProblems({...proof,canonicalLfSha256:"0".repeat(64)},archive,canonical,"lf").some(row=>row.includes("CRLF-only")));
 assert.ok(sourceEolEquivalenceProblems({...proof,emittedJsSha256:"0".repeat(64)},archive,canonical,"lf").some(row=>row.includes("JavaScript")));
 assert.ok(sourceEolEquivalenceProblems(proof,archive,canonical,"unspecified").some(row=>row.includes("Git")));
 assert.ok(sourceEolEquivalenceProblems({...proof,path:"lib/other.ts" as ReaderSourceEolEquivalence["path"]},archive,canonical,"lf").some(row=>row.includes("outside the two")));
});

test("the committed complete reader graph still matches its proved holdings, loaders and rendering receipt", () => {
  const root = process.cwd();
  // Mandatory current evidence: a missing receipt is a failing gate, never a
  // skipped check. Documentation-only commits need no new reader proof; changed
  // holdings, identity joins, reader code or CSS invalidate this receipt.
  const receipt = JSON.parse(readReaderEvidence(root, "docs/evidence/reader-last-mile-final-closure-receipt.json").toString("utf8")) as ReaderClosureReceipt;
  assert.deepEqual(validateReaderClosureReceipt(root, receipt, { receiptPath: "docs/evidence/reader-last-mile-final-closure-receipt.json" }), []);
});

test("ballot scope cannot hide an eligible incumbent when the consumer join returns null", () => {
  const held = { target: "candidate:one", contestId: "contest:one", officialId: "official:one", officeMatch: true, divisionMatch: true, actualHolderId: "official:one", standing: "INCUMBENT" };
  assert.deepEqual(ballotHolderObligationFailures([held]), []);
  assert.match(ballotHolderObligationFailures([{ ...held, actualHolderId: null }])[0], /disappeared/);
  assert.match(ballotHolderObligationFailures([{ ...held, actualHolderId: "official:other" }])[0], /official:one/);
  assert.match(ballotHolderObligationFailures([{ ...held, officeMatch: false }])[0], /another office/);
  assert.deepEqual(ballotHolderObligationFailures([{ ...held, officeMatch: false, standing: "UNKNOWN", actualHolderId: null }]), []);
});

test("current certified ballot truth retires obsolete filing qualification without deleting its dated source", () => {
  const row: BallotQualificationObligation = { contestId: "contest:held", kind: "CERTIFIED_NOMINEES", rawScopeNote: "The general-election list has not yet been published.", currentNote: null, actualContestText: "The contest appears on this ballot.", sourceScopePreserved: true, expectedCanvass: { sourceUrl: "https://official.example/certified", sourceOrg: "Election authority", readAt: "2026-08-06" }, actualQualification: { sourceUrl: "https://official.example/certified", sourceOrg: "Election authority", retrievedAt: "2026-08-06" } };
  assert.deepEqual(ballotQualificationFailures([row]), []);
  assert.ok(ballotQualificationFailures([{ ...row, actualContestText: row.actualContestText + row.rawScopeNote }]).some(failure => failure.includes("obsolete")), "a held current nominee list forbids the old undated publication claim");
  assert.ok(ballotQualificationFailures([{ ...row, actualQualification: { ...row.actualQualification!, sourceUrl: "https://official.example/old-filings" } }]).some(failure => failure.includes("canvass provenance")));
  assert.ok(ballotQualificationFailures([{ ...row, sourceScopePreserved: false }]).some(failure => failure.includes("dated source")));
  assert.ok(ballotQualificationFailures([{ ...row, kind: "HELD_WORDING_GAP", expectedCanvass: null, actualQualification: null, actualContestText: "The publisher has not posted the wording." }]).some(failure => failure.includes("OURS")), "our unrecorded wording is not a publisher absence");
});

test("source fingerprint follows a directory index and imported reader CSS as files",(t)=>{
  const root=mkdtempSync(join(tmpdir(),"wtp-reader-index-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,"records"));
  writeFileSync(join(root,"page.ts"),'import "./reader.css"; import { records } from "./records"; export const answer=records;');
  writeFileSync(join(root,"records/index.ts"),'export const records=[{id:"canonical:one"}];');
  writeFileSync(join(root,"reader.css"),'.reader { display:block; }');
  const fingerprint=readerSourceFingerprint(root,["page.ts"]);
  assert.deepEqual(fingerprint.map((row)=>row.path),["page.ts","reader.css","records/index.ts"]);
  writeFileSync(join(root,"reader.css"),'.reader { display:none; }');
  assert.ok(readerSourceHashProblems(root,fingerprint).some((problem)=>problem.endsWith("reader.css")));
});

test("committed proof fingerprint rejects a vanished loader or changed holding, without requiring the same documentary HEAD", (t) => {
  const root = mkdtempSync(join(tmpdir(), "wtp-reader-fingerprint-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root,path),text); };
  write("page.ts", 'import { records } from "./loader.ts"; export const answer = records;');
  write("loader.ts", 'import data from "./holding.json"; export const records = data.records;');
  write("holding.json", '{"records":[{"id":"held:eligible"}]}');
  const fingerprint = readerSourceFingerprint(root, ["page.ts"]);
  assert.equal(fingerprint.length,3);
  write("notes.md", "A documentation-only commit does not change reader truth.");
  assert.deepEqual(readerSourceHashProblems(root,fingerprint),[]);
  write("loader.ts", "export const records = [];");
  assert.ok(readerSourceHashProblems(root,fingerprint).some((failure)=>failure.endsWith("loader.ts")));
  write("loader.ts", 'import data from "./holding.json"; export const records = data.records;');
  write("holding.json", '{"records":[{"id":"held:new-eligible"}]}');
  assert.ok(readerSourceHashProblems(root,fingerprint).some((failure)=>failure.endsWith("holding.json")));
});

test("every held voting jurisdiction and site survives the real route into the actual panel leaf", async () => {
  await registerReaderRenderHooks(process.cwd());
  const { VotingJurisdictionRecords } = await import("../components/map/voting-sites-panel.tsx");
  const { results } = await proveVotingSites();
  assert.equal(results.length, 44);
  let sites = 0;
  for (const result of results) {
    const jurisdiction = result.answer.jurisdictions.find((row) => row.ocdId === result.jurisdictionId)!;
    const markup = renderToStaticMarkup(createElement(VotingJurisdictionRecords, { answer: { ...result.answer, jurisdictions: [jurisdiction] }, selectedSiteId: null, onSelectSite: () => {} }));
    const expected = [jurisdiction.name, jurisdiction.modelSentence, jurisdiction.narrowing.sentence, jurisdiction.sourceUrl, jurisdiction.sourceOrg, jurisdiction.refusalLine, ...jurisdiction.sites.flatMap((site) => [site.name, site.address, site.room, site.serves])].filter((value): value is string => Boolean(value));
    assert.deepEqual(inspectReaderMarkup(markup, expected, [], { sites: { expected: result.returnedCount, actual: [...markup.matchAll(/ data-voting-site=/g)].length } }), [], result.jurisdictionId);
    sites += result.returnedCount;
  }
  assert.equal(sites, 306);
});

test("eligibility negative controls keep extraction and acquisition separate from civic verification", () => {
  assert.equal(classifyReaderEligibility(canonical).state, "READER_ELIGIBLE");
  const controls: [string, EligibilityFacts, string][] = [
    ["unverified acquisition", { ...staged, externalAuthority: "MISSING" }, "STAGED_NOT_ELIGIBLE"],
    ["unresolved Detective identity", { ...staged, identity: "UNRESOLVED" }, "IDENTITY_UNRESOLVED"],
    ["Validator extraction PASS but verification inconclusive", { ...staged, extraction: "PASS", validator: "INCONCLUSIVE" }, "STAGED_NOT_ELIGIBLE"],
    ["Auditor INCONCLUSIVE", { ...staged, audit: "INCONCLUSIVE" }, "STAGED_NOT_ELIGIBLE"],
    ["acquisition corpus in a reader-related family", { ...canonical, relationship: "ACQUISITION_INPUT" }, "STAGED_NOT_ELIGIBLE"],
    ["nothing acquired", { ...canonical, held: false }, "SOURCE/HOLDING_UNAVAILABLE"],
    ["operational gap ledger", { ...canonical, relationship: "OPERATIONAL_METADATA" }, "INTENTIONALLY_NOT_APPLICABLE"],
  ];
  for (const [name, input, expected] of controls) assert.equal(classifyReaderEligibility(input).state, expected, name);
  // Even a forged completion/promotion string cannot bypass the normalized
  // reader snapshot boundary by dropping newly acquired bytes beside it.
  assert.equal(classifyReaderEligibility({ ...staged, promotion: "PROMOTED", validator: "PASS", audit: "PASS", externalAuthority: "VERIFIED" }).state, "STAGED_NOT_ELIGIBLE");
});

test("the frozen Reader census retains retired authorities as withheld evidence without restoring their production identities", () => {
  const census = buildReaderCensus(process.cwd());
  assert.deepEqual(census.failures.filter((failure) => /OFFICEHOLDER_STATEMENT|BODY_ROSTER_AUTHORITY/.test(failure)), []);
  const recordsAt = (path: string) => census.records.filter((record) => record.holdingPath === path);
  const withheldAt = (path: string) => recordsAt(path).filter((record) => record.eligibility.state === "NOT_READER_ELIGIBLE");

  const retiredRolls = recordsAt("data/votes/state-votes-snapshot.json");
  assert.equal(retiredRolls.length, 1_632);
  assert.equal(withheldAt("data/votes/state-votes-snapshot.json").length, 1_632);
  assert.ok(retiredRolls.every((record) => record.eligibility.reason.includes("legiscan-state-rollcalls is RESEARCH_ONLY")));

  const retiredRosters = census.records.filter((record) =>
    /^data\/states\/(?:az|nh|nj)\/officials\/officeholders-\d{2}\.json$/.test(record.holdingPath)
  );
  assert.equal(retiredRosters.length, 620);
  assert.equal(retiredRosters.filter((record) => record.eligibility.state === "NOT_READER_ELIGIBLE").length, 620);
  assert.ok(retiredRosters.every((record) => record.eligibility.reason.includes("plural-bulk-roster is RESEARCH_ONLY")));

  const statements = recordsAt("data/corpus/statements.json");
  assert.equal(statements.length, 32);
  const eligibleStatements = statements.filter((record) => record.eligibility.state === "READER_ELIGIBLE");
  const heldStatements = statements.filter((record) => record.eligibility.state === "NOT_READER_ELIGIBLE");
  assert.equal(eligibleStatements.length, 29);
  assert.equal(heldStatements.length, 3);
  assert.ok(eligibleStatements.every((record) => record.canonicalIdentity.every((id) => !id.startsWith("plural:"))));
  assert.equal(eligibleStatements.filter((record) => record.canonicalIdentity.some((id) => id.startsWith("ballot-"))).length, 10);
  assert.ok(heldStatements.every((record) => record.canonicalIdentity.some((id) => id.startsWith("plural:"))));

  const campaignSites = recordsAt("lib/officials/campaign-sites.ts");
  assert.equal(campaignSites.length, 12);
  assert.equal(campaignSites.filter((record) => record.eligibility.state === "READER_ELIGIBLE").length, 9);
  assert.equal(campaignSites.filter((record) => record.eligibility.state === "NOT_READER_ELIGIBLE").length, 3);

  const federalAbsences = recordsAt("data/fec/fec-2026.json").filter((record) => record.unit === "absences");
  assert.equal(federalAbsences.length, 14);
  assert.ok(federalAbsences.every((record) => record.eligibility.state === "NOT_READER_ELIGIBLE"));
  assert.ok(federalAbsences.every((record) => record.eligibility.reason.includes("completed pagination")));

  const venues = recordsAt("lib/meetings/venue-cache.ts");
  const unstampedVenueFixtures = venues.filter((record) => record.eligibility.reason.includes("historical adoption/node:test fixture"));
  assert.equal(venues.length, 69);
  assert.equal(unstampedVenueFixtures.length, 3);
  assert.ok(unstampedVenueFixtures.every((record) => record.eligibility.state === "NOT_READER_ELIGIBLE"));

  const source = readFileSync(new URL("../lib/holdings/reader-census.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getStateVotesSnapshot\(/);
  assert.match(source, /record\.eligibility\.state === "READER_ELIGIBLE" && \["votes", "positions", "rollCalls"\]/);
});

test("promoted officeholder-statement drift fails without redefining the frozen 29/3 denominator", () => {
  const root = process.cwd();
  const baseline = structuredClone(currentOfficeholderStatements());
  const complete = compareFrozenOfficeholderStatementAuthority(root, baseline);
  assert.equal(complete.frozenEligibleSnapshotIds.length, 29);
  assert.equal(complete.frozenUnresolvedSnapshotIds.length, 3);
  assert.deepEqual(complete.failures, []);

  const omitted = compareFrozenOfficeholderStatementAuthority(root, {
    snapshots: baseline.snapshots.slice(1),
  });
  assert.equal(omitted.frozenEligibleSnapshotIds.length, 29, "promoted omission cannot shrink eligibility");
  assert.equal(omitted.frozenUnresolvedSnapshotIds.length, 3);
  assert.ok(omitted.failures.some((failure) => failure === `OFFICEHOLDER_STATEMENT_AUTHORITY_MISSING:${baseline.snapshots[0]!.id}`));

  const changedSnapshots = structuredClone(baseline.snapshots);
  changedSnapshots[0] = { ...changedSnapshots[0]!, subjectName: `${changedSnapshots[0]!.subjectName} drift` };
  const changed = compareFrozenOfficeholderStatementAuthority(root, { snapshots: changedSnapshots });
  assert.equal(changed.frozenEligibleSnapshotIds.length, 29, "promoted payload drift cannot shrink eligibility");
  assert.ok(changed.failures.some((failure) => failure === `OFFICEHOLDER_STATEMENT_AUTHORITY_PAYLOAD_MISMATCH:${baseline.snapshots[0]!.id}`));

  const extraUrl = "https://records.example.gov/officeholder-statement";
  const extraHash = "f".repeat(64);
  const extra = {
    ...structuredClone(baseline.snapshots[0]!),
    id: `${baseline.snapshots[0]!.subjectId}|${extraUrl}|${extraHash}`,
    url: extraUrl,
    contentHash: extraHash,
  };
  const unexpected = compareFrozenOfficeholderStatementAuthority(root, {
    snapshots: [...baseline.snapshots, extra],
  });
  assert.equal(unexpected.frozenEligibleSnapshotIds.length, 29, "an unexpected promoted row cannot enlarge eligibility");
  assert.ok(unexpected.failures.some((failure) => failure === `OFFICEHOLDER_STATEMENT_AUTHORITY_UNEXPECTED:${extra.id}`));
});

test("promoted roster member and disposition drift fails without shrinking the frozen child denominator", () => {
  const frozen = structuredClone(currentBodyRosters()[0]!);
  const dispositions = frozen.members.map((member) => currentRosterMemberReaderDisposition(member.id)!);
  assert.ok(frozen.members.length > 1);
  assert.ok(dispositions.every(Boolean));
  const complete = compareFrozenBodyRosterAuthority(frozen, [structuredClone(frozen)], structuredClone(dispositions));
  assert.deepEqual(complete.failures, []);
  assert.equal(complete.childDispositions.length, frozen.members.length);

  const first = frozen.members[0]!;
  const withoutMember = compareFrozenBodyRosterAuthority(
    frozen,
    [{ ...structuredClone(frozen), members: structuredClone(frozen.members.slice(1)) }],
    structuredClone(dispositions),
  );
  assert.equal(withoutMember.childDispositions.length, frozen.members.length);
  assert.ok(withoutMember.failures.some((failure) => failure === `BODY_ROSTER_AUTHORITY_MEMBER_MISSING:${frozen.bodyId}:${first.id}`));
  assert.equal(withoutMember.childDispositions[0]!.state, "AUTHORITY_MISMATCH");

  const changedMembers = structuredClone(frozen.members);
  changedMembers[0] = { ...changedMembers[0]!, name: `${changedMembers[0]!.name} drift` };
  const changedMember = compareFrozenBodyRosterAuthority(frozen, [{ ...structuredClone(frozen), members: changedMembers }], structuredClone(dispositions));
  assert.ok(changedMember.failures.some((failure) => failure === `BODY_ROSTER_AUTHORITY_MEMBER_PAYLOAD_MISMATCH:${frozen.bodyId}:${first.id}`));
  assert.equal(changedMember.childDispositions.length, frozen.members.length);

  const unexpectedMemberId = `${first.id.split("#")[0]}#unexpected`;
  const unexpectedMember = compareFrozenBodyRosterAuthority(
    frozen,
    [{ ...structuredClone(frozen), members: [...structuredClone(frozen.members), { ...structuredClone(first), id: unexpectedMemberId, name: "Unexpected member" }] }],
    structuredClone(dispositions),
  );
  assert.ok(unexpectedMember.failures.some((failure) => failure === `BODY_ROSTER_AUTHORITY_MEMBER_UNEXPECTED:${frozen.bodyId}:${unexpectedMemberId}`));
  assert.equal(unexpectedMember.childDispositions.length, frozen.members.length);

  const withoutDisposition = compareFrozenBodyRosterAuthority(frozen, [structuredClone(frozen)], structuredClone(dispositions.slice(1)));
  assert.ok(withoutDisposition.failures.some((failure) => failure === `BODY_ROSTER_AUTHORITY_DISPOSITION_MISSING:${frozen.bodyId}:${first.id}`));
  assert.equal(withoutDisposition.childDispositions.length, frozen.members.length);
  assert.equal(withoutDisposition.childDispositions[0]!.state, "AUTHORITY_MISMATCH");

  const changedDispositions = structuredClone(dispositions);
  changedDispositions[0] = { ...changedDispositions[0]!, state: "IDENTITY_UNRESOLVED", canonicalId: null };
  const changedDisposition = compareFrozenBodyRosterAuthority(frozen, [structuredClone(frozen)], changedDispositions);
  assert.ok(changedDisposition.failures.some((failure) => failure === `BODY_ROSTER_AUTHORITY_DISPOSITION_PAYLOAD_MISMATCH:${frozen.bodyId}:${first.id}`));
  assert.equal(changedDisposition.childDispositions.length, frozen.members.length);

  const unexpectedDisposition = {
    sourceId: unexpectedMemberId,
    canonicalId: null,
    state: "IDENTITY_UNRESOLVED" as const,
    reason: "A valid but unexpected promoted disposition must not enlarge the frozen denominator.",
  };
  const extraDisposition = compareFrozenBodyRosterAuthority(frozen, [structuredClone(frozen)], [...structuredClone(dispositions), unexpectedDisposition]);
  assert.ok(extraDisposition.failures.some((failure) => failure === `BODY_ROSTER_AUTHORITY_DISPOSITION_UNEXPECTED:${frozen.bodyId}:${unexpectedMemberId}`));
  assert.equal(extraDisposition.childDispositions.length, frozen.members.length);

  const globallyUnexpectedDisposition = {
    ...unexpectedDisposition,
    sourceId: "roster:wholly-unexpected#0",
  };
  assert.ok(compareFrozenBodyRosterAuthorityUniverse(
    [frozen],
    [structuredClone(frozen)],
    [...structuredClone(dispositions), globallyUnexpectedDisposition],
  ).some((failure) => failure === `BODY_ROSTER_AUTHORITY_DISPOSITION_UNEXPECTED:${globallyUnexpectedDisposition.sourceId}`));
});

test("the actual reader graph cannot consume autonomous staging merely because an artifact exists", (t) => {
  assert.deepEqual(readerAcquisitionBoundaryProblems(process.cwd()), []);
  const root = mkdtempSync(join(tmpdir(), "wtp-reader-stage-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stagedPath = "data/health/autonomous-agent-fleet/acquired.json";
  mkdirSync(dirname(join(root, stagedPath)), { recursive: true });
  writeFileSync(join(root, stagedPath), JSON.stringify({ id: "staged:official", extractionVerdict: "PASS", verdict: "INCONCLUSIVE", identity: "UNRESOLVED" }));
  writeFileSync(join(root, "page.ts"), 'export const reader = "normalized holdings only";');
  assert.deepEqual(readerAcquisitionBoundaryProblems(root, ["page.ts"]), [], "existence alone does not make staged bytes a reader input");
  writeFileSync(join(root, "data/health/autonomous-agent-fleet/frozen-lifecycle-readback.json"), JSON.stringify({ identity: "UNRESOLVED", audit: "INCONCLUSIVE" }));
  mkdirSync(join(root, "lib/control-plane/workers"), { recursive: true });
  writeFileSync(join(root, "lib/control-plane/workers/activity.ts"), 'export const projectFacts = facts => ({ eligible: false, reason: facts.identity });');
  writeFileSync(join(root, "page.ts"), 'import facts from "./data/health/autonomous-agent-fleet/frozen-lifecycle-readback.json"; import { projectFacts } from "./lib/control-plane/workers/activity.ts"; export const diagnostic=projectFacts(facts);');
  assert.deepEqual(readerAcquisitionBoundaryProblems(root, ["page.ts"]), [], "immutable underlying lifecycle facts and pure diagnostics are permitted eligibility inputs; module names alone are not forbidden");
  writeFileSync(join(root, "page.ts"), 'import acquired from "./data/health/autonomous-agent-fleet/acquired.json"; export const reader=acquired;');
  assert.ok(readerAcquisitionBoundaryProblems(root, ["page.ts"]).some(failure => failure.includes(stagedPath)), "a planted direct staging import is a permanent gate failure");
});

test("graph control crosses actual API fetches and fails when the reader import is removed", (t) => {
  const root = mkdtempSync(join(tmpdir(), "wtp-reader-census-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  write("components/map/map-entry.tsx", 'export function load() { return fetch(`/api/meetings?zip=${"85701"}`); }');
  write("app/api/meetings/route.ts", 'import { rows } from "../../../lib/reader.ts"; export const GET = () => rows;');
  write("lib/reader.ts", 'export const rows = [{ id: "fixture:held" }];');
  const path = importReachability(root, "components/map/map-entry.tsx", "lib/reader.ts");
  assert.equal(path.reached, true);
  assert.deepEqual(path.path, ["components/map/map-entry.tsx", "app/api/meetings/route.ts", "lib/reader.ts"]);
  write("app/api/meetings/route.ts", '// import { rows } from "../../../lib/reader.ts";\nexport const GET = () => [];');
  assert.equal(importReachability(root, "components/map/map-entry.tsx", "lib/reader.ts").reached, false, "a comment cannot impersonate a consumer import");
  write("app/api/meetings/route.ts", 'import type { rows } from "../../../lib/reader.ts";\nexport const GET = () => [];');
  assert.equal(importReachability(root, "components/map/map-entry.tsx", "lib/reader.ts").reached, false, "an erased type-only import cannot impersonate a runtime holding consumer");
});

function fixtureRow(): CensusRow {
  return { id: "state-money:funding:az", datasetFamily: "state-money", state: "az", jurisdiction: "state:az", relationship: "Normalized fixture", holdingPaths: ["fixture.json"], readerSurface: "funding", consumerPaths: [], consumerReachability: [], canonicalIdentityExpected: ["candidate:a", "candidate:b"], canonicalIdentityByRecord: { "fixture.json#/records/0": ["candidate:a"], "fixture.json#/records/1": ["candidate:b"] }, actualIdentityUsed: null, recordIds: ["fixture.json#/records/0", "fixture.json#/records/1"], eligibleRecordIds: ["fixture.json#/records/0", "fixture.json#/records/1"], readerEligiblePopulation: 2, withheldPopulation: 0, unitCounts: { records: 2 }, eligibilityCounts: { READER_ELIGIBLE: 2 }, withheldReasons: [], loaderCanReadHolding: "FILES_PARSED", eligibleRecordsProjected: "UNPROVEN", deployedBundleRequirement: "trace fixture", deployedBundleProved: false, deliveryState: "DELIVERY_UNPROVEN", falseNegativeCount: null, falsePositiveCount: null, unresolvedIdentityCount: 0, evidencePaths: [], deliveryReason: "not executed" };
}

test("reader readback counts missing rows and refuses wrong-candidate identities, false counts, and unchecked evidence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "wtp-reader-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifact = '{"returned":[{"id":"candidate:a"}]}\n';
  writeFileSync(join(root, "proof.json"), artifact);
  const row = fixtureRow();
  const proof: ReaderDeliveryProof = { rowId: row.id, exactHead: "a".repeat(40), source: "executed-route", evidencePath: "proof.json", evidenceSha256: sha256(artifact), expectedRecordIds: row.eligibleRecordIds, renderedRecordIds: [row.eligibleRecordIds[0]], actualIdentities: { [row.eligibleRecordIds[0]]: ["candidate:a"] }, statedCount: 1, returnedCount: 1, scope: "all fixture candidates" };
  const measured = reconcileDelivery(row, proof, root);
  assert.deepEqual(measured.failures, []);
  assert.equal(measured.row.falseNegativeCount, 1);
  assert.equal(measured.row.deliveryState, "ELIGIBLE_BUT_NOT_RENDERED");
  assert.ok(reconcileDelivery(row, { ...proof, actualIdentities: { [row.eligibleRecordIds[0]]: ["candidate:b"] } }, root).failures.some((f) => f.includes("identity differs")));
  assert.ok(reconcileDelivery(row, { ...proof, statedCount: 2 }, root).failures.some((f) => f.includes("stated N")));
  assert.ok(reconcileDelivery(row, { ...proof, evidenceSha256: "wrong" }, root).failures.some((f) => f.includes("byte hash")));
  const partial = reconcileDelivery(row, { ...proof, expectedRecordIds: [row.eligibleRecordIds[0]] }, root);
  assert.equal(partial.row.deliveryState, "DELIVERY_UNPROVEN");
  assert.equal(partial.row.falseNegativeCount, null, "one passing case does not zero the full denominator");
  const second: ReaderDeliveryProof = { ...proof, expectedRecordIds: [row.eligibleRecordIds[1]], renderedRecordIds: [row.eligibleRecordIds[1]], actualIdentities: { [row.eligibleRecordIds[1]]: ["candidate:b"] } };
  assert.equal(reconcileDelivery(partial.row, second, root).row.deliveryState, "RENDERED", "independent measured subsets combine to the full canonical denominator");
  assert.ok(reconcileDelivery(partial.row, { ...second, exactHead: "b".repeat(40) }, root).failures.some((failure) => failure.includes("different heads")), "one build cannot fill another build's missing records");
});

test("current normalized state-money records survive the canonical exact-key selector; leads never enter", () => {
  resetStateMoneyCache();
  let eligible = 0;
  let unresolved = 0;
  let superseded = 0;
  for (const state of ["az", "nh", "nj"]) {
    const path = `data/states/${state}/funding/state-money-${state}-2026.json`;
    const snapshot = JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as { records: StateMoneyRecord[] };
    for (const record of snapshot.records) {
      if (!isRenderable(record)) { unresolved++; continue; }
      eligible++;
      assert.ok(record.targetKeys.length > 0, `${path}: renderable record needs a resolved target or scoped gap target`);
      for (const key of record.targetKeys) {
        const selected = stateMoneyForTarget(key);
        assert.ok(selected.some((actual) => JSON.stringify(actual) === JSON.stringify(record)), `${key}: eligible record disappeared before the surface payload`);
        assert.ok(selected.every((actual) => actual.targetKeys.includes(key) && isRenderable(actual)), `${key}: wrong or staged record attached`);
        const answer = stateMoneyRecordsForDisplay(selected);
        if (!answer.some((actual) => JSON.stringify(actual) === JSON.stringify(record))) {
          superseded++;
          assert.notEqual(record.filingState, "FILED", "no held filing may be suppressed by another candidate's or weaker record");
          assert.ok(answer.length && answer.every((actual) => actual.targetKeys.includes(key) && (actual.filingState === "FILED" || record.filingState === "NO_REPORTS_ON_FILE" && actual.filingState === "NO_REPORTS_ON_FILE")), `${key}: withholding an observation needs a stronger filing or equivalent sourced absence on this exact target`);
        }
      }
    }
  }
  assert.equal(eligible, 419);
  assert.equal(unresolved, 3);
  assert.equal(superseded, 94, "54 source observations are superseded by same-candidacy filings and 40 duplicate sourced absences consolidate; none is lost at a loader");
  assert.deepEqual(stateMoneyForTarget("unresolved:Katie Hobbs"), [], "a familiar name without a committed target identity never resolves");
  assert.deepEqual(stateMoneyForTarget("ballot-az-pima:governor:invented-person"), []);
});

test("Reader authority canonicalization ignores transport metadata and JSON key order only", () => {
  assert.equal(
    canonicalReaderAuthorityJson({ z: 1, nested: { b: 2, a: 1 }, _manifestStateCodes: ["az"] }),
    canonicalReaderAuthorityJson({ nested: { a: 1, b: 2 }, z: 1 }),
  );
  assert.notEqual(
    canonicalReaderAuthorityJson({ nested: { a: 1 }, claim: "held fact" }),
    canonicalReaderAuthorityJson({ nested: { a: 1 }, claim: "changed fact" }),
  );
});

test("state-money supersession requires one later non-weakening authority for the exact identity", () => {
  const snapshot = JSON.parse(readFileSync(join(process.cwd(), "data/states/az/funding/state-money-az-2026.json"), "utf8")) as { records: StateMoneyRecord[] };
  const frozen = structuredClone(snapshot.records.find((record) => record.filingState === "FILED")!);
  const successor: StateMoneyRecord = {
    ...structuredClone(frozen),
    checkedAt: "2026-09-08",
    totals: { ...frozen.totals, receipts: (frozen.totals.receipts ?? 0) + 1 },
    provenance: { ...frozen.provenance, collectedAt: "2026-09-08", verifiedAt: "2026-09-08" },
  };

  assert.equal(stateMoneyAuthorityRelation(frozen, [structuredClone(frozen)], "2026-09-08").kind, "EXACT");
  assert.equal(stateMoneyAuthorityRelation(frozen, [successor], "2026-09-08").kind, "MONOTONIC_SUCCESSOR");
  assert.equal(stateMoneyAuthorityRelation(frozen, [{ ...successor, agency: `${successor.agency} drift` }], "2026-09-08").kind, "MISSING");
  assert.equal(stateMoneyAuthorityRelation(frozen, [{ ...successor, targetKeys: ["ballot-az-pima:other-person"] }], "2026-09-08").kind, "MISSING");
  assert.equal(stateMoneyAuthorityRelation(frozen, [{ ...successor, targetKeys: [...successor.targetKeys, "ballot-az-pima:other-person"] }], "2026-09-08").kind, "MISSING");
  assert.equal(stateMoneyAuthorityRelation(frozen, [{ ...successor, committeeId: "different-committee" }], "2026-09-08").kind, "MISSING");
  assert.equal(stateMoneyAuthorityRelation(frozen, [{ ...successor, checkedAt: "2026-08-31" }], "2026-09-08").kind, "MISSING");
  assert.equal(stateMoneyAuthorityRelation(frozen, [{ ...successor, checkedAt: "2026-09-09", provenance: { ...successor.provenance, collectedAt: "2026-09-09", verifiedAt: "2026-09-09" } }], "2026-09-08").kind, "MISSING");
  assert.equal(stateMoneyAuthorityRelation(frozen, [{ ...successor, provenance: { ...successor.provenance, collectedAt: "2026-08-31" } }], "2026-09-08").kind, "MISSING");
  assert.equal(stateMoneyAuthorityRelation(frozen, [{ ...successor, filingState: "NO_REPORTS_ON_FILE" }], "2026-09-08").kind, "MISSING");
  assert.equal(stateMoneyAuthorityRelation(frozen, [{ ...structuredClone(frozen), totals: { ...frozen.totals, receipts: (frozen.totals.receipts ?? 0) + 1 } }], "2026-09-08").kind, "MISSING", "changed bytes at the same observation time are not a later authority");
  assert.equal(stateMoneyAuthorityRelation(frozen, [successor], "2026-08-31").kind, "MISSING");
  assert.equal(stateMoneyAuthorityRelation(frozen, [
    successor,
    { ...structuredClone(successor), checkedAt: "2026-09-09", totals: { ...successor.totals, receipts: (successor.totals.receipts ?? 0) + 1 }, provenance: { ...successor.provenance, collectedAt: "2026-09-09", verifiedAt: "2026-09-09" } },
  ], "2026-09-09").kind, "MISSING", "two different plausible successors cannot be selected by guesswork");

  const frozenAbsence = structuredClone(snapshot.records.find((record) => record.filingState === "NO_REPORTS_ON_FILE" && record.committeeId === null)!);
  const registeredSuccessor: StateMoneyRecord = {
    ...structuredClone(frozenAbsence),
    committeeId: "102250",
    registeredName: "Miceli for Governor",
    filingState: "REGISTERED_NO_ACTIVITY_REPORTED",
    match: {
      ...frozenAbsence.match,
      registeredName: "Miceli for Governor",
      officeAsFiled: frozenAbsence.officeSought,
      electionYearAsFiled: frozenAbsence.electionYear,
      allThreeAgree: true,
      note: "exact target, office, cycle and registered committee verified",
    },
    checkedAt: "2026-09-08",
    provenance: { ...frozenAbsence.provenance, collectedAt: "2026-09-08", verifiedAt: "2026-09-08" },
  };
  assert.equal(
    stateMoneyAuthorityRelation(frozenAbsence, [registeredSuccessor], "2026-09-08").kind,
    "MONOTONIC_SUCCESSOR",
    "the observed exact-target absence-to-registered transition remains admissible",
  );
});

test("ballot absence supersession permits only a unique later verification of the exact same fact", () => {
  const snapshot = JSON.parse(readFileSync(join(process.cwd(), "data/states/nj/ballot/nj-morris-2026.json"), "utf8")) as { absences: Record<string, unknown>[] };
  const frozen = structuredClone(snapshot.absences[0]!);
  const provenance = frozen.provenance as Record<string, unknown>;
  const successor = {
    ...structuredClone(frozen),
    provenance: { ...provenance, collectedAt: "2026-09-08", verifiedAt: "2026-09-08" },
  };

  assert.equal(ballotAbsenceAuthorityRelation(frozen, [structuredClone(frozen)]).kind, "EXACT");
  assert.equal(ballotAbsenceAuthorityRelation(frozen, [successor]).kind, "MONOTONIC_SUCCESSOR");
  assert.equal(ballotAbsenceAuthorityRelation(frozen, [{ ...successor, statement: `${String(frozen.statement)} drift` }]).kind, "MISSING");
  assert.equal(ballotAbsenceAuthorityRelation(frozen, [{ ...successor, provenance: { ...provenance, collectedAt: "2026-08-31", verifiedAt: "2026-08-31" } }]).kind, "MISSING");
  assert.equal(ballotAbsenceAuthorityRelation(frozen, [
    successor,
    { ...structuredClone(successor), provenance: { ...provenance, collectedAt: "2026-09-09", verifiedAt: "2026-09-09" } },
  ]).kind, "MISSING", "two later observations cannot be resolved by array order");
});

test("committed autonomous negative controls preserve the exact AZ, NJ and NH lifecycle burdens", () => {
  const artifact = JSON.parse(readFileSync(join(process.cwd(), "data/health/autonomous-agent-fleet/2026-09-03-lifecycle-readback.json"), "utf8")) as { promotion: string; activity: { recordClass: string; jurisdiction: string; facts: { workers: { worker: { role: string }; result: Record<string, unknown> }[] } }[] };
  assert.equal(artifact.promotion, "OFF");
  const directory = artifact.activity.find((a) => a.recordClass === "OFFICIAL_BOARD_DIRECTORY")!;
  assert.ok(directory.facts.workers.some((w) => w.worker.role === "PARSER" && w.result.actualRowCount === 10));
  assert.ok(directory.facts.workers.some((w) => w.worker.role === "DETECTIVE" && w.result.verdict === "UNRESOLVED"));
  const validator = directory.facts.workers.find((w) => w.worker.role === "VALIDATOR")!;
  assert.equal(validator.result.extractionVerdict, "PASS");
  assert.equal(validator.result.verdict, "INCONCLUSIVE");
  assert.equal(classifyReaderEligibility({ ...staged, identity: "UNRESOLVED", extraction: String(validator.result.extractionVerdict), validator: String(validator.result.verdict) }).state, "IDENTITY_UNRESOLVED");
  assert.equal(artifact.activity.filter((a) => a.recordClass === "CANDIDATE_FILING_DOCUMENT").length, 2);
});

test("every declared canonical dataset/surface edge has an executable consumer path", () => {
  assert.deepEqual(datasetSurfaceCoverageProblems(process.cwd()), []);
});

test("render instrument rejects a vanished eligible fact, an inherited identity and a false row count", () => {
  const markup = '<section><p>Katie Hobbs</p><p>$11,109,720</p><a href="https://official.example/?a=1&amp;b=2">State source</a></section>';
  assert.deepEqual(inspectReaderMarkup(markup, ["Katie Hobbs", "$11,109,720", "https://official.example/?a=1&b=2"], ["Other candidate"], { rows: { expected: 1, actual: 1 } }), []);
  assert.ok(inspectReaderMarkup(markup.replace("$11,109,720", "No holdings"), ["$11,109,720"], [], {}).some((failure) => failure.startsWith("Missing rendered")));
  assert.ok(inspectReaderMarkup(markup, [], ["Katie Hobbs"], {}).some((failure) => failure.startsWith("Withheld fragment")));
  assert.ok(inspectReaderMarkup(markup, [], [], { rows: { expected: 2, actual: 1 } }).some((failure) => failure.includes("stated 2, rendered 1")));
});

test("evidence packaging preserves the exact baseline JSON and deterministic archive", (t) => {
  const root = mkdtempSync(join(tmpdir(), "wtp-reader-pack-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = "docs/evidence/reader-last-mile-fixture.json";
  mkdirSync(dirname(join(root, path)), { recursive: true });
  const original = Buffer.from('{"unmeasuredFalseNegatives":null,"staged":"WITHHELD"}\n');
  writeFileSync(join(root, path), original);
  const first = packReaderEvidence(root, path);
  assert.equal(first.originalSha256, sha256(original));
  assert.deepEqual(readReaderEvidence(root, first.path), original);
  const firstArchive = readFileSync(join(root, first.path));
  writeFileSync(join(root, path), original);
  packReaderEvidence(root, path);
  assert.deepEqual(readFileSync(join(root, first.path)), firstArchive);
  assert.throws(() => packReaderEvidence(root, "../other.json"), /Only named last-mile/);
});

test("applicability keeps source inputs distinct without erasing direct reader obligations", () => {
  const row = fixtureRow();
  const census = { holdingsDigest: "same-holdings", records: row.eligibleRecordIds.map((auditId) => ({ auditId })), rows: [row], failures: [] } as unknown as ReaderCensus;
  const projection: ReaderProjectionReport = { formatVersion: 1, holdingsDigest: census.holdingsDigest, rule: "fixture", counts: {}, failures: [], records: row.eligibleRecordIds.map((auditId, index) => ({ auditId, family: row.datasetFamily, status: index ? "SUPPORTING_INPUT" : "PROJECTED", selector: "canonicalFixtureSelector", canonicalIdentities: row.canonicalIdentityByRecord[auditId], returnedIdentities: row.canonicalIdentityByRecord[auditId], returnedCount: index ? 0 : 1, payloadSha256: index ? null : "fixture", reason: index ? "A source template supports the first record; it is not another person." : "Exact canonical person returned." })) };
  const reconciled = applyReaderApplicability(census, projection).rows[0];
  assert.equal(reconciled.readerEligiblePopulation, 2, "held eligible population is never rewritten");
  assert.deepEqual(reconciled.applicableEligibleRecordIds, [row.eligibleRecordIds[0]]);
  assert.equal(reconciled.deliveryState, "DELIVERY_UNPROVEN", "a local projection cannot mark a reader render");
  assert.match(reconciled.applicabilityByRecord![row.eligibleRecordIds[1]].reason, /not another person/);
  assert.throws(() => applyReaderApplicability(census, { ...projection, holdingsDigest: "other" }), /different canonical holdings/);
  assert.throws(() => applyReaderApplicability(census, { ...projection, records: [] }), /exact census denominator/);
  const scoped = { ...projection, records: projection.records.map((record) => ({ ...record, surfaceDispositions: { map: { status: "SUPPORTING_INPUT" as const, selector: "canonicalScopeSelector", reason: "This relationship is displayed by representation; map reads the separate person." } } })) };
  const mapCensus = { ...census, rows: [{ ...row, readerSurface: "map" as const }] };
  assert.equal(applyReaderApplicability(mapCensus, scoped).rows[0].applicableEligibleRecordIds!.length, 0);
  assert.deepEqual(applyReaderApplicability(census, scoped).rows[0].applicableEligibleRecordIds, [row.eligibleRecordIds[0]], "one surface's input disposition never hides a direct answer on another surface");
});

test("composition requires actual per-record HTML, current source and an executed same-surface witness", (t) => {
  const root = mkdtempSync(join(tmpdir(), "wtp-reader-composition-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const component = "components/funding/state-money-section.tsx";
  const source = "export const StateMoneySection = () => <p>money</p>;";
  write(component, source);
  const row = { ...fixtureRow(), readerSurface: "state-money" as const };
  const census = { holdingsDigest: "fixture-holdings", rows: [row], records: row.eligibleRecordIds.map((auditId) => ({ auditId, family: "state-money", canonicalIdentity: row.canonicalIdentityByRecord[auditId] })) } as unknown as ReaderCensus;
  const markup = "<p>$11,109,720</p>";
  const evidence = { holdingsDigest: census.holdingsDigest, failures: [], cases: [{ auditId: row.eligibleRecordIds[0], component, componentSha256: sha256(source), selector: "exactCanonicalSelector", actualCanonicalIdentities: ["candidate:a"], payloadSha256: "fixture", markup, markupSha256: sha256(markup), expectedFragments: ["$11,109,720"], forbiddenFragments: ["candidate:b"], rowCounts: { money: { expected: 1, actual: 1 } }, failures: [] }] };
  write("components.json", JSON.stringify(evidence));
  write("browser.json", JSON.stringify({ canonicalId: "candidate:a", shownMoney: "$11,109,720" }));
  write("bundle.json", "fixture holding traced");
  const exactHead = "a".repeat(40);
  const bundle = { evidencePath: "bundle.json", evidenceSha256: sha256(readFileSync(join(root, "bundle.json"))), exactHead, holdingPaths: ["fixture.json"] };
  const witness: ReaderSurfaceClassWitness = { surface: "state-money", component, exactHead, evidencePath: "browser.json", evidenceSha256: sha256(readFileSync(join(root, "browser.json"))) };
  assert.equal(composeReaderComponentProofs(root, census, "components.json", [], bundle).proofs.length, 0, "a local render alone cannot claim in-situ delivery");
  assert.equal(composeReaderComponentProofs(root, census, "components.json", [{ ...witness, surface: "ballot" }], bundle).proofs.length, 0, "another surface does not prove this edge");
  const composed = composeReaderComponentProofs(root, census, "components.json", [witness], bundle);
  assert.deepEqual(composed.failures, []);
  assert.deepEqual(composed.proofs[0].renderedRecordIds, [row.eligibleRecordIds[0]]);
  assert.equal(composed.uncovered.length, 1, "the second held candidate remains an obligation");
  assert.equal(reconcileDelivery(row, composed.proofs[0], root).row.deliveryState, "DELIVERY_UNPROVEN");
  write("reviewed-image.png", "reviewed image fixture bytes");
  const imagedProof = { ...composed.proofs[0], surfaceWitnesses: [{ ...witness, screenshots: [{ path: "reviewed-image.png", sha256: sha256(readFileSync(join(root, "reviewed-image.png"))) }] }] };
  assert.deepEqual(reconcileDelivery(row, imagedProof, root).failures, [], "composition checks the actual reviewed image bytes; its digest remains in the durable witness manifest under RULING 20");
  write("reviewed-image.png", "different screenshot bytes");
  assert.ok(reconcileDelivery(row, imagedProof, root).failures.some(failure => failure.includes("reviewed surface image changed")), "a different screenshot cannot reuse a reviewed witness");
  write(component, source + " // changed after proof");
  assert.ok(composeReaderComponentProofs(root, census, "components.json", [witness], bundle).failures.some((failure) => failure.includes("source changed")));
  write(component, source);
  write("selector.ts", "export const canonical = 'same';");
  write("components.json", JSON.stringify({ ...evidence, sourceHashes: [{ path: "selector.ts", sha256: sha256(readFileSync(join(root, "selector.ts"))) }] }));
  write("selector.ts", "export const canonical = 'changed';");
  assert.throws(() => composeReaderComponentProofs(root, census, "components.json", [witness], bundle), /selector dependency changed/, "an unchanged leaf cannot validate a stale source-to-payload adapter");
  evidence.cases[0].markup = "<p>No holdings</p>";
  evidence.cases[0].markupSha256 = sha256(evidence.cases[0].markup);
  write("components.json", JSON.stringify(evidence));
  assert.ok(composeReaderComponentProofs(root, census, "components.json", [witness], bundle).failures.some((failure) => failure.includes("Missing rendered canonical")), "updating an HTML hash cannot conceal a vanished held fact");
});
