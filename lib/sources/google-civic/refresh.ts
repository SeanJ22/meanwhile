import type { RoutineDataStore } from "../../civic-data/store.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import { civicCandidate } from "./publication.ts";
import { readCivicApi, recordCivicCatalogFailure, CivicSourceError, type CivicReadOptions } from "./acquisition.ts";
import { civicElectionRows, type CivicStateCoverage } from "./model.ts";
import { GOOGLE_CIVIC_CONTRACT_ID, GOOGLE_CIVIC_SCOPE, GOOGLE_CIVIC_STATES, civicStateScope } from "./targets.ts";
import { readRegistrationProjection } from "../../registration/reader.ts";
import { requiredRoutineContract } from "../../civic-data/contracts.ts";
import { routineTaskFromContract } from "../../civic-data/runner.ts";

export async function refreshGoogleCivic(input: {
  store: RoutineDataStore;
  vault: EvidenceStore;
  readOptions?: CivicReadOptions;
  /** Existing government inventory describes coverage without sending addresses to Google. */
  registration?: typeof readRegistrationProjection;
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
  const coverage: CivicStateCoverage[] = [];
  const task = routineTaskFromContract(requiredRoutineContract(GOOGLE_CIVIC_CONTRACT_ID));
  const stateClocks = await Promise.all(GOOGLE_CIVIC_STATES.map(async (state, index) => {
    const clock = await input.store.clock(GOOGLE_CIVIC_CONTRACT_ID, task.recordClass, civicStateScope(state), task.parserVersion);
    const checked = Date.parse(clock.lastSucceededObservedAt ?? "");
    return { state, index, checked: Number.isFinite(checked) ? checked : -Infinity };
  }));
  // Finish states with no completed pass first after a bounded child's restart.
  stateClocks.sort((a, b) => a.checked - b.checked || a.index - b.index);
  for (const { state } of stateClocks) {
    options.signal?.throwIfAborted();
    const report: CivicStateCoverage = { state, governments: 0, addresses: 0, checked: 0, unavailable: 0, withoutAddress: 0, loaded: 0, joined: 0, unjoined: 0, reason: null };
    let registration;
    try { registration = await (input.registration ?? readRegistrationProjection)(state, { store: input.store }); }
    catch { registration = null; }
    if (registration?.kind !== "PROMOTED") report.reason = "The held government inventory could not be read for this state.";
    else {
      const governments = registration.value.governments ?? [];
      report.governments = governments.length;
      const targets = governments.filter(row => row.officeAddress);
      report.addresses = targets.length;
      report.withoutAddress = governments.length - targets.length;
      report.reason = electionId
        ? "Google voterinfo is queried only for an explicit reader fallback where no official voting source is loaded."
        : "Google Civic has not published the November 3 national election.";
    }
    coverage.push(report);
    const checkedAt = (options.now ?? (() => new Date().toISOString()))();
    // The state marker describes catalog/inventory coverage; it is not a voterinfo probe.
    const marker = await civicCandidate(input.vault, civicStateScope(state), { formatVersion: 1, kind: "STATE", checkedAt: catalog.checkedAt, rows: elections, coverage: [report] }, catalog.raw, "elections");
    await processRegisteredFanOutCandidate(input.store, GOOGLE_CIVIC_CONTRACT_ID, marker, checkedAt);
  }
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  coverage.sort((a, b) => a.state.localeCompare(b.state));
  const candidate = await civicCandidate(input.vault, GOOGLE_CIVIC_SCOPE, { formatVersion: 1, kind: "CATALOG", checkedAt: catalog.checkedAt, rows: elections, coverage }, catalog.raw, "elections");
  const outcome = await processRegisteredRoutineCandidate(input.store, GOOGLE_CIVIC_CONTRACT_ID, candidate, checkedAt);
  return { candidate, outcome, coverage };
}
