import type { RoutineDataStore } from "../../civic-data/store.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import { civicCandidate } from "./publication.ts";
import { readCivicApi, recordCivicCatalogFailure, CivicSourceError, type CivicReadOptions } from "./acquisition.ts";
import { civicElectionRows } from "./model.ts";
import { GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_ELECTION_DAY, GOOGLE_CIVIC_SCOPE, GOOGLE_CIVIC_STATES, civicStateScope } from "./targets.ts";
import { readRegistrationProjection } from "../../registration/reader.ts";
import { requiredRoutineContract } from "../../civic-data/contracts.ts";
import { routineTaskFromContract } from "../../civic-data/runner.ts";
import { readPromotedCivicData } from "../../civic-data/read-model.ts";
import { stateBallotScope } from "../../civic-data/state-scopes.ts";
import { readRegistryRuntimePrior } from "../../registry/runtime-data-plane.ts";
import type { Body } from "../../registry/types.ts";
import type { RegistrationReadModel } from "../../registration/candidate.ts";
import type { VotingSitesFile } from "../../ballot/voting-sites.ts";
import type { CountyCivicCoverage, CountyCivicStateCoverage } from "./coverage.ts";

const electionOffice = /\b(?:elections?|voter registration|registrar of voters|supervisor of elections)\b/i;
export interface CountyCivicProbeTarget { countyFips: string; address: string }

/** A county hall or a school's contact is not evidence of an election-office address. */
export function countyCivicProbeTargets(registration: Pick<RegistrationReadModel, "divisions" | "bodies" | "governments">,
  votingSites: VotingSitesFile | null, reviewedBodies: readonly Body[] = []): { counties: number; targets: CountyCivicProbeTarget[] } {
  const counties = registration.divisions.filter(division => division.divisionType === "county" && /^\d{5}$/.test(division.geoid ?? ""));
  const byDivision = new Map<string, string>(counties.map(division => [division.ocdId, division.geoid]));
  const targets = new Map<string, CountyCivicProbeTarget>();
  const add = (countyFips: string | undefined, address: string | null | undefined) => {
    if (countyFips && address?.trim() && !targets.has(countyFips)) targets.set(countyFips, { countyFips, address: address.trim() });
  };
  // A parsed election-office contact is already scoped by the official directory's county mapping.
  for (const jurisdiction of votingSites?.jurisdictions ?? []) if (jurisdiction.office?.address) {
    add(byDivision.get(jurisdiction.ocdId), jurisdiction.office.address);
  }
  for (const body of [...reviewedBodies, ...(registration.bodies ?? [])]) {
    if (body.ocdId && body.name && electionOffice.test(body.name)) add(byDivision.get(body.ocdId), body.officeAddress);
  }
  for (const government of registration.governments ?? []) if (electionOffice.test(`${government.name} ${government.contactTitle ?? ""}`)) {
    const counties = new Set(government.associations.flatMap(association => byDivision.get(association.divisionId) ?? []));
    if (counties.size === 1) add([...counties][0], government.officeAddress);
  }
  return { counties: counties.length, targets: [...targets.values()].sort((a, b) => a.countyFips.localeCompare(b.countyFips)) };
}

/** The raw voterinfo response dies in this call; its only output is yes/no and three counts. */
export async function probeCountyCivicCoverage(target: CountyCivicProbeTarget, electionId: string, options: CivicReadOptions): Promise<CountyCivicCoverage> {
  try {
    const response = await readCivicApi("voterinfo", { address: target.address, electionId }, options);
    const data = JSON.parse(response.raw) as Record<string, unknown>;
    const election = data?.election as { id?: string; electionDay?: string } | undefined;
    if (election?.id !== electionId || election.electionDay !== GOOGLE_CIVIC_ELECTION_DAY) throw new Error("Google Civic returned a different election.");
    const count = (field: string): number => {
      const value = data[field];
      if (value !== undefined && (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row)))) throw new Error("Google Civic returned an invalid site list.");
      return Array.isArray(value) ? value.length : 0;
    };
    const pollingLocations = count("pollingLocations"), earlyVoteSites = count("earlyVoteSites"), dropOffLocations = count("dropOffLocations");
    return { countyFips: target.countyFips, available: pollingLocations + earlyVoteSites + dropOffLocations > 0, pollingLocations, earlyVoteSites, dropOffLocations };
  } catch (error) {
    // A missing address result is a no; transport, quota and parsing failures remain unmeasured.
    if (!(error instanceof CivicSourceError) || error.failureReason !== "NO_DATA") throw error;
    return { countyFips: target.countyFips, available: false, pollingLocations: 0, earlyVoteSites: 0, dropOffLocations: 0 };
  }
}

export async function refreshGoogleCivic(input: {
  store: RoutineDataStore;
  vault: EvidenceStore;
  readOptions?: CivicReadOptions;
  /** Existing official contacts supply public election-office probe addresses. */
  registration?: typeof readRegistrationProjection;
  votingSites?: (state: string) => Promise<VotingSitesFile | null>;
  reviewedRegistry?: typeof readRegistryRuntimePrior;
}) {
  const options = input.readOptions ?? {};
  let catalog: Awaited<ReturnType<typeof readCivicApi>>;
  try { catalog = await readCivicApi("elections", {}, options); }
  catch (error) {
    const failed = await recordCivicCatalogFailure(input.store, error instanceof CivicSourceError ? error.reason : "Google Civic elections could not be read.", new Date().toISOString());
    return { candidate: failed.outcome.candidate.candidate, outcome: failed.outcome, coverage: [] };
  }
  const elections = civicElectionRows(catalog.raw, catalog.checkedAt, new Set(["ocd-division/country:us"]));
  const electionId = elections.find(row => row.ocdId === "ocd-division/country:us")?.electionId;
  const coverage: CountyCivicStateCoverage[] = [];
  const task = routineTaskFromContract(requiredRoutineContract(GOOGLE_CIVIC_SOURCE_ID));
  const stateClocks = await Promise.all(GOOGLE_CIVIC_STATES.map(async (state, index) => {
    const clock = await input.store.clock(GOOGLE_CIVIC_SOURCE_ID, task.recordClass, civicStateScope(state), task.parserVersion);
    const checked = Date.parse(clock.lastSucceededObservedAt ?? "");
    return { state, index, checked: Number.isFinite(checked) ? checked : -Infinity };
  }));
  // Finish states with no completed pass first after a bounded child's restart.
  stateClocks.sort((a, b) => a.checked - b.checked || a.index - b.index);
  for (const { state } of stateClocks) {
    options.signal?.throwIfAborted();
    const report: CountyCivicStateCoverage = { state, electionDate: GOOGLE_CIVIC_ELECTION_DAY, counties: [], governments: 0, addresses: 0, checked: 0, unavailable: 0, withoutAddress: 0, loaded: 0, joined: 0, unjoined: 0, reason: null };
    let registration;
    try { registration = await (input.registration ?? readRegistrationProjection)(state, { store: input.store }); }
    catch { registration = null; }
    if (registration?.kind !== "PROMOTED") report.reason = "The held government inventory could not be read for this state.";
    else {
      const [siteRead, registryRead] = await Promise.allSettled([
        input.votingSites ? input.votingSites(state) : readPromotedCivicData<VotingSitesFile>("VOTING_SITE", stateBallotScope("voting-sites", state), { store: input.store, bypassCache: true })
          .then(held => held.kind === "PROMOTED" ? held.value : null),
        (input.reviewedRegistry ?? readRegistryRuntimePrior)(input.store, catalog.checkedAt, state),
      ]);
      const sites = siteRead.status === "fulfilled" ? siteRead.value : null;
      const reviewed = registryRead.status === "fulfilled" ? registryRead.value : null;
      const inventory = countyCivicProbeTargets(registration.value, sites, reviewed?.payload.registry.bodies);
      report.governments = inventory.counties;
      report.addresses = inventory.targets.length;
      report.withoutAddress = inventory.counties - inventory.targets.length;
      report.reason = electionId ? "Each county sample uses one public election-office address. Only availability and site counts are saved."
        : "Google Civic has not published the November 3 national election.";
      if (siteRead.status === "rejected" || registryRead.status === "rejected") report.reason = "Some held election-office contacts could not be read; counties without an office address remain unmeasured.";
      if (electionId) {
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(8, inventory.targets.length) }, async () => {
          while (next < inventory.targets.length) {
            options.signal?.throwIfAborted();
            const target = inventory.targets[next++];
            try {
              const result = await probeCountyCivicCoverage(target, electionId, options);
              report.counties.push(result); report.checked++;
              if (!result.available) report.unavailable++;
              report.loaded += result.pollingLocations + result.earlyVoteSites + result.dropOffLocations;
            } catch {
              options.signal?.throwIfAborted();
              report.reason = "Some county samples could not be measured. Provider failures are left unmeasured and retried on the next scheduled pass.";
            }
          }
        }));
        report.counties.sort((a, b) => a.countyFips.localeCompare(b.countyFips));
        report.unjoined = report.loaded;
      }
    }
    coverage.push(report);
    const checkedAt = catalog.checkedAt;
    // The saved Google response is the public elections catalog; probes contribute counts only.
    const marker = await civicCandidate(input.vault, civicStateScope(state), { formatVersion: 1, kind: "STATE", checkedAt, rows: elections, coverage: [report] }, catalog.raw, "elections");
    await processRegisteredFanOutCandidate(input.store, GOOGLE_CIVIC_SOURCE_ID, marker, checkedAt);
  }
  const checkedAt = catalog.checkedAt;
  coverage.sort((a, b) => a.state.localeCompare(b.state));
  const candidate = await civicCandidate(input.vault, GOOGLE_CIVIC_SCOPE, { formatVersion: 1, kind: "CATALOG", checkedAt, rows: elections, coverage }, catalog.raw, "elections");
  const outcome = await processRegisteredRoutineCandidate(input.store, GOOGLE_CIVIC_SOURCE_ID, candidate, checkedAt);
  return { candidate, outcome, coverage };
}
