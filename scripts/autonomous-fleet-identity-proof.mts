import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { dispatchWorkerTask, enqueueWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import type { DetectiveTaskSpec } from "../lib/control-plane/workers/research-types.ts";
import { today } from "./doc-dates.mjs";

const root = resolve(import.meta.dirname, "..");
const vaultRoot = process.argv.find(a => a.startsWith("--vault-root="))?.slice(13);
if (!vaultRoot) throw new Error("IDENTITY_PROOF_EXPLICIT_VAULT_REQUIRED");
const connection = controlPlaneUrlFromEnv(); if (!connection) throw new Error("IDENTITY_PROOF_NOT_CONFIGURED");
const repos = await createPgRepositories(connection);
const now = () => new Date().toISOString();
const readVault = researchVaultResolver(repos, new DurableEvidenceStore(resolve(vaultRoot)), "freshness");
const artifactId = "ar-d3f2958abc21c2361539067b";
const held = await readVault(artifactId);
const itemId = "wi-955de2bee189d6518766fe27";
const row = await repos.workItems.mustRead(itemId);
const plan = row.value.autonomousPlan;
if (!plan || held.artifact.workItemId !== row.value.id) throw new Error("IDENTITY_PROOF_SCOPE_MISMATCH");
const detective: DetectiveTaskSpec = { question: {
  id: "springfield-publisher-directory-record-body-identity", kind: "IDENTITY",
  text: "Can the captured Springfield publisher board directory be assigned uniformly to the Select Board canonical identity?",
  subjectId: row.value.subject, jurisdiction: "NH", recordClass: "OFFICIAL_BOARD_DIRECTORY",
  alternatives: [
    { id: "UNIFORM_SELECT_BOARD", canonicalIdentity: row.value.subject,
      statement: "Every captured publisher directory row names the Select Board.",
      tests: [{ artifactId, predicate: { kind: "JSON_VALUE_EQUALS", pointer: "/6/title/rendered", expected: "Select Board" } }] },
    { id: "MIXED_PUBLISHER_DIRECTORY", canonicalIdentity: "nh:city:town-of-springfield",
      statement: "The town publisher directory contains mixed boards and document pages; per-record canonical body joins remain unresolved.",
      tests: [{ artifactId, predicate: { kind: "JSON_VALUE_EQUALS", pointer: "/6/title/rendered", expected: "Emergency Operations Plan" } },
        { artifactId, predicate: { kind: "JSON_VALUE_EQUALS", pointer: "/0/title/rendered", expected: "Agricultural Commission" } }] },
  ],
  authorities: [{ artifactId, organization: "Town of Springfield, New Hampshire", type: "PUBLISHER_DIRECTORY", observedAt: held.artifact.retrievedAt }],
  falsificationCondition: "An independent government identity crosswalk and each page's authority evidence establish that all captured records belong to the same canonical body despite their different page titles.",
  nextAction: "Resolve each publisher page to its canonical government or body identity from independent authority evidence. Classify the Emergency Operations Plan as a document page; do not treat this mixed ten-row response as Select Board records or a complete government population.",
  populationDefinition: "The complete Springfield publisher board-directory population and canonical identities of its rows remain unverified.", denominator: null,
}, artifactIds: [artifactId], walk: [], walkState: { state: "OPEN", nextRouteIds: ["CANONICAL_RECORD_TO_BODY_IDENTITY_CROSSWALK", "EXTERNAL_PUBLISHER_DIRECTORY_DENOMINATOR"] } };
if (!plan.detective.some(d => d.question.id === detective.question.id)) {
  await repos.workItems.compareAndSet(itemId, row.revision, { ...row.value, autonomousPlan: { ...plan, detective: [...plan.detective, detective] } }, now());
}
const runtime = await autonomousStandingRuntime({ root, vaultRoot: resolve(vaultRoot), repos, now });
const task = await enqueueWorkerTask(repos, { workItemId: itemId, role: "DETECTIVE", artifactId, contract: plan.contract, detective, now: now() });
const dispatch = ["PENDING", "RECLAIMABLE"].includes(task.state) ? await dispatchWorkerTask(runtime, task) : null;
const results = await repos.workerResults.read(itemId);
const result = results.findLast(r => r.routeTaskId === task.id);
const dir = join(root, "data/health/autonomous-agent-fleet"); mkdirSync(dir, { recursive: true });
const path = join(dir, `${today()}-nh-directory-identity.json`);
writeFileSync(path, JSON.stringify({ formatVersion: 1, observedAt: now(), itemId, artifactId, dispatch, result,
  preservation: "Prior WorkItem subject, contract, Attempts, and results retained. This later Detective adds the exact mixed-directory identity limitation.", promotion: "OFF" }, null, 2) + "\n");
console.log(JSON.stringify({ path, resultId: result?.id, attemptId: result?.attemptId, result: result?.result }, null, 2));
