import { readRuntimeAdminConfig } from "../runtime-admin-config.ts";
import { contentHash, fingerprint } from "../ids.ts";
import { accessControlIn } from "../../hunt/access-control.ts";
import { canonicalJson, readByKeys, type AppendOnlyRepository, type ArtifactRecord, type ControlPlaneRepositories } from "../repository/types.ts";
import type { Attempt, WorkerRole } from "../attempt.ts";
import type { AuditEvidenceBase } from "../audit.ts";
import { appendTransition, contextFromRecords, readPipelineStatesWhere, scoutedFromScoutResult, type PipelineContext } from "./pipeline.ts";
import { findingFact, finishBoxFinding, holdBoxFinding, takeBoxFinding, type BoxFinding } from "../box.ts";
import { checkFact, linkQuote } from "../../facts/check.ts";
import { factClocks } from "../../facts/clocks.ts";
import type { Clocks } from "../../facts/publish.ts";
import { CAMPAIGN_SITE_LEAD, FINDING_SLOTS_VERSION } from "../../facts/finding-slots.ts";
import { pageCopy } from "../../facts/source-copy.ts";
import {
  PROMOTION_PIPELINE_FORMAT_VERSION,
  type ApprovalBurden,
  type ApprovedRecord,
  type PipelineItemState,
  type PipelineStage,
  type RefusedRecord,
  type ScoutedRecord,
  type TransitionRecord,
  type VerificationCheck,
} from "./types.ts";
import {
  CAMPAIGN_SITE_VERIFIER_ID,
  brandTokens,
  candidateDisplayName,
  titleBrandsCandidate,
  campaignNameForms,
  campaignSiteHostRefusal,
  comparisonText,
  pageVisibleText,
  pageHeadings,
  cycleEvidence,
  linkedSiteHosts,
  profileCampaignSiteLeads,
  profileSupportsCampaign,
  registrableDomain,
  siteHost,
  sitePathLength,
  siteLabel,
  verifyCampaignSitePage,
  type CampaignSiteIdentity,
  type CampaignSiteLead,
  type CampaignSitePageRead,
  type CampaignSiteRefusal,
  type CampaignSiteVerdict,
  type CampaignSiteSourceReference,
  type CampaignSiteSupportingRead,
} from "../../candidates/campaign-site-verifier.ts";
export { profileCampaignSiteLeads } from "../../candidates/campaign-site-verifier.ts";

export const CAMPAIGN_SITE_CHAIN_VERSION = "campaign-site-chain/2";
export const CAMPAIGN_SITE_RECORD_CLASS = "candidate-enrichment";
export const CAMPAIGN_SITE_FIELD = "campaignSite";
export const CAMPAIGN_SITE_APPROVER_ID = "campaign-site-approver/1";
export const MARGINALIA_ROUTE_ID = "candidate-marginalia-index";
/** An approval rests on a verifying read no older than this. */
export const MAX_READ_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** A held finding is read at most this many leads deep in one run. */
const MAX_LEADS_PER_ITEM = 6;

/** A canonical candidacy the chain may approve for, with the exact Reader keys it renders under. */
export interface CampaignSiteSubject extends CampaignSiteIdentity {
  /** `candidate-profiles` links keys: the candidacy's ballot ids and any exactly matched lineup nominee key. */
  readonly readerKeys: readonly string[];
  /** Registrable domains the candidate's own 2026 filing names (website, or contact address domain). Never an address. */
  readonly filingDomains: readonly string[];
  readonly filingWebsites?: readonly { readonly url: string; readonly sourceUrl: string }[];
}

/** One held Marginalia answer for one candidacy, as the runner vaulted it. */
export interface HeldMarginaliaResponse {
  readonly subjectId: string;
  readonly artifactId: string;
  readonly attemptId: string;
  readonly retrievedAt: string;
  readonly body: string;
}

export type LeadReadResult =
  | { readonly ok: true; readonly read: CampaignSitePageRead }
  | { readonly ok: false; readonly refusal: CampaignSiteRefusal };

export interface CampaignSiteChainOptions {
  /** Every canonical candidacy the promoted ballots hold, by canonical id: the identity join and the uniqueness universe. */
  readonly subjects: ReadonlyMap<string, CampaignSiteSubject>;
  readonly marginalia?: readonly HeldMarginaliaResponse[];
  /** Read a lead robots-first (`readCampaignSiteLead`). */
  readonly readLead: (lead: CampaignSiteLead) => Promise<LeadReadResult>;
  /** Record a read as a completed ACQUIRER Attempt with its vaulted artifact. */
  readonly recordRead: (subjectId: string, lead: CampaignSiteLead, read: CampaignSitePageRead) => Promise<ArtifactRecord>;
  /** The vaulted bytes of an artifact as a page read; null when the vault cannot produce them. */
  readonly heldPage: (artifact: ArtifactRecord) => Promise<CampaignSitePageRead | null>;
  readonly now: string;
  /** Distinct lead URLs read in one run at most; the rest stay owed, named. */
  readonly maxReads?: number;
  // Reuse recent saved reads so acquisition slots reach leads never read.
  readonly recheckAfterMs?: number;
  // Rotate tied items so a bounded pass cannot starve the same backlog.
  readonly rotation?: string;
  /** Candidacies whose profile already carries a campaign link; their leads are read last. Order only. */
  readonly linkedCandidacies?: ReadonlySet<string>;
}

/** The door every approval publishes through: the derived routine contract `candidate-campaign-sites-derived`. */
export const CAMPAIGN_SITE_PUBLICATION_DOOR = "CANDIDATE_CAMPAIGN_SITES_DERIVED_CONTRACT" as const;

/** What an approval carries for the promotion writer: the site, its reader keys, and its evidence. */
export interface CampaignSiteApproval {
  readonly field: typeof CAMPAIGN_SITE_FIELD;
  readonly candidacyId: string;
  readonly candidateName: string;
  /** The canonical identity the site verified for, so the publication door can verify the vaulted bytes again. */
  readonly identity: CampaignSiteIdentity;
  readonly readerKeys: readonly string[];
  readonly url: string;
  readonly host: string;
  readonly verification: string;
  readonly evidence: {
    readonly verifierId: typeof CAMPAIGN_SITE_VERIFIER_ID;
    readonly artifactId: string;
    readonly attemptId: string;
    readonly sha256: string;
    readonly requestedUrl: string;
    readonly finalUrl: string;
    readonly httpStatus: number;
    readonly contentType: string;
    readonly readAt: string;
    readonly cycleSource?: CampaignSiteSourceReference;
  };
  /** Retained only when reading historical approvals. */
  readonly audit?: { readonly startedFrom: readonly AuditEvidenceBase[]; readonly secondSignal: string };
  readonly publicationDoor: typeof CAMPAIGN_SITE_PUBLICATION_DOOR;
}

export type CampaignSiteApprovedRecord = ApprovedRecord & { readonly campaignSite: CampaignSiteApproval };

export interface CampaignSiteLeadOutcome {
  readonly itemId: string | null;
  readonly subjectId: string;
  readonly lead: CampaignSiteLead;
  readonly outcome: "VERIFIED" | "REFUSED" | "DEFERRED";
  readonly refusals: readonly CampaignSiteRefusal[];
  readonly historical: readonly number[] | null;
  /** How the verdict was reached: a read this run, an earlier read's vaulted bytes, or no read (refused by host, or deferred). */
  readonly via: "READ" | "VAULT" | "NONE";
}

export interface CampaignSiteChainReport {
  readonly version: typeof CAMPAIGN_SITE_CHAIN_VERSION;
  readonly items: number;
  readonly byStage: Readonly<Record<PipelineStage, number>>;
  readonly leads: readonly CampaignSiteLeadOutcome[];
  readonly offers: readonly { readonly stage: PipelineStage; readonly itemId: string; readonly accepted: boolean; readonly refusalCodes: readonly string[] }[];
  /** Held findings that joined no canonical candidacy: never guessed onto one. */
  readonly unjoined: readonly { readonly itemId: string; readonly subjectId: string }[];
  readonly approved: readonly CampaignSiteApprovedRecord[];
  /** Every lead read this run made. The audit reuses held sources. */
  readonly readsUsed: number;
  /** Kept for runner telemetry compatibility; the audit makes no extra requests. */
  readonly rereadsUsed: number;
  /** Leads judged again from an earlier read's vaulted bytes, with no request. */
  readonly judgedFromVault: number;
}

/** The item a Marginalia pointer becomes: one per candidacy and pointed URL, so a re-run collides. */
export function discoveryPointerItemId(subjectId: string, url: string): string {
  return `pp-${fingerprint(["discovery-pointer", MARGINALIA_ROUTE_ID, subjectId, url])}`;
}

const displayName = candidateDisplayName;

const BOX_LEADS_PER_PASS = 500;

/** A hunter's reported campaign site, held to checkFact on the page it cited, as a SCOUTED lead; or why it is refused. */
async function boxLead(repos: ControlPlaneRepositories, finding: BoxFinding, subject: CampaignSiteSubject,
  options: Pick<CampaignSiteChainOptions, "heldPage" | "now">, windowHours: Clocks["windowHours"]): Promise<ScoutedRecord | { readonly refused: string }> {
  const fact = findingFact(finding);
  if (!fact || finding.exactQuote === null) return { refused: "FINDING_HAS_NO_FIELD_VALUE_OR_QUOTE" };
  const { origin } = fact, url = String(fact.value);
  const artifact = (await repos.artifacts.read(origin.workItemId)).find(row => origin.artifactIds.includes(row.artifactId));
  const page = artifact ? await options.heldPage(artifact) : null;
  if (page === null) return { refused: "CITED_PAGE_NOT_SAVED" };
  const checked = checkFact({ entity: { id: subject.candidacyId, fullName: `${subject.givenName} ${subject.familyName}`, stateName: null, hosts: [], externalIds: [] },
    fieldKind: "ballot", provenance: "CAMPAIGN", valueText: url, quote: linkQuote(url, finding.exactQuote),
    copy: pageCopy({ finalUrl: page.finalUrl, body: page.body, contentType: page.contentType, fetchedAt: page.retrievedAt }) }, new Date(options.now), windowHours);
  if (!checked.ok) return { refused: checked.reason };
  const itemId = `pp-${fingerprint(["box-finding", subject.candidacyId, url])}`;
  return { formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:scouted`, itemId, at: origin.recordedAt,
    actor: { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: origin.resultId }, stage: "SCOUTED",
    source: { kind: "SCOUT_RESULT", attemptId: origin.resultId, obligationId: origin.resultKey ?? finding.subjectId, outcome: "EVIDENCE_FOUND", routeId: null },
    recordClass: CAMPAIGN_SITE_RECORD_CLASS, subjectId: subject.candidacyId, canonicalUrl: url, artifactIds: [artifact!.artifactId],
    scoutAttemptId: origin.resultId, summary: `A hunter found ${url} for ${displayName(subject)}: "${finding.exactQuote.slice(0, 200)}"` };
}

/** Leads a held Scout finding points at: its URL, or the pages its own Attempt vaulted. */
async function scoutLeads(state: PipelineItemState, ctx: PipelineContext, subject: CampaignSiteSubject,
  heldPage: CampaignSiteChainOptions["heldPage"]): Promise<CampaignSiteLead[]> {
  const scouted = state.byStage.SCOUTED!;
  const urls = scouted.canonicalUrl !== null
    ? [scouted.canonicalUrl]
    : scouted.artifactIds
        .map((id) => ctx.artifactById(id))
        .filter((a): a is ArtifactRecord => a !== null && /html/i.test(a.contentType))
        .map((a) => a.canonicalUrl);
  const seen = new Set<string>();
  const leads: CampaignSiteLead[] = [];
  // A profile is a discovery page, not the campaign. Read its saved links
  // before spending another request on the profile or refusing its host.
  for (const id of scouted.artifactIds) {
    const artifact = ctx.artifactById(id);
    if (!artifact || artifact.partial || !/html/i.test(artifact.contentType)) continue;
    const page = await heldPage(artifact);
    if (!page || contentHash(page.body) !== artifact.contentHash || `sha256-${page.sha256}` !== artifact.contentHash || page.httpStatus < 200 || page.httpStatus >= 300) continue;
    for (const lead of profileCampaignSiteLeads(page, subject, state.itemId)) {
      if (!seen.has(lead.url)) { seen.add(lead.url); leads.push(lead); }
    }
  }
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    leads.push({ url, origin: scouted.source.kind === "DISCOVERY_POINTER" ? "MARGINALIA_POINTER" : "SCOUT_FINDING", ref: state.itemId });
  }
  return leads;
}

interface ProfileIndex {
  readonly linking: (host: string) => Promise<readonly ArtifactRecord[]>;
}

/** A read recorded more than this long before the age bound cannot have been retrieved inside it. */
const RECORDED_AFTER_READ_SLACK_MS = 24 * 60 * 60 * 1000;

function profileIndex(artifacts: readonly ArtifactRecord[], options: CampaignSiteChainOptions): ProfileIndex {
  const byHost = new Map<string, ArtifactRecord[]>();
  const now = Date.parse(options.now);
  let indexed = 0;
  /* The run's own new reads are appended to `artifacts`; each lookup first indexes what arrived, one catch-up at a time. */
  const catchUp = async (): Promise<void> => {
    for (; indexed < artifacts.length; indexed += 1) {
      const artifact = artifacts[indexed]!;
      if (artifact.partial || !/html/i.test(artifact.contentType)) continue;
      if (now - Date.parse(artifact.recordedAt) > MAX_READ_AGE_MS + RECORDED_AFTER_READ_SLACK_MS) continue;
      const page = await options.heldPage(artifact);
      if (!page) continue;
      for (const linked of linkedSiteHosts(page)) {
        const list = byHost.get(linked);
        if (list === undefined) byHost.set(linked, [artifact]);
        else list.push(artifact);
      }
    }
  };
  let caughtUp: Promise<void> = Promise.resolve();
  return {
    async linking(host) {
      caughtUp = caughtUp.then(catchUp);
      await caughtUp;
      return byHost.get(host) ?? [];
    },
  };
}

/** A different captured publisher that names this candidacy and cites the campaign we independently read. */
async function independentProfileSignal(subject: CampaignSiteSubject, primary: ArtifactRecord, profiles: ProfileIndex,
  options: CampaignSiteChainOptions, primaryPage: CampaignSitePageRead): Promise<{ artifact: ArtifactRecord; supporting: CampaignSiteSupportingRead } | null> {
  const primaryHost = siteHost(primaryPage.finalUrl);
  if (primaryHost === null) return null;
  for (const artifact of await profiles.linking(primaryHost)) {
    if (registrableDomain(siteHost(artifact.canonicalUrl) ?? "") === registrableDomain(siteHost(primary.canonicalUrl) ?? "")) continue;
    const page = await options.heldPage(artifact);
    if (!page || page.httpStatus < 200 || page.httpStatus >= 300 || contentHash(page.body) !== artifact.contentHash ||
      `sha256-${page.sha256}` !== artifact.contentHash) continue;
    const age = Date.parse(options.now) - Date.parse(page.retrievedAt);
    if (!Number.isFinite(age) || age < 0 || age > MAX_READ_AGE_MS) continue;
    if (cycleEvidence(comparisonText(pageVisibleText(page.body)), pageHeadings(page.body).headings, subject.cycle).state !== "CURRENT") continue;
    const supporting: CampaignSiteSupportingRead = { source: { artifactId: artifact.artifactId, sha256: page.sha256,
      requestedUrl: page.requestedUrl, finalUrl: page.finalUrl, httpStatus: page.httpStatus,
      contentType: page.contentType, readAt: page.retrievedAt }, page };
    if (profileSupportsCampaign(subject, primaryPage, supporting)) return { artifact, supporting };
  }
  return null;
}

/** One Marginalia result: a URL and what the index called it, never the index's licensed description. */
interface MarginaliaPointer {
  readonly kind: "POINTER";
  readonly url: string;
  readonly title: string | null;
  readonly format: string | null;
  readonly rank: number;
}

/** A held Marginalia answer as pointers; an empty `results` is a named no-hit, an undocumented answer throws. */
export function normalizeMarginaliaSearch(body: string): { readonly rows: readonly MarginaliaPointer[]; readonly noHit?: string } {
  const parsed = JSON.parse(body) as { license?: unknown; query?: unknown; results?: unknown };
  if (typeof parsed.license !== "string" || !Array.isArray(parsed.results)) {
    throw new Error("MARGINALIA_ANSWER_UNDOCUMENTED: the response carries no `license` string and `results` array, so it is not the documented search answer");
  }
  const rows = (parsed.results as readonly Record<string, unknown>[]).flatMap((row, index): MarginaliaPointer[] =>
    typeof row?.url === "string" && /^https?:\/\//.test(row.url)
      ? [{ kind: "POINTER", url: row.url, title: typeof row.title === "string" ? row.title : null, format: typeof row.format === "string" ? row.format : null, rank: index + 1 }]
      : [],
  );
  if (rows.length > 0) return { rows };
  const query = typeof parsed.query === "string" ? parsed.query : null;
  return { rows, noHit: `NO_HIT: the index answered ${JSON.stringify(query)} with no result — a dated fact about one query to one index, never a statement about the candidate` };
}

export function marginaliaLeads(held: HeldMarginaliaResponse, subject: CampaignSiteSubject): { readonly leads: readonly (CampaignSiteLead & { readonly rank: number })[]; readonly refused: readonly { readonly url: string; readonly refusal: CampaignSiteRefusal }[]; readonly noHit: boolean } {
  const normalized = normalizeMarginaliaSearch(held.body);
  const forms = campaignNameForms(subject).map((f) => f.form);
  const tokens = brandTokens(subject);
  const leads: (CampaignSiteLead & { rank: number })[] = [];
  const refused: { url: string; refusal: CampaignSiteRefusal }[] = [];
  for (const row of normalized.rows) {
    const url = row.url;
    const hostRefusal = campaignSiteHostRefusal(url);
    if (hostRefusal !== null) { refused.push({ url, refusal: hostRefusal }); continue; }
    if (row.format !== null && row.format !== "html") {
      refused.push({ url, refusal: { code: "NOT_A_PAGE", detail: `the index files ${url} as ${row.format}, not a web page` } });
      continue;
    }
    const host = siteHost(url) ?? "";
    const label = siteLabel(host).replace(/[^a-z0-9]/g, "");
    const branded = tokens.some((token) => label.includes(token)) || titleBrandsCandidate(row.title ?? "", forms) !== null;
    if (!branded) {
      refused.push({ url, refusal: { code: "SITE_NOT_CANDIDATE_BRANDED", detail: `neither ${host} nor the index title names ${displayName(subject)}; a keyword hit is not a lead` } });
      continue;
    }
    leads.push({ url, origin: "MARGINALIA_POINTER", ref: held.artifactId, title: row.title, rank: row.rank });
  }
  return { leads, refused, noHit: normalized.noHit !== undefined };
}

/** The five checks, computed from the vaulted read and the identity universe. FAIL names what failed. */
function campaignSiteChecks(input: {
  readonly subject: CampaignSiteSubject;
  readonly verdict: CampaignSiteVerdict;
  /** The vaulted read the verdict was made from. */
  readonly read: CampaignSitePageRead;
  readonly artifact: ArtifactRecord;
  readonly subjects: ReadonlyMap<string, CampaignSiteSubject>;
  readonly now: string;
}): VerificationCheck[] {
  const { subject, verdict, artifact } = input;
  const m = verdict.measurement;
  const checks: VerificationCheck[] = [];
  const span = (label: string, s: { form: string; index: number } | null) => (s === null ? `${label}: none` : `${label} "${s.form}" at ${s.index}`);
  checks.push(verdict.verdict === "VERIFIED" && m !== null && m.name !== null && (m.office !== null || m.district !== null) && m.cycle.span !== null
    ? { name: "CLAIM_RESOLVES_TO_SOURCE_SPAN", result: "PASS", detail: `in ${artifact.artifactId} (${artifact.contentHash}): ${span("name", m.name)}; ${span("office", m.office)}; ${span("district", m.district)}; cycle ${m.cycle.span.year} beside "${m.cycle.span.phrase}" (${m.cycle.span.where}${m.cycle.source ? ` ${m.cycle.source.artifactId}, sha256-${m.cycle.source.sha256}, ${m.cycle.source.finalUrl}` : ""})` }
    : { name: "CLAIM_RESOLVES_TO_SOURCE_SPAN", result: "FAIL", detail: verdict.verdict === "REFUSED" ? verdict.refusals.map((r) => `${r.code}: ${r.detail}`).join("; ") : "a span is missing" });

  // Joint tickets can name different people without creating an identity collision.
  const form = m?.name?.form ?? null;
  const sharing = form === null ? [] : [...input.subjects.values()].filter((other) => campaignNameForms(other).some((f) => f.form === form));
  const filedHost = subject.filingWebsites?.some(website => siteHost(website.url) === siteHost(artifact.canonicalUrl));
  const placed = sharing.filter((other) => {
    if (filedHost && !other.filingWebsites?.some(website => siteHost(website.url) === siteHost(artifact.canonicalUrl))) return false;
    const probe = verifyCampaignSitePage(other, { url: artifact.canonicalUrl, origin: "RECORDED_SITE", ref: "identity-probe" }, input.read);
    return probe.measurement !== null && probe.measurement.name !== null && (probe.measurement.office !== null || probe.measurement.district !== null);
  });
  const unique = form !== null && placed.length === 1 && placed[0]!.candidacyId === subject.candidacyId && subject.readerKeys.length > 0;
  checks.push(unique
    ? { name: "CANONICAL_IDENTITY_UNIQUE", result: "PASS", detail: `"${form}" names exactly one of ${input.subjects.size} canonical candidacies with its office or district here (${subject.candidacyId}); ${subject.readerKeys.length} exact Reader key(s)` }
    : { name: "CANONICAL_IDENTITY_UNIQUE", result: "FAIL", detail: form === null ? "the page names no form of the candidate" : `"${form}" is shared by ${sharing.length} candidacy(ies), ${placed.length} placed here (${placed.map((p) => p.candidacyId).join(", ") || "none"}); ${subject.readerKeys.length} Reader key(s)` });

  const burdens: string[] = [];
  if (m === null) burdens.push("no measurement");
  else {
    if (!m.finalUrl.startsWith("https://")) burdens.push("final URL not HTTPS");
    if (m.httpStatus < 200 || m.httpStatus >= 300) burdens.push(`HTTP ${m.httpStatus}`);
    const control = accessControlIn({ status: m.httpStatus, text: input.read.body });
    if (control !== null) burdens.push(`an access control answered in place of the page (${control.detail})`);
    if (m.permissions.length === 0) burdens.push("no robots reading is recorded for the read");
    if (campaignSiteHostRefusal(m.finalUrl) !== null) burdens.push(`host refused: ${campaignSiteHostRefusal(m.finalUrl)!.code}`);
    if (m.branding === null) burdens.push("neither host nor title names the candidate");
    if (Date.parse(input.now) - Date.parse(m.retrievedAt) > MAX_READ_AGE_MS) burdens.push(`read ${m.retrievedAt} is older than ${MAX_READ_AGE_MS / 86_400_000} days`);
    if (`sha256-${m.sha256}` !== artifact.contentHash) burdens.push(`the read's sha256 ${m.sha256} is not the vaulted ${artifact.contentHash}`);
  }
  checks.push(burdens.length === 0
    ? { name: "ASSERTION_CLASS_BURDENS", result: "PASS", detail: `campaign-site burdens hold: HTTPS 2xx HTML, robots.txt read first and recorded (${m!.permissions.map((p) => `${p.origin} ${p.verdict}`).join(", ")}; evidence, not a gate), ${m!.branding!.evidence}, read ${m!.retrievedAt}, vaulted ${artifact.contentHash}` }
    : { name: "ASSERTION_CLASS_BURDENS", result: "FAIL", detail: burdens.join("; ") });

  /* Rendering symmetry: the link renders through the one campaign slot every candidate's link uses, from one sentence template, with no label and nothing about party. */
  const sentence = verdict.verdict === "VERIFIED" ? verdict.verification : "";
  const template = /^Fetched \d{4}-\d{2}-\d{2} \(campaign-site-verifier\/1\): '.+' — names .+, the (office|district) \(".+"\)(?:, and|; https:\/\/\S+ identifies) the \d{4} election\.$/;
  checks.push(template.test(sentence)
    ? { name: "NEUTRALITY_AND_RENDERING_SYMMETRY", result: "PASS", detail: "renders as links[key].campaign {url, verification, attemptedAt, evidence} — the slot and sentence template every verified campaign link uses; no label, no party read, identical rules for every candidate" }
    : { name: "NEUTRALITY_AND_RENDERING_SYMMETRY", result: "FAIL", detail: `the verification sentence does not follow the one template: ${JSON.stringify(sentence)}` });

  /* False zero: the item states a present fact only; nothing it produces says a candidate has no site. */
  checks.push(verdict.verdict === "VERIFIED"
    ? { name: "FALSE_ZERO", result: "PASS", detail: "the item asserts a verified site; a refused lead is never published as an absence, and no prior link or recorded hunt is removed" }
    : { name: "FALSE_ZERO", result: "FAIL", detail: "a refused lead offers nothing to state" });
  return checks;
}

function zeroStages(): Record<PipelineStage, number> {
  return { SCOUTED: 0, VERIFIED: 0, APPROVED_FOR_PROMOTION: 0 };
}

// An identical refusal appends nothing; new evidence still receives a new decision.
function alreadyRefused(state: PipelineItemState | undefined, offered: TransitionRecord): RefusedRecord | null {
  if (state === undefined) return null;
  const wanted = canonicalJson(offered);
  return state.records.find((r): r is RefusedRecord => r.stage === "REFUSED" && r.offered.recordId === offered.recordId && canonicalJson(r.offered) === wanted) ?? null;
}

async function scopedMatches<T>(log: AppendOnlyRepository<T>, path: readonly string[], values: readonly string[]): Promise<T[]> {
  if (!log.keysWhere) throw new Error("CAMPAIGN_STATE_FILTER_UNAVAILABLE");
  const out: T[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < values.length; offset += 16) {
    const batches = await Promise.all(values.slice(offset, offset + 16).map(async value => {
      const keys = await log.keysWhere!(path, value);
      return (await Promise.all(keys.map(key => log.readWhere(key, path, value)))).flat();
    }));
    for (const row of batches.flat()) {
      const key = canonicalJson(row);
      if (!seen.has(key)) { seen.add(key); out.push(row); }
    }
  }
  return out;
}

export async function projectCampaignSiteChains(repos: ControlPlaneRepositories, options: CampaignSiteChainOptions): Promise<CampaignSiteChainReport> {
  const offers: { stage: PipelineStage; itemId: string; accepted: boolean; refusalCodes: string[] }[] = [];
  const leadsOut: CampaignSiteLeadOutcome[] = [];
  const unjoined: { itemId: string; subjectId: string }[] = [];
  const maxReads = options.maxReads ?? 200;
  const subjectIds = [...new Set([...options.subjects.values()].flatMap(subject => [subject.candidacyId, ...subject.readerKeys]))];
  const scouts = await scopedMatches(repos.scoutResults, ["subjectId"], subjectIds);
  const workIds = new Set(scouts.map(row => row.workItemId));
  const leads = await repos.boxFindings.waitingFor(CAMPAIGN_SITE_LEAD, BOX_LEADS_PER_PASS, subjectIds);
  for (let offset = 0; offset < subjectIds.length; offset += 16) {
    const ids = subjectIds.slice(offset, offset + 16);
    const work = await Promise.all(ids.flatMap(id => [id, `campaign-site:${id}`]).map(id => repos.workItems.listWhere(["subject"], id)));
    for (const row of work.flat()) workIds.add(row.id);
  }
  if (!repos.promotionPipeline.keysWhere) throw new Error("CAMPAIGN_STATE_FILTER_UNAVAILABLE");
  const readCampaignStates = async () => new Map((await readPipelineStatesWhere(repos, subjectIds.flatMap(value => [
    { path: ["subjectId"], value }, { path: ["offered", "subjectId"], value },
  ]))).filter(row => row.recordClass === CAMPAIGN_SITE_RECORD_CLASS).map(row => [row.itemId, row]));
  let heldStates = await readCampaignStates();
  const cited = [...new Set([...heldStates.values()].flatMap(row => row.records.flatMap(record =>
    "artifactIds" in record ? record.artifactIds ?? [] : [])))];
  const allArtifacts: ArtifactRecord[] = [];
  const byArtifact = new Map<string, ArtifactRecord>();
  const heldReads = new Map<string, ArtifactRecord>();
  const attempts = new Map<string, Attempt>();
  const results = [...(await readByKeys(repos.workerResults, [...workIds])).values()].flat();
  let ctx: PipelineContext = contextFromRecords([], [], results);
  const includeArtifacts = async (rows: readonly ArtifactRecord[]) => {
    for (const row of rows) if (!byArtifact.has(row.artifactId)) {
      byArtifact.set(row.artifactId, row);
      allArtifacts.push(row);
      const previous = heldReads.get(row.canonicalUrl);
      if (/html/i.test(row.contentType) && !row.partial && (!previous || row.recordedAt > previous.recordedAt)) heldReads.set(row.canonicalUrl, row);
    }
    const ids = [...new Set(rows.map(row => row.attemptId).concat(results.map(row => row.attemptId),
      (options.marginalia ?? []).map(row => row.attemptId)))].filter(id => !attempts.has(id));
    const found = repos.attempts.readMany ? await repos.attempts.readMany(ids)
      : (await Promise.all(ids.map(id => repos.attempts.read(id)))).filter(row => row !== null);
    for (const row of found) attempts.set(row.id, row.value);
    ctx = contextFromRecords(allArtifacts, [...attempts.values()], results);
  };
  await includeArtifacts([...[...(await readByKeys(repos.artifacts, [...workIds])).values()].flat(),
    ...await scopedMatches(repos.artifacts, ["artifactId"], cited)]);
  const loadedUrls = new Set<string>();
  const includeUrl = async (url: string) => {
    if (loadedUrls.has(url)) return;
    loadedUrls.add(url);
    await includeArtifacts(await scopedMatches(repos.artifacts, ["canonicalUrl"], [url]));
  };
  const profiles = profileIndex(allArtifacts, options);
  const offer = async (record: TransitionRecord): Promise<PipelineItemState> => {
    const held = heldStates.get(record.itemId);
    const refused = alreadyRefused(held, record);
    if (held !== undefined && refused !== null) {
      offers.push({ stage: record.stage, itemId: record.itemId, accepted: false, refusalCodes: refused.reasons.map((r) => r.code) });
      return held;
    }
    const out = await appendTransition(repos, record, ctx, options.now);
    offers.push({ stage: record.stage, itemId: record.itemId, accepted: out.accepted, refusalCodes: out.accepted || out.record.stage !== "REFUSED" ? [] : out.record.reasons.map((r) => r.code) });
    heldStates.set(record.itemId, out.state);
    return out.state;
  };

  for (const subject of options.subjects.values()) for (const website of subject.filingWebsites ?? []) {
    const itemId = discoveryPointerItemId(subject.candidacyId, website.url);
    if (heldStates.get(itemId)?.byStage.SCOUTED) continue;
    const instance = `campaign-site-ballot:${subject.candidacyId}`;
    await offer({
      formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:scouted`, itemId, at: options.now,
      actor: { role: "ACQUIRER", lane: "DETERMINISTIC", instance }, stage: "SCOUTED",
      source: { kind: "PROMOTED_CANDIDACY", candidacyId: subject.candidacyId, sourceUrl: website.sourceUrl, websiteUrl: website.url },
      recordClass: CAMPAIGN_SITE_RECORD_CLASS, subjectId: subject.candidacyId, canonicalUrl: website.url,
      artifactIds: [], scoutAttemptId: instance, summary: `The election authority lists ${website.url} for ${displayName(subject)}.`,
    });
  }

  // Paid Scout findings can precede every parser result. Their existing
  // SCOUTED representation must reach this plain-code pass independently.
  for (const scout of scouts) {
    if (scout.recordClass !== CAMPAIGN_SITE_RECORD_CLASS) continue;
    for (const scouted of scoutedFromScoutResult(scout)) {
      if (!heldStates.get(scouted.itemId)?.byStage.SCOUTED) await offer(scouted);
    }
  }

  // A hunter's campaign-site finding becomes a lead once checkFact holds it on its own saved page; one for a candidacy no ballot holds waits.
  const windowHours = leads.length ? factClocks((await readRuntimeAdminConfig(repos, ["settings"]))?.value ?? null).windowHours : () => 0;
  for (const finding of leads) {
    const subject = options.subjects.get(finding.subjectId) ?? [...options.subjects.values()].find(row => row.readerKeys.includes(finding.subjectId));
    if (subject === undefined) {
      await holdBoxFinding(repos.boxFindings, finding.id, { class: "campaign sites", reason: "CANDIDACY_ON_NO_BALLOT", slots: FINDING_SLOTS_VERSION }, options.now);
      continue;
    }
    const scouted = await boxLead(repos, finding, subject, options, windowHours);
    const claim = await takeBoxFinding(repos.boxFindings, finding.id, "campaign-site-chain", options.now, new Date(Date.parse(options.now) + 120_000).toISOString());
    if (claim === null) continue;
    if ("refused" in scouted) { await finishBoxFinding(repos.boxFindings, finding.id, claim.token, { state: "refused", reason: scouted.refused }, options.now); continue; }
    if (!heldStates.get(scouted.itemId)?.byStage.SCOUTED) await offer(scouted);
    await finishBoxFinding(repos.boxFindings, finding.id, claim.token, { state: "built", publicationId: scouted.itemId }, options.now);
  }

  /* SCOUTED: every Marginalia pointer that is a lead becomes its own item, once: a later answer naming the same page is the same lead. */
  let pointersOffered = 0;
  for (const held of options.marginalia ?? []) {
    const subject = options.subjects.get(held.subjectId);
    if (subject === undefined) { unjoined.push({ itemId: held.artifactId, subjectId: held.subjectId }); continue; }
    const found = marginaliaLeads(held, subject);
    for (const refused of found.refused) leadsOut.push({ itemId: null, subjectId: held.subjectId, lead: { url: refused.url, origin: "MARGINALIA_POINTER", ref: held.artifactId }, outcome: "REFUSED", refusals: [refused.refusal], historical: null, via: "NONE" });
    for (const lead of found.leads) {
      const itemId = discoveryPointerItemId(held.subjectId, lead.url);
      if (heldStates.get(itemId)?.byStage.SCOUTED !== undefined) continue;
      pointersOffered += 1;
      const role: WorkerRole = ctx.attemptRoleById(held.attemptId) ?? "ACQUIRER";
      const scouted: ScoutedRecord = {
        formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:scouted`, itemId, at: held.retrievedAt,
        actor: { role, lane: "DETERMINISTIC", instance: held.attemptId }, stage: "SCOUTED",
        source: { kind: "DISCOVERY_POINTER", routeId: MARGINALIA_ROUTE_ID, attemptId: held.attemptId, artifactId: held.artifactId, pointerUrl: lead.url, rank: lead.rank },
        recordClass: CAMPAIGN_SITE_RECORD_CLASS, subjectId: held.subjectId, canonicalUrl: lead.url, artifactIds: [held.artifactId], scoutAttemptId: held.attemptId,
        summary: `POINTER #${lead.rank} from ${MARGINALIA_ROUTE_ID}: ${lead.url}${lead.title ? ` ("${lead.title}")` : ""}`,
      };
      await offer(scouted);
    }
  }
  if (pointersOffered > 0) heldStates = await readCampaignStates();

  /* Publishable missing links precede already linked candidacies. Advance
   * held verified items before spending requests on the discovery backlog. */
  const rotate = (s: PipelineItemState): string => (options.rotation === undefined ? "" : fingerprint([options.rotation, s.itemId]));
  const settledNow = (): ReadonlySet<string> => {
    const settled = new Set(options.linkedCandidacies ?? []);
    for (const s of heldStates.values()) {
      if (s.recordClass === CAMPAIGN_SITE_RECORD_CLASS && s.stage === "APPROVED_FOR_PROMOTION" && s.subjectId !== null) settled.add(s.subjectId);
    }
    return settled;
  };
  const inReadOrder = (items: readonly PipelineItemState[]): PipelineItemState[] => {
    const settled = settledNow();
    const rank = (s: PipelineItemState): number => (settled.has(s.subjectId ?? "") ? 1 : 0);
    return [...items].sort((a, b) => rank(a) - rank(b) || rotate(a).localeCompare(rotate(b)) || a.itemId.localeCompare(b.itemId));
  };
  const pastScouted = (s: PipelineItemState): boolean => s.recordClass === CAMPAIGN_SITE_RECORD_CLASS && s.stage !== null && s.stage !== "SCOUTED";

  let readsUsed = 0;
  const approved: CampaignSiteApprovedRecord[] = [];
  const rereadsUsed = 0;
  const approve = async (state: PipelineItemState, subject: CampaignSiteSubject): Promise<PipelineItemState> => {
    const verifiedRecord = state.byStage.VERIFIED!;
    const artifactId = verifiedRecord.artifactIds?.[0] ?? "";
    const artifact = byArtifact.get(artifactId) ?? null;
    if (artifact === null) return state;
    await includeUrl(artifact.canonicalUrl);
    const read = await options.heldPage(artifact);
    if (read === null) return state;
    /* The verdict the approval rests on is re-made from the vaulted bytes, never carried from the read. */
    const independent = await independentProfileSignal(subject, artifact, profiles, options, read);
    const verdict = verifyCampaignSitePage(subject, { url: artifact.canonicalUrl, origin: "RECORDED_SITE", ref: verifiedRecord.recordId }, read, independent?.supporting);
    if (verdict.verdict !== "VERIFIED") return state;
    const scouted = state.byStage.SCOUTED!;
    const failedChecks = verifiedRecord.checks.filter((c) => c.result !== "PASS").map((c) => c.name);
    const host = siteHost(artifact.canonicalUrl) ?? "";
    // Only a later read of this exact page can contradict it, not another page on the same host.
    const newer = allArtifacts.filter((a) => a.canonicalUrl === artifact.canonicalUrl && a.recordedAt > artifact.recordedAt && a.attemptId !== artifact.attemptId && ctx.attemptRoleById(a.attemptId) === "ACQUIRER")
      .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0];
    const newerPage = newer === undefined ? null : await options.heldPage(newer);
    const newerVerdict = newer === undefined || newerPage === null ? null : verifyCampaignSitePage(subject, { url: newer.canonicalUrl, origin: "RECORDED_SITE", ref: newer.artifactId }, newerPage, independent?.supporting);
    const age = Date.parse(options.now) - Date.parse(verdict.measurement.retrievedAt);
    const burdens: ApprovalBurden[] = [
      { name: "CHAIN_CHECKS_PASS", result: failedChecks.length === 0 ? "PASS" : "FAIL", detail: failedChecks.length === 0 ? `all ${verifiedRecord.checks.length} checks PASS on ${verifiedRecord.recordId}` : `${failedChecks.join(", ")} not PASS on ${verifiedRecord.recordId}` },
      { name: "FACT_CURRENT", result: newerVerdict !== null && newerVerdict.verdict !== "VERIFIED" ? "FAIL" : "PASS",
        detail: newerVerdict === null ? `no later read of ${artifact.canonicalUrl} by our own Attempt contradicts ${artifact.artifactId}` : `the newest read ${newer!.artifactId} of ${artifact.canonicalUrl} ${newerVerdict.verdict === "VERIFIED" ? "agrees" : `no longer verifies (${newerVerdict.refusals.map((r) => r.code).join(", ")})`}` },
      { name: "FRESHNESS_NOT_STALE", result: age <= MAX_READ_AGE_MS ? "PASS" : "FAIL", detail: `the verifying read is ${Math.round(age / 3_600_000)}h old; the bound is ${MAX_READ_AGE_MS / 86_400_000} days` },
    ];
    const record: CampaignSiteApprovedRecord = {
      formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${state.itemId}:approved:${verifiedRecord.recordId}`, itemId: state.itemId, at: verifiedRecord.at,
      actor: { role: "RELEASE_ORCHESTRATOR", lane: "DETERMINISTIC", instance: `${CAMPAIGN_SITE_APPROVER_ID}@${state.itemId}` },
      stage: "APPROVED_FOR_PROMOTION",
      chain: { scouted: scouted.recordId, verified: verifiedRecord.recordId },
      recordClass: CAMPAIGN_SITE_RECORD_CLASS, burdens, field: CAMPAIGN_SITE_FIELD,
      campaignSite: {
        field: CAMPAIGN_SITE_FIELD,
        candidacyId: subject.candidacyId,
        candidateName: displayName(subject),
        identity: {
          candidacyId: subject.candidacyId, givenName: subject.givenName, familyName: subject.familyName,
          officeTitle: subject.officeTitle, ocdId: subject.ocdId, stateCode: subject.stateCode, cycle: subject.cycle,
        },
        readerKeys: subject.readerKeys,
        url: verdict.measurement.finalUrl,
        host,
        verification: verdict.verification,
        evidence: {
          verifierId: CAMPAIGN_SITE_VERIFIER_ID,
          artifactId: artifact.artifactId,
          attemptId: artifact.attemptId,
          sha256: artifact.contentHash.replace(/^sha256-/, ""),
          requestedUrl: verdict.measurement.requestedUrl,
          finalUrl: verdict.measurement.finalUrl,
          httpStatus: verdict.measurement.httpStatus,
          contentType: verdict.measurement.contentType,
          readAt: verdict.measurement.retrievedAt,
          ...(verdict.measurement.cycle.source ? { cycleSource: verdict.measurement.cycle.source } : {}),
        },
        publicationDoor: CAMPAIGN_SITE_PUBLICATION_DOOR,
      },
    };
    return offer(record);
  };
  const advance = async (initial: PipelineItemState): Promise<void> => {
    if (!pastScouted(initial)) return;
    const subject = options.subjects.get(initial.subjectId ?? "");
    if (subject === undefined) return;
    const state = initial.stage === "VERIFIED" ? await approve(initial, subject) : initial;
    if (state.stage === "APPROVED_FOR_PROMOTION") {
      const held = state.byStage.APPROVED_FOR_PROMOTION as CampaignSiteApprovedRecord;
      if (held.campaignSite !== undefined) approved.push(held);
    }
  };
  const advancedFirst = new Set<string>();
  for (const initial of inReadOrder([...heldStates.values()].filter(pastScouted))) {
    advancedFirst.add(initial.itemId);
    await advance(initial);
  }

  const readCache = new Map<string, { result: LeadReadResult; artifact: ArtifactRecord | null; via: "READ" | "VAULT" }>();
  let judgedFromVault = 0;
  const pending: { state: PipelineItemState; subject: CampaignSiteSubject; verdicts: { lead: CampaignSiteLead; verdict: CampaignSiteVerdict; artifact: ArtifactRecord }[] }[] = [];
  for (const state of inReadOrder([...heldStates.values()].filter((s) =>
    s.recordClass === CAMPAIGN_SITE_RECORD_CLASS && s.byStage.SCOUTED !== undefined &&
    (s.byStage.SCOUTED.source.kind === "SCOUT_RESULT" || s.byStage.SCOUTED.source.kind === "DISCOVERY_POINTER" || s.byStage.SCOUTED.source.kind === "PROMOTED_CANDIDACY")))) {
    const subject = options.subjects.get(state.subjectId ?? "");
    if (subject === undefined) { unjoined.push({ itemId: state.itemId, subjectId: state.subjectId ?? "" }); continue; }
    if (state.stage !== "SCOUTED") continue;
    const verdicts: (typeof pending)[number]["verdicts"] = [];
    for (const lead of (await scoutLeads(state, ctx, subject, options.heldPage)).slice(0, MAX_LEADS_PER_ITEM)) {
      const pre = campaignSiteHostRefusal(lead.url);
      if (pre !== null) { leadsOut.push({ itemId: state.itemId, subjectId: subject.candidacyId, lead, outcome: "REFUSED", refusals: [pre], historical: null, via: "NONE" }); continue; }
      await includeUrl(lead.url);
      let cached = readCache.get(lead.url);
      const earlier = cached === undefined && options.recheckAfterMs !== undefined ? heldReads.get(lead.url) : undefined;
      if (earlier !== undefined && Date.parse(options.now) - Date.parse(earlier.recordedAt) < options.recheckAfterMs!) {
        const page = await options.heldPage(earlier);
        if (page !== null) {
          judgedFromVault += 1;
          cached = { result: { ok: true, read: page }, artifact: earlier, via: "VAULT" };
          readCache.set(lead.url, cached);
        }
      }
      if (cached === undefined) {
        if (readsUsed >= maxReads) {
          leadsOut.push({ itemId: state.itemId, subjectId: subject.candidacyId, lead, outcome: "DEFERRED", refusals: [{ code: "NOT_READ", detail: `the ${maxReads}-read bound for this run was reached; the lead stays owed` }], historical: null, via: "NONE" });
          continue;
        }
        readsUsed += 1;
        const result = await options.readLead(lead);
        /* A lead the caller did not read (its own time bound) was not a read: it stays owed and uses none of the run's reads. */
        if (!result.ok && result.refusal.code === "NOT_READ") readsUsed -= 1;
        const artifact = result.ok ? await options.recordRead(subject.candidacyId, lead, result.read) : null;
        if (artifact !== null) {
          await includeArtifacts([artifact]);
        }
        cached = { result, artifact, via: "READ" };
        readCache.set(lead.url, cached);
      }
      if (!cached.result.ok || cached.artifact === null) {
        const refusal = cached.result.ok ? { code: "TRANSPORT_FAILED" as const, detail: "the read was not recorded" } : cached.result.refusal;
        leadsOut.push({ itemId: state.itemId, subjectId: subject.candidacyId, lead, outcome: refusal.code === "NOT_READ" ? "DEFERRED" : "REFUSED", refusals: [refusal], historical: null, via: refusal.code === "NOT_READ" ? "NONE" : "READ" });
        continue;
      }
      const independent = await independentProfileSignal(subject, cached.artifact, profiles, options, cached.result.read);
      const verdict = verifyCampaignSitePage(subject, lead, cached.result.read, independent?.supporting);
      verdicts.push({ lead, verdict, artifact: cached.artifact });
      leadsOut.push({ itemId: state.itemId, subjectId: subject.candidacyId, lead, outcome: verdict.verdict,
        refusals: verdict.verdict === "REFUSED" ? verdict.refusals : [], historical: verdict.verdict === "REFUSED" ? verdict.historical?.years ?? null : null, via: cached.via });
    }
    pending.push({ state, subject, verdicts });
  }
  for (const { state, subject, verdicts } of pending) {
    const verified = verdicts.filter((v) => v.verdict.verdict === "VERIFIED");
    const hosts = [...new Set(verified.map((v) => siteHost(v.artifact.canonicalUrl)))];
    /* A refused page that still names the candidate was a plausible site: its refusal is recorded on the item. */
    const named = verdicts.filter((v) => v.verdict.verdict === "REFUSED" && v.verdict.measurement !== null && v.verdict.measurement.name !== null);
    const chosen = hosts.length === 1
      ? [...verified].sort((a, b) => sitePathLength(a.artifact.canonicalUrl) - sitePathLength(b.artifact.canonicalUrl) || a.artifact.canonicalUrl.localeCompare(b.artifact.canonicalUrl))[0]!
      : verified[0] ?? named[0] ?? null;
    if (chosen === null) continue;
    const read = await options.heldPage(chosen.artifact);
    if (read === null) continue;
    const checks = campaignSiteChecks({ subject, verdict: chosen.verdict, read, artifact: chosen.artifact, subjects: options.subjects, now: options.now })
      .map((check): VerificationCheck => hosts.length > 1 && check.name === "CANONICAL_IDENTITY_UNIQUE"
        ? { ...check, result: "FAIL", detail: `MULTIPLE_SITES: ${hosts.join(", ")} each verify for ${displayName(subject)}; one campaign link is never chosen by guess` }
        : check);
    await offer({
      formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${state.itemId}:verified:${fingerprint([CAMPAIGN_SITE_VERIFIER_ID, chosen.artifact.artifactId])}`,
      itemId: state.itemId, at: chosen.artifact.recordedAt,
      actor: { role: "VALIDATOR", lane: "DETERMINISTIC", instance: `${CAMPAIGN_SITE_VERIFIER_ID}@${state.itemId}` },
      stage: "VERIFIED", checks, artifactIds: [chosen.artifact.artifactId],
    });
  }

  /* Advance newly verified items from the sources this pass now holds. */
  for (const initial of inReadOrder([...heldStates.values()].filter((s) => pastScouted(s) && !advancedFirst.has(s.itemId)))) await advance(initial);

  /* Every offer's outcome replaced its item's state as it was made, so the final count needs no second read of the log. */
  const finalStates = [...heldStates.values()].filter((s) => s.recordClass === CAMPAIGN_SITE_RECORD_CLASS);
  const byStage = zeroStages();
  for (const s of finalStates) if (s.stage !== null) byStage[s.stage] += 1;
  return { version: CAMPAIGN_SITE_CHAIN_VERSION, items: finalStates.length, byStage, leads: leadsOut, offers, unjoined, approved, readsUsed, rereadsUsed, judgedFromVault };
}
