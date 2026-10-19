import { temporaryPath } from "../civic-data/temporary-path.ts";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizedHash, sha256 } from "../civic-data/candidate-builders.ts";
import { processRegisteredFanOutCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { sourceProjectionEvidence, type RoutineCandidate, type SourceCheckEvidence } from "../civic-data/types.ts";
import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import { acquireCampaignFinanceResource } from "./state-acquisition.ts";
import { fileCampaignMoneyFacts, readCampaignPredecessors } from "./state-facts.ts";
import { campaignFinancePublicationIssue, type CampaignFinancePublication } from "./state-sources.ts";
import { CAMPAIGN_FINANCE_PARSER, campaignFinanceSourceId, type CampaignFinanceResource } from "./state-sources.ts";

type AcquisitionOptions = Parameters<typeof acquireCampaignFinanceResource>[2];
interface Options extends AcquisitionOptions {
  readonly store: RoutineDataStore;
  readonly facts: FactDb & { readonly query: Query };
  readonly onPublished?: (value: { readonly state: string; readonly records: number; readonly unjoined: number }) => void;
}
interface Checkpoint { readonly publicationId: string; readonly checkedAt: string; readonly records: number; readonly unjoined: number }

function candidate(projection: CampaignFinancePublication, scope: string, check: SourceCheckEvidence, observedAt: string, at: string): RoutineCandidate {
  const sourceId = campaignFinanceSourceId(projection.state), issue = campaignFinancePublicationIssue(projection, projection.state), hash = normalizedHash(projection);
  return {
    id: `cv-${sha256(`${sourceId}:${scope}:${hash}:${at}`).slice(0, 32)}`, sourceId, recordClass: "CAMPAIGN_FINANCE", scope,
    sourceProjectionEvidence: sourceProjectionEvidence(sourceId, "CAMPAIGN_FINANCE", scope),
    retrieval: { succeeded: true, requestedUrl: check.requestedUrl, finalUrl: check.finalUrl, httpStatus: 200, retrievedAt: observedAt, rawHash: check.rawHash, sourceCheck: check },
    normalization: { succeeded: issue === null, parserVersion: CAMPAIGN_FINANCE_PARSER, schemaVersion: CAMPAIGN_FINANCE_PARSER,
      normalizedHash: hash, normalizedPayloadHash: hash, inputRecords: projection.records.length, outputRecords: projection.records.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: projection.records.map(row => ({ subjectId: row.id, jurisdiction: `US-${projection.state}`, identifiers: { source_record_id: row.id }, matchBasis: "EXACT_SCOPED_ID", ambiguous: false })),
    temporal: { version: at, expectedVersion: at, sourceThrough: observedAt, staleAtRetrieval: false },
    semantics: { factKind: "Official source-native campaign filings", violations: issue ? [issue] : [] },
    horizon: { kind: "OPEN_FACT_SET", query: check.requestedUrl, returnedRecords: projection.records.length, declaredTotal: null, paginationComplete: true, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "State and place campaign money and Ask", passed: issue === null, detail: "Native fields retain the original vaulted source and exact state; unmatched rows remain held." }],
    normalizedPayload: projection, readModel: projection,
  };
}

export async function publishCampaignFinanceResource(state: string, resource: CampaignFinanceResource, options: Options): Promise<{ readonly records: number; readonly unjoined: number; readonly outcome: PromotionOutcome }> {
  const sourceId = campaignFinanceSourceId(state), scope = `${sourceId}:resource:${sha256(resource.id)}`;
  const cursor = `campaign-finance:${state}:${resource.id}`;
  const saved = await readPassCursor(options.facts.query, cursor), prior = saved ? JSON.parse(saved) as Checkpoint : null;
  const publicationId = randomUUID();
  let records = 0, unjoined = 0, outcome: PromotionOutcome | null = null;
  let check: SourceCheckEvidence | null = null, observedAt: string | null = null;
  await mkdir(temporaryPath(options.directory), { recursive: true });
  const temporary = await mkdtemp(temporaryPath(join(options.directory, "campaign-identities-")));
  const occurrences: { database: DatabaseSync | null } = { database: null };
  let occurrence: ReturnType<DatabaseSync["prepare"]> | null = null;
  const recordId = (id: string) => {
    if (!occurrences.database) {
      occurrences.database = new DatabaseSync(join(temporary, "occurrences.db"));
      // These counters are disposable; source bytes and accepted facts are durable.
      occurrences.database.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-1024; PRAGMA mmap_size=0; CREATE TABLE occurrence (id TEXT PRIMARY KEY,n INTEGER NOT NULL)");
      occurrence = occurrences.database.prepare("INSERT INTO occurrence VALUES (?,0) ON CONFLICT(id) DO UPDATE SET n=n+1 RETURNING n");
    }
    return `${id}:${String(occurrence!.get(id)!.n).padStart(12, "0")}`;
  };
  try {
    for await (const page of acquireCampaignFinanceResource(state, resource, { ...options, publicationId, ...(prior && resource.identity.length && resource.identityScope !== "PUBLICATION" ? { acceptedPublicationId: prior.publicationId } : {}) })) {
      check = page.sourceCheck; observedAt = page.observedAt;
      if (!page.records.length) continue;
      let rows = page.records.map(row => row.nativeId === null || row.nativeIdScope === "PUBLICATION"
        ? { ...row, id: recordId(row.id) } : row);
      const previous = await readCampaignPredecessors(options.facts.query, state, rows.map(row => row.id));
      rows = rows.map(row => {
        const old = previous.get(row.id);
        return old ? { ...row, amounts: [...row.amounts, ...old.amounts.filter(amount => row.unavailableAmounts.includes(amount.label))
          .map(amount => ({ ...amount, provenance: amount.provenance ?? old.provenance }))] } : row;
      });
      const at = (options.now ?? (() => new Date().toISOString()))();
      const projection: CampaignFinancePublication = { kind: "campaign-finance-source-rows", state, resource: resource.id, records: rows };
      outcome = await processRegisteredFanOutCandidate(options.store, sourceId, candidate(projection, `${scope}:batch:${sha256(rows.map(row => row.id).sort().join("\n"))}`, check, observedAt, at), at);
      if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? "Campaign source batch was not accepted.");
      const filed = await fileCampaignMoneyFacts(options.facts, state, rows, at);
      const unmatched = rows.filter(row => row.unjoinedReason !== null).length;
      records += rows.length; unjoined += unmatched;
      if (filed.written) options.onPublished?.({ state, records: filed.written, unjoined: unmatched });
    }
    if (!check || !observedAt) throw new Error("The campaign source returned no check.");
    const at = (options.now ?? (() => new Date().toISOString()))();
    const projection: CampaignFinancePublication = { kind: "campaign-finance-source-check", state, resource: resource.id,
      records: [{ id: resource.id, state, checkedAt: observedAt, rawHash: check.rawHash, loaded: records || prior?.records || 0, unjoined: records ? unjoined : prior?.unjoined || 0 }] };
    outcome = await processRegisteredFanOutCandidate(options.store, sourceId, candidate(projection, scope, check, observedAt, at), at);
    if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? "Campaign source check was not accepted.");
    await writePassCursor(options.facts.query, cursor, JSON.stringify({ publicationId, checkedAt: check.checkedAt,
      records: records || prior?.records || 0, unjoined: records ? unjoined : prior?.unjoined || 0 } satisfies Checkpoint));
    return { records, unjoined, outcome };
  } finally { occurrences.database?.close(); await rm(temporaryPath(temporary), { recursive: true, force: true }); }
}
