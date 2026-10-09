/** @freshness-reads-here — stored source observations survive replay and failed refresh. */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promotedCongressTargets, type FecTarget } from "../lib/funding/fec-targets.ts";
import { collectFecCandidate, collectFecCommittee } from "../lib/funding/fec-collector.ts";
import { fecCycle, parseFecPage, type FecReadPage } from "../lib/funding/fec-api.ts";
import type { FundingSnapshot, FundingCandidate, SecondHopCommittee } from "../lib/funding/types.ts";
import { FEDERAL_DIRECTORY_SCOPE, type FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
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
const promote = process.argv.includes("--promote"), matchOnly = process.argv.includes("--match-only");
if (!promote && !matchOnly) throw new Error("Run the registered fec-funding adapter with --promote.");
if (promote) prepareProductionCivicDataWrite();
const store = new PostgresRoutineDataStore();
const cycle = fecCycle(new Date(), process.argv.find(arg => arg.startsWith("--cycle="))?.slice(8));
const key = process.env.FEC_API_KEY;
if (!key && !matchOnly) throw new Error("FEC_API_KEY is not configured");
const current = await store.readPromotion<FundingSnapshot>("FEC_FUNDING", "federal-supported");
const prior = current?.payload ?? JSON.parse(readFileSync(join(ROOT, "data/fec/fec-2026.json"), "utf8")) as FundingSnapshot;
const roster = await store.readPromotion<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_SCOPE);
const targets = new Map<string, FecTarget>();
for (const held of prior.candidates) for (const targetKey of held.targetKeys) targets.set(`${targetKey}:${held.fecCandidateId}`, {
  targetKey, displayName: held.name, state: held.state, office: held.office,
  district: held.district, route: targetKey.startsWith("congress:") ? "roster" : "ballot",
  knownFecCandidateId: held.fecCandidateId,
});
const gaps: { code: string; detail: string }[] = [];
if (roster) for (const target of promotedCongressTargets(roster.payload.roster, prior, id =>
  gaps.push({ code: "NATIVE_FEC_SCOPE_UNRESOLVED", detail: `${id}: current congressional office scope is unresolved; other members remain refreshable.` }))) {
  const ids = target.knownFecCandidateIds ?? (target.knownFecCandidateId ? [target.knownFecCandidateId] : []);
  if (!ids.length) gaps.push({ code: "NATIVE_FEC_ID_UNRESOLVED", detail: `${target.targetKey}: source-native FEC identity remains unbound.` });
  for (const id of ids) targets.set(`${target.targetKey}:${id}`, { ...target, knownFecCandidateId: id });
}
else gaps.push({ code: "CONGRESS_SOURCE_NOT_HELD", detail: "The Congress roster is not yet promoted; all already-held FEC identities remain refreshable." });
const byId = new Map<string, FecTarget[]>();
for (const target of targets.values()) {
  if (!target.knownFecCandidateId) continue;
  const held = byId.get(target.knownFecCandidateId) ?? []; held.push(target); byId.set(target.knownFecCandidateId, held);
}
console.log(`Native FEC identities: ${byId.size}; exact target bindings: ${targets.size}; period ${cycle}.`);
if (matchOnly) process.exit(0);

const domain = openSourceAcquisitionDomain({ sourceLabel: "FEC OpenFEC", timeoutMs: ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS });
const rawHashes: string[] = [], attempts = { ...prior.refreshAttempts };
const sourceReceipts: { retrievedAt: string; check: ReturnType<typeof knownReleaseSourceCheck> }[] = [];
const candidates = new Map(prior.candidates.map(row => [row.fecCandidateId, row]));
const secondHop = new Map<string, SecondHopCommittee>((prior.secondHop ?? []).map(row => [row.committeeId, { ...row, cycle: row.cycle ?? prior.cycle }]));
const hopIds = new Set(prior.candidates.flatMap(row => row.topContributions)
  .filter(row => row.kind === "COMMITTEE_OR_ORGANIZATION" && row.entityType !== "IND" && row.entityType !== "CAN")
  .map(row => row.contributorCommitteeId).filter((id): id is string => Boolean(id && /^C\d{8}$/.test(id))));
let successful = 0, finalUrl = "https://api.open.fec.gov/v1/";
let nextFecRequestAt = 0;
const work = [...byId.keys(), ...hopIds].sort((a, b) => (attempts[a] ?? "").localeCompare(attempts[b] ?? "") || a.localeCompare(b));
try {
  // Independent candidates publish through the same source projection. A failed
  // endpoint retains only its own facts, including their original observation date.
  let index = 0;
  const workers = await Promise.allSettled(Array.from({ length: 3 }, async () => {
    for (;;) {
      if (domain.signal.aborted) return;
      const id = work[index++]; if (!id) return;
      attempts[id] = new Date().toISOString();
      let observation = "";
      const read: FecReadPage = async (path, params) => {
        const url = new URL(`https://api.open.fec.gov/v1${path}`);
        for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
        const acquired = await acquireKnownRelease({ sourceId: "fec-open-api", releaseId: url.href,
          url: url.href, parserVersion: "fec-funding/3", signal: domain.signal,
          maxBytes: 8 * 1024 * 1024, checkAfterMs: 24 * 60 * 60_000,
          fetchImpl: async (resource, init) => {
            const authenticated = new URL(String(resource)); authenticated.searchParams.set("api_key", key!);
            for (let attempt = 0; ; attempt++) {
              // Keep the existing 250 ms provider spacing across workers;
              // replaying already-held bytes consumes no provider request.
              const delayUntilRequest = Math.max(0, nextFecRequestAt - Date.now());
              nextFecRequestAt = Date.now() + delayUntilRequest + 250;
              if (delayUntilRequest) await sourceAcquisitionSleep(delayUntilRequest, domain.signal);
              const response = await fetch(authenticated, { ...init, redirect: "error", signal: AbortSignal.any([domain.signal, AbortSignal.timeout(60_000)]), headers: { ...Object.fromEntries(new Headers(init?.headers)),
                "user-agent": "Meanwhile civic data (contact: seanj22@gmail.com)" } });
              if ((response.status === 429 || response.status >= 500) && attempt < 3) {
                const retry = response.headers.get("retry-after"), seconds = Number(retry);
                const delay = retry ? Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retry) - Date.now()) : 2000 * (attempt + 1);
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
      try {
        if (id.startsWith("C")) {
          secondHop.set(id, await collectFecCommittee({ committeeId: id, cycle, read, observedAt: () => observation }));
          successful++; continue;
        }
        const result = await collectFecCandidate({ candidateId: id, cycle, targets: byId.get(id)!, read,
          observedAt: () => observation, previous: candidates.get(id) });
        gaps.push(...result.gaps.map(detail => ({ code: "FEC_FACT_NOT_REFRESHED", detail })));
        if (result.candidate) { candidates.set(id, result.candidate); successful++; }
      } catch (error) {
        if (!isSourceAcquisitionFailure(error)) throw error;
        gaps.push({ code: "FEC_CANDIDATE_RETAINED", detail: `${id}: acquisition failed; prior filing dates and facts retained.` });
      }
    }
  }));
  // A source failure is isolated above. A store or program failure stays an
  // operational error after every admitted worker has actually settled.
  const operationalFailure = workers.find(result => result.status === "rejected");
  if (operationalFailure?.status === "rejected") throw operationalFailure.reason;
} finally { domain.dispose(); }
const completedAt = new Date().toISOString();
if (!successful) {
  const failed = await recordRegisteredSourceAcquisitionFailure({ store, contractId: "fec-funding",
    failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "No candidate totals were successfully acquired; previous data retained."), attemptedAt: completedAt });
  await writeRoutineReceiptLine(failed.line); process.exitCode = 2;
} else {
  const originalRetrievedAt = sourceReceipts.map(row => row.retrievedAt).sort()[0];
  const sourceCheck = sourceReceipts.map(row => row.check).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))[0];
  const rows: FundingCandidate[] = [...candidates.values()];
  const snapshot: FundingSnapshot = { formatVersion: 1, fetchedAt: originalRetrievedAt, cycle, candidates: rows, absences: [],
    secondHop: [...secondHop.values()], refreshAttempts: attempts,
    matchReport: { rosterMatched: [...targets.values()].filter(row => row.route === "roster").length,
      rosterTotal: roster?.payload.roster.officeholders.length ?? 0,
      ballotMatched: [...targets.values()].filter(row => row.route === "ballot").length,
      ballotTotal: [...targets.values()].filter(row => row.route === "ballot").length } };
  const candidate = fecFundingCandidate({ snapshot, rawBodies: [], rawHashes, finalUrl, retrievedAt: originalRetrievedAt, sourceCheck, excludedFacts: gaps });
  const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", candidate, completedAt);
  printSourceRunnerReceipt("fec-funding", candidate, outcome);
  if (!outcome.promoted) process.exitCode = 2;
}
