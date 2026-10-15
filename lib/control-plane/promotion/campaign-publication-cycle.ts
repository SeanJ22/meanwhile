/** `retrievedAt` is recorded only after the complete publisher body is received and its byte hash verified. */
import { createHash } from "node:crypto";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { Attempt } from "../attempt.ts";
import type { VaultIndex } from "../evidence/read-only-vault.ts";
import { readPipelineStatesWhere } from "./pipeline.ts";
import { CANDIDATE_PUBLICATION_READ_ROUTE, campaignSiteReadRecorder } from "./campaign-site-reads.ts";
import { candidatePublicationLinks, candidatePublicationCaptureUrls, candidatePublicationCaptureIssue,
  heldCandidatePublicationRead } from "./campaign-publication-links.ts";
import { readByIds, withinWallTime } from "./campaign-site-cycle.ts";
import { CAMPAIGN_SITE_FIELD, type CampaignSiteApprovedRecord } from "./campaign-site-chain.ts";
import { memoryInProcess, researchFetch, type ResearchGet, type ResearchRuntime } from "../../hunt/robots-first-fetch.ts";

export const CANDIDATE_PUBLICATION_MAX_READS = 2;
export const CANDIDATE_PUBLICATION_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
/** Newest captures read per source URL; a page is re-read at most weekly, so this spans about two years of captures. */
export const CANDIDATE_PUBLICATION_CAPTURES_PER_URL = 100;
/** Per-key reads in flight at once while the pass loads its scope. */
export const CANDIDATE_PUBLICATION_READ_CONCURRENCY = 8;

export interface CandidatePublicationCycleReport {
  readonly inventoried: number;
  readonly due: number;
  readonly acquired: number;
  readonly deferred: number;
  readonly failed: number;
  readonly outcomes: readonly { readonly candidacyId: string; readonly url: string; readonly code: string; readonly artifactId: string | null }[];
  /** The loading step the round's dispatch cutoff stopped, when it stopped one: every page of the pass then stays owed. */
  readonly stoppedLoading?: string;
}

/** Null when it stopped before the end. */
async function inBatches<T, R>(items: readonly T[], stop: () => boolean, run: (item: T) => Promise<R>): Promise<R[] | null> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += CANDIDATE_PUBLICATION_READ_CONCURRENCY) {
    if (stop()) return null;
    out.push(...await Promise.all(items.slice(at, at + CANDIDATE_PUBLICATION_READ_CONCURRENCY).map(run)));
  }
  return out;
}

/** Only the original instruction's candidacies may acquire deeper pages; other approved sites get no new work from this pass. */
export async function runCandidatePublicationCycle(input: {
  readonly repos: ControlPlaneRepositories;
  readonly eligibleCandidacyIds: ReadonlySet<string>;
  readonly heldVault: VaultIndex;
  readonly vaultRoot: string;
  readonly methodVersion: number;
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly openFor: (candidacyId: string) => ResearchGet;
  readonly spaceOut?: (host: string) => Promise<void>;
  readonly maxReads?: number;
  /** Replay may compress the clock; production keeps the seven-day default. */
  readonly recheckMs?: number;
  /** The round's dispatch cutoff: no page read starts after it, and an unread page stays owed. */
  readonly deadlineMs?: number;
}): Promise<CandidatePublicationCycleReport> {
  const empty = { inventoried: 0, due: 0, acquired: 0, deferred: 0, failed: 0, outcomes: [] } as const;
  if (!input.eligibleCandidacyIds.size) return empty;
  const recheckMs = input.recheckMs ?? CANDIDATE_PUBLICATION_RECHECK_MS;
  if (!Number.isFinite(recheckMs) || recheckMs < 0) throw new Error("CANDIDATE_PUBLICATION_RECHECK_INVALID");
  const recorder = campaignSiteReadRecorder({ repos: input.repos, vaultRoot: input.vaultRoot,
    methodVersion: input.methodVersion, now: () => new Date(input.clock()).toISOString(), heldVault: input.heldVault });
  /* Rows read scale with the eligible candidacies, never with whole tables. */
  const stop = () => input.deadlineMs !== undefined && input.clock() >= input.deadlineMs;
  const stopped = (step: string): CandidatePublicationCycleReport => ({ ...empty, stoppedLoading: step });
  if (stop()) return stopped("the approved campaign sites");
  const states = await readPipelineStatesWhere(input.repos, [{ path: ["campaignSite", "field"], value: CAMPAIGN_SITE_FIELD }]);
  const sourceReads = new Map<string, Awaited<ReturnType<NonNullable<ControlPlaneRepositories["artifactsByCanonicalUrl"]>>>>();
  const sourceRecords = async (url: string) => {
    const cached = sourceReads.get(url);
    if (cached) return cached;
    if (!input.repos.artifactsByCanonicalUrl) throw new Error("The repository cannot read captures by their exact source URL");
    const rows = await input.repos.artifactsByCanonicalUrl(url, CANDIDATE_PUBLICATION_CAPTURES_PER_URL);
    sourceReads.set(url, rows);
    return rows;
  };
  const approvals = states.flatMap(state => {
    const row = state.byStage.APPROVED_FOR_PROMOTION;
    return row && "campaignSite" in row && input.eligibleCandidacyIds.has(state.subjectId ?? "")
      ? [row as CampaignSiteApprovedRecord] : [];
  });
  const hosts = new Map<string, Set<string>>();
  for (const approval of approvals) {
    const site = approval.campaignSite;
    const found = hosts.get(site.candidacyId) ?? new Set<string>();
    found.add(site.host); hosts.set(site.candidacyId, found);
  }
  /* Only a candidacy with exactly one approved host inventories links, so only its history orders them. */
  const readable = [...hosts].filter(([, found]) => found.size === 1).map(([candidacyId]) => candidacyId).sort();
  const workRows = await inBatches(readable, stop, id => input.repos.workItems.listWhere(["subject"], `candidate-publication:${id}`));
  if (workRows === null) return stopped("the candidacies' publication work items");
  const workSubjects = new Map(workRows.flat().map(row => [row.id, row.value.subject]));
  const routeRows = await inBatches([...workSubjects.keys()], stop, id => input.repos.routeTasks.listWhere(["workItemId"], id));
  if (routeRows === null) return stopped("the publication route tasks");
  const tasks = routeRows.flat().map(row => row.value)
    .filter(task => task.routeId.startsWith(`${CANDIDATE_PUBLICATION_READ_ROUTE}:`) && task.attemptIds.length > 0);
  if (stop()) return stopped("the publication Attempts");
  const attempts = new Map<string, Attempt>(await readByIds(input.repos.attempts, tasks.flatMap(task => task.attemptIds)));
  const lastAttemptByLink = new Map<string, number>();
  for (const task of tasks) {
    const subject = workSubjects.get(task.workItemId);
    if (!subject?.startsWith("candidate-publication:")) continue;
    const key = `${subject.slice("candidate-publication:".length)}\u0000${task.target}`;
    for (const attemptId of task.attemptIds) {
      const attempted = Date.parse(attempts.get(attemptId)?.startedAt ?? "");
      if (Number.isFinite(attempted)) lastAttemptByLink.set(key, Math.max(lastAttemptByLink.get(key) ?? -Infinity, attempted));
    }
  }
  const inventory = new Map<string, ReturnType<typeof candidatePublicationLinks>[number]>();
  const parentHtml = new Map<string, string>();
  const outcomes: CandidatePublicationCycleReport["outcomes"][number][] = [];
  for (const approval of approvals) {
    const site = approval.campaignSite;
    if ((hosts.get(site.candidacyId)?.size ?? 0) !== 1) continue;
    const source = (await sourceRecords(site.evidence.requestedUrl)).find(row => row.artifactId === site.evidence.artifactId);
    if (!source || source.partial || source.contentHash !== `sha256-${site.evidence.sha256}` ||
      source.attemptId !== site.evidence.attemptId || source.canonicalUrl !== site.evidence.requestedUrl) continue;
    let page;
    try { page = await recorder.heldPage(source); }
    catch { page = null; }
    if (!page || page.sha256 !== site.evidence.sha256 || page.finalUrl !== site.evidence.finalUrl ||
      page.httpStatus !== site.evidence.httpStatus) continue;
    parentHtml.set(source.artifactId, page.body);
    for (const link of candidatePublicationLinks({ html: page.body, sourceUrl: page.finalUrl,
      sourceArtifactId: source.artifactId, sourceContentHash: source.contentHash,
      approvalRecordId: approval.recordId, candidacyId: site.candidacyId })) {
      const key = `${site.candidacyId}\u0000${link.url}`;
      if (!inventory.has(key)) inventory.set(key, link);
    }
  }
  const now = input.clock();
  const captures: Awaited<ReturnType<typeof sourceRecords>>[number][] = [];
  for (const url of candidatePublicationCaptureUrls([...inventory.values()], input.heldVault)) {
    if (stop()) {
      /* The links are known: each one stays owed by name. */
      const owed = [...inventory.values()].map(link => ({ candidacyId: link.source.candidacyId, url: link.url, code: "NOT_READ_DEADLINE", artifactId: null }));
      return { ...stopped("the held captures of linked pages"), inventoried: inventory.size, due: owed.length, deferred: owed.length, outcomes: [...outcomes, ...owed] };
    }
    captures.push(...await sourceRecords(url));
  }
  for (const [id, attempt] of await readByIds(input.repos.attempts, captures.map(row => row.attemptId).filter(id => !attempts.has(id)))) attempts.set(id, attempt);
  for (const [id, item] of await readByIds(input.repos.workItems, captures.map(row => row.workItemId).filter(id => !workSubjects.has(id)))) workSubjects.set(id, item.subject);
  const due = [] as ReturnType<typeof candidatePublicationLinks>;
  for (const link of inventory.values()) {
    let reused = false;
    for (const row of captures) {
      const saved = input.heldVault.byId.get(row.artifactId);
      if (row.canonicalUrl !== link.url && saved?.retrievalUrl !== link.url) continue;
      const attempt = attempts.get(row.attemptId);
      if (!attempt) continue;
      try {
        const capture = await heldCandidatePublicationRead(row, attempt, input.heldVault, workSubjects.get(row.workItemId));
        const issue = capture ? candidatePublicationCaptureIssue(link, parentHtml.get(link.source.sourceArtifactId) ?? "", capture)
          : "the original complete HTML bytes are not held";
        if (issue !== null) {
          outcomes.push({ candidacyId: link.source.candidacyId, url: link.url, code: `LINKED_PUBLICATION_UNVERIFIED:${issue}`, artifactId: row.artifactId });
        } else if (Date.parse(capture!.vaultRetrievedAt!) > now - recheckMs) {
          reused = true;
          outcomes.push({ candidacyId: link.source.candidacyId, url: link.url, code: "HELD_REUSED", artifactId: row.artifactId });
          break;
        }
      } catch (error) {
        outcomes.push({ candidacyId: link.source.candidacyId, url: link.url,
          code: `LINKED_PUBLICATION_UNVERIFIED:${error instanceof Error ? error.message : String(error)}`, artifactId: row.artifactId });
      }
    }
    if (!reused) due.push(link);
  }
  due.sort((a, b) => {
    const aKey = `${a.source.candidacyId}\u0000${a.url}`, bKey = `${b.source.candidacyId}\u0000${b.url}`;
    return (lastAttemptByLink.get(aKey) ?? -Infinity) - (lastAttemptByLink.get(bKey) ?? -Infinity) || aKey.localeCompare(bKey);
  });
  let acquired = 0, failed = 0, deferred = 0;
  const limit = input.maxReads ?? CANDIDATE_PUBLICATION_MAX_READS;
  let readsUsed = 0;
  for (const link of due) {
    if (readsUsed >= limit) {
      deferred += 1; outcomes.push({ candidacyId: link.source.candidacyId, url: link.url, code: "NOT_READ_BOUNDED", artifactId: null });
      continue;
    }
    if (input.deadlineMs !== undefined && input.clock() >= input.deadlineMs) {
      deferred += 1; outcomes.push({ candidacyId: link.source.candidacyId, url: link.url, code: "NOT_READ_DEADLINE", artifactId: null });
      continue;
    }
    readsUsed += 1;
    const get = input.openFor(link.source.candidacyId);
    const runtime: ResearchRuntime = { memory: memoryInProcess(), now: input.clock,
      sleep: input.sleep, spacingMs: 0, timeoutMs: 10_000, get: async request => {
        const host = new URL(request.url).host.toLowerCase();
        if (input.spaceOut) await input.spaceOut(host);
        const timeoutMs = Math.max(1, Math.min(request.timeoutMs, 10_000));
        const response = await withinWallTime(get({ ...request, timeoutMs }), timeoutMs);
        return response.done ? response.value : { status: null, body: new Uint8Array(0), contentType: "",
          location: null, transportError: "CANDIDATE_PUBLICATION_REQUEST_TIMED_OUT" };
      } };
    try {
      const fetched = await researchFetch(link.url, runtime);
      if (fetched.outcome !== "FETCHED" || fetched.accessControl || !fetched.status || fetched.status < 200 || fetched.status >= 300 ||
        !/html/i.test(fetched.contentType) || fetched.body.byteLength === 0 ||
        new URL(fetched.finalUrl).hostname !== new URL(link.source.sourceUrl).hostname) {
        if (fetched.outcome === "REFUSED") await recorder.recordPublicationAbort(link.source.candidacyId, link,
          "ABORTED", fetched.reason);
        else if (fetched.status !== null && fetched.status >= 200) await recorder.recordPublicationBlock(link.source.candidacyId,
          link, fetched.status, fetched.accessControl ? "the response is access controlled" :
            "that route did not deliver a usable same-host HTML page in this read");
        else await recorder.recordPublicationAbort(link.source.candidacyId, link, "ABORTED", "the route supplied no usable HTTP response");
        failed += 1; outcomes.push({ candidacyId: link.source.candidacyId, url: link.url,
          code: fetched.outcome === "REFUSED" ? `REFUSED:${fetched.reason}` : fetched.accessControl ? "ACCESS_CONTROLLED" : "UNUSABLE_RESPONSE", artifactId: null });
        continue;
      }
      const body = new TextDecoder("utf-8", { fatal: true }).decode(fetched.body);
      const sha256 = createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
      if (sha256 !== fetched.sha256) throw new Error("CAPTURE_BYTES_CHANGED_ON_DECODE");
      const record = await recorder.recordPublicationRead(link.source.candidacyId, link, {
        requestedUrl: link.url, finalUrl: fetched.finalUrl, httpStatus: fetched.status,
        contentType: fetched.contentType, body, sha256, retrievedAt: new Date(input.clock()).toISOString(),
        permissions: fetched.permissions, redirects: fetched.redirects });
      acquired += 1; outcomes.push({ candidacyId: link.source.candidacyId, url: link.url, code: "ACQUIRED", artifactId: record.artifactId });
    } catch (error) {
      failed += 1; outcomes.push({ candidacyId: link.source.candidacyId, url: link.url,
        code: `FAILED:${error instanceof Error ? error.message : String(error)}`, artifactId: null });
    }
  }
  return { inventoried: inventory.size, due: due.length, acquired, deferred, failed, outcomes };
}
