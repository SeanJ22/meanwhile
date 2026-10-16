import { candidatePortraitFromCommonsFile, type CandidatePortraitPatch, type CommonsPortraitRuntime } from "../ballot/candidate-portraits.ts";
import type { CandidateCardData } from "../ballot/candidate-cards.ts";
import type { CampaignSiteIdentity } from "../candidates/campaign-site-verifier.ts";
import { findingFact, finishBoxFinding, holdBoxFinding, takeBoxFinding, type BoxFinding, type BoxRepository } from "../control-plane/box.ts";
import { readHeldBytes, type HeldVaultArtifact } from "../control-plane/evidence/read-only-vault.ts";
import { section3Page } from "../control-plane/promotion/section3.ts";
import { manualClassForKind } from "../control-plane/promotion/source-kinds.ts";
import { checkFact, hostOf, linkQuote, type FieldKind, type Provenance } from "../facts/check.ts";
import { CANDIDATE_PROFILE_LEAD, candidateChecklistId, FINDING_SLOTS_VERSION } from "../facts/finding-slots.ts";
import type { Clocks } from "../facts/publish.ts";
import { pageCopy } from "../facts/source-copy.ts";
import type { PortraitVerification } from "../photos/binding.ts";
import type { PortraitCapture } from "../photos/evidence.ts";
import { storeVerifiedPortrait, type PortraitRuntime } from "../photos/store.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { sourceAuthority } from "./source-authority.ts";
import type { CandidateProfilesProjection } from "./manual-projections.ts";
import { prepareManualProjectionSuccessor } from "./manual-successor.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { readPromotedCivicData } from "./read-model.ts";
import type { RoutineDataStore } from "./store.ts";
import type { ManualSourceReview } from "./types.ts";

const PROFILES = requiredManualProductionContract("candidate-profiles");
const EMPTY_CARD: CandidateCardData = { photoUrl: null, photoSource: null, bio: null, bioSourceUrl: null, bioSourceLabel: null,
  email: null, phone: null, phoneLabel: null, filedAddress: null, filedAddressSource: null };
const KIND: Readonly<Record<string, FieldKind>> = { "CAN-06": "contact", "CAN-16": "statement", "CAN-17": "portrait" };
const PROVENANCE = new Set<string>(["OFFICIAL", "CAMPAIGN", "FILING", "REFERENCE", "NEWS"]);
const COMMONS_HOSTS = ["commons.wikimedia.org", "upload.wikimedia.org"];
const PROFILE_CLASSES = new Set<string>(sourceAuthority(PROFILES.sourceId)?.manualReceiptPromotion?.allowedSourceClasses ?? []);

/** A candidate a finding can be about: its identity on the ballot and every key readers look its card up by. */
export type CandidateFindingSubject = CampaignSiteIdentity & { readonly readerKeys: readonly string[] };

interface CandidateFindingsReport {
  readonly published: Readonly<Record<string, number>>;
  readonly refused: Readonly<Record<string, number>>;
  /** Findings for a candidacy no promoted ballot holds yet; they stay in the Box. */
  readonly waiting: number;
}

type Outcome = { readonly patch: Partial<CandidateCardData>; readonly sources: readonly ManualSourceReview[] } | { readonly refused: string };

const review = (url: string, sha: string, retrievedAt: string, sourceClass: ManualSourceReview["sourceClass"], httpStatus = 200): ManualSourceReview => ({
  requestedUrl: url, finalUrl: url, publisher: hostOf(url), sourceClass, retrievedAt, httpStatus, rawHash: sha.replace(/^sha256-/, ""),
  reviewOutcome: "SUPPORTED", reviewedEvidence: "Saved page held to checkFact: the value is on it, it names the candidate, and it is inside its freshness window." });

/** Every page a portrait's verification cites, as reviewed sources, so the published card's addresses are all receipted. */
function portraitSources(verification: PortraitVerification, sourceClass: ManualSourceReview["sourceClass"]): ManualSourceReview[] {
  return [...verification.sources.map(source => review(source.url, source.contentHash, source.retrievedAt, sourceClass)),
    review(verification.imageUrl, verification.sourceImageHash, verification.imageRetrievedAt ?? verification.checkedAt, sourceClass)];
}

const CANDIDATE_FINDINGS_PER_PASS = 500;

/** Hunters' bios, campaign contacts and portraits for candidates, each held to checkFact on its saved page, published on the candidate's profile card. */
export async function publishCandidateFindings(input: {
  readonly boxFindings: BoxRepository;
  readonly held: (artifactId: string) => Promise<HeldVaultArtifact | null>;
  readonly store: RoutineDataStore;
  readonly subjects: readonly CandidateFindingSubject[];
  /** Each candidacy's approved campaign-site hosts: a contact counts only on the candidate's own campaign site. */
  readonly campaignHosts: ReadonlyMap<string, readonly string[]>;
  readonly clocks: Clocks;
  readonly now: string;
  readonly portrait?: PortraitRuntime;
  readonly commons?: CommonsPortraitRuntime;
}): Promise<CandidateFindingsReport> {
  const report = { published: {} as Record<string, number>, refused: {} as Record<string, number>, waiting: 0 };
  const now = new Date(input.now);
  const settled: { row: BoxFinding; field: string; outcome: Outcome; subject: CandidateFindingSubject | null }[] = [];
  for (const row of await input.boxFindings.waitingFor(CANDIDATE_PROFILE_LEAD, CANDIDATE_FINDINGS_PER_PASS)) {
    const subject = input.subjects.find(s => s.candidacyId === row.subjectId || s.readerKeys.includes(row.subjectId));
    if (!subject) {
      await holdBoxFinding(input.boxFindings, row.id, { class: "candidates", reason: "CANDIDACY_ON_NO_BALLOT", slots: FINDING_SLOTS_VERSION }, input.now);
      report.waiting++; continue;
    }
    const fact = findingFact(row);
    if (!fact || row.exactQuote === null) { settled.push({ row, field: "", outcome: { refused: "FINDING_HAS_NO_FIELD_VALUE_OR_QUOTE" }, subject }); continue; }
    const field = candidateChecklistId(fact.field, fact.value) ?? fact.field;
    settled.push({ row, field, subject,
      outcome: await candidateOutcome(input, subject, field, String(fact.value), row.exactQuote, fact.origin.artifactIds, now) });
  }

  const ready = settled.filter((entry): entry is typeof entry & { outcome: Extract<Outcome, { patch: unknown }>; subject: CandidateFindingSubject } =>
    "patch" in entry.outcome && entry.subject !== null);
  let held: string | null = null;
  if (ready.length) {
    const prior = await readPromotedCivicData<CandidateProfilesProjection>(PROFILES.recordClass, PROFILES.scope, { store: input.store, now: input.now, bypassCache: true });
    const priorCards = prior.kind === "PROMOTED" ? prior.value.cards.cards : {};
    const cards: Record<string, CandidateCardData> = {};
    for (const { subject, outcome } of ready) for (const key of [subject.candidacyId, ...subject.readerKeys]) {
      cards[key] = { ...EMPTY_CARD, ...priorCards[key], ...cards[key], ...outcome.patch };
    }
    const sources = [...new Map(ready.flatMap(entry => entry.outcome.sources).map(source => [`${source.finalUrl}\n${source.rawHash}`, source])).values()];
    try {
      const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor({ contractId: "candidate-profiles", version: input.now,
        sourceThrough: input.now, sourceReceipt: { contractVersion: 1, reviewedAt: input.now, reviewedBy: "code:checkFact", sources },
        payload: { cards: { curatedAt: input.now, note: "Hunters' findings, each held to checkFact on its saved page.", cards, hunts: [] },
          links: { curatedAt: input.now, note: "", links: {}, hunts: [] } } }, input.store, input.now);
      const outcome = await processRegisteredManualCandidate(input.store, "candidate-profiles", candidate, input.now, expectedBaseVersionId);
      if (!outcome.promoted) held = `CANDIDATE_PROFILE_PUBLICATION_HELD:${outcome.candidate.failureDetail ?? outcome.candidate.state}`;
    } catch (error) { held = `CANDIDATE_PROFILE_PUBLICATION_HELD:${error instanceof Error ? error.message : String(error)}`; }
  }

  for (const { row, field, outcome } of settled) {
    const claim = await takeBoxFinding(input.boxFindings, row.id, "candidate-profile-writer", input.now, new Date(now.getTime() + 120_000).toISOString());
    if (!claim) continue;
    const refused = "refused" in outcome ? outcome.refused : held;
    if (refused) {
      await finishBoxFinding(input.boxFindings, row.id, claim.token, { state: "refused", reason: refused }, input.now);
      report.refused[refused.split(":")[0]!] = (report.refused[refused.split(":")[0]!] ?? 0) + 1;
    } else {
      await finishBoxFinding(input.boxFindings, row.id, claim.token, { state: "built", publicationId: `candidate-profiles:${field}:${row.subjectId}` }, input.now);
      report.published[field] = (report.published[field] ?? 0) + 1;
    }
  }
  return report;
}

async function candidateOutcome(input: Parameters<typeof publishCandidateFindings>[0], subject: CandidateFindingSubject, field: string, value: string,
  quote: string, artifactIds: readonly string[], now: Date): Promise<Outcome> {
  const kind = KIND[field];
  if (!kind) return { refused: "NO_CANDIDATE_FIELD" };
  const artifact = artifactIds.length ? await input.held(artifactIds[0]!) : null;
  if (!artifact?.canonicalUrl || !artifact.retrievedAt) return { refused: "CITED_PAGE_NOT_SAVED" };
  const url = artifact.canonicalUrl, retrievedAt = artifact.retrievedAt;
  const text = new TextDecoder().decode(await readHeldBytes(artifact));
  const hosts = input.campaignHosts.get(subject.candidacyId) ?? [];
  const campaign = hosts.includes(hostOf(url));
  const pageKind = campaign ? "CAMPAIGN" : COMMONS_HOSTS.includes(hostOf(url)) ? "REFERENCE" : section3Page({ url, text, retrievedAt }, "CANDIDATE_PROFILE", input.now).kind;
  const provenance = (PROVENANCE.has(pageKind) ? pageKind : "OTHER") as Provenance;
  const name = `${subject.givenName} ${subject.familyName}`.replace(/\s+/g, " ").trim();
  const checked = checkFact({ entity: { id: subject.candidacyId, fullName: name, stateName: null, hosts, externalIds: [] }, fieldKind: kind, provenance,
    // A portrait cited by its own page's address is held by the page naming the candidate in the quoted sentence.
    valueText: value === url ? name : value, quote: value === url ? quote : linkQuote(value, quote), copy: pageCopy({ finalUrl: url, body: text, contentType: artifact.contentType, fetchedAt: retrievedAt }) },
  now, input.clocks.windowHours);
  if (!checked.ok) return { refused: checked.reason };
  const pageClass = manualClassForKind(pageKind as Parameters<typeof manualClassForKind>[0]);
  if (!PROFILE_CLASSES.has(pageClass)) return { refused: `SOURCE_CLASS_NOT_ACCEPTED_FOR_PROFILES:${pageClass}` };
  const page = review(url, artifact.contentHash, retrievedAt, pageClass, artifact.httpStatus ?? 200);
  const read = `${hostOf(url)}, read ${retrievedAt.slice(0, 10)}`;
  if (field === "CAN-16") return { patch: { bio: value, bioSourceUrl: url, bioSourceLabel: read }, sources: [page] };
  if (field === "CAN-06") {
    if (!campaign) return { refused: "CONTACT_NOT_ON_THE_CAMPAIGN_SITE" };
    return { patch: value.includes("@") ? { email: value } : { phone: value, phoneSource: `${url}, read ${retrievedAt.slice(0, 10)}` }, sources: [page] };
  }
  let portrait: { readonly patch: CandidatePortraitPatch } | { readonly gap: string };
  try {
    if (COMMONS_HOSTS.includes(hostOf(value)) || COMMONS_HOSTS.includes(hostOf(url))) {
      portrait = await candidatePortraitFromCommonsFile(subject, COMMONS_HOSTS.includes(hostOf(value)) ? value : url, input.now, input.commons ?? { portrait: input.portrait });
    } else {
      const capture: PortraitCapture = { evidence: { artifactId: artifact.id, contentHash: artifact.contentHash, text, canonicalUrl: url, retrievedAt,
        sourceId: artifact.sourceId ?? hostOf(url) }, observedAt: retrievedAt, httpStatus: artifact.httpStatus, transport: "REACHABLE", partial: false };
      const photo = await storeVerifiedPortrait(subject.candidacyId, { subject: { personId: subject.candidacyId, name, profileUrls: [url] }, imageUrl: value,
        captures: [capture], ...(campaign ? { campaign: { identity: subject, url } } : {}) }, input.now, input.portrait, "candidates");
      portrait = photo.verification?.basis === "OWN_PAGE"
        ? { patch: { personId: subject.candidacyId, photoUrl: photo.url, photoSource: `Portrait from ${hostOf(url)}`, photoVerification: photo.verification } }
        : { gap: "PORTRAIT_NEEDS_THE_CANDIDATES_OWN_OR_AN_OFFICIAL_PAGE" };
    }
  } catch (error) { return { refused: error instanceof Error ? error.message : String(error) }; }
  if ("gap" in portrait) return { refused: portrait.gap };
  const commons = portrait.patch.photoVerification!.basis === "COMMONS";
  return { patch: portrait.patch, sources: [...commons ? [] : [page], ...portraitSources(portrait.patch.photoVerification!, commons ? "REFERENCE_PUBLISHER" : pageClass)] };
}
