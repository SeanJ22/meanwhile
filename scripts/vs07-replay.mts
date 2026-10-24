/** Read-only production-copy replay of the actual VS-07 job. Run one state per
 * process so no worker loads another state's records. Production snapshots are
 * exported with SET TRANSACTION READ ONLY and the readonly role; publication,
 * doors, obligations and evidence below use only local replay stores. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { refreshVotingSources, votingAcquisitionDeadline } from "./fetch-voting-sites.mts";
import { savedSourceResponses, vs07EvidenceStore, type SavedSourceResponse } from "./vs07-evidence.mts";
import { assignment } from "./cli-args.mts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { verifyVotingSourceReplacement } from "../lib/ballot/voting-source-replacement.ts";
import { promotionProofIssue } from "../lib/civic-data/read-model.ts";
import { decodeStateCandidate } from "../lib/civic-data/state-publication.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
import { readVotingSitesProjection } from "../lib/ballot/voting-sites-server.ts";
import { answerVotingSites, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import { votingPlaceFromZip } from "../lib/ballot/voting-answer-geography.ts";
import { readZipPlace } from "../lib/place-map/reader.ts";
import { VotingJurisdictionRecords } from "../components/map/voting-sites-panel.tsx";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import type { CycleVault } from "../lib/control-plane/scheduler/vault.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineCandidate } from "../lib/civic-data/types.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import type { Registry } from "../lib/registry/types.ts";

const root = process.cwd(), state = requireBallotState(assignment(process.argv, "state") ?? "");
const productionRoot = resolve(assignment(process.argv, "production-snapshot") ?? ".scratch/vs07-production");
const outputRoot = resolve(assignment(process.argv, "out") ?? ".scratch/vs07-replay-frozen");
const codeFiles = ["scripts/vs07-replay.mts", "scripts/vs07-evidence.mts", "scripts/fetch-voting-sites.mts", "lib/ballot/voting-source-readers.ts", "lib/ballot/voting-source-publication.ts",
  "lib/ballot/voting-source-fetch.ts", "lib/ballot/voting-source-discovery.ts", "lib/doors/source-capture.ts", "lib/doors/source-text.ts", "lib/extract/ocr.ts",
  "lib/ballot/voting-answer.ts", "lib/ballot/voting-answer-geography.ts", "lib/ballot/voting-sites-server.ts", "components/map/voting-sites-panel.tsx",
  "lib/ballot/voting-sites-data-plane.ts", "lib/ballot/voting-source-evidence.ts", "lib/ballot/voting-source-types.ts", "lib/ballot/voting-sites.ts",
  "lib/ballot/voting-source-population.ts", "lib/ballot/voting-source-blanks.ts", "lib/civic-data/source-authority.ts", "lib/civic-data/store.ts", "lib/civic-data/state-publication.ts",
  "lib/civic-data/automatic-refresh.ts", "lib/civic-data/runner.ts", "lib/civic-data/validate.ts", "lib/civic-data/types.ts",
  "lib/civic-data/candidate-integrity.ts", "lib/civic-data/promotion.ts", "lib/ballot/voting-source-replacement.ts", "lib/ballot/voting-source-replacement-contract.ts",
  "lib/civic-data/bounded-child-pass.ts", "lib/control-plane/workers/worker-slots.ts"];
const codeHashes = Object.fromEntries(codeFiles.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
const slotBudgetMs = Number(assignment(process.argv, "slot-budget-ms") ?? 30 * 60_000);
assert.ok(Number.isFinite(slotBudgetMs) && slotBudgetMs > 0);
const metadata = JSON.parse(readFileSync(join(productionRoot, "metadata.json"), "utf8"));
assert.equal(metadata.identity.read_only, "on");
assert.equal(metadata.identity.can_write, false);
assert.equal(metadata.database.branchId, "br-delicate-lab-ax02xuo5");

interface Snapshot { identity: { current_user: string; read_only: string; can_write: boolean }; projection: PromotedProjection<VotingSitesFile>; record: CandidateVersionRecord }
const snapshot: Snapshot | null = existsSync(join(productionRoot, `${state}.json`))
  ? JSON.parse(readFileSync(join(productionRoot, `${state}.json`), "utf8")) : null;
const productionPointer = metadata.pointers.find((row: { scope: string }) => row.scope === `US-${state}:voting-sites`);
if (productionPointer) assert.ok(snapshot, `${state}: its exact production pointer must be exported before replay`);

class ReplayRoutineDataStore extends MemoryRoutineDataStore {
  readonly createdCandidateIds: string[] = [];
  override async create(...args: Parameters<MemoryRoutineDataStore["create"]>): Promise<void> {
    await super.create(...args);
    this.createdCandidateIds.push(args[0].candidate.id);
  }
}
const store = new ReplayRoutineDataStore(), repos = createMemoryRepositories();
if (snapshot) {
  assert.equal(snapshot.identity.read_only, "on"); assert.equal(snapshot.identity.can_write, false);
  assert.equal(snapshot.projection.versionId, productionPointer?.versionId, `${state}: the exported candidate and production baseline must name the same version`);
  snapshot.record = { ...snapshot.record, candidate: decodeStateCandidate(snapshot.record.candidate) as RoutineCandidate };
  assert.equal(promotionProofIssue("VOTING_SITE", snapshot.projection.scope, snapshot.projection, snapshot.record), null,
    `${state}: the exported production pointer must prove its original candidate and receipt`);
  const { candidate, receipt } = snapshot.record;
  assert.ok(receipt?.decision === "GOOD");
  await store.create({ ...snapshot.record, state: "FETCHED", receipt: null, promotedVersion: null, lastKnownGoodVersion: null },
    { candidateId: candidate.id, sequence: 1, state: "FETCHED", at: candidate.retrieval.retrievedAt,
      detail: "Read-only copy of an already published production candidate; source freshness is not renewed by importing it." });
  await store.transition(candidate.id, "NORMALIZED", receipt.validatedAt, "Restore the production candidate unchanged in the replay store");
  await store.transition(candidate.id, "VALIDATED", receipt.validatedAt, "Restore its existing GOOD production receipt", receipt);
  await store.promote(candidate.id, receipt, snapshot.projection.promotedAt);
}

// --live reads the official publishers now (public pages, read-only). Otherwise saved source responses come from
// the runner's evidence store (scripts/vs07-evidence.mts), not the code tree.
const live = process.argv.includes("--live");
const sourceStore = vs07EvidenceStore(root);
const captures: Map<string, SavedSourceResponse> = live ? new Map() : await savedSourceResponses(sourceStore);
assert.ok(live || captures.size, "Import the saved VS-07 source responses first: scripts/vs07-evidence.mts import --from=<saved capture directory>");
// Named ZIPs read through the reader's own ZIP geography after each pass, as /api/voting-sites does for a ZIP.
const zips = (assignment(process.argv, "zips") ?? "").split(",").filter(Boolean);
const seeds = ["voting-source-doors.json", "voting-legacy-doors.json"].flatMap(file =>
  JSON.parse(readFileSync(join(root, "data", "reference", file), "utf8")) as VotingSourceDoor[]).filter(row => row.scope.state === state);
const stateSeedsSha256 = createHash("sha256").update(JSON.stringify(seeds)).digest("hex");

const registryPath = join(productionRoot, `${state}-registry.json`);
const registry: Pick<Registry, "divisions" | "bodies"> = existsSync(registryPath)
  ? JSON.parse(readFileSync(registryPath, "utf8")) : { divisions: [], bodies: [] };
// The supplied scopes already carry verified county/town identities. They can
// supply their own registry identity when the full reference snapshot is absent.
for (const scope of [...seeds.map(row => row.scope), ...(snapshot?.projection.payload.jurisdictions ?? [])]) {
  if (!registry.divisions.some(row => row.ocdId === scope.ocdId)) registry.divisions.push({
    ocdId: scope.ocdId, label: scope.name, state, divisionType: scope.countySubdivisionGeoid ? "cousub" : scope.countyFips ? "county" : "state",
    geoid: scope.countySubdivisionGeoid ?? scope.countyFips, parentOcdId: null,
  } as Registry["divisions"][number]);
}

const evidence = new DurableEvidenceStore(join(root, ".scratch", "vs07-replay-vault", state), { remote: null });
const ledger = new Map();
const vault: CycleVault = {
  ledger,
  async putBytes(artifact, bytes) { const { key } = await putArtifact(evidence, "freshness", artifact, bytes);
    ledger.set(artifact.id, { artifactId: artifact.id, key, byteLength: bytes.byteLength, tier: artifact.tier, canonicalUrl: artifact.canonicalUrl });
    return { stored: true, where: key, why: "Local read-only production replay evidence" }; },
  async put(artifact, body) { return this.putBytes(artifact, new TextEncoder().encode(body)); },
  async readBack(key) { const held = await evidence.get(key); return held ? new TextDecoder().decode(held.bytes) : null; },
  async readHeld() { return null; },
};
const task = AUTOMATIC_REFRESH_TASKS.find(task => task.id === `voting-sites:${state}`)!;
assert.ok(task);
const clock = metadata.clocks.find((row: { scope: string }) => row.scope === task.scope);
const actualNow = Date.now.bind(Date), replayStart = actualNow();
let peakProcessTreeBytes = 0;
function sampleProcessTree(): void {
  let bytes = 0;
  const pending = [process.pid];
  for (let index = 0; index < pending.length; index++) {
    const pid = pending[index]!;
    try { bytes += Number(/^VmHWM:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024; } catch { continue; }
    try { pending.push(...readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number)); } catch { /* A child can exit during the sample. */ }
  }
  peakProcessTreeBytes = Math.max(peakProcessTreeBytes, bytes, process.resourceUsage().maxRSS * 1024);
}
sampleProcessTree();
const memorySampler = setInterval(sampleProcessTree, 100);
memorySampler.unref();
/** The first minute at or after `fromMs` when the standing schedule admits this task for `scheduleClock`. */
function firstDueAt(scheduleClock: Parameters<typeof routineTaskDue>[1], fromMs: number): number {
  for (let at = Math.ceil(fromMs / 60_000) * 60_000; at <= fromMs + 7 * 86_400_000; at += 60_000) if (routineTaskDue(task, scheduleClock, at)) return at;
  throw new Error(`${state}: the standing schedule never admits this task within seven days`);
}
// The first pass runs when production's own clock next admits the task (or at --at); the second runs at the first
// minute the clock written by the first pass admits it again: the next scheduled run.
let nextAt = assignment(process.argv, "at") ? Date.parse(assignment(process.argv, "at")!) : firstDueAt(clock, replayStart);
const passes: unknown[] = [];
let held = snapshot?.projection.payload ?? null;
for (const day of [0, 1]) {
  if (day) nextAt = firstDueAt(await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion), nextAt + 60_000);
  const started = actualNow(), observedAt = new Date(nextAt).toISOString();
  // Only this worker's deterministic clock advances; timers/transport still use
  // real elapsed time, and the same job receives a matching explicit deadline.
  Date.now = () => Date.parse(observedAt) + actualNow() - started;
  const requested: { url: string; representation: string; sourceCapturedAt?: string; sha256?: string }[] = [];
  const fetchSource: typeof fetch = async (input, _init) => {
    const url = String(input), capture = captures.get(url);
    if (live) {
      requested.push({ url, representation: "live official source response" });
      return fetch(input, _init);
    }
    if (capture) {
      // The store re-verifies each body against its saved digest on read.
      const held = await sourceStore.get(capture.key);
      assert.ok(held, `${url}: saved response is missing from the evidence store`);
      const hash = createHash("sha256").update(held.bytes).digest("hex");
      assert.equal(hash, capture.sha256);
      requested.push({ url, representation: "saved official source response", sourceCapturedAt: capture.capturedAt, sha256: hash });
      return new Response(new Uint8Array(held.bytes), { status: capture.status, headers: { "content-type": capture.contentType, ...capture.responseHeaders } });
    }
    // Discovery is replayed only where a real response is held. A missing saved
    // response remains an explicit source failure rather than an invented page.
    requested.push({ url, representation: "unrecorded source response" });
    throw new Error("This source response is not held in the read-only replay corpus");
  };
  let result: Awaited<ReturnType<typeof refreshVotingSources>> | null = null, failure: string | null = null;
  const before = await readVotingSitesProjection(state, { store, now: observedAt, bypassCache: true });
  const passPredecessor = before.kind === "PROMOTED" ? await store.readCandidate(before.projection.versionId) : null;
  const firstCandidateIndex = store.createdCandidateIds.length;
  const priorSites = held?.jurisdictions.flatMap(row => row.sites.map(site => `${row.ocdId}:${site.id}`)) ?? [];
  const scheduleClock = day ? await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion) : clock;
  const due = routineTaskDue(task, scheduleClock, Date.parse(observedAt));
  assert.ok(due, `${state}: this pass must be due through the ordinary standing schedule`);
  const slotStartedAt = Date.now(), slotEndsAt = slotStartedAt + slotBudgetMs;
  const acquisitionDeadlineMs = votingAcquisitionDeadline(slotStartedAt, slotEndsAt);
  try { result = await refreshVotingSources({ state, store, context: { repos }, seeds, registry, vault,
    now: () => observedAt, deadlineMs: acquisitionDeadlineMs, fetch: fetchSource, geocode: async () => null }); }
  catch (error) { failure = error instanceof Error ? error.message : String(error); }
  // Candidates settle in order; each held replacement is re-checked against the version promoted just before it.
  let predecessor = passPredecessor;
  const candidateOutcomes = [];
  for (const candidateId of store.createdCandidateIds.slice(firstCandidateIndex)) {
    const record = await store.readCandidate(candidateId);
    assert.ok(record);
    const replacementIssue = record.state !== "PROMOTED" && record.receipt?.checks.some(check => check.code === "VOTING_SOURCE_REPLACEMENT_UNPROVEN")
      ? await verifyVotingSourceReplacement(record.candidate, predecessor?.candidate ?? null) : null;
    if (record.state === "PROMOTED") predecessor = record;
    candidateOutcomes.push({ candidateId, state: record.state, acquisitionSucceeded: record.acquisitionSucceeded, replacementIssue,
      promotedVersion: record.promotedVersion, failureCode: record.failureCode, failureDetail: record.failureDetail,
      requestedUrl: record.candidate.retrieval.requestedUrl,
      rows: record.candidate.normalization.outputRecords,
      removalEvidence: record.candidate.removalEvidence ?? [],
      nonPassingChecks: record.receipt?.checks.filter(check => check.verdict !== "PASS") ?? [],
    });
  }
  const read = await readVotingSitesProjection(state, { store, now: observedAt, bypassCache: true });
  if (read.kind === "PROMOTED") held = read.value;
  const nextSites = held?.jurisdictions.flatMap(row => row.sites.map(site => `${row.ocdId}:${site.id}`)) ?? [];
  const readerBoundaries = held?.jurisdictions.filter(row => row.boundaries?.length).map(row => ({
    jurisdiction: row.ocdId, boundaries: row.boundaries!.length,
  })) ?? [];
  const retainedIds = new Set(nextSites);
  const disappeared = priorSites.filter(id => !retainedIds.has(id));
  const officialReplacementKeys = new Set(candidateOutcomes.filter(candidate => candidate.state === "PROMOTED")
    .flatMap(candidate => candidate.removalEvidence.filter(evidence => evidence.code === "OFFICIAL_VOTING_SOURCE_REPLACED").map(evidence => evidence.key)));
  const pages: { answerSites: number; [key: string]: unknown }[] = [];
  const visibleSiteIds = new Set<string>();
  const targetCounty = ({ NC: "37119", CA: "06073", PA: "42101", TX: "48029" } as Record<string, string>)[state];
  const populated = (held?.jurisdictions ?? []).filter(row => row.sites.length);
  for (const jurisdiction of populated) {
    // Every distinct official scope is projected. A statewide PRECINCT row with
    // no county scope remains an explicit missing row; no address is invented.
    const scopedSites = new Map(jurisdiction.sites.map(site => [JSON.stringify([
      site.countyFips ?? jurisdiction.countyFips, site.countyName,
      site.countySubdivisionGeoid ?? jurisdiction.countySubdivisionGeoid,
      (site.matchingUnit ?? jurisdiction.matchingUnit) === "TOWN" ? site.town : null,
      (site.matchingUnit ?? jurisdiction.matchingUnit) === "WARD" ? site.ward : null,
      site.districtOcdIds,
    ]), site]));
    for (const site of scopedSites.values()) {
    const ancestry: Registry["divisions"] = [];
    let division = registry.divisions.find(row => row.ocdId === jurisdiction.ocdId);
    while (division && !ancestry.some(row => row.ocdId === division!.ocdId)) {
      ancestry.push(division);
      division = registry.divisions.find(row => row.ocdId === division!.parentOcdId);
    }
    const county = ancestry.find(row => row.divisionType === "county");
    const countyFips = site.countyFips ?? jurisdiction.countyFips ?? county?.geoid;
    const basePlace = votingPlaceFromZip([...ancestry.map(row => row.ocdId), jurisdiction.ocdId, ...(site.districtOcdIds ?? [])]);
    const place: VotingReaderPlace = { ...basePlace,
      countyFips: [...new Set([...basePlace.countyFips, ...[countyFips].filter(Boolean) as string[]])],
      countyNames: [...new Set([...(basePlace.countyNames ?? []), ...[site.countyName ?? county?.label].filter(Boolean) as string[]])],
      countySubdivisionGeoids: [site.countySubdivisionGeoid ?? jurisdiction.countySubdivisionGeoid].filter(Boolean) as string[],
      towns: [...new Set([...basePlace.towns, ...[site.town].filter(Boolean) as string[]])],
    };
    const answer = await answerVotingSites(held!, place);
    const markup = renderToStaticMarkup(createElement(VotingJurisdictionRecords, { answer, selectedSiteId: null, onSelectSite: () => {} }));
    const visible = (markup.match(/data-voting-site=/g) ?? []).length;
    const answerSites = answer.jurisdictions.flatMap(row => row.sites);
    for (const row of answer.jurisdictions) for (const shown of row.sites) visibleSiteIds.add(`${row.ocdId}:${shown.id}`);
    assert.equal(visible, answerSites.length, `${state}: actual panel renders every returned location`);
    const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
    const displayed = answerSites[0];
    if (displayed) {
      assert.ok(markup.includes(escapeHtml(displayed.name)) && markup.includes(escapeHtml(displayed.address)), `${state}: source name and address are visible in the actual panel`);
      if (displayed.hours) assert.ok(markup.includes(escapeHtml(displayed.hours)), `${state}: source hours are visible in the actual panel`);
    }
    pages.push({ jurisdiction: jurisdiction.ocdId, countyFips: countyFips ?? null, precision: place.precision, answerSites: answerSites.length, renderedSites: visible,
      issue: displayed ? null : "Published sites did not survive the real reader geography projection",
      confirmedNovemberSites: answerSites.filter(site => site.electionDate === "2026-11-03").length,
      sitesWithHours: answerSites.filter(site => site.hours || site.schedules?.some(row => row.hours)).length,
      electionDaySitesWithHours: answerSites.filter(site => (site.kind === "ELECTION_DAY" || site.kinds?.includes("ELECTION_DAY")) &&
        (site.hours || site.schedules?.some(row => row.kind === "ELECTION_DAY" && row.hours))).length,
      sourceUrls: [...new Set(answerSites.flatMap(site => site.sources?.map(source => source.url) ?? []))],
      markupSha256: createHash("sha256").update(markup).digest("hex"), sample: displayed ? { name: displayed.name, address: displayed.address,
        hours: displayed.hours, electionDate: displayed.electionDate ?? null, scheduleRows: displayed.schedules?.length ?? 0 } : null });
    await mkdir(join(outputRoot, "pages"), { recursive: true });
    await writeFile(join(outputRoot, "pages", `${state}-${day}-${pages.length}.html`), markup);
    }
  }
  const exactPointPages: unknown[] = [];
  const pointFixture = "tests/fixtures/voting-sources/vs-07-philly-boundaries/polling-place-native-point.geojson";
  if (state === "PA" && readerBoundaries.length && existsSync(pointFixture)) {
    const fixtureBytes = readFileSync(pointFixture);
    const feature = JSON.parse(fixtureBytes.toString("utf8")).features[0];
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    const answer = await answerVotingSites(held!, { precision: "ADDRESS", point: { lat, lng },
      divisionIds: [], states: ["PA"], countyFips: ["42101"], countyNames: ["Philadelphia"],
      countySubdivisionGeoids: [], towns: ["Philadelphia"], wards: [], aiannhGeoids: [], precincts: [] });
    const sites = answer.jurisdictions.flatMap(row => row.sites);
    assert.equal(sites.length, 1, "The current official point must reach one assigned Philadelphia facility through the published typed reader");
    assert.ok(answer.jurisdictions.some(row => row.narrowing.kind === "EXACT"));
    assert.ok(sites[0]!.hours);
    const markup = renderToStaticMarkup(createElement(VotingJurisdictionRecords, { answer, selectedSiteId: null, onSelectSite: () => {} }));
    assert.equal((markup.match(/data-voting-site=/g) ?? []).length, 1);
    assert.ok(markup.includes(sites[0]!.hours));
    exactPointPages.push({ inputKind: "Native official polling-facility point; this is not a real-home live check", fixture: pointFixture,
      fixtureSha256: createHash("sha256").update(fixtureBytes).digest("hex"), renderedSites: 1,
      site: { name: sites[0]!.name, address: sites[0]!.address, hours: sites[0]!.hours, electionDate: sites[0]!.electionDate },
      markupSha256: createHash("sha256").update(markup).digest("hex") });
    await writeFile(join(outputRoot, "pages", `${state}-${day}-native-point.html`), markup);
  }
  const zipPages: unknown[] = [];
  for (const zip of zips) {
    const entry = await readZipPlace(zip);
    const place = votingPlaceFromZip(entry?.ids ?? []);
    const answer = place.states.includes(state) && held ? await answerVotingSites({ ...held, jurisdictions: held.jurisdictions }, place) : null;
    const sites = answer?.jurisdictions.flatMap(row => row.sites) ?? [];
    const markup = answer ? renderToStaticMarkup(createElement(VotingJurisdictionRecords, { answer, selectedSiteId: null, onSelectSite: () => {} })) : "";
    const rendered = (markup.match(/data-voting-site=/g) ?? []).length;
    if (answer) assert.equal(rendered, sites.length, `${state} ${zip}: the actual panel renders every returned location`);
    zipPages.push({ zip, states: place.states, countyFips: place.countyFips, answerSites: sites.length, renderedSites: rendered,
      narrowing: answer?.jurisdictions.map(row => row.narrowing.kind) ?? [], withHours: sites.filter(site => site.hours || site.schedules?.some(row => row.hours)).length,
      sharedRules: [...new Set(answer?.jurisdictions.flatMap(row => (row as { rules?: { text: string }[] }).rules?.map(rule => rule.text) ?? []) ?? [])],
      sample: sites[0] ? { name: sites[0].name, address: sites[0].address, hours: sites[0].hours ?? null, kind: sites[0].kind, electionDate: sites[0].electionDate ?? null } : null });
  }
  sampleProcessTree();
  const pass = { observedAt, scheduleClock, zipPages, live, dueByStandingSchedule: due, invokedExactJob: true, publications: result?.publications ?? 0,
    slotBudgetMs, acquisitionBudgetMs: acquisitionDeadlineMs - slotStartedAt,
    reservedSettlementMs: slotEndsAt - acquisitionDeadlineMs, finishedWithinSlot: actualNow() - started <= slotBudgetMs,
    candidateOutcomes,
    attemptedSourceIds: result?.attemptedSourceIds ?? [], failure, readKind: read.kind, versionId: read.metadata.versionId,
    priorSites: priorSites.length, sites: nextSites.length, disappearedSiteIds: disappeared, sourceRequests: requested,
    disappearedWithoutOfficialReplacement: disappeared.filter(id => !officialReplacementKeys.has(`site:${id}`)),
    readerVisibleSites: nextSites.filter(id => visibleSiteIds.has(id)).length,
    readerMissingSiteIds: nextSites.filter(id => !visibleSiteIds.has(id)),
    readerBoundaries, exactPointPages,
    scheduleRows: held?.jurisdictions.flatMap(row => row.sites.flatMap(site => site.schedules ?? [])).length ?? 0,
    datedScheduleRows: held?.jurisdictions.flatMap(row => row.sites.flatMap(site => site.schedules ?? [])).filter(row => row.date).length ?? 0,
    peakWorkerRssBytes: process.resourceUsage().maxRSS * 1024, peakSampledProcessTreeBytes: peakProcessTreeBytes,
    countyFips: [...new Set(held?.jurisdictions.flatMap(jurisdiction => jurisdiction.sites.map(site => site.countyFips ?? jurisdiction.countyFips).filter(Boolean)) ?? [])].sort(),
    readerSourceUrls: [...new Set(held?.jurisdictions.flatMap(jurisdiction => jurisdiction.sites.flatMap(site => site.sources?.map(source => source.url) ?? [])) ?? [])],
    openWorkItems: (await repos.workItems.list()).length, targetCounty: targetCounty ?? null,
    targetCountyHasSites: !targetCounty || pages.some(page => page.countyFips === targetCounty && page.answerSites > 0),
    pages, codeChangedDuringReplay: codeFiles.some(file => createHash("sha256").update(readFileSync(file)).digest("hex") !== codeHashes[file]), elapsedMs: actualNow() - started };
  passes.push(pass);
  for (const outcome of candidateOutcomes) if (outcome.state !== "PROMOTED") console.log(`VS07_HELD ${state} day=${day} ${outcome.requestedUrl} ${outcome.failureCode ?? outcome.state}${outcome.replacementIssue ? `: ${outcome.replacementIssue}` : ""}`);
  console.log(`VS07_REPLAY ${state} day=${day} at=${observedAt} due=${due} publications=${pass.publications} sites=${pass.sites} failure=${failure ?? "none"}`);
  for (const page of zipPages as { zip: string; answerSites: number; renderedSites: number; sample: { name: string; address: string } | null }[])
    console.log(`VS07_ZIP ${state} day=${day} zip=${page.zip} sites=${page.answerSites} rendered=${page.renderedSites} first=${page.sample ? `${page.sample.name} | ${page.sample.address}` : "none"}`);
}
Date.now = actualNow;
clearInterval(memorySampler);
await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, `${state}.json`), JSON.stringify({ state, codeHashes, stateSeedsSha256, production: { database: metadata.database, identity: metadata.identity,
  pointer: productionPointer ?? null, snapshotImported: Boolean(snapshot) }, boundary: { feedsFrom: "RN-01 standing voting-sites task launch and registered official source doors",
  feeds: "LV-01 voting reader answer to VotingJurisdictionRecords on map/ballot pages", productionWrites: 0,
  limitations: [live ? "Official publishers were read live now; the second pass runs at the next scheduled minute on a controlled clock, reading the publishers again."
    : "Saved source responses are replayed at controlled clocks; this is not a fresh publisher check tomorrow.",
    "Every held site is checked through each distinct published county/town scope and the actual ZIP-precision panel; post-shipping real-home-address checks remain separate.",
    "Calling an eligible scope through the exact job does not prove RN-01 admission launches it in production."] }, passes }, null, 2));
