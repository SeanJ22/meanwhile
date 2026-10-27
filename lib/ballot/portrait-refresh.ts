import { candidatePortraitFromCommons, candidatePortraitFromOwnSite, type CommonsPortraitRuntime } from "./candidate-portraits.ts";
import type { PortraitRuntime } from "../photos/store.ts";
import { portraitHash } from "../photos/evidence.ts";
import { acquireKnownRelease, type KnownRelease } from "../sources/known-release.ts";
import type { CandidatePortraitPatch } from "./candidate-portraits.ts";
import type { DerivedInputRef } from "../civic-data/derived-authority.ts";
import type { DerivedCandidatePortraitRecord } from "../civic-data/derived-campaign-sites.ts";
import type { CampaignSiteSubject } from "../control-plane/promotion/campaign-site-chain.ts";
import type { DerivedCampaignSitesPlan } from "../civic-data/derived-campaign-site-writer.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";

/** A known campaign page or Commons file publishes its own portrait under §3. */
export async function publishCandidatePortraits(input: {
  readonly plan: DerivedCampaignSitesPlan;
  readonly subjects: readonly CampaignSiteSubject[];
  readonly sites?: ReadonlyMap<string, readonly string[]>;
  readonly capture?: (url:string) => Promise<KnownRelease>;
  readonly now: string;
  readonly portraitRuntime?: PortraitRuntime;
  readonly commonsRuntime?: CommonsPortraitRuntime;
  readonly onPublished?: (plan: DerivedCampaignSitesPlan) => Promise<void>;
  readonly retryMinutes?: number;
  readonly signal?: AbortSignal;
  readonly subjectsComplete?: boolean;
}): Promise<DerivedCampaignSitesPlan> {
  const portraits = new Map((input.plan.portraits ?? []).map(record => [record.id, record]));
  const inputs = [...input.plan.inputs];
  const subjectIds = new Set(input.subjects.map(subject => subject.candidacyId));
  const attempts = Object.fromEntries(Object.entries(input.plan.portraitWork?.attempts ?? {}).filter(([id]) => subjectIds.has(id)));
  const pending = new Set(input.subjects.map(subject => subject.candidacyId));
  const due: number[] = [];
  const retryMs = (input.retryMinutes ?? 1440) * 60_000;
  const now = Date.parse(input.now);
  const owed = new Set(input.plan.portraitWork?.pending ?? []);
  const subjects = [...input.subjects].sort((left, right) => Number(!owed.has(left.candidacyId)) - Number(!owed.has(right.candidacyId)));
  const result = (): DerivedCampaignSitesPlan => ({ ...input.plan,
    inputs: [...new Map(inputs.map(value => [JSON.stringify(value), value])).values()],
    portraitWork: { attempts, pending: [...pending], inputsComplete: input.subjectsComplete ?? true, retryMinutes: retryMs / 60_000,
      nextDueAt: pending.size ? input.now : due.length ? new Date(Math.min(...due)).toISOString() : null },
    portraits: [...portraits.values()].sort((a, b) => a.id.localeCompare(b.id)) });
  const capture=input.capture ?? (url=>acquireKnownRelease({sourceId:"candidate-portrait-page",releaseId:url,url,
    allowedHosts:[new URL(url).hostname],parserVersion:"candidate-portrait-page/1",maxBytes:2_000_000,
    checkAfterMs:7*86_400_000,signal:input.signal ? AbortSignal.any([input.signal,AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),headers:{accept:"text/html"}}));
  for (const subject of subjects) {
    if (input.signal?.aborted) return result();
    const candidacyId=subject.candidacyId;
    if (subject.readerKeys.every(key => {
      const held=portraits.get(key);
      return held?.candidacyId === candidacyId && Date.parse(input.now)-Date.parse(held.portrait.photoVerification?.checkedAt ?? "") < 7*86_400_000;
    })) {
      pending.delete(candidacyId);
      due.push(...subject.readerKeys.map(key => Date.parse(portraits.get(key)!.portrait.photoVerification!.checkedAt) + 7 * 86_400_000));
      continue;
    }
    let patch: CandidatePortraitPatch | null = null;
    const urls=[...new Set([...(input.sites?.get(candidacyId) ?? []),...(subject.filingWebsites ?? []).map(site=>site.url)])];
    const inputHash = canonicalCivicDataHash([subject, [...urls].sort()]);
    const previous = attempts[candidacyId];
    if (previous?.inputHash === inputHash && Date.parse(previous.attemptedAt) + retryMs > now) {
      pending.delete(candidacyId); due.push(Date.parse(previous.attemptedAt) + retryMs); continue;
    }
    for (const url of urls) {
      if (input.signal?.aborted) return result();
      try {
        const page=await capture(url);
        if(!page.vaultKey)throw Error("Portrait source page was not saved");
        const portrait = await candidatePortraitFromOwnSite({ identity: subject, capture: {
          evidence:{vaultKey:page.vaultKey,contentHash:portraitHash(page.bytes),text:new TextDecoder().decode(page.bytes),
            canonicalUrl:page.finalUrl,retrievedAt:page.retrievedAt,sourceId:"candidate-portrait-page"},
          observedAt:page.checkedAt,httpStatus:page.httpStatus,transport:"REACHABLE",partial:false,
        } }, new Date(Math.max(Date.parse(input.now),Date.parse(page.checkedAt))).toISOString(), input.portraitRuntime, input.signal);
        if ("patch" in portrait) {
          patch = portrait.patch;
          inputs.push({kind:"VAULTED_EVIDENCE",artifactId:page.vaultKey,contentHash:portraitHash(page.bytes),tier:"RAW",retrievedAt:page.retrievedAt});
          break;
        }
      } catch (error) { console.error(`Candidate portrait remains owed for ${candidacyId}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!patch && !input.signal?.aborted) {
      try {
        const portrait = await candidatePortraitFromCommons(subject, input.now, { ...(input.commonsRuntime ?? { portrait: input.portraitRuntime }), signal: input.signal });
        if ("patch" in portrait) {
          patch = portrait.patch;
          for (const source of patch.photoVerification!.sources) inputs.push({ kind: "VAULTED_EVIDENCE", artifactId: source.artifactId ?? source.vaultKey!,
            contentHash: source.contentHash, tier: "RAW", retrievedAt: source.retrievedAt } satisfies DerivedInputRef);
        }
      } catch (error) { console.error(`Commons portrait remains owed for ${candidacyId}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (input.signal?.aborted) return result();
    attempts[candidacyId] = { inputHash, attemptedAt: input.now };
    pending.delete(candidacyId);
    if (!patch) { due.push(now + retryMs); continue; }
    const candidateName = `${subject.givenName} ${subject.familyName}`.replace(/\s+/g, " ").trim();
    for (const id of subject.readerKeys) portraits.set(id, { id, candidacyId, candidateName, portrait: patch } satisfies DerivedCandidatePortraitRecord);
    due.push(Date.parse(patch.photoVerification!.checkedAt) + 7 * 86_400_000);
    await input.onPublished?.(result());
  }
  return result();
}
