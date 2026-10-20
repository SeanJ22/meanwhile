/**
 * One state's daily member-office refresh, with source receipts for its held Open States offices.
 */

import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { prepareManualProjectionSuccessor } from "../civic-data/manual-successor.ts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { ManualSourceReview } from "../civic-data/types.ts";
import type { StatePeopleCapture } from "../civic-data/state-people-publication.ts";
import { mergeManualSourceCopies } from "../civic-data/manual-source-urls.ts";

import { requireRegistryState } from "../civic-data/state-scopes.ts";
import { memberOfficeContractId } from "./member-office-scope.ts";
import { readMemberOfficeRecords } from "./member-office-projection.ts";
import { readOpenStatesPeopleProjection, readOfficialStateLegislatorsProjection } from "../state-rollcalls/legislators.ts";
import { officialStateLegislatorTargetByScope } from "../state-rollcalls/authority.ts";
import { sameNativePerson } from "./people-identity.ts";
import { officeRecordsForHolder, OPEN_STATES_ORG, type MemberOfficeRecord } from "./member-offices.ts";


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

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);

/** The promoted offices, by id, so an unchanged office keeps the instant it was first collected. */
async function priorOffices(state: string, store: RoutineDataStore, now: string): Promise<ReadonlyMap<string, MemberOfficeRecord>> {
  return new Map((await readMemberOfficeRecords(state, { store, now, bypassCache: true })).map(row => [row.id, row]));
}

const withoutCollectedAt = (row: MemberOfficeRecord) => canonicalCivicDataJson({ ...row, collectedAt: "" });

export async function publishMemberOffices(input: {
  readonly store: RoutineDataStore;
  readonly now: string;
  readonly state: string;
}): Promise<MemberOfficePublication> {
  const state = requireRegistryState(input.state), contractId = memberOfficeContractId(state);
  const jurisdiction = `US-${state}` as const;
  const prior = await priorOffices(state, input.store, input.now);
  const records: MemberOfficeRecord[] = [];
  const sources: ManualSourceReview[] = [];
  const gaps: MemberOfficeGap[] = [];
  {
    try {
      const reference = await readOpenStatesPeopleProjection(jurisdiction,{store:input.store,now:input.now,bypassCache:true});
      if (reference.kind !== "PROMOTED") { if (reference.kind === "STORE_UNREACHABLE") gaps.push({key:jurisdiction,detail:"ROSTER_UNAVAILABLE: prior offices retained"}); return { candidateId: null, promotedVersionId: null, records: 0, gaps, outcome: null }; }
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
      if (!rows.length) return { candidateId: null, promotedVersionId: null, records: 0, gaps, outcome: null };
      // Derivation reuses the exact saved acquisition, rather than downloading it again or inventing a new source read.
      const sourceRead = await input.store.readPromotion("STATE_LEGISLATOR",`${jurisdiction}:openstates-people:v1`);
      const candidate = sourceRead ? await input.store.readCandidate(sourceRead.versionId) : null;
      const acquisitions = (candidate?.candidate.normalizedPayload as {captures?:readonly StatePeopleCapture[]})?.captures ?? [];
      if (!acquisitions.length) {gaps.push({key:jurisdiction,detail:"SOURCE_CAPTURE_UNAVAILABLE: prior offices retained"});return { candidateId: null, promotedVersionId: null, records: 0, gaps, outcome: null };}
      records.push(...rows);
      sources.push(...acquisitions.map(row=>({requestedUrl:row.requestedUrl,finalUrl:row.finalUrl,publisher:OPEN_STATES_ORG,sourceClass:"REFERENCE_PUBLISHER" as const,retrievedAt:row.retrievedAt,httpStatus:row.httpStatus,rawHash:row.rawHash ?? row.capture.rawHash,
        ...(row.extractedFrom ? {extractedMembers:[{path:row.extractedFrom.member,sha256:row.capture.rawHash}]} : {}),
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
    contractId, version: input.now, sourceThrough: sources.map(row=>row.retrievedAt).sort().at(-1) ?? input.now,
    sourceReceipt: { contractVersion: 1, reviewedAt: input.now, reviewedBy: "code:member-offices-publication", sources: [...uniqueSources.values()] },
    payload: { kind: "member-offices", records: records as unknown as readonly (Record<string, unknown> & { id: string })[] },
  }, input.store, input.now);
  const outcome = await processRegisteredManualCandidate(input.store, contractId, candidate, input.now, expectedBaseVersionId);
  return {
    candidateId: outcome.confirmed ? outcome.candidate.candidate.id : candidate.id,
    promotedVersionId: outcome.promoted?.versionId ?? null,
    records: records.length,
    gaps,
    outcome,
  };
}
