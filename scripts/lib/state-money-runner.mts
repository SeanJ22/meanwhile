/** @freshness-reads-here — observations are returned by the shared source vault. */
import { createHash } from "node:crypto";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownRelease } from "../../lib/sources/known-release.ts";
import { openSourceAcquisitionDomain, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, sourceAcquisitionSleep } from "../../lib/sources/acquisition-deadline.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, stateCampaignFinanceCandidate, type StateCampaignFinanceJurisdiction } from "../../lib/funding/data-plane.ts";
import { financeYear, upsertStateMoney } from "../../lib/funding/state-native.ts";
import type { StateMoneyRecord, StateMoneySnapshot } from "../../lib/funding/state-money.ts";
import type { RoutineDataStore } from "../../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../../lib/civic-data/promotion.ts";
import { failedAcquisitionCandidate } from "../../lib/civic-data/candidate-builders.ts";
import { printSourceRunnerReceipt } from "../../lib/civic-data/runner-receipt.ts";

export interface FinanceRead { readonly text: string; readonly receipt: Omit<KnownRelease, "bytes"> }
export interface StateFinanceIO {
  readonly year: number; readonly signal: AbortSignal; readonly prior: StateMoneySnapshot | null;
  readonly attempts: Record<string, string>; readonly gaps: { code: string; detail: string }[];
  readonly cursors: Record<string, number>;
  read(url: string, options?: { body?: string; headers?: HeadersInit; validate?: (text: string) => void }): Promise<FinanceRead>;
}
export interface StateFinanceCollected { records: StateMoneyRecord[]; complete: boolean; query: string; period?: number }

/** Existing manual contracts are also invoked by standing source tasks. */
export async function runStateFinance(state: StateCampaignFinanceJurisdiction, sourceUrl: string,
  collect: (io: StateFinanceIO) => Promise<StateFinanceCollected>, store: RoutineDataStore): Promise<void> {
  const yearArg = process.argv.find(arg => arg.startsWith("--year="))?.slice(7) ??
    (process.argv.includes("--year") ? process.argv[process.argv.indexOf("--year") + 1] : undefined);
  const year = financeYear(yearArg), contract = STATE_CAMPAIGN_FINANCE_SOURCES[state];
  const held = await store.readPromotion<StateMoneySnapshot>("STATE_CAMPAIGN_FINANCE", contract.scope);
  const domain = openSourceAcquisitionDomain({ sourceLabel: `${state} campaign finance`, timeoutMs: ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS });
  const receipts: Omit<KnownRelease, "bytes">[] = [], gaps: StateFinanceIO["gaps"] = [];
  const attempts = { ...held?.payload.refreshAttempts };
  const cursors = { ...held?.payload.acquisitionCursors };
  const spacingMs = { AZ: 250, NH: 1100, NJ: 900 }[state];
  let submitted = false;
  try {
    const result = await collect({ year, signal: domain.signal, prior: held?.payload ?? null, attempts, cursors, gaps,
      read: async (url, options = {}) => {
        const bodyIdentity = createHash("sha256").update(options.body ?? "").digest("hex");
        const result = await acquireKnownRelease({ sourceId: contract.sourceId, releaseId: `${url}:${bodyIdentity}`,
          url, parserVersion: contract.parserVersion, signal: domain.signal, maxBytes: 16 * 1024 * 1024,
          checkAfterMs: 24 * 60 * 60_000, headers: options.headers,
          validate: bytes => options.validate?.(Buffer.from(bytes).toString("utf8")),
          fetchImpl: async (resource, init) => {
            for (let attempt = 0; ; attempt++) {
              // Preserve each existing adapter's provider spacing. Vault reuse
              // never reaches this transport and requires no pacing delay.
              await sourceAcquisitionSleep(spacingMs, domain.signal);
              const response = await fetch(resource, { ...init, method: options.body === undefined ? "GET" : "POST", body: options.body,
                signal: AbortSignal.any([domain.signal, AbortSignal.timeout(60_000)]) });
              if ((response.status === 429 || response.status >= 500) && attempt < 3) {
                const retry = response.headers.get("retry-after"), seconds = Number(retry);
                const delay = retry ? Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now() : 2000 * (attempt + 1);
                await response.body?.cancel(); await sourceAcquisitionSleep(Math.max(0, Number.isFinite(delay) ? delay : 30_000), domain.signal); continue;
              }
              return response;
            }
          },
        });
        const { bytes, ...receipt } = result; receipts.push(receipt);
        return { text: Buffer.from(bytes).toString("utf8"), receipt };
      },
    });
    if (!receipts.length || !result.records.some(record => record.filingState !== "ROUTE_UNREAD") && !(result.complete && held?.payload.records.length)) throw new Error("No independent official finance facts acquired");
    const observedAt = receipts.map(row => row.sourceObservedAt).sort()[0];
    const sourceCheck = knownReleaseSourceCheck(receipts.toSorted((a, b) => a.checkedAt.localeCompare(b.checkedAt))[0]);
    const snapshot = upsertStateMoney(held?.payload ?? null, result.records, { state, year: result.period ?? year, observedAt, refreshAttempts: attempts, acquisitionCursors: cursors });
    const candidate = stateCampaignFinanceCandidate({ jurisdiction: state, snapshot, rawBodies: [], rawHashes: receipts.map(row => row.sha256),
      requestedUrl: sourceUrl, finalUrl: sourceUrl, retrievedAt: receipts.map(row => row.retrievedAt).sort()[0], sourceCheck,
      query: result.query, paginationComplete: result.complete, excludedFacts: gaps,
      observedAbsences: result.records.filter(row => row.filingState === "NO_REPORTS_ON_FILE" && row.committeeId)
        .map(row => ({ committeeId: row.committeeId!, electionYear: row.electionYear, sourceUrl: row.provenance.sourceUrl! })) });
    submitted = true;
    const outcome = await processRegisteredManualCandidate(store, contract.contractId, candidate, new Date().toISOString());
    printSourceRunnerReceipt(contract.contractId, candidate, outcome);
    if (!outcome.promoted) process.exitCode = 2;
  } catch (error) {
    if (!submitted) {
      const attemptedAt = new Date().toISOString();
      const failed = failedAcquisitionCandidate({ sourceId: contract.sourceId, recordClass: "STATE_CAMPAIGN_FINANCE", scope: contract.scope,
        requestedUrl: sourceUrl, attemptedAt, failureDetail: error instanceof Error ? error.message : "State finance acquisition failed", parserVersion: contract.parserVersion });
      const outcome = await processRegisteredManualCandidate(store, contract.contractId, failed, attemptedAt);
      printSourceRunnerReceipt(contract.contractId, failed, outcome);
    }
    process.exitCode = 2;
  } finally { domain.dispose(); }
}
