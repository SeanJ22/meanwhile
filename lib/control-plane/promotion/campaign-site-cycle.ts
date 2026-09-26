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
 *   budget, measured from the pass's start with its loading included and held
 *   by timers (`CAMPAIGN_SITE_STOP_GRACE_MS`): a read the time runs out on, or
 *   a request that never answers, is deferred (NOT_READ), never refused;
 * - `CAMPAIGN_SITE_RECHECK_MS` = 7 days: a lead our own Attempt read within it
 *   is judged again from the vaulted bytes with no request, so each cycle's
 *   reads go to leads never read, and every lead is re-read weekly;
 * - one publication attempt a cycle is the routine runner's, not this pass's:
 *   approvals publish through the derived contract
 *   `candidate-campaign-sites-derived` on its own hourly clock.
 *
 * **THE ORDER, AND WHY.** (2026-09-25, measured read-only on production.) The
 * time budget, not the read bound, ends each pass: 4 to 6 reads a cycle. So
 * the audit's second reads come first (an item one read from approval never
 * waits behind new leads), and a candidacy whose promoted profile already
 * carries a campaign link (`linked` below, the door's PRIOR_CAMPAIGN_LINK_HELD
 * rule) or already holds an approval is read after every other candidacy: a
 * site approved for them is held, never published. The design note is in
 * `projectCampaignSiteChains`.
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
import { PIPELINE_STAGES, type ActivationGateReading, type PipelineStage } from "./types.ts";
import {
  CAMPAIGN_SITE_CHAIN_VERSION,
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
/** One request's ceiling; the pass's remaining time cuts it shorter. Enforced by a timer, whether or not the transport honours it. */
export const CAMPAIGN_SITE_REQUEST_TIMEOUT_MS = 10_000;
/**
 * **THE HARD STOP.** (2026-09-25.) The pass's budget is measured from its own
 * start, loading included, and it ends there in WALL time — a request that
 * never answers, a spacer or Crawl-delay wait, a store call that hangs. The
 * store work already in flight at the deadline (recording a read that was
 * made, an offer) gets this long to finish; then the cycle moves on and the
 * pass is abandoned, every lead it had not weighed still owed (NOT_READ).
 * Measured: the budget was overrun to 93–160 s in recent cycles, and one pass
 * hung past 4.5 minutes and let the research cycle be killed at its 900 s
 * limit with no record written. An engineering choice, not an owner number.
 */
export const CAMPAIGN_SITE_STOP_GRACE_MS = 5_000;

const BUDGET_SPENT = "CAMPAIGN_SITE_BUDGET_SPENT";
const REQUEST_TIMED_OUT = "CAMPAIGN_SITE_REQUEST_TIMED_OUT";

/**
 * `work`, or nothing once `ms` of wall time pass — measured by a real timer,
 * so a promise that never settles cannot hold its caller. The timer is always
 * cleared, and an abandoned promise's later rejection is swallowed here rather
 * than surfacing as an unhandled rejection in the runner.
 */
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
  /**
   * When the pass started, on `clock`: before the caller loaded its inputs, so
   * the loading spends the same budget. Absent, the pass starts at this call.
   */
  readonly startedAtMs?: number;
  /** How long past the deadline in-flight store work may finish before the pass is abandoned. */
  readonly stopGraceMs?: number;
}

export interface CampaignSiteCycleReport {
  readonly chain: CampaignSiteChainReport;
  /** Lead verdicts this pass reached, by how: a read now, an earlier read's vaulted bytes, or none. */
  readonly verdicts: { readonly read: number; readonly vault: number; readonly verified: number; readonly refused: number; readonly deferred: number };
  /** Every refusal and deferral code across the leads this pass weighed, counted. */
  readonly byCode: Readonly<Record<string, number>>;
  readonly budgetSpent: boolean;
  readonly elapsedMs: number;
  /**
   * True when the pass was abandoned at its hard stop: the chain above is only
   * what the pass saw before it (no offers are counted), and every lead it had
   * not weighed stays owed (NOT_READ) for the next cycle.
   */
  readonly stoppedAtDeadline?: boolean;
}

/** The report of a pass abandoned at its hard stop: what it read, nothing it cannot vouch for. */
function stoppedReport(reads: number, notRead: number, elapsedMs: number): CampaignSiteCycleReport {
  const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<PipelineStage, number>;
  return {
    chain: { version: CAMPAIGN_SITE_CHAIN_VERSION, items: 0, byStage, leads: [], offers: [], unjoined: [], approved: [], readsUsed: reads, rereadsUsed: 0, judgedFromVault: 0 },
    verdicts: { read: 0, vault: 0, verified: 0, refused: 0, deferred: notRead },
    byCode: notRead > 0 ? { NOT_READ: notRead } : {},
    budgetSpent: true,
    elapsedMs,
    stoppedAtDeadline: true,
  };
}

/**
 * Run the chain once, inside the pass's bounds. Every lead read is
 * robots-first; nothing here reaches a model, a paid index, or a civic-data
 * store: publication is the derived contract's.
 */
export async function runCampaignSiteCycle(input: CampaignSiteCycleInput): Promise<CampaignSiteCycleReport> {
  const started = input.startedAtMs ?? input.clock();
  const budgetMs = input.budgetMs ?? CAMPAIGN_SITE_BUDGET_MS;
  const deadline = started + budgetMs;
  const stopGraceMs = input.stopGraceMs ?? CAMPAIGN_SITE_STOP_GRACE_MS;
  const left = (): number => deadline - input.clock();
  let budgetSpent = false;
  /* Requests the budget refused: a read that met one is deferred, whatever the fetch then called it (a robots.txt it could not read, a failed page). */
  let budgetRefusals = 0;
  /* Requests that did not answer inside their own ceiling: the lead was not read, so it is deferred too, never refused. */
  let timeouts = 0;
  /* What the pass did before any hard stop, for the report of an abandoned pass. */
  let readsMade = 0;
  let notRead = 0;
  const unanswered = (transportError: string) => ({ status: null, body: new Uint8Array(0), contentType: "", location: null, transportError });
  const runtime: ResearchRuntime = {
    get: async (request) => {
      if (left() <= 0) {
        budgetSpent = true;
        budgetRefusals += 1;
        return unanswered(BUDGET_SPENT);
      }
      let host = "";
      try { host = new URL(request.url).host.toLowerCase(); } catch { /* researchFetch refuses a malformed URL before it asks */ }
      /* The shared spacer's wait spends the pass's time too, and never past its deadline. */
      if (input.spaceOut !== undefined && host !== "" && !(await withinWallTime(input.spaceOut(host), left())).done) {
        budgetSpent = true;
        budgetRefusals += 1;
        return unanswered(BUDGET_SPENT);
      }
      const remaining = left();
      if (remaining <= 0) {
        budgetSpent = true;
        budgetRefusals += 1;
        return unanswered(BUDGET_SPENT);
      }
      /* The request's own ceiling, cut to the pass's remaining time, and held by a timer whatever the transport does with it. */
      const limit = Math.max(1, Math.min(request.timeoutMs, CAMPAIGN_SITE_REQUEST_TIMEOUT_MS, remaining));
      const got = await withinWallTime(input.open({ ...request, timeoutMs: limit }), limit);
      if (got.done) return got.value;
      if (left() <= 0 || limit >= remaining) {
        budgetSpent = true;
        budgetRefusals += 1;
        return unanswered(BUDGET_SPENT);
      }
      timeouts += 1;
      return unanswered(REQUEST_TIMED_OUT);
    },
    memory: memoryInProcess(),
    now: input.clock,
    /* A host's Crawl-delay is waited out inside the pass's time, never past it; the next request then meets the spent budget. */
    sleep: (ms) => input.sleep(Math.max(0, Math.min(ms, left()))),
    /* The shared host spacer spaces every request; a host's own Crawl-delay still applies inside researchFetch. */
    spacingMs: 0,
    timeoutMs: CAMPAIGN_SITE_REQUEST_TIMEOUT_MS,
  };
  const notReadYet = (detail: string): LeadReadResult => {
    notRead += 1;
    return { ok: false, refusal: { code: "NOT_READ", detail } };
  };
  const readLead = async (lead: Parameters<typeof readCampaignSiteLead>[0]): Promise<LeadReadResult> => {
    if (left() <= 0) {
      budgetSpent = true;
      return notReadYet(`the pass's ${budgetMs / 1000}s budget was spent before ${lead.url} was read; it stays owed`);
    }
    const refusedBefore = budgetRefusals;
    const timedOutBefore = timeouts;
    const read = await withinWallTime(readCampaignSiteLead(lead, runtime), left());
    if (!read.done) {
      budgetSpent = true;
      return notReadYet(`the pass's ${budgetMs / 1000}s budget ran out during the read of ${lead.url}; it stays owed`);
    }
    const out = read.value;
    readsMade += 1;
    if (out.ok) return { ok: true, read: out.read };
    /* A read the pass's own time cut short says nothing about the lead: it is deferred, never refused. */
    if (budgetRefusals > refusedBefore || (out.refusal.code === "TRANSPORT_FAILED" && left() <= 0)) {
      budgetSpent = true;
      return notReadYet(`the pass's ${budgetMs / 1000}s budget ran out during the read of ${lead.url}; it stays owed`);
    }
    /* Nor does a request that never answered: the lead was not read. */
    if (timeouts > timedOutBefore) {
      return notReadYet(`a request for ${lead.url} did not answer within ${CAMPAIGN_SITE_REQUEST_TIMEOUT_MS / 1000}s; the lead was not read and stays owed`);
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
  /*
   * The whole projection — its store reads and writes as well as its lead
   * reads — ends at the hard stop. Past the deadline every lead read is
   * deferred at once, so what remains is the store work in flight; past the
   * grace the pass is abandoned and the cycle moves on.
   */
  const projected = await withinWallTime(
    projectCampaignSiteChains(input.repos, {
      subjects: input.subjects,
      linkedCandidacies: input.linkedCandidacies,
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
    }),
    left() + stopGraceMs,
  );
  if (!projected.done) return stoppedReport(readsMade, notRead, input.clock() - started);
  const chain = projected.value;
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
    (report.stoppedAtDeadline === true ? ` · STOPPED at its hard deadline after ${Math.round(report.elapsedMs / 1000)}s: every lead not yet weighed stays owed (NOT_READ)` : "") +
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
): { readonly subjects: Map<string, CampaignSiteSubject>; readonly failures: readonly string[]; readonly linked: ReadonlySet<string> } {
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
  const subjects = campaignSiteSubjects({ universes: Object.values(universes), lineups, filings });
  /*
   * Who already carries a campaign link: the publication door's own rule (PRIOR_CAMPAIGN_LINK_HELD), a reviewed
   * campaign link on any of the candidacy's Reader keys in the promoted profiles. The pass reads their leads last.
   */
  const links = holdings.profiles?.links.links ?? {};
  const linked = new Set([...subjects.values()].filter((s) => s.readerKeys.some((key) => links[key]?.campaign)).map((s) => s.candidacyId));
  return { subjects, failures, linked };
}
