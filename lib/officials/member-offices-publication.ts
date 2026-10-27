/**
 * The daily member-office refresh: each state's promoted Open States offices,
 * published through one state pointer at a time, with a receipt for each file's exact bytes.
 * Source content hashes select changed states before any held office records are read.
 * Changed contacts for existing members publish along with newly found offices.
 * A run its pass deadline cuts short saves the states it finished and names the rest, and the next pass continues.
 */

import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { createHash } from "node:crypto";
import { confirmSourceHashUnchanged, type SourceHashConfirmation } from "../civic-data/source-hash.ts";
import { derivedRequestedUrl } from "../civic-data/derived-door.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import { manualProjectionCandidate } from "../civic-data/manual-projections.ts";
import { memberOfficeStateScope, type MemberOfficeSlice } from "./member-office-data.ts";
import { immutableStateValue, immutableStateHash, rememberStatePublicationHashes, rememberStatePublicationPrior } from "../civic-data/state-publication.ts";
import { projectionKey } from "../civic-data/projection-key.ts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { ManualSourceReview } from "../civic-data/types.ts";
import type { StatePeopleCapture } from "../civic-data/state-people-publication.ts";
import { manualSourceUrls, mergeManualSourceCopies } from "../civic-data/manual-source-urls.ts";
import { manualRecordSourceUrls } from "../civic-data/manual-source-isolation.ts";

import { STATE_PEOPLE_JURISDICTIONS } from "./people-identity.ts";
import { requiredRoutineContract } from "../civic-data/contracts.ts";
import { readOfficialStateLegislatorsProjection } from "../state-rollcalls/legislators.ts";
import { officialStateLegislatorTargetByScope } from "../state-rollcalls/authority.ts";
import { sameNativePerson } from "./people-identity.ts";
import { officeRecordsForHolder, OPEN_STATES_ORG, type MemberOfficeRecord } from "./member-offices.ts";
import { publishDirectoryOfficePoints, officePointSourceReview, type OfficePointResolver } from "./office-points-publication.ts";

export const MEMBER_OFFICES_CONTRACT_ID = "member-offices" as const;

export interface MemberOfficeGap {
  /** The state, or `<state>:unmatched` for members Open States lists that no single roster row matches. */
  readonly key: string;
  /** `CODE: what happened`, so a pass's gaps count by reason. */
  readonly detail: string;
}

export interface MemberOfficePublication {
  readonly confirmation?: SourceHashConfirmation;
  /** The candidate this pass wrote, or the pointed version it confirmed unchanged; null when nothing was publishable. */
  readonly candidateId: string | null;
  readonly promotedVersionId: string | null;
  /** Offices this pass read and joined; a gap state's prior offices are retained. */
  readonly records: number;
  readonly gaps: readonly MemberOfficeGap[];
  /** The door's outcome, for the runner receipt (a hold or an unchanged confirmation included). */
  readonly outcome: PromotionOutcome | null;
  /** States the pass deadline left unread; the package names them and the next pass reads them first. */
  readonly pending: readonly string[];
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);

/** The pointers a state's offices are built from: its Open States file and, where there is one, its official roster. */
function rosterPointers(jurisdiction: `US-${string}`): readonly string[] {
  const target = officialStateLegislatorTargetByScope(jurisdiction);
  const official = jurisdiction === "US-NH" ? requiredRoutineContract("nh-members").scope : target?.jurisdiction;
  return [`${jurisdiction}:openstates-people:v1`, ...official ? [official] : []];
}

/** Source hashes include office/contact changes for existing members; fresh observation stamps do not decide work. */
async function rosterDigests(store: RoutineDataStore, jurisdictions: readonly `US-${string}`[]): Promise<ReadonlyMap<string, string>> {
  const pointers = new Map(jurisdictions.map(jurisdiction => [jurisdiction, rosterPointers(jurisdiction)]));
  const held = new Map(await Promise.all([...new Set([...pointers.values()].flat())].map(async scope => {
    const head = await store.readSourceHead("STATE_LEGISLATOR", scope);
    return [scope, head ? canonicalCivicDataJson([head.sourceId, head.parserVersion, head.rawHash]) : "none"] as const;
  })));
  return new Map([...pointers].map(([jurisdiction, scopes]) => [jurisdiction, scopes.map(scope => held.get(scope) ?? "none").join("|")]));
}

const inputHash = (digests: ReadonlyMap<string, string>) => createHash("sha256")
  .update(canonicalCivicDataJson([...digests].sort(([a], [b]) => a.localeCompare(b)))).digest("hex");

/** Whether a member-office run has a state to read, from the package's small progress fields and the rosters' id digests. */
export async function memberOfficesRunNeeded(store: RoutineDataStore, jurisdictions: readonly `US-${string}`[] = STATE_PEOPLE_JURISDICTIONS):
  Promise<{ readonly needed: boolean; readonly reason: string }> {
  const held = await store.readMemberOfficeProgress();
  if (held.pending.length) return { needed: true, reason: `${held.pending.length} state(s) are still owed from a run its deadline cut short.` };
  const changed = [...await rosterDigests(store, jurisdictions)].filter(([jurisdiction, digest]) => held.rosterDigests[jurisdiction] !== digest).map(([jurisdiction]) => jurisdiction);
  return changed.length ? { needed: true, reason: `${changed.length} state office source(s) changed: ${changed.join(", ")}.` }
    : { needed: false, reason: "No state's office source content changed since its last completed state publication." };
}

/** Time a run its pass deadline will stop keeps for building and saving its package. */
const MEMBER_OFFICES_SAVE_MARGIN_MS = 90_000;

/** Bind the already selected state's exact GOOD members to the ordinary indexed publication path. */
function rememberOfficeBase(store: RoutineDataStore, prior: MemberOfficeSlice | null, state: string): void {
  if (!prior || prior.scope !== memberOfficeStateScope(state)) return;
  const payload = immutableStateValue({ ...prior.header, records: prior.records });
  if (immutableStateHash(payload) !== prior.normalization.normalizedHash) throw new Error("MEMBER_OFFICE_STATE_PAYLOAD_HASH_INVALID");
  const projection = { key: projectionKey("CURATED_READER_RECORD", prior.scope), recordClass: "CURATED_READER_RECORD" as const,
    scope: prior.scope, sourceId: prior.sourceId, versionId: prior.versionId, lastKnownGoodVersionId: prior.versionId,
    promotedAt: prior.promotedAt, receipt: prior.receipt, payload };
  rememberStatePublicationHashes(projection, prior.normalization);
  rememberStatePublicationPrior(store, projection);
}

async function publishOfficeState(input: {
  readonly store: RoutineDataStore; readonly now: string; readonly resolveOfficePoint?: OfficePointResolver;
}, jurisdiction: `US-${string}`, rawHash: string, gaps: MemberOfficeGap[]): Promise<{ outcome: PromotionOutcome; records: number } | null> {
  const prior = await input.store.readMemberOfficeSlice(jurisdiction);
  rememberOfficeBase(input.store, prior, jurisdiction);
  const records: MemberOfficeRecord[] = [], sources: ManualSourceReview[] = [];
      const reference = await input.store.readOfficeRoster(`${jurisdiction}:openstates-people:v1`);
      if (!reference) return null;
      const target = officialStateLegislatorTargetByScope(jurisdiction);
      const official = target ? await (jurisdiction === "US-NH"
        ? readOfficialStateLegislatorsProjection(target.jurisdiction,{store:input.store,now:input.now})
          .then(read => read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? { roster: read.value.roster } : null)
        : input.store.readOfficeRoster(target.jurisdiction))
        .catch(error => { gaps.push({key:jurisdiction,detail:`OFFICIAL_ALIASES_UNREADABLE: ${message(error)}`}); return null; }) : null;
      const held = prior?.records ?? [];
      // The reference receipt supports its own office facts. Official contact overrides are applied
      // by the scoped people reader from that separately promoted source, never claimed by this archive.
      const native = reference.roster.officeholders.flatMap(holder => {
        const matches = official?.roster.officeholders.filter(row => sameNativePerson(holder,row)) ?? [];
        return officeRecordsForHolder(matches.length === 1 ? {...holder,id:matches[0].id} : holder,{includePointEvidence:true});
      });
      const points = await publishDirectoryOfficePoints(native.map(row=>row.office), held.map(row=>row.office), input.resolveOfficePoint);
      const stateSources: ManualSourceReview[] = [];
      for(const office of points)if(office.geocodedPoint){
        const review=await officePointSourceReview(office.geocodedPoint);
        if(review)stateSources.push(review);
      }
      const sourcePath = (url: string) => url.replace(/(githubusercontent\.com\/openstates\/people\/)\b[a-f0-9]{40}\//, "$1");
      const officeFacts = ({ id: _id, collectedAt: _at, sourceUrl, fieldSources, ...facts }: MemberOfficeRecord) => ({
        ...facts, sourceUrl: sourcePath(sourceUrl),
        ...(fieldSources ? { fieldSources: Object.fromEntries(Object.entries(fieldSources).map(([key, source]) => {
          const { collectedAt: _collected, verifiedAt: _verified, ...provenance } = source;
          return [key, { ...provenance, sourceUrl: source.sourceUrl===null?null:sourcePath(source.sourceUrl) }];
        })) } : {}),
      });
      const rows = native.map((record, index) => {
        const peers = native.filter(row => row.officeholderId === record.officeholderId && row.officeKind === record.officeKind && sourcePath(row.sourceUrl) === sourcePath(record.sourceUrl));
        const previous = held.filter(row => row.officeholderId === record.officeholderId && row.officeKind === record.officeKind && sourcePath(row.sourceUrl) === sourcePath(record.sourceUrl));
        const old = previous.find(row => row.id === record.id) ?? (peers.length === 1 && previous.length === 1 ? previous[0] : undefined);
        const next = { ...record, ...(old ? { id: old.id } : {}), office: points[index] };
        return old && canonicalCivicDataJson(officeFacts(old)) === canonicalCivicDataJson(officeFacts(next)) ? old : next;
      });
      const reused = rows.filter(row => held.includes(row));
      const acquiredRows = rows.filter(row => !held.includes(row));
      if (acquiredRows.length) {
        // Derivation reuses the exact saved acquisition of these members' own files, rather than downloading them again;
        // neither the roster's other files nor its whole capture list leave the database.
        const urls = [...new Set(acquiredRows.map(row => row.sourceUrl))];
        const members = urls.flatMap(url => /^https:\/\/raw\.githubusercontent\.com\/openstates\/people\/[a-f0-9]{40}\/(data\/.+)$/.exec(url)?.[1] ?? []);
        const acquisitions = await input.store.readCandidateCaptures(reference.versionId, urls, members) as readonly StatePeopleCapture[];
        if (!acquisitions.length) throw new Error("SOURCE_CAPTURE_UNAVAILABLE: prior offices retained");
        sources.push(...stateSources,...acquisitions.map(row=>({requestedUrl:row.requestedUrl,finalUrl:row.finalUrl,publisher:OPEN_STATES_ORG,sourceClass:"REFERENCE_PUBLISHER" as const,retrievedAt:row.retrievedAt,httpStatus:row.httpStatus,rawHash:row.rawHash ?? row.capture.rawHash,
          ...(row.extractedFrom ? {extractedMembers:[{path:row.extractedFrom.member,sha256:row.capture.rawHash}]} : {}),
          reviewOutcome:"SUPPORTED" as const,reviewedEvidence:"Exact source-native person aliases join each held office; archive extraction retains the original archive capture and member digest."})));
      }
      const retained = held.filter(row => !rows.some(next => next.id === row.id));
      records.push(...rows, ...retained);
      const cited = new Set([...reused, ...retained].flatMap(row => manualRecordSourceUrls(row)));
      sources.push(...(prior?.sources ?? []).filter(source => source.reviewOutcome !== "BLOCKED" && manualSourceUrls(source).some(url => cited.has(url))));

  if (!records.length) return null;
  const uniqueSources = new Map<string,ManualSourceReview>();
  for (const source of sources) {
    const key = `${source.finalUrl}\n${source.rawHash}`;
    uniqueSources.set(key,mergeManualSourceCopies(uniqueSources.get(key),source));
  }
  const publicationAt = [input.now,...sources.map(row=>row.retrievedAt)].sort().at(-1)!;
  const candidate = manualProjectionCandidate({ contractId: MEMBER_OFFICES_CONTRACT_ID, version: publicationAt,
    sourceThrough: sources.map(row=>row.retrievedAt).sort().at(-1) ?? input.now,
    sourceReceipt: { contractVersion: 1, reviewedAt: publicationAt, reviewedBy: "code:member-offices-publication", sources: [...uniqueSources.values()] },
    payload: { kind: MEMBER_OFFICES_CONTRACT_ID, state: jurisdiction.slice(3),
      records: records as unknown as readonly (Record<string, unknown> & { id: string })[] } as import("../civic-data/manual-projections.ts").CuratedReaderProjection,
  });
  const contentCandidate = { ...candidate, retrieval: { ...candidate.retrieval, rawHash, rawHashBasis: "SOURCE_CONTENT_V1" as const } };
  const outcome = await processRegisteredManualCandidate(input.store, MEMBER_OFFICES_CONTRACT_ID, contentCandidate, publicationAt,
    prior?.scope === candidate.scope ? prior.versionId : null, { confirmUnchanged: false });
  if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? "Member-office state publication did not promote.");
  return { outcome, records: records.length };
}

export async function publishMemberOffices(input: {
  readonly store: RoutineDataStore; readonly now: string; readonly jurisdictions?: readonly `US-${string}`[];
  readonly resolveOfficePoint?: OfficePointResolver; readonly deadlineMs?: number; readonly clock?: () => number;
}): Promise<MemberOfficePublication> {
  const clock = input.clock ?? Date.now, jurisdictions = input.jurisdictions ?? STATE_PEOPLE_JURISDICTIONS;
  const current = await rosterDigests(input.store, jurisdictions), contract = requiredManualProductionContract(MEMBER_OFFICES_CONTRACT_ID);
  const progress = await input.store.readMemberOfficeProgress(), rosters = { ...progress.rosterDigests };
  const owed = new Set(progress.pending), gaps: MemberOfficeGap[] = [];
  const changed = jurisdictions.filter(state => rosters[state] !== current.get(state)).sort((a,b) => Number(!owed.has(a))-Number(!owed.has(b)));
  const pending = new Set([...progress.pending.filter(state => !jurisdictions.includes(state as `US-${string}`)), ...changed]);
  let outcome: PromotionOutcome | null = null, records = 0, confirmation: SourceHashConfirmation | undefined, partitioned = progress.partitioned === true;
  let checkedAt=progress.checkedAt;
  const save = () => input.store.writeMemberOfficeProgress({ rosterDigests: rosters, pending: [...pending], checkedAt, attemptedAt:input.now, partitioned });
  // Admit and save the exact owed states before any state's records are read.
  await save();
  for (const jurisdiction of jurisdictions.filter(state => !changed.includes(state))) {
    const scope = memberOfficeStateScope(jurisdiction), rawHash = inputHash(new Map([[jurisdiction,current.get(jurisdiction)!]]));
    const requestedUrl = derivedRequestedUrl(contract.sourceId,scope);
    const held = await confirmSourceHashUnchanged({ store: input.store,sourceId:contract.sourceId,recordClass:contract.recordClass,
      scope,parserVersion:contract.parserNormalizerVersion,rawHash,retrieval:{requestedUrl,finalUrl:null,httpStatus:null,rawHash,retrievedAt:input.now},now:input.now,complete:true });
    if (held) { confirmation = held; partitioned = true; }
  }
  for (const jurisdiction of changed) {
    if (clock() >= (input.deadlineMs ?? Number.POSITIVE_INFINITY)-MEMBER_OFFICES_SAVE_MARGIN_MS) break;
    try {
      const scope=memberOfficeStateScope(jurisdiction), rawHash=inputHash(new Map([[jurisdiction,current.get(jurisdiction)!]])), requestedUrl=derivedRequestedUrl(contract.sourceId,scope);
      const held=await confirmSourceHashUnchanged({store:input.store,sourceId:contract.sourceId,recordClass:contract.recordClass,scope,
        parserVersion:contract.parserNormalizerVersion,rawHash,retrieval:{requestedUrl,finalUrl:null,httpStatus:null,rawHash,retrievedAt:input.now},now:input.now,complete:true});
      if(held){confirmation=held;partitioned=true;}
      else {
        const result = await publishOfficeState(input,jurisdiction,rawHash,gaps);
        if (result) { outcome = result.outcome; records += result.records; partitioned=true; }
      }
      rosters[jurisdiction] = current.get(jurisdiction)!;
      pending.delete(jurisdiction);
      await save();
    } catch (error) { gaps.push({key:jurisdiction,detail:`ROSTER_UNREADABLE: ${message(error)}`}); }
  }
  if(!gaps.length)checkedAt=input.now;
  await save();
  // Before the first state successor, the old national edition is still exact when every recorded input matches.
  if (!partitioned && !outcome && !confirmation && !pending.size && !changed.length && input.store.confirmUnchanged) {
    const head = await input.store.readSourceHead(contract.recordClass,contract.scope);
    if (head?.normalizedHash && head.candidateState === "PROMOTED") {
      const rawHash=inputHash(current), requestedUrl=derivedRequestedUrl(contract.sourceId,contract.scope);
      const result=await input.store.confirmUnchanged({sourceId:contract.sourceId,recordClass:contract.recordClass,scope:contract.scope,
        parserVersion:contract.parserNormalizerVersion,pointerVersionId:head.versionId,readModelHash:head.normalizedHash,basis:"CHANGE_SET_UNCHANGED",
        retrieval:{requestedUrl,finalUrl:null,httpStatus:null,rawHash,retrievedAt:input.now}},input.now);
      if(result.kind === "CONFIRMED")confirmation={head,at:result.at};
    }
  }
  return {candidateId:outcome?.candidate.candidate.id ?? confirmation?.head.versionId ?? null,
    promotedVersionId:outcome?.promoted?.versionId ?? confirmation?.head.versionId ?? null,records,gaps,pending:[...pending],outcome,
    ...(!outcome && confirmation ? {confirmation}: {})};
}
