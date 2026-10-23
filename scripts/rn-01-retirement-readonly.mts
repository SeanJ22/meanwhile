import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Client, neonConfig } from "@neondatabase/serverless";
import { RETIRED_STATE_POINTERS } from "../lib/civic-data/state-pointer-retirement.ts";
import { prepareRetirementStateInputs, withRetirementSourceCursor } from "../lib/civic-data/state-retirement-inputs.ts";
import { previewRetirementStateInput } from "../lib/civic-data/state-retirement-merge.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { civicRecordsFor, candidateChangeSet } from "../lib/civic-data/changes.ts";
import { verifySourceScopedCandidateProjection } from "../lib/civic-data/candidate-integrity.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { requiredManualProductionContract, type ManualProductionContractId } from "../lib/civic-data/manual-contracts.ts";
import { statePublicationPriorOf, withStateRecordHashes } from "../lib/civic-data/state-publication.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";

// The production readonly role is mandatory. The normal prepare and merge run, but the publisher is never called.
const [connectionFile, indexText, output] = process.argv.slice(2);
const index = Number(indexText);
assert.ok(connectionFile && output && Number.isInteger(index) && RETIRED_STATE_POINTERS[index], "usage: readonly-url-file pointer-index output-json");
process.env.DATABASE_URL = readFileSync(connectionFile, "utf8").trim();
process.env.WTP_STATE_RETIREMENT_KEY = randomBytes(32).toString("hex");
if (process.env.HTTPS_PROXY) {
  const require = createRequire(import.meta.url);
  const WebSocket = require("next/dist/compiled/ws");
  const { HttpsProxyAgent } = require("next/dist/compiled/https-proxy-agent");
  const agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
  neonConfig.webSocketConstructor = class extends WebSocket {
    constructor(address: string, protocols: string[]) { super(address, protocols, { agent }); }
  } as unknown as typeof neonConfig.webSocketConstructor;
}
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
const directory = await mkdtemp("/tmp/rn01-retirement-readonly-");
const [family, recordClass, scope] = RETIRED_STATE_POINTERS[index];
const rows: { state: string; records?: number; selections?: number; elapsedMs: number; status: string; decision?: string; verifier?: string; error?: string }[] = [];
const started = performance.now();
let prepareMs = 0;
try {
  await client.connect();
  await client.query("SET default_transaction_read_only=on");
  await client.query("SET statement_timeout='5s'");
  const identity = await client.query("SELECT current_user AS role,current_setting('default_transaction_read_only') AS readonly");
  assert.match(identity.rows[0].role, /readonly/);
  assert.equal(identity.rows[0].readonly, "on");
  const original = await client.query(`SELECT p.current_version_id,p.promoted_at,c.normalized_hash
    FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1`, [`${recordClass}:${scope}`]);
  assert.equal(original.rows.length, 1);
  const row = original.rows[0];
  const origin = { family, recordClass, scope, versionId: row.current_version_id as string,
    promotedAt: new Date(row.promoted_at).toISOString(), hash: row.normalized_hash as string };
  const prepareStart = performance.now();
  const plan = await withRetirementSourceCursor(client, source => prepareRetirementStateInputs({ ...source, directory, origins: [origin] }));
  prepareMs = performance.now() - prepareStart;
  assert.equal(plan.unassigned.length, 0, JSON.stringify(plan.unassigned));
  console.log(JSON.stringify({ index, family, scope, prepareMs, units: plan.units.length }));
  for (const unit of plan.units) {
    const unitStart = performance.now();
    try {
      const store = new PostgresRoutineDataStore(), now = new Date().toISOString();
      const result = await previewRetirementStateInput({ file: unit.inputFile, sha256: unit.fileSha256, seal: unit.seal,
        contractId: unit.contractId, store, now });
      let decision: string | undefined, verifier: string | undefined;
      if (result.candidate) {
        const immutable = withStateRecordHashes(result.candidate);
        const base = await store.readStatePublicationBase(immutable.recordClass, immutable.scope);
        assert.equal(base.current?.versionId ?? null, result.baseVersion, "pinned state moved during replay");
        const previous = immutable.recordClass === "CURATED_READER_RECORD" && immutable.retrieval.manualSourceReceipt && !base.lkg?.candidate.retrieval.manualSourceReceipt
          ? null : base.current?.payload ?? null;
        const candidate = { ...immutable, changeSet: candidateChangeSet(immutable, previous, undefined, base.lkg ? statePublicationPriorOf(base.lkg.candidate) : undefined) };
        const contract = unit.family === "candidate-campaign-sites-derived" ? requiredRoutineContract(unit.contractId)
          : requiredManualProductionContract(unit.contractId as ManualProductionContractId);
        const verified = await verifySourceScopedCandidateProjection(contract, candidate, now, null);
        assert.equal(verified.status, "PASS", verified.detail);
        const validation = validateRoutineCandidate(candidate, base.lkg, now, [{ consumer: `${verified.verifierId} (source-scoped pre-promotion)`,
          passed: verified.status === "PASS", detail: verified.detail }], candidate.stateRetirement);
        assert.equal(validation.receipt.decision, "GOOD", JSON.stringify(validation.receipt.checks.filter(check => check.verdict !== "PASS")));
        decision = validation.receipt.decision; verifier = verified.verifierId;
      }
      rows.push({ state: unit.state, records: civicRecordsFor(result.candidate?.recordClass ?? (recordClass === "BALLOT_FILING" ? "BALLOT_CANDIDACY" : recordClass), result.payload).length,
        selections: result.currentSelections.length, elapsedMs: performance.now() - unitStart, status: result.status, decision, verifier });
    } catch (error) {
      rows.push({ state: unit.state, elapsedMs: performance.now() - unitStart, status: "FAILED", error: sanitizedErrorDiagnostic(error) });
      process.exitCode = 1;
    }
    console.log(JSON.stringify(rows.at(-1)));
    global.gc?.();
  }
} finally {
  await writeFile(output, JSON.stringify({ index, family, recordClass, scope, prepareMs, elapsedMs: performance.now() - started,
    peakRssBytes: process.resourceUsage().maxRSS * 1024, rows }, null, 2));
  await client.end().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
