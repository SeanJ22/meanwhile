/**
 * Small promoted values installed the way production reads them.
 *
 * Production never opens bundled data: a reader request reads each family from the reader authority edge
 * (the runner-published copy of the promoted pointer), and the runner reads the database pointer. These
 * installers put a small, explicit value on that same edge for the test process (`enterReaderAuthorityEdge`),
 * and prime the family's synchronous read state from it, so the code under test takes the production path
 * unchanged. Nothing here reads a deleted seed file; the registry comes from the recorded transfer-time
 * import fixture, and every other family is a small synthetic value the test names.
 *
 * Call an installer at module top level (before any `test(...)`), or at the top of a test body: the edge
 * is entered synchronously, before the installer's first await, so it reaches every later await in the
 * caller's async context. A test that runs its own `withReaderAuthorityEdge(bundle, ...)` replaces the
 * context for that call; merge `promotedFixtureBundle()` into its bundle to keep these families.
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
import { primeFederalDirectoryFromValue, readFederalDirectoryProjection } from "../../lib/officials/federal-directory-read-model.ts";
import type { Officeholder, OfficeholderDivision } from "../../lib/officials/types.ts";
import type { DirectoryFile } from "../../lib/officials/directory.ts";
import { requiredManualProductionContract, type ManualProductionContractId } from "../../lib/civic-data/manual-contracts.ts";
import { provenEdgeEntry } from "./promoted-edge-entry.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const REGISTRY_FIXTURE = join(ROOT, "tests/fixtures/registry-transfer-import.json.gz");

/* ------------------------------------------------------------------ the process edge */

let registryRuntime: ReaderAuthorityEdgeBundle["registryRuntime"];
let federalDirectory: ReaderAuthorityEdgeBundle["federalDirectory"];
const promoted = new Map<string, PromotedEdgeEntry>();

/** The edge bundle the installers have built so far, to merge into a test's own `withReaderAuthorityEdge`. */
export function promotedFixtureBundle(extra: ReaderAuthorityEdgeBundle = {}): ReaderAuthorityEdgeBundle {
  return {
    ...(registryRuntime ? { registryRuntime } : {}),
    ...(federalDirectory ? { federalDirectory } : {}),
    ...extra,
    promoted: new Map([...promoted, ...(extra.promoted ?? [])]),
  };
}

/*
 * One live bundle for the process: later installs change what it serves, so a context that entered it
 * once (the test module's top level) sees every family installed after, even from inside another async
 * function.
 */
const live: ReaderAuthorityEdgeBundle = {
  get registryRuntime() { return registryRuntime; },
  get federalDirectory() { return federalDirectory; },
  promoted,
};

function enter(): void {
  enterReaderAuthorityEdge(live);
}

/**
 * Install one proven pointer on the process edge. Every typed Reader (`readPromotedCivicData` with no
 * injected store) answers it PROMOTED, with the receipt and attestation production checks.
 */
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

/** Install a manual production contract's pointer (ballots, candidate corpus, statements, ...). */
export function installManualValue<T>(id: ManualProductionContractId, value: T, versionId: string = `test:${id}`) {
  const contract = requiredManualProductionContract(id);
  return installPromotedValue({ recordClass: contract.recordClass, scope: contract.scope, sourceId: contract.sourceId, versionId, value });
}

/** Mark a family answered-and-absent on the edge (`NOT_RECORDED`), as the store does when no pointer exists. */
export function installAbsent(recordClass: RoutineRecordClass, scope: string): void {
  promoted.set(`${recordClass}:${scope}`, { kind: "NOT_RECORDED", recordClass, scope });
  enter();
}

/** Drop everything the installers put on the edge (tests that assert the unconfigured path). */
export function clearPromotedFixtures(): void {
  registryRuntime = undefined;
  federalDirectory = undefined;
  promoted.clear();
  enter();
}

function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}

/* ------------------------------------------------------------------ registry runtime */

interface RegistryFixture {
  readonly record: CandidateVersionRecord;
  readonly projection: PromotedProjection<RegistryRuntimeReadModel>;
}

let registryFixture: RegistryFixture | null = null;

/** The recorded transfer-time registry import (`tests/fixtures/registry-transfer-import.json.gz`). */
export function registryTransferImport(): RegistryFixture {
  registryFixture ??= JSON.parse(gunzipSync(readFileSync(REGISTRY_FIXTURE)).toString("utf8")) as RegistryFixture;
  return registryFixture;
}

/** A memory store holding the registry import's candidate and promoted pointer, for tests that inject a store. */
export function registryRuntimeStore(store: MemoryRoutineDataStore = new MemoryRoutineDataStore()): MemoryRoutineDataStore {
  const { record, projection } = registryTransferImport();
  const held = store as unknown as { candidates: Map<string, CandidateVersionRecord>; promotions: Map<string, PromotedProjection> };
  held.candidates.set(record.candidate.id, record);
  held.promotions.set(projection.key, projection);
  return store;
}

/**
 * The registry runtime (divisions, bodies, rosters) from the recorded import: on the process edge as the
 * reader's registry-runtime artifact and as the proven pointer, with the synchronous projection primed.
 */
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
  primeRegistryRuntimeFromValue(installed.value, installed.versionId);
  served(await readRegistryRuntimeProjection(), "Registry runtime");
  primeRegistryRuntimeFromValue(installed.value, installed.versionId);
  return installed;
}

/* ------------------------------------------------------------------ federal directory */

const FEDERAL_SHA = "f".repeat(40);
const FEDERAL_COLLECTED = "2026-09-25";

function bioguide(n: number): string {
  return `T${String(n).padStart(6, "0")}`;
}

function federalHolder(n: number, input: { state: string; chamber: "house" | "senate"; label: string }): Officeholder {
  return {
    id: `congress:${bioguide(n)}`,
    name: `${input.chamber === "senate" ? "Senator" : "Representative"} ${input.label}`,
    officeTitle: input.chamber === "senate" ? "U.S. Senator" : "U.S. Representative",
    level: "FEDERAL",
    termStart: input.chamber === "senate" ? "2025-01-03" : "2025-01-03",
    termEnd: input.chamber === "senate" ? "2031-01-03" : "2027-01-03",
    birthDate: null,
    partyLabel: null,
    websiteUrl: null,
    contactFormUrl: null,
    phone: null,
    email: null,
    campaignUrl: null,
    photo: null,
    state: input.state.toUpperCase(),
    chamber: input.chamber,
    provenance: {
      sourceUrl: `https://github.com/unitedstates/congress-legislators/blob/${FEDERAL_SHA}/legislators-current.yaml`,
      sourceOrg: "unitedstates/congress-legislators (community project)",
      collectedAt: FEDERAL_COLLECTED,
      verifiedAt: null,
    },
  };
}

/**
 * A synthetic federal directory over the registry's own divisions: two senators for every state division
 * and one representative for every congressional-district division the registry holds, each joined to a
 * directory entry, plus enough committees to meet the directory's completeness checks. Names are labels
 * ("Representative AZ-7"), never real people.
 */
export function syntheticFederalDirectory(registry: RegistryRuntimeReadModel = registryTransferImport().projection.payload): FederalDirectoryReadModel {
  const officeholders: Officeholder[] = [];
  const divisions: OfficeholderDivision[] = [];
  const byMember: DirectoryFile["byMember"] = {};
  const committees: DirectoryFile["committees"] = {};
  for (let c = 1; c <= 45; c++) {
    const id = `TC${String(c).padStart(2, "0")}`;
    committees[id] = { name: `Test Committee ${c}`, type: c % 2 ? "house" : "senate", url: null, jurisdiction: null, jurisdictionSource: null };
  }
  const committeeIds = Object.keys(committees);
  let n = 0;
  const add = (ocdId: string, state: string, chamber: "house" | "senate", label: string) => {
    n += 1;
    const holder = federalHolder(n, { state, chamber, label });
    officeholders.push(holder);
    divisions.push({ officeholderId: holder.id, ocdId, bodyId: null });
    byMember[bioguide(n)] = {
      districtOffices: [],
      committees: [{ committeeId: committeeIds[n % committeeIds.length]!, name: committees[committeeIds[n % committeeIds.length]!]!.name, rank: null, title: null }],
    };
  };
  const districts = registry.registry.divisions.filter((division) => division.divisionType === "cd")
    .map((division) => /^(ocd-division\/country:us\/(state|district):([a-z]{2}))\/cd:([\w-]+)$/.exec(division.ocdId))
    .filter((match): match is RegExpExecArray => match !== null);
  // Senators for each state the districts name (DC elects none).
  for (const state of [...new Set(districts.filter((m) => m[2] === "state").map((m) => m[1]!))].sort()) {
    const usps = state.slice(-2);
    add(state, usps, "senate", `${usps.toUpperCase()} 1`);
    add(state, usps, "senate", `${usps.toUpperCase()} 2`);
  }
  for (const match of districts) add(match[0]!, match[3]!, "house", `${match[3]!.toUpperCase()}-${match[4]!}`);
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

/** The synthetic federal directory, on the process edge and primed. */
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
  enter();
  served(await readFederalDirectoryProjection(), "Federal directory");
  primeFederalDirectoryFromValue(value, versionId);
  return installed;
}

/** Registry runtime and federal directory together: what the representation and coverage graph read. */
export async function installRegistryAuthority(): Promise<void> {
  await installRegistryRuntime();
  await installFederalDirectory();
}
