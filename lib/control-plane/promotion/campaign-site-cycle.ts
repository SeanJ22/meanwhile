import { readHeldBytes, type HeldVaultArtifact, type VaultIndex } from "../evidence/read-only-vault.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import {
  candidateEnrichmentUniversesFromHoldings,
  type CandidateEnrichmentAuthorityHoldings,
} from "../scheduler/providers/candidate-enrichment.ts";
import {
  MARGINALIA_ROUTE_ID,
  normalizeMarginaliaSearch,
  projectCampaignSiteChains,
  type CampaignSiteChainReport,
  type CampaignSiteSubject,
  type HeldMarginaliaResponse,
  type LeadReadResult,
} from "./campaign-site-chain.ts";
import { campaignSiteReadRecorder } from "./campaign-site-reads.ts";
import { campaignSiteSubjects, type FilingChannels } from "../../candidates/campaign-site-subjects.ts";
import { readCampaignSiteLead } from "../../candidates/campaign-site-verifier.ts";
import { memoryInProcess, type ResearchGet, type ResearchRuntime } from "../../hunt/robots-first-fetch.ts";

export const CAMPAIGN_SITE_MAX_READS = 12;
export const CAMPAIGN_SITE_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
export const CAMPAIGN_SITE_REQUEST_TIMEOUT_MS = 10_000;
const REQUEST_TIMED_OUT = "CAMPAIGN_SITE_REQUEST_TIMED_OUT";

/** `work`, or nothing once `ms` pass on a real timer; the timer is cleared and a late rejection is swallowed. */
export async function withinWallTime<T>(work: Promise<T>, ms: number): Promise<{ readonly done: true; readonly value: T } | { readonly done: false }> {
  work.catch(() => undefined);
  if (!(ms > 0)) return { done: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<{ readonly done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  try {
    return await Promise.race([work.then((value) => ({ done: true as const, value })), stop]);
  } finally {
    clearTimeout(timer);
  }
}

export interface CampaignSiteCycleInput {
  readonly repos: ControlPlaneRepositories;
  readonly subjects: ReadonlyMap<string, CampaignSiteSubject>;
  /** Candidacies whose promoted profile already carries a campaign link: their leads are read after every other candidacy's. */
  readonly linkedCandidacies?: ReadonlySet<string>;
  readonly marginalia: readonly HeldMarginaliaResponse[];
  /** The cycle's instant: the chain's clock for freshness and the rotation's hour. */
  readonly now: string;
  /** Milliseconds, for freshness and elapsed-time reporting. */
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** One HTTP request that never follows a redirect: the cycle's guarded seam. */
  readonly open: ResearchGet;
  /** The cycle's shared per-host spacer, so this pass and every other lane space one host together. */
  readonly spaceOut?: (host: string) => Promise<void>;
  /** The runner's vault: new reads are vaulted here, and earlier reads read back from `heldVault`. */
  readonly vaultRoot: string;
  readonly heldVault: VaultIndex | null;
  readonly methodVersion: number;
  readonly maxReads?: number;
  readonly recheckAfterMs?: number;
  readonly startedAtMs?: number;
  /** The round's dispatch cutoff: no lead read starts after it, and an unread lead stays owed. */
  readonly deadlineMs?: number;
}

export interface CampaignSiteCycleReport {
  readonly chain: CampaignSiteChainReport;
  /** Lead verdicts this pass reached, by how: a read now, an earlier read's vaulted bytes, or none. */
  readonly verdicts: { readonly read: number; readonly vault: number; readonly verified: number; readonly refused: number; readonly deferred: number };
  readonly byCode: Readonly<Record<string, number>>;
  readonly elapsedMs: number;
}

/** Every lead read is robots-first; nothing here reaches a model, a paid index or a civic-data store. */
export async function runCampaignSiteCycle(input: CampaignSiteCycleInput): Promise<CampaignSiteCycleReport> {
  const started = input.startedAtMs ?? input.clock();
  let timeouts = 0;
  const runtime: ResearchRuntime = {
    get: async request => {
      let host = "";
      try { host = new URL(request.url).host.toLowerCase(); } catch { /* researchFetch validates the URL. */ }
      if (input.spaceOut !== undefined && host !== "") await input.spaceOut(host);
      const limit = Math.max(1, Math.min(request.timeoutMs, CAMPAIGN_SITE_REQUEST_TIMEOUT_MS));
      const got = await withinWallTime(input.open({ ...request, timeoutMs: limit }), limit);
      if (got.done) return got.value;
      timeouts++;
      return { status: null, body: new Uint8Array(0), contentType: "", location: null, transportError: REQUEST_TIMED_OUT };
    },
    memory: memoryInProcess(), now: input.clock, sleep: input.sleep,
    spacingMs: 0, timeoutMs: CAMPAIGN_SITE_REQUEST_TIMEOUT_MS,
  };
  const readLead = async (lead: Parameters<typeof readCampaignSiteLead>[0]): Promise<LeadReadResult> => {
    if (input.deadlineMs !== undefined && input.clock() >= input.deadlineMs) return { ok: false, refusal: { code: "NOT_READ",
      detail: `the round's dispatch time ended before ${lead.url} was read; the lead stays owed` } };
    const before = timeouts;
    const out = await readCampaignSiteLead(lead, runtime);
    if (out.ok) return { ok: true, read: out.read };
    if (timeouts > before) return { ok: false, refusal: { code: "NOT_READ",
      detail: `a request for ${lead.url} did not answer within ${CAMPAIGN_SITE_REQUEST_TIMEOUT_MS / 1000}s; the lead was not read and stays owed` } };
    return { ok: false, refusal: out.refusal };
  };
  const recorder = campaignSiteReadRecorder({
    repos: input.repos,
    vaultRoot: input.vaultRoot,
    methodVersion: input.methodVersion,
    now: () => new Date(input.clock()).toISOString(),
    heldVault: input.heldVault,
  });
  const chain = await projectCampaignSiteChains(input.repos, {
      subjects: input.subjects,
      linkedCandidacies: input.linkedCandidacies,
      marginalia: input.marginalia,
      readLead,
      recordRead: recorder.recordRead,
      heldPage: recorder.heldPage,
      now: input.now,
      maxReads: input.maxReads ?? CAMPAIGN_SITE_MAX_READS,
      recheckAfterMs: input.recheckAfterMs ?? CAMPAIGN_SITE_RECHECK_MS,
      /* The hour: one rotation per hourly cycle, the same order within it. */
      rotation: input.now.slice(0, 13),
  });
  const byCode: Record<string, number> = {};
  let read = 0;
  let vault = 0;
  let verified = 0;
  let refused = 0;
  let deferred = 0;
  for (const lead of chain.leads) {
    if (lead.via === "READ") read += 1;
    if (lead.via === "VAULT") vault += 1;
    if (lead.outcome === "VERIFIED") verified += 1;
    else if (lead.outcome === "REFUSED") refused += 1;
    else deferred += 1;
    for (const refusal of lead.refusals) byCode[refusal.code] = (byCode[refusal.code] ?? 0) + 1;
  }
  return { chain, verdicts: { read, vault, verified, refused, deferred }, byCode, elapsedMs: input.clock() - started };
}

export function campaignSiteCycleLine(report: CampaignSiteCycleReport): string {
  const { chain, verdicts } = report;
  const codes = Object.entries(report.byCode).sort(([a], [b]) => a.localeCompare(b)).map(([code, n]) => `${code} ${n}`).join(", ");
  return `  campaign sites     ${chain.readsUsed} read(s), ${verdicts.vault} judged from vaulted reads, ` +
    `${verdicts.verified} lead(s) verified · items ${Object.entries(chain.byStage).map(([stage, n]) => `${stage} ${n}`).join(", ")} · ` +
    `${chain.approved.length} approved for the derived door · ${verdicts.deferred} deferred` +
    (chain.unjoined.length > 0 ? ` · ${chain.unjoined.length} held finding(s) join no canonical candidacy` : "") +
    (codes === "" ? "" : ` · refused/deferred by code: ${codes}`);
}

/** The named rows that exist, by id, in one batched read where the store offers one. */
export async function readByIds<T>(repo: { readMany?(ids: readonly string[]): Promise<readonly { id: string; value: T }[]>;
  read(id: string): Promise<{ id: string; value: T } | null> }, ids: readonly string[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = repo.readMany ? await repo.readMany(unique)
    : (await Promise.all(unique.map(id => repo.read(id)))).filter((row): row is { id: string; value: T } => row !== null);
  return new Map(rows.map(row => [row.id, row.value]));
}

/**
 * The newest vaulted Marginalia answer for each candidacy, whose work item names it. An answer that cannot be read
 * back or is not the documented search answer is counted, never guessed.
 */
export async function heldMarginaliaAnswers(
  repos: Pick<ControlPlaneRepositories, "workItems">,
  vault: VaultIndex,
  now: string,
): Promise<{ readonly responses: HeldMarginaliaResponse[]; readonly answers: number; readonly unreadable: number }> {
  const held = [...vault.byId.values()].filter((artifact) => artifact.methodRouteId === MARGINALIA_ROUTE_ID);
  const work = await readByIds(repos.workItems, held.flatMap((artifact) => artifact.workItemId ?? []));
  const newest = new Map<string, HeldVaultArtifact & { readonly attemptId: string }>();
  let unreadable = 0;
  for (const artifact of held) {
    const subjectId = artifact.workItemId === null ? undefined : work.get(artifact.workItemId)?.subject;
    if (subjectId === undefined || artifact.attemptId === null) { unreadable += 1; continue; }
    const prior = newest.get(subjectId);
    if (prior === undefined || (artifact.retrievedAt ?? "") > (prior.retrievedAt ?? "")) newest.set(subjectId, { ...artifact, attemptId: artifact.attemptId });
  }
  const responses: HeldMarginaliaResponse[] = [];
  for (const [subjectId, artifact] of newest) {
    try {
      const body = new TextDecoder().decode(await readHeldBytes(artifact));
      normalizeMarginaliaSearch(body);
      responses.push({ subjectId, artifactId: artifact.id, attemptId: artifact.attemptId, retrievedAt: artifact.retrievedAt ?? now, body });
    } catch {
      unreadable += 1;
    }
  }
  return { responses, answers: held.length, unreadable };
}

/** The canonical candidacies a site may verify for, from the preloaded promoted pointers; filed domains only, never addresses. */
export function campaignSiteSubjectsFromHoldings(
  holdings: CandidateEnrichmentAuthorityHoldings,
  nowIso: string,
): { readonly subjects: Map<string, CampaignSiteSubject>; readonly failures: readonly string[]; readonly linked: ReadonlySet<string> } {
  const { universes, failures } = candidateEnrichmentUniversesFromHoldings(holdings, nowIso);
  const ballots = Object.values(holdings.general?.ballots ?? {});
  const lineups = ballots.flatMap(ballot => ballot.generalLineup?.contests ?? []);
  const filings: FilingChannels[] = ballots.flatMap(ballot => ballot.contacts ?? []);
  for (const ballot of ballots) {
    const candidacies = (ballot as { candidacies?: unknown } | undefined)?.candidacies;
    if (!Array.isArray(candidacies)) continue;
    for (const c of candidacies as { id?: unknown; websiteUrl?: unknown; provenance?: { sourceUrl?: string | null } }[]) {
      if (typeof c.id === "string" && typeof c.websiteUrl === "string") filings.push({ candidacyId: c.id, websiteUrl: c.websiteUrl, sourceUrl: c.provenance?.sourceUrl });
    }
  }
  const subjects = campaignSiteSubjects({ universes: Object.values(universes), lineups, filings });
  /* Candidacies already carrying a reviewed campaign link on a Reader key (PRIOR_CAMPAIGN_LINK_HELD) are read last. */
  const links = holdings.profiles?.links.links ?? {};
  const linked = new Set([...subjects.values()].filter((s) => s.readerKeys.some((key) => links[key]?.campaign)).map((s) => s.candidacyId));
  return { subjects, failures, linked };
}
