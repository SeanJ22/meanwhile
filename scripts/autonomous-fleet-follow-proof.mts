import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { dispatchWorkerTask, enqueueWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import type { GeneralizedCivicExtractionContract } from "../lib/control-plane/workers/types.ts";
import type { ObservedResearchRoute, ResearchSpan, AcquirerTaskSpec } from "../lib/control-plane/workers/research-types.ts";
import { today } from "./doc-dates.mjs";

const root = resolve(import.meta.dirname, "..");
const vaultRoot = process.argv.find(a => a.startsWith("--vault-root="))?.slice(13);
const mode = process.argv.find(a => a.startsWith("--mode="))?.slice(7) ?? "nj";
if (!vaultRoot) throw new Error("FOLLOW_PROOF_EXPLICIT_VAULT_REQUIRED");
const connection = controlPlaneUrlFromEnv(); if (!connection) throw new Error("FOLLOW_PROOF_CONTROL_PLANE_NOT_CONFIGURED");
const repos = await createPgRepositories(connection);
const store = new DurableEvidenceStore(resolve(vaultRoot));
const readVault = researchVaultResolver(repos, store, "freshness");
const now = () => new Date().toISOString();
const runtime = await autonomousStandingRuntime({ root, vaultRoot: resolve(vaultRoot), repos, now });
const methodVersion = JSON.parse(readFileSync(join(root, "data/method/knowledge.json"), "utf8")).version;
const dispatches: unknown[] = [];
const summary: unknown[] = [];
type Held = Awaited<ReturnType<typeof readVault>>;
const textOf = (held: Held) => new TextDecoder().decode(held.bytes);
const span = (held: Held, quote: string): ResearchSpan => {
  const start = textOf(held).indexOf(quote); if (start < 0 || !quote) throw new Error("FOLLOW_PROOF_EXACT_SPAN_MISSING");
  return { artifactId: held.artifact.id, contentHash: held.artifact.contentHash, start, end: start + quote.length, quote, offsetUnit: "UTF16_CODE_UNITS" };
};
async function acquire(item: WorkItem, input: { id: string; url: string; quote: string; source: Held; publisher: Held; publisherName: string; state: string; recordClass: string;
  extraction: GeneralizedCivicExtractionContract["extraction"]; requiredFields: string[]; namespace: string; keyFields: string[] }) {
  const route: ObservedResearchRoute = { id: input.id, url: input.url, observedLocator: input.url, subjectId: item.subject, jurisdiction: input.state,
    sourceId: new URL(input.url).host, publisher: input.publisherName, recordClass: input.recordClass, methodVersion, permission: "ALLOWED",
    observedAt: input.source.artifact.retrievedAt, firstObservedAt: input.source.artifact.retrievedAt, observation: span(input.source, input.quote),
    publisherSubjectEvidence: [span(input.publisher, textOf(input.publisher).slice(0, Math.min(500, textOf(input.publisher).length)))],
    applicableBecause: "A durably observed official publisher document names the exact next record/API URL; this route advances the existing owed civic question.",
    nextRouteIds: ["EXTERNAL_RECORD_VERIFICATION_AND_IDENTITY_JOIN"], retrieval: "fetch_public" };
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: input.recordClass, subjectId: item.subject,
    jurisdiction: { country: "US", state: input.state, canonicalId: item.subject }, identity: { namespace: input.namespace, keyFields: input.keyFields },
    sourceScope: { sourceId: route.sourceId, routeIds: [route.id, "scout:fetch_public"], publisher: input.publisherName,
      canonicalUrls: [input.url], observationArtifactIds: [...new Set([input.source.artifact.id, input.publisher.artifact.id])] }, methodVersion,
    requiredFields: input.requiredFields, completenessScope: "Only the exact captured official record response; external population denominator and full universe completeness remain unverified.",
    expectedSourceDate: null, extraction: input.extraction, verification: { required: true, authorities: [] } };
  const acquisition: AcquirerTaskSpec = { route, held: [] };
  const row = await repos.workItems.mustRead(item.id);
  if (!row.value.autonomousPlan) await repos.workItems.compareAndSet(item.id, row.revision, { ...row.value, autonomousPlan: { version: 1, contract,
    capability: input.state === "NJ" ? "BALLOT_AND_CANDIDATES" : "MEETINGS", jurisdiction: input.state,
    sourceRegistryReferences: [input.state === "NJ" ? "data/states/nj/jurisdictions/nj.json#BALLOT_AND_CANDIDATES:THIS_JURISDICTION:county-of-atlantic-county-clerk" : `lib/registry/registry.json#${item.subject}`],
    seedUrls: [input.publisher.artifact.canonicalUrl], sources: [route], acquisition: [acquisition], detective: [], engineering: [], auditScope: "CAPTURED_ARTIFACT" } }, now());
  const task = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", artifactId: input.source.artifact.id, contract, acquisition, now: now() });
  if (["PENDING", "RECLAIMABLE"].includes(task.state)) dispatches.push(await dispatchWorkerTask(runtime, task));
  const record = (await repos.workerResults.read(item.id)).findLast(r => r.routeTaskId === task.id && r.result.role === "ACQUIRER");
  summary.push({ itemId: item.id, subject: item.subject, sourceUrl: input.url, record });
  if (!record || record.result.role !== "ACQUIRER" || record.result.verdict !== "ACQUIRED") return null;
  return await readVault(record.result.artifacts[0].artifactId);
}
async function owed(subject: string, obligation: string, why: string) {
  const draft = createWorkItem({ project: "freshness", subject, obligation, why, contract: { requiresValidation: true, requiresAudit: true, requiresCompleteDenominator: true }, now: now() });
  return (await repos.workItems.read(draft.id))?.value ?? (await registerWorkItem(repos, draft, now())).value;
}
if (mode === "nj") {
  const scoutProof = JSON.parse(readFileSync(join(root, "data/health/autonomous-agent-fleet", `${today()}-nj-atlantic-scout.json`), "utf8"));
  const scout = scoutProof.results.findLast((r: { refusal: unknown }) => r.refusal === null);
  if (!scout) throw new Error("FOLLOW_PROOF_ACCEPTED_SCOUT_REQUIRED");
  for (const candidate of scout.candidates) {
    const source = await readVault(candidate.evidenceArtifactIds[0]);
    if (!textOf(source).includes(candidate.url)) throw new Error("FOLLOW_PROOF_SCOUT_LOCATOR_NOT_OBSERVED");
    const item = await owed(scout.subjectId, `Acquire the official Atlantic County Clerk publication ${candidate.routeId}`,
      "The existing DISCOVERY_OWED county filing obligation produced this exact source-backed record route through a bounded Scout; the record remains owed.");
    await acquire(item, { id: candidate.routeId, url: candidate.url, quote: candidate.url, source, publisher: source, publisherName: "Atlantic County Clerk", state: "NJ",
      recordClass: "CANDIDATE_FILING_DOCUMENT", extraction: { format: "UNSUPPORTED", fields: {}, mediaType: "application/pdf", reason: "PDF text extraction adapter required for this official publication." },
      requiredFields: ["candidateName", "office"], namespace: "nj:atlantic:2026:filing", keyFields: ["candidateName", "office"] });
  }
} else if (mode === "nh") {
  const prior = JSON.parse(readFileSync(join(root, "data/health/autonomous-agent-fleet", `${today()}-springfield.json`), "utf8"));
  const sourceRecords = await Promise.all(prior.sourceObservationArtifactIds.map((id: string) => readVault(id)));
  const publisher: Held | undefined = sourceRecords.find((h: Held) => h.artifact.canonicalUrl === "https://springfieldnh.org/events/");
  if (!publisher) throw new Error("FOLLOW_PROOF_NH_PUBLISHER_MISSING");
  const api = "https://springfieldnh.org/wp-json/";
  if (!textOf(publisher).includes(api)) throw new Error("FOLLOW_PROOF_NH_API_NOT_OBSERVED");
  const schemaItem = await owed(prior.subject, "Discover Springfield's official public event API schema from its observed publisher link", "The publisher's event page explicitly links this API schema; it can name the actual machine-readable meeting/event record route.");
  const schema = await acquire(schemaItem, { id: "OBSERVED_WORDPRESS_API_SCHEMA", url: api, quote: api, source: publisher, publisher,
    publisherName: "Town of Springfield, New Hampshire", state: "NH", recordClass: "OFFICIAL_SOURCE_SCHEMA",
    extraction: { format: "UNSUPPORTED", fields: {}, mediaType: "application/json", reason: "API schema is route discovery; civic event records must be retrieved from the schema's exact collection links." },
    requiredFields: ["route"], namespace: "springfield:source-schema", keyFields: ["route"] });
  if (schema) {
    const links = [...textOf(schema).matchAll(/"href"\s*:\s*("(?:\\.|[^"\\])*")/g)].map(m => ({ quote: m[1], url: JSON.parse(m[1]) as string }));
    const event = links.find(l => /\/wp-json\/wp\/v2\/event\/?$/.test(l.url));
    const board = links.find(l => /\/wp-json\/wp\/v2\/board\/?$/.test(l.url));
    const next = event ?? board;
    if (next) {
      const item = await owed(prior.subject, event ? "Acquire Springfield's official public event API records" : "Acquire Springfield's official governing-board API records",
        "The current official API schema directly names this public collection endpoint; preserve identity and exact field provenance before independent verification.");
      await acquire(item, { id: event ? "OFFICIAL_WORDPRESS_EVENT_COLLECTION" : "OFFICIAL_WORDPRESS_BOARD_COLLECTION", url: next.url, quote: next.quote, source: schema,
        publisher, publisherName: "Town of Springfield, New Hampshire", state: "NH", recordClass: event ? "OFFICIAL_EVENT_DIRECTORY" : "OFFICIAL_BOARD_DIRECTORY",
        extraction: { format: "JSON_RECORDS", rowsPointer: "", fields: { id: { source: "/id", type: "NUMBER" }, link: { source: "/link", type: "STRING" },
          title: { source: "/title/rendered", type: "STRING" }, modified: { source: "/modified", type: "STRING" } } }, requiredFields: ["id", "link", "title"],
        namespace: "springfieldnh.org:public-record", keyFields: ["id"] });
    } else summary.push({ blocker: "NO_PUBLIC_EVENT_OR_BOARD_API_COLLECTION_IN_OBSERVED_SCHEMA", observationArtifactId: schema.artifact.id,
      observedCollectionUrls: links.filter(l => /\/wp\/v2\//.test(l.url)).map(l => l.url) });
  }
} else throw new Error("FOLLOW_PROOF_UNKNOWN_MODE");
const dir = join(root, "data/health/autonomous-agent-fleet"); mkdirSync(dir, { recursive: true });
const path = join(dir, `${today()}-${mode}-followed-records.json`);
writeFileSync(path, JSON.stringify({ formatVersion: 1, observedAt: now(), mode, dispatches, summary, promotion: "OFF" }, null, 2) + "\n");
console.log(JSON.stringify({ path, summary: summary.map((value: unknown) => { const s = value as { itemId?: string; sourceUrl?: string; record?: { id: string; result: { verdict: string; artifacts?: unknown; sourceGrounding?: unknown } }; blocker?: string };
  return { itemId: s.itemId, sourceUrl: s.sourceUrl, resultId: s.record?.id, verdict: s.record?.result.verdict, artifacts: s.record?.result.artifacts, sourceGrounding: s.record?.result.sourceGrounding, blocker: s.blocker }; }) }, null, 2));
