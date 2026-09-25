/**
 * **APPROVED CAMPAIGN SITES → THE CANDIDATE-PROFILES PROJECTION, THROUGH THE ONE
 * DOOR.** (2026-09-25.)
 *
 * ## Why the manual `candidate-profiles` contract, not a new derived contract
 *
 * The Reader already renders `links[key].campaign` from the promoted
 * `candidate-profiles` projection (`lib/ballot/candidate-sites.ts`, /ballot and
 * Ask), so a verified site published there reaches readers with no Reader
 * change. That contract is SOURCE-ISOLATED: `manualProjectionCandidate` with
 * the prior GOOD version as its base admits each current member only when every
 * URL it cites is supported by exact receipted bytes, and carries every prior
 * member forward byte-exactly, so a successor that names only the new sites
 * cannot drop or overwrite anything the owner reviewed. Its validator, typed
 * Reader verification and LKG are the ones every candidate profile already
 * passes. A C16-style DERIVED contract would need a second profile store, a
 * second Reader and a runner clock to reach the same card; it adds a writer
 * and a Reader change to publish what this contract already publishes.
 *
 * What this module does NOT do is choose when to run. The contract is
 * EXPLICIT_OWNER_INVOCATION_ONLY: this builds the package and, given a store,
 * enters `processRegisteredManualCandidate`; the production invocation is the
 * installed-runtime `manual-promote --contract=candidate-profiles` door with
 * the package this writes (scripts/replay-research-findings.mts).
 *
 * ## The rules the package obeys
 *
 * - Only APPROVED campaign-site items, and only while the activation gate opens
 *   `candidate-enrichment` for `campaignSite`.
 * - The identity join is exact: an approval carries the canonical candidacy's
 *   own Reader keys (its ballot ids, and a lineup key only where a nominee's
 *   name shares an exact name form). Nothing is keyed by a guess.
 * - A key whose prior member already holds a campaign link is left alone: a
 *   verified link is never replaced by this writer. A prior official link is
 *   carried forward with the prior receipt's exact bytes for it; an official
 *   link with no receipted bytes holds the key, named.
 * - Two different verified hosts for one candidacy hold that candidacy, named:
 *   one campaign link is never chosen by guess.
 * - Every published link carries its evidence: sha256, URL read, time read,
 *   verifier id, and the approval it rests on.
 */
import type { CandidateLinks, VerifiedLink } from "../ballot/candidate-sites.ts";
import type { CampaignSiteApprovedRecord } from "../control-plane/promotion/campaign-site-chain.ts";
import type { ActivationGateReading } from "../control-plane/promotion/types.ts";
import { classFieldOpen } from "../control-plane/promotion/activation-gate.ts";
import type { CandidateProfilesProjection, ManualProjectionPackage, ManualProjectionPrior } from "./manual-projections.ts";
import type { ManualSourceReview } from "./types.ts";
import { sitePathLength } from "../candidates/campaign-site-verifier.ts";

export const CAMPAIGN_SITE_WRITER_ID = "campaign-site-writer/1";

export const CAMPAIGN_SITE_HOLDS = [
  "GATE_CLOSED",
  "MULTIPLE_VERIFIED_SITES",
  "PRIOR_CAMPAIGN_LINK_HELD",
  "PRIOR_OFFICIAL_LINK_UNRECEIPTED",
  "NO_READER_KEY",
] as const;
export type CampaignSiteHoldCode = (typeof CAMPAIGN_SITE_HOLDS)[number];

export interface CampaignSitePublicationPlan {
  /** Null when nothing is publishable; the holds say why. */
  readonly package: ManualProjectionPackage | null;
  readonly published: readonly { readonly key: string; readonly candidacyId: string; readonly url: string; readonly approvalRecordId: string }[];
  readonly held: readonly { readonly key: string; readonly code: CampaignSiteHoldCode; readonly detail: string }[];
}

/**
 * The evidence a machine-verified campaign link carries beside the Reader's
 * `VerifiedLink` fields: the verifier's robots-first read and the approval it
 * passed. Carried in the projection for provenance; the Reader does not render
 * it, so its type stays here rather than in `lib/ballot/candidate-sites.ts`.
 */
export interface CampaignLinkEvidence {
  readonly verifierId: string;
  /** sha256 (bare hex) of the exact vaulted bytes. */
  readonly sha256: string;
  /** The URL requested; the link's `url` is where it answered. */
  readonly requestedUrl: string;
  readonly readAt: string;
  readonly approvalRecordId: string;
}

/** A campaign link as this writer publishes it. */
export type EvidencedLink = VerifiedLink & { readonly evidence: CampaignLinkEvidence };

function priorLinks(prior: ManualProjectionPrior | null): Readonly<Record<string, CandidateLinks>> {
  const links = (prior?.payload as CandidateProfilesProjection | undefined)?.links?.links;
  return links && typeof links === "object" ? links : {};
}

/** The prior receipt's exact supported bytes for one URL, carried verbatim. */
function priorSourcesFor(prior: ManualProjectionPrior | null, url: string): ManualSourceReview[] {
  return (prior?.sourceReceipt.sources ?? []).filter((source) =>
    (source.reviewOutcome ?? "SUPPORTED") === "SUPPORTED" && (source.finalUrl === url || source.requestedUrl === url));
}

/**
 * Plan the `candidate-profiles` successor for every APPROVED campaign site.
 * Pure: the caller reads the prior and hands in the gate and the clock.
 */
export function planCampaignSitePublication(input: {
  readonly approved: readonly CampaignSiteApprovedRecord[];
  readonly prior: ManualProjectionPrior | null;
  readonly gate: Pick<ActivationGateReading, "promotionEnabled" | "openRecordClasses" | "openFields">;
  readonly reviewedAt: string;
}): CampaignSitePublicationPlan {
  const held: { key: string; code: CampaignSiteHoldCode; detail: string }[] = [];
  if (!classFieldOpen(input.gate, "candidate-enrichment", "campaignSite")) {
    return { package: null, published: [], held: [{ key: "*", code: "GATE_CLOSED", detail: "the activation gate does not open candidate-enrichment for campaignSite; nothing is published" }] };
  }
  const byCandidacy = new Map<string, CampaignSiteApprovedRecord[]>();
  for (const record of input.approved) {
    if (record.campaignSite === undefined) continue;
    byCandidacy.set(record.campaignSite.candidacyId, [...(byCandidacy.get(record.campaignSite.candidacyId) ?? []), record]);
  }
  const links: Record<string, CandidateLinks> = {};
  const sources = new Map<string, ManualSourceReview>();
  const published: { key: string; candidacyId: string; url: string; approvalRecordId: string }[] = [];
  const prior = priorLinks(input.prior);
  for (const [candidacyId, records] of [...byCandidacy].sort(([a], [b]) => a.localeCompare(b))) {
    const hosts = [...new Set(records.map((r) => r.campaignSite.host))].sort();
    if (hosts.length > 1) {
      held.push({ key: candidacyId, code: "MULTIPLE_VERIFIED_SITES", detail: `${hosts.join(", ")} each verified for ${records[0]!.campaignSite.candidateName}; one campaign link is never chosen by guess` });
      continue;
    }
    const chosen = [...records].sort((a, b) => sitePathLength(a.campaignSite.url) - sitePathLength(b.campaignSite.url) ||
      a.campaignSite.url.localeCompare(b.campaignSite.url) || a.recordId.localeCompare(b.recordId))[0]!;
    const site = chosen.campaignSite;
    if (site.readerKeys.length === 0) {
      held.push({ key: candidacyId, code: "NO_READER_KEY", detail: `${candidacyId} joins no Reader key; nothing is keyed by a guess` });
      continue;
    }
    /* One person, one campaign link: a link under ANY of their Reader keys holds every key, so two keys never disagree. */
    const linked = site.readerKeys.find((key) => prior[key]?.campaign);
    if (linked !== undefined) {
      held.push({ key: linked, code: "PRIOR_CAMPAIGN_LINK_HELD", detail: `${linked} already carries the verified campaign link ${prior[linked]!.campaign!.url} for ${site.candidateName}; this writer never replaces or doubles one` });
      continue;
    }
    for (const key of site.readerKeys) {
      const before = prior[key] ?? null;
      const official = before?.official ?? null;
      const officialSources = official === null ? [] : priorSourcesFor(input.prior, official.url);
      if (official !== null && officialSources.length === 0) {
        held.push({ key, code: "PRIOR_OFFICIAL_LINK_UNRECEIPTED", detail: `${key}'s official link ${official.url} has no receipted bytes in the prior version, so the member cannot be re-proved; it is left as it was` });
        continue;
      }
      const evidence: CampaignLinkEvidence = {
        verifierId: site.evidence.verifierId,
        sha256: site.evidence.sha256,
        requestedUrl: site.evidence.requestedUrl,
        readAt: site.evidence.readAt,
        approvalRecordId: chosen.recordId,
      };
      const campaign: EvidencedLink = { url: site.url, verification: site.verification, attemptedAt: site.evidence.readAt.slice(0, 10), evidence };
      links[key] = { official, campaign };
      for (const source of officialSources) sources.set(`${source.finalUrl}\n${source.rawHash}`, source);
      const review: ManualSourceReview = {
        requestedUrl: site.evidence.requestedUrl,
        finalUrl: site.evidence.finalUrl,
        publisher: `${site.candidateName} campaign (${site.host})`,
        sourceClass: "CANDIDATE_CONTROLLED",
        retrievedAt: site.evidence.readAt,
        httpStatus: site.evidence.httpStatus,
        rawHash: site.evidence.sha256,
        reviewedEvidence:
          `${site.verification} Chain ${chosen.chain.scouted} → ${chosen.recordId}: robots-first read ${site.evidence.artifactId} by ` +
          `ACQUIRER Attempt ${site.evidence.attemptId}; five checks PASS; audit (${site.audit.startedFrom.join(", ")}) ${site.audit.secondSignal}.`,
      };
      sources.set(`${review.finalUrl}\n${review.rawHash}`, review);
      published.push({ key, candidacyId, url: site.url, approvalRecordId: chosen.recordId });
    }
  }
  if (published.length === 0) return { package: null, published, held };
  const payload: CandidateProfilesProjection = {
    /* Empty strings keep the prior card header and note; the source-scoped merge retains every prior card. */
    cards: { curatedAt: "", note: "", cards: {}, hunts: [] },
    links: { curatedAt: input.reviewedAt.slice(0, 10), note: "", links, hunts: [] },
  };
  return {
    package: {
      contractId: "candidate-profiles",
      version: input.reviewedAt,
      sourceThrough: input.reviewedAt,
      sourceReceipt: {
        contractVersion: 1,
        reviewedAt: input.reviewedAt,
        reviewedBy: `${CAMPAIGN_SITE_WRITER_ID} — deterministic campaign-site chain; automatic promotion of qualifying results authorized by Sean 2026-09-21 (RULING 292)`,
        sources: [...sources.values()].sort((a, b) => `${a.finalUrl}\n${a.rawHash}`.localeCompare(`${b.finalUrl}\n${b.rawHash}`)),
      },
      payload,
    },
    published,
    held,
  };
}
