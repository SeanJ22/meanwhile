import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { CivicDataReadResult, PromotedEdgeEntry } from "../../lib/civic-data/read-model.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineRecordClass } from "../../lib/civic-data/types.ts";
import { MemoryRoutineDataStore } from "../../lib/civic-data/store.ts";
import { enterReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../../lib/registry/runtime-edge.ts";
import { primeRegistryRuntimeFromValue, readRegistryRuntimeProjection } from "../../lib/registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../../lib/registry/runtime-data-plane.ts";
import {
  FEDERAL_DIRECTORY_SCOPE,
  FEDERAL_DIRECTORY_SOURCE_ID,
  type FederalDirectoryReadModel,
} from "../../lib/officials/federal-directory-data-plane.ts";
import { FEDERAL_PORTRAITS_SCOPE, primeFederalDirectoryFromValue, readFederalDirectoryProjection } from "../../lib/officials/federal-directory-read-model.ts";
import type { Officeholder, OfficeholderDivision } from "../../lib/officials/types.ts";
import type { DirectoryFile } from "../../lib/officials/directory.ts";
import { requiredManualProductionContract, type ManualProductionContractId } from "../../lib/civic-data/manual-contracts.ts";
import type { OfficialStateLegislatorReadModel } from "../../lib/civic-data/candidate-builders.ts";
import { officialStateLegislatorTargetByScope, type OfficialStateVoteScope } from "../../lib/state-rollcalls/authority.ts";
import { PIMA_LOCAL_FINANCE_CONTRACT, type AzPimaFinanceReadModel, STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "../../lib/funding/data-plane.ts";
import type { StateMoneySnapshot } from "../../lib/funding/state-money.ts";
import { refreshStateMoneyProjectionFromPromoted } from "../../lib/funding/state-snapshot.ts";
import type { AzBallotProjection, CandidateProfilesProjection, NhBallotProjection } from "../../lib/civic-data/manual-projections.ts";
import { resetAzIdentityCache } from "../../lib/identity/az-2026.ts";
import type { AzCandidateIdentity, AzContestIdentity, LineupOutcome, LineupReconciliationRow } from "../../lib/identity/types.ts";
import type { Candidacy, Contest } from "../../lib/ballot/types.ts";
import { refreshAzPimaFinanceFromPromoted } from "../../lib/control-plane/campaign-finance/held-records.ts";
import { createHash } from "node:crypto";
import type { CandidateCorpus, CandidateDocument } from "../../lib/candidates/corpus.ts";
import type { SourceSnapshot, StatementCorpus } from "../../lib/corpus/types.ts";
import { readAzBallotProjection, readCandidateCorpusProjection } from "../../lib/civic-data/manual-read-models.ts";
import { readOfficeholderStatementsProjection } from "../../lib/corpus/data-plane.ts";
import { FEDERAL_KEY_VOTE_SCOPE, FEDERAL_ROLLCALL_SCOPE, FEDERAL_VOTES_SOURCE_ID, type FederalKeyVotesReadModel, type FederalRollCallsReadModel } from "../../lib/votes/data-plane.ts";
import { readFederalRollCallsProjection } from "../../lib/votes/snapshot.ts";
import { readFederalKeyVotesProjection } from "../../lib/votes/key-votes-projection.ts";
import { federalKeyVoteSelectionV1Snapshot } from "../../lib/votes/key-vote-selection-v1.ts";
import type { MemberVote, RollCallVote, VotePosition } from "../../lib/votes/types.ts";
import { provenEdgeEntry } from "./promoted-edge-entry.ts";
import { rosterFactReader } from "./roster-fact-reader.ts";
import { installFactReader } from "../../lib/facts/db.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const REGISTRY_FIXTURE = join(ROOT, "tests/fixtures/registry-transfer-import.json.gz");


let registryRuntime: ReaderAuthorityEdgeBundle["registryRuntime"];
let federalDirectory: ReaderAuthorityEdgeBundle["federalDirectory"];
const stateLegislators: Record<string, OfficialStateLegislatorReadModel> = {};
const promoted = new Map<string, PromotedEdgeEntry>();

export function promotedFixtureBundle(extra: ReaderAuthorityEdgeBundle = {}): ReaderAuthorityEdgeBundle {
  return {
    ...(registryRuntime ? { registryRuntime } : {}),
    ...(federalDirectory ? { federalDirectory } : {}),
    ...(live.stateLegislators ? { stateLegislators: live.stateLegislators } : {}),
    ...extra,
    promoted: new Map([...promoted, ...(extra.promoted ?? [])]),
  };
}

const live: ReaderAuthorityEdgeBundle = {
  get registryRuntime() { return registryRuntime; },
  get federalDirectory() { return federalDirectory; },
  get stateLegislators() {
    return Object.keys(stateLegislators).length ? {
      jurisdictions: new Set(Object.keys(stateLegislators)),
      load: async (jurisdiction: string) => stateLegislators[jurisdiction]
        ? { value: stateLegislators[jurisdiction], versionId: "test:state-legislators" }
        : null,
    } : undefined;
  },
  promoted,
};

function enter(): void {
  enterReaderAuthorityEdge(live);
}

export function installPromotedValue<T>(input: {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly value: T;
  readonly retrievedAt?: string;
  readonly sourceThrough?: string | null;
}): Extract<PromotedEdgeEntry<T>, { kind: "PROMOTED" }> {
  const entry = provenEdgeEntry(input);
  promoted.set(`${input.recordClass}:${input.scope}`, entry as PromotedEdgeEntry);
  enter();
  return entry;
}

export function installManualValue<T>(id: ManualProductionContractId, value: T, versionId: string = `test:${id}`) {
  const contract = requiredManualProductionContract(id);
  return installPromotedValue({ recordClass: contract.recordClass, scope: contract.scope, sourceId: contract.sourceId, versionId, value });
}

export function installAbsent(recordClass: RoutineRecordClass, scope: string): void {
  promoted.set(`${recordClass}:${scope}`, { kind: "NOT_RECORDED", recordClass, scope });
  enter();
}

export function clearPromotedFixtures(): void {
  registryRuntime = undefined;
  federalDirectory = undefined;
  for (const scope of Object.keys(stateLegislators)) delete stateLegislators[scope];
  promoted.clear();
  enter();
}

function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}


interface RegistryFixture {
  readonly record: CandidateVersionRecord;
  readonly projection: PromotedProjection<RegistryRuntimeReadModel>;
}

let registryFixture: RegistryFixture | null = null;

export function registryTransferImport(): RegistryFixture {
  registryFixture ??= JSON.parse(gunzipSync(readFileSync(REGISTRY_FIXTURE)).toString("utf8")) as RegistryFixture;
  return registryFixture;
}

export function registryRuntimeStore(store: MemoryRoutineDataStore = new MemoryRoutineDataStore()): MemoryRoutineDataStore {
  const { record, projection } = registryTransferImport();
  const held = store as unknown as { candidates: Map<string, CandidateVersionRecord>; promotions: Map<string, PromotedProjection> };
  held.candidates.set(record.candidate.id, record);
  held.promotions.set(projection.key, projection);
  return store;
}

export async function installRegistryRuntime(): Promise<{ readonly value: RegistryRuntimeReadModel; readonly versionId: string }> {
  const { projection } = registryTransferImport();
  const installed = { value: projection.payload, versionId: projection.versionId };
  registryRuntime = installed;
  promoted.set(projection.key, provenEdgeEntry({
    recordClass: projection.recordClass,
    scope: projection.scope,
    sourceId: projection.sourceId,
    versionId: projection.versionId,
    value: projection.payload,
  }) as PromotedEdgeEntry);
  enter();
  installFactReader(rosterFactReader(projection.payload.bodyRosters));
  primeRegistryRuntimeFromValue(installed.value, installed.versionId);
  served(await readRegistryRuntimeProjection(), "Registry runtime");
  primeRegistryRuntimeFromValue(installed.value, installed.versionId);
  return installed;
}

export async function withPromotedFixturesInChildren<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_OPTIONS;
  const loader = pathToFileURL(join(ROOT, "scripts/register-test-loader.mjs")).href;
  const preload = pathToFileURL(join(ROOT, "tests/helpers/promoted-fixtures-preload.ts")).href;
  process.env.NODE_OPTIONS = [previous, "--experimental-strip-types", `--import=${loader}`, `--import=${preload}`].filter(Boolean).join(" ");
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
}


const FEDERAL_SHA = "f".repeat(40);
const FEDERAL_COLLECTED = "2026-09-25";

export function syntheticFederalDirectory(registry: RegistryRuntimeReadModel = registryTransferImport().projection.payload): FederalDirectoryReadModel {
  const officeholders: Officeholder[] = [];
  const divisions: OfficeholderDivision[] = [];
  const byMember: DirectoryFile["byMember"] = {};
  const committees: DirectoryFile["committees"] = {};
  for (let c = 1; c <= 45; c++) {
    committees[`TC${String(c).padStart(2, "0")}`] = { name: `Test Committee ${c}`, type: c % 2 ? "house" : "senate", url: null, jurisdiction: null, jurisdictionSource: null };
  }
  const committeeIds = Object.keys(committees);
  const rows = registry.officialCandidacies.rows.filter((row) => row.holder.authority === "FEDERAL_DIRECTORY");
  rows.forEach((row, n) => {
    const senate = row.holder.officeTitle === "U.S. Senator";
    const state = /\/(?:state|district):([a-z]{2})/.exec(row.holder.divisions[0] ?? "")?.[1] ?? "";
    officeholders.push({
      id: row.holder.id,
      name: row.holder.name,
      officeTitle: row.holder.officeTitle,
      level: "FEDERAL",
      termStart: "2025-01-03",
      termEnd: senate ? "2031-01-03" : "2027-01-03",
      birthDate: null,
      partyLabel: null,
      websiteUrl: null,
      contactFormUrl: null,
      phone: null,
      email: null,
      campaignUrl: null,
      photo: null,
      state: state.toUpperCase(),
      chamber: senate ? "senate" : "house",
      provenance: {
        sourceUrl: row.holder.sourceUrl ?? "https://unitedstates.github.io/congress-legislators/legislators-current.json",
        sourceOrg: "unitedstates/congress-legislators (community project)",
        collectedAt: FEDERAL_COLLECTED,
        verifiedAt: null,
      },
    });
    for (const ocdId of row.holder.divisions) divisions.push({ officeholderId: row.holder.id, ocdId, bodyId: null });
    const committeeId = committeeIds[n % committeeIds.length]!;
    byMember[row.holder.id.slice("congress:".length)] = {
      districtOffices: [],
      committees: [{ committeeId, name: committees[committeeId]!.name, rank: null, title: null }],
    };
  });
  return {
    formatVersion: 1,
    sourceSha: FEDERAL_SHA,
    roster: { scope: "us", generatedAt: `${FEDERAL_COLLECTED}T00:00:00.000Z`, officeholders, divisions, unmatched: [] },
    directory: {
      source: {
        project: "unitedstates/congress-legislators",
        repoUrl: "https://github.com/unitedstates/congress-legislators",
        sha: FEDERAL_SHA,
        licence: "CC0 1.0 Universal (public domain dedication)",
        licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        sourceOrg: "unitedstates/congress-legislators (community project)",
        collectedAt: FEDERAL_COLLECTED,
      },
      counts: { members: officeholders.length, committees: committeeIds.length },
      committees,
      byMember,
    },
  };
}

export async function installFederalDirectory(value: FederalDirectoryReadModel = syntheticFederalDirectory()): Promise<{ readonly value: FederalDirectoryReadModel; readonly versionId: string }> {
  const versionId = "test:federal-directory";
  const installed = { value, versionId };
  federalDirectory = installed;
  promoted.set(`FEDERAL_DIRECTORY:${FEDERAL_DIRECTORY_SCOPE}`, provenEdgeEntry({
    recordClass: "FEDERAL_DIRECTORY",
    scope: FEDERAL_DIRECTORY_SCOPE,
    sourceId: FEDERAL_DIRECTORY_SOURCE_ID,
    versionId,
    value,
  }) as PromotedEdgeEntry);
  if (!promoted.has(`FEDERAL_DIRECTORY:${FEDERAL_PORTRAITS_SCOPE}`)) installAbsent("FEDERAL_DIRECTORY", FEDERAL_PORTRAITS_SCOPE);
  enter();
  served(await readFederalDirectoryProjection(), "Federal directory");
  primeFederalDirectoryFromValue(value, versionId);
  return installed;
}

export async function installRegistryAuthority(): Promise<void> {
  await installRegistryRuntime();
  await installFederalDirectory();
}


export function syntheticStateLegislators(scope: OfficialStateVoteScope, registry: RegistryRuntimeReadModel = registryTransferImport().projection.payload): OfficialStateLegislatorReadModel {
  const target = officialStateLegislatorTargetByScope(scope);
  if (!target) throw new Error(`no official state-legislator target for ${scope}`);
  const usps = target.state.toLowerCase();
  const officeholders: Officeholder[] = [];
  const divisions: OfficeholderDivision[] = [];
  for (const division of registry.registry.divisions) {
    const match = new RegExp(`^ocd-division/country:us/state:${usps}/(sldl|sldu):([\\w-]+)$`).exec(division.ocdId);
    if (!match) continue;
    const lower = match[1] === "sldl";
    for (const seat of lower ? ["A", "B"] : ["A"]) {
      const id = `${target.sourceId}:${match[1]}-${match[2]}-${seat}`;
      officeholders.push({
        id,
        name: `${lower ? "Representative" : "Senator"} ${target.state} LD ${match[2]} ${seat}`,
        officeTitle: lower ? "State Representative" : "State Senator",
        level: "STATE",
        termStart: "2025-01-13",
        termEnd: lower ? "2027-01-11" : "2027-01-11",
        birthDate: null,
        partyLabel: null,
        websiteUrl: null,
        contactFormUrl: null,
        phone: null,
        email: null,
        campaignUrl: null,
        photo: null,
        state: target.state,
        chamber: lower ? "lower" : "upper",
        provenance: { sourceUrl: target.probeUrl, sourceOrg: target.publisher, collectedAt: "2026-09-25", verifiedAt: null },
      });
      divisions.push({ officeholderId: id, ocdId: division.ocdId, bodyId: null });
    }
  }
  return {
    formatVersion: 1,
    sourceId: target.sourceId,
    jurisdiction: scope,
    term: "2025-2026",
    generatedAt: "2026-09-25T00:00:00.000Z",
    roster: { scope: target.state, generatedAt: "2026-09-25T00:00:00.000Z", officeholders, divisions, unmatched: [] },
  };
}

export function installStateLegislators(scope: OfficialStateVoteScope, value: OfficialStateLegislatorReadModel = syntheticStateLegislators(scope)): OfficialStateLegislatorReadModel {
  stateLegislators[scope] = value;
  enter();
  return value;
}


export function stateMoneyFixture(state: StateCampaignFinanceJurisdiction): StateMoneySnapshot {
  return (JSON.parse(readFileSync(join(ROOT, "tests/fixtures/state-money-2026.json"), "utf8")) as Record<StateCampaignFinanceJurisdiction, StateMoneySnapshot>)[state];
}

export async function installStateMoney(state: StateCampaignFinanceJurisdiction, value: StateMoneySnapshot = stateMoneyFixture(state)): Promise<StateMoneySnapshot> {
  const contract = STATE_CAMPAIGN_FINANCE_SOURCES[state];
  installPromotedValue({ recordClass: "STATE_CAMPAIGN_FINANCE", scope: contract.scope, sourceId: contract.sourceId, versionId: `test:state-money:${state}`, value });
  served(await refreshStateMoneyProjectionFromPromoted(state) as CivicDataReadResult<StateMoneySnapshot>, `${state} campaign money`);
  return value;
}

export function syntheticFiledStateMoneyRecord(state: StateCampaignFinanceJurisdiction, targetKey: string, receipts = 1000): StateMoneySnapshot["records"][number] {
  const template = stateMoneyFixture(state).records.find((record) => record.filingState === "FILED") ?? stateMoneyFixture("AZ").records.find((record) => record.filingState === "FILED")!;
  const name = "Synthetic Test Committee";
  return {
    ...structuredClone(template),
    jurisdiction: state,
    committeeId: `test-${targetKey}`,
    registeredName: name,
    candidateNameAsFiled: name,
    totals: { ...template.totals, receipts, expenditures: Math.round(receipts / 2) },
    targetKeys: [targetKey],
    match: { ...template.match!, registeredName: name },
  };
}


export interface SyntheticLineupNominee {
    readonly name: string;
  readonly partyLabel: string;
  readonly outcome: LineupOutcome;
    readonly candidacyId?: string;
    readonly filingParty?: string;
}

export interface SyntheticContest {
  readonly id: string;
  readonly title: string;
    readonly ocdId?: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly lineup?: readonly SyntheticLineupNominee[];
}

const AZ_STATE = "ocd-division/country:us/state:az";
const AZ_ELECTION = "az-2026-general-test";
const AZ_PROVENANCE = { sourceUrl: "https://example.test/az-ballot", sourceOrg: "Synthetic test ballot", collectedAt: "2026-09-25", verifiedAt: null };
export const AZ_TEST_CANVASS_URL = "https://example.test/az-canvass.pdf";
export const AZ_TEST_FILINGS_URL = "https://example.test/az-candidate-filings.pdf";

export function syntheticAzBallot(contests: readonly SyntheticContest[] = [{
  id: "ballot-az-test:synthetic-office",
  title: "Synthetic Office",
  candidacies: [{ id: "ballot-az-test:synthetic-office:candidate-a", givenName: "Alex", familyName: "Candidate" }],
}]): AzBallotProjection {
  const ballotContests: Contest[] = [];
  const candidacies: Candidacy[] = [];
  const identityContests: AzContestIdentity[] = [];
  const identities: AzCandidateIdentity[] = [];
  const rows: LineupReconciliationRow[] = [];
  const identityOf = (candidacyId: string) => `az-2026:candidate:${candidacyId}`;
  for (const contest of contests) {
    const ocdId = contest.ocdId ?? AZ_STATE;
    ballotContests.push({
      id: contest.id, electionId: AZ_ELECTION, ocdId, divisionVintage: "2026", title: contest.title,
      type: contest.type ?? "CANDIDACY", voteFor: 1, termYears: 4, scopeNote: null, provenance: AZ_PROVENANCE,
    });
    identityContests.push({
      identityId: `az-2026:contest:${contest.id}`, office: contest.title, ocdId, level: "STATE",
      financeFilingAuthority: "Arizona Secretary of State", canonicalContestIds: [contest.id],
    });
    for (const candidacy of contest.candidacies ?? []) {
      candidacies.push({
        id: candidacy.id, contestId: contest.id, familyName: candidacy.familyName, givenName: candidacy.givenName,
        partyLabel: candidacy.partyLabel ?? null, slogan: null, incumbent: null, websiteUrl: null, provenance: AZ_PROVENANCE,
      });
      const displayName = `${candidacy.givenName} ${candidacy.familyName}`;
      identities.push({
        identityId: identityOf(candidacy.id), contestIdentityId: `az-2026:contest:${contest.id}`, displayName,
        givenName: candidacy.givenName, familyName: candidacy.familyName, nameForms: [], partyLabel: candidacy.partyLabel ?? null,
        candidacyAuthority: "Arizona Secretary of State", candidacySourceUrl: AZ_TEST_FILINGS_URL, canonicalCandidacyId: candidacy.id, committees: [],
      });
    }
    for (const nominee of contest.lineup ?? []) {
      const matched = nominee.candidacyId ? [identityOf(nominee.candidacyId)] : [];
      const reconciled = nominee.outcome === "RECONCILED";
      rows.push({
        cardKey: `${contest.id}|${nominee.name}`,
        contestId: contest.id,
        nomineeName: nominee.name,
        nomineePartyLabel: nominee.partyLabel,
        outcome: nominee.outcome,
        candidateIdentityId: reconciled ? matched[0] ?? null : null,
        canonicalCandidacyId: reconciled ? nominee.candidacyId ?? null : null,
        sourceValues: {
          canvassName: nominee.name,
          canvassParty: nominee.partyLabel,
          registryName: matched.length ? nominee.name : null,
          registryParty: nominee.filingParty ?? (matched.length ? nominee.partyLabel : null),
          registryCandidateIds: matched,
        },
        basis: {
          contestAgrees: true, partyChecked: true, partyAgrees: nominee.outcome === "PARTY_CONFLICT" ? false : reconciled ? true : null,
          sharedNameForm: matched.length ? nominee.name : null, sharedNameFormRules: [], note: "synthetic test row",
        },
        readerGapSentence: reconciled ? null : "We have not established that this nominee is the same candidacy as a filing.",
      });
    }
  }
  const sources = [
    { name: "Synthetic certified canvass", url: AZ_TEST_CANVASS_URL, readAt: "2026-09-25", note: "test" },
    { name: "Synthetic candidate filings", url: AZ_TEST_FILINGS_URL, readAt: "2026-09-25", note: "test" },
  ];
  const lineupContests = contests.filter((contest) => contest.lineup?.length).map((contest) => ({
    contestId: contest.id,
    nominees: contest.lineup!.map((nominee) => ({ name: nominee.name, partyLabel: nominee.partyLabel, note: null })),
  }));
  return {
    ballot: { formatVersion: 1, election: { id: AZ_ELECTION, date: "2026-11-03", name: "2026 General Election (test)", state: "AZ" }, contests: ballotContests, candidacies, measures: [], absences: [] },
    generalLineup: {
      curatedAt: "2026-09-25",
      canvass: { title: "Synthetic certified canvass", url: AZ_TEST_CANVASS_URL, issuedBy: "Synthetic", reportDate: "2026-09-25", readAt: "2026-09-25", readNote: "test" },
      note: "synthetic test lineup",
      contests: lineupContests,
    },
    measureAnalyses: { generatedAt: "2026-09-25", counts: { measures: 0, fetched: 0, extracted: 0, failed: 0 }, analyses: [] },
    candidateFilings: {},
    identityRegistry: {
      formatVersion: 1, state: "AZ", cycle: 2026, generatedAt: "2026-09-25", generatedBy: "tests/helpers/promoted-fixtures.ts", sources,
      denominators: {
        contests: identityContests.length, candidates: identities.length, candidatesWithCanonicalCandidacyId: identities.length,
        candidatesWithoutCanonicalCandidacyId: 0, candidatesWithCommitteeIdentity: 0, nonFederalCandidates: identities.length, federalCandidates: 0,
      },
      contests: identityContests,
      candidates: identities,
    },
    lineupReconciliation: {
      formatVersion: 1, state: "AZ", cycle: 2026, generatedAt: "2026-09-25", generatedBy: "tests/helpers/promoted-fixtures.ts", sources,
      proof: {
        lineupContests: lineupContests.length, lineupNominees: rows.length,
        uniquelyReconciled: rows.filter((row) => row.outcome === "RECONCILED").length,
        ambiguous: rows.filter((row) => row.outcome === "AMBIGUOUS_MULTIPLE_CANDIDATES").length,
        unmatched: rows.filter((row) => row.outcome === "NO_CANDIDATE_MATCH").length,
        duplicateTargetCollisions: 0, applicableNonFederalNominees: rows.length,
        applicableNonFederalReconciled: rows.filter((row) => row.outcome === "RECONCILED").length,
        applicableNonFederalUnresolved: rows.filter((row) => row.outcome !== "RECONCILED").length,
      },
      agencyNextFilingDue: null,
      rows,
    },
  } as AzBallotProjection;
}

export async function installAzBallot(value: AzBallotProjection = syntheticAzBallot()): Promise<AzBallotProjection> {
  installManualValue("az-sos-ballot", value, "test:az-sos-ballot");
  served(await readAzBallotProjection(), "Arizona ballot");
  resetAzIdentityCache();
  return value;
}


export function syntheticPimaLocalFinance(over: { readonly held?: Partial<AzPimaFinanceReadModel["held"]>; readonly transactions?: Partial<AzPimaFinanceReadModel["transactions"]> } = {}): AzPimaFinanceReadModel {
  return {
    formatVersion: 1,
    held: {
      formatVersion: 1,
      recordedOn: "2026-09-25",
      filingAuthorityIdentification: {
        authorityId: "test-county-filing-officer",
        officeNameAsPublished: "County Elections (test)",
        readFrom: "https://example.test/county-filings",
        readOn: "2026-09-25",
        whatThisEstablishesAndWhatItDoesNot: "A synthetic test holding; it establishes nothing about any real filing.",
      },
      committeeRegisterCountyPortal: [],
      committeeRegisterStateFtp: [],
      filingsIndexed: [],
      expectedFilingPeriodsAz2026PacParty: [],
      acquisitions: [],
      notHeld: [],
      ...over.held,
    },
    transactions: {
      formatVersion: 1,
      recordedOn: "2026-09-25",
      acquisition: {},
      reconciliation: { capSuspected: false, verdict: "synthetic", probes: [] },
      limitsOfThisUniverse: [],
      counts: {},
      contributions: [],
      distributions: [],
      ...over.transactions,
    },
  };
}

export async function installPimaLocalFinance(value: AzPimaFinanceReadModel = syntheticPimaLocalFinance()): Promise<AzPimaFinanceReadModel> {
  installPromotedValue({ recordClass: "LOCAL_CAMPAIGN_FINANCE", scope: PIMA_LOCAL_FINANCE_CONTRACT.scope, sourceId: PIMA_LOCAL_FINANCE_CONTRACT.sourceId, versionId: "test:pima-local-finance", value });
  await refreshAzPimaFinanceFromPromoted();
  return value;
}


const SUBJECT_WORDS = [
  "orchards", "wetlands", "harbors", "bridges", "libraries", "clinics", "canyons", "meadows", "rivers", "forests",
  "railways", "gardens", "prairies", "islands", "valleys", "summits", "beaches", "deserts", "lagoons", "glaciers",
  "fountains", "lighthouses", "vineyards", "pastures", "quarries", "foothills", "marshes", "terraces", "plateaus", "estuaries",
  "boulevards", "aqueducts", "greenways", "trailheads", "riverbanks", "seashores", "woodlands", "highlands", "lowlands", "headwaters",
];

const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");

function ownWordsText(word: string, who: string): string {
  return [
    `We will protect the ${word} that make this community a good place to live.`,
    `Every family deserves safe streets, clean water, and well kept ${word} near home.`,
    `I have spent years listening to neighbors about housing costs and the future of our ${word}.`,
    `Our plan funds local schools and keeps public services open on weekends.`,
    `We must protect our water supply for every family in this district.`,
    `${who} believes good government answers questions plainly and on time.`,
  ].join(" ");
}

export const UNQUOTABLE_CANDIDATE_KEY = "ballot-zz-test:synthetic-office:candidate-rail";
export const UNQUOTABLE_TERM = "mining";

export function syntheticCandidateCorpus(candidates = 30): CandidateCorpus {
  const documents: CandidateDocument[] = [];
  const add = (key: string, url: string, text: string, metaDescription: string | null) => {
    const contentHash = sha256Hex(text);
    documents.push({
      id: `${key}@${contentHash}`, candidateKey: key, sourceClass: "CAMPAIGN_SITE", basis: "HUNTED_AND_VERIFIED", metaDescription,
      documentUrl: url, contentHash, retrievedAt: "2026-09-20T00:00:00.000Z", contentType: "text/html", text, extraction: "html", extractionNote: null,
    });
  };
  for (let i = 0; i < candidates; i++) {
    const word = SUBJECT_WORDS[i % SUBJECT_WORDS.length]!;
    const key = `ballot-zz-test:synthetic-office:candidate-${i + 1}`;
    const site = `https://candidate-${i + 1}.example.org/`;
    add(key, site, ownWordsText(word, `Candidate ${i + 1}`), `Candidate ${i + 1} is running to serve this community and to care for its ${word}.`);
    add(key, `${site}issues`, ownWordsText(word, `Candidate ${i + 1}`).replace("Our plan", "My plan"), null);
  }
  const rail = `Home About News Events Volunteer Donate Contact ${"Latest Updates From The Campaign Trail Press Releases Photo Gallery Endorsements ".repeat(6)}Statement on ${UNQUOTABLE_TERM} permits Read More`;
  add(UNQUOTABLE_CANDIDATE_KEY, "https://candidate-rail.example.org/", `${rail}. ${ownWordsText("parklands", "This candidate")}`, null);
  return { formatVersion: 1, fetchedAt: "2026-09-20T00:00:00.000Z", attempted: candidates + 1, documents, failures: [] };
}

export async function installCandidateCorpus(value: CandidateCorpus = syntheticCandidateCorpus()): Promise<CandidateCorpus> {
  installManualValue("candidate-corpus", value, "test:candidate-corpus");
  served(await readCandidateCorpusProjection(), "Candidate publications");
  return value;
}

export function syntheticOfficeholderStatements(subjects: readonly string[] = Array.from({ length: 24 }, (_, i) => `statement-subject:${i + 1}`)): StatementCorpus {
  const snapshots: SourceSnapshot[] = subjects.map((subjectId, i) => {
    const text = ownWordsText(SUBJECT_WORDS[(i + 7) % SUBJECT_WORDS.length]!, "This office");
    const url = `https://official-${i + 1}.example.gov/statements`;
    const contentHash = sha256Hex(text);
    return {
      id: `${subjectId}|${url}|${contentHash}`, subjectId, subjectName: `Official ${i + 1}`, kind: "OFFICIAL_PAGE", url, contentHash,
      retrievedAt: "2026-09-20T00:00:00.000Z", httpStatus: 200, extraction: "ok", text, title: null,
    };
  });
  return { snapshots };
}

export async function installOfficeholderStatements(value: StatementCorpus = syntheticOfficeholderStatements()): Promise<StatementCorpus> {
  installManualValue("officeholder-statements", value, "test:officeholder-statements");
  served(await readOfficeholderStatementsProjection(), "Officeholder statements");
  return value;
}


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function syntheticFederalRollCalls(directory: FederalDirectoryReadModel = syntheticFederalDirectory(), perChamber = 20): FederalRollCallsReadModel {
  const votes: RollCallVote[] = [];
  const positions: MemberVote[] = [];
  const summaries: FederalRollCallsReadModel["billSummaries"]["summaries"] = {};
  const members = { house: directory.roster.officeholders.filter((row) => row.chamber === "house"), senate: directory.roster.officeholders.filter((row) => row.chamber === "senate") };
  for (const chamber of ["house", "senate"] as const) {
    for (let n = 1; n <= perChamber; n++) {
      const day = String(n).padStart(2, "0");
      const bill = chamber === "house" ? 9000 + n : 4000 + n;
      const legisNum = chamber === "house" ? `H.R. ${bill}` : `S. ${bill}`;
      const billUrl = `https://www.congress.gov/bill/119th-congress/${chamber === "house" ? "house-bill" : "senate-bill"}/${bill}`;
      const id = `${chamber}:119-2:${n}`;
      votes.push({
        id, chamber, congress: 119, session: 2, rollNumber: n,
        date: chamber === "house" ? `${day}-${MONTHS[6]}-2026` : `2026-07-${day}`,
        title: `Synthetic Test Act ${n}`, titleSource: "BILL_TITLE", question: "On Passage", legisNum,
        result: n % 2 ? "Passed 230–200" : "Failed 200–230", billUrl,
        rollCallUrl: chamber === "house" ? `https://clerk.house.gov/Votes/2026${String(n).padStart(3, "0")}` : `https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_${String(n).padStart(5, "0")}.htm`,
        retrievedAt: "2026-09-20T00:00:00.000Z",
      });
      summaries[billUrl] = { legisNum, title: `Synthetic Test Act ${n}`, summary: `This synthetic bill ${n} would fund a test program for one year.`, basis: "synthetic test summary", curatedAt: "2026-09-20" };
      const position: VotePosition = n % 2 ? "YES" : "NO";
      for (const member of members[chamber]) positions.push({ officeholderId: member.id, voteId: id, position });
    }
  }
  return {
    formatVersion: 1,
    snapshot: {
      generatedAt: "2026-09-20T00:00:00.000Z", congress: 119, session: 2,
      window: { houseRolls: votes.filter((v) => v.chamber === "house").map((v) => v.rollNumber), senateRolls: votes.filter((v) => v.chamber === "senate").map((v) => v.rollNumber) },
      identifierMatch: { houseMatched: members.house.length, houseTotal: members.house.length, senateMatched: members.senate.length, senateTotal: members.senate.length },
      votes, positions,
    },
    billSummaries: { curatedAt: "2026-09-20", summaries, pending: [] },
  };
}

export function syntheticFederalKeyVotes(directory: FederalDirectoryReadModel = syntheticFederalDirectory()): FederalKeyVotesReadModel {
  const snapshot = federalKeyVoteSelectionV1Snapshot("2026-09-20T00:00:00.000Z");
  const byChamber = { house: directory.roster.officeholders.filter((row) => row.chamber === "house"), senate: directory.roster.officeholders.filter((row) => row.chamber === "senate") };
  const positions: Record<string, Record<string, VotePosition>> = {};
  for (const entry of snapshot.entries) {
    for (const chamber of ["house", "senate"] as const) {
      for (const ref of entry[chamber]) {
        positions[`${entry.id}|${chamber}|${ref.congress}-${ref.session}:${ref.rollNumber}`] = Object.fromEntries(byChamber[chamber].map((member) => [member.id, "YES" as const]));
      }
    }
  }
  return { formatVersion: 1, selectionVersion: "v1", snapshot, positions: { formatVersion: 1, fetchedAt: "2026-09-20T00:00:00.000Z", positions } };
}

export async function installFederalVotes(input: { rollCalls?: FederalRollCallsReadModel; keyVotes?: FederalKeyVotesReadModel } = {}): Promise<{ rollCalls: FederalRollCallsReadModel; keyVotes: FederalKeyVotesReadModel }> {
  const directory = federalDirectory?.value ?? syntheticFederalDirectory();
  const rollCalls = input.rollCalls ?? syntheticFederalRollCalls(directory);
  const keyVotes = input.keyVotes ?? syntheticFederalKeyVotes(directory);
  installPromotedValue({ recordClass: "FEDERAL_ROLL_CALL", scope: FEDERAL_ROLLCALL_SCOPE, sourceId: FEDERAL_VOTES_SOURCE_ID, versionId: "test:federal-roll-calls", value: rollCalls });
  installPromotedValue({ recordClass: "FEDERAL_KEY_VOTE", scope: FEDERAL_KEY_VOTE_SCOPE, sourceId: FEDERAL_VOTES_SOURCE_ID, versionId: "test:federal-key-votes", value: keyVotes });
  served(await readFederalRollCallsProjection(), "Federal roll calls");
  served(await readFederalKeyVotesProjection(), "Federal key votes");
  return { rollCalls, keyVotes };
}


export function syntheticCandidateProfiles(candidacyId = "ballot-az-test:synthetic-office:candidate-a"): CandidateProfilesProjection {
  return {
    cards: {
      curatedAt: "2026-09-25", note: "Synthetic test cards.", hunts: [],
      cards: { [candidacyId]: { photoUrl: null, photoSource: null, bio: "A synthetic candidate who is running for a synthetic office.", bioSourceUrl: "https://candidate-a.example.test/about",
        bioSourceLabel: "Campaign site", email: null, phone: null, phoneLabel: null, filedAddress: null, filedAddressSource: null } },
    },
    links: {
      curatedAt: "2026-09-25", note: "Synthetic test links.", hunts: [],
      links: { [candidacyId]: { official: null, campaign: { url: "https://candidate-a.example.test/", verification: "Synthetic test link.", attemptedAt: "2026-09-25" } } },
    },
  } as CandidateProfilesProjection;
}


export function syntheticNhBallot(county = "merrimack"): NhBallotProjection {
  const provenance = { sourceUrl: "https://example.test/nh-ballot", sourceOrg: "Synthetic test ballot", collectedAt: "2026-09-25", verifiedAt: null };
  const election = "nh-2026-general-test";
  const contest = (id: string, title: string, ocdId: string) => ({ id, electionId: election, ocdId, divisionVintage: "2026", title, type: "CANDIDACY" as const, voteFor: 1, termYears: 2, scopeNote: null, provenance });
  const candidacy = (id: string, contestId: string, givenName: string, familyName: string) => ({ id, contestId, givenName, familyName, partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance });
  return {
    ballot: {
      formatVersion: 1,
      election: { id: election, date: "2026-11-03", name: "2026 General Election (test)", state: "NH" },
      contests: [
        contest("ballot-nh-test:governor", "Governor", "ocd-division/country:us/state:nh"),
        contest("ballot-nh-test:county-treasurer", "County Treasurer", `ocd-division/country:us/state:nh/county:${county}`),
      ],
      candidacies: [
        candidacy("ballot-nh-test:governor:example-casey", "ballot-nh-test:governor", "Casey", "Example"),
        candidacy("ballot-nh-test:county-treasurer:other-robin", "ballot-nh-test:county-treasurer", "Robin", "Other"),
      ],
      measures: [],
      absences: [],
    },
  };
}
