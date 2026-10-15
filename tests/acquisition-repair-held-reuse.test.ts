import assert from "node:assert/strict";
import test from "node:test";
import { defaultGrant } from "../lib/control-plane/capability.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { objectKey } from "../lib/control-plane/evidence/store.ts";
import { runAcquirer, type AcquirerWorkerInput } from "../lib/control-plane/workers/acquirer.ts";
import type { ScoutToolkit } from "../lib/control-plane/scheduler/scout-contract.ts";

const now = "2026-09-28T09:00:00.000Z";
const project = "linked-repair-test";
const sourceUrl = "https://official.example.gov/council";

test("linked successor reuses exact completed ancestor bytes, while an undeclared cross-work artifact remains refused", async () => {
  const text = "<table><tr><th>Staff</th></tr><tr><td>Mayor</td></tr></table>";
  const artifact = recordAcquisition({ canonicalUrl: sourceUrl, retrievedAt: "2026-09-28T08:00:00.000Z", httpStatus: 200,
    contentType: "text/html", sourceId: "official.example.gov", methodRouteId: "scout:fetch_public",
    workItemId: "wi-parent", attemptId: "at-parent", permission: "ALLOWED", transport: "REACHABLE" }, text).artifact;
  const span = { artifactId: artifact.id, contentHash: artifact.contentHash, start: 0, end: text.length,
    quote: text, offsetUnit: "UTF16_CODE_UNITS" as const };
  const route = { id: "official-council", subjectId: "az:city:test", jurisdiction: "AZ", recordClass: "OFFICIAL_ROSTER",
    sourceId: artifact.sourceId, publisher: "Official City", url: sourceUrl, observedLocator: sourceUrl,
    observedAt: artifact.retrievedAt, firstObservedAt: artifact.retrievedAt, methodVersion: 1, permission: "ALLOWED" as const,
    observation: span, publisherSubjectEvidence: [span], applicableBecause: "Source page is retained with exact official span.",
    nextRouteIds: [], retrieval: "fetch_public" as const };
  const held = { artifactId: artifact.id, sourceObservationArtifactId: span.artifactId, sourceRouteId: route.id,
    immutable: true, partial: false, currentUntil: "2026-09-29T08:00:00.000Z", inheritedFromWorkItemId: "wi-parent" };
  const input: AcquirerWorkerInput = { attemptId: "at-child", worker: { role: "ACQUIRER", provider: "test", version: "1", instance: "child" },
    project, workItemId: "wi-child", grant: defaultGrant({ role: "ACQUIRER", project, policyVersion: "test", grantedAt: now }),
    now: () => now, route, held: [held] };
  let network = 0;
  const toolkit: ScoutToolkit = { call: async () => { network++; throw new Error("network must not run"); },
    specs: [], vaultedArtifactIds: new Set(), reported: [], toolCalls: 0, requestCount: 0, bytesFetched: 0 };
  const saved = { artifact, key: objectKey(project, artifact), bytes: Buffer.from(text) };
  const runtime = { toolkit, readVault: async () => saved,
    authorizeInheritedHeld: async (link: { originWorkItemId: string; childWorkItemId: string; artifactId: string; project: string }) =>
      link.originWorkItemId === "wi-parent" && link.childWorkItemId === "wi-child" && link.artifactId === artifact.id && link.project === project };
  const replay = await runAcquirer(input, runtime);
  assert.equal(replay.verdict, "ACQUIRED");
  assert.equal(replay.requestCount, 0);
  assert.equal(replay.artifacts[0]?.artifactId, artifact.id);
  assert.equal(replay.artifacts[0]?.acquisitionAttemptId, "at-parent");
  assert.equal(replay.artifacts[0]?.reused, true);
  assert.equal(network, 0);
  const noBroker = await runAcquirer(input, { toolkit, readVault: async () => saved });
  assert.equal(noBroker.verdict, "BLOCKED", "a declared ancestor alone is never authority to cross a WorkItem boundary");
  const unlinked = await runAcquirer({ ...input, held: [{ ...held, inheritedFromWorkItemId: "wi-unrelated" }] }, runtime);
  assert.equal(unlinked.verdict, "BLOCKED");
  assert.equal(unlinked.blockers[0]?.code, "EVIDENCE_IDENTITY_MISMATCH");
  assert.equal(network, 0);
});
