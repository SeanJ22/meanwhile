import { createHash } from "node:crypto";
import { acquireKnownRelease, type KnownReleaseOptions } from "../sources/known-release.ts";
import { readCompleteResponse } from "../sources/source-bytes.ts";
import { sourceAcquisitionSleep } from "../sources/acquisition-deadline.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { RepositoryLockHeld, type ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { admitWebsiteRequest, holdWebsiteAfter, websiteOf } from "../control-plane/website-pacing.ts";
import { PER_HOST_SPACING_MS } from "../control-plane/scheduler/http-executor.ts";
import { websiteRequestLimit, type WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import { createPortraitRuntime, storeVerifiedPortrait } from "./store.ts";
import type { PortraitSources } from "./evidence.ts";

let repositories: ReturnType<typeof createPgRepositories> | undefined;
function sharedRepositories() {
  return repositories ??= (async () => {
    const connection = controlPlaneUrlFromEnv();
    if (!connection) throw Error("PORTRAIT_CONTROL_PLANE_UNAVAILABLE");
    return createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
  })().catch(error => { repositories = undefined; throw error; });
}

/** Standing source readers share the fleet's website holds; the host lock covers the body,
 * so portrait children never multiply requests to one publisher. */
interface PortraitPacingRuntime {
  readonly repositories?: () => Promise<Pick<ControlPlaneRepositories,"locks"|"websitePacing">>;
  readonly clock?: () => number;
  readonly sleep?: typeof sourceAcquisitionSleep;
  readonly sizeFor?: WebsiteSizeForUrl;
}
export async function pacedPortraitAcquire(options: KnownReleaseOptions, runtime:PortraitPacingRuntime = {}) {
  const clock=runtime.clock ?? Date.now,sleep=runtime.sleep ?? sourceAcquisitionSleep;
  return acquireKnownRelease({ ...options, fetchImpl: async (resource, init) => {
    const repos = await (runtime.repositories ?? sharedRepositories)();
    const url = String(resource), site = websiteOf(url);
    const lock = `publisher-host:${createHash("sha256").update(site).digest("hex")}`;
    for (;;) {
      options.signal.throwIfAborted();
      try {
        return await repos.locks.withLock(lock, async () => {
          const admitted = await admitWebsiteRequest(repos.websitePacing, url, websiteRequestLimit(runtime.sizeFor?.(url)), clock());
          if (!admitted.ok) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED",`PORTRAIT_WEBSITE_WAIT:${new Date(admitted.until).toISOString()}:${admitted.why}`);
          await sleep(PER_HOST_SPACING_MS, options.signal);
          const response = await (options.fetchImpl ?? fetch)(resource, init);
          await holdWebsiteAfter(repos.websitePacing, url, response.status, response.headers.get("retry-after"), clock());
          const bytes = response.status === 304 ? null : await readCompleteResponse(response, options.maxBytes);
          const saved = new Response(bytes === null ? null : new Uint8Array(bytes).buffer, { status: response.status, statusText: response.statusText, headers: response.headers });
          Object.defineProperty(saved, "url", { value: response.url || url });
          return saved;
        });
      } catch (error) {
        if (!(error instanceof RepositoryLockHeld) || error.lockName !== lock) throw error;
        await sleep(250, options.signal);
      }
    }
  } });
}

/** Image reads share the profile reader's host pacing and existing image checks. */
export async function storeStandingPortrait(personId: string, sources: PortraitSources, at: string, signal: AbortSignal, pacing?:PortraitPacingRuntime) {
  return storeVerifiedPortrait(personId,sources,at,createPortraitRuntime(request=>pacedPortraitAcquire(request,pacing)),"officials",signal);
}

export type PortraitAttempt = NonNullable<import("../civic-data/types.ts").RoutineCandidate["excludedFacts"]>[number];
export interface StandingPortraitOptions {
  readonly signal?: AbortSignal;
  readonly now?: () => string;
  readonly acquire?: typeof acquireKnownRelease;
  readonly storePortrait?: typeof storeStandingPortrait;
  readonly previousExcludedFacts?: readonly PortraitAttempt[];
  /** Saved official pages that endorse a government publisher on another domain. */
  readonly linkingCaptures?: readonly import("./evidence.ts").PortraitCapture[];
  /** Called after each accepted photo or recorded reason, before another pass. */
  readonly onPerson?: (person: import("../officials/types.ts").Officeholder, facts: readonly PortraitAttempt[]) => Promise<void>;
}
