import { hostname } from "node:os";
import { ZERO_COST } from "../control-plane/attempt.ts";
import { readFieldManual } from "../control-plane/field-manual.ts";
import { dispatchOne } from "../control-plane/scheduler/dispatch.ts";
import { syncObligations, openOccurrence, resumeOpenOccurrence, closeOccurrence, closeSettledOccurrence } from "../control-plane/scheduler/durable.ts";
import { scheduleObligation } from "../control-plane/scheduler/obligation.ts";
import { RESEARCH_BOUNDS } from "../control-plane/scheduler/research-policy.ts";
import { renewLease } from "../control-plane/repository/coordinator.ts";
import type { ResearchRuntimeTools } from "../control-plane/workers/research-runtime.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { runPlaceSource, type NationalPlacePublicationInput } from "./place-source.ts";
import { placeSourceReader } from "./place-source-reader.ts";

/** The registered registry source uses the ordinary acquiring Attempt, vault
 * and occurrence lifecycle. It costs no model tokens; remaining blanks stay
 * available to the shared hunt planner after each source publication. */
export async function runNationalPlaceTask(input: {
  tools: ResearchRuntimeTools;
  store: RoutineDataStore;
  zips: readonly string[];
  publish: (input: NationalPlacePublicationInput) => Promise<unknown>;
  publishElection?: Parameters<typeof runPlaceSource>[0]["publishElection"];
}) {
  const reports: Awaited<ReturnType<typeof runPlaceSource>>[] = [];
  const { tools } = input;
  const holder = `national-place:${hostname()}:${process.pid}`;
  for (const zip of [...new Set(input.zips)]) {
    if (!/^\d{5}$/.test(zip)) throw new Error("A five-digit ZIP is required");
    const now = tools.now();
    const knowledge = await readFieldManual(tools.repos);
    const definition = { id: `national-place:${zip}`, subjectId: `zip:${zip}`, recordClass: "OFFICIAL_ROSTER" as const,
      routeId: "national-place-sources", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null };
    const synced = await syncObligations(tools.repos, [definition], now, { exactReads: true });
    let prior = await resumeOpenOccurrence(tools.repos, synced.all[0]);
    if (prior?.kind === "SETTLED") {
      await closeSettledOccurrence(tools.repos, { settled: prior.settled, now });
      prior = null;
    }
    const opened = prior ?? await openOccurrence(tools.repos, { obligation: synced.all[0], dueAt: now, now });
    if (!opened) throw new Error("National source occurrence could not open");
    const routeTaskId = "routeTaskId" in opened ? opened.routeTaskId : opened.routeTask.id;
    const occurrenceId = "id" in opened ? opened.id : opened.occurrence.id;
    const scheduled = scheduleObligation(definition, Date.parse(now));
    if (!("cadenceHours" in scheduled)) throw new Error(scheduled.reason);
    // A renewable ownership lease, independent of how long acquisition takes.
    const ttlMs = 120_000;
    let report: Awaited<ReturnType<typeof runPlaceSource>> | undefined;
    const result = await dispatchOne(tools.repos, { obligation: scheduled, routeTaskId, holder, now, clock: tools.now,
      leaseTtlMs: ttlMs, maturity: () => "GRADUATED", executor: {
        lane: "DETERMINISTIC", workerFor: () => ({ role: "ACQUIRER", provider: "we-the-people", version: "national-place/1", instance: holder }),
        run: async ({ attemptId, workItemId }) => {
          const started = Date.now();
          let leaseError: unknown;
          let renewing: Promise<unknown> | undefined;
          const timer = setInterval(() => {
            if (renewing) return;
            renewing = renewLease(tools.repos, { routeTaskId, holder, now: tools.now(), ttlMs })
              .catch(error => { leaseError = error; }).finally(() => { renewing = undefined; });
          }, Math.floor(ttlMs / 3));
          timer.unref();
          try {
            const saved = await placeSourceReader({ tools, project: "freshness", context: {
              obligation: scheduled, route: null, providerId: null, attemptId, workItemId, routeTaskId, holder, now: tools.now,
              // This finite national walk is plain code; it retains the shared
              // ten-request limit for each website.
              bound: RESEARCH_BOUNDS.perDispatch,
            } });
            const geographyRequests = new Map<string, number>();
            report = await runPlaceSource({ repos: tools.repos, store: input.store, zip, now, clock: tools.now, knowledge,
              readSource: async url => { if (leaseError) throw leaseError; return saved.read(url); },
              geography: { capture: saved.captureGeography, readHeld: saved.readGeography, fetchImpl: async (url, options) => {
                const host = new URL(url instanceof Request ? url.url : String(url)).hostname.toLowerCase().replace(/^www\./, "");
                const count = geographyRequests.get(host) ?? 0;
                if (count >= RESEARCH_BOUNDS.perDispatch.maxRequestsPerHost) throw new Error(`Geography source ${host}: shared website request bound reached; saved responses remain available for the next pass`);
                geographyRequests.set(host, count + 1);
                saved.cost.requestCount++;
                const response = await fetch(url, options);
                return response;
              } }, geographyCaptures: saved.geographyCaptures,
              publish: async value => { if (leaseError) throw leaseError; return input.publish(value); },
              ...(input.publishElection ? { publishElection: input.publishElection } : {}) });
            if (leaseError) throw leaseError;
            const artifacts = [...saved.artifacts.values()];
            return { kind: "DISPOSED", ranAs: "DETERMINISTIC", artifacts,
              disposition: { disposition: "INGESTED", permission: "ALLOWED", transport: "REACHABLE",
                observation: { rawCount: artifacts.length, normalizedCount: report.sources?.officials.length ?? 0,
                  routeOnlyCount: null, earliest: null, latest: null },
                note: "Saved national sources acquired; published fields come only from canonical readback; remaining fields stay owed. " +
                  JSON.stringify({ inherited: report.inherited, sourceGaps: report.sources?.gaps ?? [], publications: report.publications,
                    electionPublications: report.electionPublications }) },
              cost: { ...ZERO_COST, ...saved.cost, durationMs: Date.now() - started },
              detail: `ZIP ${zip}: ${report.items.filter(item => item.state === "published").length} published fields, ${report.work.length} source gaps` };
          } finally { clearInterval(timer); await renewing; }
        },
      } });
    if (!result.claimed) throw new Error(`National place source ${zip}: ${result.detail}`);
    await closeOccurrence(tools.repos, { occurrenceId, disposition: result.disposition,
      unresolvedReason: result.outcome === "WORKED" ? null : result.detail, now: tools.now(),
      ...(result.outcome === "WORKED" ? { workedAt: tools.now() } : {}) });
    if (result.outcome !== "WORKED" || !report) throw new Error(`National place source ${zip}: ${result.detail}`);
    reports.push(report);
  }
  return reports;
}
