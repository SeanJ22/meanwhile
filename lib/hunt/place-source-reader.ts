import { savedPageReader, realOpenBytes } from "../control-plane/scheduler/scout-tools.ts";
import type { ArtifactProvenance, ScoutToolContext } from "../control-plane/scheduler/scout-contract.ts";
import { durableResearchTools, type ResearchRuntimeTools } from "../control-plane/workers/durable-research-tools.ts";
import { researchVaultResolver } from "../control-plane/workers/vault-object.ts";
import { evidenceProjection } from "../control-plane/workers/evidence-projection.ts";
import { recordAcquisition, type Artifact } from "../control-plane/evidence/artifact.ts";
import { readForParser } from "../control-plane/evidence/store.ts";
import type { WorkArtifact } from "../control-plane/scheduler/dispatch.ts";
import { scheduleObligation } from "../control-plane/scheduler/obligation.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { HeldSourcePage } from "../sources/plural/place.ts";
import { readPlaceArtifacts } from "../control-plane/repository/pg-store.ts";
import { websiteRequestLimit, type WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";

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
  context: Omit<ScoutToolContext, "vault" | "spaceOut" | "handed">;
  project: string;
  websiteSize?: WebsiteSizeForUrl;
}) {
  const { tools, context, project } = input;
  const artifacts = new Map<string, WorkArtifact>();
  const captures = new Map<string, WorkerPublicationCapture>();
  const geographyCaptures: WorkerPublicationCapture[] = [];
  const cost = { requestCount: 0, bytesFetched: 0 };
  const requests = new Map<string, number>();
  let deferred: PlaceSourceDeferred | null = null;
  const takeRequest = (url: string) => {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const limit = websiteRequestLimit(input.websiteSize?.(url));
    const count = requests.get(host) ?? 0;
    if (limit !== null && count >= limit) {
      const stopped = new PlaceSourceDeferred(host);
      deferred ??= stopped;
      throw stopped;
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
  const provenance: ArtifactProvenance[] = [];
  const inheritedIds: string[] = [];
  const inherited = new Map<string, WorkerPublicationCapture>();
  const resolvedUrls = new Map<string, Promise<WorkerPublicationCapture | null>>();
  const resolveHeldCapture = async (url: string) => {
    const current = [...captures.values()].find(capture => capture.evidence.canonicalUrl === url);
    if (current) return current;
    // Keep this URL's fresh observations in newest-first order. A content
    // ID can have many observations; resolve it only once in this pass.
    const candidates = [...await readPlaceArtifacts(tools.repos, url, new Date(cutoff).toISOString(), at)]
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const heldRepos = { ...tools.repos, artifacts: { ...tools.repos.artifacts, readAll: async () => candidates } };
    const readObject = researchVaultResolver(heldRepos, tools.store, project, { snapshot: true });
    const tried = new Set<string>();
    for (const row of candidates) {
      if (tried.has(row.artifactId)) continue;
      tried.add(row.artifactId);
      try {
        const { artifact } = await readObject(row.artifactId);
        if (artifact.httpStatus !== 200 || artifact.retentionPolicy === "DIAGNOSTIC" || Date.parse(artifact.retrievedAt) < cutoff) continue;
        const parsed = await readForParser(tools.store, project, artifact);
        const capture = { evidence: evidenceProjection(parsed.input), observedAt: artifact.retrievedAt,
          httpStatus: artifact.httpStatus, transport: artifact.transport, partial: false };
        inherited.set(row.artifactId, capture);
        inheritedIds.push(row.artifactId);
        captures.set(row.artifactId, capture);
        provenance.push({ artifactId: row.artifactId, canonicalUrl: artifact.canonicalUrl,
          retrievedAt: artifact.retrievedAt, httpStatus: artifact.httpStatus,
          permission: artifact.permission, methodRouteId: artifact.methodRouteId,
          contentType: artifact.contentType, retrievalUrl: artifact.retrievalUrl });
        return capture;
      } catch { /* Unreadable held bytes leave acquisition owed. */ }
    }
    return null;
  };
  const heldCapture = (url: string): Promise<WorkerPublicationCapture | null> => {
    const current = [...captures.values()].find(capture => capture.evidence.canonicalUrl === url);
    if (current) return Promise.resolve(current);
    // Parallel district-layer lookups must await the same held response. A
    // seen-URL flag let siblings fall through to the network before it resolved.
    if (!resolvedUrls.has(url)) resolvedUrls.set(url, resolveHeldCapture(url));
    return resolvedUrls.get(url)!;
  };
  const read = savedPageReader({ ...context, ...durable, vault,
    // The size-qualified counter below owns this limit. Unknown, larger,
    // state, federal and national sources have no website-walk count.
    bound: { ...context.bound, maxRequestsPerHost: Number.MAX_SAFE_INTEGER },
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
    handed: { artifactIds: inheritedIds, provenance },
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
      const address = url instanceof Request ? url.url : String(url);
      takeRequest(address);
      await tools.spaceOut(new URL(address).hostname);
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
          const stopped = new PlaceSourceDeferred(new URL(url).hostname);
          deferred ??= stopped;
          throw stopped;
        }
        throw error;
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
