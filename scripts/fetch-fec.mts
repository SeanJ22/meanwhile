/** @freshness-reads-here — stored source observations survive replay and failed refresh. */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverFecCandidates, fecRegistrationTargets, type FecDiscovery } from "../lib/funding/fec-discovery.ts";
import { fecBulkUrls, fecBulkText, parseFecBulk } from "../lib/funding/fec-bulk.ts";
import { collectFecCandidate, collectFecCommittee, collectFecSmallDonorLines, projectFecDiscovery } from "../lib/funding/fec-collector.ts";
import { fecCycle, parseFecPage, type FecReadPage } from "../lib/funding/fec-api.ts";
import type { FundingSnapshot, SecondHopCommittee } from "../lib/funding/types.ts";
import { FEDERAL_DIRECTORY_STATES, federalDirectoryScope, type FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { isSourceAcquisitionFailure, sourceAcquisitionFailure, recordRegisteredSourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { writeRoutineReceiptLine } from "../lib/civic-data/receipt-output.ts";
import { isSourceAcquisitionDeadlineError, openSourceAcquisitionDomain, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, sourceAcquisitionSleep } from "../lib/sources/acquisition-deadline.ts";
import { acquireKnownRelease, knownReleaseSourceCheck } from "../lib/sources/known-release.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(ROOT, ".env.local") });
installNeonRequestDeadline();
const promote = process.argv.includes("--promote");
if (!promote) throw new Error("Run the registered fec-funding adapter with --promote.");
prepareProductionCivicDataWrite();
const store = new PostgresRoutineDataStore();
const cycle = fecCycle(new Date(), process.argv.find(arg => arg.startsWith("--cycle="))?.slice(8));
const key = process.env.FEC_API_KEY;
const current = await store.readPromotion<FundingSnapshot>("FEC_FUNDING", "federal-supported");
const prior = current?.payload ?? JSON.parse(readFileSync(join(ROOT, "data/fec/fec-2026.json"), "utf8")) as FundingSnapshot;
// FEC registrations are national, so every place's members are joined by their exact FEC IDs.
const places = (await Promise.all(FEDERAL_DIRECTORY_STATES.map(state => store.readPromotion<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", federalDirectoryScope(state)))))
  .flatMap(row => row ? [row.payload.roster] : []);
const roster: OfficeholderSet | null = places.length ? { ...places[0], officeholders: places.flatMap(row => row.officeholders), divisions: places.flatMap(row => row.divisions),
  unmatched: places.flatMap(row => row.unmatched) } : null;
const gaps: { code: string; detail: string }[] = [];
if (!roster) gaps.push({ code: "CONGRESS_SOURCE_NOT_HELD", detail: "FEC registrations remain separate candidate records until the directory supplies their exact FEC IDs." });
const domain = openSourceAcquisitionDomain({ sourceLabel: "FEC national registrations and filings", timeoutMs: ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS });
const rawHashes: string[] = [], attempts = { ...prior.refreshAttempts };
const sourceReceipts: { retrievedAt: string; check: ReturnType<typeof knownReleaseSourceCheck> }[] = [];
let observation = "", finalUrl = "https://api.open.fec.gov/v1/", lastAttemptedUrl = finalUrl, nextFecRequestAt = 0, apiRetryAt = 0;
const read: FecReadPage = async (path, params) => {
  if (!key) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "OpenFEC authentication unavailable; using the public FEC bulk files.");
  const url = new URL(`https://api.open.fec.gov/v1${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  lastAttemptedUrl = url.href;
  const acquired = await acquireKnownRelease({ sourceId: "fec-open-api", releaseId: url.href,
    url: url.href, parserVersion: "fec-funding/4", signal: domain.signal,
    maxBytes: 8 * 1024 * 1024, checkAfterMs: 24 * 60 * 60_000,
    fetchImpl: async (resource, init) => {
      if (Date.now() < apiRetryAt) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "OpenFEC Retry-After is pending; the bulk files remain available.");
      const authenticated = new URL(String(resource)); authenticated.searchParams.set("api_key", key);
      for (let attempt = 0; ; attempt++) {
        // Keep the existing 250 ms provider spacing across workers;
        // replaying already-held bytes consumes no provider request.
        const delayUntilRequest = Math.max(0, nextFecRequestAt - Date.now());
        nextFecRequestAt = Date.now() + delayUntilRequest + 250;
        if (delayUntilRequest) await sourceAcquisitionSleep(delayUntilRequest, domain.signal);
        if (Date.now() < apiRetryAt) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "OpenFEC Retry-After is pending; the bulk files remain available.");
        const response = await fetch(authenticated, { ...init, redirect: "error", signal: AbortSignal.any([domain.signal, AbortSignal.timeout(60_000)]), headers: { ...Object.fromEntries(new Headers(init?.headers)),
          "user-agent": "Meanwhile civic data (contact: seanj22@gmail.com)" } });
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          const retry = response.headers.get("retry-after"), seconds = Number(retry);
          const delay = retry ? Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retry) - Date.now()) : 2000 * (attempt + 1);
          if (response.status === 429 || delay >= 60_000) {
            apiRetryAt = Date.now() + (Number.isFinite(delay) ? Math.max(delay, 250) : 30_000);
            // No API request is retried before this provider window. Discovery
            // can use bulk immediately, without consuming its entire deadline.
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
          }
          await response.body?.cancel(); await sourceAcquisitionSleep(Number.isFinite(delay) ? delay : 30_000, domain.signal); continue;
        }
        // The transport URL contains a credential; the vault stores only
        // the canonical public URL and the unmodified response bytes.
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
    }, validate: bytes => { parseFecPage(Buffer.from(bytes).toString("utf8")); },
  }).catch(error => {
    if (isSourceAcquisitionDeadlineError(error)) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "FEC source acquisition deadline elapsed.");
    throw error;
  });
  const raw = Buffer.from(acquired.bytes).toString("utf8");
  sourceReceipts.push({ retrievedAt: acquired.retrievedAt, check: knownReleaseSourceCheck(acquired) });
  rawHashes.push(acquired.sha256); finalUrl = url.href;
  observation = observation > acquired.sourceObservedAt ? observation : acquired.sourceObservedAt;
  return { ...parseFecPage(raw), sourceObservedAt: acquired.sourceObservedAt };
};
async function bulk(): Promise<FecDiscovery> {
  const urls = fecBulkUrls(cycle), suffix = String(cycle).slice(-2);
  const releases = await Promise.allSettled(Object.values(urls).map(url => {
    lastAttemptedUrl = url;
    return acquireKnownRelease({
    sourceId: "fec-open-api", releaseId: url, url, parserVersion: "fec-funding/4", signal: domain.signal,
    maxBytes: 32 * 1024 * 1024, checkAfterMs: 24 * 60 * 60_000,
    validate: bytes => { fecBulkText(bytes, url === urls.master ? "cn.txt" : `weball${suffix}.txt`); },
    });
  }));
  const failure = releases.find(row => row.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  const held = releases.map(row => { if (row.status !== "fulfilled") throw new Error("FEC_BULK_NOT_SETTLED"); return row.value; });
  for (const release of held) {
    rawHashes.push(release.sha256); sourceReceipts.push({ retrievedAt: release.retrievedAt, check: knownReleaseSourceCheck(release) });
  }
  finalUrl = urls.master;
  return parseFecBulk(fecBulkText(held[0].bytes, "cn.txt"), fecBulkText(held[1].bytes, `weball${suffix}.txt`), cycle,
    held.map(row => row.sourceObservedAt).sort()[0]);
}
let published = false;
try {
  const discovery = await discoverFecCandidates({ cycle, read, observedAt: () => observation, bulk,
    onApiFailure: detail => gaps.push({ code: "FEC_API_BULK_FALLBACK", detail }) });
  const candidates = new Map(projectFecDiscovery(discovery, cycle, roster ?? undefined, prior.candidates).map(row => [row.fecCandidateId, row]));
  const registrations = new Set(discovery.registrations.map(row => row.candidateId));
  for (const row of prior.candidates) if (!registrations.has(row.fecCandidateId)) gaps.push({
    code: "FEC_PRIOR_FILING_RETAINED",
    detail: `${row.fecCandidateId}: the ${cycle} election-registration query does not withdraw this verified filing; its original period and source dates remain.`,
  });
  const secondHop = new Map<string, SecondHopCommittee>((prior.secondHop ?? []).map(row => [row.committeeId, { ...row, cycle: row.cycle ?? prior.cycle }]));
  const countsByState: Record<string, number> = {};
  for (const row of candidates.values()) countsByState[row.state] = (countsByState[row.state] ?? 0) + 1;
  console.log(`FEC ${cycle}: ${candidates.size} candidate records across ${Object.keys(countsByState).length} state/territory codes (${discovery.route}).`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(countsByState).sort())));
  async function publish() {
    const originalRetrievedAt = sourceReceipts.map(row => row.retrievedAt).sort()[0];
    const sourceCheck = sourceReceipts.map(row => row.check).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))[0];
    const rows = [...candidates.values()];
    const snapshot: FundingSnapshot = { formatVersion: 1, fetchedAt: originalRetrievedAt, cycle, candidates: rows, absences: [],
      secondHop: [...secondHop.values()], refreshAttempts: attempts,
      coverage: { discoveryRoute: discovery.route, countsByState },
      matchReport: { rosterMatched: new Set(rows.flatMap(row => row.targetKeys.filter(key => key.startsWith("congress:")))).size,
        rosterTotal: roster?.officeholders.length ?? 0,
        ballotMatched: rows.filter(row => row.targetKeys.some(key => key.startsWith("ballot-"))).length,
        ballotTotal: rows.filter(row => row.targetKeys.some(key => key.startsWith("ballot-"))).length } };
    const candidate = fecFundingCandidate({ snapshot, rawBodies: [], rawHashes, finalUrl, retrievedAt: originalRetrievedAt, sourceCheck, excludedFacts: gaps });
    const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", candidate, new Date().toISOString());
    printSourceRunnerReceipt("fec-funding", candidate, outcome);
    if (!outcome.promoted) throw new Error("FEC_NATIONAL_PROJECTION_REFUSED");
    published = true;
  }
  // National registration and money cards reach readers before optional receipt work.
  await publish();
  const work = [...candidates.values()].filter(row => row.cycle === cycle).map(row => row.fecCandidateId)
    .sort((a, b) => (attempts[a] ?? "").localeCompare(attempts[b] ?? "") || a.localeCompare(b));
  async function enrich(ids: string[], collect: (id: string) => Promise<void>) {
    let index = 0;
    const workers = await Promise.allSettled(Array.from({ length: 3 }, async () => {
      for (;;) {
        if (domain.signal.aborted || Date.now() < apiRetryAt) return;
        const id = ids[index++]; if (!id) return;
        try { await collect(id); }
        catch (error) {
          if (!isSourceAcquisitionFailure(error) && !isSourceAcquisitionDeadlineError(error)) throw error;
          gaps.push({ code: "FEC_OPTIONAL_FACT_NOT_REFRESHED", detail: `${id}: ${error.message}; held facts retain their original dates.` });
        }
      }
    }));
    const failure = workers.find(row => row.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  if (key && discovery.route === "api") {
    await enrich(work, async id => {
      attempts[id] = new Date().toISOString();
      candidates.set(id, await collectFecSmallDonorLines(candidates.get(id)!, read, () => observation));
    });
    await publish();
    await enrich(work, async id => {
      const row = candidates.get(id)!;
      const registration = discovery.registrations.find(registration => registration.candidateId === id);
      const targets = registration ? fecRegistrationTargets(registration, roster ?? undefined) : row.targetKeys.map(targetKey => ({
        targetKey, displayName: row.name, state: row.state, office: row.office, district: row.district,
        route: targetKey.startsWith("fec:") ? "fec" as const : "roster" as const, knownFecCandidateId: id,
      }));
      const totals = { candidate_id: id, cycle, receipts: row.totals.receipts, disbursements: row.totals.disbursements,
        last_cash_on_hand_end_period: row.totals.cashOnHand, coverage_end_date: row.totals.coverageEndDate,
        individual_itemized_contributions: row.totals.individualItemized, individual_unitemized_contributions: row.totals.individualUnitemized };
      const result = await collectFecCandidate({ candidateId: id, cycle, targets, totals, previous: row, read, observedAt: () => row.provenance.collectedAt });
      gaps.push(...result.gaps.map(detail => ({ code: "FEC_RECEIPTS_INCOMPLETE", detail })));
      if (result.candidate) candidates.set(id, { ...row, principalCommitteeId: result.candidate.principalCommitteeId,
        principalCommitteeIds: result.candidate.principalCommitteeIds, topContributions: result.candidate.topContributions,
        acquisition: result.candidate.acquisition });
    });
    const hopIds = [...new Set([...candidates.values()].flatMap(row => row.topContributions)
      .filter(row => row.kind === "COMMITTEE_OR_ORGANIZATION" && ["CCM", "COM", "ORG", "PAC", "PTY"].includes(row.entityType ?? ""))
      .flatMap(row => row.contributorCommitteeId && /^C\d{8}$/.test(row.contributorCommitteeId) ? [row.contributorCommitteeId] : []))];
    await enrich(hopIds, async id => { secondHop.set(id, await collectFecCommittee({ committeeId: id, cycle, read, observedAt: () => observation })); });
  } else gaps.push({ code: "FEC_OPTIONAL_API_UNAVAILABLE", detail: "The FEC bulk summary supplies filed totals; individual filing lines and organization receipts remain standing API work." });
  if (domain.signal.aborted) gaps.push({ code: "FEC_ENRICHMENT_DEADLINE", detail: "National cards published; remaining filing-line and receipt refreshes continue on the next standing run." });
  await publish();
} catch (error) {
  if (!isSourceAcquisitionFailure(error) && !isSourceAcquisitionDeadlineError(error)) throw error;
  const failed = await recordRegisteredSourceAcquisitionFailure({ store, contractId: "fec-funding", requestedUrl: lastAttemptedUrl,
    failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", published ? "Optional FEC refresh failed; national projection retained." : "FEC API and bulk acquisition failed; previous projection retained."), attemptedAt: new Date().toISOString() });
  await writeRoutineReceiptLine(failed.line); process.exitCode = 2;
} finally { domain.dispose(); }
