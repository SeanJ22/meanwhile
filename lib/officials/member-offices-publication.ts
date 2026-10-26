/**
 * The daily member-office refresh: each state's promoted Open States offices,
 * published in one package through the curated `member-offices` pointer with a receipt for each file's exact bytes.
 * Source content hashes select changed states before any held office records are read.
 * Changed contacts for existing members publish along with newly found offices.
 * A run its pass deadline cuts short saves the states it finished and names the rest, and the next pass continues.
 */

import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { createHash } from "node:crypto";
import { confirmSourceHashUnchanged, type SourceHashConfirmation } from "../civic-data/source-hash.ts";
import { derivedRequestedUrl } from "../civic-data/derived-door.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../civic-data/manual-successor.ts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import { readPromotedCivicData } from "../civic-data/read-model.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { ManualSourceReview } from "../civic-data/types.ts";
import type { StatePeopleCapture } from "../civic-data/state-people-publication.ts";
import { manualSourceUrls, mergeManualSourceCopies } from "../civic-data/manual-source-urls.ts";
import { manualRecordSourceUrls } from "../civic-data/manual-source-isolation.ts";

import { STATE_PEOPLE_JURISDICTIONS, statePeopleScopeForId } from "./people-identity.ts";
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

/** The promoted package: its offices by id, the lawmaker lists they were built from, and the states still owed. */
async function priorPackage(store: RoutineDataStore, now: string): Promise<{ versionId: string | null; offices: ReadonlyMap<string, MemberOfficeRecord>;
  rosters: Readonly<Record<string, string>>; pending: readonly string[] }> {
  const contract = requiredManualProductionContract(MEMBER_OFFICES_CONTRACT_ID);
  try {
    const read = await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass, contract.scope, { store, now });
    if (read.kind !== "PROMOTED") return { versionId: null, offices: new Map(), rosters: {}, pending: [] };
    return { versionId: read.projection.versionId, offices: new Map(read.value.records.map(row => [row.id, row as unknown as MemberOfficeRecord])),
      rosters: read.value.rosterDigests ?? {}, pending: read.value.pending ?? [] };
  } catch {
    return { versionId: null, offices: new Map(), rosters: {}, pending: [] };
  }
}

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
  const contract = requiredManualProductionContract(MEMBER_OFFICES_CONTRACT_ID);
  const held = await store.readPromotionPayloadFields(contract.recordClass, contract.scope, ["rosterDigests", "pending"]);
  if (!held?.rosterDigests) return { needed: true, reason: "The member-office package records no lawmaker lists yet." };
  if (Array.isArray(held.pending) && held.pending.length) return { needed: true, reason: `${held.pending.length} state(s) are still owed from a run its deadline cut short.` };
  const digests = held.rosterDigests as Readonly<Record<string, string>>;
  const changed = [...await rosterDigests(store, jurisdictions)].filter(([jurisdiction, digest]) => digests[jurisdiction] !== digest).map(([jurisdiction]) => jurisdiction);
  return changed.length ? { needed: true, reason: `${changed.length} state lawmaker list(s) changed: ${changed.join(", ")}.` }
    : { needed: false, reason: "No state's office source content changed since the member-office package was built." };
}

/** Time a run its pass deadline will stop keeps for building and saving its package. */
const MEMBER_OFFICES_SAVE_MARGIN_MS = 90_000;

const officeState = (row: MemberOfficeRecord) => statePeopleScopeForId(row.officeholderId, row.office.state ?? undefined);

export async function publishMemberOffices(input: {
  readonly store: RoutineDataStore;
  readonly now: string;
  readonly jurisdictions?: readonly `US-${string}`[];
  readonly resolveOfficePoint?: OfficePointResolver;
  /** When the run must stop reading states; the default never stops. */
  readonly deadlineMs?: number;
  readonly clock?: () => number;
}): Promise<MemberOfficePublication> {
  const clock = input.clock ?? Date.now;
  const jurisdictions = input.jurisdictions ?? STATE_PEOPLE_JURISDICTIONS;
  const current = await rosterDigests(input.store, jurisdictions);
  const contract = requiredManualProductionContract(MEMBER_OFFICES_CONTRACT_ID);
  const progress = await input.store.readPromotionPayloadFields(contract.recordClass, contract.scope, ["rosterDigests", "pending"]);
  const rawHash = inputHash(current);
  const same = progress?.rosterDigests && !(Array.isArray(progress.pending) && progress.pending.length) &&
    jurisdictions.every(jurisdiction => (progress.rosterDigests as Record<string, string>)[jurisdiction] === current.get(jurisdiction));
  if (same) {
    const requestedUrl = derivedRequestedUrl(contract.sourceId, contract.scope);
    const confirmation = await confirmSourceHashUnchanged({ store: input.store, sourceId: contract.sourceId,
      recordClass: contract.recordClass, scope: contract.scope, parserVersion: contract.parserNormalizerVersion,
      rawHash, retrieval: { requestedUrl, finalUrl: null, httpStatus: null, rawHash, retrievedAt: input.now }, now: input.now, complete: true });
    if (confirmation) return { candidateId: confirmation.head.versionId, promotedVersionId: confirmation.head.versionId,
      records: 0, gaps: [], pending: [], outcome: null, confirmation };
  }
  const prior = await priorPackage(input.store, input.now);
  // States whose lawmaker list changed, those a cut-off pass left owed first; every other state keeps its offices and is not read.
  const owed = new Set(prior.pending);
  const changed = jurisdictions.filter(jurisdiction => prior.rosters[jurisdiction] !== current.get(jurisdiction))
    .sort((a, b) => Number(!owed.has(a)) - Number(!owed.has(b)));
  const rosters: Record<string, string> = { ...prior.rosters };
  const pending: string[] = [];
  const records: MemberOfficeRecord[] = [];
  const sources: ManualSourceReview[] = [];
  const gaps: MemberOfficeGap[] = [];
  // Retained offices keep the source reviews that published them.
  let priorSources: readonly ManualSourceReview[] | null = null;
  const heldSources = async (rows: readonly MemberOfficeRecord[]) => {
    priorSources ??= prior.versionId ? (await input.store.readCandidateField(prior.versionId, ["retrieval", "manualSourceReceipt", "sources"]) as ManualSourceReview[] | undefined) ?? [] : [];
    const cited = new Set(rows.flatMap(row => manualRecordSourceUrls(row)));
    return priorSources.filter(source => source.reviewOutcome !== "BLOCKED" && manualSourceUrls(source).some(url => cited.has(url)));
  };
  for (const jurisdiction of changed) {
    if (clock() >= (input.deadlineMs ?? Number.POSITIVE_INFINITY) - MEMBER_OFFICES_SAVE_MARGIN_MS) { pending.push(jurisdiction); continue; }
    // A state that cannot be read keeps its offices and its old lawmaker list, so the next run reads it again.
    try {
      const reference = await input.store.readOfficeRoster(`${jurisdiction}:openstates-people:v1`);
      if (!reference) {
        rosters[jurisdiction] = current.get(jurisdiction)!;
        continue;
      }
      const target = officialStateLegislatorTargetByScope(jurisdiction);
      const official = target ? await (jurisdiction === "US-NH"
        ? readOfficialStateLegislatorsProjection(target.jurisdiction,{store:input.store,now:input.now})
          .then(read => read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? { roster: read.value.roster } : null)
        : input.store.readOfficeRoster(target.jurisdiction))
        .catch(error => { gaps.push({key:jurisdiction,detail:`OFFICIAL_ALIASES_UNREADABLE: ${message(error)}`}); return null; }) : null;
      const held = [...prior.offices.values()].filter(row => officeState(row) === jurisdiction);
      // The reference receipt supports its own office facts. Official contact overrides are applied
      // by the scoped people reader from that separately promoted source, never claimed by this archive.
      const native = reference.roster.officeholders.flatMap(holder => {
        const matches = official?.roster.officeholders.filter(row => sameNativePerson(holder,row)) ?? [];
        return officeRecordsForHolder(matches.length === 1 ? {...holder,id:matches[0].id} : holder,{includePointEvidence:true});
      });
      const points = await publishDirectoryOfficePoints(native.map(row=>row.office), [...prior.offices.values()].map(row=>row.office), input.resolveOfficePoint);
      const stateSources: ManualSourceReview[] = [];
      for(const office of points)if(office.geocodedPoint){
        const review=officePointSourceReview(office.geocodedPoint);
        if(review)stateSources.push(review);
      }
      const sourcePath = (url: string) => url.replace(/(githubusercontent\.com\/openstates\/people\/)\b[a-f0-9]{40}\//, "$1");
      const officeFacts = ({ id: _id, collectedAt: _at, sourceUrl, fieldSources, ...facts }: MemberOfficeRecord) => ({
        ...facts, sourceUrl: sourcePath(sourceUrl),
        ...(fieldSources ? { fieldSources: Object.fromEntries(Object.entries(fieldSources).map(([key, source]) => {
          const { collectedAt: _collected, verifiedAt: _verified, ...provenance } = source;
          return [key, { ...provenance, sourceUrl: sourcePath(source.sourceUrl) }];
        })) } : {}),
      });
      const rows = native.map((record, index) => {
        const peers = native.filter(row => row.officeholderId === record.officeholderId && row.officeKind === record.officeKind && sourcePath(row.sourceUrl) === sourcePath(record.sourceUrl));
        const previous = held.filter(row => row.officeholderId === record.officeholderId && row.officeKind === record.officeKind && sourcePath(row.sourceUrl) === sourcePath(record.sourceUrl));
        const old = previous.find(row => row.id === record.id) ?? (peers.length === 1 && previous.length === 1 ? previous[0] : undefined);
        const next = { ...record, ...(old ? { id: old.id } : {}), office: points[index] };
        return old && canonicalCivicDataJson(officeFacts(old)) === canonicalCivicDataJson(officeFacts(next)) ? old : next;
      });
      const reused = rows.filter(row => prior.offices.get(row.id) === row);
      const acquiredRows = rows.filter(row => prior.offices.get(row.id) !== row);
      if (acquiredRows.length) {
        // Derivation reuses the exact saved acquisition of these members' own files, rather than downloading them again;
        // neither the roster's other files nor its whole capture list leave the database.
        const urls = [...new Set(acquiredRows.map(row => row.sourceUrl))];
        const members = urls.flatMap(url => /^https:\/\/raw\.githubusercontent\.com\/openstates\/people\/[a-f0-9]{40}\/(data\/.+)$/.exec(url)?.[1] ?? []);
        const acquisitions = await input.store.readCandidateCaptures(reference.versionId, urls, members) as readonly StatePeopleCapture[];
        if (!acquisitions.length) {gaps.push({key:jurisdiction,detail:"SOURCE_CAPTURE_UNAVAILABLE: prior offices retained"});continue;}
        sources.push(...stateSources,...acquisitions.map(row=>({requestedUrl:row.requestedUrl,finalUrl:row.finalUrl,publisher:OPEN_STATES_ORG,sourceClass:"REFERENCE_PUBLISHER" as const,retrievedAt:row.retrievedAt,httpStatus:row.httpStatus,rawHash:row.rawHash ?? row.capture.rawHash,
          ...(row.extractedFrom ? {extractedMembers:[{path:row.extractedFrom.member,sha256:row.capture.rawHash}]} : {}),
          reviewOutcome:"SUPPORTED" as const,reviewedEvidence:"Exact source-native person aliases join each held office; archive extraction retains the original archive capture and member digest."})));
      }
      const retained = held.filter(row => !rows.some(next => next.id === row.id));
      records.push(...rows, ...retained);
      sources.push(...await heldSources([...reused, ...retained]));
      rosters[jurisdiction] = current.get(jurisdiction)!;
    } catch (error) {gaps.push({key:jurisdiction,detail:`ROSTER_UNREADABLE: ${message(error)}`});}
  }
  // A state not read again keeps exactly the offices it had: the successor retains every prior office this run does not replace.
  if (records.length === 0) return { candidateId: null, promotedVersionId: null, records: 0, gaps, pending, outcome: null };
  const uniqueSources = new Map<string,ManualSourceReview>();
  for (const source of sources) {
    const key = `${source.finalUrl}\n${source.rawHash}`;
    uniqueSources.set(key,mergeManualSourceCopies(uniqueSources.get(key),source));
  }
  const publicationAt = [input.now,...sources.map(row=>row.retrievedAt)].sort().at(-1)!;
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor({
    contractId: MEMBER_OFFICES_CONTRACT_ID, version: publicationAt, sourceThrough: sources.map(row=>row.retrievedAt).sort().at(-1) ?? input.now,
    sourceReceipt: { contractVersion: 1, reviewedAt: publicationAt, reviewedBy: "code:member-offices-publication", sources: [...uniqueSources.values()] },
    payload: { kind: MEMBER_OFFICES_CONTRACT_ID, records: records as unknown as readonly (Record<string, unknown> & { id: string })[],
      rosterDigests: rosters, ...(pending.length ? { pending } : {}) },
  }, input.store, input.now);
  // Unchanged offices with a moved roster version or owed list are still saved, so the next run knows where it stands.
  const progressMoved = canonicalCivicDataJson([prior.rosters, prior.pending]) !== canonicalCivicDataJson([rosters, pending]);
  const contentCandidate = { ...candidate, retrieval: { ...candidate.retrieval, rawHash, rawHashBasis: "SOURCE_CONTENT_V1" as const } };
  const outcome = await processRegisteredManualCandidate(input.store, MEMBER_OFFICES_CONTRACT_ID, contentCandidate, publicationAt, expectedBaseVersionId,
    { confirmUnchanged: !progressMoved });
  return {
    candidateId: outcome.confirmed ? outcome.candidate.candidate.id : candidate.id,
    promotedVersionId: outcome.promoted?.versionId ?? null,
    records: records.length,
    gaps,
    pending,
    outcome,
  };
}
