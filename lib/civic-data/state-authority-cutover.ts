import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { requireBallotState, parseStateBallotContractId, stateBallotContractId, stateBallotScope, type StateBallotFamily } from "../ballot/state-scopes.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { assertWriteAllowed } from "../db/write-guard.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { candidateChangeSet, canonicalCivicDataJson, civicRecordsFor, rowKeyedCivicRecordsFor, ROW_KEYED_CIVIC_CHANGE_CONTRACT } from "./changes.ts";
import { CIVIC_DATA_PROMOTION_OPERATION } from "./production-write.ts";
import { assertRegisteredRuntimeContract, runtimeAuthorityEnvelope } from "./runtime-authority.ts";
import { trustedLkgCandidateEnvelopeSha256, trustedLkgValidatorIds, trustedLkgCandidateId } from "./trusted-lkg-import.ts";
import type { RoutineCandidate, RoutineRecordClass, ValidationReceipt } from "./types.ts";

type Query = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
type Options = { readonly query?: Query };
type PartitionRef = { readonly family: StateBallotFamily; readonly recordClass: RoutineRecordClass; readonly scope: string; readonly versionId: string };
type Source = { readonly originId: string; readonly originScope: string; readonly promotedAt: string; readonly candidate: RoutineCandidate; readonly receipt: ValidationReceipt; readonly payload: unknown; readonly normalizedMetadata: Record<string, unknown> };
const classes: Record<StateBallotFamily, RoutineRecordClass> = {
  "ballot-contests": "BALLOT_CANDIDACY", "candidate-profiles": "CANDIDATE_PROFILE", "candidate-corpus": "CANDIDATE_PUBLICATION",
  "voting-sites": "VOTING_SITE", "candidate-campaign-sites-derived": "CURATED_READER_RECORD",
};

function partitionQuery(family: StateBallotFamily, state: string, options: Options): Query {
  if (options.query && process.env.WTP_DB_ROLE === "local") return options.query;
  const authority = runtimeAuthorityEnvelope(process.env), contract = parseStateBallotContractId(authority?.contract ?? "");
  if (!contract || contract.state !== state || contract.family !== family && contract.family !== "ballot-contests" && !(contract.family === "candidate-campaign-sites-derived" && ["candidate-profiles", "candidate-corpus"].includes(family))) {
    throw new Error(`STATE_AUTHORITY_PARTITION_REFUSED:${family}:${state}`);
  }
  assertRegisteredRuntimeContract(stateBallotContractId(contract.family, state), authority?.capability === "ROUTINE_CONTRACT" ? "routine" : "manual");
  assertWriteAllowed(CIVIC_DATA_PROMOTION_OPERATION);
  if (options.query) return options.query;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("STATE_AUTHORITY_DATABASE_UNCONFIGURED");
  installDatabaseTransferCounter();
  const sql = neon(url);
  return async (text, params) => await sql.query(text, [...params]) as Record<string, unknown>[];
}

function rekey(source: Source, family: StateBallotFamily, state: string): { candidate: RoutineCandidate; receipt: ValidationReceipt } {
  const scope = stateBallotScope(family, state), prior = { ...source.candidate, readModel: source.payload,
    normalizedPayload: family === "voting-sites" ? { ...source.normalizedMetadata, projection: source.payload }
      : family === "candidate-campaign-sites-derived" ? { ...source.normalizedMetadata, readModel: source.payload } : source.payload };
  let candidate: RoutineCandidate = { ...prior, scope, sourceProjectionEvidence: { ...prior.sourceProjectionEvidence, scope } };
  if (family === "candidate-campaign-sites-derived") candidate = { ...candidate,
    retrieval: { ...candidate.retrieval, requestedUrl: `derived:${candidate.sourceId}:${scope}` },
    temporal: { ...candidate.temporal, version: scope, expectedVersion: scope } };
  if (family === "ballot-contests") {
    const receipt = candidate.retrieval.manualSourceReceipt;
    if (!receipt?.sources.length) throw new Error("STATE_AUTHORITY_BALLOT_SOURCES_MISSING");
    const sources = [...receipt.sources].sort((a, b) => `${a.finalUrl}\n${a.rawHash}`.localeCompare(`${b.finalUrl}\n${b.rawHash}`));
    const rawHash = createHash("sha256").update(sources.map(s =>
      `${s.requestedUrl}\n${s.finalUrl}\n${s.httpStatus}\n${s.rawHash}\n${s.reviewOutcome ?? "SUPPORTED"}\n${s.failureDetail ?? ""}${s.extractedMembers?.length ? `\n${canonicalCivicDataJson(s.extractedMembers)}` : ""}`,
    ).join("\n")).digest("hex");
    const first = receipt.sources[0];
    candidate = { ...candidate, retrieval: { ...candidate.retrieval, rawHash,
      requestedUrl: first.requestedUrl, finalUrl: first.finalUrl, httpStatus: first.httpStatus } };
  }
  const civicRecords = candidate.bootstrapImport ? rowKeyedCivicRecordsFor(candidate.recordClass, candidate.readModel) : civicRecordsFor(candidate.recordClass, candidate.readModel);
  const count = civicRecords.length, dropped = candidate.excludedFacts?.length ?? 0;
  const normalizedHash = canonicalCivicDataHash(candidate.readModel);
  candidate = { ...candidate, civicRecords, normalization: { ...candidate.normalization, inputRecords: count + dropped, outputRecords: count, droppedRecords: dropped,
    normalizedHash, normalizedPayloadHash: candidate.normalizedPayload === candidate.readModel ? normalizedHash : canonicalCivicDataHash(candidate.normalizedPayload) },
  horizon: { ...candidate.horizon, returnedRecords: count } };
  candidate = { ...candidate, changeSet: candidateChangeSet(candidate, null, candidate.bootstrapImport ? ROW_KEYED_CIVIC_CHANGE_CONTRACT : undefined) };
  if (candidate.bootstrapImport) {
    candidate = { ...candidate, bootstrapImport: { ...candidate.bootstrapImport, scope,
      readModelSha256: candidate.normalization.normalizedHash!, normalizedPayloadSha256: candidate.normalization.normalizedPayloadHash! } };
    candidate = { ...candidate, bootstrapImport: { ...candidate.bootstrapImport!, validatorIds: trustedLkgValidatorIds(candidate), candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(candidate) } };
    candidate = { ...candidate, id: trustedLkgCandidateId(candidate.bootstrapImport!) };
  } else candidate = { ...candidate, id: `cv-${canonicalCivicDataHash({ operation: "state-authority-partition", originId: source.originId, scope, payloadHash: candidate.normalization.normalizedHash }).slice(0, 32)}` };
  const receipt: ValidationReceipt = { ...source.receipt, candidateId: candidate.id, scope, excludedFacts: candidate.excludedFacts ?? [],
    checks: source.receipt.checks.map(check => ({ ...check,
      ...(check.check === "SCHEMA_PARSE_VALIDITY" ? { detail: `${count} preserved state records; ${dropped} explicitly held facts.` }
        : check.check === "IDENTITY_JURISDICTION_VALIDITY" ? { detail: `${candidate.identities.length} exact state identity bindings preserved.` } : {}),
    })) };
  return { candidate, receipt };
}

function stateReferences(value: { candidate: RoutineCandidate; receipt: ValidationReceipt }, source: Source): unknown {
  const paths = new WeakMap<object, readonly string[]>();
  const targets = new Set(value.candidate.civicRecords?.flatMap(member => member.record && typeof member.record === "object" ? [member.record] : []));
  const path: string[] = ["payload"];
  const index = (child: unknown) => {
    if (!child || typeof child !== "object") return;
    if (targets.has(child)) paths.set(child, [...path]);
    for (const [key, nested] of Object.entries(child)) { path.push(key); index(nested); path.pop(); }
  };
  index(source.payload);
  for (const key of ["candidate", "receipt", "normalizedMetadata"] as const) {
    for (const [field, child] of Object.entries(source[key])) if (child && typeof child === "object") paths.set(child, [key, field]);
  }
  if (source.payload && typeof source.payload === "object") paths.set(source.payload, ["payload"]);
  const encode = (child: unknown): unknown => {
    if (!child || typeof child !== "object") return child;
    const path = paths.get(child);
    if (path) return { $stateAuthorityFrom: path };
    if (Array.isArray(child)) return child.map(encode);
    return Object.fromEntries(Object.entries(child).map(([key, nested]) => [key, encode(nested)]));
  };
  return encode(value);
}

export async function partitionHeldStateAuthority(family: StateBallotFamily, stateInput: string, options: Options = {}): Promise<PartitionRef | null> {
  const state = requireBallotState(stateInput), scope = stateBallotScope(family, state), recordClass = classes[family];
  const query = partitionQuery(family, state, options);
  const current = await query("SELECT current_version_id FROM civic_data_promotions WHERE record_class=$1 AND scope=$2", [recordClass, scope]);
  if (current.length) return { family, recordClass, scope, versionId: String(current[0].current_version_id) };
  const rows = await query("SELECT civic_authority_state_source($1,$2) AS source", [family, state]);
  const source = rows[0]?.source as Source | null;
  if (!source) return null;
  const { candidate, receipt } = rekey(source, family, state);
  const written = await query("SELECT civic_authority_partition_publish($1,$2,$3,$4::jsonb) AS version_id",
    [family, state, source.originId, JSON.stringify(stateReferences({ candidate, receipt }, source))]);
  return { family, recordClass, scope, versionId: String(written[0].version_id) };
}

export async function partitionHeldStateAuthorities(state: string, options: Options = {}): Promise<readonly PartitionRef[]> {
  const refs: PartitionRef[] = [];
  for (const family of ["candidate-profiles", "candidate-corpus", "voting-sites", "candidate-campaign-sites-derived", "ballot-contests"] as const) {
    const ref = await partitionHeldStateAuthority(family, state, options);
    if (ref) refs.push(ref);
  }
  return refs;
}

export async function retireRepartitionedAuthorities(stateInput: string, options: Options = {}): Promise<number> {
  const state = requireBallotState(stateInput), query = partitionQuery("ballot-contests", state, options);
  const rows = await query("SELECT civic_authority_retire($1) AS retired", [state]);
  return Number(rows[0].retired);
}

export async function pendingStateAuthorityRetirements(options: Options = {}): Promise<readonly { readonly recordClass: string; readonly scope: string; readonly versionId: string; readonly states: readonly string[] }[]> {
  const url = process.env.DATABASE_URL;
  if (!options.query && !url) throw new Error("STATE_AUTHORITY_DATABASE_UNCONFIGURED");
  if (!options.query) installDatabaseTransferCounter();
  const query = options.query ?? (async (text: string, params: readonly unknown[]) => await neon(url!).query(text, [...params]) as Record<string, unknown>[]);
  const rows = await query(`SELECT p.record_class,p.scope,p.current_version_id,civic_authority_required_states(p.record_class,p.scope,p.current_version_id) states FROM civic_data_promotions p JOIN (
    SELECT o.record_class,o.scope FROM unnest(ARRAY['ballot-contests','candidate-profiles','candidate-corpus','voting-sites','candidate-campaign-sites-derived']) f(family),LATERAL civic_authority_origin(f.family) o
    UNION ALL SELECT * FROM (VALUES ('BALLOT_CANDIDACY','US-AZ:2026-general:supported-ballot'),('BALLOT_CANDIDACY','US-NH:merrimack:2026-general'),('BALLOT_FILING','US-NJ:county:morris:2026-general')) v(record_class,scope)
  ) old ON old.record_class=p.record_class AND old.scope=p.scope ORDER BY p.key LIMIT 8`, []);
  return rows.map(row => ({ recordClass: String(row.record_class), scope: String(row.scope), versionId: String(row.current_version_id), states: row.states as string[] }));
}
