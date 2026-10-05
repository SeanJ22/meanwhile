import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MEETING_PARTITION_CONTRACTS, observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  HOLDING_FAMILY_DISPOSITIONS,
  MANUAL_PRODUCTION_INVENTORY_BINDINGS,
  NON_ROUTINE_DISPOSITIONS,
  PDC7_MIGRATION_BLOCKERS,
  PDC7_RESOLVED_SPLIT_BINDINGS,
  ROUTINE_INVENTORY_BINDINGS,
  boundContractSourceId,
  pdc7ClosureProblems,
  validatePdc7DispositionRegistry,
} from "../lib/civic-data/non-routine-dispositions.ts";
import { DATASET_FAMILIES } from "../lib/holdings/datasets.ts";
import {
  PRODUCTION_OFFICEHOLDER_ROSTER_FILES,
  retiredPluralStateRosterFiles,
  mayReadRetiredPluralRoster,
  officeholderIdentityMayEnterReader,
  officeholderRosterFiles,
} from "../lib/officials/roster-authority.ts";
import { readerTraceRequirements } from "../lib/holdings/reader-trace.ts";

interface InventoryRow {
  source_id: string;
  classification: string;
  tracked_paths: string[];
  current_scheduler: string;
  current_promotion_door: string;
  runtime_readers: string[];
}

interface Inventory {
  rows: InventoryRow[];
  datasetFamilyReconciliation: {
    RUNTIME_CIVIC_DATA: string[];
    OPERATIONAL_REFERENCE_DATA: string[];
    STATIC_VERSIONED_REFERENCE: string[];
    RESEARCH_ONLY: string[];
    splitFamilies: Record<string, string[]>;
  };
}

const inventoryPath = new URL("../docs/permanent-civic-data-plane-cutover-v2-inventory.json", import.meta.url);
const readInventory = (): Inventory => JSON.parse(readFileSync(inventoryPath, "utf8")) as Inventory;

test("the PDC-7 frozen denominator accounts for every source row and all 42 holdings families exactly once", () => {
  const inventory = readInventory();
  const problems = validatePdc7DispositionRegistry(inventory.rows, DATASET_FAMILIES.map((family) => family.id));
  assert.deepEqual(problems, []);

  assert.equal(inventory.rows.length, 42); // + meeting-source-wiring, meetings-derived-families, meeting-body-crosswalk (C16) // + candidate-campaign-site-chain (2026-09-25)
  // legistar-outcomes moved from the explicit-owner bindings to the standing clock; registration adds one row.
  assert.equal(ROUTINE_INVENTORY_BINDINGS.length, 12); // + the derived wiring store and the derived meeting families (C16) // + registration (56 contracts, one binding) and + pima-legistar-outcomes, moved to the standing clock // + the verified campaign sites (2026-09-25)
  assert.equal(NON_ROUTINE_DISPOSITIONS.length, 11);
  assert.equal(MANUAL_PRODUCTION_INVENTORY_BINDINGS.length, 18); // + the meeting-body crosswalk (C16)
  assert.equal(PDC7_RESOLVED_SPLIT_BINDINGS.length, 1);
  assert.equal(PDC7_MIGRATION_BLOCKERS.length, 0);
  assert.equal(DATASET_FAMILIES.length, 42);
  assert.equal(HOLDING_FAMILY_DISPOSITIONS.length, 42);

  const sourceIds = [
    ...ROUTINE_INVENTORY_BINDINGS.map((row) => row.inventorySourceId),
    ...MANUAL_PRODUCTION_INVENTORY_BINDINGS.map((row) => row.inventorySourceId),
    ...NON_ROUTINE_DISPOSITIONS.map((row) => row.sourceId),
    ...PDC7_RESOLVED_SPLIT_BINDINGS.map((row) => row.inventorySourceId),
    ...PDC7_MIGRATION_BLOCKERS.map((row) => row.sourceId),
  ];
  assert.equal(new Set(sourceIds).size, inventory.rows.length);
  assert.deepEqual([...sourceIds].sort(), inventory.rows.map((row) => row.source_id).sort());
  assert.ok(!sourceIds.some((id) => id.includes("UNKNOWN")));
});

test("denominator accounting cannot be mistaken for terminal PDC-7 closure", () => {
  assert.deepEqual(
    pdc7ClosureProblems().map(({ sourceId }) => sourceId),
    PDC7_MIGRATION_BLOCKERS.map(({ sourceId }) => sourceId),
  );
  assert.equal(pdc7ClosureProblems().length, 0);
  assert.ok(pdc7ClosureProblems().every(({ detail }) => detail.length > 0));
});

test("six direct routine rows plus the retired LegiScan row resolve every standing contract without an aggregate authority", () => {
  const byId = (rows: { contractId: string; contractSourceId: string }[]) => rows.sort((left, right) => left.contractId.localeCompare(right.contractId));
  const replacements = NON_ROUTINE_DISPOSITIONS.flatMap((row) => [...(row.replacementRoutineContracts ?? [])]);
  assert.deepEqual(
    byId([
      ...ROUTINE_INVENTORY_BINDINGS.flatMap((binding) => binding.contractIds.map((contractId) => ({ contractId, contractSourceId: boundContractSourceId(binding, contractId) }))),
      ...replacements,
    ]),
    byId(observableRoutineContracts().map(({ id: contractId, sourceId: contractSourceId }) => ({ contractId, contractSourceId }))),
  );
  assert.equal(ROUTINE_SOURCE_CONTRACTS.some(({ id }) => id === "meetings"), false);
  assert.equal(ROUTINE_INVENTORY_BINDINGS[0]?.contractIds.length, MEETING_PARTITION_CONTRACTS.filter(({ derivedFamily }) => derivedFamily === null).length);
});

test("every explicit-owner production contract resolves one frozen inventory row without becoming a routine clock", () => {
  const splitBindings = PDC7_RESOLVED_SPLIT_BINDINGS.flatMap(({ paths, addedProductionPaths }) => [...paths, ...(addedProductionPaths ?? [])].flatMap((path) =>
    path.disposition === "PRODUCTION_DATA_PLANE"
      ? [{ contractId: path.contractId, contractSourceId: path.contractSourceId }]
      : [],
  ));
  const bindings = [...new Map([
    ...MANUAL_PRODUCTION_INVENTORY_BINDINGS.flatMap(({ contractId, contractSourceId, additionalContracts }) =>
      [{ contractId, contractSourceId }, ...(additionalContracts ?? [])].map(contract => [contract.contractId, contract] as const)),
    ...splitBindings.map(({ contractId, contractSourceId }) => [contractId, { contractId, contractSourceId }] as const),
  ]).values()]
    .sort((left, right) => left.contractId.localeCompare(right.contractId));
  const contracts = MANUAL_PRODUCTION_SOURCE_CONTRACTS.map(({ id: contractId, sourceId: contractSourceId }) => ({ contractId, contractSourceId }))
    .sort((left, right) => left.contractId.localeCompare(right.contractId));
  assert.deepEqual(bindings, contracts);
  assert.ok(MANUAL_PRODUCTION_INVENTORY_BINDINGS.every(({ reason }) => reason.length > 0));
  assert.ok(MANUAL_PRODUCTION_SOURCE_CONTRACTS.every((contract) => !("cadence" in contract) && !("retry" in contract)));
  for (const sourceId of [
    "congress-rollcalls",
    "federal-key-votes",
    "az-sos-campaign-finance",
    "nh-sos-campaign-finance",
    "nj-elec-campaign-finance",
    "az-pima-local-finance",
    "officeholder-statements",
    "voting-sites",
    "prl",
    "comment-access",
    "ballot-navigation",
    "campaign-sites",
  ]) {
    assert.ok(
      MANUAL_PRODUCTION_INVENTORY_BINDINGS.some((binding) => binding.inventorySourceId === sourceId) ||
      PDC7_RESOLVED_SPLIT_BINDINGS.some((binding) => binding.paths.some((path) => path.disposition === "PRODUCTION_DATA_PLANE" && path.contractId === sourceId)),
    );
  }
});

test("every lawful non-routine disposition forbids schedules and automatic promotion", () => {
  for (const row of NON_ROUTINE_DISPOSITIONS) {
    assert.ok(row.execution.forbidden.includes("SCHEDULED_EXECUTION"), row.sourceId);
    assert.ok(row.execution.forbidden.includes("ROUTINE_RUNNER_EXECUTION"), row.sourceId);
    assert.ok(row.execution.forbidden.includes("AUTOMATIC_PRODUCTION_PROMOTION"), row.sourceId);
    assert.ok(row.execution.permitted.length > 0, row.sourceId);
  }

  for (const row of NON_ROUTINE_DISPOSITIONS.filter(({ disposition }) => disposition === "RESEARCH_ONLY" || disposition === "FIXTURE")) {
    assert.equal(row.execution.readerUse, "FORBIDDEN", row.sourceId);
    assert.ok(row.execution.forbidden.includes("READER_RUNTIME_FALLBACK"), row.sourceId);
    assert.ok(row.execution.forbidden.includes("PRODUCTION_CANONICAL_USE"), row.sourceId);
  }
});

test("the NJ questionnaire plan is a non-writing operation, not a second ballot authority", () => {
  const row = NON_ROUTINE_DISPOSITIONS.find(({ sourceId }) => sourceId === "nj-questionnaire-invitations");
  assert.equal(row?.disposition, "OPERATIONAL");
  assert.equal(row?.execution.readerUse, "CONTROL_PLANE_ONLY");
  assert.ok(row?.execution.forbidden.includes("UNREVIEWED_TRACKED_WRITE"));

  const command = readFileSync(new URL("../scripts/questionnaire-invitations.mts", import.meta.url), "utf8");
  assert.match(command, /if \(process\.argv\.includes\("--write"\) \|\| process\.argv\.includes\("--check"\)\)/);
  assert.doesNotMatch(command, /\b(?:writeFile|appendFile|createWriteStream|writeStampStable)\s*\(/);
  assert.ok(!PDC7_MIGRATION_BLOCKERS.some(({ sourceId }) => sourceId === "nj-questionnaire-invitations"));
});

test("research holdings have no standing Reader, candidate denominator, or tracked writer", () => {
  const row = NON_ROUTINE_DISPOSITIONS.find(({ sourceId }) => sourceId === "research-holdings");
  assert.equal(row?.disposition, "RESEARCH_ONLY");
  assert.equal(row?.execution.readerUse, "FORBIDDEN");
  assert.ok(row?.execution.forbidden.includes("READER_RUNTIME_FALLBACK"));
  assert.deepEqual(row?.retiredDiscoveredRuntimeReaders, [
    "lib/control-plane/scheduler/providers/candidate-enrichment.ts candidate denominator",
  ]);
  assert.deepEqual(row?.retiredWriterExecutables, ["scripts/candidate-universe.mts"]);

  const provider = readFileSync(new URL("../lib/control-plane/scheduler/providers/candidate-enrichment.ts", import.meta.url), "utf8");
  assert.match(provider, /preloadCandidateEnrichmentAuthorities/);
  assert.match(provider, /candidateUniversesFromPromoted/);
  assert.doesNotMatch(provider.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""), /candidate-universe-2026\.json|readFileSync/);

  assert.throws(() => readFileSync(new URL("../scripts/candidate-universe.mts", import.meta.url), "utf8"), /ENOENT/);
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["candidates:universe"], undefined);
  assert.ok(!PDC7_MIGRATION_BLOCKERS.some(({ sourceId }) => sourceId === "research-holdings"));
});

test("LegiScan is immutable research evidence, not a production fallback or mutable writer", () => {
  const row = NON_ROUTINE_DISPOSITIONS.find(({ sourceId }) => sourceId === "legiscan-state-rollcalls");
  assert.equal(row?.disposition, "RESEARCH_ONLY");
  assert.deepEqual(row?.retiredFrozenRuntimeReaders, ["lib/sources/legiscan/snapshot.ts", "votes", "Ask", "map", "ballot"]);
  assert.deepEqual(row?.replacementRoutineContracts, [
    { contractId: "az-state-rollcalls", contractSourceId: "az-legislature" },
    { contractId: "nh-state-rollcalls", contractSourceId: "nh-general-court" },
    { contractId: "nj-state-rollcalls", contractSourceId: "nj-legislature" },
  ]);
  assert.ok(row?.execution.forbidden.includes("READER_RUNTIME_FALLBACK"));
  assert.ok(row?.execution.forbidden.includes("PRODUCTION_CANONICAL_USE"));
  assert.ok(!PDC7_MIGRATION_BLOCKERS.some(({ sourceId }) => sourceId === "legiscan-state-rollcalls"));

  const runtimeReader = readFileSync(new URL("../lib/sources/legiscan/snapshot.ts", import.meta.url), "utf8");
  assert.match(runtimeReader, /readPromotedCivicData<StateVotesSnapshot>\("STATE_ROLL_CALL"/);
  assert.match(runtimeReader, /No proof-validated official state roll-call projection is loaded/);
  assert.doesNotMatch(runtimeReader, /promotedReadModel/);

  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["legiscan:fetch"], undefined);
  assert.throws(() => readFileSync(new URL("../scripts/fetch-legiscan.mts", import.meta.url), "utf8"), /ENOENT/);
});

test("Census geometry has one reviewed immutable authority and no competing runtime promotion door", () => {
  // The tracked static GIS / boundary-identity files remain a reviewed immutable
  // version adoption. RULING 292 does not change this authority; the static files
  // still never auto-promote.
  const row = NON_ROUTINE_DISPOSITIONS.find(({ sourceId }) => sourceId === "census-geography");
  assert.equal(row?.disposition, "EXPLICIT_VERSION_ADOPTION");
  assert.equal(row?.execution.readerUse, "ADOPTED_VERSION");
  assert.ok(row?.execution.forbidden.includes("AUTOMATIC_PRODUCTION_PROMOTION"));
  assert.ok(row?.trackedPaths.includes("public/geo/**"), "the static-GIS authority still governs the tracked geography files");

  // RULING 292 authorizes automatic Level-4 publication for qualifying official
  // sources. The ZCTA-to-geography OVERLAP dataset (census-geography-overlaps) is a
  // SEPARATE authorized routine authority built live from the Census tab20
  // relationship files: it writes no tracked file and neither adopts nor promotes
  // the static GIS files, so it is not a competing door for that immutable authority.
  const overlaps = ROUTINE_SOURCE_CONTRACTS.find(({ id }) => id === "census-geography-overlaps");
  assert.equal(overlaps?.recordClass, "CENSUS_GEOGRAPHY");
  assert.equal(overlaps?.sourceId, "census-geography-relationships");
  assert.equal(overlaps?.autoPromotable, true);
  assert.notEqual(overlaps?.sourceId, row?.sourceId, "the overlap authority is a distinct source from the static GIS files");
  const binding = ROUTINE_INVENTORY_BINDINGS.find(({ contractIds }) => contractIds.some((contractId) => contractId === "census-geography-overlaps"));
  assert.equal(binding?.contractSourceId, "census-geography-relationships");
});

test("Plural/OpenStates is research evidence only: production has no state-roster Reader or tracked writer", () => {
  const row = NON_ROUTINE_DISPOSITIONS.find(({ sourceId }) => sourceId === "plural-bulk-roster");
  assert.equal(row?.disposition, "RESEARCH_ONLY");
  assert.deepEqual(row?.retiredFrozenRuntimeReaders, ["lib/registry/server.ts", "representation", "map", "ballot", "Ask"]);
  assert.deepEqual(row?.retiredDiscoveredRuntimeReaders, [
    "lib/funding/campaign-money.ts",
    "registry-runtime-bindings officialCandidacies projection",
    "data/ballot/candidate-links-2026.json",
    "lib/photos/person.ts candidate portrait bridge",
    "lib/registry/server.ts portrait-id bridge",
    "lib/officials/campaign-sites.ts intermediary-id bridge",
    "lib/corpus/unified.ts intermediary-keyed statement bridge",
    "lib/holdings/reader-census.ts portrait delivery projection",
    "next.config.ts production trace",
  ]);
  assert.deepEqual(row?.retiredWriterExecutables, [
    "scripts/build-officeholders.ts#state",
    "scripts/b14-official-links.mts",
    "scripts/enrich-officials.mts",
    "scripts/fix-nh-official-pages.mts",
    "scripts/fix-stale-official-pages.mts",
    "scripts/reader-finance-identity.mts",
  ]);
  assert.deepEqual(row?.replacementRoutineContracts, [
    { contractId: "az-state-legislators", contractSourceId: "az-legislature" },
    { contractId: "nj-state-legislators", contractSourceId: "nj-legislature" },
  ]);
  assert.ok(row?.execution.forbidden.includes("READER_RUNTIME_FALLBACK"));
  assert.ok(row?.execution.forbidden.includes("PRODUCTION_CANONICAL_USE"));
  assert.ok(!PDC7_MIGRATION_BLOCKERS.some(({ sourceId }) => sourceId === "plural-bulk-roster"));

  assert.deepEqual([...PRODUCTION_OFFICEHOLDER_ROSTER_FILES], ["officeholders-us.json"]);
  assert.deepEqual(officeholderRosterFiles(null), ["officeholders-us.json"]);
  assert.equal(mayReadRetiredPluralRoster(null), false);
  assert.equal(mayReadRetiredPluralRoster("child-v8"), true);
  assert.equal(mayReadRetiredPluralRoster("child-v8", "production"), false);
  assert.equal(officeholderIdentityMayEnterReader("plural:recorded-research-id", null), false);
  assert.equal(officeholderIdentityMayEnterReader("congress:C001133", null), true);
  assert.equal(officeholderIdentityMayEnterReader("plural:recorded-research-id", "child-v8"), true);
  assert.equal(officeholderIdentityMayEnterReader("plural:recorded-research-id", "child-v8", "production"), false);
  assert.deepEqual(officeholderRosterFiles("child-v8", "production"), ["officeholders-us.json"]);
  assert.ok(retiredPluralStateRosterFiles().length > 0);
  assert.ok(retiredPluralStateRosterFiles().every((file) => /^officeholders-\d{2}\.json$/.test(file)));

  assert.throws(() => readFileSync(new URL("../scripts/build-officeholders.ts", import.meta.url), "utf8"), /ENOENT/);

  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["b14:links"], undefined);
  assert.equal(packageJson.scripts["fix:official-pages"], undefined);
  assert.equal(packageJson.scripts["nh:fix-pages"], undefined);
  assert.equal(packageJson.scripts["officials:enrich"], undefined);
  for (const path of [
    "../scripts/b14-official-links.mts",
    "../scripts/enrich-officials.mts",
    "../scripts/enrich-federal-officeholders.mts",
    "../scripts/fix-nh-official-pages.mts",
    "../scripts/fix-stale-official-pages.mts",
  ]) {
    assert.throws(() => readFileSync(new URL(path, import.meta.url), "utf8"), /ENOENT/, path);
  }
  const registryReader = readFileSync(new URL("../lib/registry/server.ts", import.meta.url), "utf8");
  assert.match(registryReader, /const ROSTERS = officeholderRosterFiles\(\)/);
  assert.match(registryReader, /officeholderIdentityMayEnterReader\(photo\.officeholderId\)/);
  const askReader = readFileSync(new URL("../lib/ask/server-sources.ts", import.meta.url), "utf8");
  assert.match(askReader, /if \(!mayReadRetiredPluralRoster\(\)\) return \[\]/);
  const voteReader = readFileSync(new URL("../lib/ask/votes.ts", import.meta.url), "utf8");
  assert.match(voteReader, /mayReadRetiredPluralRoster\(\)[\s\S]*Object\.fromEntries/);
  const financeReader = readFileSync(new URL("../lib/funding/campaign-money.ts", import.meta.url), "utf8");
  assert.match(financeReader, /getRegistryRuntimeReadModel\(\)\.officialCandidacies/);
  assert.doesNotMatch(financeReader, /official-candidacies\.json|readFileSync/);
  const photoReader = readFileSync(new URL("../lib/photos/person.ts", import.meta.url), "utf8");
  assert.match(photoReader, /officeholderIdentityMayEnterReader\(row\.officeholderId\)/);
  const statementReader = readFileSync(new URL("../lib/corpus/unified.ts", import.meta.url), "utf8");
  assert.match(statementReader, /currentOfficeholderStatements\(\)/);
  const campaignSiteReader = readFileSync(new URL("../lib/officials/campaign-sites.ts", import.meta.url), "utf8");
  assert.match(campaignSiteReader, /currentCampaignSites\(\)/);
  const representationRoute = readFileSync(new URL("../app/api/representation/[...division]/route.ts", import.meta.url), "utf8");
  assert.match(representationRoute, /holderStatus:/);
  assert.match(representationRoute, /sldu\|sldl/);
  assert.match(representationRoute, /HOLDING_UNAVAILABLE/);
  const productionTrace = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(productionTrace, /states\/\*\/officials\/officeholders-\*\.json/);

  assert.equal(packageJson.scripts["reader:finance-identity"], undefined);
  assert.throws(() => readFileSync(new URL("../scripts/reader-finance-identity.mts", import.meta.url), "utf8"), /ENOENT/);
  assert.throws(() => readFileSync(new URL("../lib/funding/official-candidacies.json", import.meta.url), "utf8"), /ENOENT/);
  assert.throws(() => readFileSync(new URL("../lib/funding/official-person-candidacy-links.json", import.meta.url), "utf8"), /ENOENT/);
  const firstSeedBridge = readFileSync(new URL("../lib/registry/fixtures/official-candidacies-first-seed.json", import.meta.url), "utf8");
  assert.doesNotMatch(firstSeedBridge, /"id"\s*:\s*"plural:/);
  const reviewedBridge = readFileSync(new URL("../lib/registry/fixtures/official-person-candidacy-links-v1.json", import.meta.url), "utf8");
  assert.match(reviewedBridge, /"classification"\s*:\s*"EXPLICIT_VERSIONED_IDENTITY_INPUT"/);
  assert.match(reviewedBridge, /"productionAuthority"\s*:\s*false/);
  assert.doesNotMatch(reviewedBridge, /"officialId"\s*:\s*"plural:/);

  const candidateLinks = JSON.parse(readFileSync(new URL("../data/ballot/candidate-links-2026.json", import.meta.url), "utf8")) as {
    links: Record<string, { official: { url: string; verification: string } | null }>;
    hunts: { note: string }[];
  };
  assert.ok(!Object.values(candidateLinks.links).some(({ official }) => /Plural Open States|OpenStates/.test(official?.verification ?? "")));
  assert.ok(!candidateLinks.hunts.some(({ note }) => /B14 official-page rung|sitting officeholder in this state's registry/.test(note)));
  for (const key of [
    "ballot-az-pima:attorney-general:petersen-warren",
    "ballot-az-pima:state-senate-19:griffin-gail",
    "ballot-az-pima:state-senate-20:hernandez-alma",
    "ballot-az-pima:state-house-19:diaz-lupe",
    "ballot-az-pima:state-house-19:gowan-david",
    "ballot-az-pima:state-house-20:villegas-betty",
  ]) {
    assert.match(candidateLinks.links[key]?.official?.url ?? "", /azleg\.gov\/(?:House|Senate)\/[A-Za-z-]+\/\?legislature=57/);
    assert.doesNotMatch(candidateLinks.links[key]?.official?.verification ?? "", /Plural|OpenStates/);
  }

  const traceFiles = readerTraceRequirements(process.cwd()).flatMap(({ files }) => files);
  assert.ok(!traceFiles.includes("lib/registry/officeholders-us.json"));
  assert.ok(!traceFiles.some((file) => /data\/states\/[^/]+\/officials\/officeholders-\d{2}\.json$/.test(file)));

  const family = DATASET_FAMILIES.find(({ id }) => id === "state-officeholders");
  assert.deepEqual(family?.surfaces, []);
  assert.deepEqual(family?.consumerPaths, []);
});

test("the family classifier preserves the frozen split-family semantics without UNKNOWN", () => {
  const reconciliation = readInventory().datasetFamilyReconciliation;
  const expected = new Map<string, string[]>();
  for (const classification of ["RUNTIME_CIVIC_DATA", "OPERATIONAL_REFERENCE_DATA", "STATIC_VERSIONED_REFERENCE", "RESEARCH_ONLY"] as const) {
    for (const frozenFamilyId of reconciliation[classification]) {
      const familyId = frozenFamilyId.startsWith("hunt except ") ? "hunt" : frozenFamilyId;
      expected.set(familyId, [classification]);
    }
  }
  const inventoryById = new Map(readInventory().rows.map((row) => [row.source_id, row]));
  for (const [familyId, sourceIds] of Object.entries(reconciliation.splitFamilies)) {
    expected.set(familyId, sourceIds.map((sourceId) => inventoryById.get(sourceId)!.classification));
  }

  assert.equal(expected.size, 42);
  for (const row of HOLDING_FAMILY_DISPOSITIONS) {
    const actual = (Array.isArray(row.classification) ? row.classification : [row.classification]).slice().sort();
    assert.deepEqual(actual, expected.get(row.familyId)?.slice().sort(), row.familyId);
    assert.ok(actual.length > 0 && actual.every((classification) => !classification.includes("UNKNOWN")), row.familyId);
    if (row.splitSourceIds) assert.deepEqual([...row.splitSourceIds].sort(), reconciliation.splitFamilies[row.familyId].slice().sort(), `${row.familyId} split sources`);
  }
});

test("the registry fails closed for a new source, lost family, scheduled non-routine row, and research runtime fallback", () => {
  const inventory = readInventory();
  const familyIds = DATASET_FAMILIES.map((family) => family.id);

  const unknown = structuredClone(inventory.rows);
  unknown.push({ source_id: "new-unclassified-source", classification: "RUNTIME_CIVIC_DATA", tracked_paths: ["data/new.json"], current_scheduler: "manual", current_promotion_door: "none", runtime_readers: [] });
  assert.ok(validatePdc7DispositionRegistry(unknown, familyIds).includes("UNKNOWN inventory disposition: new-unclassified-source"));

  assert.ok(validatePdc7DispositionRegistry(inventory.rows, familyIds.filter((id) => id !== "votes")).includes("classified holding family absent from registry: votes"));

  const scheduled = structuredClone(inventory.rows);
  scheduled.find((row) => row.source_id === "asset-index")!.current_scheduler = "daily schedule";
  assert.ok(validatePdc7DispositionRegistry(scheduled, familyIds).includes("asset-index: non-routine row still names an automatic scheduler"));

  const fallback = structuredClone(inventory.rows);
  fallback.find((row) => row.source_id === "granicus-fixture")!.runtime_readers = ["lib/runtime/fallback.ts"];
  assert.ok(validatePdc7DispositionRegistry(fallback, familyIds).includes("granicus-fixture: research/fixture row has runtime fallback readers: lib/runtime/fallback.ts"));
});

test("the formerly mixed curated Reader row has an exact truthful path partition and no PDC-7 blocker", () => {
  assert.deepEqual(PDC7_MIGRATION_BLOCKERS.filter(({ kind }) => kind === "RESEARCH_READER_DECOUPLING").map(({ sourceId }) => sourceId), []);
  assert.deepEqual(PDC7_MIGRATION_BLOCKERS.filter(({ kind }) => kind === "OPERATIONAL_REFERENCE_PLANE").map(({ sourceId }) => sourceId), [
  ]);
  assert.deepEqual(PDC7_MIGRATION_BLOCKERS.filter(({ kind }) => kind === "ROW_SPLIT_REQUIRED").map(({ sourceId }) => sourceId), []);
  const split = PDC7_RESOLVED_SPLIT_BINDINGS.find(({ inventorySourceId }) => inventorySourceId === "curated-reader-records");
  assert.ok(split);
  assert.deepEqual(
    split.paths.map(({ path }) => path).sort(),
    readInventory().rows.find(({ source_id }) => source_id === "curated-reader-records")!.tracked_paths.slice().sort(),
  );
  assert.equal(new Set(split.paths.map(({ path }) => path)).size, 12);
  assert.deepEqual(
    split.paths.filter((path) => path.disposition === "PRODUCTION_DATA_PLANE").map(({ path }) => path).sort(),
    [
      "lib/ballot/polling-place-links.ts",
      "lib/ballot/registration-links.ts",
      "lib/officials/campaign-sites.ts",
      "lib/officials/statewide-executives.ts",
      "lib/meetings/venue-cache.ts",
      "lib/registry/body-rosters.ts",
      "lib/registry/comment-access.ts",
      "lib/routing/everyday.ts",
    ].sort(),
  );
  assert.ok(split.paths.filter((path) => path.disposition === "EXPLICIT_VERSION_ADOPTION").every((path) => path.versionBinding.length > 20));
  assert.deepEqual(pdc7ClosureProblems(), []);
});

test("CA-01: Open States may auto-promote state legislators, for any state (rulings §3)", async () => {
  const { sourceAuthority } = await import("../lib/civic-data/source-authority.ts");
  const authority = sourceAuthority("plural-openstates");
  assert.equal(authority?.routineAutoPromotion, true);
  assert.deepEqual(authority?.recordClasses, ["STATE_LEGISLATOR"]);
  assert.deepEqual(authority?.jurisdictions, ["US"]);
  assert.doesNotMatch(authority?.horizonSemantics ?? "", /Research\/corroboration only/);
});
