import { createHash } from "node:crypto";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { VaultIndex } from "../evidence/read-only-vault.ts";
import { readPipelineStates } from "./pipeline.ts";
import { CANDIDATE_PUBLICATION_READ_ROUTE, campaignSiteReadRecorder } from "./campaign-site-reads.ts";
import { candidatePublicationLinks } from "./campaign-publication-links.ts";
import { withinWallTime } from "./campaign-site-cycle.ts";
import type { CampaignSiteApprovedRecord } from "./campaign-site-chain.ts";
import { memoryInProcess, researchFetch, type ResearchGet, type ResearchRuntime } from "../../hunt/robots-first-fetch.ts";

export const CANDIDATE_PUBLICATION_MAX_READS = 2;
export const CANDIDATE_PUBLICATION_BUDGET_MS = 30_000;
export const CANDIDATE_PUBLICATION_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

export interface CandidatePublicationCycleReport {
  readonly inventoried: number;
  readonly due: number;
  readonly acquired: number;
  readonly deferred: number;
  readonly failed: number;
  readonly outcomes: readonly { readonly candidacyId: string; readonly url: string; readonly code: string; readonly artifactId: string | null }[];
}

/** The original instruction controls which canonical candidacies may acquire
 * deeper pages. Every other approved site remains available to the existing
 * campaign-link routine but receives no new work from this pass. */
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
  readonly budgetMs?: number;
}): Promise<CandidatePublicationCycleReport> {
  const empty = { inventoried: 0, due: 0, acquired: 0, deferred: 0, failed: 0, outcomes: [] } as const;
  if (!input.eligibleCandidacyIds.size) return empty;
  const deadline = input.clock() + (input.budgetMs ?? CANDIDATE_PUBLICATION_BUDGET_MS);
  const recorder = campaignSiteReadRecorder({ repos: input.repos, vaultRoot: input.vaultRoot,
    methodVersion: input.methodVersion, now: () => new Date(input.clock()).toISOString(), heldVault: input.heldVault });
  const inventoryRead = await withinWallTime(Promise.all([readPipelineStates(input.repos), input.repos.artifacts.readAll(),
    input.repos.attempts.list(), input.repos.routeTasks.list(), input.repos.workItems.list()]), deadline - input.clock());
  if (!inventoryRead.done) throw new Error("CANDIDATE_PUBLICATION_INVENTORY_TIMEOUT");
  const [states, artifacts, attemptRows, routeRows, workRows] = inventoryRead.value;
  const byId = new Map(artifacts.map(row => [row.artifactId, row]));
  const attempts = new Map(attemptRows.map(row => [row.id, row.value]));
  const workSubjects = new Map(workRows.map(row => [row.id, row.value.subject]));
  const lastAttemptByLink = new Map<string, number>();
  for (const row of routeRows) {
    const task = row.value;
    if (!task.routeId.startsWith(`${CANDIDATE_PUBLICATION_READ_ROUTE}:`) || task.attemptIds.length === 0) continue;
    const subject = workSubjects.get(task.workItemId);
    if (!subject?.startsWith("candidate-publication:")) continue;
    const key = `${subject.slice("candidate-publication:".length)}\u0000${task.target}`;
    for (const attemptId of task.attemptIds) {
      const attempted = Date.parse(attempts.get(attemptId)?.startedAt ?? "");
      if (Number.isFinite(attempted)) lastAttemptByLink.set(key, Math.max(lastAttemptByLink.get(key) ?? -Infinity, attempted));
    }
  }
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
  const inventory = new Map<string, ReturnType<typeof candidatePublicationLinks>[number]>();
  const outcomes: CandidatePublicationCycleReport["outcomes"][number][] = [];
  for (const approval of approvals) {
    const site = approval.campaignSite;
    if ((hosts.get(site.candidacyId)?.size ?? 0) !== 1) continue;
    const source = byId.get(site.evidence.artifactId);
    if (!source || source.partial || source.contentHash !== `sha256-${site.evidence.sha256}` ||
      source.attemptId !== site.evidence.attemptId || source.canonicalUrl !== site.evidence.requestedUrl) continue;
    let page;
    try { const read = await withinWallTime(recorder.heldPage(source), deadline - input.clock()); page = read.done ? read.value : null; }
    catch { page = null; }
    if (!page || page.sha256 !== site.evidence.sha256 || page.finalUrl !== site.evidence.finalUrl ||
      page.httpStatus !== site.evidence.httpStatus) continue;
    for (const link of candidatePublicationLinks({ html: page.body, sourceUrl: page.finalUrl,
      sourceArtifactId: source.artifactId, sourceContentHash: source.contentHash,
      approvalRecordId: approval.recordId, candidacyId: site.candidacyId })) {
      const key = `${site.candidacyId}\u0000${link.url}`;
      if (!inventory.has(key)) inventory.set(key, link);
    }
  }
  const now = input.clock();
  const due = [...inventory.values()].filter(link => !artifacts.some(row => {
    const held = input.heldVault.byId.get(row.artifactId), attempt = attempts.get(row.attemptId);
    return row.publicationLink?.candidacyId === link.source.candidacyId &&
      row.publicationLink.approvalRecordId === link.source.approvalRecordId &&
      row.publicationLink.sourceArtifactId === link.source.sourceArtifactId &&
      row.canonicalUrl === link.url && !row.partial &&
      held !== undefined && held.contentHash === row.contentHash && held.workItemId === row.workItemId &&
      attempt?.outcome === "COMPLETED" && attempt.artifactIds.includes(row.artifactId) &&
      Date.parse(row.recordedAt) > now - CANDIDATE_PUBLICATION_RECHECK_MS;
  })).sort((a, b) => {
    const aKey = `${a.source.candidacyId}\u0000${a.url}`, bKey = `${b.source.candidacyId}\u0000${b.url}`;
    return (lastAttemptByLink.get(aKey) ?? -Infinity) - (lastAttemptByLink.get(bKey) ?? -Infinity) || aKey.localeCompare(bKey);
  });
  let acquired = 0, failed = 0, deferred = 0;
  const limit = input.maxReads ?? CANDIDATE_PUBLICATION_MAX_READS;
  let readsUsed = 0;
  for (const link of due) {
    if (readsUsed >= limit || input.clock() >= deadline) {
      deferred += 1; outcomes.push({ candidacyId: link.source.candidacyId, url: link.url, code: "NOT_READ_BOUNDED", artifactId: null });
      continue;
    }
    readsUsed += 1;
    const remaining = deadline - input.clock();
    const get = input.openFor(link.source.candidacyId);
    const runtime: ResearchRuntime = { memory: memoryInProcess(), now: input.clock,
      sleep: ms => input.sleep(Math.max(0, Math.min(ms, deadline - input.clock()))), spacingMs: 0,
      timeoutMs: Math.max(1, Math.min(10_000, remaining)), get: async request => {
        const host = new URL(request.url).host.toLowerCase();
        if (input.spaceOut) await input.spaceOut(host);
        return get({ ...request, timeoutMs: Math.max(1, Math.min(request.timeoutMs, deadline - input.clock())) });
      } };
    try {
      const timed = await withinWallTime(researchFetch(link.url, runtime), deadline - input.clock());
      if (!timed.done) {
        await recorder.recordPublicationAbort(link.source.candidacyId, link, "TIMED_OUT", "the bounded robots-first read exceeded this slice");
        deferred += 1; outcomes.push({ candidacyId: link.source.candidacyId, url: link.url, code: "NOT_READ_TIMEOUT", artifactId: null });
        continue;
      }
      const fetched = timed.value;
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
