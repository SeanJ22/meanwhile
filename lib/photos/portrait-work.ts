import { acquireKnownRelease, type KnownReleaseOptions } from "../sources/known-release.ts";
import { runWithSourceFetch } from "../sources/fetch-source.ts";
import type { WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import { createPortraitRuntime, storeVerifiedPortrait } from "./store.ts";
import type { PortraitSources } from "./evidence.ts";

interface PortraitPacingRuntime {
  readonly sizeFor?: WebsiteSizeForUrl;
}

export async function pacedPortraitAcquire(options: KnownReleaseOptions, runtime: PortraitPacingRuntime = {}) {
  return runWithSourceFetch({ sourceId: options.sourceId, websiteSize: runtime.sizeFor }, () => acquireKnownRelease(options));
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
