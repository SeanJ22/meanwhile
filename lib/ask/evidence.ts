import type { AskGapCode, AskGapRecordClass } from "./gap-codes.ts";
import type { AskIntent, AskTemporal } from "./intent.ts";
import type { GovernmentBudgetFact } from "../civic-data/government-budget-contract.ts";

/**
 * The evidence pack: everything the synthesis rung is allowed to know, with no
 * corpus access, tools or web; `validate.ts` checks the answer afterwards.
 * Every record carries its own `sourceUrl` and `sourceOrg`, and a record with
 * no source may not be asserted. Gaps travel with the records as evidence of
 * the same standing.
 */

export interface EvidenceRecord {
  /** A native source or separately verified extraction names the speaker and publication date.
   * A page search hit alone may never populate this field. */
  verifiedStatement?: { speakerId: string; quote: string; date: string; attribution: string; nativeSourceId: string };
  governmentFinance?: GovernmentBudgetFact;
  federalMoney?: { readonly fact: import("../federal-money/model.ts").FederalMoneyFact; readonly relationship: "RECIPIENT" | "GEOGRAPHY" | "BOTH"; readonly divisionId: string };
  /** Native meeting/document identity survives the Ask path unchanged. */
  meetingId?: string;
  documentId?: string;
  agendaDocument?: { contentHash: string; title: string | null; publicationIndex: boolean };
  kind:
    | "GOVERNMENT_FINANCE"
    | "FEDERAL_MONEY"
    | "MEETING"
    | "AGENDA_ITEM"
    | "AGENDA_DOCUMENT"
    | "OFFICEHOLDER"
    /* A governmental action with a date and a signed primary document: an executive order, a bill signed, a veto. */
    | "OFFICIAL_ACTION"
    | "OFFICE"
    | "BODY"
    /* The ballot's own record classes. */
    | "CONTEST"
    | "CANDIDACY"
    | "CANDIDATE_BIO"
    | "CANDIDATE_LINK"
    | "CANDIDATE_CONTACT"
    /** A search hit in a linked page. The page's speaker and the person's stance are unverified. */
    | "SOURCE_PASSAGE"
    | "MEASURE_QUESTION"
    | "MEASURE_STATEMENT"
    | "MEASURE_ANALYSIS"
    | "MEASURE_SUMMARY"
    | "MEASURE_PROVISION"
    | "BALLOT_ABSENCE"
    /* A verified civic relationship; minted only by `lib/ask/contacts.ts` from sourced roster rows. */
    | "CONTACT"
    /*
     * A line found on an agenda by topic sweep (`lib/ask/agenda-topic.ts`), not
     * the named body's docket (`AGENDA_ITEM`): the denominators differ.
     */
    | "AGENDA_MENTION"
    /*
     * The chamber's own recorded position on one named roll call, keyed on a
     * stable officeholder identifier. Minted only by `lib/ask/votes.ts`. Never a
     * computed tally or an inferred position.
     */
    | "ROLL_CALL_VOTE"
    /** Curated question context is separate from a member's recorded position. */
    | "KEY_VOTE_CONTEXT"
    | "KEY_VOTE_POSITION"
    | "BILL_SUMMARY"
    /*
     * What a body did to one agenda item: verb, disposition, mover, seconder
     * and tally prose verbatim. Classed `ACTION_SUMMARY`: it answers
     * `WHAT_WAS_DECIDED`, never `HOW_DID_THEY_VOTE`. An agenda item proves a thing
     * was noticed; this proves something was done.
     */
    | "MEETING_ACTION"
    /*
     * One named member's vote on one meeting item, from the publisher's vote
     * table. Not `ROLL_CALL_VOTE`: different source, identity rule and
     * denominator. The publisher's word is carried unmapped ("Aye", "Recused");
     * a tally is never expanded into these.
     */
    | "MEETING_MEMBER_VOTE"
    | "MEETING_MINUTES_SUMMARY"
    | "MEETING_NOTICE_SUMMARY"
    | "PUBLIC_COMMENT_ACCESS"
    | "ROSTER_IDENTITY_GAP"
    /*
     * A committee's row in a filing officer's register: committee, type, status
     * and the office it registered for. Minted only by `lib/ask/local-finance.ts`,
     * and only where that office maps to the canonical body asked about.
     */
    | "FINANCE_COMMITTEE"
    /*
     * One itemized money row off a filed campaign-finance report. Receipts and
     * spending are never summed or netted. Independent-expenditure reports are a
     * different document class; a pack carrying these states that as a gap.
     */
    | "FINANCE_TRANSACTION"
    | "FINANCE_SUMMARY";
  /** Stable id where one exists — the validation rung matches on it. */
  id: string;
  /** Canonical holding subject when the reader's question uses a bridged card identity. */
  canonicalSubjectId?: string;
  fecProfile?: { candidateId: string; name: string; personId: string };
  officeholder?: { officialId: string; termNote: string | null };
  rosterGap?: import("../registry/body-rosters.ts").RosterReaderGap;
  /** A source-listing group is not a verified count of distinct meetings. */
  meetingListingIdentity?: import("../meetings/listing-identity.ts").MeetingListingIdentityReadback["groups"][number];
  noticeSummary?: { documentId: string; contentHash: string; writtenAt: string };
  /** Published body-wide rules, not an inferred event-specific instruction. */
  accessRule?: { field: "commentPeriod" | "commentPeriodDetail" | "timeLimit" | "signup" | "writtenComment" | "attend"; value: string; standingRule: true };
  /** Exact candidate-card field and source label, without a name-based join. */
  candidateProfile?: {
    field: "bio" | "official" | "campaign" | "email" | "phone";
    value: string;
    label: string;
    holdingPath: string;
    holdingKey: string;
    verification?: string;
    sourceNote?: string | null;
    provenanceLimitation?: string | null;
  };
  /** A roll call's own fields beside its sentence. */
  rollCall?: { position: string; what: string; when: string; result: string };
  stateDetailSource?: import("../funding/finance-detail-source.ts").FinanceDoorDetailSource;
  fecDetailSource?: import("./fetch-through-key.ts").FinanceDetailSource;
  /** Exact normalized totals, with the filer's registered name, agency, cycle and read date. */
  finance?: {
    jurisdiction: string; filingState: string;
    totals: { receipts: number | null; expenditures: number | null; cashOnHand: number | null; reportCount: number | null; coveringPeriod: string | null };
    registeredName?: string; agency?: string; electionYear?: number; checkedAt?: string;
    funding?: import("../funding/state-money-funding.ts").StateMoneyFunding;
  };
  /**
   * The canonical body this record belongs to; absent where it belongs to no
   * single body. `validate.ts` uses it to refuse a body subject's pack holding
   * another body's records.
   */
  bodyId?: string | null;
  /**
   * The canonical subject this record is evidence for. `lib/ask/relevance.ts`
   * keeps matching records and drops ones stamped for a different subject.
   * Null or absent is never treated as a foreign stamp.
   */
  subjectId?: string | null;
  keyVote?: {
    entryIds: string[];
    positionKeys: string[];
    chamber: "house" | "senate";
    congress: number;
    session: number;
    rollNumber: number;
    position: string;
    referenceVerifiedAt: string;
  };
  /** The record's own words, or a mechanical read of its fields. Never a summary. */
  text: string;
  /** Stored plain-English measure meaning, carried with its exact source. */
  measureMeaning?: { readonly vote: "YES" | "NO"; readonly meaning: string };
  /** ISO date this record is ABOUT, where that is meaningful. */
  occurredAt?: string | null;
  sourceUrl?: string | null;
  sourceOrg?: string | null;
  retrievedAt?: string | null;
  publicationDate?: string | null;
  official?: true;
}

/**
 * A gap, named as whose it is. OURS is a fact about this product; THEIRS a
 * fact about a government, which needs evidence that measured them (for
 * agendas, decided only in `lib/ask/agenda-publication.ts`).
 */
export interface EvidenceGap {
  whose: "OURS" | "THEIRS";
  /** Plain language, reader-safe. This is the sentence the answer may use. */
  statement: string;
  /*
   * Which held gap this is, set where `held-gaps.ts` decides it. Never part of
   * the sentence and never given to the synthesis model (`gapWords`).
   */
  code?: AskGapCode;
  /** The canonical body the gap belongs to. */
  bodyId?: string;
  /** The routine record class whose read closes it. */
  recordClass?: AskGapRecordClass;
}

/** What a reader and the synthesis model are given of a gap: whose it is and its sentence, nothing else. */
export function gapWords(gap: EvidenceGap): Pick<EvidenceGap, "whose" | "statement"> {
  return { whose: gap.whose, statement: gap.statement };
}

/** What the question resolved to. Null means nothing canonical was bound. */
export interface EvidenceSubject {
  kind: "BODY" | "PERSON" | "MEASURE" | "CONTEST" | "OFFICE";
  id: string;
  name: string;
  /** The office, for a person. Identity is person AND office, never either. */
  office?: string | null;
}

export interface EvidencePack {
  question: string;
  intent: AskIntent;
  temporal: AskTemporal;
  subject: EvidenceSubject | null;
  records: EvidenceRecord[];
  gaps: EvidenceGap[];
  /** What was searched, so the answer can state a denominator. */
  denominators: Record<string, number>;
  /** `YYYY-MM-DD`, supplied. This module is not a clock. */
  today: string;
}

/** Every source URL the pack actually contains — the allow-list for the answer. */
export function packSourceUrls(pack: EvidencePack): Set<string> {
  const urls = new Set<string>();
  for (const record of pack.records) {
    if (record.sourceUrl) urls.add(record.sourceUrl);
  }
  return urls;
}

/** Is there enough to be worth a generated sentence? An empty pack's gap statement is the answer. */
export function packHasEvidence(pack: EvidencePack): boolean {
  return pack.records.length > 0;
}

/**
 * Which evidence supported the answer readers saw: record refs, source URLs,
 * publishers and retrieval stamps. References only, never the documents, and
 * nothing about the reader.
 */
export interface EvidenceProvenance {
  /** `<kind>:<id>` for each record the answer was built from. */
  recordRefs: string[];
  /** Distinct source URLs, in first-seen order. */
  sourceUrls: string[];
  /** Distinct publishers named on those records. */
  sourceOrgs: string[];
  /** The oldest and newest retrieval stamps present, for staleness audit. */
  retrievedFrom: string | null;
  retrievedTo: string | null;
}

/** How many references one row may carry. An audit trail, not an archive. */
export const MAX_PROVENANCE_REFS = 40;
export const MAX_PROVENANCE_REF_CHARS = 240;

export function evidenceProvenance(records: readonly EvidenceRecord[]): EvidenceProvenance {
  const recordRefs: string[] = [];
  const sourceUrls: string[] = [];
  const sourceOrgs: string[] = [];
  const stamps: string[] = [];

  for (const record of records.slice(0, MAX_PROVENANCE_REFS)) {
    recordRefs.push(`${record.kind}:${record.id}`.slice(0, MAX_PROVENANCE_REF_CHARS));
    if (record.sourceUrl && !sourceUrls.includes(record.sourceUrl)) {
      sourceUrls.push(record.sourceUrl.slice(0, MAX_PROVENANCE_REF_CHARS));
    }
    if (record.sourceOrg && !sourceOrgs.includes(record.sourceOrg)) {
      sourceOrgs.push(record.sourceOrg.slice(0, MAX_PROVENANCE_REF_CHARS));
    }
    if (record.retrievedAt) stamps.push(record.retrievedAt);
  }

  stamps.sort();
  return {
    recordRefs,
    sourceUrls,
    sourceOrgs,
    retrievedFrom: stamps[0] ?? null,
    retrievedTo: stamps[stamps.length - 1] ?? null,
  };
}
