/**
 * The daily member-office refresh: each state's promoted legislative roster joined with Open States' current file,
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
import { politeGetText } from "../sources/http.ts";
import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from "../state-rollcalls/authority.ts";
import { readOfficialStateLegislatorsProjection } from "../state-rollcalls/legislators.ts";
import { memberOfficeRecords, OPEN_STATES_ORG, openStatesUrl, type MemberOfficeRecord } from "./member-offices.ts";

export const MEMBER_OFFICES_CONTRACT_ID = "member-offices" as const;

/** One state's file is a few hundred KB; a fetch that outlives this is a gap, and the other states go on. */
const FETCH_TIMEOUT_MS = 2 * 60_000;

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

/** The polite, identified fetch every source uses; a non-CSV 200 is a wall, never an empty roster. */
async function fetchOpenStatesCsv(url: string): Promise<string> {
  const { text } = await politeGetText(url, {
    accept: "text/csv",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    expect: { label: "Open States people CSV", marker: "current_chamber" },
  });
  return text;
}

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
  readonly fetchCsv?: (url: string) => Promise<string>;
}): Promise<MemberOfficePublication> {
  const fetchCsv = input.fetchCsv ?? fetchOpenStatesCsv;
  const prior = await priorOffices(input.store, input.now);
  const records: MemberOfficeRecord[] = [];
  const sources: ManualSourceReview[] = [];
  const gaps: MemberOfficeGap[] = [];
  for (const target of OFFICIAL_STATE_LEGISLATOR_TARGETS) {
    const gap = (detail: string, key: string = target.state) => gaps.push({ key, detail });
    let officials;
    try {
      const read = await readOfficialStateLegislatorsProjection(target.jurisdiction, { store: input.store, now: input.now, bypassCache: true });
      if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") {
        gap(`ROSTER_UNAVAILABLE: the official ${target.publisher} roster read ${read.kind}; its prior offices stay live.`);
        continue;
      }
      officials = read.value.roster;
    } catch (error) {
      gap(`ROSTER_UNREADABLE: ${message(error)}`);
      continue;
    }
    const url = openStatesUrl(target.state);
    let csv: string;
    try {
      csv = await fetchCsv(url);
    } catch (error) {
      gap(`SOURCE_UNAVAILABLE: ${url} could not be read (${message(error)}); its prior offices stay live.`);
      continue;
    }
    const joined = memberOfficeRecords({ state: target.state, csv, collectedAt: input.now, officials });
    if (joined.unmatched.length > 0) {
      gap(`MEMBER_UNMATCHED: ${joined.unmatched.length} Open States member(s) match no single official roster member: ` +
        `${joined.unmatched.slice(0, 5).join("; ")}${joined.unmatched.length > 5 ? "; ..." : ""}`, `${target.state}:unmatched`);
    }
    // Two Open States rows joined to one member would publish two versions of one office: neither is published.
    const counts = new Map<string, number>();
    for (const row of joined.records) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    const ambiguous = new Set(joined.records.filter(row => counts.get(row.id)! > 1).map(row => row.officeholderId));
    if (ambiguous.size > 0) gap(`MEMBER_AMBIGUOUS: ${[...ambiguous].join(", ")} matched more than one Open States row; their offices are held.`, `${target.state}:ambiguous`);
    const rows = joined.records.filter(row => !ambiguous.has(row.officeholderId)).map(row => {
      // An office read again unchanged keeps its first collection time, so an unchanged day confirms rather than re-promotes.
      const held = prior.get(row.id);
      return held && withoutCollectedAt(held) === withoutCollectedAt(row) ? { ...row, collectedAt: held.collectedAt } : row;
    });
    if (rows.length === 0) {
      gap(`NO_OFFICES_JOINED: ${url} gave no office joined to an official ${target.state} roster member; its prior offices stay live.`);
      continue;
    }
    records.push(...rows);
    sources.push({ requestedUrl: url, finalUrl: url, publisher: OPEN_STATES_ORG, sourceClass: "REFERENCE_PUBLISHER",
      retrievedAt: input.now, httpStatus: 200, rawHash: sha256(csv), reviewOutcome: "SUPPORTED",
      reviewedEvidence: `Open States' current ${target.state} file, read in code: ${rows.length} capitol/district office(s) joined to the official ` +
        `${target.publisher} roster by seat and family name, the roster's own capitol phone winning; each is marked official: false.` });
  }
  if (records.length === 0) return { candidateId: null, promotedVersionId: null, records: 0, gaps, outcome: null };
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor({
    contractId: MEMBER_OFFICES_CONTRACT_ID, version: input.now, sourceThrough: input.now,
    sourceReceipt: { contractVersion: 1, reviewedAt: input.now, reviewedBy: "code:member-offices-publication", sources },
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
