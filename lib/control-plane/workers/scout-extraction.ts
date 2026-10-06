import { ZERO_COST, type WorkerRef } from "../attempt.ts";
import { finishBoxFinding, takeBoxFinding, type BoxOrigin } from "../box.ts";
import { contentHash, fingerprint } from "../ids.ts";
import { SECTION3_MINIMUMS, linkingPageFrom, section3Record } from "../promotion/section3.ts";
import { beginAttemptFor, claimRouteTask } from "../repository/coordinator.ts";
import { applyWorkerCompletion, completeWorkerTask } from "../repository/worker-completion.ts";
import { canonicalJson, RepositoryLockHeld, type ControlPlaneRepositories } from "../repository/types.ts";
import type { ScoutFinding, ScoutResult } from "../scheduler/scout-result.ts";
import type { WorkItem } from "../work-item.ts";
import { captureIntact, capturesForPublication } from "../../civic-data/worker-publication-evidence.ts";
import type { WorkerPublicationCapture } from "../../civic-data/worker-roster-publication.ts";
import { inventoryRecordEvidence, recordIdentity, RecordEvidenceRefusal } from "./record-evidence.ts";
import { recordBlockAt } from "./record-block.ts";
import { normalizedParserResult } from "./parser.ts";
import { BOX_PARSER_IMPLEMENTATION, confirmQuotedRecords, quotedSourceFindings } from "./quoted-proof.ts";
import { enqueueWorkerTask, fleetGrant, FLEET_POLICY_VERSION } from "./runtime.ts";
import type { GeneralizedCivicExtractionContract, ParserResult, WorkerEvidence, WorkerResultRecord } from "./types.ts";

/** Scout and modern Detective findings use one proof, with no model or acquisition. */
export function scoutExtraction(input: {
  contract: GeneralizedCivicExtractionContract; evidence: WorkerEvidence; findings: readonly ScoutFinding[]; attemptId: string;
}): ParserResult {
  const { contract, evidence } = input;
  const groups = new Map<string, ScoutFinding[]>();
  for (const finding of input.findings) {
    if (!finding.field || finding.value === undefined || finding.value === null || !finding.exactQuote ||
        finding.sourceUrl !== evidence.canonicalUrl || !finding.artifactIds.includes(evidence.artifactId)) continue;
    const key = finding.subjectId ?? contract.subjectId;
    groups.set(key, [...groups.get(key) ?? [], finding]);
  }
  const proofContract = { ...contract, requiredFields: SECTION3_MINIMUMS[contract.recordClass] ?? contract.requiredFields };
  // A lone email can use name/office already readable in its saved row. Read
  // only the contracted source mapping; no inferred names or remote fetches.
  if (contract.extraction.format !== "UNSUPPORTED") {
    try {
      const inventory = inventoryRecordEvidence(evidence, contract.extraction);
      for (const [subjectId, findings] of groups) {
        const matches = inventory.rows.filter(row => findings.some(finding => {
          const quote = finding.exactQuote!, at = evidence.text.indexOf(quote);
          if (at < 0 || evidence.text.indexOf(quote, at + 1) >= 0) return false;
          const block = /<[a-z][^>]*>/i.test(evidence.text) ? recordBlockAt(evidence.text, at, at + quote.length) : null;
          const range = block ?? { start: at, end: at + quote.length };
          return Object.values(row).every(cell => cell.start >= range.start && cell.end <= range.end);
        }));
        if (matches.length !== 1) continue;
        const context = matches[0];
        for (const field of [...proofContract.requiredFields, ...contract.identity.keyFields].flatMap(field => field.split("|"))) {
          const cell = context[field];
          if (!cell || cell.value === null || findings.some(finding => finding.field === field)) continue;
          findings.push({ kind: "RECORD", summary: "Minimum fact from the same saved row", subjectId, field,
            value: cell.value, exactQuote: evidence.text.slice(cell.start, cell.end), sourceUrl: evidence.canonicalUrl, artifactIds: [evidence.artifactId] });
        }
      }
    } catch (error) { if (!(error instanceof RecordEvidenceRefusal)) throw error; }
  }
  const confirmed = confirmQuotedRecords({ contract: proofContract, evidence }, [...groups.values()].map(findings => ({ windowStart: 0,
    fields: [...new Map(findings.map(f => [canonicalJson([f.field, f.value, f.exactQuote]), { name: f.field!, value: String(f.value), quote: f.exactQuote! }])).values()] })));
  const identities = new Map<string, string>();
  const typedRecords = confirmed.records.map(record => {
    const fields = { ...record.fields };
    for (const [field, value] of Object.entries(fields)) {
      const span = confirmed.spans.find(span => span.recordId === record.id && span.field === field);
      const claims = [...groups.values()].flat().filter(claim => claim.field === field && String(claim.value) === String(value) && claim.exactQuote === span?.quote);
      if (claims.length && claims.every(claim => typeof claim.value === "number")) fields[field] = claims[0].value!;
      if (!contract.identity.keyFields.includes(field) && claims.length && claims.every(claim => typeof claim.value === "boolean")) fields[field] = claims[0].value!;
    }
    const id = recordIdentity(fields, contract.identity);
    identities.set(record.id, id);
    return { ...record, id, fields };
  });
  const result: ParserResult = { role: "PARSER", attemptId: input.attemptId, implementation: BOX_PARSER_IMPLEMENTATION, version: "1", schemaVersion: 2,
    recordClass: contract.recordClass, artifactId: evidence.artifactId, contentHash: evidence.contentHash,
    acquiredByAttemptId: evidence.acquiredByAttemptId, subjectId: contract.subjectId,
    contractMetadata: { jurisdiction: contract.jurisdiction, identity: contract.identity, sourceScope: contract.sourceScope, methodVersion: contract.methodVersion },
    verdict: !confirmed.records.length ? "FAILED" : confirmed.warnings.some(w => w.severity !== "INFO") ? "AMBIGUOUS" : "EXTRACTED",
    records: typedRecords, spans: confirmed.spans.map(span => ({ ...span, recordId: identities.get(span.recordId)! })),
    warnings: [...confirmed.warnings, ...confirmed.rejections.map(r => ({ code: r.code, severity: "INFO" as const, field: r.field,
      detail: `Box finding record ${r.recordIndex}: ${r.code}; the unsupported field remains owed.` }))],
    declaredRowCount: null, sourceRowCount: null, actualRowCount: confirmed.records.length };
  const failures = quotedSourceFindings(result, proofContract, evidence);
  return failures.length ? { ...result, verdict: "FAILED", warnings: [...result.warnings, ...failures] } : result;
}

/** A drop's origin re-read as the Scout finding it stands for. */
function reportedFinding(row: { readonly subjectId: string; readonly exactQuote: string | null; readonly sourceUrl: string | null }, origin: BoxOrigin): ScoutFinding | undefined {
  if (!origin.reported || !row.exactQuote || !row.sourceUrl) return undefined;
  return { kind: "RECORD", summary: `Dropped mid-walk${origin.reported.subjectHint ? ` for ${origin.reported.subjectHint}` : ""}`,
    subjectId: row.subjectId, field: origin.reported.field, value: origin.reported.value, exactQuote: row.exactQuote, sourceUrl: row.sourceUrl,
    artifactIds: origin.artifactIds, ...(origin.missionPart ? { missionPart: origin.missionPart } : {}) };
}

export interface BoxBuildReport {
  readonly built: readonly string[];
  readonly waiting: readonly { readonly findingId: string; readonly reason: string }[];
}

/** Consume at most one page per work item per pass: its normal door publishes in
 * this same pass before another page can replace the latest extraction. All
 * claims from that page travel together; a sparse finding stays owed until its
 * record's minimum facts are available. No queue or model budget is created. */
export async function buildBoxFindings(input: {
  repos: ControlPlaneRepositories; items: readonly WorkItem[]; now: () => string; leaseMs: number;
  readCapture: (id: string, records: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
}): Promise<BoxBuildReport> {
  const { repos } = input;
  const rows = (await repos.boxFindings.list()).map(row => row.value);
  const pending = rows.filter(row => row.state === "waiting" || (row.state === "taken" && row.claim && row.claim.expiresAt <= input.now()));
  if (!pending.length) return { built: [], waiting: [] };
  const scouts = new Map<string, Promise<ScoutResult | undefined>>();
  let legacy: Promise<readonly ScoutResult[]> | undefined;
  const scoutFor = (origin: BoxOrigin) => {
    if (!scouts.has(origin.resultId)) scouts.set(origin.resultId, (origin.resultKey
      ? repos.scoutResults.readWhere(origin.resultKey, ["attemptId"], origin.resultId)
      : legacy ??= repos.scoutResults.readAll()).then(rows => rows.find(result => result.attemptId === origin.resultId)));
    return scouts.get(origin.resultId)!;
  };
  const built: string[] = [], waiting: { findingId: string; reason: string }[] = [];
  const handled = new Set<string>();
  for (const item of input.items) {
    const contract = item.autonomousPlan?.contract;
    if (!item.autonomousPlan?.publication || contract?.schemaVersion !== 2) continue;
    const own = rows.filter(row => row.origins.some(origin => origin.workItemId === item.id));
    if (!Number.isSafeInteger(contract.methodVersion) || contract.methodVersion < 1 || !contract.sourceScope.routeIds.length ||
        !contract.sourceScope.canonicalUrls.length || !contract.sourceScope.observationArtifactIds.length) {
      for (const row of own.filter(row => pending.includes(row))) waiting.push({ findingId: row.id,
        reason: "The work item's source instructions are not resolved yet; its saved finding remains owed." });
      continue;
    }
    const tried = new Set<string>();
    for (const first of pending.filter(row => !handled.has(row.id) && own.includes(row))) {
      const key = first.sourceUrl ?? first.id;
      if (tried.has(key)) continue;
      tried.add(key);
      const before = built.length;
      // The lock covers the whole page: one extraction may carry several people, even when two Sends reference it.
      await repos.locks.withLock(`box-build:${fingerprint([first.sourceUrl ?? first.id])}`, async () => {
        const pageRows = own.filter(row => row.sourceUrl === first.sourceUrl);
        // CH-20: a mid-walk drop carries its own fact. One about another subject waits for that subject's door (BX-04),
        // never built against this item's contract.
        const origins = await Promise.all(pageRows.flatMap(row => row.origins.filter(origin => origin.workItemId === item.id && origin.kind === "SCOUT" &&
            (!origin.reported || row.subjectId === item.subject))
          .map(async origin => ({ row, finding: origin.reported ? reportedFinding(row, origin) : (await scoutFor(origin))?.findings[origin.findingIndex] }))));
        if (!origins.length && pageRows.every(row => row.origins.some(origin => origin.reported && row.subjectId !== item.subject))) {
          waiting.push({ findingId: first.id, reason: "Dropped for another subject; it waits for that subject's own door." });
          return;
        }
        const artifactId = origins.find(({ row, finding }) => pending.includes(row) && finding?.field && finding.exactQuote)?.finding?.artifactIds[0];
        if (!artifactId) { waiting.push({ findingId: first.id, reason: "No structured field and saved-page reference; the original finding remains owed." }); return; }
        const relevant = origins.filter(({ finding }) => finding?.artifactIds.includes(artifactId));
        const findings = relevant.map(({ finding }) => finding!);
        const candidates = [...new Map(relevant.map(({ row }) => [row.id, row])).values()];
        const records = await repos.workerResults.read(item.id);
        const captures = await capturesForPublication({ repos, workItemId: item.id, primaryId: artifactId, results: records, readCapture: input.readCapture });
        const capture = captures[0];
        const proposal = scoutExtraction({ contract, evidence: capture.evidence, findings, attemptId: "box-proposal" });
        const page = { url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt, sourcePolicy: capture.sourcePolicy, campaign: capture.campaign,
          linkingPage: linkingPageFrom(capture.evidence.canonicalUrl, captures.filter(captureIntact).map(c => c.evidence)),
          citations: captures.filter(c => c !== capture && captureIntact(c)).map(c => ({ url: c.evidence.canonicalUrl, text: c.evidence.text, retrievedAt: c.observedAt })) };
        if (!captureIntact(capture) || proposal.verdict !== "EXTRACTED" || !proposal.records.some(record =>
          section3Record({ recordClass: contract.recordClass, fields: record.fields, page, now: input.now() }).live)) {
          waiting.push({ findingId: first.id, reason: proposal.warnings.map(w => w.code).join(", ") || "The saved page or record does not yet meet §3." });
          return;
        }
        const accepted = candidates.filter(row => relevant.some(ref => ref.row.id === row.id && ref.finding !== undefined && proposal.spans.some(span =>
          span.field === ref.finding?.field && span.quote === ref.finding?.exactQuote &&
          proposal.records.some(record => record.id === span.recordId && String(record.fields[span.field]) === String(ref.finding?.value)))));
        const claims = new Map<string, string>();
        const holder = `box-builder:${fingerprint([item.id, artifactId])}`;
        for (const row of accepted) {
          const at = input.now();
          const claim = await takeBoxFinding(repos.boxFindings, row.id, holder, at, new Date(Date.parse(at) + input.leaseMs).toISOString());
          if (claim) claims.set(row.id, claim.token);
        }
        if (!claims.size) return;
        try {
          // Stable across a crash between the result commit and the Box projection.
          const signature = contentHash(canonicalJson([artifactId, proposal.records, proposal.spans]));
          const task = await enqueueWorkerTask(repos, { workItemId: item.id, role: "PARSER", artifactId, contract, now: input.now(), replayLabel: `box:${signature}` });
          let committed = records.find(record => record.routeTaskId === task.id);
          if (committed) await applyWorkerCompletion(repos, committed);
          else {
            const worker: WorkerRef = { role: "PARSER", provider: "we-the-people", version: BOX_PARSER_IMPLEMENTATION, instance: holder };
            const claim = await claimRouteTask(repos, { routeTaskId: task.id, holder, now: input.now(), ttlMs: input.leaseMs });
            const attempt = await beginAttemptFor(repos, { routeTaskId: task.id, workItemId: item.id, worker, lease: claim.lease.value,
              now: input.now(), methodVersion: contract.methodVersion, policyVersion: FLEET_POLICY_VERSION });
            const result = { ...proposal, attemptId: attempt.id };
            committed = await completeWorkerTask(repos, { id: `wr-${fingerprint([attempt.id])}`, schemaVersion: 1, workItemId: item.id,
              routeTaskId: task.id, attemptId: attempt.id, worker, grant: fleetGrant("PARSER", item.project, attempt.value.startedAt),
              methodVersion: contract.methodVersion, policyVersion: FLEET_POLICY_VERSION, startedAt: attempt.value.startedAt, endedAt: input.now(),
              executionMode: "DETERMINISTIC", cost: { ...ZERO_COST, usd: 0, inputTokens: 0, outputTokens: 0, bytesFetched: 0, requestCount: 0 },
              usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, uncachedInputTokens: 0 },
              inputArtifactIds: [artifactId], inputResultIds: [...new Set(relevant.flatMap(({ row }) => row.origins.map(origin => origin.resultId)))],
              semanticHash: contentHash(canonicalJson(normalizedParserResult(result))), result });
          }
          for (const [id, token] of claims) {
            if (await finishBoxFinding(repos.boxFindings, id, token, { state: "built", buildResultId: committed.id }, input.now())) built.push(id);
            handled.add(id);
          }
        } catch (error) {
          for (const [id, token] of claims) await finishBoxFinding(repos.boxFindings, id, token,
            { state: "failed", reason: error instanceof Error ? error.message : String(error) }, input.now());
          throw error;
        }
      }).catch(error => {
        if (!(error instanceof RepositoryLockHeld)) throw error;
        waiting.push({ findingId: first.id, reason: "Another builder is using this saved finding." });
      });
      if (built.length > before) break;
    }
  }
  return { built, waiting };
}
