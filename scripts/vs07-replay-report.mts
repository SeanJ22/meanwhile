/** Compact evidence index for scripts/vs07-replay.mts. All records come from one
 * completed replay directory; a partial or mixed-code run cannot pass checks. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assignment } from "./cli-args.mts";

interface ReplayPage { issue?: string | null; jurisdiction: string; countyFips?: string | null; answerSites: number; markupSha256: string }
interface ReplayPass {
  observedAt: string; invokedExactJob: boolean; publications: number; dueByStandingSchedule: boolean;
  codeChangedDuringReplay: boolean; sites: number; disappearedSiteIds: string[]; pages: ReplayPage[];
  targetCounty: string | null; targetCountyHasSites: boolean; failure: string | null; elapsedMs: number;
  readKind: string; countyFips: string[]; sourceRequests: { representation: string; url: string; sha256?: string; sourceCapturedAt?: string }[];
  readerVisibleSites: number; readerMissingSiteIds: string[]; peakWorkerRssBytes: number; peakSampledProcessTreeBytes: number;
  scheduleRows: number; datedScheduleRows: number;
  slotBudgetMs: number; acquisitionBudgetMs: number; reservedSettlementMs: number; finishedWithinSlot: boolean;
  disappearedWithoutOfficialReplacement: string[];
  readerBoundaries?: { jurisdiction: string; boundaries: number }[]; exactPointPages?: unknown[];
  candidateOutcomes: { candidateId: string; state: string; acquisitionSucceeded: boolean; requestedUrl: string;
    rows: number; failureCode: string | null; failureDetail: string | null; nonPassingChecks: unknown[];
    removalEvidence: { key: string; code: string }[] }[];
}
interface ReplayReport {
  state: string; codeHashes: Record<string, string>; stateSeedsSha256: string;
  production: { snapshotImported: boolean; pointer?: { sites: string; versionId: string } | null };
  boundary: { feedsFrom: string; feeds: string; limitations: string[] };
  passes: ReplayPass[];
}
const replayRoot = resolve(assignment(process.argv, "replay") ?? ".scratch/vs07-replay-frozen");
const productionRoot = resolve(assignment(process.argv, "production-snapshot") ?? ".scratch/vs07-production");
const output = resolve(assignment(process.argv, "out") ?? "docs/measurements/vs-07/replay-proof.json");
const baseline = JSON.parse(readFileSync(join(productionRoot, "metadata.json"), "utf8"));
const nativeStatuses = new Map<string, number>();
function indexStatuses(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) indexStatuses(path);
    else if (/(?:^|[-.])(?:captures|manifest|capture)\.json$/.test(entry.name)) {
      const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        const row = value as Record<string, unknown>;
        const hash = row.savedHash ?? row.savedSha256 ?? row.sha256 ?? row.rawHash;
        const status = row.status ?? row.httpStatus;
        if (typeof hash === "string" && typeof status === "number") for (const url of [row.url, row.finalUrl]) {
          if (typeof url === "string") nativeStatuses.set(`${url}:${hash}`, status);
        }
        Object.values(row).forEach(visit);
      };
      visit(JSON.parse(readFileSync(path, "utf8")));
    }
  }
}
indexStatuses(resolve("tests/fixtures/voting-sources"));
const states: string[] = baseline.clocks.map((row: { scope: string }) => /^US-([A-Z]{2}):voting-sites$/.exec(row.scope)?.[1]).filter(Boolean).sort();
assert.equal(new Set(states).size, 56, "The baseline must identify all 56 state and territory task scopes");
const reports = states.map((state: string) => JSON.parse(readFileSync(join(replayRoot, `${state}.json`), "utf8")) as ReplayReport);
const allPasses = reports.flatMap(report => report.passes.map((pass, day) => ({ state: report.state, day, ...pass })));
const productionHashes = reports.map(report => Object.fromEntries(Object.entries(report.codeHashes).filter(([file]) => file !== "scripts/vs07-replay.mts")));
const sameCode = productionHashes.every(hashes => JSON.stringify(hashes) === JSON.stringify(productionHashes[0]));
const currentCodeMatchesReplay = Object.entries(productionHashes[0])
  .every(([file, hash]) => createHash("sha256").update(readFileSync(file)).digest("hex") === hash);
const currentDoors: { scope: { state: string; ocdId: string }; rules?: { text: string; source: { url: string } }[] }[] = ["voting-source-doors.json", "voting-legacy-doors.json"]
  .flatMap(file => JSON.parse(readFileSync(join("data", "reference", file), "utf8")));
const stateDoorsMatch = reports.every(report => createHash("sha256")
  .update(JSON.stringify(currentDoors.filter(door => door.scope.state === report.state))).digest("hex") === report.stateSeedsSha256);
const requiredHeld = ["AL", "AZ", "DE", "FL", "GA", "HI", "IA", "IL", "KY", "MA", "MD"];
const held = reports.filter(report => Number(report.production.pointer?.sites) > 0).map(report => ({
  state: report.state, requiredEleven: requiredHeld.includes(report.state), productionSites: Number(report.production.pointer!.sites),
  originalVersionId: report.production.pointer!.versionId,
  passes: report.passes.map(pass => ({
    sites: pass.sites, disappearedSiteCount: pass.disappearedSiteIds.length,
    disappearedWithoutOfficialReplacement: pass.disappearedWithoutOfficialReplacement.length,
  })),
}));
assert.equal(held.filter(report => report.requiredEleven).length, 11);
const namedTargets = ["NC", "CA", "PA", "TX"].map(state => {
  const report = reports.find(report => report.state === state)!;
  return { state, countyFips: report.passes[0].targetCounty, passes: report.passes.map((pass, day) => ({
    observedAt: pass.observedAt, publications: pass.publications, hasSites: pass.targetCountyHasSites,
    readerBoundaries: pass.readerBoundaries ?? [], exactPointPages: pass.exactPointPages ?? [],
    pages: pass.pages.filter(page => page.countyFips === report.passes[0]!.targetCounty).map(page => {
      const markup = readFileSync(join(replayRoot, "pages", `${state}-${day}-${pass.pages.indexOf(page) + 1}.html`), "utf8");
      assert.equal(createHash("sha256").update(markup).digest("hex"), page.markupSha256, "The indexed actual panel HTML must match its replay hash");
      const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
      const sharedRules = currentDoors.filter(door => door.scope.state === state && door.scope.ocdId === page.jurisdiction)
        .flatMap(door => door.rules ?? []).map(rule => ({ text: rule.text, sourceUrl: rule.source.url,
          visibleInActualPanel: markup.includes(escapeHtml(rule.text)) }));
      return { ...page, sharedRules };
    }),
  })) };
});
const failed = allPasses.filter(pass => pass.failure).map(pass => ({ state: pass.state, day: pass.day, failure: pass.failure,
  nativeResponseEvidence: [...new Map(pass.sourceRequests.filter(request => request.sha256).map(request => [request.url, {
    url: request.url, httpStatus: nativeStatuses.get(`${request.url}:${request.sha256}`) ?? null,
    capturedAt: request.sourceCapturedAt ?? null, sha256: request.sha256,
  }])).values()],
  unrecordedSourceUrls: [...new Set(pass.sourceRequests.filter(request => !request.sha256).map(request => request.url))],
}));
const panelGaps = allPasses.flatMap(pass => pass.pages
  .filter(page => page.issue).map(page => ({ state: pass.state, day: pass.day, jurisdiction: page.jurisdiction, issue: page.issue })));
const heldCandidates = allPasses.flatMap(pass => pass.candidateOutcomes.filter(candidate => candidate.state !== "PROMOTED")
  .map(({ state: candidateState, ...candidate }) => ({ state: pass.state, day: pass.day, ...candidate, candidateState })));
const officialReplacements = allPasses.flatMap(pass => pass.candidateOutcomes
  .filter(candidate => candidate.state === "PROMOTED" && candidate.removalEvidence.length)
  .map(candidate => ({ state: pass.state, day: pass.day, candidateId: candidate.candidateId, sourceUrl: candidate.requestedUrl,
    removedRows: candidate.removalEvidence.length, evidence: candidate.removalEvidence })));
const checks = {
  scopesTried: reports.length === 56 && reports.every(report => report.passes.length === 2),
  exactJobInvokedEveryPass: allPasses.every(pass => pass.invokedExactJob),
  everyTaskFinishesInsideItsProductionSlot: allPasses.every(pass => pass.finishedWithinSlot),
  allDueThroughStandingScheduleTodayAndTomorrow: allPasses.every(pass => pass.dueByStandingSchedule),
  sameProductionCodeEveryScopeAndBothDays: sameCode && currentCodeMatchesReplay && allPasses.every(pass => !pass.codeChangedDuringReplay),
  stateDoorDefinitionsMatchCurrentCatalog: stateDoorsMatch,
  elevenHeldStatesKeepEveryExistingSite: held.filter(report => report.requiredEleven)
    .every(report => report.passes.every(pass => pass.disappearedSiteCount === 0)),
  elevenHeldStatesKeepSitesOrReplaceFromVerifiedOfficialLists: held.filter(report => report.requiredEleven)
    .every(report => report.passes.every(pass => pass.sites > 0 && pass.disappearedWithoutOfficialReplacement === 0)),
  namedTargetsPublishAndRenderBothDays: namedTargets.every(report => report.passes.every((pass: { publications: number; hasSites: boolean }) => pass.publications > 0 && pass.hasSites)),
  namedTargetConfiguredRulesReachPanel: namedTargets.every(report => report.passes.every(pass => pass.pages.every(page => page.sharedRules.every(rule => rule.visibleInActualPanel)))),
  philadelphiaPublishedBoundariesAndExactPointReachPanelBothDays: namedTargets.find(report => report.state === "PA")!.passes.every(pass =>
    pass.readerBoundaries.some(row => row.boundaries === 1703) && pass.exactPointPages.length === 1),
  everyScopePublishesBothDays: failed.length === 0,
  everyPublishedScopeReachesPanel: panelGaps.length === 0,
  everyPublishedSiteReachesPanel: allPasses.every(pass => pass.readerMissingSiteIds.length === 0),
  everyAcquiredCandidatePublishes: heldCandidates.filter(candidate => candidate.acquisitionSucceeded).length === 0,
};
const proof = {
  generatedAt: new Date().toISOString(),
  productionSnapshot: { capturedAt: baseline.capturedAt, database: baseline.database, identity: baseline.identity,
    pointerCount: baseline.pointers.length, scheduleClockCount: baseline.clocks.length, productionWrites: 0 },
  connectedSteps: { feedsFrom: reports[0].boundary.feedsFrom, feeds: reports[0].boundary.feeds },
  codeHashes: productionHashes[0],
  replayHarnessVersions: [...new Set(reports.map(report => report.codeHashes["scripts/vs07-replay.mts"]))]
    .map(sha256 => ({ sha256, states: reports.filter(report => report.codeHashes["scripts/vs07-replay.mts"] === sha256).map(report => report.state) })),
  memory: { configuredDefaultConcurrency: 4, initialVotingWorkerReservationMiB: 512, hostHeadroomMiB: 768,
    configuredHostMemoryMiB: null, configuredHostMemoryReason: "No production host-memory reading or override was available in this read-only snapshot.",
    peakWorkerRssBytes: Math.max(...allPasses.map(pass => pass.peakWorkerRssBytes)),
    peakSampledProcessTreeBytes: Math.max(...allPasses.map(pass => pass.peakSampledProcessTreeBytes)),
    fourWorkersPlusHeadroomBytes: 768 * 1024 ** 2 + 4 * Math.max(...allPasses.map(pass => pass.peakSampledProcessTreeBytes)),
    caveat: "These are read-only replay workers: the in-memory store retains candidate history that production stores durably, so this is not a measured production peak. The bound includes four copies of the largest replay worker plus 0.75 GiB headroom; parent/other resident processes need additional RAM. Process trees were sampled every 100ms and include live OCR descendants; short-lived children can escape sampling.",
    sources: ["lib/civic-data/bounded-child-pass.ts", "lib/control-plane/workers/worker-slots.ts"] },
  checks,
  run: { scopes: 56, passes: allPasses.length, publishedPasses: allPasses.filter(pass => pass.publications > 0).length,
    firstObservedAt: allPasses.map(pass => pass.observedAt as string).sort()[0],
    finalObservedAt: allPasses.map(pass => pass.observedAt as string).sort().at(-1),
    slowestPassMs: Math.max(...allPasses.map(pass => pass.elapsedMs as number)),
    scopesWithFailure: [...new Set(failed.map(pass => pass.state))], failures: failed },
  heldStates: held,
  namedTargets,
  panelGaps,
  heldCandidates,
  officialReplacements,
  scopeResults: reports.map(report => ({ state: report.state, stateSeedsSha256: report.stateSeedsSha256,
    importedExactProductionPointer: report.production.snapshotImported, productionSites: Number(report.production.pointer?.sites ?? 0),
    passes: report.passes.map(pass => ({
      observedAt: pass.observedAt, dueByStandingSchedule: pass.dueByStandingSchedule, publications: pass.publications,
      sites: pass.sites, failure: pass.failure, typedReader: pass.readKind, elapsedMs: pass.elapsedMs,
      slotBudgetMs: pass.slotBudgetMs, acquisitionBudgetMs: pass.acquisitionBudgetMs,
      reservedSettlementMs: pass.reservedSettlementMs, finishedWithinSlot: pass.finishedWithinSlot,
      heldCandidateCount: pass.candidateOutcomes.filter(candidate => candidate.state !== "PROMOTED").length,
      panelVisibleSites: pass.readerVisibleSites, panelMissingSites: pass.readerMissingSiteIds.length,
      disappearedSiteCount: pass.disappearedSiteIds.length, peakWorkerRssBytes: pass.peakWorkerRssBytes,
      disappearedWithoutOfficialReplacement: pass.disappearedWithoutOfficialReplacement.length,
      peakSampledProcessTreeBytes: pass.peakSampledProcessTreeBytes,
      scheduleRows: pass.scheduleRows, datedScheduleRows: pass.datedScheduleRows,
      countiesWithSites: pass.countyFips.length,
      savedSourceResponsesRead: pass.sourceRequests.filter(row => row.representation === "saved official source response").length,
      unrecordedSourceRequests: pass.sourceRequests.filter(row => row.representation === "unrecorded source response").length,
    })) })),
  limitations: [...reports[0].boundary.limitations,
    "An unsuccessful source acquisition remains a failed pass with retained production data; it is not counted as a successful publish.",
    "Preserving site IDs in the typed reader does not prove a reader geography can see them. Any sampled panel gap is reported separately.",
    "A next-day controlled-clock replay proves ordinary cadence and repeat publication against these saved responses; tomorrow's publisher/network availability is outside this read-only proof.",
  ],
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ output, checks, passes: proof.run.passes, failedScopes: proof.run.scopesWithFailure, panelGaps: panelGaps.length }));
