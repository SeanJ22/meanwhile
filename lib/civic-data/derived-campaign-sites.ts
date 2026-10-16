import { AsyncLocalStorage } from "node:async_hooks";
import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { requireBallotState, stateBallotContractId, stateBallotScope, type BallotState } from "../ballot/state-scopes.ts";
import {
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { campaignLinkRefreshIssue } from "./campaign-link-refresh.ts";
import { createHash } from "node:crypto";
import type { CampaignSiteSourceReference } from "../candidates/campaign-site-verifier.ts";
import { portraitBindingMatches } from "../photos/binding.ts";
import type { CandidatePortraitPatch } from "../ballot/candidate-portraits.ts";
import type { CandidateDocument } from "../candidates/corpus.ts";

export interface VerifiedLinkShape {
  readonly url: string;
  readonly verification: string;
  readonly attemptedAt: string;
  readonly label?: string;
}
export interface CandidateLinksShape {
  readonly official: VerifiedLinkShape | null;
  readonly campaign: VerifiedLinkShape | null;
}

export const derivedCampaignSitesContractId = (state: string) => stateBallotContractId("candidate-campaign-sites-derived", state);
export const derivedCampaignSitesScope = (state: string) => stateBallotScope("candidate-campaign-sites-derived", state);
export const DERIVED_CAMPAIGN_SITES_SOURCE_ID = "candidate-campaign-site-chain" as const;
export const DERIVED_CAMPAIGN_SITES_RECORD_CLASS = "CURATED_READER_RECORD" as const;

export interface DerivedCampaignSiteEvidence {
  readonly verifierId: string;
  readonly artifactId: string;
  readonly attemptId: string;
  /** sha256 (bare hex) of the exact vaulted bytes. */
  readonly sha256: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly readAt: string;
  readonly cycleSource?: CampaignSiteSourceReference;
  readonly approvalItemId: string;
  readonly approvalRecordId: string;
  readonly approvedAt: string;
  readonly secondSignal?: string;
}

/** A deeper page inherits publisher identity from a separately approved site
 * and an exact saved href; its own completed capture remains a distinct fact. */
export interface DerivedLinkedPublicationEvidence {
  readonly kind: "LINKED_PAGE";
  readonly approvalItemId: string;
  readonly approvalRecordId: string;
  readonly sourceArtifactId: string;
  readonly sourceContentHash: string;
  readonly sourceUrl: string;
  readonly hrefStart: number;
  readonly hrefEnd: number;
  readonly hrefQuote: string;
  readonly offsetUnit: "UTF16_CODE_UNITS";
  readonly artifactId: string;
  readonly attemptId: string;
  readonly sha256: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly readAt: string;
}

export type DerivedCampaignLink = VerifiedLinkShape & { readonly evidence: DerivedCampaignSiteEvidence };

export interface DerivedCampaignSiteRecord {
  readonly id: string;
  readonly candidacyId: string;
  readonly candidateName: string;
  readonly campaign: DerivedCampaignLink;
  /** Already verified page versions, deterministically transcribed from the
   * same vault. Older GOOD versions without this field remain readable. */
  readonly publications?: readonly { readonly document: CandidateDocument; readonly evidence: DerivedCampaignSiteEvidence | DerivedLinkedPublicationEvidence }[];
}

export interface DerivedCandidatePortraitRecord {
  readonly id: string;
  readonly candidacyId: string;
  readonly candidateName: string;
  readonly portrait: CandidatePortraitPatch;
}

export interface DerivedCampaignSitesProjection {
  readonly kind: "candidate-campaign-sites-derived";
  readonly formatVersion: 1;
  readonly records: readonly DerivedCampaignSiteRecord[];
  readonly portraits?: readonly DerivedCandidatePortraitRecord[];
}

export const CAMPAIGN_SITE_VERIFICATION_TEMPLATE = /^Fetched \d{4}-\d{2}-\d{2} \(campaign-site-verifier\/1\): '.+' — names .+, the (office|district) \(".+"\)(?:, and|; https:\/\/\S+ identifies) the \d{4} election\.$/;

const SHA256 = /^[a-f0-9]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const calendarDay = (value: string): boolean => {
  if (!DAY.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** URL, raw bytes, extracted text and extractor together identify a source revision. */
export function derivedCandidateRevisionId(input: { readonly candidateKey: string; readonly documentUrl: string;
  readonly rawContentHash: string; readonly contentHash: string; readonly extractorVersion: number }): string {
  return createHash("sha256").update(JSON.stringify([input.candidateKey, input.documentUrl, input.rawContentHash,
    input.contentHash, input.extractorVersion])).digest("hex");
}

export function derivedCandidateDocumentId(candidateKey: string, contentHash: string, revisionId: string): string {
  return `${candidateKey}@${contentHash}~${revisionId}`;
}
const https = (value: unknown): boolean => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** Why a projection is not a derived campaign-sites version, or null. Checked on every read: a malformed version is never served. */
export function derivedCampaignSitesProjectionIssue(value: unknown): string | null {
  const v = value as Partial<DerivedCampaignSitesProjection> | null;
  if (typeof v !== "object" || v === null || v.kind !== "candidate-campaign-sites-derived" || v.formatVersion !== 1 || !Array.isArray(v.records)) {
    return "not a derived candidate campaign-sites version";
  }
  const ids = new Set<string>();
  const urlByCandidacy = new Map<string, string>();
  for (const record of v.records) {
    const link = record?.campaign;
    const evidence = link?.evidence;
    if (!record || !text(record.id) || ids.has(record.id)) return "a record has no Reader key, or a duplicate one";
    ids.add(record.id);
    if (!text(record.candidacyId) || !text(record.candidateName)) return `${record.id} names no canonical candidacy`;
    if (!link || !https(link.url)) return `${record.id}: its campaign link is not an https URL`;
    if (!CAMPAIGN_SITE_VERIFICATION_TEMPLATE.test(link.verification ?? "")) return `${record.id}: its verification does not follow the one sentence template`;
    if (!DAY.test(link.attemptedAt ?? "")) return `${record.id}: its read date is not a day`;
    if (link.label !== undefined) return `${record.id}: a verified campaign link carries no label`;
    if (!evidence || !SHA256.test(evidence.sha256 ?? "") || !text(evidence.artifactId) || !text(evidence.attemptId) || !text(evidence.verifierId) ||
        !instant(evidence.readAt) || evidence.readAt.slice(0, 10) !== link.attemptedAt || !https(evidence.finalUrl) || !text(evidence.requestedUrl) ||
        !Number.isInteger(evidence.httpStatus) || evidence.httpStatus < 200 || evidence.httpStatus >= 300 ||
        !text(evidence.approvalItemId) || !text(evidence.approvalRecordId) || !instant(evidence.approvedAt)) {
      return `${record.id}: its evidence does not name its vaulted read and its approval exactly`;
    }
    /* One person, one campaign link: every key of one candidacy carries the same site. */
    const prior = urlByCandidacy.get(record.candidacyId);
    if (prior !== undefined && prior !== link.url) return `${record.candidacyId} carries two campaign links (${prior}, ${link.url})`;
    urlByCandidacy.set(record.candidacyId, link.url);
    const documentIds = new Set<string>();
    const revisions = new Map<string, CandidateDocument>();
    for (const publication of record.publications ?? []) {
      const { document: d, evidence: e } = publication;
      const revision = d?.sourceRevision;
      const expectedId = revision
        ? derivedCandidateDocumentId(d.candidateKey, d.contentHash, derivedCandidateRevisionId({ candidateKey: d.candidateKey,
          documentUrl: d.documentUrl, rawContentHash: revision.rawContentHash, contentHash: d.contentHash,
          extractorVersion: revision.extractionVersion }))
        : `${d?.candidateKey}@${d?.contentHash}`;
      const date = d?.publicationDate;
      if (!d || !e || d.candidateKey !== record.id || documentIds.has(d.id) || d.id !== expectedId ||
          d.sourceClass !== "CAMPAIGN_SITE" || d.basis !== "HUNTED_AND_VERIFIED" || d.extraction !== "html" || !text(d.text) ||
          createHash("sha256").update(d.text).digest("hex") !== d.contentHash ||
          !SHA256.test(e.sha256) || d.sourceContentHash !== e.sha256 || d.documentUrl !== e.finalUrl ||
          (revision !== undefined && (!SHA256.test(revision.revisionId) || revision.revisionId !== expectedId.split("~").at(-1) ||
            revision.artifactId !== e.artifactId || revision.canonicalUrl !== e.finalUrl ||
            revision.rawContentHash !== e.sha256 || revision.capturedAt !== e.readAt ||
            revision.extractionVersion !== (d.extractorVersion ?? 1) ||
            (revision.supersedesRevisionId !== null && !SHA256.test(revision.supersedesRevisionId)))) ||
          (date !== undefined && (!revision || !calendarDay(date.date) || date.basis !== "ARTICLE_PUBLISHED_TIME_META" ||
            date.artifactId !== e.artifactId || date.rawContentHash !== e.sha256 ||
            !Number.isSafeInteger(date.start) || !Number.isSafeInteger(date.end) || date.start < 0 || date.end <= date.start ||
            date.end - date.start !== date.quote.length ||
            date.offsetUnit !== "UTF16_CODE_UNITS" || !text(date.quote) ||
            !/<meta\b/i.test(date.quote) || !/\bproperty\s*=\s*["']article:published_time["']/i.test(date.quote) ||
            !new RegExp(`\\bcontent\\s*=\\s*["']${date.date}(?:T[^"']*)?["']`, "i").test(date.quote))) ||
          !https(d.documentUrl) || new URL(d.documentUrl).hostname !== new URL(link.url).hostname ||
          d.retrievedAt !== e.readAt || !instant(e.readAt) || !text(e.artifactId) || !text(e.approvalRecordId) ||
          !text(e.approvalItemId) || !text(e.attemptId) ||
          ("kind" in e && e.kind === "LINKED_PAGE"
            ? !text(e.sourceArtifactId) || !/^sha256-[a-f0-9]{64}$/.test(e.sourceContentHash) ||
              !https(e.sourceUrl) || !Number.isSafeInteger(e.hrefStart) || !Number.isSafeInteger(e.hrefEnd) ||
              e.hrefStart < 0 || e.hrefEnd <= e.hrefStart || !text(e.hrefQuote) || e.offsetUnit !== "UTF16_CODE_UNITS" ||
              !https(e.requestedUrl) || new URL(e.sourceUrl).hostname !== new URL(d.documentUrl).hostname
            : !instant(e.approvedAt)) ||
          e.httpStatus < 200 || e.httpStatus >= 300) return `${record.id}: candidate publication lacks exact text, identity or captured-byte evidence`;
      documentIds.add(d.id);
      if (revision) revisions.set(revision.revisionId, d);
    }
    for (const { document } of record.publications ?? []) {
      const current = document.sourceRevision;
      if (!current?.supersedesRevisionId) continue;
      const previous = revisions.get(current.supersedesRevisionId)?.sourceRevision;
      if (!previous || previous.canonicalUrl !== current.canonicalUrl ||
        previous.extractionVersion !== current.extractionVersion || previous.capturedAt > current.capturedAt ||
        previous.revisionId === current.revisionId) {
        return `${record.id}: a candidate publication supersession crosses an unproven source lineage`;
      }
    }
  }
  const portraitIds = new Set<string>();
  if (v.portraits !== undefined && !Array.isArray(v.portraits)) return "candidate portraits are not records";
  for (const record of v.portraits ?? []) {
    const portrait = record?.portrait;
    if (!record || !text(record.id) || portraitIds.has(record.id) || !text(record.candidacyId) || !text(record.candidateName) ||
        !portrait?.photoUrl || !portrait.photoSource || portrait.personId !== record.candidacyId ||
        !portraitBindingMatches(record.candidacyId, { url: portrait.photoUrl, sourceUrl: portrait.photoVerification?.imageUrl,
          verification: portrait.photoVerification }, "candidates")) return `${record?.id}: candidate portrait lacks its person and captured-byte binding`;
    portraitIds.add(record.id);
  }
  return null;
}

type DerivedRead = CivicDataReadResult<DerivedCampaignSitesProjection>;
type DerivedReads = { values: Map<BallotState, DerivedRead>; pending: Map<BallotState, Promise<DerivedRead>> };
const requests = new WeakMap<object, DerivedReads>();
const localReads = new AsyncLocalStorage<DerivedReads>();
function reads(): DerivedReads {
  const edge = currentReaderAuthorityEdge() ?? currentReaderSelection();
  let held = edge ? requests.get(edge) : localReads.getStore();
  if (!held) {
    held = { values: new Map(), pending: new Map() };
    if (edge) requests.set(edge, held); else localReads.enterWith(held);
  }
  return held;
}

function install(cache: DerivedReads["values"], state: BallotState, value: DerivedRead): void {
  cache.delete(state);
  cache.set(state, value);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
}

export async function readDerivedCampaignSites(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<DerivedCampaignSitesProjection>> {
  const key = requireBallotState(state), cache = reads().values;
  const result = await readPromotedCivicData<DerivedCampaignSitesProjection>(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, derivedCampaignSitesScope(key), options);
  install(cache, key, result);
  return result;
}

async function refreshDerivedCampaignSitesOnce(state: BallotState, options: PromotedCivicDataReadOptions): Promise<CivicDataReadResult<DerivedCampaignSitesProjection>> {
  const cache = reads().values;
  try { return await readDerivedCampaignSites(state, options); }
  catch (error) {
    const refused: CivicDataReadResult<DerivedCampaignSitesProjection> = { kind: "STORE_UNREACHABLE", value: null,
      metadata: civicDataReadNotInitialized(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, derivedCampaignSitesScope(state), "").metadata,
      code: "STORE_READ_FAILED", detail: `${derivedCampaignSitesContractId(state)}: ${error instanceof Error ? error.message : String(error)}` };
    install(cache, state, refused);
    return refused;
  }
}

export async function refreshDerivedCampaignSites(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<DerivedCampaignSitesProjection>> {
  const key = requireBallotState(state);
  if (Object.values(options).some(value => value !== undefined)) return refreshDerivedCampaignSitesOnce(key, options);
  const cache = reads().pending;
  const active = cache.get(key);
  if (active) return active;
  const pending = refreshDerivedCampaignSitesOnce(key, options);
  cache.set(key, pending);
  try { return await pending; }
  finally { if (cache.get(key) === pending) cache.delete(key); }
}

export function derivedCampaignSitesReadState(state: string): CivicDataReadResult<DerivedCampaignSitesProjection> {
  return reads().values.get(requireBallotState(state)) ?? civicDataReadNotInitialized(DERIVED_CAMPAIGN_SITES_RECORD_CLASS,
    derivedCampaignSitesScope(state), "The state's derived candidate campaign sites have not been read.");
}

export function derivedCampaignSiteHoldingPath(state: string, key: string): string {
  return `civic-data:${DERIVED_CAMPAIGN_SITES_RECORD_CLASS}:${derivedCampaignSitesScope(state)}#/records/${key.replaceAll("~", "~0").replaceAll("/", "~1")}/campaign`;
}

export interface ComposedCandidateLinks<L extends CandidateLinksShape> {
  readonly links: Readonly<Record<string, L | CandidateLinksShape>>;
  readonly derivedKeys: ReadonlySet<string>;
}

export function composeCampaignLinks<L extends CandidateLinksShape>(
  profiles: Readonly<Record<string, L>>,
  derived: readonly DerivedCampaignSiteRecord[],
): ComposedCandidateLinks<L> {
  const byCandidacy = new Map<string, DerivedCampaignSiteRecord[]>();
  for (const record of derived) byCandidacy.set(record.candidacyId, [...(byCandidacy.get(record.candidacyId) ?? []), record]);
  const links: Record<string, L | CandidateLinksShape> = { ...profiles };
  const derivedKeys = new Set<string>();
  for (const records of byCandidacy.values()) {
    if (records.some((record) => campaignLinkRefreshIssue(profiles[record.id]?.campaign, record.campaign) !== null)) continue;
    for (const record of records) {
      links[record.id] = { official: profiles[record.id]?.official ?? null, campaign: record.campaign };
      derivedKeys.add(record.id);
    }
  }
  return { links, derivedKeys };
}

const NO_RECORDS: readonly DerivedCampaignSiteRecord[] = [];

export function currentDerivedCampaignSiteRecords(state: string): readonly DerivedCampaignSiteRecord[] {
  const result = derivedCampaignSitesReadState(state);
  return result.kind === "PROMOTED" ? result.value.records : NO_RECORDS;
}

const documentsByRecords = new WeakMap<readonly DerivedCampaignSiteRecord[], CandidateDocument[]>();
export function currentDerivedCandidateDocuments(state: string): CandidateDocument[] {
  const records = currentDerivedCampaignSiteRecords(state);
  let documents = documentsByRecords.get(records);
  if (!documents) { documents = records.flatMap(record => (record.publications ?? []).map(row => row.document)); documentsByRecords.set(records, documents); }
  return documents;
}

const NO_PORTRAITS: readonly DerivedCandidatePortraitRecord[] = [];
export function currentDerivedCandidatePortraits(state: string): readonly DerivedCandidatePortraitRecord[] {
  const result = derivedCampaignSitesReadState(state);
  return result.kind === "PROMOTED" ? result.value.portraits ?? NO_PORTRAITS : NO_PORTRAITS;
}
