import { hostname } from "node:os";
import { ZERO_COST } from "../control-plane/attempt.ts";
import { readFieldManual } from "../control-plane/field-manual.ts";
import { dispatchOne, dischargesObligation } from "../control-plane/scheduler/dispatch.ts";
import { syncObligations, openOccurrence, resumeOpenOccurrence, closeOccurrence, closeSettledOccurrence, occurrenceId, type StandingObligation } from "../control-plane/scheduler/durable.ts";
import { scheduleObligation } from "../control-plane/scheduler/obligation.ts";
import { RESEARCH_BOUNDS } from "../control-plane/scheduler/research-policy.ts";
import type { ResearchRuntimeTools } from "../control-plane/workers/research-runtime.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { runPlaceSource, type NationalPlacePublicationInput } from "./place-source.ts";
import { placeSourceReader, PlaceSourceDeferred } from "./place-source-reader.ts";
import { nationalPlaceBelowTarget } from "../control-plane/expansion/dispatch-work.ts";
import { readHeldPlaceCapture } from "../civic-data/held-place-capture.ts";
import { buildPlaceOwedList, type PlaceOwedItem } from "../coverage/place-owed.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { heldDivisionsForZip } from "../control-plane/expansion/national-geography.ts";
import { expansionScopesOf } from "../control-plane/expansion/scopes.ts";
import type { ResolvedScope } from "../control-plane/expansion/membership.ts";
import { readExpansionScopesForZips } from "../control-plane/expansion/runner-load.ts";
import { admittedHuntSourceScopes } from "../civic-data/hunt-source-tasks.ts";

export interface NationalPlaceSendRequest {
  readonly requestedAt: string;
  readonly instructions: readonly string[];
}

export function nationalPlaceSendRequests(scopes: readonly ResolvedScope[], zips: readonly string[], now: string): Map<string, NationalPlaceSendRequest> {
  const requests = new Map<string, NationalPlaceSendRequest>();
  const selected = new Set(zips);
  const nowMs = Date.parse(now);
  for (const scope of admittedHuntSourceScopes(scopes, now)) {
    if (scope.kind !== "RESOLVED" || scope.decision.sourceWorkVersion !== 1 || !scope.decision.receiptId) continue;
    const requestedAt = scope.decision.budgetStartedAt ?? scope.decision.decidedAt;
    const requestedMs = Date.parse(requestedAt);
    if (!Number.isFinite(requestedMs) || !Number.isFinite(nowMs) || requestedMs > nowMs) continue;
    for (const zip of scope.zctas) {
      if (!selected.has(zip)) continue;
      const prior = requests.get(zip);
      requests.set(zip, {
        requestedAt: prior && Date.parse(prior.requestedAt) > requestedMs ? prior.requestedAt : requestedAt,
        instructions: [...new Set([...(prior?.instructions ?? []), scope.decision.receiptId])],
      });
    }
  }
  return requests;
}

export async function readNationalPlaceSendRequests(repos: ControlPlaneRepositories, zips: readonly string[], now: string, config?: unknown) {
  if (!zips.length) return new Map<string, NationalPlaceSendRequest>();
  const decisions = config === undefined ? {scopes:(await readExpansionScopesForZips(repos,zips)).scopes,malformed:0} : expansionScopesOf(config ?? null);
  if (decisions.malformed) throw new Error("The owner's place scopes contain unreadable decisions");
  const sends = decisions.scopes.filter(scope => scope.sourceWorkVersion === 1);
  if (!sends.length || !zips.length) return new Map<string, NationalPlaceSendRequest>();
  const { resolveNationalPlaceSendScopes } = await import("./place-source-admission.ts");
  return nationalPlaceSendRequests(await resolveNationalPlaceSendScopes(sends, zips), zips, now);
}

export function skippedFamilies(families: { readonly officials: boolean; readonly elections: boolean } | null | undefined): string[] {
  return families ? (Object.keys(families) as (keyof typeof families)[]).filter(family => !families[family]) : [];
}

export function placeMadeProgress(before: readonly PlaceOwedItem[], after: readonly PlaceOwedItem[]): boolean {
  const facts = (items: readonly PlaceOwedItem[]) => new Map(items.filter(item => item.state === "published" || item.state === "unpublished")
    .map(item => [item.id, canonicalJson({ state: item.state, values: [...new Set(item.held.filter(field => field.state === item.state)
      .map(field => canonicalJson(field.value)))].sort() })]));
  const prior = facts(before);
  return [...facts(after)].some(([id, value]) => prior.get(id) !== value);
}

export async function scheduleNationalPlace(repos: ControlPlaneRepositories, row: StandingObligation, now: string, belowTarget: boolean, send?: NationalPlaceSendRequest) {
  const scheduled = scheduleObligation(row, Date.parse(now));
  if (!("cadenceHours" in scheduled)) return scheduled;
  const requestedMs = Date.parse(send?.requestedAt ?? "");
  const requested = send && send.instructions.length > 0 && Number.isFinite(requestedMs) && requestedMs <= Date.parse(now);
  const occurrence = row.occurrenceCount && (belowTarget || requested)
    ? await repos.occurrences.read(occurrenceId(row.id, row.occurrenceCount)) : null;
  const observed = [row.lastWorkedAt, occurrence?.value.closedAt].map(at => Date.parse(at ?? "")).filter(Number.isFinite);
  if (requested && requestedMs > Math.max(...observed)) {
    return { ...scheduled, nextDueAt: now, basis: `A newer saved Send requests this place: ${send.instructions.join(", ")}.` };
  }
  if (!belowTarget) return scheduled;
  if (occurrence?.value.closedAt) {
    const task = await repos.routeTasks.read(occurrence.value.routeTaskId);
    const note = task?.value.disposition?.note ?? "";
    const outcome = task?.value.disposition?.disposition;
    if (outcome === "WALKED_NO_YIELD" || outcome === "INGESTED" && note.includes('"placeProgress":false')) {
      return scheduleObligation({ ...row, lastWorkedAt: occurrence.value.closedAt }, Date.parse(now));
    }
  }
  return { ...scheduled, nextDueAt: now, basis: "The place is below its owner target and its last hunt has not reported no progress." };
}

export async function dueNationalPlaceZips(repos: ControlPlaneRepositories, zips: readonly string[], now: string, sendRequests?: ReadonlyMap<string, NationalPlaceSendRequest>): Promise<string[]> {
  const unique = [...new Set(zips)];
  if (unique.some(zip => !/^\d{5}$/.test(zip))) throw new Error("A five-digit ZIP is required");
  const held = new Map((await repos.obligations.listWhere(["routeId"], "national-place-sources")).map(row => [row.id, row.value]));
  const requests = sendRequests ?? await readNationalPlaceSendRequests(repos, unique, now);
  const belowTarget = await nationalPlaceBelowTarget(repos, unique, now);
  const nowMs = Date.parse(now);
  const due = await Promise.all(unique.map(async zip => {
    const row = held.get(`national-place:${zip}`);
    if (!row) return true;
    const scheduled = await scheduleNationalPlace(repos, row, now, belowTarget.has(zip), requests.get(zip));
    return "cadenceHours" in scheduled && Date.parse(scheduled.nextDueAt) <= nowMs;
  }));
  return unique.filter((_, index) => due[index]).sort((a, b) => {
    const age = (zip: string) => Date.parse(held.get(`national-place:${zip}`)?.lastWorkedAt ?? "") || 0;
    return age(a) - age(b) || a.localeCompare(b);
  });
}

export async function runNationalPlaceTask(input: {
  tools: ResearchRuntimeTools;
  store: RoutineDataStore;
  zips: readonly string[];
  publish: (input: NationalPlacePublicationInput) => Promise<unknown>;
  publishElection?: Parameters<typeof runPlaceSource>[0]["publishElection"];
  acquire?: typeof runPlaceSource;

  readPublished?: typeof heldDivisionsForZip;
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
    let prior = await resumeOpenOccurrence(tools.repos, synced.all[0], await tools.repos.dispatchState.readOpen({ obligationIds: [synced.all[0].id] }));
    if (prior?.kind === "SETTLED") {
      await closeSettledOccurrence(tools.repos, { settled: prior.settled, now });
      prior = null;
    }

    const durable = (await tools.repos.obligations.mustRead(definition.id)).value;
    const requests = await readNationalPlaceSendRequests(tools.repos, [zip], now);
    const belowTarget = (await nationalPlaceBelowTarget(tools.repos, [zip], now)).has(zip);
    const scheduled = await scheduleNationalPlace(tools.repos, durable, now, belowTarget, requests.get(zip));
    if (!("cadenceHours" in scheduled)) throw new Error(scheduled.reason);
    if (Date.parse(scheduled.nextDueAt) > Date.parse(now)) continue;
    const publishedGeography = deferred ? [] : await (input.readPublished ?? heldDivisionsForZip)(zip);
    const state = publishedGeography.find(division => division.divisionType === "state")?.id.split("/state:")[1];
    const knowledge = deferred ? undefined : await readFieldManual(tools.repos, { state, ocdIds: publishedGeography.map(division => division.id) });
    const opened = prior ?? await openOccurrence(tools.repos, { obligation: durable, dueAt: scheduled.nextDueAt, now });
    if (!opened) throw new Error("National source occurrence could not open");
    const routeTaskId = "routeTaskId" in opened ? opened.routeTaskId : opened.routeTask.id;
    const occurrenceId = "id" in opened ? opened.id : opened.occurrence.id;

    const ttlMs = 120_000;
    let report: Awaited<ReturnType<typeof runPlaceSource>> | undefined;
    let before: PlaceOwedItem[] | undefined;
    const result = await dispatchOne(tools.repos, { obligation: scheduled, routeTaskId, holder, now, clock: tools.now,
      leaseTtlMs: ttlMs, maturity: () => "GRADUATED", executor: {
        lane: "DETERMINISTIC", workerFor: () => ({ role: "ACQUIRER", provider: "we-the-people", version: "national-place/1", instance: holder }),
        run: async ({ attemptId, workItemId, assertLeaseHealthy }) => {
          const started = Date.now();
          if (deferred) return { kind: "DISPOSED", ranAs: "DETERMINISTIC", artifacts: [],
            disposition: { disposition: "BLOCKED_CURRENTLY", permission: "ALLOWED", transport: "OTHER_NAMED_FAILURE", observation: null,
              note: deferred + " " + JSON.stringify({ placeProgress: report ? placeMadeProgress(before ?? [], report.items) : false }) },
            cost: ZERO_COST, detail: `ZIP ${zip}: ${deferred}` };
          const saved = await placeSourceReader({ tools, project: "freshness", context: {
            obligation: scheduled, route: null, providerId: null, attemptId, workItemId, routeTaskId, holder, now: tools.now,

            bound: RESEARCH_BOUNDS.perDispatch,
          } });
          try {
            report = await (input.acquire ?? runPlaceSource)({ repos: tools.repos, store: input.store, zip, now, clock: tools.now, knowledge,
              readHeld: async ids => {
                const capture = await readHeldPlaceCapture(ids, { store: input.store, now: tools.now(), bypassCache: true });
                before ??= buildPlaceOwedList({ divisions: ids.map(id => ({ id, label: id })), zips: [zip], ...capture, now: tools.now() });
                return capture;
              },
              readSource: async url => { assertLeaseHealthy?.(); return saved.read(url); },
              geography: { capture: saved.captureGeography, readHeld: saved.readGeography, fetchImpl: saved.fetchGeography,
                readPublished: async () => publishedGeography },
              geographyCaptures: saved.geographyCaptures,
              publish: async value => { assertLeaseHealthy?.(); return input.publish(value); },
              ...(input.publishElection ? { publishElection: input.publishElection } : {}) });
          } catch (error) {
            if (!(error instanceof PlaceSourceDeferred)) throw error;
            deferred = error.message;
          }

          deferred ??= saved.deferred?.message ?? null;
          assertLeaseHealthy?.();
          if (deferred) return { kind: "DISPOSED", ranAs: "DETERMINISTIC", artifacts: [...saved.artifacts.values()],
            disposition: { disposition: "BLOCKED_CURRENTLY", permission: "ALLOWED", transport: "OTHER_NAMED_FAILURE", observation: null,
              note: deferred + " " + JSON.stringify({ placeProgress: report ? placeMadeProgress(before ?? [], report.items) : false }) },
            cost: { ...ZERO_COST, ...saved.cost, durationMs: Date.now() - started }, detail: `ZIP ${zip}: ${deferred}` };
          if (!report) throw new Error("National place source returned no report");
          const artifacts = [...saved.artifacts.values()];
          return { kind: "DISPOSED", ranAs: "DETERMINISTIC", artifacts,
            disposition: { disposition: "INGESTED", permission: "ALLOWED", transport: "REACHABLE",
              observation: { rawCount: artifacts.length, normalizedCount: report.sources?.officials.length ?? 0,
                routeOnlyCount: null, earliest: null, latest: null },
              note: "Saved national sources acquired; published fields come only from canonical readback; remaining fields stay owed. " +
                JSON.stringify({ placeProgress: placeMadeProgress(before ?? [], report.items), inherited: report.inherited,

                  families: report.families, skippedFamilies: skippedFamilies(report.families), sourcesRead: report.sources?.documents.length ?? 0, sourceGaps: report.sources?.gaps ?? [], publications: report.publications,
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
