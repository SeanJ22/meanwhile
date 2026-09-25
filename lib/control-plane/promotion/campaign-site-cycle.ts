/**
 * **THE STANDING RUNNER'S CAMPAIGN-SITE PASS: FREE, PLAIN CODE, EVERY RESEARCH
 * CYCLE.** (2026-09-25.)
 *
 * The complete chain (`campaign-site-chain.ts`) was built and proved offline,
 * and nothing ran it: 582 held Scout findings and 326 held Marginalia answers
 * waited at SCOUTED or behind the tail. This is the runner's call. It makes no
 * model call and spends no paid search: its only requests are robots-first
 * reads of candidate pages (`lib/hunt/robots-first-fetch.ts`), through the
 * cycle's own guarded HTTP seam and host spacer, so it runs while the owner's
 * pause keeps the paid lane closed.
 *
 * What it reads, all already held by the runner:
 *
 * - the held Scout findings, as the SCOUTED items the nightly mapping put in
 *   the pipeline log;
 * - the held Marginalia answers: the staging manifest's INGESTED
 *   `candidate-marginalia-index` entries (the tail's own record of each answer,
 *   by candidacy), their bytes from the runner's vault;
 * - the canonical candidacies, from the promoted ballot and profile pointers
 *   the candidate-enrichment provider preloaded this cycle.
 *
 * **THE BOUNDS, AND WHY THESE NUMBERS.** The held volume, measured on the
 * runner's own manifest and vault on 2026-09-25: the 326 Marginalia answers
 * hold 4,647 result URLs, and the verifier refuses 4,631 of them before any
 * request (a government, news, aggregator or party host, a file, or a host and
 * title that do not name the candidate); 16 leads remain. The held Scout pages
 * a sample of the run records reconstructs (32 findings, 109 leads) refuse the
 * same way about 94% of the time, so the 582 findings hold on the order of a
 * hundred or two readable leads. One lead read is at most a robots.txt and a
 * page, spaced per host. So:
 *
 * - `CAMPAIGN_SITE_MAX_READS` = 12 lead reads a cycle clears the Marginalia
 *   leads in two cycles and the Scout backlog in about a day of hourly cycles;
 * - `CAMPAIGN_SITE_MAX_REREADS` = 6 audit second reads a cycle, counted apart,
 *   so a verified item one read from approval never waits behind new leads;
 * - `CAMPAIGN_SITE_BUDGET_MS` = 60 s of wall time, the meetings-discovery
 *   budget: a read the time runs out on is deferred (NOT_READ), never refused;
 * - `CAMPAIGN_SITE_RECHECK_MS` = 7 days: a lead our own Attempt read within it
 *   is judged again from the vaulted bytes with no request, so each cycle's
 *   reads go to leads never read, and every lead is re-read weekly;
 * - one publication attempt a cycle is the routine runner's, not this pass's:
 *   approvals publish through the derived contract
 *   `candidate-campaign-sites-derived` on its own hourly clock.
 *
 * Where Admin reads the results: every offer is a pipeline record, accepted or
 * REFUSED with its typed reasons (the delivery trail); every lead's verdict and
 * refusal code is counted in the cycle's digest line and run record.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readHeldBytes, type VaultIndex } from "../evidence/read-only-vault.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { StagingManifest } from "../scheduler/promotion-tail.ts";
import {
  candidateEnrichmentUniversesFromHoldings,
  type CandidateEnrichmentAuthorityHoldings,
} from "../scheduler/providers/candidate-enrichment.ts";
import type { ActivationGateReading } from "./types.ts";
import {
  MARGINALIA_ROUTE_ID,
  projectCampaignSiteChains,
  type CampaignSiteChainReport,
  type CampaignSiteSubject,
  type HeldMarginaliaResponse,
  type LeadReadResult,
} from "./campaign-site-chain.ts";
import { campaignSiteReadRecorder } from "./campaign-site-reads.ts";
import { campaignSiteSubjects, type FilingChannels, type LineupContest } from "../../candidates/campaign-site-subjects.ts";
import { readCampaignSiteLead } from "../../candidates/campaign-site-verifier.ts";
import { memoryInProcess, type ResearchGet, type ResearchRuntime } from "../../hunt/robots-first-fetch.ts";

export const CAMPAIGN_SITE_MAX_READS = 12;
export const CAMPAIGN_SITE_MAX_REREADS = 6;
export const CAMPAIGN_SITE_BUDGET_MS = 60_000;
export const CAMPAIGN_SITE_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
/** One request's ceiling; the pass's remaining time cuts it shorter. */
export const CAMPAIGN_SITE_REQUEST_TIMEOUT_MS = 10_000;

const BUDGET_SPENT = "CAMPAIGN_SITE_BUDGET_SPENT";

export interface CampaignSiteCycleInput {
  readonly repos: ControlPlaneRepositories;
  readonly subjects: ReadonlyMap<string, CampaignSiteSubject>;
  readonly marginalia: readonly HeldMarginaliaResponse[];
  readonly gate: Pick<ActivationGateReading, "promotionEnabled" | "openRecordClasses" | "openFields">;
  /** The cycle's instant: the chain's clock for freshness and the rotation's hour. */
  readonly now: string;
  /** Milliseconds, for the budget and each read's own time. */
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
  readonly maxRereads?: number;
  readonly budgetMs?: number;
  readonly recheckAfterMs?: number;
}

export interface CampaignSiteCycleReport {
  readonly chain: CampaignSiteChainReport;
  /** Lead verdicts this pass reached, by how: a read now, an earlier read's vaulted bytes, or none. */
  readonly verdicts: { readonly read: number; readonly vault: number; readonly verified: number; readonly refused: number; readonly deferred: number };
  /** Every refusal and deferral code across the leads this pass weighed, counted. */
  readonly byCode: Readonly<Record<string, number>>;
  readonly budgetSpent: boolean;
  readonly elapsedMs: number;
}

/**
 * Run the chain once, inside the pass's bounds. Every lead read is
 * robots-first; nothing here reaches a model, a paid index, or a civic-data
 * store: publication is the derived contract's.
 */
export async function runCampaignSiteCycle(input: CampaignSiteCycleInput): Promise<CampaignSiteCycleReport> {
  const started = input.clock();
  const budgetMs = input.budgetMs ?? CAMPAIGN_SITE_BUDGET_MS;
  const deadline = started + budgetMs;
  let budgetSpent = false;
  /* Requests the budget refused: a read that met one is deferred, whatever the fetch then called it (a robots.txt it could not read, a failed page). */
  let budgetRefusals = 0;
  const runtime: ResearchRuntime = {
    get: async (request) => {
      const remaining = deadline - input.clock();
      if (remaining <= 0) {
        budgetSpent = true;
        budgetRefusals += 1;
        return { status: null, body: new Uint8Array(0), contentType: "", location: null, transportError: BUDGET_SPENT };
      }
      let host = "";
      try { host = new URL(request.url).host.toLowerCase(); } catch { /* researchFetch refuses a malformed URL before it asks */ }
      if (input.spaceOut !== undefined && host !== "") await input.spaceOut(host);
      return input.open({ ...request, timeoutMs: Math.max(1, Math.min(request.timeoutMs, deadline - input.clock())) });
    },
    memory: memoryInProcess(),
    now: input.clock,
    sleep: input.sleep,
    /* The shared host spacer spaces every request; a host's own Crawl-delay still applies inside researchFetch. */
    spacingMs: 0,
    timeoutMs: CAMPAIGN_SITE_REQUEST_TIMEOUT_MS,
  };
  const readLead = async (lead: Parameters<typeof readCampaignSiteLead>[0]): Promise<LeadReadResult> => {
    if (input.clock() >= deadline) {
      budgetSpent = true;
      return { ok: false, refusal: { code: "NOT_READ", detail: `the pass's ${budgetMs / 1000}s budget was spent before ${lead.url} was read; it stays owed` } };
    }
    const refusedBefore = budgetRefusals;
    const out = await readCampaignSiteLead(lead, runtime);
    if (out.ok) return { ok: true, read: out.read };
    /* A read the pass's own time cut short says nothing about the lead: it is deferred, never refused. */
    if (budgetRefusals > refusedBefore || (out.refusal.code === "TRANSPORT_FAILED" && input.clock() >= deadline)) {
      budgetSpent = true;
      return { ok: false, refusal: { code: "NOT_READ", detail: `the pass's ${budgetMs / 1000}s budget ran out during the read of ${lead.url}; it stays owed` } };
    }
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
    marginalia: input.marginalia,
    readLead,
    recordRead: recorder.recordRead,
    heldPage: recorder.heldPage,
    gate: input.gate,
    now: input.now,
    maxReads: input.maxReads ?? CAMPAIGN_SITE_MAX_READS,
    maxRereads: input.maxRereads ?? CAMPAIGN_SITE_MAX_REREADS,
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
  return { chain, verdicts: { read, vault, verified, refused, deferred }, byCode, budgetSpent, elapsedMs: input.clock() - started };
}

/** The pass in one digest line: what was read, what verified, where each item stands, and every refusal by code. */
export function campaignSiteCycleLine(report: CampaignSiteCycleReport): string {
  const { chain, verdicts } = report;
  const codes = Object.entries(report.byCode).sort(([a], [b]) => a.localeCompare(b)).map(([code, n]) => `${code} ${n}`).join(", ");
  return `  campaign sites     ${chain.readsUsed} read(s) (${chain.rereadsUsed} audit second read(s)), ${verdicts.vault} judged from vaulted reads, ` +
    `${verdicts.verified} lead(s) verified · items ${Object.entries(chain.byStage).map(([stage, n]) => `${stage} ${n}`).join(", ")} · ` +
    `${chain.approved.length} approved for the derived door · ${verdicts.deferred} deferred${report.budgetSpent ? " (the pass's time budget)" : ""}` +
    (chain.unjoined.length > 0 ? ` · ${chain.unjoined.length} held finding(s) join no canonical candidacy` : "") +
    (codes === "" ? "" : ` · refused/deferred by code: ${codes}`);
}

/* --------------------------------------------------------------- inputs */

/** The artifact ids one staged answer cites: the gap's `artifact(s):` line, or the promotion-ready snapshot's own list. */
function stagedArtifactIds(root: string, entry: StagingManifest["entries"][number]): string[] {
  const line = entry.unresolved.find((l) => l.startsWith("artifact(s): "));
  if (line !== undefined) return line.slice("artifact(s): ".length).split(", ").filter((id) => id !== "" && id !== "none recorded");
  if (entry.snapshotPath === null) return [];
  try {
    const snapshot = JSON.parse(readFileSync(join(root, entry.snapshotPath), "utf8")) as { sourceArtifactIds?: unknown };
    return Array.isArray(snapshot.sourceArtifactIds) ? snapshot.sourceArtifactIds.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Every held Marginalia answer, by candidacy: the manifest's INGESTED
 * `candidate-marginalia-index` entries, each answer's bytes read back from
 * the vault and proved against their sidecar. An answer the vault cannot
 * produce is counted, never guessed.
 */
export async function heldMarginaliaFromManifest(
  root: string,
  manifest: StagingManifest | null,
  vault: VaultIndex,
  now: string,
): Promise<{ readonly responses: HeldMarginaliaResponse[]; readonly entries: number; readonly unreadable: number }> {
  const responses: HeldMarginaliaResponse[] = [];
  let entries = 0;
  let unreadable = 0;
  for (const entry of manifest?.entries ?? []) {
    if (entry.routeId !== MARGINALIA_ROUTE_ID || entry.disposition !== "INGESTED") continue;
    entries += 1;
    for (const id of stagedArtifactIds(root, entry)) {
      const artifact = vault.byId.get(id);
      if (artifact === undefined || artifact.attemptId === null) { unreadable += 1; continue; }
      try {
        const body = new TextDecoder().decode(await readHeldBytes(artifact));
        responses.push({ subjectId: entry.subjectId, artifactId: artifact.id, attemptId: artifact.attemptId, retrievedAt: artifact.retrievedAt ?? now, body });
      } catch {
        unreadable += 1;
      }
    }
  }
  return { responses, entries, unreadable };
}

/**
 * The canonical candidacies a site may verify for, from the promoted pointers
 * the candidate-enrichment provider preloaded: its own universes, the Arizona
 * certified lineup's nominee keys, and the filings' stated domains (the Morris
 * clerk's filed contacts and any filed website), domains only.
 */
export function campaignSiteSubjectsFromHoldings(
  holdings: CandidateEnrichmentAuthorityHoldings,
  nowIso: string,
): { readonly subjects: Map<string, CampaignSiteSubject>; readonly failures: readonly string[] } {
  const { universes, failures } = candidateEnrichmentUniversesFromHoldings(holdings, nowIso);
  const lineups = ((holdings.az?.generalLineup as { contests?: unknown } | undefined)?.contests ?? []) as LineupContest[];
  const contacts = (holdings.nj?.contacts as { contacts?: unknown } | undefined)?.contacts;
  const filings: FilingChannels[] = (Array.isArray(contacts) ? contacts : contacts !== null && typeof contacts === "object" ? Object.values(contacts) : [])
    .filter((row): row is FilingChannels => row !== null && typeof row === "object" && typeof (row as { candidacyId?: unknown }).candidacyId === "string");
  for (const ballot of [holdings.az?.ballot, holdings.nh?.ballot, (holdings.nj?.ballot as { candidacies?: unknown } | undefined)]) {
    const candidacies = (ballot as { candidacies?: unknown } | undefined)?.candidacies;
    if (!Array.isArray(candidacies)) continue;
    for (const c of candidacies as { id?: unknown; websiteUrl?: unknown }[]) {
      if (typeof c.id === "string" && typeof c.websiteUrl === "string") filings.push({ candidacyId: c.id, websiteUrl: c.websiteUrl });
    }
  }
  return { subjects: campaignSiteSubjects({ universes: Object.values(universes), lineups, filings }), failures };
}
