import type { RoutineDataStore } from "../../civic-data/store.ts";
import type { DoorRepository } from "../../doors/registry.ts";
import { upsertDerivedDoor } from "../../doors/registry.ts";
import { recordDoorEvidence } from "../../doors/shut.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import { civicCandidate, failureCandidate, parseFailureCandidate } from "./publication.ts";
import { readCivicApi, recordCivicCatalogFailure, CivicSourceError, type CivicReadOptions } from "./acquisition.ts";
import { civicElectionRows, civicLookupFromRaw, type CivicStateCoverage } from "./model.ts";
import { GOOGLE_CIVIC_CONTRACT_ID, GOOGLE_CIVIC_SCOPE, GOOGLE_CIVIC_STATES, civicGovernmentScope, civicStateScope } from "./targets.ts";
import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";
import { readRegistrationProjection } from "../../registration/reader.ts";
import { requiredRoutineContract } from "../../civic-data/contracts.ts";
import { routineTaskFromContract, routineTaskDue } from "../../civic-data/runner.ts";
import { readCivicProjection } from "./reader.ts";

export async function refreshGoogleCivic(input: {
  store: RoutineDataStore;
  doors?: DoorRepository;
  readOptions?: CivicReadOptions;
  /** Each state's already-held official government inventory supplies public office addresses. */
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
      if (!electionId) report.reason = "Google Civic has not published the November 3 national election.";
      else {
        const knownIds = new Set(registration.value.divisions.map(row => row.ocdId));
        const outcomes = await runBoundedWorkPool(targets, 8, async government => {
          const scope = civicGovernmentScope(government.id), doorId = `google-civic:${government.id}`;
          const now = (options.now ?? (() => new Date().toISOString()))();
          const clock = await input.store.clock(GOOGLE_CIVIC_CONTRACT_ID, task.recordClass, scope, task.parserVersion);
          // A bounded pass resumes from each public target's durable source clock, so a large state cannot starve later states.
          if (!routineTaskDue(task, clock, Date.parse(now))) {
            const held = await readCivicProjection(scope, { store: input.store, now });
            if (held.kind === "PROMOTED" && held.value.kind === "LOOKUP" && held.value.electionId === electionId) return held.value.counts;
          }
          if (input.doors) await upsertDerivedDoor(input.doors, { doorId, kind: "source-feed", ocdId: government.associations[0]?.divisionId ?? null,
            bodyIds: government.bodyIds, hosts: ["www.googleapis.com"], config: { contractId: GOOGLE_CIVIC_CONTRACT_ID, governmentId: government.id, keyRef: "GOOGLE_CIVIC_API_KEY" },
            holds: ["google-civic-voterinfo"], notes: "Public government-address voterinfo probe; does not assign a resident's ballot or polling place." }, now, now);
          let acquired: Awaited<ReturnType<typeof readCivicApi>> | null = null;
          try {
            acquired = await readCivicApi("voterinfo", { address: government.officeAddress!, electionId }, options);
            const lookup = civicLookupFromRaw(acquired.raw, electionId, acquired.checkedAt, knownIds);
            if (lookup.state !== state) throw new Error("Public government address resolved in another state.");
            const candidate = civicCandidate(scope, lookup, [acquired.raw], "voterinfo");
            const outcome = await processRegisteredFanOutCandidate(input.store, GOOGLE_CIVIC_CONTRACT_ID, candidate, acquired.checkedAt);
            if (!outcome.promoted && !outcome.confirmed) throw new Error("Google Civic observations did not publish.");
            if (input.doors) await recordDoorEvidence(input.doors, doorId, { kind: "GOOD", rows: lookup.rows.length }, acquired.checkedAt);
            return lookup.counts;
          } catch (error) {
            const reason = error instanceof CivicSourceError ? error.reason : "Google Civic public-address response could not be parsed or published.";
            await processRegisteredFanOutCandidate(input.store, GOOGLE_CIVIC_CONTRACT_ID,
              acquired ? parseFailureCandidate(scope, acquired.raw, reason, acquired.checkedAt) : failureCandidate(scope, reason, now),
              acquired?.checkedAt ?? now);
            if (input.doors) await recordDoorEvidence(input.doors, doorId, error instanceof CivicSourceError && error.status !== null
              ? { kind: "HTTP", httpStatus: error.status } : { kind: "PARSE_FAILURE", detail: reason }, now);
            return null;
          }
        });
        for (const result of outcomes) {
          if (!result.ok || result.value === null) report.unavailable++;
          else { report.checked++; report.loaded += result.value.loaded; report.joined += result.value.joined; report.unjoined += result.value.unjoined; }
        }
      }
    }
    if (report.withoutAddress) report.reason = `${report.withoutAddress} held governments have no public office address for a voterinfo query.`;
    coverage.push(report);
    const checkedAt = (options.now ?? (() => new Date().toISOString()))();
    // A state summary retains both unreachable doors and successful zero-row reads.
    const marker = civicCandidate(civicStateScope(state), { formatVersion: 1, kind: "STATE", checkedAt, rows: elections, coverage: [report] }, [catalog.raw], "elections");
    await processRegisteredFanOutCandidate(input.store, GOOGLE_CIVIC_CONTRACT_ID, marker, checkedAt);
  }
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  coverage.sort((a, b) => a.state.localeCompare(b.state));
  const candidate = civicCandidate(GOOGLE_CIVIC_SCOPE, { formatVersion: 1, kind: "CATALOG", checkedAt, rows: elections, coverage }, [catalog.raw], "elections");
  const outcome = await processRegisteredRoutineCandidate(input.store, GOOGLE_CIVIC_CONTRACT_ID, candidate, checkedAt);
  return { candidate, outcome, coverage };
}
