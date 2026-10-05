import type { AskGapCode, AskGapRecordClass } from "./gap-codes.ts";
import type { AskIntent, AskTemporal } from "./intent.ts";

/**
 * **THE EVIDENCE PACK — everything the synthesis rung is allowed to know.**
 *
 * This is the boundary that makes a generated civic sentence safe to show. The
 * synthesis model is given this object and NOTHING ELSE: no corpus access, no
 * tools, no web, no second question. Whatever is not in here cannot appear in
 * the answer, and `validate.ts` checks that afterwards rather than trusting it.
 *
 * Two properties matter more than the shape:
 *
 * 1. **Every record carries its own provenance.** Not a bibliography at the
 *    bottom — a `sourceUrl` and `sourceOrg` on the record itself, so a
 *    sentence about an agenda item is traceable to the document that item was
 *    read out of. A record with no source is a record the answer may not
 *    assert.
 *
 * 2. **The gaps travel with the records.** `gaps` is not error handling; it is
 *    evidence of the same standing as the records, and it is what lets the
 *    answer say *"we hold no record of X"* without that being a claim about
 *    the government. A pack with two records and four named gaps is a
 *    different and more honest answer than a pack with two records and
 *    silence.
 */

export interface EvidenceRecord {
  /** Native meeting/document identity survives the Ask path unchanged. */
  meetingId?: string;
  documentId?: string;
  agendaDocument?: { contentHash: string; title: string | null; publicationIndex: boolean };
  kind:
    | "MEETING"
    | "AGENDA_ITEM"
    | "AGENDA_DOCUMENT"
    | "OFFICEHOLDER"
    /* A governmental ACTION with a date and a signed primary document behind
       it - an executive order, a bill signed, a veto. AZ03: the class the
       corpus held nothing of, which is why a question about a governor s year
       could only ever be answered as a gap. */
    | "OFFICIAL_ACTION"
    | "OFFICE"
    | "BODY"
    /* The ballot's own record classes (PR #212 follow-up, 2026-08-28). Each
       one is a thing the reader can see on `/ballot` and could therefore ask
       about; before these existed the surface rendered them and Ask could not
       resolve a single one. */
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
    /* A verified civic relationship a reader can act on. `lib/ask/contacts.ts`
       is the only thing that mints these, and it mints none that is not read
       off a sourced roster row. */
    | "CONTACT"
    /*
     * **A LINE A CLERK PUT ON AN AGENDA, FOUND BY TOPIC SWEEP.** (ASK-05,
     * 2026-08-28.)
     *
     * `AGENDA_ITEM` is *this meeting's* docket, retrieved because the reader
     * named the body that sits. An `AGENDA_MENTION` is the other question —
     * *"is there a data centre coming?"* — a keyword sweep across every
     * readable agenda in scope, which finds a line in a government the reader
     * did not name.
     *
     * They are separate kinds because the DENOMINATOR is different and a
     * reader has to be able to tell them apart: one is "these are the items on
     * that sitting", the other is "this is what we found in the N agendas we
     * hold". Collapsing them would let a sweep hit read as a body's docket.
     * `lib/ask/agenda-topic.ts` is the only thing that mints these.
     */
    | "AGENDA_MENTION"
    /*
     * **HOW A NAMED PERSON VOTED ON ONE NAMED ROLL CALL.** (ASK-06,
     * 2026-08-28.)
     *
     * The chamber's own recorded position, on the chamber's own question, with
     * the chamber's own roll-call page as the source. Never a tally we
     * computed, never a characterisation, never a rate, and never a position
     * inferred from party, district or anything else: the record exists
     * because the promoted federal/state projection holds a row keyed on a
     * STABLE officeholder identifier, or it does not exist at all. `lib/ask/votes.ts` is the only
     * thing that mints these, and the identity rule that gates it is the whole
     * of that module's doc block.
     */
    | "ROLL_CALL_VOTE"
    /** Curated question context is separate from a member's recorded position. */
    | "KEY_VOTE_CONTEXT"
    | "KEY_VOTE_POSITION"
    | "BILL_SUMMARY"
    /*
     * **WHAT A BODY DID TO ONE AGENDA ITEM.** (2026-08-29.)
     *
     * The clerk's post-meeting record: the verb, the disposition, the mover and
     * seconder, and the tally prose verbatim. Classed `ACTION_SUMMARY` in
     * `lib/answerability/record-class.ts`, which admits it for
     * `WHAT_WAS_DECIDED` and REFUSES it for `HOW_DID_THEY_VOTE` — an action
     * summary carries the result, never each member's position.
     *
     * **It is a different kind from `AGENDA_ITEM` because it is a different
     * claim.** An agenda item proves a thing was NOTICED. This proves something
     * was DONE with it. Collapsing them is the exact failure ASK-06 was written
     * for: a pack of agenda lines handed to a synthesis rung that was asked
     * about a decision produces a confident, sourced account of a vote nobody
     * has a record of.
     */
    | "MEETING_ACTION"
    /*
     * **HOW ONE NAMED MEMBER VOTED ON ONE MEETING ITEM.** (2026-08-29.)
     *
     * Deliberately NOT `ROLL_CALL_VOTE`, which is minted only by
     * `lib/ask/votes.ts` off the promoted vote projections — a legislator's position on a
     * chamber's question, keyed on a stable officeholder identifier. This is a
     * local body's per-item roll call read off the publisher's own vote table,
     * and the two have different sources, different identity rules and
     * different denominators. One kind for both would let a reader's "how did
     * they vote" be answered from whichever store happened to have a row.
     *
     * The publisher's word is carried UNMAPPED — "Aye", "Not Present",
     * "Recused", "Abstain". Across the 2,083 rows held on 2026-08-29, 72 are
     * none of yes-or-no, and a mapping to a boolean would have destroyed every
     * one of them. A tally is never expanded into these.
     */
    | "MEETING_MEMBER_VOTE"
    | "MEETING_MINUTES_SUMMARY"
    | "MEETING_NOTICE_SUMMARY"
    | "PUBLIC_COMMENT_ACCESS"
    | "ROSTER_IDENTITY_GAP"
    /*
     * **A COMMITTEE'S ROW IN A FILING OFFICER'S OWN REGISTER.** (2026-08-30.)
     *
     * The filing officer's register is the one held record that links a
     * committee to anything: it names the committee, its type, its status and
     * the OFFICE it registered for — never a person, and never a position on a
     * measure. `lib/ask/local-finance.ts` is the only thing that mints these,
     * and it mints one only where the register's own office designation maps
     * to the canonical body the reader asked about. A committee whose register
     * row names no office appears for NO body, however suggestive its name.
     */
    | "FINANCE_COMMITTEE"
    /*
     * **ONE ITEMIZED MONEY ROW OFF A FILED CAMPAIGN-FINANCE REPORT.**
     * (2026-08-30.)
     *
     * A contribution a committee reported receiving, or spending it reported
     * making — the filer's own row, with the filing id it came off. The two
     * directions are stated in the record's own text and are never summed,
     * netted or totalled: a total would be our arithmetic wearing a filing's
     * provenance. Every row this kind can carry today is from a
     * candidate/committee campaign-finance report; an INDEPENDENT-EXPENDITURE
     * report is a different document class, none is held, and the pack that
     * carries these records must say so as a named gap — outside spending for
     * or against a candidate is not money a campaign received, and collapsing
     * the two would be a false claim built from real rows.
     */
    | "FINANCE_TRANSACTION"
    | "FINANCE_SUMMARY";
  /** Stable id where one exists — the validation rung matches on it. */
  id: string;
  /** Canonical holding subject when the reader's question uses a bridged card identity. */
  canonicalSubjectId?: string;
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
  /**
   * Exact normalized totals accompany the grounded prose for cross-surface parity.
   * The filer's registered committee name, the agency, the cycle and the read
   * date ride with them (2026-09-25), so a composed money answer states the
   * record's own fields rather than re-reading its sentence.
   */
  /** A roll call's own fields, beside its sentence (2026-09-29): what a composed vote answer states without re-reading the text. */
  rollCall?: { position: string; what: string; when: string; result: string };
  finance?: {
    jurisdiction: string; filingState: string;
    totals: { receipts: number | null; expenditures: number | null; cashOnHand: number | null; reportCount: number | null; coveringPeriod: string | null };
    registeredName?: string; agency?: string; electionYear?: number; checkedAt?: string;
    funding?: import("../funding/state-money-funding.ts").StateMoneyFunding;
  };
  /**
   * **WHOSE RECORD THIS IS — the canonical body id.** (2026-08-29.)
   *
   * Present on every record that belongs to one identifiable government: a
   * MEETING, and anything read off that meeting's own documents. Null or absent
   * where the record genuinely belongs to no single body — a ballot measure, a
   * statewide officeholder, a topic sweep that deliberately ranges wider than
   * one government.
   *
   * It exists so `validate.ts` can perform the ONE identity check that is
   * mechanically decidable: a pack whose subject is a body must not contain
   * another body's civic records. Before this, the validator could only compare
   * PROSE against the subject's name — so it passed fluent prose built from a
   * wrong-body pack, which is exactly what shipped when a Central Arizona Water
   * Conservation District event was returned as the Pima County Board of
   * Supervisors' next meeting.
   *
   * **The retrieval fix is primary and this is the second wall.** A check here
   * cannot make retrieval correct; it can stop a future regression in retrieval
   * from reaching a reader, which the name-only check demonstrably could not.
   */
  bodyId?: string | null;
  /**
   * **THE CANONICAL SUBJECT THIS RECORD IS EVIDENCE *FOR*.** (ASK-24, 2026-09-02.)
   *
   * `bodyId` answers *whose government is this*, and it is null for everything
   * that belongs to no single body — a ballot measure, a statewide officeholder,
   * a topic sweep. That left the pipeline with no id-level way to ask the second
   * question, *is this record about the thing the reader asked about*, for a
   * subject that is not a body. So the Prop 141 pack carried the U.S. Senate
   * absence and three of the reader's own legislators, none of which is about
   * Proposition 141 — and every one reached the synthesis rung, which then
   * wrote a bullet about a Senate seat under a question about a tax measure.
   *
   * This is the positive half of the relevance gate: a record retrieved AS the
   * bound subject's evidence carries that subject's id here, so
   * `lib/ask/relevance.ts` can keep it and drop a record stamped for a DIFFERENT
   * subject at the id level rather than by reading prose. Null or absent where a
   * record genuinely belongs to no one subject — the gate then falls back to the
   * kind-scoped rules it holds, and a null is never treated as a foreign stamp.
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
}

/**
 * A gap NAMED, and named as whose it is.
 *
 * `OURS` and `THEIRS` are not a style choice. "We have not recorded this yet"
 * is a fact about this product; "the district has not published an agenda for
 * that sitting yet" is a fact about a government. Rendering them as the same
 * sentence is the render defect the constitution names, and a synthesis model
 * handed an unlabelled gap will pick one at random.
 *
 * **AND THE SECOND SENTENCE HAS TO BE EARNED.** (ASK-07, 2026-08-29.) That
 * example was written as an illustration of the TYPE and got read as a
 * licence: the body-agenda branch emitted it off `documents.length === 0`,
 * which measures our own rows and nothing about a district. `THEIRS` requires
 * evidence that measured THEM — for agendas, a first-party reading of the
 * publisher's own surface, scoped to that exact sitting and still inside its
 * freshness window. `lib/ask/agenda-publication.ts` is where that is decided,
 * and it is the only place in this pipeline that may decide it.
 */
export interface EvidenceGap {
  whose: "OURS" | "THEIRS";
  /** Plain language, reader-safe. This is the sentence the answer may use. */
  statement: string;
  /*
   * **WHICH HELD GAP THIS IS, FOR THE MACHINE.** (2026-09-25.) Additive and
   * optional: set where the gap is decided by `held-gaps.ts`, the one decision
   * the standing runner's `ask-gaps` provider also makes, so a gap a reader is
   * told about is a gap the system is working. Never part of the sentence and
   * never handed to the synthesis model (`gapWords`).
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
  /**
   * What was searched to produce this, so the answer can state a denominator
   * rather than implying completeness. A search over nine readable agendas
   * that found nothing is a different sentence from a search over zero.
   */
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

/**
 * Is there enough here to be worth a generated sentence at all?
 *
 * A pack with no records is not a failure of this product and it is not a
 * question for a model: the honest structured statement of the gap IS the
 * answer, and running synthesis over an empty pack invites exactly the
 * plausible-prose failure the whole pipeline is built to prevent.
 */
export function packHasEvidence(pack: EvidencePack): boolean {
  return pack.records.length > 0;
}

/**
 * **THE PROVENANCE OF WHAT ACTUALLY SUPPORTED THE ANSWER.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * The signal row stored three counts — records, sources, gaps — and nothing
 * that could answer the question the store exists to answer:
 *
 * > What evidence supported the answer readers actually saw?
 *
 * A count cannot answer it. Three records and two sources describes ten
 * thousand different answers, and an audit of a delivered claim months later
 * has nothing to open. So the row carries the IDENTIFIERS: which records, from
 * which publishers, at which URLs, read when.
 *
 * **It carries references, never the documents.** A public agenda is already
 * public and duplicating it into a behavioural store would make that store a
 * document archive by accident, with all the retention and size consequences
 * that follow. What is kept is the pointer, bounded, so the evidence set can be
 * reconstructed from the corpus rather than re-read out of the signal row.
 *
 * Nothing here is about a reader. Every field is a fact about a public record.
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
