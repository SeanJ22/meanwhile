import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BallotSet } from "../ballot/types.ts";
import { registeredVotingSourceDoors } from "../ballot/voting-source-publication.ts";
import { ZERO_COST, type Attempt } from "../control-plane/attempt.ts";
import { recordArtifactMetadata } from "../control-plane/repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { artifactId, recordAcquisition, type Artifact } from "../control-plane/evidence/artifact.ts";
import { putArtifact, readForParser } from "../control-plane/evidence/store.ts";
import { DurableEvidenceStore } from "../control-plane/evidence/durable-store.ts";
import { evidenceProjection } from "../control-plane/workers/evidence-projection.ts";
import { extractPdf } from "../control-plane/scheduler/scout-tools.ts";
import { VAULT_DIR } from "../control-plane/scheduler/vault.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { readPublicationSourcePolicy } from "../control-plane/promotion/source-settings.ts";
import { contentHash } from "../control-plane/ids.ts";

/** Read this state's cited measure sources and their registered official
 * linking pages. Only freshly saved response bytes can establish authority. */
export async function loadRoutineMeasureSources(input: {
  readonly repos: ControlPlaneRepositories;
  readonly root: string;
  readonly state: string;
  readonly ballots: readonly BallotSet[];
  readonly now: () => string;
  readonly open: (url: string) => Promise<Response>;
}) {
  const urls = new Set<string>();
  const doorIds = new Set<string>();
  for (const ballot of input.ballots) for (const contest of ballot.contests.filter(row => row.type === "MEASURE")) {
    const measure = ballot.measures?.find(row => row.contestId === contest.id);
    const analysis = ballot.measureAnalyses?.analyses.find(row => row.contestId === contest.id);
    const prior = ballot.measureRecords?.find(row => row.contestId === contest.id);
    const citedUrls = [prior?.sourceUrl, measure?.provenance.sourceUrl, analysis?.analysisUrl, contest.provenance.sourceUrl];
    if (citedUrls.some(url => url?.startsWith("https://") && !isOfficialSource(url))) {
      for (const provenance of [contest.provenance, measure?.provenance]) {
        if (provenance?.doorId) doorIds.add(provenance.doorId);
      }
    }
    for (const url of citedUrls) {
      if (url?.startsWith("https://")) urls.add(url);
    }
  }
  if (doorIds.size) {
    const doors = await registeredVotingSourceDoors(input.repos.doors, input.state);
    for (const door of doors.filter(door => doorIds.has(door.id))) {
      const seen = new Set<string>();
      for (let linking = door.officialLinkingPage; linking && !seen.has(linking.url); linking = linking.linkingPage ?? undefined) {
        seen.add(linking.url);
        if (linking.url.startsWith("https://")) urls.add(linking.url);
      }
    }
  }
  const vault = new DurableEvidenceStore(join(input.root, ...VAULT_DIR));
  const sourcePolicy = await readPublicationSourcePolicy(input.repos);
  const captures: WorkerPublicationCapture[] = [], failures: { url: string; reason: string }[] = [];
  for (const url of urls) {
    const at = input.now(), id = `measure-source:${randomUUID()}`;
    const attempt: Attempt = { id, routeTaskId: `measure-translations:${input.state}`, workItemId: id,
      worker: { role: "ACQUIRER", provider: "we-the-people", version: "measure-source/1", instance: input.state },
      leaseId: id, startedAt: at, endedAt: null, outcome: null, abortReason: null,
      artifactIds: [], cost: ZERO_COST, methodVersion: 1, policyVersion: "R7" };
    let saved = (await input.repos.attempts.put(attempt.id, attempt, at)).persisted;
    const artifacts: string[] = [];
    const retain = async (artifact: Artifact, bytes: Uint8Array) => {
      await putArtifact(vault, "freshness", artifact, bytes);
      await recordArtifactMetadata(input.repos, { artifactId: artifact.id, workItemId: id, routeTaskId: attempt.routeTaskId,
        attemptId: id, tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength,
        contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: at }, at);
      artifacts.push(artifact.id);
    };
    try {
      const response = await input.open(url);
      if (!response.ok || response.status === 206) throw new Error(`Official text returned HTTP ${response.status}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const base = { canonicalUrl: url, retrievalUrl: response.url || url, retrievedAt: at, httpStatus: response.status,
        sourceId: new URL(url).hostname, methodRouteId: "measure-source/1", workItemId: id, attemptId: id,
        permission: "ALLOWED" as const, transport: "REACHABLE" as const };
      let artifact: Artifact;
      if (Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") {
        const originalHash = contentHash(bytes);
        const parent: Artifact = { ...base, id: artifactId("RAW", originalHash), tier: "RAW", contentHash: originalHash,
          byteLength: bytes.byteLength, contentType: "application/pdf", headers: {}, retentionPolicy: "EVIDENCE_PERMANENT" };
        await retain(parent, bytes);
        const extracted = await extractPdf(bytes);
        if (extracted.kind !== "TEXT" || !extracted.complete) throw new Error("The official PDF could not be read completely.");
        const text = extracted.text.replace(/\s+/g, " ").trim();
        const captured = recordAcquisition({ ...base, contentType: "text/plain" }, text).artifact;
        if (captured.tier === "RESTRICTED_RAW") throw new Error("Official text contains restricted material.");
        artifact = { ...captured, id: artifactId("EXTRACTED_DERIVED", captured.contentHash), tier: "EXTRACTED_DERIVED",
          extraction: { kind: "PDF_TEXT", version: "pdf-transcription/1", complete: true, pages: extracted.pages, parent } };
        await retain(artifact, Buffer.from(text));
      } else {
        const text = Buffer.from(bytes).toString("utf8");
        if (!Buffer.from(text).equals(Buffer.from(bytes))) throw new Error("The official document is not valid UTF-8 text.");
        artifact = recordAcquisition({ ...base, contentType: response.headers.get("content-type") ?? "text/plain" }, text).artifact;
        if (artifact.tier === "RESTRICTED_RAW") throw new Error("Official text contains restricted material.");
        await retain(artifact, Buffer.from(text));
      }
      const { input: parserInput } = await readForParser(vault, "freshness", artifact);
      saved = await input.repos.attempts.compareAndSet(id, saved.revision, { ...saved.value, artifactIds: artifacts, endedAt: input.now(), outcome: "COMPLETED" }, input.now());
      captures.push({ evidence: evidenceProjection(parserInput), sourcePolicy, observedAt: at, partial: false,
        httpStatus: response.status, transport: "REACHABLE" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ url, reason });
      await input.repos.attempts.compareAndSet(id, saved.revision, { ...saved.value, artifactIds: artifacts, endedAt: input.now(), outcome: "ABORTED", abortReason: reason }, input.now());
    }
  }
  return { captures, failures };
}
