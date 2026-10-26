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
type PortraitPerson = import("../officials/types.ts").Officeholder;

const DAY_MS = 86_400_000;
/** A person whose portrait could not be found is tried again after a week. */
export const PORTRAIT_RETRY_MS = 7 * DAY_MS;
/** A run takes everyone falling due within a day, so a state's retries come together. */
export const PORTRAIT_DUE_WINDOW_MS = DAY_MS;

/** The links an attempt read for this person; a change makes the person due again at once. */
export function portraitProfileLinks(person: PortraitPerson): readonly string[] {
  return [...new Set([person.websiteUrl, ...(person.profileUrls ?? []), person.portraitCandidate?.sourceUrl, person.portraitCandidate?.imageUrl]
    .filter((url): url is string => Boolean(url)))].sort();
}

/** When this person's portrait work is next due. A portrait readers are shown is never read again;
 * a person without one is due now, or a week after an attempt that found none, or at once when their links change. */
export function portraitDueAt(person: PortraitPerson, lastAttempt: PortraitAttempt | undefined,
  verified: (person: PortraitPerson) => boolean): number {
  if (verified(person)) return Number.POSITIVE_INFINITY;
  const record = lastAttempt?.record as { attemptedAt?: string; profiles?: readonly string[]; interrupted?: boolean } | undefined;
  const attemptedAt = Date.parse(record?.attemptedAt ?? "");
  if (record?.interrupted || !Number.isFinite(attemptedAt)) return 0;
  if (!record?.profiles || record.profiles.join("\n") !== portraitProfileLinks(person).join("\n")) return 0;
  return attemptedAt + PORTRAIT_RETRY_MS;
}

/** Each person's latest attempt with this code prefix. */
export function latestPortraitAttempts(facts: readonly PortraitAttempt[], prefix: string): Map<string, PortraitAttempt> {
  const latest = new Map<string, PortraitAttempt>();
  for (const fact of facts) {
    const record = fact.record as { personId?: unknown; attemptedAt?: unknown } | undefined;
    if (!fact.code.startsWith(prefix) || typeof record?.personId !== "string" || typeof record.attemptedAt !== "string" ||
      !Number.isFinite(Date.parse(record.attemptedAt))) continue;
    const held = (latest.get(record.personId)?.record as { attemptedAt?: string } | undefined)?.attemptedAt ?? "";
    if (record.attemptedAt > held) latest.set(record.personId, fact);
  }
  return latest;
}
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
