/**
 * **APPROVED CAMPAIGN SITES → READERS: AUTOMATICALLY THROUGH THE DERIVED DOOR,
 * AND AS AN OWNER PACKAGE THROUGH THE MANUAL ONE.** (2026-09-25.)
 *
 * ## The automatic path: `candidate-campaign-sites-derived`
 *
 * Sean, 2026-09-21: "You may enable automatic promotion for qualifying
 * results. Fix the gap, recover value already paid for." (RULING 292.) The
 * `candidate-profiles` contract is EXPLICIT_OWNER_INVOCATION_ONLY and its
 * pointer has one writer, the owner's door; a routine adapter may not reach a
 * manual door (the civic-data firewall), and a clocked second writer of that
 * pointer would race the owner's reviewed packages. So the standing runner
 * publishes approved sites to a pointer of its own, the DERIVED routine
 * contract `candidate-campaign-sites-derived`, the C16 door pattern: a version
 * is authentic only as its named inputs (every pipeline approval it read, the
 * vaulted bytes of each published site's verifying read, and the promoted
 * `candidate-profiles` version it was composed against), checked by the
 * validator and, for the promoted version, at the door.
 * `lib/civic-data/derived-campaign-site-writer.ts` plans it and
 * `scripts/derive-candidate-campaign-sites.mts` is the runner's child: its
 * import closure holds no filesystem writer, so this module (which reaches the
 * chain's types) is not in it. Before citing an approval the writer verifies its vaulted
 * bytes again for the approval's own canonical identity, so what publishes is
 * what the vault proves today. The profile Reader composes the two stores, a
 * reviewed campaign link always winning (`lib/civic-data/derived-campaign-sites.ts`).
 *
 * ## The owner's path: a `candidate-profiles` successor package
 *
 * `planCampaignSitePublication` builds a source-isolated successor for the
 * owner's installed-runtime `manual-promote --contract=candidate-profiles`
 * door (scripts/replay-research-findings.mts writes it). That door stays the
 * only writer of profiles; nothing on a clock invokes it.
 *
 * ## The rules the package obeys
 *
 * - Only APPROVED campaign-site items, and only while the activation gate opens
 *   `candidate-enrichment` for `campaignSite`.
 * - The identity join is exact: an approval carries the canonical candidacy's
 *   own Reader keys (its ballot ids, and a lineup key only where a nominee's
 *   name shares an exact name form). Nothing is keyed by a guess.
 * - A prior campaign link accepts newer verified evidence for the same URL;
 *   conflicting URLs and unproved observation dates remain held. A prior official link is
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
import type { CandidateProfilesProjection, ManualProjectionPackage, ManualProjectionPrior } from "./manual-projections.ts";
import type { ManualSourceReview } from "./types.ts";
import { sitePathLength } from "../candidates/campaign-site-verifier.ts";
import { campaignLinkRefreshIssue } from "./campaign-link-refresh.ts";

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
      a.campaignSite.url.localeCompare(b.campaignSite.url) ||
      b.campaignSite.evidence.readAt.localeCompare(a.campaignSite.evidence.readAt) || a.recordId.localeCompare(b.recordId))[0]!;
    const site = chosen.campaignSite;
    if (site.readerKeys.length === 0) {
      held.push({ key: candidacyId, code: "NO_READER_KEY", detail: `${candidacyId} joins no Reader key; nothing is keyed by a guess` });
      continue;
    }
    /* One person, one campaign link: a conflict under ANY key holds the whole candidacy. */
    const refresh = { url: site.url, attemptedAt: site.evidence.readAt.slice(0, 10) };
    const linked = site.readerKeys.find((key) => campaignLinkRefreshIssue(prior[key]?.campaign, refresh) !== null);
    if (linked !== undefined) {
      held.push({ key: linked, code: "PRIOR_CAMPAIGN_LINK_HELD", detail: `${linked}: ${campaignLinkRefreshIssue(prior[linked]?.campaign, refresh)}; the working link for ${site.candidateName} is preserved` });
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
          `ACQUIRER Attempt ${site.evidence.attemptId}; candidate, office and cycle verified on the saved page.`,
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
