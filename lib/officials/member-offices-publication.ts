/**
 * The daily member-office refresh: each state's promoted Open States offices,
 * published in one package through the curated `member-offices` pointer with a receipt for each file's exact bytes.
 */
import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../civic-data/manual-successor.ts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import { readPromotedCivicData } from "../civic-data/read-model.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { ManualSourceReview } from "../civic-data/types.ts";
import type { StatePeopleAcquisition } from "../civic-data/state-people-publication.ts";
import { mergeManualSourceCopies } from "../civic-data/manual-source-urls.ts";

import { STATE_PEOPLE_JURISDICTIONS } from "./people-identity.ts";
import { readOpenStatesPeopleProjection, readOfficialStateLegislatorsProjection } from "../state-rollcalls/legislators.ts";
import { officialStateLegislatorTargetByScope } from "../state-rollcalls/authority.ts";
import { sameNativePerson } from "./people-identity.ts";
import { officeRecordsForHolder, OPEN_STATES_ORG, type MemberOfficeRecord } from "./member-offices.ts";

export const MEMBER_OFFICES_CONTRACT_ID = "member-offices" as const;

export interface MemberOfficeGap {
  /** The state, or `<state>:unmatched` for members Open States lists that no single roster row matches. */
  readonly key: string;
  /** `CODE: what happened`, so a pass's gaps count by reason. */
  readonly detail: string;
}

export interface MemberOfficePublication {
  /** The candidate this pass wrote, or the pointed version it confirmed unchanged; null when nothing was publishable. */
  readonly candidateId: string | null;
  readonly promotedVersionId: string | null;
  /** Offices this pass read and joined (the prior GOOD offices of a gap state are retained, not counted). */
  readonly records: number;
  readonly gaps: readonly MemberOfficeGap[];
  /** The door's outcome, for the runner receipt (a hold or an unchanged confirmation included). */
  readonly outcome: PromotionOutcome | null;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);

/** The promoted offices, by id, so an unchanged office keeps the instant it was first collected. */
async function priorOffices(store: RoutineDataStore, now: string): Promise<ReadonlyMap<string, MemberOfficeRecord>> {
  const contract = requiredManualProductionContract(MEMBER_OFFICES_CONTRACT_ID);
  try {
    const read = await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass, contract.scope, { store, now, bypassCache: true });
    if (read.kind !== "PROMOTED") return new Map();
    return new Map(read.value.records.map(row => [row.id, row as unknown as MemberOfficeRecord]));
  } catch {
    return new Map();
  }
}

const withoutCollectedAt = (row: MemberOfficeRecord) => canonicalCivicDataJson({ ...row, collectedAt: "" });

export async function publishMemberOffices(input: {
  readonly store: RoutineDataStore;
  readonly now: string;
  readonly jurisdictions?: readonly `US-${string}`[];
}): Promise<MemberOfficePublication> {
  const prior = await priorOffices(input.store, input.now);
  const records: MemberOfficeRecord[] = [];
  const sources: ManualSourceReview[] = [];
  const gaps: MemberOfficeGap[] = [];
  for (const jurisdiction of input.jurisdictions ?? STATE_PEOPLE_JURISDICTIONS) {
    try {
      const reference = await readOpenStatesPeopleProjection(jurisdiction,{store:input.store,now:input.now,bypassCache:true});
      if (reference.kind !== "PROMOTED") { if (reference.kind === "STORE_UNREACHABLE") gaps.push({key:jurisdiction,detail:"ROSTER_UNAVAILABLE: prior offices retained"}); continue; }
      const target = officialStateLegislatorTargetByScope(jurisdiction);
      const read = target ? await readOfficialStateLegislatorsProjection(target.jurisdiction,{store:input.store,now:input.now,bypassCache:true})
        .catch(error => { gaps.push({key:jurisdiction,detail:`OFFICIAL_ALIASES_UNREADABLE: ${message(error)}`}); return null; }) : null;
      // The reference receipt supports its own office facts. Official contact overrides are applied
      // by the scoped people reader from that separately promoted source, never claimed by this archive.
      const rows = reference.value.roster.officeholders.flatMap(holder => {
        const matches = read?.kind === "PROMOTED" || read?.kind === "BOOTSTRAP" ? read.value.roster.officeholders.filter(row => sameNativePerson(holder,row)) : [];
        return officeRecordsForHolder(matches.length === 1 ? {...holder,id:matches[0].id} : holder);
      }).map(row=>{
        const held = prior.get(row.id);
        return held && withoutCollectedAt(held) === withoutCollectedAt(row) ? {...row,collectedAt:held.collectedAt} : row;
      });
      if (!rows.length) continue;
      // Derivation reuses the exact saved acquisition, rather than downloading it again or inventing a new source read.
      const sourceRead = await input.store.readPromotion("STATE_LEGISLATOR",`${jurisdiction}:openstates-people:v1`);
      const candidate = sourceRead ? await input.store.readCandidate(sourceRead.versionId) : null;
      const acquisitions = (candidate?.candidate.normalizedPayload as {acquisitions?:readonly StatePeopleAcquisition[]})?.acquisitions ?? [];
      if (!acquisitions.length) {gaps.push({key:jurisdiction,detail:"SOURCE_CAPTURE_UNAVAILABLE: prior offices retained"});continue;}
      records.push(...rows);
      sources.push(...acquisitions.map(row=>({requestedUrl:row.requestedUrl,finalUrl:row.finalUrl,publisher:OPEN_STATES_ORG,sourceClass:"REFERENCE_PUBLISHER" as const,retrievedAt:row.retrievedAt,httpStatus:row.httpStatus,rawHash:row.rawHash ?? sha256(row.body),
        ...(row.extractedFrom ? {extractedMembers:[{path:row.extractedFrom.member,sha256:sha256(row.body)}]} : {}),
        reviewOutcome:"SUPPORTED" as const,reviewedEvidence:"Exact source-native person aliases join each held office; archive extraction retains the original archive capture and member digest."})));
    } catch (error) {gaps.push({key:jurisdiction,detail:`ROSTER_UNREADABLE: ${message(error)}`});}
  }
  if (records.length === 0) return { candidateId: null, promotedVersionId: null, records: 0, gaps, outcome: null };
  const uniqueSources = new Map<string,ManualSourceReview>();
  for (const source of sources) {
    const key = `${source.finalUrl}\n${source.rawHash}`;
    uniqueSources.set(key,mergeManualSourceCopies(uniqueSources.get(key),source));
  }
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor({
    contractId: MEMBER_OFFICES_CONTRACT_ID, version: input.now, sourceThrough: sources.map(row=>row.retrievedAt).sort().at(-1) ?? input.now,
    sourceReceipt: { contractVersion: 1, reviewedAt: input.now, reviewedBy: "code:member-offices-publication", sources: [...uniqueSources.values()] },
    payload: { kind: MEMBER_OFFICES_CONTRACT_ID, records: records as unknown as readonly (Record<string, unknown> & { id: string })[] },
  }, input.store, input.now);
  const outcome = await processRegisteredManualCandidate(input.store, MEMBER_OFFICES_CONTRACT_ID, candidate, input.now, expectedBaseVersionId);
  return {
    candidateId: outcome.confirmed ? outcome.candidate.candidate.id : candidate.id,
    promotedVersionId: outcome.promoted?.versionId ?? null,
    records: records.length,
    gaps,
    outcome,
  };
}
