import { savedPageReader, realOpenBytes } from "../control-plane/scheduler/scout-tools.ts";
import type { ArtifactProvenance, ScoutToolContext } from "../control-plane/scheduler/scout-contract.ts";
import { durableResearchTools, type ResearchRuntimeTools } from "../control-plane/workers/research-runtime.ts";
import { workerVaultResolver } from "../control-plane/workers/vault.ts";
import { researchVaultResolver } from "../control-plane/workers/vault-object.ts";
import { evidenceProjection } from "../control-plane/workers/evidence-projection.ts";
import { recordAcquisition, type Artifact } from "../control-plane/evidence/artifact.ts";
import { readForParser } from "../control-plane/evidence/store.ts";
import type { WorkArtifact } from "../control-plane/scheduler/dispatch.ts";
import { scheduleObligation } from "../control-plane/scheduler/obligation.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { HeldSourcePage } from "../sources/plural/place.ts";

export class PlaceSourceDeferred extends Error {
  constructor(host: string) {
    super(`DEFERRED: ${host} reached the shared website request bound; saved responses remain available for the next pass`);
  }
}

/** Bind the ordinary saved reader to an actual acquiring Attempt. Every job's
 * fresh captures are eligible; missing local bytes fall through to acquisition.
 * No timestamp is advanced by replaying a held document. */
export async function placeSourceReader(input: {
  tools: ResearchRuntimeTools;
  context: Omit<ScoutToolContext, "vault" | "spaceOut" | "inherited">;
  project: string;
}) {
  const { tools, context, project } = input;
  const artifacts = new Map<string, WorkArtifact>();
  const captures = new Map<string, WorkerPublicationCapture>();
  const geographyCaptures: WorkerPublicationCapture[] = [];
  const cost = { requestCount: 0, bytesFetched: 0 };
  const requests = new Map<string, number>();
  let deferred: PlaceSourceDeferred | null = null;
  const takeRequest = (url: string) => {
    if (deferred) throw deferred;
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const count = requests.get(host) ?? 0;
    if (count >= context.bound.maxRequestsPerHost) {
      deferred = new PlaceSourceDeferred(host);
      throw deferred;
    }
    requests.set(host, count + 1);
    cost.requestCount++;
  };
  const durable = durableResearchTools(tools, { project, attemptId: context.attemptId,
    workItemId: context.workItemId, routeTaskId: context.routeTaskId });
  const vault = async (artifact: Artifact, text: string) => {
    const result = await durable.vault(artifact, text);
    artifacts.set(artifact.id, { artifactId: artifact.id, tier: artifact.tier, contentHash: artifact.contentHash,
      byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl,
      partial: artifact.httpStatus === 206 || artifact.extraction?.complete === false, recordedAt: artifact.retrievedAt });
    if (result.stored && artifact.tier !== "RESTRICTED_RAW" && artifact.retentionPolicy !== "DIAGNOSTIC") {
      const parsed = await readForParser(tools.store, project, artifact);
      captures.set(artifact.id, { evidence: evidenceProjection(parsed.input), observedAt: artifact.retrievedAt,
        httpStatus: artifact.httpStatus, transport: artifact.transport, partial: artifact.httpStatus === 206 });
    }
    return result;
  };
  const at = tools.now();
  const cadence = scheduleObligation({ id: context.obligation.obligation.id, recordClass: "OFFICIAL_ROSTER",
    subjectId: context.obligation.obligation.subjectId, routeId: null, active: true,
    readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: at }, Date.parse(at));
  const cutoff = Date.parse(at) - ("cadenceHours" in cadence ? cadence.cadenceHours : 24) * 3_600_000;
  const allRecords = await tools.repos.artifacts.readAll();
  const records = allRecords.filter(row => !row.partial && row.tier !== "RESTRICTED_RAW" &&
    Date.parse(row.recordedAt) >= cutoff && Date.parse(row.recordedAt) <= Date.parse(at));
  // This reader resolves the same initial held set throughout the attempt;
  // new captures are already available in its in-memory capture map.
  const heldRepos = { ...tools.repos, artifacts: { ...tools.repos.artifacts, readAll: async () => allRecords } };
  const readHeld = workerVaultResolver(heldRepos, tools.store, project, { snapshot: true });
  const readObject = researchVaultResolver(heldRepos, tools.store, project);
  const provenance: ArtifactProvenance[] = [];
  const inherited = new Map<string, WorkerPublicationCapture>();
  const resolvedUrls = new Set<string>();
  const heldCapture = async (url: string) => {
    const current = [...captures.values()].find(capture => capture.evidence.canonicalUrl === url);
    if (current) return current;
    if (!resolvedUrls.has(url)) {
      resolvedUrls.add(url);
      for (const row of records.filter(row => row.canonicalUrl === url).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))) {
        try {
          const [{ artifact }, parsed] = await Promise.all([readObject(row.artifactId), readHeld(row.artifactId)]);
          if (artifact.httpStatus !== 200 || artifact.retentionPolicy === "DIAGNOSTIC" || Date.parse(artifact.retrievedAt) < cutoff) continue;
          const capture = { evidence: evidenceProjection(parsed), observedAt: artifact.retrievedAt,
            httpStatus: artifact.httpStatus, transport: artifact.transport, partial: false };
          inherited.set(row.artifactId, capture);
          captures.set(row.artifactId, capture);
          provenance.push({ artifactId: row.artifactId, canonicalUrl: artifact.canonicalUrl,
            retrievedAt: artifact.retrievedAt, httpStatus: artifact.httpStatus,
            permission: artifact.permission, methodRouteId: artifact.methodRouteId,
            contentType: artifact.contentType, retrievalUrl: artifact.retrievalUrl });
          return capture;
        } catch { /* Unreadable held bytes leave acquisition owed. */ }
      }
    }
    return null;
  };
  const read = savedPageReader({ ...context, ...durable, vault,
    openBytes: async request => {
      takeRequest(request.url);
      const response = await (tools.openBytes ?? realOpenBytes)(request);
      cost.bytesFetched += response.bytes.byteLength;
      return response;
    },
    ...(tools.browse ? { browse: async (request: Parameters<NonNullable<ResearchRuntimeTools["browse"]>>[0]) => {
      takeRequest(request.url);
      const response = await tools.browse!(request);
      cost.bytesFetched += Buffer.byteLength(response.html);
      return response;
    } } : {}),
    inherited: { artifactIds: records.map(row => row.artifactId), summary: "Fresh saved sources from every job, before network acquisition.",
      provenance },
    readHeldArtifact: async id => {
      const held = inherited.get(id);
      if (!held) throw new Error("Held source needs refresh");
      captures.set(id, held);
      return held.evidence;
    } }, { maxAgeMs: Date.parse(at) - cutoff });
  return {
    artifacts,
    cost,
    get deferred() { return deferred; },
    fetchGeography: (async (url, options) => {
      takeRequest(url instanceof Request ? url.url : String(url));
      return fetch(url, options);
    }) satisfies typeof fetch,
    geographyCaptures,
    readGeography: async (url: string) => {
      const capture = await heldCapture(url);
      if (!capture) return null;
      if (!geographyCaptures.some(prior => prior.evidence.artifactId === capture.evidence.artifactId)) geographyCaptures.push(capture);
      return capture.evidence.text;
    },
    read: async (url: string): Promise<HeldSourcePage> => {
      await heldCapture(url);
      let page: Awaited<ReturnType<typeof read>>;
      try { page = await read(url); }
      catch (error) {
        // The shared toolkit can refuse before calling openBytes (including
        // its robots request). Preserve that bound as a deferral, too.
        if (error instanceof Error && error.message.includes("(the per-host bound)")) {
          deferred ??= new PlaceSourceDeferred(new URL(url).hostname);
        }
        throw deferred ?? error;
      }
      const capture = captures.get(page.artifactId);
      if (!capture) throw new Error("Saved source has no capture metadata");
      return { url: capture.evidence.canonicalUrl, baseUrl: page.url,
        text: capture.evidence.text, collectedAt: capture.observedAt, capture };
    },
    captureGeography: async (url: string, text: string) => {
      cost.bytesFetched += Buffer.byteLength(text);
      const { artifact } = recordAcquisition({ canonicalUrl: url, retrievedAt: tools.now(), httpStatus: 200,
        contentType: "application/json", sourceId: "census-tiger", methodRouteId: "census-tiger-query",
        workItemId: context.workItemId, attemptId: context.attemptId, permission: "ALLOWED", transport: "REACHABLE" }, text);
      await vault(artifact, text);
      const capture = captures.get(artifact.id);
      if (!capture) throw new Error("Census source has no saved parseable capture");
      geographyCaptures.push(capture);
    },
  };
}
