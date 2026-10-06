import { governmentFinanceEvidence, governmentFinanceQuestion, composeGovernmentFinanceAnswer } from "@/lib/ask/government-finance";
import { type MeetingsSnapshot } from "@/lib/meetings/snapshot";
import { ensureReaderAuthorityEdge, readReaderEdgeMeetings, readReaderManifest } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "@/lib/registry/runtime-edge";
import { AUTHORITY_FAMILIES, type AuthorityFamily, type PromotedAuthorityFamily } from "@/lib/meetings/edge-artifacts";
import { READER_MAP_AUTHORITY_FAMILIES } from "@/lib/meetings/edge-serving";
import type { Meeting } from "@/lib/sources/types";
import type { AskSitting } from "@/lib/ask/answer";
import { type AgendaDocumentLike } from "@/lib/routing/agenda-search";
import { seatHolderById, settleCommentAccessRead, settleFederalDirectoryRead, settleRegistryAuthorityReads } from "@/lib/registry/server";
import { officialIdsForCandidacy } from "@/lib/funding/campaign-money";
import { canonicalOfficialAliases } from "@/lib/ask/official-identity";
import {
  actionsFor,
  actionText,
  executiveActionStore,
  monthsBefore,
  settleExecutiveActionsRead,
  undatedFor,
} from "@/lib/officials/executive-actions";
import type { BindableEntity } from "@/lib/routing/named-entity";
import { asksForBodyAgenda, classPhraseIn, mentionBeforeClassPhrase } from "@/lib/routing/named-entity";
import { applyNamedBodyDecision, decideNamedBody } from "@/lib/ask/body-confirmation";
import { sittingAgendaHoldings } from "@/lib/ask/held-agenda";
import { outcomeQuestionClass } from "@/lib/ask/outcome-question";
import { ripcordPulled } from "@/lib/ripcords";
import { intakeLimits, isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";
import { markerFromRequest } from "@/lib/db/run-marker";
import { DIVISION_VINTAGE } from "@/lib/db/search-log";

import {
  evidenceProvenance,
  packHasEvidence,
  type EvidenceGap,
  type EvidencePack,
  type EvidenceRecord,
  type EvidenceSubject,
} from "@/lib/ask/evidence";
import { snapshotEntities, titleCaseName } from "@/lib/ask/inventory";
import { bodyIdentityIndex, canonicalBodyIdentity } from "@/lib/ask/body-identity";
import { statementEvidenceFor } from "@/lib/ask/statements";
import { stanceAnswerability } from "@/lib/ask/stance-answerability";
import { fetchThroughKey, composeFinanceDetail } from "@/lib/ask/fetch-through-key";
import { campaignMoneyEvidenceFor } from "@/lib/ask/campaign-money";
import { candidateProfileEvidenceFor } from "@/lib/ask/candidate-profile";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyConflictCardForFiling, reconciledCandidacyIdForCard, type PartyConflictFiling } from "@/lib/identity/az-2026";
import { meetingOutcomeEvidenceFor, outcomeSittingsOnDate, meetingRecordQuestionClass, type HeldMeetingAction } from "@/lib/ask/meeting-outcomes";
import { minutesSummaryEvidenceFor, commentAccessEvidenceFor, noticeSummaryEvidenceFor, meetingListingKnowledgeFor, translatedMeetingEvidenceFor } from "@/lib/ask/meeting-knowledge";
import { officeholderEvidence } from "@/lib/ask/officeholder";
import { rosterGapEvidenceFor } from "@/lib/ask/roster-gaps";
import { formatDateLong } from "@/lib/text/format-date";
import { unavailableInterpretation, type AskIntent, type AskInterpretation, type AskTemporal } from "@/lib/ask/intent";
import { asksWhatAnOfficeDoes, officeInQuestion } from "@/lib/ask/office-question";
import { interpretQuestion, interpretWithoutModel } from "@/lib/ask/interpret";
import { bodyNameFromQuestion, groupMoneyShapeForBoundSubject, lexicalQuestionShape, lexicalReading, moneyShapeForBoundPerson, otherNamedPerson, personVotesShapeForBoundPerson, shapeForBoundBody, unheldNamedBodyQuestion } from "@/lib/ask/lexical-reading";
import { composePersonVotes } from "@/lib/ask/person-votes";
import { composeBodyRoster, composeReaderOfficials, placeNamesOf, readerOfficialsQuestion } from "@/lib/ask/reader-officials";
import { areaMeetingsQuestion, composeAreaMeetings, type AreaSitting } from "@/lib/ask/area-meetings";
import { composeBallotOnlyAnswer } from "@/lib/ask/ballot-only-answer";
import { ballotQuestionHint, ballotQuestionShape, composeBallotSummary, composeOfficeField, contestsForBallotAsk } from "@/lib/ask/ballot-summary";
import { composeSittingAnswerWithBasis, settleSittingComposition, sittingVenue, type SittingGap, type SittingGapRole } from "@/lib/ask/sitting-answer";
import { composeOwnWordsAnswer } from "@/lib/ask/own-words";
import { composeMeasureMeaningAnswer, requestedMeasureVotes } from "@/lib/ask/measure-meaning";
import { composeGroupMoneyAnswer, composeMoneyAnswer, composeNoRaceMoneyAnswer, contestFitsBody, moneyQuestionShape } from "@/lib/ask/money-answer";
import { codeBestReading, speculationVerdict, type ReadingOutcome } from "@/lib/ask/speculative-reading";
import { resolveInterpretation } from "@/lib/ask/resolve";
import { readSubjectRefs, type AskSubjectRef } from "@/lib/ask/subject";
import { readableSitting } from "@/lib/ask/meeting-time";
import {
  contactForOfficeholder,
  contactRecord,
  contactsForBody,
  contactsForDivision,
  contactsForRepresentatives,
  type AskContact,
} from "@/lib/ask/contacts";
import { contactForCandidate } from "@/lib/ask/candidate-contact";
import { keyVoteEvidenceFor } from "@/lib/ask/key-votes";
import { settleFundingRead } from "@/lib/funding/snapshot";
import { settleStateMoneyReads } from "@/lib/funding/state-snapshot";
import { settleAzPimaFinanceRead } from "@/lib/control-plane/campaign-finance/held-records";
import { isRetiredStateRollCallScope, refreshStateVotesFromPromoted } from "@/lib/sources/legiscan/snapshot";
import {
  officialStateRollCallTargetByScope,
  officialStateVoteScopeForOfficeholderId,
  type OfficialStateVoteScope,
} from "@/lib/state-rollcalls/authority";
import { settleFederalVotesRead } from "@/lib/votes/snapshot";
import { settleFederalKeyVotesRead } from "@/lib/votes/key-votes-projection";

import {
  settleAzBallotRead,
  settleCandidateCorpusRead,
  settleCandidateProfilesRead,
} from "@/lib/civic-data/manual-read-models";
import { promotedVersionOrThrow } from "@/lib/civic-data/read-model";
import {
  refreshCommentAccessFromPromoted,
} from "@/lib/civic-data/curated-reader-read-model";
import { settleOfficeholderStatementsRead } from "@/lib/corpus/data-plane";
import {
  absencesForDivisions,
  absencesWithoutRemovals,
  ballotAskInventory,
  ballotRecordsFor,
  ballotSubject,
  namedSourceFilingIds,
  type BallotSubjectRecord,
} from "@/lib/ask/ballot-inventory";
import { readLocationOrigin, stampResidency } from "@/lib/ask/residency";
import { captureAskInteraction } from "@/lib/db/ask-signal";
import { askCallerKey, cacheCallLine } from "@/lib/ask/prompt-cache";
import { askModelStartupLine, resolveAskRoleModel } from "@/lib/ask/model";
import { askUnsourced, shouldFallBack } from "@/lib/routing/unsourced-fallback";
import {
  interpretationCacheKey,
  synthesisCacheKey,
} from "@/lib/ask/model-result-cache";
import { allowCall, interpretationCache, synthesisCache } from "@/lib/ask/grounded-state";
import { settleGroundedSourcePreloads } from "@/lib/ask/grounded-preloads";
import { ladderIdentity, synthesisLadder, synthesizeWithLadder, type LadderResult } from "@/lib/ask/synthesize";
import { writerSelection } from "@/lib/ask/writer-selection";
import { sittingsOnSameLocalDay, selectSitting, type AgendaSelection } from "@/lib/ask/select";
import { meetingDateInQuestion } from "@/lib/ask/meeting-date";
import {
  classifyAgendaPublication,
  publisherAgendaObservationsFor,
  observationFromMeetingRecord,
} from "@/lib/ask/agenda-publication";
import {
  loadedFrom as outcomeStoreLoadedFrom,
  outcomeProjectionReadState,
  publicationObservationsFor,
  refreshOutcomeSnapshotFromPromoted,
  settleOutcomeRead,
  sittingsForBody,
} from "@/lib/outcomes/store";
import { buildTopicTimeline, composeAreaTopicAnswer, composeTopicAnswer, topicFocusedQuestion } from "@/lib/ask/topic-timeline";
import { ASK_GAP_RECORD_CLASS, meetingsNotHeldGap } from "@/lib/ask/held-gaps";
import { planAskGapObservations, recordAskGapObservations, statedAskGaps } from "@/lib/ask/gap-observation";
import { afterResponse } from "@/lib/log/after-response";
import { emptyTrace, type AnswerMode, type AskTrace } from "@/lib/ask/trace";
import { validateAnswer } from "@/lib/ask/validate";
import { settleRejectedModelAnswer } from "@/lib/ask/length-fallback";
import { loadBallotForDivisions, namedOfficeholders, readerOfficeholders, readerRepresentatives } from "@/lib/ask/server-sources";
import { azHeldFilingSubjects, requestedHeldFilings, type HeldFilingSubject } from "@/lib/ask/held-filing-subjects";
import {
  askAnswer,
  clarifyAnswer,
  offAnswer,
  unresolvedAnswer,
  unheldBodyAnswer,
  type AskAnswerPayload,
} from "@/lib/ask/answer";
import { agendaTopicEvidence } from "@/lib/ask/agenda-topic";
import { gateContactsToSubject, gateRecordsToSubject } from "@/lib/ask/relevance";
import {
  asksOnlyMoney,
  financeQuestionAsked,
  financeQuestionAskedFor,
  financeRegimeNotesFor,
  financeScopeGapFor,
  localFinanceEvidenceFor,
} from "@/lib/ask/local-finance";
import { statesOf, voteEvidenceForIncludingHistory, voteEvidenceReadsStateRollCalls } from "@/lib/ask/votes";

/**
 * **POST /api/ask/grounded — the grounded civic answer (ASK01, 2026-08-27;
 * completed 2026-08-28).**
 *
 * ```
 *   question
 *      ↓  Claude, given the entity inventory and today's date
 *   INTERPRETATION           intent · entity mentions · tense · referent
 *      ↓  the registry's own binder, unchanged
 *   CANONICAL RESOLUTION     reader words > model expansion > page context
 *      ↓  deterministic, scoped to the resolved id and the resolved tense
 *   RETRIEVAL                only records belonging to that exact subject
 *      ↓
 *   EVIDENCE PACK            records + provenance + NAMED GAPS + denominators
 *      ↓  Claude, given the pack and nothing else
 *   SYNTHESIS
 *      ↓
 *   STRUCTURAL VALIDATION    invented URL · substituted subject · advice · tense
 *      ↓
 *   READER
 * ```
 *
 * **This is the one Ask engine.** Both surfaces reach it: `components/ask/ask-box.tsx`
 * on the map and `components/ask/ballot-ask.tsx` on the ballot. The map box used
 * to answer from `/api/ask/classify` and `/api/ask/agenda` instead, which meant
 * the grounded pipeline existed and the product's primary Ask surface did not
 * use it — two definitions of Ask truth, and the reader met the older one.
 *
 * ## What it can now resolve, and why the list grew
 *
 * The inventory was meeting bodies plus statewide executives. That answered
 * *Katie Hobbs* on the ballot by coincidence — she is a sitting executive — and
 * answered nothing at all about the challenger beside her, the contest they are
 * both in, or any of the fifteen propositions the same page renders. So the
 * ballot's own records now enter the binder as canonical entities
 * (`lib/ask/ballot-inventory.ts`), and retrieval selects on their ids.
 *
 * ## What this route deliberately does NOT do
 *
 * **It saves every question, anonymously** (October 1, 2026, Sean).
 * `captureAskInteraction` is called at the end, with the delivered answer; a
 * row is written when the request carries the browser-minted returning-reader
 * ID (the Ask continuity key), which the ask box mints on a reader's first
 * question. The ID is random, lives on the device and is never tied to a name,
 * an email or an address; the question and the answer are scrubbed of contact
 * shapes at the single write path (`lib/db/ask-signal.ts`). A request with no
 * ID writes no row rather than digesting an empty string. The coded-gap count
 * (2026-09-25) is a separate write: one more for that body, gap and day in the
 * control plane (`lib/ask/gap-observation.ts`).
 *
 * **It never lets the model reach past the pack.** The synthesis rung has no
 * corpus, no tools and no network. Its inability to look anything up is
 * structural rather than instructed.
 *
 * **It never substitutes a government.** A named body that resolves to more
 * than one thing produces `CLARIFY`; one that resolves to nothing produces
 * `UNRESOLVED`. Neither ever falls through to the reader's own ZIP, which is
 * the defect this whole surface was reopened on.
 */

export const runtime = "nodejs";

/**
 * **WHICH MODEL IS THIS DEPLOYMENT SERVING? ANSWERED IN THE LOG, AT STARTUP.**
 * (ITEM K §3, 2026-09-01.)
 *
 * Module scope, so it runs once when this route's runtime initialises — a cold
 * start on the deployed function, and process start on a local build. It
 * prints the RESOLVED model and effort, never the defaults, which is the whole
 * point: the moment a `WTP_ASK_MODEL` override exists, "read the code that was
 * deployed" stops being a way to answer the question, and an operator
 * diagnosing an answer needs it answerable from the deployment log alone.
 *
 * Two configuration values and nothing else. No reader fact, no credential,
 * no request content — the same standing rule the trace lines follow.
 */
console.log(askModelStartupLine());

const MAX_BODY_BYTES = 16384;
const MAX_QUESTION_CHARS = 400;

let ipLimiter: SlidingWindowLimiter | null = null;
function getIpLimiter() {
  ipLimiter ??= new SlidingWindowLimiter(intakeLimits().logEventsPerIpPerMinute, 60_000);
  return ipLimiter;
}

/** An answer path started from the code's own reading while the model reads (lib/ask/speculative-reading.ts). */
type Speculation =
  | { started: false; why: string; codeIntent?: AskIntent; codeTemporal?: AskTemporal }
  | { started: true; codeIntent: AskIntent; codeTemporal: AskTemporal; outcome: ReadingOutcome; writing: Promise<LadderResult>; controller: AbortController; settled: () => boolean; startedAtMs: number };

interface MeetingLike {
  id: string;
  /**
   * **WHICH BODY IS MEETING — the registry id, not the geography.**
   * (2026-08-29.)
   *
   * This field was absent, and its absence is the whole Pima defect: with only
   * `ocdId` in the shape, the one honest way to retrieve *this body's* meetings
   * did not exist, and the code did the only thing the shape left it. The
   * corpus has carried `Meeting.bodyId` since 2026-08-27 and
   * `lib/meetings/snapshot.ts` refuses to serve a snapshot without it — this
   * type simply had never been widened to let the identity through.
   */
  bodyId: string | null;
  ocdId: string | null;
  title: string;
  bodyName: string;
  startsAt: string;
  timeZone?: string | null;
  /** `DAY`: a date-only posting; `startsAt`'s midnight is never a time (M59). */
  startPrecision?: Meeting["startPrecision"];
  agendaUrl?: string | null;
  /**
   * **WHERE IT IS, WHETHER IT IS STILL ON, AND WHOSE IT IS.**
   * (Session B closure, ASK-20, 2026-08-31.)
   *
   * The third time this hand-narrowed shape has dropped fields the corpus
   * carries. ASK-05 lost `sourceOrg` and `retrievedAt` and made a sourced
   * claim unrenderable; ASK-18 lost `provenance` and made the THEIRS branch
   * unreachable outside one adapter; this lost `location`, `status` and
   * `jurisdiction` and made an Add-to-calendar control impossible to build
   * from an Ask answer while the map card beside it built one from the same
   * meeting.
   *
   * A calendar entry needs the venue or the join line, and the status decides
   * whether the control renders at all — `CalendarLinks` returns null for
   * anything but SCHEDULED, because offering to calendar a concluded meeting
   * is offering to attend one that has happened.
   *
   * The pattern is worth naming rather than just fixing again: every one of
   * these was a field that already existed on `Meeting`, already travelled on
   * the wire, and was unreachable purely by declaration.
   */
  location: Meeting["location"];
  status: Meeting["status"];
  jurisdiction: string;
  online?: Meeting["online"];
  /**
   * **WHO PUBLISHED THIS AND WHEN WE READ IT — and it was being dropped.**
   * (ASK-18, 2026-08-30.)
   *
   * `Meeting` has carried `provenance` throughout. This hand-narrowed shape
   * did not declare it, so the fields travelled on the wire and were
   * unreachable by declaration — which is the exact defect ASK-05 recorded one
   * type over, where two hand-copied contact types dropped `sourceOrg` and
   * `retrievedAt` and made a sourced claim unrenderable.
   *
   * Its absence is why the THEIRS branch in `agenda-publication.ts` was
   * unreachable outside the Legistar lane: a first-party publication
   * observation needs the page, the publisher and the read time, and all three
   * were sitting one field away.
   *
   * Optional so a caller assembling a partial meeting is not forced to invent
   * one — `observationFromMeetingRecord` refuses an incomplete provenance
   * rather than downgrading it.
   */
  provenance?: {
    sourceUrl: string | null;
    sourceOrg: string;
    collectedAt: string;
    secondHand?: boolean;
  };
  /** Present exactly when the row came from a previous snapshot. */
  carried?: unknown;
}

/**
 * **THE MEETINGS OF ONE EXACT BODY. Selected on `bodyId`, never on geography.**
 * (2026-08-29, the exact-body-identity session.)
 *
 * This replaces `meetings.filter((m) => m.ocdId === subject.id)`, which is the
 * line that answered *"What's on the Pima County Board of Supervisors agenda?"*
 * with a **Central Arizona Water Conservation District** event. The county
 * division carries 42 meetings; 30 are the Board's and 12 are the water
 * district's. `selectSitting` then correctly picked the NEXT sitting out of the
 * wrong set, which is why every rung downstream stayed green.
 *
 * ## Why it refuses rather than falls back
 *
 * An entity that is not `level: "BODY"` gets **no meetings at all**, not the
 * meetings of its division. That is the whole point. The division fallback is
 * the defect, and a fallback that fires "only when the level is missing" is the
 * defect with a longer fuse — it would sit dormant until some future inventory
 * forgot to stamp the level, and then answer confidently about the wrong
 * government again.
 *
 * Empty here is honest and it is already handled: the caller turns it into a
 * NAMED GAP that says whose gap it is, and `denominators.meetingsHeldForThisBody`
 * reports zero. "We hold no meetings for this body" is a true statement about
 * US. "This water district event is the Board's next meeting" was a false
 * statement about a GOVERNMENT.
 *
 * ONE function and two callers — the sitting selection and the agenda-topic
 * sweep — so the two can never disagree about which meetings are this body's.
 */
function meetingsForBody(
  meetings: readonly MeetingLike[],
  bound: BindableEntity | null,
): MeetingLike[] {
  if (!bound || bound.level !== "BODY") return [];
  return meetings.filter((m) => m.bodyId !== null && m.bodyId === bound.id);
}

/**
 * A division id, as the name of the government it identifies.
 *
 * `ocd-division/country:us/state:az/school_district:vail_unified_district`
 * reads as *Vail Unified District*. A mechanical un-slugging of an identifier
 * this product mints itself, exactly as `lib/ask/inventory.ts` does it — never
 * a guess about what a government calls itself.
 */
function divisionNameOf(ocdId: string): string {
  const last = ocdId.split("/").pop() ?? "";
  const slug = last.split(":")[1] ?? "";
  return slug ? titleCaseName(slug.replace(/_/g, " ")) : ocdId;
}

/**
 * **WHAT AN OFFICEHOLDER HAS DONE, retrieved and BOUNDED.** (AZ03, 2026-08-28.)
 *
 * The corpus now holds Arizona gubernatorial executive orders, read from the
 * office's own index and detail pages with a date and a signed PDF on every
 * row. That closes the half of AZ03 a permitted route exists for.
 *
 * Two things travel with the records and both are load-bearing:
 *
 * 1. **The WINDOW the reader asked for.** "In the last 12 months" is a
 *    computable range once `temporal.trailingMonths` is read, and an answer
 *    built from an unwindowed list would silently answer a different question.
 * 2. **The DENOMINATOR, and the gap for what is still not held.** An answer
 *    that listed six executive orders without saying what else exists would
 *    read as a complete account of a governor's year.
 *
 * The second point used to name `apps.azleg.gov`'s `Disallow: /` as the reason
 * signed bills and vetoes were absent. **That was a blocked ROUTE recorded as a
 * blocked FACT** (AZ04, 2026-08-28): `www.azleg.gov` is a different host, it is
 * allowed, and it publishes both halves as static indexes. The store now holds
 * chapters of session law with the approval date read off each act's own stamp,
 * and it holds the Governor's transmittal letters as documents we have not yet
 * read. Which of those is a gap, and how big, is DERIVED from the store below
 * rather than written into a sentence that cannot notice when it stops being
 * true.
 */
function officeholderActionEvidence(
  seatId: string,
  personName: string,
  today: string,
  trailingMonths: number | undefined,
  records: EvidenceRecord[],
  gaps: EvidenceGap[],
  denominators: Record<string, number>,
): void {
  const store = executiveActionStore();
  if (!store) {
    /* No store is a STATE and is reported as one, never as "they did nothing". */
    gaps.push({
      whose: "OURS",
      statement: `We couldn't load our records of what ${personName} has done in office. Please try again in a moment.`,
    });
    denominators.actionRecordsHeld = 0;
    return;
  }

  const from = trailingMonths ? monthsBefore(today, trailingMonths) : null;
  const windowed = trailingMonths ? actionsFor(seatId, { from, to: today }) : actionsFor(seatId);
  const held = actionsFor(seatId);

  denominators.actionRecordsHeld = (denominators.actionRecordsHeld ?? 0) + held.length;
  denominators.actionRecordsInAskedWindow = (denominators.actionRecordsInAskedWindow ?? 0) + windowed.length;
  if (held.length === 0) {
    gaps.push({ whose: "OURS", statement: `We have not recorded any actions in office for ${personName}.` });
    return;
  }
  denominators.executiveOrdersIndexedAtCollection = store.denominator.indexedAcrossPagesWalked;
  denominators.executiveOrdersReadAtCollection = store.denominator.detailPagesRead;

  for (const action of windowed) {
    records.push({
      kind: "OFFICIAL_ACTION",
      id: action.id,
      /* The office's own designation, title and date. Never a summary: a
         summary of an executive order is a claim about what a government did,
         made by us. */
      text: actionText(action),
      occurredAt: action.occurredAt,
      sourceUrl: action.documentUrl ?? action.sourceUrl,
      sourceOrg: action.sourceOrg,
      retrievedAt: action.collectedAt,
    });
  }

  if (windowed.length === 0) {
    gaps.push({
      whose: "OURS",
      statement:
        held.length === 0
          ? `We have not recorded any actions in office for ${personName}.`
          : `We hold ${held.length} recorded action(s) for ${personName}, none of them inside the period you asked about.`,
    });
  }

  /*
   * **THE SENTENCE THAT USED TO SIT HERE WAS FALSE, AND IT REACHED READERS.**
   * (Corrected by AZ04, 2026-08-28.)
   *
   * It said: *"We have not recorded bills signed or vetoed — the legislature's
   * bill-status system does not permit automated reading, so that half of the
   * record is not ours to show yet."*
   *
   * Every clause after the dash was wrong, and wrong in the most dangerous
   * direction: it was a claim about a GOVERNMENT, asserting that Arizona's
   * legislature withholds its own record from automated readers. What was
   * actually true is that `apps.azleg.gov` — one host, running the modern
   * bill-status application — publishes `Disallow: /`. `www.azleg.gov` is a
   * different host, it is ALLOWED with a 120-second crawl delay, and it
   * publishes the same facts as static indexes at `/sessionlaws/` and
   * `/governors-letters/`.
   *
   * **A blocked route had been written down as a blocked fact** (RULING 184),
   * and then rendered to readers as the legislature's doing. The gaps below
   * are derived from what the store actually holds, so this sentence cannot go
   * stale again while the collection moves underneath it.
   */
  const legislative = store.legislative;

  if (!legislative) {
    gaps.push({
      whose: "OURS",
      statement:
        "These are executive orders only. We have not yet recorded what she did with the legislature's bills.",
    });
  } else {
    denominators.chaptersReadAtCollection = legislative.chaptersRead;
    denominators.chaptersIndexedAtCollection = legislative.chaptersIndexed;
    denominators.governorLettersIndexedAtCollection = legislative.lettersIndexed;
    denominators.governorLettersReadAtCollection = legislative.lettersRead;

    /* OURS: a walk that has not finished is a fact about our collection, and
       it is stated as a shortfall against the publisher's own count. */
    if (legislative.chaptersRead < legislative.chaptersIndexed) {
      gaps.push({
        whose: "OURS",
        statement: `Arizona's legislature lists ${legislative.chaptersIndexed} bills that became law in the ${legislative.sessionId} session. We have read ${legislative.chaptersRead} of them so far, so anything here about bills she signed is a partial account and not the whole session.`,
      });
    }

    /*
     * OURS, and the wording is the point. The letters are SCANS, we have no
     * text-recognition step, and so we cannot say what any of them decided.
     *
     * What this must never say — and what the disjointness of the two indexes
     * makes tempting — is that these are vetoes. Not one lettered bill appears
     * among the chaptered ones, which is CONSISTENT with every letter being a
     * veto and is not evidence of it. Two letters have been read directly and
     * both were vetoes; two of a hundred and fifty-one is a floor, not a
     * verdict, and the product does not publish verdicts it did not read.
     */
    const unreadLetters = legislative.lettersRetrieved - legislative.lettersRead;
    if (unreadLetters > 0) {
      gaps.push({
        whose: "OURS",
        statement: `She also sent the legislature ${legislative.lettersIndexed} letters about individual bills. We have retrieved ${legislative.lettersRetrieved} of those letters and have not been able to read ${unreadLetters} of them — they are scanned images and we do not yet have text recognition for them. We hold the documents and can link you to them, but we will not say what any of them decided until we have read it.`,
      });
    }
  }

  /*
   * Rows we hold that no date-shaped question can reach. Surfaced rather than
   * quietly filtered out by the window, because "we have this and cannot place
   * it in time" is a different answer from not having it.
   */
  const undated = undatedFor(seatId);
  denominators.actionRecordsWithNoDate = undated.length;
  if (trailingMonths && undated.length > 0) {
    gaps.push({
      whose: "OURS",
      statement: `We hold ${undated.length} more record(s) for ${personName} that carry no date we could read, so they could not be placed inside or outside the period you asked about.`,
    });
  }

  if (!store.denominator.reachedEndOfIndex) {
    gaps.push({
      whose: "OURS",
      statement: `We read ${store.denominator.detailPagesRead} of the ${store.denominator.indexedAcrossPagesWalked} executive orders we indexed, and the index continues past what we walked.`,
    });
  }
}

/** Officeholders the reader can name — statewide executives, today. */
function personEntities(seats: readonly SeatHolder[]): BindableEntity[] {
  const out: BindableEntity[] = [];
  /*
   * **PASS THE DIVISIONS STRAIGHT THROUGH.** (Corrected 2026-08-27, found by
   * asking the ballot about Katie Hobbs and being told we hold no such thing.)
   *
   * The first version filtered to divisions matching the BARE state id before
   * calling this, which threw away every county, place and district id. On the
   * map that was invisible — the reader's division list happens to include the
   * bare state — and on the ballot it emptied the person inventory completely,
   * so a sitting governor came back UNRESOLVED on the one surface most likely
   * to be asked about her.
   *
   * `statewideExecutivesFor` already derives the state itself, by PREFIX, via
   * `stateOcdIdFrom` — which is exactly how `senatorsFor` and the who-governs
   * card do it. Re-deriving it here, differently and more strictly, was a
   * second answer to a question that already had one.
   */
  for (const seat of seats) {
    if (!seat.name) continue;
    out.push({
      id: seat.id,
      name: seat.name,
      nameClass: "person",
      divisionType: "person",
    });
  }
  return out;
}

export async function POST(request: Request) {
  const started = Date.now();
  const trace: AskTrace = emptyTrace();

  if (ripcordPulled("ripcord.askGrounded")) {
    /*
     * **A SWITCHED-OFF ENGINE IS A SENTENCE, NOT AN EMPTY PANEL.** (ASK-05.)
     *
     * This used to answer `{ mode: "OFF", why: "ripcord" }` and nothing else.
     * `"OFF"` was not a member of `AnswerMode`, both clients typed `mode` as a
     * bare `string`, and the reply matched no render branch on either surface —
     * so a reader who typed a question got their own empty form back. The mode
     * is now real, the payload is the same shape as every other, and the gap
     * says what happened.
     */
    return Response.json(offAnswer("ripcord"), { status: 200 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }

  if (!ripcordPulled("ripcord.rateLimits")) {
    if (!isSameOriginSubmission(request)) {
      return Response.json({ error: "cross-origin not accepted" }, { status: 403 });
    }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!getIpLimiter().allow(`grounded:${ip}`)) {
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    }
  }

  let body: {
    question?: unknown;
    ocdIds?: unknown;
    approximateLocation?: unknown;
    surface?: unknown;
    priorTurns?: unknown;
    activeSubjects?: unknown;
    priorSubjects?: unknown;
    locationOrigin?: unknown;
    continuityKey?: unknown;
    today?: unknown;
    confirmation?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }
  const question = body.question.slice(0, MAX_QUESTION_CHARS);
  const ocdIds = Array.isArray(body.ocdIds)
    ? body.ocdIds.filter((v): v is string => typeof v === "string").slice(0, 40)
    : [];

  // State-roll identity is established before any state pointer opens. Only
  // the state(s) named by the reader's divisions or exact source-namespaced
  // subject ids are eligible for this request; unrelated states are not
  // touched and therefore cannot suppress or delay the answer. A retired
  // STATE_ROLL_CALL scope (New Hampshire, now per-legislator) is never opened:
  // its pointer is a stale version nothing writes (R9).
  const stateVoteScopes = new Set<OfficialStateVoteScope>();
  for (const state of statesOf(ocdIds)) {
    const target = officialStateRollCallTargetByScope(`US-${state.toUpperCase()}`);
    if (target && !isRetiredStateRollCallScope(target.jurisdiction)) stateVoteScopes.add(target.jurisdiction);
  }
  for (const ref of [...readSubjectRefs(body.activeSubjects), ...readSubjectRefs(body.priorSubjects, 8)]) {
    if (!ref.id) continue;
    const scope = officialStateVoteScopeForOfficeholderId(ref.id);
    if (scope && !isRetiredStateRollCallScope(scope)) stateVoteScopes.add(scope);
  }

  /* Wall-clock per stage (2026-09-24): the time outside the model calls was
     ~2 s and unmeasured. Facts about our machinery only, like the rest of the trace. */
  const stageMs: Record<string, number> = {};
  let stageMark = Date.now();
  const lap = (name: string) => { const now = Date.now(); stageMs[name] = now - stageMark; stageMark = now; };

  /*
   * **A COLD REQUEST PAID FOR EVERY SOURCE, WHATEVER WAS ASKED.** (2026-09-24.)
   *
   * Fourteen promoted projections — money, votes, key votes, ballot, candidate
   * profiles, statements, executive actions — were read from the database
   * before every question. On a cold instance that was ~21 s measured (the
   * first live Pima request timed out; a Rockaway request returned 504 after
   * 31 s), and a question about a body's agenda needs none of them.
   *
   * 1. The registry and federal directory are served from the runner-published
   *    edge bundle when one exists, exactly as /api/meetings serves them; the
   *    database read remains the fallback.
   * 2. A topic question loads what its timeline needs — the registry and the
   *    recorded outcomes — and the other sources only if it turns out not to
   *    name its government in plain words (see the topic route below), in
   *    which case every source is loaded exactly as before.
   *
   * Each authority still owns its own read state and failure gap. A missing or
   * invalid pointer fails that source closed without rejecting the whole Ask
   * request or relabelling every unrelated source as unavailable.
   */
  const topicRoute = topicFocusedQuestion(question);
  /* "Who is my state senator?": a lookup in the officeholders held for the reader's divisions (lib/ask/reader-officials.ts). It reads the registry and the federal directory and nothing else. */
  const officialsAsk = !topicRoute && ocdIds.length > 0 ? readerOfficialsQuestion(question, statesOf(ocdIds).map((state) => state.toLowerCase()), placeNamesOf(ocdIds)) : null;
  /* "What meetings are happening this week?": the sittings held for the reader's divisions (lib/ask/area-meetings.ts). It reads the registry and the calendar and nothing else. */
  /* Not when the reader has a card open: "is there a meeting soon?" is then about that body. An earlier turn does not change it — the shapes name no body and carry no pronoun. */
  const areaMeetingsAsk = !topicRoute && !officialsAsk && ocdIds.length > 0 &&
    readSubjectRefs(body.activeSubjects).every((ref) => !ref.focused)
    ? areaMeetingsQuestion(question) : null;
  /* Both answer from the registry and what is already held for the reader's divisions: no ballot, no money, no votes, no recorded outcomes. */
  const leanAsk = Boolean(officialsAsk || areaMeetingsAsk);
  const ballotOnlyHint = !topicRoute && !leanAsk && ocdIds.length > 0 && ballotQuestionHint(question) &&
    readSubjectRefs(body.activeSubjects).every(ref => !ref.focused) &&
    readSubjectRefs(body.priorSubjects, 8).length === 0 &&
    (!Array.isArray(body.priorTurns) || body.priorTurns.length === 0);
  // A shape is only a scheduling hint here. The complete subject inventory
  // still loads, and lexicalReading below must prove the body binding before
  // unrelated evidence may stay unread. A failed/ambiguous binding restores
  // every family before the normal interpretation and retrieval path runs.
  const sittingShapes = new Set(["MEETING_TIME", "BODY_AGENDA", "MEETING_OUTCOME", "PUBLIC_COMMENT"]);
  /* Shapes whose subject is never a person: their answer reads no vote, statement or action record, and no county finance
     unless it is a money question. Deferred the same way the sitting shapes are, on the same proof (2026-09-29, S3). */
  const noPersonRecordShapes = new Set([...sittingShapes, "BODY_ROSTER", "BODY_CIVICS", "GOVERNMENT_MONEY", "MEASURE_EXPLAIN", "CONTEST_FIELD"]);
  const deferShape = !topicRoute && !financeQuestionAsked(question) && noPersonRecordShapes.has(lexicalQuestionShape(question)?.shape ?? "");
  /* A question about a person's campaign money and nothing they did in office reads none of their votes, key votes,
     statements or actions (`moneyOnly` below), whoever the subject turns out to be: no proof is needed to leave them unread. */
  const deferPersonRecords = !topicRoute && !deferShape && asksOnlyMoney(question);
  const deferUnrelatedEvidence = deferShape || deferPersonRecords;
  const personRecordFamilies = ["federal-votes", "federal-key-votes", "officeholder-statements", "executive-actions"] as const;
  const unrelatedFamilies = new Set<AuthorityFamily>(deferShape ? ["pima-finance", ...personRecordFamilies] : personRecordFamilies);
  /*
   * **WHICH READ A COLD REQUEST WAITS ON, NAMED.** (2026-09-24, C20.) A cold
   * Pima topic request spent 2,525 ms in `sourcePreloads` with no breakdown,
   * and Sean's bar is 3 s end to end on the first attempt. Every read inside
   * the stage is timed under its own name; the source preloads run in
   * parallel, so theirs overlap rather than sum. The map reaches the trace
   * when the stage ends, early returns included.
   */
  const preloadMs: Record<string, number> = {};
  const timed = <T,>(name: string, read: () => Promise<T>) => async (): Promise<T> => {
    const started = Date.now();
    try {
      return await read();
    } finally {
      preloadMs[name] = Date.now() - started;
    }
  };
  /*
   * **EVERY SOURCE THE EDGE CARRIES IS READ FROM IT, IN ONE PARALLEL FETCH, AND
   * THE EDGE IS ENTERED HERE.** (2026-09-24, C20.) On a cold instance the
   * recorded outcomes took 2.0–2.3 s from the database (the pole of a cold Ask)
   * and the comment-access rules 0.6–0.8 s. Both are reader authority families
   * now, fetched with the registry and the federal directory. A family the
   * manifest does not carry is read from the database, started the moment the
   * manifest says so, beside the edge fetch; one whose edge fetch fails is read
   * from the database by its settle. The meetings read needs only the manifest,
   * so it starts beside the edge fetch too.
   * The edge itself is entered in THIS function's own execution:
   * `enterReaderAuthorityEdge` is `AsyncLocalStorage.enterWith`, and on Node 24
   * a store entered inside a helper never reaches the reads chained on it
   * ("none" against "EDGE"; see tests/reader-edge-context.test.ts). Entered
   * there, every edge family would silently be read from the database again.
   */
  const production = process.env.NODE_ENV === "production";
  const edgeManifest = await timed("edgeManifest", () => readReaderManifest().catch(() => null))();
  const onEdge = (family: AuthorityFamily) => Boolean(edgeManifest?.authorityArtifacts?.[family]);
  // Each database read is observed at once, so a failure while the edge is
  // fetched is never an unhandled rejection; the settle below still records it.
  const outcomesFromDatabase = leanAsk || ballotOnlyHint || onEdge("meeting-outcomes") ? null : timed("outcomes", refreshOutcomeSnapshotFromPromoted)();
  outcomesFromDatabase?.catch(() => undefined);
  const commentAccessFromDatabase = production && !leanAsk && !ballotOnlyHint && !onEdge("comment-access")
    // Public-comment rules are an independent optional family. Initialize its
    // pointer, but do not let a store outage suppress meetings, ballots,
    // officials, or any other source's answer.
    ? timed("commentAccess", () => refreshCommentAccessFromPromoted().catch(() => undefined))()
    : null;
  let authorityEdge: ReaderAuthorityEdgeBundle | null = null;
  if (edgeManifest?.authorityArtifacts) {
    authorityEdge = await timed("authorityEdge", () => ensureReaderAuthorityEdge(edgeManifest, undefined,
      ballotOnlyHint ? ["ballot-contests", "ballot-az", "ballot-nh"]
        : leanAsk ? READER_MAP_AUTHORITY_FAMILIES
        : deferUnrelatedEvidence ? AUTHORITY_FAMILIES.filter(family => !unrelatedFamilies.has(family)) : AUTHORITY_FAMILIES).catch(() => null))();
    if (authorityEdge) enterReaderAuthorityEdge(authorityEdge);
  }
  // Confirm the hint from the published ballot before leaving any source
  // unread. Legacy authorities and unmatched titles continue through the full path.
  if (ballotOnlyHint) {
    const ballot = await timed("ballot", () => loadBallotForDivisions(ocdIds))();
    const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today : new Date().toISOString().slice(0, 10);
    const direct = composeBallotOnlyAnswer(ballot, question, today);
    if (direct) {
      const { pack, composed, verdict, shape } = direct;
      const interpretation = { ...unavailableInterpretation(), intent: pack.intent, temporal: pack.temporal };
      trace.interpretation = { ran: false, why: "ballot-shape", intent: pack.intent, temporal: pack.temporal, fellBackToDeterministic: true };
      trace.resolution = { state: "NONE", basis: "HELD_BALLOT" };
      trace.retrieval = { selection: "HELD_BALLOT", recordCount: pack.records.length,
        sourceCount: composed.citedUrls.length, gapCount: pack.gaps.length, denominators: pack.denominators };
      trace.composition = { kind: "BALLOT", shape: shape.kind === "SUMMARY" ? "SUMMARY" : `OFFICE_${shape.key ?? shape.phrase}`,
        basis: "HELD_BALLOT", composed: true, passed: true };
      trace.synthesis = { ran: false, why: "composed-from-ballot-records" };
      trace.validation = { ran: true, passed: true, checked: verdict.checked };
      trace.sourcesLoaded = "ESSENTIAL";
      trace.preloads = preloadMs;
      trace.answerMode = "STRUCTURED_GROUNDED";
      trace.totalMs = Date.now() - started;
      await captureDelivered({ request, question, interpretation, resolutionState: "NONE",
        mode: "STRUCTURED_GROUNDED", subjectIds: [], answer: composed.answer, answerModel: null,
        validationPassed: true, records: [...pack.records], gaps: [...pack.gaps],
        surface: body.surface === "MAP" || body.surface === "BALLOT" ? body.surface : "UNKNOWN",
        approximateLocation: typeof body.approximateLocation === "string" ? body.approximateLocation : null,
        ocdIds, residency: stampResidency(readLocationOrigin(body.locationOrigin)),
        continuityKey: typeof body.continuityKey === "string" ? body.continuityKey : "" });
      return Response.json(askAnswer({ mode: "STRUCTURED_GROUNDED", pack, answer: composed.answer, contacts: [], trace }));
    }
    if (edgeManifest?.authorityArtifacts) {
      authorityEdge = await timed("remainingAuthorityEdge", () => ensureReaderAuthorityEdge(edgeManifest, undefined,
        deferUnrelatedEvidence ? AUTHORITY_FAMILIES.filter(family => !unrelatedFamilies.has(family)) : AUTHORITY_FAMILIES).catch(() => null))();
      if (authorityEdge) enterReaderAuthorityEdge(authorityEdge);
    }
  }
// Area questions share governing pieces with every ZIP in those divisions.
  // Questions naming a body elsewhere retain their wider subject inventory.
  const meetingsRead = readReaderEdgeMeetings({
    manifest: edgeManifest,
    window: "HELD",
    ...(ocdIds.length && (topicRoute || areaMeetingsAsk) ? { states: statesOf(ocdIds), ocdIds } : {}),

  });
  meetingsRead.catch(() => undefined);
  const essentialPreloads = [
    timed("registry", () => settleRegistryAuthorityReads("REGISTRY")),
    timed("federalDirectory", settleFederalDirectoryRead),
    outcomesFromDatabase ? () => outcomesFromDatabase : timed("outcomes", settleOutcomeRead),
    ...(commentAccessFromDatabase
      ? [() => commentAccessFromDatabase]
      : production ? [timed("commentAccess", () => settleCommentAccessRead().catch(() => undefined))] : []),
  ];
  // Where each deferrable source is read from, when it is read: its proven-pointer family on the edge, or the database.
  const promotedSource = (family: PromotedAuthorityFamily): "EDGE" | "DATABASE" =>
    authorityEdge?.promotedFamilies?.has(family) ? "EDGE" : "DATABASE";
  trace.preloadSources = {
    registry: authorityEdge?.registryRuntime ? "EDGE" : "DATABASE",
    federalDirectory: authorityEdge?.federalDirectory ? "EDGE" : "DATABASE",
    outcomes: authorityEdge?.meetingOutcomes ? "EDGE" : "DATABASE",
    ...(production ? { commentAccess: authorityEdge?.commentAccess ? "EDGE" as const : "DATABASE" as const } : {}),
    funding: promotedSource("federal-funding"),
    stateMoney: promotedSource("state-money"),
    azPimaFinance: promotedSource("pima-finance"),
    federalVotes: promotedSource("federal-votes"),
    federalKeyVotes: promotedSource("federal-key-votes"),
    azBallot: promotedSource("ballot-az"),
    candidateProfiles: promotedSource("candidate-profiles"),
    candidateCorpus: promotedSource("candidate-publications"),
    officeholderStatements: promotedSource("officeholder-statements"),
    executiveActions: promotedSource("executive-actions"),
  };
  /*
   * **THE DEFERRABLE SOURCES, EDGE FIRST.** (2026-09-25.) A cold Mesa
   * question spent 14.8 s here on production, every one of these a pointer
   * read and a proof read from a cold database (Pima finance alone 6.4 MB of
   * proof). Each is now a proven pointer on the reader edge, fetched with the
   * authority families above, and read through its own Reader from that copy
   * (`readPromotedEdgeFirst`); the database stays the fallback for a family
   * the manifest does not carry. The state roll calls stay on the database:
   * New Jersey's is 9.4 MB, read only for a New Jersey question.
   */
  /*
   * **A STATE'S ROLL CALLS ARE WAITED FOR ONLY BY A QUESTION ABOUT A PERSON.**
   * (2026-09-25, the Ask three-second repair.) Measured locally that evening
   * on production read-only data: the first New Jersey question on an instance
   * spent 5.7-6.7 s in `stateVotes:US-NJ` (9.4 MB) before anything else ran —
   * for any Rockaway meeting question, which reads no state roll call. So the
   * read is made by `answerPath`, for a PERSON subject only, right before the
   * vote retrieval that reads it — never for a body, and never left running
   * after a response (a frozen serverless instance would restart it). A
   * person question waits for it exactly as before.
   */
  let stateVotesRead: Promise<unknown> | null = null;
  let deferrableSourcesLoaded = false;
  const personStateVotes = () => {
    if (!deferrableSourcesLoaded || stateVoteScopes.size === 0) return null;
    stateVotesRead ??= settleGroundedSourcePreloads([...stateVoteScopes].map((scope) => timed(`stateVotes:${scope}`, () => refreshStateVotesFromPromoted(scope))));
    return stateVotesRead;
  };
  const pimaFinancePreload = timed("azPimaFinance", settleAzPimaFinanceRead);
  const personRecordPreloads = [
    timed("federalVotes", settleFederalVotesRead),
    timed("federalKeyVotes", settleFederalKeyVotesRead),
    timed("officeholderStatements", settleOfficeholderStatementsRead),
    timed("executiveActions", settleExecutiveActionsRead),
  ];
  const unrelatedPreloads = [pimaFinancePreload, ...personRecordPreloads];
  /* What this question lets the request leave unread: every unrelated source, or only a person's records. */
  const skippedPreloads = deferShape ? unrelatedPreloads : deferPersonRecords ? personRecordPreloads : [];
  const deferrablePreloads = [
    () => { deferrableSourcesLoaded = true; return Promise.resolve(); },
    timed("funding", settleFundingRead),
    timed("stateMoney", settleStateMoneyReads),
    timed("azBallot", async () => promotedVersionOrThrow(await settleAzBallotRead())),
    timed("candidateProfiles", settleCandidateProfilesRead),
    timed("candidateCorpus", settleCandidateCorpusRead),
    ...unrelatedPreloads.filter((preload) => !skippedPreloads.includes(preload)),
  ];
  /* The registry and the federal directory are the first two; an officials lookup needs no other source. */
  await settleGroundedSourcePreloads(topicRoute ? essentialPreloads : leanAsk ? essentialPreloads.slice(0, 2) : [...essentialPreloads, ...deferrablePreloads]);
  // The recorded outcomes are what a topic answer leads with. A cold read that
  // failed (a transient connect timeout on the first request) is retried once
  // rather than silently answering from agenda lines alone. A retry that
  // succeeds is a second-attempt success, and the trace names it (C20).
  if (topicRoute && !["PROMOTED", "BOOTSTRAP"].includes(outcomeProjectionReadState().kind)) {
    await timed("outcomesRetry", () => refreshOutcomeSnapshotFromPromoted().catch(() => undefined))();
    if (["PROMOTED", "BOOTSTRAP"].includes(outcomeProjectionReadState().kind)) {
      trace.preloadRetries = [...(trace.preloadRetries ?? []), "outcomes"];
    }
  }
  lap("sourcePreloads");
  trace.preloads = preloadMs;
  let snapshot: MeetingsSnapshot | null = null;
  let meetingDataState: "PROMOTED" | "BOOTSTRAP" | "STORE_UNREACHABLE" =
    "STORE_UNREACHABLE";
  try {
    /*
     * 2026-09-24: the SAME meetings read the map uses — the runner-published
     * edge artifacts, then the prepared row, then a live compose — instead of
     * re-reading and re-composing all 124 partitions on every question
     * (~1.4-2.3 s measured). One read path also means Ask and the map can
     * never describe two different versions of a body's calendar.
     */
    const read = await meetingsRead;
    meetingDataState = read.kind === "NOT_RECORDED" ? "STORE_UNREACHABLE" : read.kind;
    if (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP") {
      snapshot = read.value;
    }
  } catch {
    // Keep this source unavailable; the reader receives the load-failure gap below.
  }
  lap("meetingsProjection");
  // A failed meeting read must not withhold an unrelated eligible ballot or money record.
  const meetings = (snapshot?.meetings ?? []) as MeetingLike[];
  const documents = (snapshot?.agendaDocuments ?? []) as AgendaDocumentLike[];
  const surface: "MAP" | "BALLOT" | "UNKNOWN" =
    body.surface === "BALLOT" || body.surface === "MAP" ? body.surface : "UNKNOWN";

  /*
   * Bodies resolve through the CANONICAL REGISTRY, so what a reader binds to is
   * one government rather than a geography several of them share. See
   * `lib/ask/inventory.ts` for the defect this closes.
   */
  const explicitBodyIds = new Set([...readSubjectRefs(body.activeSubjects), ...readSubjectRefs(body.priorSubjects, 8)]
    .filter((ref) => ref.kind === "BODY").flatMap((ref) => ref.id ? [ref.id] : []));
  const scopedBodies = [...bodyIdentityIndex().values()].filter((entry) =>
    (entry.ocdId && ocdIds.includes(entry.ocdId)) || explicitBodyIds.has(entry.bodyId));
  const bodies = snapshotEntities([...meetings, ...scopedBodies], (bodyId) => canonicalBodyIdentity(bodyId));
  /*
   * **THE DETERMINISTIC TOPIC ROUTE.** (2026-09-24, the Pima data-center miss.)
   *
   * A question that names a curated topic and names its government in plain
   * words ("is pima county voting on data centers") needs nothing a model adds:
   * the topic detector is curated code, and the body binds lexically from the
   * question itself. The model interpretation cost ~3 s and, worse, turned
   * "is ... voting" into NEXT, which chose the wrong evidence. The resolver the
   * route uses below is probed with the deterministic reading over the held
   * bodies; only a LEXICAL binding of a body (the reader's own words, never
   * page context, a prior turn or a model expansion) takes this route. Anything
   * else — a pronoun, a follow-up, an unnamed government — loads every source
   * and goes to the model exactly as before.
   */
  let deterministicTopicRoute = false;
  /*
   * The AREA topic route (2026-09-24): "is there a data center coming?" names
   * no government, no pronoun and no earlier turn, and the reader has no body
   * open on the map. It is answered from the topic timelines of the bodies that
   * govern the reader's divisions, with no model, exactly like the body route.
   */
  let areaTopicRoute = false;
  /*
   * The NAMED-BODY topic route (2026-09-24, the Rockaway latency repair): "is
   * rockaway township voting on data centers" names its government by a class
   * phrase ("township"), so the named-body decision below is lexical: the same
   * question, the same national body index and the same confirmation give the
   * same CONFIRM (or, once the reader confirms, the same bound body) whatever a
   * model reads, because a class-phrase mention is never overridden by a model
   * binding. The first request used to load all fourteen sources and call the
   * model only to ask "did you mean the Rockaway Township Council?" — 27 s on a
   * cold instance in production. Both requests now skip the eleven
   * deferrable sources and the model; anything the lexical decision does not
   * settle takes the full path exactly as before.
   */
  const explicitBodyClass = Boolean(classPhraseIn(question) && mentionBeforeClassPhrase(question));
  const namedBodies = explicitBodyClass ? snapshotEntities([...bodyIdentityIndex().values()], canonicalBodyIdentity) : bodies;
  let namedBodyTopicRoute = false;
  if (topicRoute) {
    const probe = resolveInterpretation(interpretWithoutModel(question), question, bodies, { activeSubjects: [], priorSubjects: [] });
    deterministicTopicRoute = probe.binding.kind === "BOUND" && probe.binding.entity.level === "BODY" &&
      (probe.basis === "WHOLE_QUESTION" || probe.basis === "READER_WORDS");
    areaTopicRoute = !deterministicTopicRoute && probe.binding.kind === "NONE" && ocdIds.length > 0 &&
      readSubjectRefs(body.activeSubjects).every((ref) => !ref.focused) &&
      readSubjectRefs(body.priorSubjects, 8).length === 0 &&
      (!Array.isArray(body.priorTurns) || body.priorTurns.length === 0) &&
      !/\b(?:they|them|their|it|its|he|she|his|her|this|that|those)\b/i.test(question);
    // The reader's own words match several bodies ("rockaway township": its
    // council, its board of education...) or name one by a class phrase.
    if (!deterministicTopicRoute && !areaTopicRoute && (explicitBodyClass || probe.binding.kind === "AMBIGUOUS")) {
      const lexical = decideNamedBody(question, namedBodies, body.confirmation);
      namedBodyTopicRoute = lexical.kind === "CONFIRM" || (lexical.kind === "BOUND" && lexical.confirmed);
    }
    if (!deterministicTopicRoute && !areaTopicRoute && !namedBodyTopicRoute) await settleGroundedSourcePreloads(deferrablePreloads);
  }
  trace.sourcesLoaded = leanAsk ? "ESSENTIAL" : !topicRoute || (!deterministicTopicRoute && !areaTopicRoute && !namedBodyTopicRoute) ? "ALL" : "ESSENTIAL";
  const officeholders = await readerOfficeholders(ocdIds, scopedBodies.map((body) => body.bodyId));
  let namedPeople = 0;
  try {
    const explicitIds = [...readSubjectRefs(body.activeSubjects), ...readSubjectRefs(body.priorSubjects, 8)]
      .flatMap((ref) => ref.id ? [ref.id] : []);
    const named = await namedOfficeholders(question, explicitIds);
    namedPeople = named.length;
    for (const seat of named) if (!officeholders.seats.some((held) => held.id === seat.id)) officeholders.seats.push(seat);
  } catch {
    officeholders.loaderFailures += 1;
  }
  // A named person could bind in place of the body on the full path, so that
  // question is decided there, with every source, exactly as before.
  if (namedBodyTopicRoute && namedPeople > 0) {
    namedBodyTopicRoute = false;
    await settleGroundedSourcePreloads(deferrablePreloads);
    trace.sourcesLoaded = "ALL";
  }
  const people = personEntities(officeholders.seats);
  const preferredOfficialIds = [...readSubjectRefs(body.activeSubjects), ...readSubjectRefs(body.priorSubjects, 8)].flatMap((ref) => ref.id ? [ref.id] : []);
  const officialAliases = canonicalOfficialAliases(people.map((person) => person.id), preferredOfficialIds);

  /*
   * **THE BALLOT'S OWN ENTITIES, ON EVERY SURFACE.**
   *
   * Loaded from the reader's divisions rather than from what the client said is
   * on screen, for two reasons. A client-supplied list is a client-supplied
   * list, and a map reader asking about Proposition 423 is asking about a real
   * thing on their own ballot whether or not they are looking at the ballot
   * page. Ballot truth is not duplicated — this reads the same committed set
   * `app/ballot/page.tsx` renders from, through the same source registry.
   */
  // A topic question bound lexically to a body is not a ballot question; its
  // ballot is not read (loadBallotForDivisions([]) is the empty holding).
  const ballot = await loadBallotForDivisions(deterministicTopicRoute || areaTopicRoute || namedBodyTopicRoute || leanAsk ? [] : ocdIds);
  const ballotLoadGaps: EvidenceGap[] = ballot.loaderFailures.length ? [{ whose: "OURS", statement: "We couldn't load the ballot for your area. Please try again in a moment." }] : [];
  const meetingLoadGaps: EvidenceGap[] = meetingDataState === "STORE_UNREACHABLE"
    ? [{ whose: "OURS", statement: `We couldn't load our meeting records. Please try again in a moment.` }]
    : meetingDataState === "BOOTSTRAP"
      ? [{ whose: "OURS", statement: "These meeting records came with the site and may be out of date. We have not loaded an updated calendar yet." }]
      : [];
  const holdingLoadGaps: EvidenceGap[] = [...ballotLoadGaps, ...meetingLoadGaps, ...(officeholders.loaderFailures ? [{ whose: "OURS" as const, statement: "We couldn't load our records of who represents you. Please try again in a moment." }] : [])];
  /* A money comparison names two people. Bound on the whole question, the name
     with more words wins ("Joseph M. MURPHY" over "Marilyn ALTHOFF") and the
     other held filing never entered the inventory; each name slot is bound on
     its own too (2026-09-25). */
  const comparedSlots = ((shape) => shape?.otherSlot ? [shape.slot, shape.otherSlot] : [])(moneyQuestionShape(question));
  const ballotInventory = ballotAskInventory(ballot.set, ballot.contests, ballot.nominees,
    [...preferredOfficialIds, ...[question, ...comparedSlots].flatMap((text) => namedSourceFilingIds(text, ballot.set))]);
  let heldFilings: HeldFilingSubject[] = [];
  if (ocdIds.some(id => /\/state:az(?:\/|$)/.test(id)) && !deterministicTopicRoute && !areaTopicRoute && !namedBodyTopicRoute && !leanAsk) {
    try {
      const represented = new Set([...ballotInventory.subjects.values()].flatMap(row => [row.id, ...(row.kind === "PERSON" && row.candidacyId ? [row.candidacyId] : [])]));
      heldFilings = requestedHeldFilings(azHeldFilingSubjects(), question, preferredOfficialIds, represented);
    } catch {
      holdingLoadGaps.push({ whose: "OURS", statement: "We couldn't load the candidate filings for this answer. Please try again in a moment." });
    }
  }

  /*
   * **ONE HUMAN IS ONE SUBJECT, EVEN WHEN TWO STORES HOLD HER.**
   * (Found by the route-level red control, 2026-08-28.)
   *
   * Katie Hobbs is a sitting statewide executive AND a candidate on this
   * ballot, so she arrived as two entities with two distinct ids — and the
   * binder, correctly by its own rule, called the product's flagship question
   * AMBIGUOUS and asked the reader which Katie Hobbs they meant. A false
   * clarification is worse than a missing one: it tells a reader their question
   * was unclear when it was not, about a distinction that exists only in our
   * storage.
   *
   * The committed person/candidacy bridge supplies the aliases. A matching
   * display name alone never suppresses an official or attaches their record.
   * An officeholder with no resolved bridge keeps their own canonical ID.
   */
  const ballotOfficialIds = new Map<string, string[]>();
  const officialToBallot = new Map<string, string>();
  const filingToBallot = new Map<string, string>();
  for (const candidate of ballotInventory.subjects.values()) if (candidate.kind === "PERSON") {
    const candidacyId = reconciledCandidacyIdForCard(candidate.id) ?? candidate.candidacyId;
    if (!candidacyId) continue;
    filingToBallot.set(candidacyId, candidate.id);
    const officialIds = officialIdsForCandidacy(candidacyId);
    ballotOfficialIds.set(candidate.id, officialIds);
    for (const officialId of officialIds) officialToBallot.set(officialId, candidate.id);
  }
  /*
   * **ONE NAME, TWO PARTIES, ONE SUBJECT.** (2026-09-25.) Teri Ann Hourihan is
   * a certified card ("No Labels", the canvass) and a filing ("Arizona
   * Independent Party", the Secretary of State's list): the committed AZ
   * reconciliation holds the pair as a PARTY_CONFLICT and never makes them one
   * candidacy. A reader who types her name meant her, not a choice between two
   * of our rows, so the filing's name binds to the card; the answer then carries
   * both records and both parties with their sources (below), never one merged.
   */
  const partyConflictFilings = new Map<string, PartyConflictFiling>();
  /* A surface that focuses the filing record itself means that record: it keeps its own id. */
  const surfaceIds = new Set(preferredOfficialIds);
  const inventory = [
    ...bodies,
    ...heldFilings.map(row => row.entity),
    ...people.map((person) => ({ ...person, id: officialToBallot.get(person.id) ?? officialAliases.get(person.id) ?? person.id })),
    ...ballotInventory.entities.map((entity) => {
      const pair = entity.id.startsWith("ballot-az-") && !surfaceIds.has(entity.id) ? partyConflictCardForFiling(entity.id) : null;
      if (!pair || !ballotInventory.subjects.has(pair.cardKey) || !ballotInventory.subjects.has(pair.filingCandidacyId)) return entity;
      partyConflictFilings.set(pair.cardKey, pair);
      return { ...entity, id: pair.cardKey };
    }),
  ];
  /* The office a held candidate is on the ballot for: a race the reader names ("for her state senate race") must be it. */
  const officeOf = (id: string) => ballotInventory.subjects.get(id)?.contestTitle ?? null;

  /*
   * Today is SUPPLIED, never derived from a model and never guessed. It is
   * read from the server's clock here because this is a server; what matters
   * is that neither model rung invents it, and both are told.
   */
  const suppliedToday =
    typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today);
  const today = suppliedToday
    ? body.today as string
    : new Date().toISOString().slice(0, 10);
  /* A supplied date is the route's deterministic test/acceptance clock, not
     prompt decoration. Noon UTC keeps the requested civil day stable across
     every supported U.S. zone; ordinary production requests retain the exact
     server instant so same-day past/future selection remains truthful. */
  const selectionNow = suppliedToday
    ? Date.parse(`${today}T12:00:00.000Z`)
    : Date.now();

  /*
   * What the reader has in front of them, as REFERENCES rather than display
   * strings — canonical ids where the surface holds them, so a pronoun can
   * resolve to a person the binder actually verified. See `lib/ask/subject.ts`.
   */
  const canonicalReference = (ref: AskSubjectRef): AskSubjectRef => ({ ...ref, id: ref.id ? filingToBallot.get(ref.id) ?? officialToBallot.get(ref.id) ?? officialAliases.get(ref.id) ?? ref.id : ref.id });
  const activeSubjects: AskSubjectRef[] = readSubjectRefs(body.activeSubjects).map(canonicalReference);
  const priorSubjects: AskSubjectRef[] = readSubjectRefs(body.priorSubjects, 8).map(canonicalReference);

  /*
   * **THE READER'S BALLOT, AND AN OFFICE'S FIELD.** (2026-09-29, S3; `lib/ask/ballot-summary.ts`.)
   * "What is on my ballot?" and "Who is running for state senate in my district?" name no
   * contest the binder can bind. They are answered from the contests the reader's divisions
   * reach — and only when the composition can be made: an office with no held contest, or a
   * contest whose candidates carry a party conflict between two authorities, goes the
   * ordinary way (the model reads it and the records are retrieved by subject).
   */
  const ballotShape = !topicRoute && !leanAsk && ballot.set ? ballotQuestionShape(question, ballot.contests) : null;
  const ballotComposed = !ballotShape || !ballot.set ? null
    : ballotShape.kind === "SUMMARY"
      ? composeBallotSummary({ contests: ballot.contests, election: ballot.set.election })
      : contestsForBallotAsk(ballot.contests, ballotShape).some((contest) => [...partyConflictFilings.keys()].some((key) => key.startsWith(`${contest.id}|`)))
        ? null
        : composeOfficeField({
          key: ballotShape.key, phrase: ballotShape.phrase, contests: ballot.contests, election: ballot.set.election, nominees: ballot.nominees, candidacies: ballot.set.candidacies,
          removedCandidacyIds: new Set((ballot.set.removals ?? []).map((removal) => removal.id)),
        });
  const ballotAsk = ballotComposed ? ballotShape : null;
  lap("officeholdersAndBallot");
  // A literal reader date outranks inferred tense, including a model's reading (applied in `answerPath`).
  const requestedMeetingDate = meetingDateInQuestion(question);
  const residency = stampResidency(readLocationOrigin(body.locationOrigin));
  /* The writing ladder: the fast writer first for every question; the frontier only when its answer fails a check. */
  const ladder = synthesisLadder();
  const ladderKey = ladderIdentity(ladder);
  const callerKey = askCallerKey(process.env, markerFromRequest(request).runClass);
  const lapAt = (name: string, at: number) => { stageMs[name] = at - stageMark; stageMark = at; };
  type PackPath = Extract<Awaited<ReturnType<typeof answerPath>>, { kind: "PACK" }>;
  /** What one reading led the route to — the facts a speculative answer must share with the model's. */
  const readingOutcome = (path: PackPath): ReadingOutcome => ({
    subjectId: path.pack.subject?.id ?? null,
    bodyIds: [...(path.pack.subject?.kind === "BODY" ? [path.pack.subject.id] : []), ...path.resolvedSittings.flatMap((sitting) => sitting.bodyId ? [sitting.bodyId] : [])],
    intent: path.pack.intent,
    temporal: path.pack.temporal,
    selection: path.selection,
    writerInput: synthesisCacheKey({ ...path.pack, intent: "UNKNOWN" }, ladderKey.model, ladderKey.effort),
  });
  /*
   * **START THE ANSWER FROM THE CODE'S OWN READING WHILE THE MODEL READS.**
   * (2026-09-25, the Ask three-second repair; `lib/ask/speculative-reading.ts`.)
   * For a question the lexical reading cannot settle, the model reading it
   * (~1.5 s measured) and the writer answering (~1.9 s) ran one after the
   * other: ~5.8 s warm. The code's best reading builds the pack at once and
   * the writer starts on it; the model's reading still decides. With no model
   * key there is no model reading to wait for, so nothing is started, and
   * `WTP_ASK_SPECULATION=off` turns it off without a deploy.
   */
  const speculationEnabled = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.WTP_ASK_SPECULATION !== "off";
  const speculate = async (): Promise<Speculation> => {
    const reading = codeBestReading({ question, inventory, activeSubjects, priorSubjects });
    if (!reading) return { started: false, why: "no-code-reading" };
    const guess = { codeIntent: reading.interpretation.intent, codeTemporal: reading.interpretation.temporal };
    try {
      const path = await answerPath(structuredClone(reading.interpretation), emptyTrace());
      if (path.kind !== "PACK" || path.composed || !packHasEvidence(path.pack) ||
        path.pack.subject?.kind === "MEASURE" && requestedMeasureVotes(question).length > 0 ||
        stanceAnswerability(path.pack) === "UNVERIFIED_PERSONAL_STANCE") return { started: false, why: "code-reading-needs-no-writer", ...guess };
      const outcome = readingOutcome(path);
      const cached = synthesisCache.get(synthesisCacheKey(path.pack, ladderKey.model, ladderKey.effort));
      const controller = new AbortController();
      let settled = Boolean(cached);
      const writing = cached ? Promise.resolve(cached) : synthesizeWithLadder(path.pack, {
        allowCall,
        callerKey,
        validate: (text, urls) => validateAnswer(text, urls, path.pack, bodies),
        ladder,
        signal: controller.signal,
      });
      writing.then(() => { settled = true; }, () => { settled = true; });
      return { started: true, ...guess, outcome, writing, controller, settled: () => settled, startedAtMs: Date.now() - started };
    } catch {
      return { started: false, why: "code-reading-failed", ...guess };
    }
  };
  // ── 1. INTERPRETATION ────────────────────────────────────────────────
  let interpretation: AskInterpretation = unavailableInterpretation();
  const interpretationStarted = Date.now();
  const interpretContext = {
    inventory: inventory.map((e) => ({ name: titleCaseName(e.name), divisionType: e.divisionType })),
    today,
    approximateLocation:
      typeof body.approximateLocation === "string" ? body.approximateLocation : null,
    surface,
    priorTurns: Array.isArray(body.priorTurns)
      ? (body.priorTurns as { question: string; resolvedSubject: string | null }[]).slice(-4)
      : [],
    activeSubjects: activeSubjects.map((s) => s.name).slice(0, 6),
  };
  const unheldBody = !topicRoute && !leanAsk && !ballotAsk ? unheldNamedBodyQuestion(question, namedBodies) : null;
  const modelFreeTopicRoute = deterministicTopicRoute || areaTopicRoute || namedBodyTopicRoute || leanAsk || Boolean(ballotAsk) || Boolean(unheldBody);
  /*
   * **THE LEXICAL READING.** (2026-09-25, the Ask latency repair.) A question
   * in one of a few canonical shapes ("when does the Mesa City Council meet
   * next?") whose name binds one body identically in every binder the route
   * consults is read in code: the model rung cost 2.4-3.3 s on a warm instance
   * to return the same body, intent and tense. Anything the module does not
   * settle returns null and is read by the model exactly as before. See
   * `lib/ask/lexical-reading.ts` for the conditions.
   */
  const lexical = modelFreeTopicRoute ? null : lexicalReading({
    question, inventory, namedBodies, confirmation: body.confirmation, activeSubjects, priorSubjects, officeOf,
    readerGoverning: scopedBodies.filter((entry) => entry.ocdId && (entry.bodyId === `${entry.ocdId}#governing` || entry.bodyId === `${entry.ocdId}#board`))
      .flatMap((entry) => inventory.filter((entity) => entity.id === entry.bodyId)),
  });
  if (deferPersonRecords) {
    trace.sourcesLoaded = "WITHOUT_PERSON_RECORDS";
    for (const key of ["federalVotes", "federalKeyVotes", "officeholderStatements", "executiveActions"]) delete trace.preloadSources![key];
  } else if (deferShape) {
    if (lexical && noPersonRecordShapes.has(lexical.shape)) {
      trace.sourcesLoaded = sittingShapes.has(lexical.shape) ? "IDENTITY_AND_MEETINGS" : "WITHOUT_PERSON_RECORDS";
      for (const key of ["azPimaFinance", "federalVotes", "federalKeyVotes", "officeholderStatements", "executiveActions"]) {
        delete trace.preloadSources![key];
      }
    } else {
      // Enter in this async scope, not inside a preload helper: otherwise the
      // AsyncLocalStorage context would not reach the subsequent readers.
      if (edgeManifest?.authorityArtifacts) {
        authorityEdge = await timed("remainingAuthorityEdge", () => ensureReaderAuthorityEdge(edgeManifest).catch(() => null))();
        if (authorityEdge) enterReaderAuthorityEdge(authorityEdge);
      }
      trace.preloadSources = { ...trace.preloadSources,
        azPimaFinance: promotedSource("pima-finance"), federalVotes: promotedSource("federal-votes"),
        federalKeyVotes: promotedSource("federal-key-votes"), officeholderStatements: promotedSource("officeholder-statements"),
        executiveActions: promotedSource("executive-actions"),
      };
      await settleGroundedSourcePreloads(unrelatedPreloads);
      trace.sourcesLoaded = "ALL";
    }
  }
  const interpretationKey = modelFreeTopicRoute || lexical ? null : interpretationCacheKey(question, interpretContext, resolveAskRoleModel("READER"));
  const cachedInterpretation = interpretationKey ? interpretationCache.get(interpretationKey) : null;
  // The model's reading is requested first; the code's reading runs while it is in flight.
  const modelReading = modelFreeTopicRoute || lexical || cachedInterpretation ? null : interpretQuestion(question, interpretContext, { allowCall });
  const speculation = modelReading && speculationEnabled ? await speculate() : null;
  const outcome = modelFreeTopicRoute || lexical ? null : cachedInterpretation ?? await modelReading!;
  if (interpretationKey && !cachedInterpretation && outcome?.kind === "READ") interpretationCache.set(interpretationKey, outcome);

  if (outcome === null && unheldBody) {
    interpretation = interpretWithoutModel(question);
    trace.interpretation = { ran: false, why: "unheld-body-shape", ms: Date.now() - interpretationStarted, intent: interpretation.intent, temporal: interpretation.temporal, fellBackToDeterministic: true };
  } else if (outcome === null && (leanAsk || ballotAsk)) {
    /* The reader's own officials, the meetings held for their area, or their ballot: read from the words, answered from what is held. */
    interpretation = { ...unavailableInterpretation(), intent: officialsAsk ? "PERSON_RECORD" : areaMeetingsAsk ? "MEETING_TIME" : "UNKNOWN", temporal: areaMeetingsAsk ? { kind: "NEXT" } : { kind: "NONE" } };
    trace.interpretation = { ran: false, why: officialsAsk ? "reader-officials-shape" : areaMeetingsAsk ? "area-meetings-shape" : "ballot-shape", ms: Date.now() - interpretationStarted, intent: interpretation.intent, temporal: interpretation.temporal, fellBackToDeterministic: true };
  } else if (outcome === null && lexical) {
    interpretation = structuredClone(lexical.interpretation);
    trace.interpretation = {
      ran: false,
      why: "lexical-reading",
      ms: Date.now() - interpretationStarted,
      intent: interpretation.intent,
      temporal: interpretation.temporal,
      fellBackToDeterministic: true,
    };
  } else if (outcome === null) {
    /* The deterministic topic route above: the topic is curated code and the
       body bound on the reader's own words, so no model reading is needed and
       no tense is imposed — a topic spans what was decided and what is next. */
    interpretation = { ...interpretWithoutModel(question), intent: "AGENDA_TOPIC", temporal: { kind: "NONE" } };
    trace.interpretation = {
      ran: false,
      why: areaTopicRoute ? "deterministic-area-topic-route" : namedBodyTopicRoute ? "named-body-topic-route" : "deterministic-topic-route",
      ms: Date.now() - interpretationStarted,
      intent: interpretation.intent,
      temporal: interpretation.temporal,
      fellBackToDeterministic: true,
    };
  } else if (outcome.kind === "READ") {
    interpretation = structuredClone(outcome.interpretation);
    trace.interpretation = {
      ran: true,
      model: outcome.model,
      ...(outcome.servedModel !== undefined ? { servedModel: outcome.servedModel } : {}),
      ms: cachedInterpretation ? 0 : outcome.ms,
      ...(cachedInterpretation ? { cached: true } : {}),
      intent: interpretation.intent,
      temporal: interpretation.temporal,
      mentionCount: interpretation.entityMentions.length,
      /* Whether the rung produced a referent at all — a COUNT-shaped fact
         about our machinery, never the referent itself, which is a subject the
         reader may not have typed. */
      referentProposed: Boolean(interpretation.referent),
      fellBackToDeterministic: false,
    };
  } else {
    /*
     * **THE FALLBACK IS NARROWER, NOT LOOSER.** It reads tense and nothing
     * else, so an unavailable model costs the reader precision and can never
     * cost them correctness.
     */
    interpretation = interpretWithoutModel(question);
    trace.interpretation = {
      ran: false,
      why: outcome.why,
      ms: outcome.ms,
      temporal: interpretation.temporal,
      fellBackToDeterministic: true,
    };
  }

  lap("interpretation");

  /**
   * **RESOLUTION, RETRIEVAL AND COMPOSITION FOR ONE READING OF THE QUESTION.**
   * (2026-09-25, the Ask three-second repair.)
   *
   * Everything from a reading to a sealed evidence pack — and the answer code
   * composes from it, when it can — as one function of that reading, so the
   * route can run it twice: once on the code's own best reading while the
   * model is still reading the question (`lib/ask/speculative-reading.ts`),
   * and once on the reading it actually uses, exactly as before. It writes
   * only to the trace it is handed, and an answer that ends here (a
   * clarification, an unresolved name) comes back as a response to SEND, so
   * the speculative run never sends, captures or counts anything.
   */
  async function answerPath(interpretation: AskInterpretation, trace: AskTrace) {
    // A literal reader date outranks inferred tense, including a model's reading.
    if (requestedMeetingDate) {
      interpretation.temporal = { kind: "DATE", localDate: requestedMeetingDate.date };
      trace.interpretation.temporal = interpretation.temporal;
    }

    // ── 2. CANONICAL RESOLUTION ──────────────────────────────────────────
    /* "Who is the mayor of Sierra Vista?" names the city its answer is filtered to; the city is not a subject to bind or to ask which of. */
    const initialResolution: ReturnType<typeof resolveInterpretation> = officialsAsk?.place
      ? { binding: { kind: "NONE" }, basis: "NONE", boundOn: null }
      : resolveInterpretation(interpretation, question, inventory, {
        activeSubjects,
        priorSubjects,
      });
    let bodyDecision: ReturnType<typeof decideNamedBody> = officialsAsk?.place ? { kind: "NONE" } : decideNamedBody(question, namedBodies, body.confirmation,
      initialResolution.binding.kind === "BOUND" && initialResolution.binding.entity.level === "BODY"
        ? interpretation.entityMentions : []);
    if (!explicitBodyClass && initialResolution.binding.kind === "BOUND" && initialResolution.binding.entity.level !== "BODY") bodyDecision = { kind: "NONE" };
    // Model expansions cannot silently convert a named body hypothesis into an
    // answer. No lexical candidate means a neutral clarification, not a default.
    if (bodyDecision.kind === "NONE" && initialResolution.binding.kind === "BOUND" &&
      initialResolution.binding.entity.level === "BODY" && initialResolution.basis.startsWith("MODEL_EXPANSION")) bodyDecision = { kind: "CLARIFY" };
    const resolved = applyNamedBodyDecision(bodyDecision, initialResolution, question);
    /* A kind of body was named ("the school board") and the reader's ZIP reaches several: ask which, naming them. */
    const resolution: ReturnType<typeof resolveInterpretation> = lexical?.areaChoices
      ? { binding: { kind: "AMBIGUOUS", mention: lexical.areaChoices.mention, candidates: [...lexical.areaChoices.bodies] }, basis: "WHOLE_QUESTION", boundOn: question }
      : resolved;
    trace.resolution = {
      state: resolution.binding.kind,
      basis: resolution.basis,
      subjectId: resolution.binding.kind === "BOUND" ? resolution.binding.entity.id : null,
      subjectName:
        resolution.binding.kind === "BOUND" ? titleCaseName(resolution.binding.entity.name) : null,
    };

    const capture = async (
      mode: AnswerMode,
      subjectIds: string[],
      answer: string | null,
      answerModel: string | null,
      validationPassed: boolean | null,
      records: EvidenceRecord[],
      gaps: EvidenceGap[],
    ) => captureDelivered({
      request,
      question,
      interpretation,
      resolutionState: resolution.binding.kind,
      mode,
      subjectIds,
      answer,
      answerModel,
      validationPassed,
      records,
      gaps,
      surface,
      approximateLocation:
        typeof body.approximateLocation === "string" ? body.approximateLocation : null,
      ocdIds,
      residency,
      continuityKey: typeof body.continuityKey === "string" ? body.continuityKey : "",
    });

    /* An answer that ends here is RETURNED to the caller as a response to send,
       not sent: the speculative reading above never sends or captures one. */
    if (unheldBody) {
      return { kind: "RESPONSE" as const, respond: async () => {
        trace.answerMode = "NO_EVIDENCE";
        trace.totalMs = Date.now() - started;
        const information = unheldBody.shape === "BODY_ROSTER" ? "list of members"
          : unheldBody.shape === "BODY_CIVICS" ? "description of what it does"
          : unheldBody.shape === "CONTACT" ? "contact details"
          : unheldBody.shape === "MEETING_OUTCOME" ? "meeting decisions"
          : unheldBody.shape === "BODY_AGENDA" ? "agendas"
          : unheldBody.shape === "PUBLIC_COMMENT" ? "public-comment rules" : "calendar";
        const answer = unheldBodyAnswer(titleCaseName(unheldBody.name), information, trace);
        await capture("NO_EVIDENCE", [], answer.answer, null, null, [], answer.gaps);
        return Response.json(answer);
      } };
    }
    if (bodyDecision.kind === "CONFIRM" || bodyDecision.kind === "CLARIFY") {
      const decision = bodyDecision;
      return { kind: "RESPONSE" as const, respond: async () => {
        trace.answerMode = "CLARIFY";
        trace.totalMs = Date.now() - started;
        const answer = clarifyAnswer(question, [], trace);
        // A suggestion is not the subject of an answer or of an attributed record.
        delete answer.candidates;
        if (decision.kind === "CONFIRM") answer.confirmation = {
          bodyId: decision.candidate.id, name: titleCaseName(decision.candidate.name), question,
        };
        else answer.clarification = "Which government do you mean? A city or state can help me identify it.";
        await capture("CLARIFY", [], null, null, null, [], []);
        return Response.json(answer);
      } };
    }

    /*
     * Two verdicts end the request before any retrieval, and both are answers
     * rather than errors. Neither may fall through to the reader's own
     * divisions: that fall-through is exactly how a question about Vail was
     * answered with Sunnyside.
     *
     * **Both are still CAPTURED.** A clarification and an unresolved name are
     * the most commercially meaningful rows this store will ever hold — they are
     * unmet demand, stated by a constituent in their own words — and a capture
     * path that recorded only the successes would describe a product that always
     * works.
     */
    if (resolution.binding.kind === "AMBIGUOUS") {
      const binding = resolution.binding;
      return { kind: "RESPONSE" as const, respond: async () => {
        trace.answerMode = "CLARIFY";
        trace.totalMs = Date.now() - started;
        await capture(
          "CLARIFY",
          binding.candidates.map((c) => c.id),
          null,
          null,
          null,
          [],
          holdingLoadGaps,
        );
        const answer = clarifyAnswer(
            binding.mention,
            binding.candidates.map((c) => titleCaseName(c.name)),
            trace,
          );
        answer.gaps.push(...holdingLoadGaps);
        answer.denominators.ballotLoaderFailures = ballot.loaderFailures.length;
        answer.denominators.officeholderLoaderFailures = officeholders.loaderFailures;
        return Response.json(answer);
      } };
    }
    if (resolution.binding.kind === "UNRESOLVED") {
      const binding = resolution.binding;
      return { kind: "RESPONSE" as const, respond: async () => {
        trace.answerMode = "UNRESOLVED";
        trace.totalMs = Date.now() - started;
        await capture("UNRESOLVED", [], null, null, null, [], holdingLoadGaps);
        const answer = unresolvedAnswer(binding.mention, trace);
        if (resolution.unresolvedCanonicalId) {
          answer.denominators.identityUnresolved = 1;
          answer.gaps.push({ whose: "OURS", statement: `We couldn't match ${binding.mention} to a person in our records. We haven't shown another person's information.` });
        }
        answer.gaps.push(...holdingLoadGaps);
        answer.denominators.ballotLoaderFailures = ballot.loaderFailures.length;
        answer.denominators.officeholderLoaderFailures = officeholders.loaderFailures;
        return Response.json(answer);
      } };
    }

    // ── 3. DETERMINISTIC RETRIEVAL ───────────────────────────────────────
    /*
     * A topic question bound to one body is answered from that body's topic
     * timeline (every dated mention joined to its recorded outcome), never from
     * the one sitting a tense word would pick. See `lib/ask/topic-timeline.ts`.
     */
    const topicFocus = topicRoute && !requestedMeetingDate && resolution.binding.kind === "BOUND" && resolution.binding.entity.level === "BODY"
      ? topicRoute : null;
    if (topicFocus) {
      interpretation.intent = "AGENDA_TOPIC";
      interpretation.temporal = { kind: "NONE" };
    }
    const agendaQuestion = !topicFocus && resolution.binding.kind === "BOUND" && resolution.binding.entity.level === "BODY" && asksForBodyAgenda(question) && !outcomeQuestionClass(question);
    if (agendaQuestion) interpretation.intent = "UPCOMING_AGENDA";
    const selection: AgendaSelection =
      requestedMeetingDate ? "DATE" : interpretation.temporal.kind === "LAST"
        ? "LAST"
        : interpretation.temporal.kind === "NEXT"
          ? "NEXT"
          : interpretation.intent === "PAST_MEETING"
            ? "LAST"
            : interpretation.intent === "UPCOMING_AGENDA" || interpretation.intent === "MEETING_TIME"
              ? "NEXT"
              : "ANY";

    const bound = resolution.binding.kind === "BOUND" ? resolution.binding.entity : null;
    const ballotRecord: BallotSubjectRecord | null = bound
      ? ballotInventory.subjects.get(bound.id) ?? null
      : null;

    const subject: EvidenceSubject | null = bound
      ? ballotRecord
        ? ballotSubject(ballotRecord)
        : {
            kind: bound.divisionType === "person" ? "PERSON" : "BODY",
            id: bound.id,
            name: titleCaseName(bound.name),
          }
      : null;

    const records: EvidenceRecord[] = [];
    /* A person asked about for their campaign money and nothing they did in office: their votes, key votes, statements and
       recorded actions are not what was asked (the pack for one federal candidate was 104 records, 28,000 tokens). */
    const financeAsked = financeQuestionAskedFor(question, subject?.kind ?? null);
    const moneyOnly = subject?.kind === "PERSON" && asksOnlyMoney(question, "PERSON");
    const heldFiling = subject ? heldFilings.find(row => row.entity.id === subject.id) : null;
    if (heldFiling) records.push(heldFiling.record);
    /** The sittings this request resolved, for the structured half of the payload. */
    const resolvedSittings: AskSitting[] = [];
    /** A topic question's dated timeline for the bound body, when one was built. */
    let topicTimeline: ReturnType<typeof buildTopicTimeline> | null = null;
    const gaps: EvidenceGap[] = [...holdingLoadGaps];
    /* The gaps attached to the chosen sitting(s), by why they were attached, for
       an answer composed from the sitting (`lib/ask/sitting-answer.ts`). Each is
       also in `gaps`; this only remembers which ones are about the sitting. */
    const sittingGaps: SittingGap[] = [];
    const attachSittingGaps = (role: SittingGapRole, attached: readonly EvidenceGap[], meetingId?: string) => {
      for (const gap of attached) {
        gaps.push(gap);
        sittingGaps.push({ role, gap, ...(meetingId ? { meetingId } : {}) });
      }
    };
    /* The recorded actions held for the chosen sitting(s), read beside the
       records, for a "what did they decide" answer composed from them. */
    const heldActions: HeldMeetingAction[] = [];
    const denominators: Record<string, number> = {
      ballotLoaderFailures: ballot.loaderFailures.length,
      meetingCanonicalProjectionReads: meetingDataState === "PROMOTED" ? 1 : 0,
      meetingBootstrapProjectionReads: meetingDataState === "BOOTSTRAP" ? 1 : 0,
      meetingStoreUnavailableReads: meetingDataState === "STORE_UNREACHABLE" ? 1 : 0,
    };
    const contacts: AskContact[] = [];
    const canonicalSubjectKeys = new Set<string>(subject ? [subject.id] : []);
    /* A party-conflict card's filing (Hourihan): retrieved beside the card, its money kept under its own id. */
    let partyConflictFiling: BallotSubjectRecord | null = null;
    if (subject?.kind === "PERSON") for (const [id, canonicalId] of officialAliases) {
      if (canonicalId === subject.id) canonicalSubjectKeys.add(id);
    }
    if (subject?.kind === "PERSON") {
      const profile = candidateProfileEvidenceFor(subject);
      records.push(...profile.records);
      gaps.push(...profile.gaps);
      Object.assign(denominators, profile.denominators);
    }
    const candidateSeats = ballotRecord?.kind === "PERSON"
      ? (await Promise.allSettled((ballotOfficialIds.get(ballotRecord.id) ?? []).map(seatHolderById)))
        .flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : [])
      : [];
    for (const seat of candidateSeats) canonicalSubjectKeys.add(seat.id);
    if (ballotRecord?.kind === "PERSON") {
      const candidacyId = reconciledCandidacyIdForCard(ballotRecord.id) ?? ballotRecord.candidacyId;
      if (candidacyId) canonicalSubjectKeys.add(candidacyId);
      try {
        const contact = contactForCandidate(candidacyId ?? ballotRecord.id, ballotRecord.name, ballotRecord.contestTitle);
        if (contact) contacts.push(contact);
      } catch {
        gaps.push({ whose: "OURS", statement: `The filed contact for ${ballotRecord.name} could not be read for this answer.` });
        denominators.candidateContactLoaderFailures = 1;
      }
    }
    denominators.meetingLoaderFailures = snapshot ? 0 : 1;
    denominators.officeholderLoaderFailures = officeholders.loaderFailures;

    if (ballotRecord && ballot.set) {
      /* ── A BALLOT SUBJECT ── contest, candidate or measure, selected by its
         canonical id and nothing else. */
      const retrieved = ballotRecordsFor(ballotRecord, {
        set: ballot.set,
        contests: ballot.contests,
        absences: ballot.absences,
        positions: ballot.positions,
        measureSummary: ballot.measureSummary,
        measureAnalysis: ballot.measureAnalysis,
        measureProvisions: ballot.measureProvisions,
        nominees: ballot.nominees,
      });
      records.push(...retrieved.records);
      Object.assign(denominators, retrieved.denominators);
      /* The party-conflict pair: the filing's own records beside the card's, and both parties with their sources, as ours to reconcile. */
      const conflict = ballotRecord.kind === "PERSON" ? partyConflictFilings.get(ballotRecord.id) ?? null : null;
      const conflictFiling = conflict ? ballotInventory.subjects.get(conflict.filingCandidacyId) ?? null : null;
      if (conflict && conflictFiling) {
        partyConflictFiling = conflictFiling;
        records.push(...ballotRecordsFor(conflictFiling, { set: ballot.set, contests: ballot.contests, absences: [], nominees: ballot.nominees }).records
          .filter((record) => record.kind === "CANDIDACY"));
        gaps.push({
          whose: "OURS",
          statement: `Our held Arizona certified-canvass party label for ${conflict.name} is ${conflict.canvassParty ?? "unrecorded"}; our held Secretary of State candidate-filing party label is ${conflict.filingParty ?? "unrecorded"}.` +
            (conflict.readerGapSentence ? ` ${conflict.readerGapSentence}` : ""),
        });
        denominators.partyConflictRecordsHeld = 2;
      }
      if (ballotRecord.kind === "MEASURE" && ballot.analysisLoaderFailed) {
        denominators.measureAnalysisLoaderFailures = 1;
        gaps.push({ whose: "OURS", statement: "We couldn't load the official explanation of this ballot measure. Please try again in a moment." });
      }

      if (retrieved.records.length === 0) {
        gaps.push({
          whose: "OURS",
          statement: `We hold ${ballotRecord.name} on this ballot but nothing recorded that answers that.`,
        });
      }

      /*
       * **A CANDIDATE WHO ALREADY HOLDS AN OFFICE IS BOTH, and the answer says
       * both.** This is the other half of the merge above: the ballot subject
       * won the id, so the officeholder record has to travel with it or a
       * question about a sitting governor would come back with a filing and no
       * office.
       *
       * The identity is person AND office, never either alone — PR #211's rule —
       * and the action gap is NAMED here for the same reason it is named on the
       * officeholder path: the corpus holds who they ARE and nothing about what
       * they have DONE, and silence there would read as "she has done nothing".
       */
      if (ballotRecord.kind === "PERSON") {
        for (const seat of candidateSeats) {
          records.push(officeholderEvidence(seat, `office:${seat.id}`));
          denominators.officeholderRecords = (denominators.officeholderRecords ?? 0) + 1;
          /* The office the question is ABOUT — the most relevant contact there
             is, and the one an answer about the Governor was missing while it
             listed the reader's state senator. */
          contacts.push(contactForOfficeholder(seat));
          if (!moneyOnly) officeholderActionEvidence(
            seat.id,
            seat.name,
            today,
            interpretation.temporal.trailingMonths,
            records,
            gaps,
            denominators,
          );
        }
      }
      /*
       * **THE CONTACTS FOR A BALLOT SUBJECT ARE THAT SUBJECT'S OWN DIVISION.**
       *
       * Proposition 423 is a Vail Unified budget override, so the people with a
       * factual relationship to it are Vail's governing board — not the reader's
       * state senator, who was being listed under every answer regardless of what
       * was asked. A contact whose relationship to the subject is "none" dilutes
       * the ones whose relationship is real.
       */
      /*
       * **THE BODY NAME IS THE DIVISION, NEVER THE CONTEST TITLE.** (Found by
       * reading the panel, 2026-08-28.)
       *
       * Passing the contest title produced "Allison Pratt — Governing Board
       * President on Proposition 423: Vail Unified School District budget
       * override continuation". She is president of a school district's governing
       * board, not of a ballot question. The relationship sentence is the whole
       * value of a contact record, and a relationship that names the wrong thing
       * is a wrong fact about a named person.
       *
       * Unslugged from the canonical division id, which is the same mechanical
       * read `lib/ask/inventory.ts` does for the meetings inventory.
       */
      /* A ballot subject is a contest, a candidate or a measure — it has an AREA
         and no body, so this is the DIVISION question and it asks the division
         resolver by name rather than borrowing the body one. */
      contacts.push(...contactsForDivision(ballotRecord.ocdId, divisionNameOf(ballotRecord.ocdId)));

      /*
       * A candidate with no published positions is a NAMED GAP, never silence.
       * Silence there reads as "they have said nothing", which is a claim about
       * a person made out of our own collection state.
       */

      /*
       * ── ASK-06 ── **HOW THEY HAVE ACTUALLY VOTED.** (2026-08-28.)
       *
       * A candidate's positions are what they SAID. A roll call is what they
       * DID, and this product held 12,234 recorded positions that the grounded
       * engine could not reach.
       *
       * Candidacy → officeholder uses the committed person relationship above;
       * officeholder → votes uses the publisher's stable key. An unresolved
       * relationship produces an identity gap without a runtime name search.
       *
       * The office on every record is the one they HOLD, never the one they are
       * running for.
       */
      if (ballotRecord.kind === "PERSON" && !moneyOnly) {
        if (candidateSeats.some((seat) => voteEvidenceReadsStateRollCalls(ballotRecord.name, { officeholderId: seat.id }))) await personStateVotes();
        const candidates = await Promise.all(candidateSeats.map((seat) =>
          voteEvidenceForIncludingHistory(ballotRecord.name, { officeholderId: seat.id })));
        const joined = candidates.filter((votes) => votes.identity.kind === "JOINED");
        for (const votes of joined) {
          records.push(...votes.records);
          gaps.push(...votes.gaps);
          for (const [key, count] of Object.entries(votes.denominators)) denominators[key] = (denominators[key] ?? 0) + count;
        }
        if (!joined.length) gaps.push({ whose: "OURS", statement: `We haven't confirmed which voting record belongs to ${ballotRecord.name}, so we haven't shown anyone else's votes.` });
      }
    } else if (subject?.kind === "BODY") {
      const identity = canonicalBodyIdentity(subject.id);
      const financeDivision = bound?.ocdId ?? identity?.ocdId;
      if (financeDivision && governmentFinanceQuestion(question)) {
        const finance = await governmentFinanceEvidence(subject.id, financeDivision).catch(() => []);
        records.push(...finance);
        denominators.governmentFinanceRecordsReturned = finance.length;
        if (!finance.length) gaps.push({ whose: "OURS", statement: "We're working on getting this info about this government's finances." });
      }
      const access = commentAccessEvidenceFor(subject.id, bound?.ocdId ?? null, subject.name);
      records.push(...access.records);
      gaps.push(...access.gaps);
      /* "How can I comment at the Vail school board meeting?": with no standing rule held, the answer says we have not recorded how
         (the model used to say the district has not published it — a claim about them made from a gap of ours). */
      const publicCommentAsk = shapeForBoundBody(question, inventory, subject.id) === "PUBLIC_COMMENT";
      if (publicCommentAsk) {
        for (const gap of access.gaps) sittingGaps.push({ role: "COMMENT", gap });
      }
      denominators.publicCommentAccessRecordsReturned = access.records.length;
      if (identity?.nameIsBodysOwn && identity.sourceUrl) {
        records.push({ kind: "BODY", id: subject.id, bodyId: subject.id,
          text: `${identity.name}${identity.divisionLabel && !identity.name.includes(identity.divisionLabel) ? ` — ${identity.divisionLabel}` : ""}.`,
          sourceUrl: identity.sourceUrl, retrievedAt: identity.retrievedAt });
      }
      const forBody = meetingsForBody(meetings, bound);
      const bodyListingIdentity = meetingListingKnowledgeFor(snapshot?.meetings ?? [], forBody.map(meeting => meeting.id)).readback;
      denominators.calendarListingsHeldForThisBody = forBody.length;
      if (!bodyListingIdentity.groups.length) denominators.meetingsHeldForThisBody = forBody.length;
      /* The SAME selection the deterministic agenda route uses — one rule, two
         callers, so the two surfaces can never disagree about which meeting a
         tensed question meant. */
      const chosen = topicFocus ? null : selectSitting(selection, forBody, selectionNow, requestedMeetingDate?.date);
      const calendarIds = new Set(forBody.map((meeting) => meeting.id));
      const archivedOutcomes = requestedMeetingDate?.date && meetingRecordQuestionClass(question)
        ? outcomeSittingsOnDate(subject.id, requestedMeetingDate.date).filter((sitting) => !calendarIds.has(sitting.meetingId)) : [];
      for (const sitting of archivedOutcomes) {
        records.push({ kind: "MEETING", id: sitting.meetingId, bodyId: sitting.bodyId, text: `Held meeting records for ${subject.name}'s ${formatDateLong(requestedMeetingDate!.date!) ?? requestedMeetingDate!.date} sitting.`, occurredAt: sitting.startsAt, sourceUrl: sitting.sourceUrl, sourceOrg: sitting.sourceOrg, retrievedAt: sitting.publication.observedAt });
        const outcome = meetingOutcomeEvidenceFor({ bodyId: subject.id, meetingId: sitting.meetingId, startsAt: sitting.startsAt!, question });
        records.push(...outcome.records);
        gaps.push(...outcome.gaps);
        for (const [key, count] of Object.entries(outcome.denominators)) denominators[key] = (denominators[key] ?? 0) + count;
      }
      denominators.archivedOutcomeSittingsForThatDate = archivedOutcomes.length;

      if (topicFocus) {
        /* Every dated mention of the topic in this body's held agendas and
           structured agenda records, each joined to the body's recorded outcome,
           plus the recent sittings whose agenda we have not read. */
        const bodyMeetingIds = new Set(forBody.map((meeting) => meeting.id));
        topicTimeline = buildTopicTimeline({
          topic: topicFocus,
          bodyId: subject.id,
          bodyName: subject.name,
          meetings: forBody,
          documents: documents.filter((document) => bodyMeetingIds.has(document.meetingId)),
          sittings: sittingsForBody(subject.id),
          now: selectionNow,
          outcomesUnavailable: outcomeStoreLoadedFrom() === "EMPTY_STORE",
        });
        records.push(...topicTimeline.records);
        gaps.push(...topicTimeline.gaps);
        Object.assign(denominators, topicTimeline.denominators);
      } else if (!chosen && archivedOutcomes.length === 0) {
        /* A body we hold no meeting of carries its code (held-gaps.ts), so the gap a reader is told is work the runner creates (2026-09-25). */
        const notHeld = snapshot && !requestedMeetingDate ? meetingsNotHeldGap(subject.id, forBody.length) : null;
        attachSittingGaps("NO_SITTING", [{
          ...(notHeld ? { code: notHeld.code, bodyId: notHeld.bodyId, recordClass: notHeld.recordClass } : {}),
          whose: "OURS",
          statement:
            !snapshot
              ? `We couldn't load ${subject.name}'s calendar. Please try again in a moment.`
              : requestedMeetingDate
                ? requestedMeetingDate.date
                  ? `We don't have a meeting for ${subject.name} on ${formatDateLong(requestedMeetingDate.date) ?? requestedMeetingDate.date} in our records.`
                  : `Please give one date for the meeting you want to ask about.`
              : forBody.length === 0
              ? `We don't have ${titleCaseName(bodyNameFromQuestion(question, namedBodies, subject.id) ?? subject.name)}'s calendar yet.`
              : selection === "LAST"
                ? `We hold meetings for ${subject.name} but none that have already happened.`
                : `We hold meetings for ${subject.name} but none scheduled in the future.`,
        }]);
      } else if (chosen) {
        /*
         * **THE SITTING IS PRINTED IN THE BODY'S OWN ZONE, SPELLED OUT.**
         *
         * This line used to read `starting 2026-09-09T02:00:00.000Z in time zone
         * America/Phoenix` — an identifier on a reader surface, and a WRONG DAY.
         * 02:00Z is 7:00 p.m. the previous evening in Arizona, which is when
         * Vail's board actually sits; every Vail row in the corpus carries a UTC
         * date one day after the meeting. `lib/ask/meeting-time.ts` resolves it
         * the way `lib/map/format.ts` has since BC-12.
         *
         * `title` and `bodyName` are frequently the same string in this corpus
         * (Vail's are both "Governing Board Meeting"), so the second is included
         * only when it says something the first did not.
         */
        const label =
          chosen.bodyName && chosen.bodyName !== chosen.title
            ? `${chosen.title} of ${chosen.bodyName}`
            : chosen.title;
        const sameDay = sittingsOnSameLocalDay(chosen, forBody).filter((m) => m.id !== chosen.id);
        const listingKnowledge = meetingListingKnowledgeFor(snapshot?.meetings ?? [], [chosen.id, ...sameDay.map(meeting => meeting.id)]);
        const listingGroupFor = (id: string) => listingKnowledge.readback.groups.find(group => group.sourceIds.includes(id));
        attachSittingGaps("LISTING", listingKnowledge.gaps);
        records.push({
          kind: "MEETING",
          id: chosen.id,
          /* The meeting's OWN body, carried from the corpus rather than assumed
             from the subject — so the validator is checking the record against
             the subject rather than checking the subject against itself. */
          bodyId: chosen.bodyId,
          text: `${listingGroupFor(chosen.id) ? "Calendar listing: " : ""}${subject.name}: ${label}, ${readableSitting(chosen)}.${sittingVenue(chosen) ? ` Listed location: ${sittingVenue(chosen)}.` : ""}`,
          meetingListingIdentity: listingGroupFor(chosen.id),
          occurredAt: chosen.startsAt,
          sourceUrl: chosen.provenance?.sourceUrl ?? chosen.agendaUrl ?? null,
          sourceOrg: chosen.provenance?.sourceOrg ?? null,
          retrievedAt: chosen.provenance?.collectedAt ?? null,
        });

        /*
         * ── ASK-24 ── **A DAY WITH TWO SITTINGS IS A DAY WITH TWO SITTINGS.**
         * (Session B resume, 2026-08-31.)
         *
         * The owner: Mayor & Council's study session is at 1 p.m. and "the actual
         * meeting is later in the day at 5 p.m."; Ask named the first and stopped.
         * That is `selectSitting` behaving correctly — it returns ONE sitting —
         * and the answer being built as though one were all there was.
         *
         * A reader told "the meeting is at 1 p.m." who arrives for a study
         * session that ends before the business meeting begins has been handed a
         * true sentence and a wrong answer. The map card at 17-34-14 already
         * renders both; this is Ask catching up to the surface beside it.
         *
         * Each sibling is its OWN record with its OWN id, agenda link and time —
         * never a sentence appended to the chosen one's text. They are different
         * sittings with different dockets, and one record describing two would be
         * the collapse that makes an agenda answer cite the wrong meeting.
         */
        /* ASK-20 / ASK-23: the STRUCTURED sittings travel to the client beside
           the prose, so an answer can offer the same Add-to-calendar control the
           map card does and a jurisdiction card can lead with the right one. */
        resolvedSittings.push(chosen);
        denominators.calendarListingsThatLocalDay = sameDay.length + 1;
        denominators.uniqueMeetingCountUnresolvedGroups = listingKnowledge.readback.groups.length;
        if (!listingKnowledge.readback.groups.length) denominators.sittingsThatLocalDay = sameDay.length + 1;
        for (const sibling of sameDay) {
          const siblingLabel =
            sibling.bodyName && sibling.bodyName !== sibling.title
              ? `${sibling.title} of ${sibling.bodyName}`
              : sibling.title;
          resolvedSittings.push(sibling);
          records.push({
            kind: "MEETING",
            id: sibling.id,
            bodyId: sibling.bodyId,
            text:
              listingGroupFor(sibling.id)
                ? `Calendar listing: ${subject.name}: ${siblingLabel}, ${readableSitting(sibling)}.`
                : `${subject.name}: ${siblingLabel}, ${readableSitting(sibling)} — the same day as the ${label}.`,
            meetingListingIdentity: listingGroupFor(sibling.id),
            occurredAt: sibling.startsAt,
            sourceUrl: sibling.provenance?.sourceUrl ?? sibling.agendaUrl ?? null,
            sourceOrg: sibling.provenance?.sourceOrg ?? null,
            retrievedAt: sibling.provenance?.collectedAt ?? null,
          });
        }

        // Each same-day sitting keeps its own document/outcome identity.
        for (const sitting of [chosen, ...sameDay]) {
        const chosen = sitting;
        const forMeeting = documents.filter((d) => d.meetingId === chosen.id);
        /*
         * One reading of the sitting's held agenda for the whole answer
         * (2026-09-22): the records, the document count the model is given, and
         * the document every portal and item record below cites. Counting stored
         * rows told the model Tucson Unified sitting 499 held 89 agenda documents
         * — 88 re-reads of one unchanged page plus the board's site root.
         */
        const holdings = sittingAgendaHoldings(chosen, snapshot?.agendaDocuments ?? [], meetings);
        records.push(...holdings.records);
        denominators.agendaDocumentsForThatMeeting = (denominators.agendaDocumentsForThatMeeting ?? 0) + holdings.documents.length;

        /*
         * ── ASK-07 ── **WHOSE GAP AN ABSENT AGENDA IS.** (2026-08-29.)
         *
         * This branch used to open with:
         *
         * ```ts
         * if (forMeeting.length === 0) {
         *   gaps.push({ whose: "THEIRS",
         *     statement: `No agenda has been published for that ${subject.name} meeting yet.` });
         * }
         * ```
         *
         * `forMeeting.length === 0` measures ONE thing and it is a thing about
         * US: this product holds zero agenda documents keyed to that meeting id.
         * The sentence it produced was a claim about a GOVERNMENT — that a clerk
         * had not posted a packet — and nothing in the input measured that. The
         * committed corpus carries 34 bodies with a future sitting and no
         * document at all; for every one of them the true reading is *we have not
         * gone and got it*, which is the reading that sentence denied.
         *
         * The whole vocabulary now lives in `lib/ask/agenda-publication.ts`,
         * which keeps the publisher's axis and ours mechanically apart and can
         * only produce `whose: "THEIRS"` from a first-party observation of THAT
         * EXACT sitting that is still inside its freshness window. No such
         * observation exists in this product yet, so today every one of these is
         * OURS with the acquisition obligation left open — which is the honest
         * state and was always the honest state.
         *
         * The four document states ASK-05 split apart are preserved word for
         * word; what changed is that the fifth one stopped being about them.
         */
        /*
         * **THE PUBLISHER'S OWN STATE, from the two places it can come from.**
         *
         * `publisherAgendaObservationsFor` is the in-memory seam an adapter
         * writes at the moment of a read. `publicationObservationsFor` is the
         * PERSISTED store: the Legistar lane stopped discarding the InSite grid's
         * literal "Not Available" cell and now records it beside the Web API's
         * `EventAgendaStatus` fields, one observation per surface.
         *
         * **Only `actionable` crosses this boundary.** It is null by construction
         * on `DISAGREE`, so two publisher surfaces contradicting each other
         * produce NO reading here rather than a winner picked in this file — and
         * the reader falls back to the OURS gap, which is the honest answer when
         * we cannot say what the publisher's state is. Reconciliation is the
         * store's job (RULING 207); choosing between representations is nobody's.
         *
         * A caveat that belongs on the record rather than in a commit message:
         * both surfaces reconciled here are Legistar. Agreement between them is
         * two views of one vendor's database, not two independent custodians, so
         * `AGREE_NOT_AVAILABLE` is weaker corroboration than its name suggests.
         * The freshness window is what actually bounds the claim.
         */
        const reconciledPublication = publicationObservationsFor(chosen.id);
        /*
         * **ASK-18 (2026-08-30) — THE THIRD SOURCE, AND IT WAS ALREADY HELD.**
         *
         * The THEIRS branch has existed since ASK-05 and was unreachable outside
         * the Legistar lane, so every other body's answer fell to the OURS gap:
         * *we have not yet acquired the agenda... we are still looking for it*,
         * about meetings whose bodies had simply not posted one. The owner
         * checked at 8:30 that no agenda existed for either Pima sitting and
         * reported the product blaming itself for someone else's timing.
         *
         * `observationFromMeetingRecord` reads what the MEETING RECORD already
         * proves: we fetched this body's own calendar, from a named page, at a
         * named time, and the listing carried no agenda link. First-party,
         * scoped to one sitting, checkable by opening the URL.
         *
         * It refuses every case where that would not be true — an aggregator's
         * copy, a page we cannot name, a carried-forward row whose timestamp is
         * not when this listing was read. The freshness window still bounds it,
         * so a stale negative expires rather than standing.
         */
        const derivedObservation = observationFromMeetingRecord(chosen);
        const publisherObservations = [
          ...publisherAgendaObservationsFor(chosen.id),
          ...(reconciledPublication.actionable ? [reconciledPublication.actionable] : []),
          ...(derivedObservation ? [derivedObservation] : []),
        ];
        const publication = classifyAgendaPublication({
          bodyName: subject.name,
          meetingId: chosen.id,
          documentsForMeeting: forMeeting,
          documentsAcrossCorpus: documents,
          meetingsAcrossCorpus: meetings,
          discoveredDocumentUrl: chosen.agendaUrl ?? null,
          observations: publisherObservations,
          now: selectionNow,
        });
        denominators.publisherPublicationObservationsForThatMeeting =
          (denominators.publisherPublicationObservationsForThatMeeting ?? 0) + publisherObservations.length;
        const outcome = meetingOutcomeEvidenceFor({ bodyId: subject.id, meetingId: chosen.id, startsAt: chosen.startsAt, question });
        const translated = await translatedMeetingEvidenceFor(subject.id, chosen.id, question, snapshot);
        const minutes = translated.records.some(row => row.kind === "MEETING_MINUTES_SUMMARY") ? translated
          : minutesSummaryEvidenceFor(subject.id, chosen.id, question, () => snapshot);
        const notice = translated.records.some(row => row.kind === "MEETING_NOTICE_SUMMARY") ? translated
          : noticeSummaryEvidenceFor(subject.id, chosen.id, question, () => snapshot);
        // A document extraction gap is not an absence of the separately held
        // structured agenda for this exact sitting.
        if (publication.gap && !outcome.records.some((record) => record.kind === "AGENDA_ITEM")) {
          /*
           * OUR "we have not yet acquired the agenda" for this body's sitting is
           * the gap held-gaps.ts codes AGENDA_NOT_HELD (2026-09-25): no document
           * for the sitting is held at all. Coded, a reader being told it raises
           * the runner's matching obligation; a sitting outside that rule's
           * window raises nothing. A publisher's own "not posted" (THEIRS) and a
           * held document we could not read are not this gap and stay uncoded.
           */
          const unacquired = publication.gap.whose === "OURS" &&
            (publication.acquisition === "NOT_ACQUIRED" || publication.acquisition === "ROUTE_BLOCKED" || publication.acquisition === "REPRESENTATION_DISCOVERED");
          attachSittingGaps("AGENDA", [unacquired
            ? { ...publication.gap, code: "AGENDA_NOT_HELD", bodyId: subject.id, recordClass: ASK_GAP_RECORD_CLASS.AGENDA_NOT_HELD }
            : publication.gap], chosen.id);
        }

        // The document the reader is shown first — the one the reading, and so
        // `items`, was taken over — never merely the newest stored row.
        const newest = holdings.documents[0];
        const items = publication.items;

        if (publication.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX" && newest) {
          /*
           * A document the same body reuses across sittings is a LANDING PAGE by
           * construction — one page cannot be the agenda of two meetings. The
           * agenda route found 56 of 198 documents in this state, nine of them on
           * Vail's own portal root. Handing one to the synthesis rung as "this
           * meeting's agenda" would produce a confident summary of a navigation
           * menu. The reading names it; the record says so out loud.
           */
          records.push({
            kind: "AGENDA_DOCUMENT",
            id: newest.documentUrl,
            /* A document inherits body identity THROUGH the meeting it is
               attached to, never from its own title text. */
            bodyId: chosen.bodyId,
            text: publication.documentSharedAcrossGovernments
              ? "A stored source link shared across governments; it has not been verified as this body's agenda."
              : `An agenda portal page for ${subject.name}, not a single meeting's agenda.`,
            sourceUrl: newest.documentUrl,
            sourceOrg: publication.documentSharedAcrossGovernments ? null : newest.sourceOrg ?? null,
            retrievedAt: newest.retrievedAt,
          });
        } else if (publication.acquisition === "ITEMS_READER_READY" && newest) {
          denominators.agendaItemsExtracted = (denominators.agendaItemsExtracted ?? 0) + items.length;
          for (const [index, item] of items.entries()) {
            records.push({
              kind: "AGENDA_ITEM",
              id: `${chosen.id}#${index}`,
              /* Read out of THAT meeting's document, so it carries THAT meeting's
                 body. The chain is BODY -> MEETING -> DOCUMENT -> ITEM and every
                 link is an id, not an inference from a heading. */
              bodyId: chosen.bodyId,
              meetingId: chosen.id,
              documentId: newest.id,
              text: item,
              occurredAt: chosen.startsAt,
              sourceUrl: newest.documentUrl,
              sourceOrg: newest.sourceOrg ?? null,
              retrievedAt: newest.retrievedAt,
            });
          }
        }

        /*
         * **AN AGENDA IS NOT AN OUTCOME, AND THE PACK HAS TO SAY SO.**
         * (2026-08-29.)
         *
         * Asked against the real handler before this existed, *"Did the Pima
         * County Board of Supervisors vote on the budget?"* returned agenda items
         * and ZERO gaps. The pack handed a synthesis model a list of things that
         * were PUT ON AN AGENDA and asked it about a DECISION, with nothing
         * anywhere in it saying no outcome record was held — and the likeliest
         * sentence out of that pack is a confident, sourced account of a vote we
         * have no record of. Fabricated from a real document, which is what makes
         * it survive a skim.
         *
         * The agenda records are KEPT. They are honest evidence of what was
         * noticed, and a reader asking about a vote is well served by "here is
         * what was on the agenda, and we do not hold what was done with it." What
         * is added is the second half of that sentence, as a NAMED GAP, so the
         * absence travels with the records instead of being silence.
         *
         * The ruling comes from `lib/answerability/record-class.ts`, which holds
         * the allow-list; this route only supplies which question was asked, which
         * is the one thing that module says it cannot decide for itself.
         */
        records.push(...outcome.records);
        heldActions.push(...outcome.actions);
        records.push(...minutes.records);
        records.push(...notice.records);
        attachSittingGaps("NOTICE", notice.gaps, chosen.id);
        attachSittingGaps("MINUTES", minutes.gaps, chosen.id);
        // A sourced summary answers what happened without pretending it records
        // each member's vote. No outcome-store absence may erase that answer.
        if (!minutes.records.length) attachSittingGaps("OUTCOME", outcome.gaps, chosen.id);
        denominators.minutesSummaryRecordsReturned = (denominators.minutesSummaryRecordsReturned ?? 0) + minutes.records.length;
        denominators.noticeSummaryRecordsReturned = (denominators.noticeSummaryRecordsReturned ?? 0) + notice.records.length;
        for (const [key, count] of Object.entries(outcome.denominators)) denominators[key] = (denominators[key] ?? 0) + count;
        }
      }

      /*
       * **THE CONTACTS ARE PART OF THE ANSWER, and they are not a ranking.**
       *
       * A reader who cannot get the agenda can still get the board president's
       * name and the district's own page. Every entry is read off a sourced
       * roster row and describes a RELATIONSHIP — "Governing Board President",
       * "Superintendent" — never an assessment of who matters. See
       * `lib/ask/contacts.ts` for why "most influential" is unbuildable here.
       */
      if (publicCommentAsk && access.records.length === 0 && access.gaps.length === 0) {
        attachSittingGaps("COMMENT", [{ whose: "OURS", statement: `We have not recorded how the public can comment at ${subject.name}.` }]);
      }
      contacts.push(
        ...contactsForBody(
          {
            bodyId: subject.id,
            ocdId: bound?.ocdId ?? null,
            divisionType: bound?.divisionType ?? null,
          },
          subject.name,
        ),
      );
      if (contacts.length === 0) {
        gaps.push({
          whose: "OURS",
          statement: `We have not recorded who sits on ${subject.name} or how to reach them.`,
        });
      }
    } else if (subject?.kind === "PERSON") {
      /*
       * **THE OFFICEHOLDER PATH IS HONEST ABOUT BEING THIN, AND THAT IS THE
       * POINT.**
       *
       * The corpus holds who an officeholder IS — name, office, party, contact,
       * each sourced — and holds nothing about what they have DONE. There is no
       * store of vetoes, executive orders or bill actions for any governor;
       * `lib/votes/` is congressional only. So a question about a governor's
       * record resolves the person and the office correctly and then finds
       * almost nothing, which is exactly what the reader is told. Filling that
       * with what a model remembers about a sitting governor is the single most
       * damaging thing this route could do, and it is why synthesis is given a
       * pack rather than a question. AZ03 holds the hunt.
       */
      const seat = officeholders.seats.find((s) => s.id === subject.id);
      if (seat) {
        records.push(officeholderEvidence(seat));
        denominators.officeholderRecords = 1;
        subject.office = seat.officeTitle;
        contacts.push(contactForOfficeholder(seat));
      }
      /*
       * **THE DENOMINATOR IS STATED, so the answer can bound its own scope.**
       *
       * "Here are the actions in the records we currently hold" is a true
       * sentence. "Here is what she did" is not one this corpus can earn, and
       * the difference between them is a number the pack has to carry.
       */
      if (moneyOnly) {
        /* Not asked about: no action records, and no gap about them. */
      } else if (seat) {
        officeholderActionEvidence(
          seat.id,
          seat.name,
          today,
          interpretation.temporal.trailingMonths,
          records,
          gaps,
          denominators,
        );
      } else {
        gaps.push({
          whose: "OURS",
          statement: `We have not recorded any actions in office for ${subject.name}.`,
        });
        denominators.actionRecordsHeld = 0;
      }

      /* ── ASK-06 ── the same exact identity chain on the officeholder path. A
         sitting legislator asked about by name reaches their own roll calls; a
         governor reaches the honest gap, because a governor casts none. */
      if (!moneyOnly) {
        if (voteEvidenceReadsStateRollCalls(subject.name, { withinStates: statesOf(ocdIds), officeholderId: seat?.id })) await personStateVotes();
        const votes = await voteEvidenceForIncludingHistory(subject.name,
          { withinStates: statesOf(ocdIds), officeholderId: seat?.id });
        if (votes.identity.kind === "JOINED") canonicalSubjectKeys.add(votes.identity.seat.officeholderId);
        records.push(...votes.records);
        gaps.push(...votes.gaps);
        Object.assign(denominators, votes.denominators);
      }
    }

    if (subject?.kind === "PERSON" && !moneyOnly) {
      const statements = statementEvidenceFor(subject, question, [...canonicalSubjectKeys]);
      records.push(...statements.records);
      gaps.push(...statements.gaps);
      Object.assign(denominators, statements.denominators);
    }

    /*
     * ── ASK-CF ── **CAMPAIGN MONEY, FROM THE FILINGS WE ACTUALLY HOLD.**
     * (2026-08-30.)
     *
     * The repository has held itemized Pima County campaign-finance rows since
     * 2026-08-29 — committee register rows, 900 contribution rows, 584
     * distribution rows, each off the filing officer's own portal — and this
     * route could reach none of them. A reader asking who funded a Vail school
     * board campaign got a pack with no finance records, and the honest-gap
     * machinery then said we hold no campaign-finance records: a sentence that
     * had silently become FALSE about us.
     *
     * `lib/ask/local-finance.ts` holds the whole rule: linkage is the filing
     * officer's own committee→office register row through a hand-audited
     * office→body crosswalk, never a name match; rows are date-ordered, never
     * amount-ranked; nothing is totalled; and every evidence set names the
     * independent-expenditure class as not held, because filed campaign money
     * without that caveat reads as the whole money picture. A covered body with
     * no linked committee gets the named OURS gap rather than silence, and a
     * federal candidate returns null here rather than a false "nothing
     * recorded" — their finance records live in the FEC snapshot, not this
     * store.
     */
    /*
     * **OWN-Q5 (2026-08-31) — AND EVERY REGIME IS NAMED, ALWAYS.**
     *
     * The owner's amendment: *not just FEC filings, but state and local finances
     * must be checked*, and *an FEC absence never stands in for "no records
     * exist"*.
     *
     * The county store was already reachable. What was missing is the
     * DENOMINATOR: `localFinanceEvidenceFor` returns null for a statewide
     * executive, a federal candidate, a contest and an office, and a null pushed
     * nothing — so one regime's silence answered for all three. That is
     * ONE ROUTE SUCCESS != SOURCE UNIVERSE COMPLETE, mirrored: one route's
     * ABSENCE is not the universe's either.
     *
     * Now a money question always carries all three regime statements, and a
     * subject this pipeline holds nothing for gets a scope gap that says which
     * store it would be in rather than a bare nothing.
     */
    if (subject?.kind === "PERSON" && !moneyOnly) {
      const keyVotes = await keyVoteEvidenceFor(subject, [...canonicalSubjectKeys]);
      records.push(...keyVotes.records);
      gaps.push(...keyVotes.gaps);
      Object.assign(denominators, keyVotes.denominators);
    }

    /*
     * **A COMPARISON RETRIEVES BOTH PEOPLE'S MONEY.** (2026-09-25, the Ask model
     * comparison.) *"Has Cinde Warmington raised more money than Kelly Ayotte?"*
     * bound Warmington and retrieved hers alone, and every writer then told the
     * reader we hold no fundraising for Ayotte — a false statement about us, over
     * a held filing. The one other held person the question names (exact id,
     * never a context default; two or more is none) has the same money records
     * retrieved and stamped as hers, and the relevance gate keeps exactly those.
     */
    const comparedIds = new Set<string>();
    if (subject?.kind === "PERSON" && financeAsked) {
      const other = otherNamedPerson(question, inventory, subject.id);
      const otherRecord = other ? ballotInventory.subjects.get(other.id) ?? null : null;
      const otherSubject: EvidenceSubject | null = other
        ? otherRecord ? ballotSubject(otherRecord) : { kind: "PERSON", id: other.id, name: titleCaseName(other.name) }
        : null;
      if (otherSubject?.kind === "PERSON") {
        comparedIds.add(otherSubject.id);
        const theirs = campaignMoneyEvidenceFor(otherSubject, otherRecord?.id ?? otherSubject.id, otherRecord?.contestId);
        records.push(...theirs.records);
        gaps.push(...theirs.gaps);
        denominators.comparedPersonStateFinanceRecordsReturned = theirs.denominators.stateFinanceRecordsReturned;
        denominators.comparedPersonFederalFinanceRecordsReturned = theirs.denominators.federalFinanceRecordsReturned;
        if (otherRecord && ballot.set) {
          const filing = ballotRecordsFor(otherRecord, { set: ballot.set, contests: ballot.contests, absences: [], nominees: ballot.nominees });
          records.push(...filing.records.filter((record) => record.kind === "CANDIDACY").map((record) => ({ ...record, subjectId: otherSubject.id })));
        }
      }
    }

    /* The party-conflict card's money is its filing's, retrieved under the filing's own id (never restamped as the card's). */
    if (partyConflictFiling && subject?.kind === "PERSON" && financeAsked) {
      comparedIds.add(partyConflictFiling.id);
      const filed = campaignMoneyEvidenceFor(ballotSubject(partyConflictFiling), partyConflictFiling.id, partyConflictFiling.contestId);
      records.push(...filed.records);
      gaps.push(...filed.gaps);
      denominators.partyConflictFilingStateFinanceRecordsReturned = filed.denominators.stateFinanceRecordsReturned;
    }

    /*
     * **A RACE'S CANDIDATES' MONEY.** (2026-09-25, the Ask three-second repair,
     * part two; `lib/ask/money-answer.ts`.) *"How much have the candidates for
     * governor raised?"* names one contest: every candidate the held ballot lists
     * for it has their own money records retrieved and stamped as theirs (exact
     * ids, the same selector the card uses), and the relevance gate keeps exactly
     * those. *"Who funded the Vail school board candidates?"* names a body whose
     * race the authority says is not on the ballot: that statement, for the
     * body's own division, is retrieved beside the body's register records.
     */
    const groupAsk = subject && (subject.kind === "CONTEST" || subject.kind === "BODY") && financeAsked
      ? groupMoneyShapeForBoundSubject(question, inventory, subject.id) : null;
    const groupCandidates: { id: string; name: string; matched: boolean }[] = [];
    let groupStateRecords = 0;
    let groupAbsence: EvidenceRecord | null = null;
    /* The one held contest: the bound contest, or the only contest the ballot
       holds in a bound body's own division for that body's own seats ("the
       Mendham Township Committee candidates"). Two or none is not one; the
       model reads it as before. */
    const groupContest = !groupAsk ? null : subject?.kind === "CONTEST" && ballotRecord?.kind === "CONTEST" ? ballotRecord
      : subject?.kind === "BODY" ? ((held) => held.length === 1 ? held[0] : null)(
        [...new Map([...ballotInventory.subjects.values()].filter((row) => row.kind === "CONTEST" && row.ocdId === subject.id.split("#")[0] &&
          contestFitsBody(row.contestTitle, subject.name)).map((row) => [row.id, row])).values()])
        : null;
    if (groupContest) {
      for (const candidate of ballotInventory.subjects.values()) {
        if (candidate.kind !== "PERSON" || candidate.contestId !== groupContest.contestId || candidate.removedFromFiling ||
          candidate.historicalFiling || candidate.outsideReaderDivisions || groupCandidates.some((held) => held.id === candidate.id)) continue;
        comparedIds.add(candidate.id);
        const theirs = campaignMoneyEvidenceFor(ballotSubject(candidate), candidate.id, candidate.contestId);
        records.push(...theirs.records);
        gaps.push(...theirs.gaps);
        groupStateRecords += theirs.denominators.stateFinanceRecordsReturned;
        // A ballot listing not joined to a filing identity is never "no filing": that would be false about a filing held under another record.
        groupCandidates.push({ id: candidate.id, name: candidate.name, matched: Boolean(candidate.candidacyId) && theirs.denominators.financeIdentityUnresolved === 0 });
      }
      denominators.raceCandidatesListed = groupCandidates.length;
      denominators.raceStateFinanceRecordsReturned = groupStateRecords;
    }
    if (groupAsk && !groupContest && subject?.kind === "BODY") {
      const said = absencesForDivisions([subject.id.split("#")[0]], absencesWithoutRemovals(ballot.absences, ballot.set?.removals ?? []));
      // Only the authority's own statement that the race is NOT on this ballot.
      if (said.length === 1 && /^There is no .+ race on the /.test(said[0].text)) {
        groupAbsence = said[0];
        records.push(said[0]);
      }
    }

    if (subject && financeAsked) {
      const normalized = campaignMoneyEvidenceFor(subject, ballotRecord?.id ?? subject.id, ballotRecord?.contestId);
      records.push(...normalized.records);
      gaps.push(...normalized.gaps);
      Object.assign(denominators, normalized.denominators);
      const finance = localFinanceEvidenceFor(subject, [...canonicalSubjectKeys]);
      if (finance) {
        records.push(...finance.records);
        gaps.push(...finance.gaps);
        Object.assign(denominators, finance.denominators);
      } else if (normalized.records.length === 0 && normalized.gaps.length === 0 && groupCandidates.length === 0) {
        gaps.push(financeScopeGapFor(subject));
      }
      // Every regime, on every money answer, whether or not records were found.
      for (const note of financeRegimeNotesFor(subject, {
        state: normalized.denominators.stateFinanceRecordsReturned > 0 || groupStateRecords > 0 || (denominators.partyConflictFilingStateFinanceRecordsReturned ?? 0) > 0,
        federal: normalized.denominators.federalFinanceRecordsReturned > 0,
        county: Boolean(finance?.records.length),
      })) gaps.push(note.gap);
      denominators.financeRegimesNamed = 3;
    }

    /*
     * **THE READER'S OWN OFFICIALS.** (2026-09-29, S3; `lib/ask/reader-officials.ts`.)
     * "Who is my state senator?" names no subject; the officeholders the route
     * already loaded for the reader's divisions and bodies are the answer. Each one
     * named is a record beside the composed sentence, with their published contact.
     */
    const officials = officialsAsk && (!subject || officialsAsk.place) ? composeReaderOfficials({ ask: officialsAsk, held: officeholders.held, holdingFailed: officeholders.loaderFailures > 0, placesReached: new Set(ocdIds.filter((id) => /[/]place:[a-z_]+$/.test(id) && !id.endsWith("_ccd"))).size }) : null;
    if (officials) {
      for (const { seat, bodyName } of officials.named) {
        records.push(officeholderEvidence(seat));
        contacts.push({
          id: seat.id, name: seat.name, officeTitle: seat.officeTitle,
          relationship: bodyName ? `${seat.officeTitle} on ${bodyName}` : `Your ${seat.officeTitle}`,
          basis: bodyName ? "BODY_MEMBER" : "READER_REPRESENTATIVE",
          email: seat.email, phone: seat.phone, websiteUrl: seat.websiteUrl,
          sourceUrl: seat.sourceUrl, sourceOrg: seat.provenance?.sourceOrg ?? null, retrievedAt: seat.provenance?.collectedAt ?? null,
        });
      }
      gaps.push(...officials.gaps);
      denominators.officeholderRecords = officials.named.length;
    }

    /* The reader's ballot, composed above from the contests their divisions reach: each contest is a record they are shown. */
    if (ballotAsk && ballotComposed && (!subject || ballotAsk.kind === "OFFICE")) {
      records.push(...ballotComposed.records);
      for (const statement of ballotComposed.gaps) gaps.push({ whose: "OURS", statement });
      denominators.contestsOnTheBallot = ballot.contests.length;
    }

    /*
     * **THE MEETINGS HELD FOR THE READER'S AREA.** (2026-09-29, S3; `lib/ask/area-meetings.ts`.)
     * "What meetings are happening this week?" names no body: the sittings held for
     * the divisions the reader is in, in the window they named, are the answer.
     */
    const areaMeetings = areaMeetingsAsk && !subject && snapshot
      ? composeAreaMeetings({
        ask: areaMeetingsAsk, now: selectionNow,
        label: (sitting) => {
          const identity = canonicalBodyIdentity(sitting.bodyId);
          return identity ? `${identity.name}${identity.divisionLabel && !identity.name.includes(identity.divisionLabel) ? ` — ${identity.divisionLabel}` : ""}` : sitting.bodyName;
        },
        sittings: meetings.filter((meeting) => meeting.ocdId !== null && ocdIds.includes(meeting.ocdId) && meeting.bodyId !== null) as unknown as AreaSitting[],
      })
      : null;
    if (areaMeetings) {
      records.push(...areaMeetings.records);
      gaps.push(...areaMeetings.gaps);
      resolvedSittings.push(...(areaMeetings.inWindow.slice(0, 3) as unknown as AskSitting[]));
      denominators.meetingsHeldInTheWindow = areaMeetings.inWindow.length;
    }

    /*
     * **THE READER'S OWN LEGISLATORS — A FALLBACK, NOT AN ADDITION TO EVERY
     * ANSWER.** (Scoped 2026-08-28, after reading the panel.)
     *
     * Their relationship is real and it is to the READER rather than to the
     * subject: the geometry placed the reader's divisions inside these districts.
     * That makes them the right answer when nothing closer exists, and the wrong
     * thing to stack under an answer that already names the board that governs
     * the thing asked about — every extra contact with no relationship to the
     * subject weakens the ones that have one.
     *
     * It is not an address-verified constituency and the wording does not claim
     * one; `lib/ask/residency.ts` holds the same distinction for the signal row.
     */
    if (subject && contacts.length === 0) {
      contacts.push(...contactsForRepresentatives(readerRepresentatives(ocdIds)));
    }
    /*
     * ── ASK-24 ── **WHO THIS IS ONLY WHERE THE CONNECTION IS PRINTED.**
     * (The owner's Prop 141 report, 2026-09-02.)
     *
     * A ballot MEASURE with no governing roster of its own falls back to the
     * reader's own legislators above — and *"Your state senator"* has no stated
     * relationship to Proposition 141, which is why three of them appeared under
     * WHO THIS IS on a question about a tax measure. The measure's OWN district
     * board (which governs the jurisdiction the measure is about) stays; the
     * reader-representative fallback does not. `lib/ask/relevance.ts` holds the
     * rule, and it is scoped to a measure so a candidate or contest keeps the
     * fallback that is genuinely its closest honest contact.
     *
     * Gated HERE, before contacts become CONTACT records, so the same set reaches
     * the evidence pack and the rendered WHO THIS IS — a contact the pack drops
     * can never be one the panel shows.
     */
    const shownContacts = gateContactsToSubject(subject, contacts).contacts;
    const rosterGaps = rosterGapEvidenceFor(subject, shownContacts, canonicalSubjectKeys);
    records.push(...rosterGaps.records);
    gaps.push(...rosterGaps.gaps);
    Object.assign(denominators, rosterGaps.denominators);
    denominators.contactsExcludedOffSubject = contacts.length - shownContacts.length;
    for (const contact of shownContacts) {
      records.push(contactRecord(contact));
    }
    denominators.verifiedContacts = shownContacts.length;

    /*
     * **THE AUTHORITY'S OWN STATEMENTS OF ABSENCE — for the SUBJECT's division.**
     *
     * "There is no Vail Unified governing board race on this ballot", in Pima
     * County's words, is evidence of the same standing as a contest. It is
     * evidence about VAIL, though, and attaching every one of the reader's
     * divisions' absences to every answer put the school-board cancellation into
     * the source line of an answer about the Governor. A source list that carries
     * documents the answer did not rest on is a weaker attribution, not a
     * fuller one.
     *
     * With no bound subject on the ballot surface the reader is asking about
     * their ballot as a whole, and every absence on it is theirs to see.
     */
    if (ballotRecord && ballotRecord.kind !== "PERSON") {
      /* A CONTEST or a MEASURE is a question about what is on the ballot, and an
         authority saying a race is not on it answers exactly that. A question
         about a PERSON is not a question about the ballot lineup, so an absence
         under it is a document the answer did not rest on. */
      records.push(...absencesForDivisions([ballotRecord.ocdId], absencesWithoutRemovals(ballot.absences, ballot.set?.removals ?? [])));
    } else if (surface === "BALLOT" && !subject) {
      records.push(...absencesForDivisions(ocdIds, absencesWithoutRemovals(ballot.absences, ballot.set?.removals ?? [])));
    }

    /*
     * ── ASK-14 ── WHAT AN OFFICE DOES, FROM THE DEFINITION WE ALREADY HOLD.
     * (2026-08-28.)
     *
     * A reader asked *"What does the governor do"* and got the honest-gap
     * sentence, so the question was whether the office-function corpus was
     * missing or merely unreachable. Measured: `lib/officials/office-blurbs.ts`
     * holds twenty-six sourced office definitions, `governor` among them, and
     * every battlecard has rendered them under "What this office does" since
     * BC-6. The corpus was never the problem.
     *
     * The trace said where it stopped. The intent classifier returned CIVICS
     * correctly; `resolution.state` was NONE, because `lib/ask/resolve.ts` binds
     * ENTITY MENTIONS and "the governor" names an OFFICE rather than an entity.
     * No binding meant no subject, no subject meant no retrieval, and the answer
     * sat one lookup away. *"What does a county supervisor do?"* failed
     * identically, so it was never about the governor.
     *
     * This runs only when nothing canonical was bound: a question that DID name
     * a body or a person is answered about that body or that person, and a
     * generic office definition must never displace it. `asksWhatAnOfficeDoes`
     * is the second half of the gate — *"who is the governor"* names an office
     * and asks for a person, and answering it with a job description would be
     * the product not listening.
     *
     * It emits a stored, sourced record or nothing at all. There is no path here
     * that writes civics from model memory.
     */
    if (records.length === 0 && !subject && interpretation.intent === "CIVICS") {
      const match = asksWhatAnOfficeDoes(question) ? officeInQuestion(question) : null;
      if (match) {
        records.push({
          kind: "OFFICE",
          id: `office:${match.office}`,
          text: match.blurb.text,
          sourceUrl: match.blurb.basisUrl,
          sourceOrg: match.blurb.basis,
        });
        denominators.officeDefinitions = 1;
        trace.officeLookup = { phrase: match.phrase, office: match.office };
      }
    }

    /*
     * ── ASK-05 ── **THE TOPIC SWEEP, DEMOTED FROM A SECOND ANSWER TO EVIDENCE.**
     * (2026-08-28.)
     *
     * *"Is there a data centre coming?"* used to be answered by a SECOND network
     * call the map component fired through `Promise.all` beside this one, and
     * rendered as a whole second civic answer — its own eyebrow, its own
     * four-way denominator sentence, its own corpus caveat, its own hit list.
     * Both could paint on one screen. Two competing authorities, no precedence,
     * and the reader chose which to believe.
     *
     * The capability is kept and its standing is not. It runs here, its records
     * enter the ONE pack as `AGENDA_MENTION`, its denominators are numbers in
     * `pack.denominators`, and every sentence it used to build is a named gap
     * with a `whose` on it. Any prose the synthesis rung writes over it is
     * validated against the same allow-list as everything else — which the
     * second answer never was.
     *
     * **The scope narrows to the bound subject where there is one.** A reader
     * who named Vail and asked about a rezoning is asking about Vail's agendas;
     * sweeping their whole area would put a neighbouring district's line under
     * an answer about Vail, which is the substitution defect wearing a quote.
     */
    const sweepScope =
      subject?.kind === "BODY"
        ? { meetings: meetingsForBody(meetings, bound), label: subject.name }
        : ocdIds.length > 0
          ? {
              meetings: meetings.filter((m) => m.ocdId !== null && ocdIds.includes(m.ocdId)),
              label: "your area",
            }
          : { meetings, label: "the areas we cover" };
    const sweptIds = new Set(sweepScope.meetings.map((m) => m.id));
    const sweep = agendaTopicEvidence({
      question,
      documents: documents.filter((d) => sweptIds.has(d.meetingId)),
      meetings: sweepScope.meetings,
      scopeLabel: sweepScope.label,
    });
    let areaTimelines: ReturnType<typeof buildTopicTimeline>[] = [];
    if (areaTopicRoute && topicRoute && !subject) {
      const inArea = meetings.filter((meeting) => meeting.ocdId !== null && ocdIds.includes(meeting.ocdId) && meeting.bodyId);
      const byBody = new Map<string, MeetingLike[]>();
      for (const meeting of inArea) byBody.set(meeting.bodyId!, [...(byBody.get(meeting.bodyId!) ?? []), meeting]);
      const outcomesUnavailable = outcomeStoreLoadedFrom() === "EMPTY_STORE";
      areaTimelines = [...byBody].map(([bodyId, bodyMeetings]) => {
        const ids = new Set(bodyMeetings.map((meeting) => meeting.id));
        const identity = canonicalBodyIdentity(bodyId);
        return buildTopicTimeline({
          topic: topicRoute,
          bodyId,
          bodyName: identity?.name ? titleCaseName(identity.name) : bodyMeetings[0]!.bodyName,
          meetings: bodyMeetings,
          documents: documents.filter((document) => ids.has(document.meetingId)),
          sittings: sittingsForBody(bodyId),
          now: selectionNow,
          outcomesUnavailable,
        });
      });
      for (const timeline of areaTimelines) {
        records.push(...timeline.records);
        // Unread-sitting gaps only for the bodies whose timeline has something;
        // every body in the area would bury the answer in its own calendar.
        if (timeline.entries.length > 0) gaps.push(...timeline.gaps);
      }
      denominators.topicAreaBodies = areaTimelines.length;
      denominators.topicAreaBodiesWithMentions = areaTimelines.filter((timeline) => timeline.entries.length > 0).length;
    }
    if (sweep.topic) {
      records.push(...sweep.records);
      gaps.push(...sweep.gaps);
      Object.assign(denominators, sweep.denominators);
      /* The intent vocabulary now names this question, so the trace can say the
         sweep ran rather than leaving an operator to infer it from a count. */
      if (interpretation.intent === "UNKNOWN") interpretation.intent = "AGENDA_TOPIC";
    }

    /*
     * ── ASK-24 ── **THE RELEVANCE GATE, BEFORE THE PACK IS SEALED.**
     * (The owner's Prop 141 report, 2026-09-02.)
     *
     * *"Explain Prop 141 to me"* returned the measure explained and then a bullet
     * about the U.S. Senate seat on the 2026 ballot — a real, sourced
     * `BALLOT_ABSENCE` that attached only because Prop 141 and the Senate contest
     * share the statewide division. It is not about the measure, and once it is in
     * the pack the synthesis rung can write a sentence from it that `validate.ts`
     * has no rule to catch. So it is removed HERE, before the model is handed the
     * pack, at the id-and-kind level rather than by reading prose:
     * `lib/ask/relevance.ts` keeps a record linked to the resolved subject and
     * drops one that is not. A null subject — the ballot-at-large question — gates
     * nothing.
     */
    const financeDetail = subject?.kind === "PERSON" && financeAsked
      ? await fetchThroughKey({ question, subject, records, deadlineMs: started + 2800 }) : null;
    if (financeDetail) {
      records.push(...financeDetail.records);
      denominators.financeDetailRowsReturned = financeDetail.records.length;
      denominators.financeDetailComplete = financeDetail.complete ? 1 : 0;
    }
    const relevant = gateRecordsToSubject(subject, records, comparedIds);
    denominators.recordsExcludedOffSubject = relevant.excluded.length;
    const packRecords = relevant.records;

    const ownWordsComposed = composeOwnWordsAnswer({ subject, question, records: packRecords });
    if (!ownWordsComposed && stanceAnswerability({ subject, question }) === "UNVERIFIED_PERSONAL_STANCE") {
      const pageMatches = packRecords.filter((record) => record.kind === "SOURCE_PASSAGE").length;
      denominators.personalStanceVerified = 0;
      denominators.linkedSourcePassages = pageMatches;
      gaps.push({ whose: "OURS", statement: `We have not verified a statement by ${subject!.name} that establishes their personal stance.` +
        (pageMatches > 0 ? " The linked page passages below show only what the pages say." : "") });
    }

    /* One named gap is said once: two same-day sittings used to put the identical
       "not yet acquired" sentence in front of the reader twice. */
    const packGaps = gaps.filter((gap, index) =>
      gaps.findIndex((other) => other.whose === gap.whose && other.statement === gap.statement) === index);
    const pack: EvidencePack = {
      question,
      intent: interpretation.intent,
      temporal: interpretation.temporal,
      subject,
      records: packRecords,
      gaps: packGaps,
      denominators,
      today,
    };

    trace.retrieval = {
      selection,
      recordCount: packRecords.length,
      sourceCount: new Set(packRecords.map((r) => r.sourceUrl).filter(Boolean)).size,
      gapCount: packGaps.length,
      denominators,
    };

    // ── 4/5. SYNTHESIS AND VALIDATION ────────────────────────────────────
    /*
     * H1. The caller key is derived from THIS REQUEST, not from the environment
     * alone: a local production build (RULING 125's verification target) also
     * reports NODE_ENV=production, so an env-only rule would file every harness
     * run under `prod-ask` and pool the reader suite's repeated questions with
     * real readers in the one number that exists to catch a regression.
     */
    /*
     * **A TOPIC TIMELINE IS COMPOSED IN CODE, NOT BY A MODEL.** (2026-09-24.)
     *
     * Every sentence it can write is a quoted clerk's line, a recorded action or
     * a date we hold, so a model adds latency (~6-7 s) and a chance to write
     * "we have no record of what the Board decided" over a pack that held the
     * decision. The composed prose passes the SAME validator a model answer
     * does; a rejection falls back exactly as a rejected model answer would.
     */
    const retrievedAt = Date.now();
    const topicComposed = topicTimeline
      ? composeTopicAnswer(topicTimeline, selectionNow)
      : areaTimelines.length > 0 ? composeAreaTopicAnswer(areaTimelines, selectionNow) : null;
    /*
     * **WHEN A BODY SITS IS COMPOSED FROM THE SITTING, NOT WRITTEN BY A MODEL.**
     * (2026-09-25, the Ask latency repair.) A question asking when a named body
     * meets — or for its agenda or decisions when the pack holds nothing to
     * summarise, only the sitting and its named gaps — is answered from the
     * MEETING records and those gaps in their own words (`lib/ask/sitting-answer.ts`).
     * The synthesis rung spent 4-6.5 s warm to say the same thing. The composed
     * prose must pass the SAME validator first; a refusal is recorded and the
     * question goes to the model exactly as before, so a composition that fails
     * a check can never reach a reader.
     */
    const candidateSittingShape = !topicComposed && !topicFocus && snapshot && subject?.kind === "BODY"
      ? (lexical && sittingShapes.has(lexical.shape) && lexical.subjectId === subject.id ? lexical.shape as "MEETING_TIME" | "BODY_AGENDA" | "MEETING_OUTCOME" | "PUBLIC_COMMENT" : shapeForBoundBody(question, inventory, subject.id)) : null;
    // An explicit outcome date uses its quoted actions or its named outcome
    // gap. Tell the composer this is the requested date, never next/latest.
    const sittingShape = !requestedMeetingDate || (requestedMeetingDate.date && candidateSittingShape === "MEETING_OUTCOME")
      ? candidateSittingShape : null;
    /* "What did they decide" is read off the recorded actions (2026-09-25):
       each quoted action phrase must pass the same validator on its own, so an
       item titled with another government's name is left to the records. */
    const sittingComposition = sittingShape && subject
      ? composeSittingAnswerWithBasis({ shape: sittingShape, subjectName: subject.name, sittings: resolvedSittings, records: packRecords, sittingGaps, now: selectionNow, includeLocation: /\bwhere\b/i.test(question), requestedLocalDate: requestedMeetingDate?.date, questionClass: outcomeQuestionClass(question),
        actions: heldActions, admissible: (text) => validateAnswer(text, [], pack, bodies).kind === "PASSED" })
      : null;
    const sittingSettled = settleSittingComposition(
      sittingComposition?.composed ?? null,
      (text, urls) => validateAnswer(text, urls, pack, bodies),
    );
    if (sittingShape) {
      trace.composition = {
        kind: "SITTING",
        shape: sittingShape,
        ...(sittingComposition ? { basis: sittingComposition.basis } : {}),
        composed: Boolean(sittingSettled.verdict),
        ...(sittingSettled.verdict ? { passed: sittingSettled.verdict.kind === "PASSED" } : {}),
        ...(sittingSettled.verdict?.kind === "FAILED" ? { failed: sittingSettled.verdict.failed } : {}),
      };
    }
    /*
     * **A PERSON'S CAMPAIGN MONEY IS COMPOSED FROM THE FILINGS WE HOLD.**
     * (2026-09-25, the Ask three-second repair; `lib/ask/money-answer.ts`.) How
     * much a named person's committee raised or spent, who gave (our records
     * hold totals, not donors), or a comparison of two named people, stated from
     * their state committee records alone. The model spent 1.4-9.1 s writing the
     * same figures, and got the who/comparison kinds wrong 6 times in 8 on the
     * fast writer. The same validator decides; a refusal goes to the model.
     */
    const moneyShape = !topicComposed && !sittingSettled.composed && subject?.kind === "PERSON" && financeAsked
      ? moneyShapeForBoundPerson(question, inventory, subject.id, officeOf) : null;
    const moneyOther = moneyShape?.otherId ? ballotInventory.subjects.get(moneyShape.otherId)?.name ?? inventory.find((entity) => entity.id === moneyShape.otherId)?.name ?? null : null;
    const moneySettled = settleSittingComposition(
      financeDetail ? composeFinanceDetail(financeDetail) : moneyShape && subject && (moneyShape.otherId === null || (moneyOther && comparedIds.has(moneyShape.otherId)))
        ? composeMoneyAnswer({
          ask: moneyShape.ask,
          // A party-conflict card's money is its filing's: stated under the filing's id, after both parties and their authorities.
          subject: { id: partyConflictFiling && moneyShape.ask.kind !== "COMPARE" ? partyConflictFiling.id : subject.id, name: subject.name },
          other: moneyShape.otherId && moneyOther ? { id: moneyShape.otherId, name: moneyOther } : null, records: packRecords, gaps: packGaps,
          ...((conflict) => conflict ? { lead: `Our held Arizona certified-canvass party label for ${conflict.name} is ${conflict.canvassParty ?? "unrecorded"}; our held Secretary of State candidate-filing party label is ${conflict.filingParty ?? "unrecorded"}, and the figures here are held under that filing` } : {})(partyConflictFiling ? partyConflictFilings.get(subject.id) : null),
        })
        : null,
      (text, urls) => validateAnswer(text, urls, pack, bodies),
    );
    if (moneyShape) {
      trace.composition = {
        kind: "MONEY",
        shape: moneyShape.ask.kind,
        basis: "STATE_COMMITTEE_FILINGS",
        composed: Boolean(moneySettled.verdict),
        ...(moneySettled.verdict ? { passed: moneySettled.verdict.kind === "PASSED" } : {}),
        ...(moneySettled.verdict?.kind === "FAILED" ? { failed: moneySettled.verdict.failed } : {}),
      };
    }
    /* A race's candidates, or a body whose race is not on the ballot (2026-09-25): the same validator decides; a refusal goes to the model. */
    const groupReady = groupAsk && subject && !topicComposed && !sittingSettled.composed && !moneySettled.composed ? { ask: groupAsk, subject } : null;
    const groupSettled = settleSittingComposition(
      groupReady && groupContest && groupCandidates.length > 0
        ? composeGroupMoneyAnswer({
          ask: groupReady.ask,
          // A body's contest is named with its body: "Member of the Township Committee" alone is every township's title.
          contest: { id: groupContest.contestId, title: groupReady.subject.kind === "BODY" ? `${groupContest.contestTitle} (${groupReady.subject.name})` : groupContest.contestTitle },
          candidates: groupCandidates, records: packRecords, gaps: packGaps,
        })
        : groupReady?.subject.kind === "BODY" && groupAbsence
          ? composeNoRaceMoneyAnswer({ ask: groupReady.ask, body: { id: groupReady.subject.id, name: groupReady.subject.name }, absence: groupAbsence, records: packRecords })
          : null,
      (text, urls) => validateAnswer(text, urls, pack, bodies),
    );
    if (groupReady) {
      trace.composition = {
        kind: "MONEY",
        shape: `RACE_${groupReady.ask.kind}`,
        basis: groupContest ? "STATE_COMMITTEE_FILINGS" : "BALLOT_ABSENCE_AND_COUNTY_REGISTER",
        composed: Boolean(groupSettled.verdict),
        ...(groupSettled.verdict ? { passed: groupSettled.verdict.kind === "PASSED" } : {}),
        ...(groupSettled.verdict?.kind === "FAILED" ? { failed: groupSettled.verdict.failed } : {}),
      };
    }
    /* The reader's own officials (lib/ask/reader-officials.ts): composed from the held officeholders, held to the same validator. */
    const officialsSettled = settleSittingComposition(
      officials && !topicComposed ? { answer: officials.answer, citedUrls: officials.citedUrls } : null,
      (text, urls) => validateAnswer(text, urls, pack, bodies),
    );
    if (officialsAsk) {
      trace.composition = {
        kind: "OFFICIALS",
        shape: officialsAsk.keys.join("+"),
        basis: "HELD_OFFICEHOLDERS",
        composed: Boolean(officialsSettled.verdict),
        ...(officialsSettled.verdict ? { passed: officialsSettled.verdict.kind === "PASSED" } : {}),
        ...(officialsSettled.verdict?.kind === "FAILED" ? { failed: officialsSettled.verdict.failed } : {}),
      };
    }
    /* Who sits on a named body, from its roster (lib/ask/reader-officials.ts): the same validator decides. */
    const rosterSettled = settleSittingComposition(
      !topicComposed && !sittingSettled.composed && subject?.kind === "BODY" && lexical?.shape === "BODY_ROSTER" && lexical.subjectId === subject.id
        ? composeBodyRoster({ bodyName: subject.name, contacts: shownContacts, gaps: rosterGaps.gaps })
        : null,
      (text, urls) => validateAnswer(text, urls, pack, bodies),
    );
    if (subject?.kind === "BODY" && lexical?.shape === "BODY_ROSTER") {
      trace.composition = {
        kind: "ROSTER",
        shape: "BODY_ROSTER",
        basis: "HELD_ROSTER",
        composed: Boolean(rosterSettled.verdict),
        ...(rosterSettled.verdict ? { passed: rosterSettled.verdict.kind === "PASSED" } : {}),
        ...(rosterSettled.verdict?.kind === "FAILED" ? { failed: rosterSettled.verdict.failed } : {}),
      };
    }
    /* How a named person voted (lib/ask/person-votes.ts): the roll calls we hold, in the chamber's own fields; the same validator decides. */
    const votesShape = !topicComposed && !sittingSettled.composed && !moneySettled.composed && subject?.kind === "PERSON"
      ? personVotesShapeForBoundPerson(question, inventory, subject.id) : null;
    const votesSettled = settleSittingComposition(
      votesShape && subject ? composePersonVotes({ name: subject.name, topic: votesShape.topic, records: packRecords }) : null,
      (text, urls) => validateAnswer(text, urls, pack, bodies),
    );
    if (votesShape) {
      trace.composition = {
        kind: "VOTES",
        shape: votesShape.topic ? "PERSON_VOTES_ON_A_TOPIC" : "PERSON_VOTES",
        basis: "HELD_ROLL_CALLS",
        composed: Boolean(votesSettled.verdict),
        ...(votesSettled.verdict ? { passed: votesSettled.verdict.kind === "PASSED" } : {}),
        ...(votesSettled.verdict?.kind === "FAILED" ? { failed: votesSettled.verdict.failed } : {}),
      };
    }
    /* The meetings held for the reader's area (lib/ask/area-meetings.ts): composed from the calendar, held to the same validator. */
    const calendarSettled = settleSittingComposition(
      areaMeetings && !topicComposed ? { answer: areaMeetings.answer, citedUrls: areaMeetings.citedUrls } : null,
      (text, urls) => validateAnswer(text, urls, pack, bodies),
    );
    if (areaMeetingsAsk) {
      trace.composition = {
        kind: "CALENDAR",
        shape: areaMeetingsAsk.window,
        basis: "HELD_MEETINGS",
        composed: Boolean(calendarSettled.verdict),
        ...(calendarSettled.verdict ? { passed: calendarSettled.verdict.kind === "PASSED" } : {}),
        ...(calendarSettled.verdict?.kind === "FAILED" ? { failed: calendarSettled.verdict.failed } : {}),
      };
    }
    /* The reader's ballot (lib/ask/ballot-summary.ts): composed above, held to the same validator. */
    const ballotSettled = settleSittingComposition(
      ballotAsk && ballotComposed && !topicComposed && (!subject || ballotAsk.kind === "OFFICE")
        ? { answer: ballotComposed.answer, citedUrls: ballotComposed.citedUrls } : null,
      (text, urls) => validateAnswer(text, urls, pack, bodies),
    );
    if (ballotAsk) {
      trace.composition = {
        kind: "BALLOT",
        shape: ballotAsk.kind === "SUMMARY" ? "SUMMARY" : `OFFICE_${ballotAsk.key}`,
        basis: "HELD_BALLOT",
        composed: Boolean(ballotSettled.verdict),
        ...(ballotSettled.verdict ? { passed: ballotSettled.verdict.kind === "PASSED" } : {}),
        ...(ballotSettled.verdict?.kind === "FAILED" ? { failed: ballotSettled.verdict.failed } : {}),
      };
    }
    const preferredBallot = ballotAsk?.kind === "OFFICE" ? ballotSettled.composed : null;
    const measureSettled = settleSittingComposition(composeMeasureMeaningAnswer({ subject, question, records: packRecords }),
      (text, urls) => validateAnswer(text, urls, pack, bodies));
    const ownWordsSettled = settleSittingComposition(ownWordsComposed,
      (text, urls) => validateAnswer(text, urls, pack, bodies));
    const governmentFinanceSettled = settleSittingComposition(composeGovernmentFinanceAnswer({ subject, question, records: packRecords }),
      (text, urls) => validateAnswer(text, urls, pack, bodies));
    const composed = governmentFinanceSettled.composed ?? ownWordsSettled.composed ?? preferredBallot ?? measureSettled.composed ?? topicComposed ?? sittingSettled.composed ?? moneySettled.composed ?? groupSettled.composed ?? officialsSettled.composed ?? rosterSettled.composed ?? votesSettled.composed ?? calendarSettled.composed ?? ballotSettled.composed;
    const composedWhy = governmentFinanceSettled.composed ? "composed-from-government-finance" : ownWordsSettled.composed ? "composed-from-own-words" : preferredBallot || measureSettled.composed ? "composed-from-ballot-records" : topicComposed ? "composed-from-structured-evidence"
      : sittingSettled.composed ? "composed-from-sitting-records"
        : moneySettled.composed ?? groupSettled.composed ? "composed-from-money-records"
          : officialsSettled.composed ? "composed-from-officeholder-records"
            : rosterSettled.composed ? "composed-from-roster-records"
              : votesSettled.composed ? "composed-from-vote-records"
                : calendarSettled.composed ? "composed-from-calendar-records"
                  : ballotSettled.composed ? "composed-from-ballot-records" : "composed-from-sitting-records";
    return {
      kind: "PACK" as const, retrievedAt, pack, packRecords, packGaps, subject, selection, composed, topicComposed, topicTimeline, areaTimelines,
      shownContacts, resolvedSittings, agendaQuestion, capture,
      composedWhy,
    };
  }

  /*
   * **THE SPECULATIVE ANSWER IS KEPT ONLY WHEN THE MODEL'S READING AGREES.**
   * Same subject, same body, same question kind and byte-identical writer
   * input (`speculationVerdict`); otherwise it is discarded — its call aborted
   * if still running — and the writer runs on the model's reading, as before.
   * Either way the trace says which path delivered and why.
   */
  const settleSpeculation = (model: ReadingOutcome | "MODEL_READING_UNAVAILABLE" | "MODEL_READING_NEEDS_NO_WRITER"): boolean => {
    if (!speculation) return false;
    const guess = speculation.codeIntent ? { codeIntent: speculation.codeIntent, codeTemporal: speculation.codeTemporal } : {};
    if (!speculation.started) {
      trace.speculation = { ran: false, why: speculation.why, delivered: "MODEL_READING", ...guess };
      return false;
    }
    const verdict = speculationVerdict(speculation.outcome, model);
    const aborted = !verdict.keep && !speculation.settled();
    if (!verdict.keep) speculation.controller.abort();
    trace.speculation = {
      ran: true, why: verdict.why, delivered: verdict.keep ? "SPECULATIVE_ANSWER" : "MODEL_READING", ...guess,
      writerStartedAtMs: speculation.startedAtMs, ...(aborted ? { aborted: true } : {}),
    };
    return verdict.keep;
  };

  const path = await answerPath(interpretation, trace);
  if (path.kind === "RESPONSE") {
    settleSpeculation(outcome?.kind === "READ" ? "MODEL_READING_NEEDS_NO_WRITER" : "MODEL_READING_UNAVAILABLE");
    return path.respond();
  }
  lapAt("resolutionAndRetrieval", path.retrievedAt);
  const { pack, packRecords, packGaps, subject, composed, topicTimeline, areaTimelines, shownContacts, resolvedSittings, agendaQuestion, capture, composedWhy } = path;
  /*
   * **THE WRITING LADDER.** (2026-09-25, the Ask latency repair.) The fast
   * writer answers first; the frontier model writes only when that answer fails
   * the SAME validator (or cannot be had), and the reason is recorded. Each
   * writer reads a bounded selection of the pack (lib/ask/writer-selection.ts);
   * the reader's records and the validator keep the whole pack. See
   * `synthesizeWithLadder` in lib/ask/synthesize.ts.
   */
  const synthesisKey = composed ? null : synthesisCacheKey(pack, ladderKey.model, ladderKey.effort);
  const missingMeasureMeaning = subject?.kind === "MEASURE" && requestedMeasureVotes(question).length > 0 &&
    !composeMeasureMeaningAnswer({ subject, question, records: packRecords });
  const cachedSynthesis = !missingMeasureMeaning && synthesisKey && stanceAnswerability(pack) !== "UNVERIFIED_PERSONAL_STANCE"
    ? synthesisCache.get(synthesisKey) : null;
  const keepSpeculative = settleSpeculation(outcome?.kind !== "READ" ? "MODEL_READING_UNAVAILABLE"
    : composed ? "MODEL_READING_NEEDS_NO_WRITER" : readingOutcome(path));
  const written = composed || missingMeasureMeaning ? null : cachedSynthesis ?? (keepSpeculative && speculation?.started ? await speculation.writing : await synthesizeWithLadder(pack, {
    allowCall,
    callerKey,
    validate: (text, urls) => validateAnswer(text, urls, pack, bodies),
    ladder,
  }));
  if (synthesisKey && !cachedSynthesis && written?.outcome.kind === "WROTE") synthesisCache.set(synthesisKey, written);
  const synthesis = written?.outcome ?? null;
  const selectionForWriter = composed ? null : writerSelection(pack);
  const writerTrace = written ? {
    writers: written.attempts,
    ...(written.escalation ? { escalation: written.escalation } : {}),
    ...(selectionForWriter && (selectionForWriter.withheld.memberVoteRows > 0 || (selectionForWriter.withheld.personVoteRecords ?? 0) > 0)
      ? { writerSelection: {
        memberVoteRowsShown: selectionForWriter.shown.memberVoteRows, memberVoteRowsWithheld: selectionForWriter.withheld.memberVoteRows, rollCallsWithheld: selectionForWriter.withheld.rollCalls,
        ...(selectionForWriter.withheld.personVoteRecords ? { personVoteRecordsShown: selectionForWriter.shown.personVoteRecords ?? 0, personVoteRecordsWithheld: selectionForWriter.withheld.personVoteRecords } : {}),
      } }
      : {}),
  } : {};
  let answer: string | null = null;
  let answerModel: string | null = null;
  let validationPassed: boolean | null = null;
  /* The reader's structured answer is the GATED pack, so the mode is derived
     from what actually reaches them: a subject whose only records were
     off-subject and gated out is NO_EVIDENCE, honestly, not a structured answer
     built from records the reader will never see. */
  let mode: AnswerMode = packRecords.length > 0 ? "STRUCTURED_GROUNDED" : "NO_EVIDENCE";

  if (missingMeasureMeaning) {
    answer = "We're working on getting this info";
    trace.synthesis = { ran: false, why: "measure-vote-meaning-not-held", ms: 0 };
  }

  if (composed) {
    trace.synthesis = { ran: false, why: composedWhy, ms: 0 };
    const verdict = validateAnswer(composed.answer, composed.citedUrls, pack, bodies);
    validationPassed = verdict.kind === "PASSED";
    trace.validation = {
      ran: true,
      passed: verdict.kind === "PASSED",
      checked: verdict.checked,
      failed: verdict.kind === "FAILED" ? verdict.failed : undefined,
    };
    if (verdict.kind === "PASSED") {
      answer = composed.answer;
      mode = "GROUNDED_COMPOSED";
    } else {
      mode = "REJECTED_FELL_BACK";
    }
  } else if (synthesis?.kind === "WROTE") {
    trace.synthesis = {
      ran: true,
      /* ITEM K §5: the RESOLVED model and effort, read off the outcome that
         made the call rather than off the constants — an override that ran
         unrecorded is exactly the un-attributable answer §5 exists to stop. */
      model: synthesis.model,
      servedModel: synthesis.servedModel ?? null,
      ...(synthesis.effort ? { effort: synthesis.effort } : {}),
      /* The whole ladder's time, every writer that ran, not only the last. */
      ms: cachedSynthesis ? 0 : written!.attempts.reduce((total, attempt) => total + attempt.ms, 0),
      /* Reused from byte-identical evidence on this instance: no model call was made. */
      ...(cachedSynthesis ? { cached: true } : {}),
      /*
       * H1. The cache numbers travel with the answer, per caller key, so a
       * regression in prompt assembly shows up as a collapsed hit rate in the
       * trace rather than as a quietly larger bill nobody reads.
       */
      cache: {
        callerKey: synthesis.callerKey,
        cacheReadInputTokens: synthesis.usage.cacheReadInputTokens,
        cacheCreationInputTokens: synthesis.usage.cacheCreationInputTokens,
        uncachedInputTokens: synthesis.usage.inputTokens,
      },
      ...writerTrace,
    };
    /* And into the server console, so a collapsed hit rate is visible in the
       deployment log rather than only in a trace somebody has to go and read.
       Caller key and token counts only — no reader fact reaches this line. */
    if (!cachedSynthesis) console.log(cacheCallLine(synthesis.callerKey, synthesis.usage));
    /*
     * The body inventory rides along as the known-subject universe, so the
     * substitution check can refuse prose that NAMES a different government we
     * hold — and only that. It no longer demands the prose repeat the
     * subject's name; the deterministic framing already names the subject, and
     * "The Board voted 5-0..." is correct anaphora, not a substitution (NH288).
     */
    const verdict = validateAnswer(synthesis.answer, synthesis.citedUrls, pack, bodies);
    validationPassed = verdict.kind === "PASSED";
    trace.validation = {
      ran: true,
      passed: verdict.kind === "PASSED",
      checked: verdict.checked,
      failed: verdict.kind === "FAILED" ? verdict.failed : undefined,
    };
    if (verdict.kind === "PASSED") {
      answer = synthesis.answer;
      answerModel = synthesis.model;
      mode = "GROUNDED_CLAUDE";
    } else {
      /*
       * **A REJECTED ANSWER IS DISCARDED, NOT REPAIRED.** The records are
       * still real and still render; only the prose goes. Degradation runs
       * grounded → structured → honest gap, and never grounded → plausible.
       * An answer rejected ONLY for length is not a wrong answer: it falls
       * back to prose code composes from the same evidence, else to the
       * records, and is not reported as a rejection (R13, lib/ask/length-fallback.ts).
       */
      const settled = settleRejectedModelAnswer({
        verdict,
        composeFallback: () => topicTimeline
          ? composeTopicAnswer(topicTimeline, selectionNow)
          : areaTimelines.length > 0 ? composeAreaTopicAnswer(areaTimelines, selectionNow) : null,
        validate: (text, urls) => validateAnswer(text, urls, pack, bodies),
        structuredMode: mode,
      });
      mode = settled.mode;
      answer = settled.answer;
      if (settled.answer !== null) validationPassed = true;
    }
  } else if (synthesis) {
    /*
     * H1, 2026-09-01. The failure DETAIL travels with the reason. A bare
     * `error` was indistinguishable between a rate limit, an overload, a
     * timeout and a malformed body, and a production cache reading on
     * 2026-09-01 met three of them with no way to say which. The detail is a
     * status code and an Anthropic error-type token — a fact about our
     * machinery, which is the only thing the trace ever carries.
     */
    trace.synthesis = {
      ran: false,
      why: synthesis.detail ? `${synthesis.why}: ${synthesis.detail}` : synthesis.why,
      ms: written ? written.attempts.reduce((total, attempt) => total + attempt.ms, 0) || synthesis.ms : synthesis.ms,
      ...(written && written.attempts.length > 0 ? writerTrace : {}),
    };
  }

  lap(composed ? "composition" : "synthesisAndValidation");
  trace.stages = stageMs;
  trace.answerMode = mode;
  trace.totalMs = Date.now() - started;

  /*
   * **THE WRITE HAPPENS HERE, AFTER THE ANSWER EXISTS.**
   *
   * Not before retrieval and not beside synthesis: the row has to describe what
   * the reader RECEIVED — the delivered mode, the delivered prose, the evidence
   * that actually stood behind it — and none of those are known any earlier. A
   * row written at the top of the handler would record an intention.
   *
   * `captureAskInteraction` builds the row only when the request carries the
   * returning-reader ID; without one it writes nothing.
   */
  /*
   * **NOTHING WE HOLD ANSWERS THIS, SO ASK MAY ANSWER FROM THE CLAUDE API.**
   * (October 1, 2026, Sean: Ask without a source we hold is allowed.)
   *
   * Only when no held record stood behind the answer and no composed or
   * synthesised answer exists, so a sourced answer is never replaced and this
   * runs last. The answer is one or two sentences and states its source in the
   * same breath ("Source: Claude Haiku 4.5, general knowledge — not a public
   * record this site holds"); the mode stays NO_EVIDENCE and the gaps below
   * still say what we do not hold. A failure of any kind leaves the answer
   * exactly as it was, and the row saved records what the reader received.
   */
  if (
    mode === "NO_EVIDENCE" &&
    answer === null &&
    packRecords.length === 0 &&
    shouldFallBack({ routerAnswered: false, routerDeclined: true })
  ) {
    const general = await askUnsourced(question);
    if (general.kind === "UNSOURCED") {
      answer = `${general.answer.text} ${general.answer.sourceLine}`;
      answerModel = resolveAskRoleModel("UNSOURCED");
    }
  }

  await capture(mode, subject ? [subject.id] : [], answer, answerModel, validationPassed, packRecords, packGaps);

  /*
   * **THE GAPS THIS READER WAS TOLD, COUNTED BY BODY — AND NOTHING ABOUT THE
   * READER.** (2026-09-25, the owner's decision of that day.) Each coded gap
   * the delivered answer states adds one to its body's count for that gap and
   * day (`lib/ask/gap-observation.ts`); the runner turns those counts into
   * targeted work. The plan is decided HERE, in the handler, so a reader-edge
   * context that refuses the database is honoured; the write runs after the
   * response, bounded, and its failure is logged by name and never reaches
   * this reader. Synthetic runs are not readers and count nothing.
   */
  const gapObservations = planAskGapObservations({
    stated: statedAskGaps({ gaps: packGaps, timelines: topicTimeline ? [topicTimeline] : areaTimelines }),
    runClass: markerFromRequest(request).runClass,
  });
  await afterResponse(() => recordAskGapObservations(gapObservations));

  /*
   * **ONE DECLARED SHAPE, BUILT FROM THE PACK THAT PRODUCED IT.** (ASK-05.)
   *
   * This was an untyped inline object literal, and so were the other four
   * shapes this route and `/api/ask/agenda` returned between them. The
   * contract lived only as hand-copied interfaces inside two components, which
   * is how `mode: "OFF"` came to be on the wire and renderable by neither, and
   * how `AskContact.basis` and `AskContact.retrievedAt` came to be
   * unrenderable by declaration.
   *
   * `askAnswer` takes the PACK rather than loose arrays, so the records the
   * reader sees are by construction the ones synthesis was given and the
   * validator checked against. The records travel whatever the mode: a
   * rejected or unavailable synthesis still ships everything needed to render
   * the true structured answer, and discarding a useful reply because one
   * optional field is null is the exact class PR #211 found repeatedly.
   */
  const payload: AskAnswerPayload = askAnswer({
    mode,
    pack,
    answer,
    contacts: shownContacts,
    /*
     * ASK-20 / ASK-23 / ASK-24. In start order and de-duplicated by id: the
     * chosen sitting first, then any other sitting the body holds on the same
     * local day. A client reads [0] for "the meeting this answer is about" and
     * the whole list for a day that holds more than one.
     */
    meetings: resolvedSittings
      .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0)),
    trace,
  });
  payload.agendaLead = Boolean(agendaQuestion);
  payload.meetingListingIdentity = meetingListingKnowledgeFor(snapshot?.meetings ?? [], resolvedSittings.map(meeting => meeting.id)).readback;
  return Response.json(payload);
}

/**
 * The one call into the signal path, from the one place that knows what was
 * delivered.
 *
 * Wrapped so a capture problem can never become a reader problem: the answer is
 * already computed by the time this runs, and an analytics store failing is not
 * a reason to withhold a correct civic answer from a person.
 */
async function captureDelivered(input: {
  request: Request;
  question: string;
  interpretation: AskInterpretation;
  resolutionState: "BOUND" | "AMBIGUOUS" | "UNRESOLVED" | "NONE";
  mode: AnswerMode;
  subjectIds: string[];
  answer: string | null;
  answerModel: string | null;
  validationPassed: boolean | null;
  records: EvidenceRecord[];
  gaps: EvidenceGap[];
  surface: "MAP" | "BALLOT" | "UNKNOWN";
  approximateLocation: string | null;
  ocdIds: string[];
  residency: ReturnType<typeof stampResidency>;
  continuityKey: string;
}): Promise<void> {
  try {
    const marker = markerFromRequest(input.request);
    await captureAskInteraction({
      question: input.question,
      intent: input.interpretation.intent,
      temporalKind: input.interpretation.temporal.kind,
      subjectIds: input.subjectIds,
      resolutionState: input.resolutionState,
      answerMode: input.mode,
      answerText: input.answer,
      answerModel: input.answerModel,
      validationPassed: input.validationPassed,
      evidenceRecordCount: input.records.length,
      evidenceSourceCount: new Set(
        input.records.map((r) => r.sourceUrl).filter(Boolean),
      ).size,
      namedGapCount: input.gaps.length,
      evidenceProvenance: evidenceProvenance(input.records),
      surface: input.surface,
      approximateLocation: input.approximateLocation,
      ocdIds: input.ocdIds,
      divisionVintage: DIVISION_VINTAGE,
      residencyRelation: input.residency.relation,
      locationConfidence: input.residency.confidence,
      /*
       * The coverage stamp is NOT taken here. The per-government tier
       * distribution is a stored field that may not appear anywhere in the
       * reader's tree — the floor tier is the only tier a reader is told, and a
       * second coverage number on a reader surface is one they have to
       * reconcile against the first. `captureAskInteraction` derives it, which
       * is also simply where it belongs: the store owns its own stamps.
       */
      continuityKey: input.continuityKey,
      runClass: marker.runClass,
      runId: marker.runId,
      occurredAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("ask signal capture failed", error);
  }
}
