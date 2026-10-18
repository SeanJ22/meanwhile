import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { failedAcquisitionCandidate, sha256 } from "../lib/civic-data/candidate-builders.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { processRegisteredFanOutCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { isSourceAcquisitionFailure, sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { evidenceFromFailureCode } from "../lib/doors/shut.ts";
import { campaignSourceResponse } from "../lib/funding/state-acquisition.ts";
import { publishCampaignFinanceResource } from "../lib/funding/state-publication.ts";
import { recordCampaignFinanceDoor } from "../lib/funding/state-source-doors.ts";
import { campaignFinanceResources } from "../lib/funding/state-resource-index.ts";
import { CAMPAIGN_FINANCE_PARSER, campaignFinanceSource, campaignFinanceSourceId, campaignFinanceNativeScope } from "../lib/funding/state-sources.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { assignment } from "./cli-args.mts";

const state = assignment(process.argv, "state");
if (!state || !process.argv.includes("--promote")) throw new Error("One registered state and --promote are required.");
const source = campaignFinanceSource(state), sourceId = campaignFinanceSourceId(state);
try {
  installNeonRequestDeadline();
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore(), facts = readerFactDb();
  const vault = new DurableEvidenceStore(join(process.cwd(), "data", "control-plane", "vault"));
  const url = controlPlaneUrlFromEnv();
  const repos = url ? await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true }) : null;
  const directory = join(tmpdir(), "meanwhile-campaign-finance", sha256(process.cwd()));
  const runId = randomUUID();
  let outcome: PromotionOutcome | null = null, failure: { url: string; detail: string; code: string } | null = null;
  try {
    if (!source.resources.length) {
      const response = await campaignSourceResponse(source.accessEvidenceUrl, {}, { signal: new AbortController().signal });
      await response.body?.cancel();
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `The official source answered; its ${source.accessType.toLowerCase()} publication has no verified native field map yet.`);
    }
    for await (const resource of campaignFinanceResources(state, { vault, signal: new AbortController().signal, onFailure: async (resource, route, error) => {
      const detail = sanitizedErrorDiagnostic(error), code = isSourceAcquisitionFailure(error) ? error.code : "PUBLISHER_DOCUMENT_INVALID";
      failure = { url: route, detail, code };
      if (repos) await recordCampaignFinanceDoor({ doors: repos.doors, state, resource: `${resource}:${sha256(route).slice(0, 16)}`, url: route,
        at: new Date().toISOString(), evidence: evidenceFromFailureCode(code), reason: detail });
      console.error(`CAMPAIGN_FINANCE_INDEX_FAILURE=${JSON.stringify({ state, resource, route, code, detail })}`);
    } })) {
    const route = resource.url, id = resource.id;
    try {
      const result = await publishCampaignFinanceResource(state, resource, { store, facts, vault, directory, runId, signal: new AbortController().signal });
      outcome = result.outcome;
      if (repos) await recordCampaignFinanceDoor({ doors: repos.doors, state, resource: id, url: route, at: new Date().toISOString(), evidence: { kind: "GOOD", rows: result.records }, reason: null });
      console.log(`CAMPAIGN_FINANCE_RESOURCE=${JSON.stringify({ state, resource: id, records: result.records, joined: result.records - result.unjoined, unjoined: result.unjoined, versionId: outcome.promoted?.versionId })}`);
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error), code = isSourceAcquisitionFailure(error) ? error.code : "PUBLISHER_DOCUMENT_INVALID";
      failure = { url: route, detail, code };
      if (repos) await recordCampaignFinanceDoor({ doors: repos.doors, state, resource: id, url: route, at: new Date().toISOString(), evidence: evidenceFromFailureCode(code), reason: detail });
      console.error(`CAMPAIGN_FINANCE_RESOURCE_FAILURE=${JSON.stringify({ state, resource: id, code, detail })}`);
    }
    }
  } catch (error) {
    const detail = sanitizedErrorDiagnostic(error), code = isSourceAcquisitionFailure(error) ? error.code : "PUBLISHER_DOCUMENT_INVALID";
    failure = { url: source.accessEvidenceUrl, detail, code };
    if (repos) await recordCampaignFinanceDoor({ doors: repos.doors, state, resource: "discovery", url: source.accessEvidenceUrl, at: new Date().toISOString(), evidence: evidenceFromFailureCode(code), reason: detail });
  }
  if (failure) {
    const at = new Date().toISOString();
    const candidate = failedAcquisitionCandidate({ sourceId, recordClass: "CAMPAIGN_FINANCE", scope: campaignFinanceNativeScope(state), requestedUrl: failure.url,
      parserVersion: CAMPAIGN_FINANCE_PARSER, attemptedAt: at, failureDetail: failure.detail });
    outcome = await processRegisteredFanOutCandidate(store, sourceId, candidate, at);
    process.exitCode = 2;
  }
  if (!outcome) throw new Error("The state's campaign-finance pass produced no durable outcome.");
  printSourceRunnerReceipt(sourceId, outcome.candidate.candidate, outcome);
} catch (error) {
  console.error(`CAMPAIGN_FINANCE_FAILURE=${sourceId}: ${sanitizedErrorDiagnostic(error)}`);
  process.exitCode = 2;
}
