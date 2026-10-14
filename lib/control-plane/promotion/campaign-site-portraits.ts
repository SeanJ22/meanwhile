import { candidatePortraitFromCommons, candidatePortraitFromOwnSite, type CommonsPortraitRuntime } from "../../ballot/candidate-portraits.ts";
import type { PortraitRuntime } from "../../photos/store.ts";
import type { CandidatePortraitPatch } from "../../ballot/candidate-portraits.ts";
import type { DerivedInputRef } from "../../civic-data/derived-authority.ts";
import type { DerivedCandidatePortraitRecord } from "../../civic-data/derived-campaign-sites.ts";
import type { CampaignSiteSubject } from "./campaign-site-chain.ts";
import { reverifyApprovedSite, type DerivedCampaignSitesPlan, type HeldVerifyingRead, type PublishableCampaignSiteApproval } from "../../civic-data/derived-campaign-site-writer.ts";

export async function publishCampaignSitePortraits(input: {
  readonly plan: DerivedCampaignSitesPlan;
  readonly approvals: readonly PublishableCampaignSiteApproval[];
  readonly subjects?: readonly CampaignSiteSubject[];
  readonly held: (approval: PublishableCampaignSiteApproval) => HeldVerifyingRead | null;
  readonly now: string;
  readonly portraitRuntime?: PortraitRuntime;
  readonly commonsRuntime?: CommonsPortraitRuntime;
  readonly onPublished?: (plan: DerivedCampaignSitesPlan) => Promise<void>;
}): Promise<DerivedCampaignSitesPlan> {
  const portraits = new Map((input.plan.portraits ?? []).map(record => [record.id, record]));
  const inputs = [...input.plan.inputs];
  const result = (): DerivedCampaignSitesPlan => ({ ...input.plan,
    inputs: [...new Map(inputs.map(value => [JSON.stringify(value), value])).values()],
    portraits: [...portraits.values()].sort((a, b) => a.id.localeCompare(b.id)) });
  const byCandidacy = new Map<string, PublishableCampaignSiteApproval[]>();
  const subjects = new Map((input.subjects ?? []).map(subject => [subject.candidacyId, subject]));
  for (const approval of input.approvals) {
    const site = approval.campaignSite;
    byCandidacy.set(site.candidacyId, [...(byCandidacy.get(site.candidacyId) ?? []), approval]);
    const prior = subjects.get(site.candidacyId);
    subjects.set(site.candidacyId, { ...site.identity, filingDomains: [],
      readerKeys: [...new Set([...(prior?.readerKeys ?? []), ...site.readerKeys])] });
  }
  for (const [candidacyId, subject] of subjects) {
    if (subject.readerKeys.every(key => portraits.get(key)?.candidacyId === candidacyId)) continue;
    let patch: CandidatePortraitPatch | null = null;
    const approvals = (byCandidacy.get(candidacyId) ?? [])
      .sort((a, b) => b.campaignSite.evidence.readAt.localeCompare(a.campaignSite.evidence.readAt));
    for (const approval of approvals) {
      const site = approval.campaignSite, held = input.held(approval);
      if (!held || !reverifyApprovedSite(approval, held).ok) continue;
      try {
        const portrait = await candidatePortraitFromOwnSite({ identity: site.identity, cycleSource: held.cycleSource, capture: {
            evidence: { artifactId: site.evidence.artifactId, contentHash: `sha256-${site.evidence.sha256}`, text: held.body,
              canonicalUrl: site.evidence.finalUrl, retrievedAt: site.evidence.readAt, sourceId: new URL(site.url).hostname,
              acquiredByAttemptId: site.evidence.attemptId, methodRouteId: site.evidence.verifierId },
            observedAt: site.evidence.readAt, httpStatus: site.evidence.httpStatus, transport: "REACHABLE", partial: false,
          } }, input.now, input.portraitRuntime);
        if ("patch" in portrait) {
          patch = portrait.patch;
          inputs.push({ kind: "VAULTED_EVIDENCE", artifactId: site.evidence.artifactId,
            contentHash: `sha256-${site.evidence.sha256}`, tier: held.tier, retrievedAt: site.evidence.readAt });
          break;
        }
      } catch (error) { console.error(`Candidate portrait remains owed for ${candidacyId}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!patch) {
      try {
        const portrait = await candidatePortraitFromCommons(subject, input.now, input.commonsRuntime ?? { portrait: input.portraitRuntime });
        if ("patch" in portrait) {
          patch = portrait.patch;
          for (const source of patch.photoVerification!.sources) inputs.push({ kind: "VAULTED_EVIDENCE", artifactId: source.artifactId ?? source.vaultKey!,
            contentHash: source.contentHash, tier: "RAW", retrievedAt: source.retrievedAt } satisfies DerivedInputRef);
        }
      } catch (error) { console.error(`Commons portrait remains owed for ${candidacyId}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!patch) continue;
    const candidateName = `${subject.givenName} ${subject.familyName}`.replace(/\s+/g, " ").trim();
    for (const id of subject.readerKeys) portraits.set(id, { id, candidacyId, candidateName, portrait: patch } satisfies DerivedCandidatePortraitRecord);
    await input.onPublished?.(result());
  }
  return result();
}
