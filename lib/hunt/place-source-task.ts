import { hostname } from "node:os";
import { ZERO_COST } from "../control-plane/attempt.ts";
import { readFieldManual } from "../control-plane/field-manual.ts";
import { dispatchOne, dischargesObligation } from "../control-plane/scheduler/dispatch.ts";
import { syncObligations, openOccurrence, resumeOpenOccurrence, closeOccurrence, closeSettledOccurrence } from "../control-plane/scheduler/durable.ts";
import { scheduleObligation } from "../control-plane/scheduler/obligation.ts";
import { RESEARCH_BOUNDS } from "../control-plane/scheduler/research-policy.ts";
import type { ResearchRuntimeTools } from "../control-plane/workers/research-runtime.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { runPlaceSource, type NationalPlacePublicationInput } from "./place-source.ts";
import { placeSourceReader, PlaceSourceDeferred } from "./place-source-reader.ts";

/** Read the existing clocks before assigning processes; untouched places lead. */
export async function dueNationalPlaceZips(repos: ControlPlaneRepositories, zips: readonly string[], now: string): Promise<string[]> {
  const unique = [...new Set(zips)];
  if (unique.some(zip => !/^\d{5}$/.test(zip))) throw new Error("A five-digit ZIP is required");
  const held = new Map((await repos.obligations.listWhere(["routeId"], "national-place-sources")).map(row => [row.id, row.value]));
  const nowMs = Date.parse(now);
  return unique.filter(zip => {
    const row = held.get(`national-place:${zip}`);
    if (!row) return true;
    const scheduled = scheduleObligation(row, nowMs);
    return "cadenceHours" in scheduled && Date.parse(scheduled.nextDueAt) <= nowMs;
  }).sort((a, b) => {
    const age = (zip: string) => Date.parse(held.get(`national-place:${zip}`)?.lastWorkedAt ?? "") || 0;
    return age(a) - age(b) || a.localeCompare(b);
  });
}

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
  const reports: (Awaited<ReturnType<typeof runPlaceSource>> | { zip: string; deferred: string })[] = [];
  let deferred: string | null = null;
  const { tools } = input;
  const holder = `national-place:${hostname()}:${process.pid}`;
  for (const zip of await dueNationalPlaceZips(tools.repos, input.zips, tools.now())) {
    const now = tools.now();
    const definition = { id: `national-place:${zip}`, subjectId: `zip:${zip}`, recordClass: "OFFICIAL_ROSTER" as const,
      routeId: "national-place-sources", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null };
    const synced = await syncObligations(tools.repos, [definition], now, { exactReads: true });
    let prior = await resumeOpenOccurrence(tools.repos, synced.all[0]);
    if (prior?.kind === "SETTLED") {
      await closeSettledOccurrence(tools.repos, { settled: prior.settled, now });
      prior = null;
    }
    // Settlement can advance the clock, and another worker may have worked it
    // since admission. Always schedule the durable row, never a fresh null anchor.
    const durable = (await tools.repos.obligations.mustRead(definition.id)).value;
    const scheduled = scheduleObligation(durable, Date.parse(now));
    if (!("cadenceHours" in scheduled)) throw new Error(scheduled.reason);
    if (Date.parse(scheduled.nextDueAt) > Date.parse(now)) continue;
    const knowledge = deferred ? undefined : await readFieldManual(tools.repos);
    const opened = prior ?? await openOccurrence(tools.repos, { obligation: durable, dueAt: scheduled.nextDueAt, now });
    if (!opened) throw new Error("National source occurrence could not open");
    const routeTaskId = "routeTaskId" in opened ? opened.routeTaskId : opened.routeTask.id;
    const occurrenceId = "id" in opened ? opened.id : opened.occurrence.id;
    // A renewable ownership lease, independent of how long acquisition takes.
    const ttlMs = 120_000;
    let report: Awaited<ReturnType<typeof runPlaceSource>> | undefined;
    const result = await dispatchOne(tools.repos, { obligation: scheduled, routeTaskId, holder, now, clock: tools.now,
      leaseTtlMs: ttlMs, maturity: () => "GRADUATED", executor: {
        lane: "DETERMINISTIC", workerFor: () => ({ role: "ACQUIRER", provider: "we-the-people", version: "national-place/1", instance: holder }),
        run: async ({ attemptId, workItemId, assertLeaseHealthy }) => {
          const started = Date.now();
          if (deferred) return { kind: "DISPOSED", ranAs: "DETERMINISTIC", artifacts: [],
            disposition: { disposition: "BLOCKED_CURRENTLY", permission: "ALLOWED", transport: "OTHER_NAMED_FAILURE", observation: null, note: deferred },
            cost: ZERO_COST, detail: `ZIP ${zip}: ${deferred}` };
          const saved = await placeSourceReader({ tools, project: "freshness", context: {
            obligation: scheduled, route: null, providerId: null, attemptId, workItemId, routeTaskId, holder, now: tools.now,
            // This finite national walk is plain code; it retains the shared
            // ten-request limit for each website.
            bound: RESEARCH_BOUNDS.perDispatch,
          } });
          try {
            report = await runPlaceSource({ repos: tools.repos, store: input.store, zip, now, clock: tools.now, knowledge,
              readSource: async url => { assertLeaseHealthy?.(); return saved.read(url); },
              geography: { capture: saved.captureGeography, readHeld: saved.readGeography, fetchImpl: saved.fetchGeography },
              geographyCaptures: saved.geographyCaptures,
              publish: async value => { assertLeaseHealthy?.(); return input.publish(value); },
              ...(input.publishElection ? { publishElection: input.publishElection } : {}) });
          } catch (error) {
            if (!(error instanceof PlaceSourceDeferred)) throw error;
            deferred = error.message;
          }
          // Collectors retain ordinary source gaps, so also observe a bound
          // they caught while publishing already verified fields.
          deferred ??= saved.deferred?.message ?? null;
          assertLeaseHealthy?.();
          if (deferred) return { kind: "DISPOSED", ranAs: "DETERMINISTIC", artifacts: [...saved.artifacts.values()],
            disposition: { disposition: "BLOCKED_CURRENTLY", permission: "ALLOWED", transport: "OTHER_NAMED_FAILURE", observation: null, note: deferred },
            cost: { ...ZERO_COST, ...saved.cost, durationMs: Date.now() - started }, detail: `ZIP ${zip}: ${deferred}` };
          if (!report) throw new Error("National place source returned no report");
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
        },
      } });
    if (!result.claimed) throw new Error(`National place source ${zip}: ${result.detail}`);
    const discharged = dischargesObligation(result);
    await closeOccurrence(tools.repos, { occurrenceId, disposition: discharged ? result.disposition : null,
      unresolvedReason: discharged ? null : result.detail, now: tools.now(),
      ...(discharged ? { workedAt: tools.now() } : {}) });
    if (result.outcome === "WORKED" && deferred) {
      reports.push({ zip, deferred });
      continue;
    }
    if (result.outcome !== "WORKED" || !report) throw new Error(`National place source ${zip}: ${result.detail}`);
    reports.push(report);
  }
  return reports;
}
