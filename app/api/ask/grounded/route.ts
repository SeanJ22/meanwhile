import { governmentFinanceEvidence, governmentFinanceQuestion, composeGovernmentFinanceAnswer } from "@/lib/ask/government-finance";
import { governmentListingEntity, governmentListingEvidence, readerGovernmentListings } from "@/lib/ask/government-listings";
import { prlStatementEvidence, readPrlForSubject } from "@/lib/sources/prl/person";
import { federalAskEvidence } from "@/lib/sources/congress/reader";
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
  type AskContact,
} from "@/lib/ask/contacts";
import { contactForCandidate } from "@/lib/ask/candidate-contact";
import { officeContactsForMember } from "@/lib/ask/office-contacts";
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
import { loadBallotForDivisions, namedOfficeholders, readerOfficeholders } from "@/lib/ask/server-sources";
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
 * ```
 *   question
 *      ↓  the model, given the entity inventory and today's date
 *   INTERPRETATION           intent · entity mentions · tense · referent
 *      ↓  the registry's own binder
 *   CANONICAL RESOLUTION     reader words > model expansion > page context
 *      ↓  deterministic, scoped to the resolved id and the resolved tense
 *   RETRIEVAL                only records belonging to that exact subject
 *      ↓
 *   EVIDENCE PACK            records + provenance + NAMED GAPS + denominators
 *      ↓  the model, given the pack and nothing else
 *   SYNTHESIS
 *      ↓
 *   STRUCTURAL VALIDATION    invented URL · substituted subject · advice · tense
 *      ↓
 *   READER
 * ```
 *
 * Synthesis has no corpus, no tools and no network. A named body that resolves to more than one thing
 * produces `CLARIFY`, one that resolves to nothing produces `UNRESOLVED`; neither falls through to the
 * reader's own ZIP.
 */

export const runtime = "nodejs";

/** Logs the resolved model and effort once at startup, so an override is visible in the deployment log. Configuration only, never request content. */
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
  /** The registry id of the body that is meeting; select on this, never on geography. */
  bodyId: string | null;
  ocdId: string | null;
  title: string;
  bodyName: string;
  startsAt: string;
  timeZone?: string | null;
  /** `DAY`: a date-only posting; `startsAt`'s midnight is never a time. */
  startPrecision?: Meeting["startPrecision"];
  agendaUrl?: string | null;
  location: Meeting["location"];
  status: Meeting["status"];
  jurisdiction: string;
  online?: Meeting["online"];
  /** Optional; `observationFromMeetingRecord` refuses an incomplete provenance rather than downgrading it. */
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
 * The meetings of one exact body, selected on `bodyId`, never on geography. An entity that is not
 * `level: "BODY"` gets no meetings at all, never its division's; the caller turns empty into a named gap.
 * Shared by the sitting selection and the agenda-topic sweep so the two cannot disagree.
 */
function meetingsForBody(
  meetings: readonly MeetingLike[],
  bound: BindableEntity | null,
): MeetingLike[] {
  if (!bound || bound.level !== "BODY") return [];
  return meetings.filter((m) => m.bodyId !== null && m.bodyId === bound.id);
}

/** A division id, mechanically un-slugged into the name of the government it identifies; never a guess at what it calls itself. */
function divisionNameOf(ocdId: string): string {
  const last = ocdId.split("/").pop() ?? "";
  const slug = last.split(":")[1] ?? "";
  return slug ? titleCaseName(slug.replace(/_/g, " ")) : ocdId;
}

/** What an officeholder has done, bounded to the window the reader asked for, with the denominator and the gap for what is not held. */
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

  /* The gaps below are derived from what the store holds, so they cannot go stale while the collection moves. */
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

    /* The letters are scans we cannot read, so this never says they are vetoes. */
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
  /* Pass every division through: `statewideExecutivesFor` derives the state itself, by prefix. */
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
    /* A switched-off engine answers with the same shape and a gap that says so, never an empty reply. */
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
  const ballotZip = typeof body.approximateLocation === "string" && /^\d{5}$/.test(body.approximateLocation) ? body.approximateLocation : undefined;
  const ocdIds = Array.isArray(body.ocdIds)
    ? body.ocdIds.filter((v): v is string => typeof v === "string").slice(0, 40)
    : [];

  // State-roll identity is established before any state pointer opens. Only
  // the state(s) named by the reader's divisions or exact source-namespaced
  // subject ids are eligible for this request; unrelated states are not
  // touched and therefore cannot suppress or delay the answer. A retired
  // STATE_ROLL_CALL scope (now per-legislator) is never opened:
  // its pointer is a stale version nothing writes.
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

  /* Wall-clock per stage; facts about our machinery only. */
  const stageMs: Record<string, number> = {};
  let stageMark = Date.now();
  const lap = (name: string) => { const now = Date.now(); stageMs[name] = now - stageMark; stageMark = now; };

  /*
   * Sources are read only when the question needs them. The registry and federal directory come from the
   * edge bundle when one exists, with the database as fallback. Each source owns its read state and failure
   * gap: a missing or invalid pointer fails that source closed without failing the request.
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
     unless it is a money question. Deferred the same way the sitting shapes are, on the same proof. */
  const noPersonRecordShapes = new Set([...sittingShapes, "BODY_ROSTER", "BODY_CIVICS", "GOVERNMENT_MONEY", "MEASURE_EXPLAIN", "CONTEST_FIELD"]);
  const deferShape = !topicRoute && !financeQuestionAsked(question) && noPersonRecordShapes.has(lexicalQuestionShape(question)?.shape ?? "");
  /* A question about a person's campaign money and nothing they did in office reads none of their votes, key votes,
     statements or actions (`moneyOnly` below), whoever the subject turns out to be: no proof is needed to leave them unread. */
  const deferPersonRecords = !topicRoute && !deferShape && asksOnlyMoney(question);
  const deferUnrelatedEvidence = deferShape || deferPersonRecords;
  const personRecordFamilies = ["federal-votes", "federal-key-votes", "officeholder-statements", "executive-actions"] as const;
  const unrelatedFamilies = new Set<AuthorityFamily>(deferShape ? ["pima-finance", ...personRecordFamilies] : personRecordFamilies);
  /* Every read inside the stage is timed under its own name; the preloads run in parallel, so theirs overlap rather than sum. */
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
   * The edge is entered in this function's own execution: `enterReaderAuthorityEdge` is
   * `AsyncLocalStorage.enterWith`, and a store entered inside a helper never reaches the reads chained on it.
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
    const ballot = await timed("ballot", () => loadBallotForDivisions(ocdIds, {}, ballotZip))();
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
  /* The deferrable sources, read edge first (`readPromotedEdgeFirst`) with the database as fallback. State roll calls stay on the database. */
  /* A state's roll calls are read by `answerPath` only for a person subject, right before the vote retrieval, and never left running after a response. */
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
  // succeeds is a second-attempt success, and the trace names it.
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
    /* The same meetings read the map uses, so Ask and the map never describe two versions of a body's calendar. */
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

  /* Bodies resolve through the canonical registry, so a reader binds to one government rather than a shared geography. */
  const explicitBodyIds = new Set([...readSubjectRefs(body.activeSubjects), ...readSubjectRefs(body.priorSubjects, 8)]
    .filter((ref) => ref.kind === "BODY").flatMap((ref) => ref.id ? [ref.id] : []));
  const governmentListings = await readerGovernmentListings(question, ocdIds, [...explicitBodyIds]).catch(() => ({ records: [], unavailableStates: [] }));
  const listedGovernments = governmentListings.records.map(governmentListingEntity);
  const scopedBodies = [...bodyIdentityIndex().values()].filter((entry) =>
    (entry.ocdId && ocdIds.includes(entry.ocdId)) || explicitBodyIds.has(entry.bodyId));
  const bodies = [...snapshotEntities([...meetings, ...scopedBodies], (bodyId) => canonicalBodyIdentity(bodyId)), ...listedGovernments];
  /*
   * A question that names a curated topic and binds its government lexically (the reader's own words, never
   * page context, a prior turn or a model expansion) is answered without the model. Anything else loads every
   * source and goes to the model.
   */
  let deterministicTopicRoute = false;
  /* A topic question naming no government, pronoun or earlier turn, with no body open, is answered from the timelines of the bodies governing the reader's divisions, with no model. */
  let areaTopicRoute = false;
  /* A class-phrase mention ("township") is never overridden by a model binding, so the named-body decision is lexical and skips the deferrable sources and the model. */
  const explicitBodyClass = Boolean(classPhraseIn(question) && mentionBeforeClassPhrase(question));
  const namedBodies = explicitBodyClass ? [...snapshotEntities([...bodyIdentityIndex().values()], canonicalBodyIdentity), ...listedGovernments] : bodies;
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
    // The reader's own words match several bodies (a township's
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
    const named = await namedOfficeholders(question, explicitIds, ocdIds);
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

  /* Loaded from the reader's divisions, not from what the client says is on screen; the same set `app/ballot/page.tsx` renders from. */
  // A topic question bound lexically to a body is not a ballot question; its
  // ballot is not read (loadBallotForDivisions([]) is the empty holding).
  const ballot = await loadBallotForDivisions(deterministicTopicRoute || areaTopicRoute || namedBodyTopicRoute || leanAsk ? [] : ocdIds, {}, ballotZip);
  const ballotLoadGaps: EvidenceGap[] = ballot.loaderFailures.length ? [{ whose: "OURS", statement: "We couldn't load the ballot for your area. Please try again in a moment." }] : [];
  const meetingLoadGaps: EvidenceGap[] = meetingDataState === "STORE_UNREACHABLE"
    ? [{ whose: "OURS", statement: `We couldn't load our meeting records. Please try again in a moment.` }]
    : meetingDataState === "BOOTSTRAP"
      ? [{ whose: "OURS", statement: "These meeting records came with the site and may be out of date. We have not loaded an updated calendar yet." }]
      : [];
  const holdingLoadGaps: EvidenceGap[] = [...ballotLoadGaps, ...meetingLoadGaps, ...(officeholders.loaderFailures ? [{ whose: "OURS" as const, statement: "We couldn't load our records of who represents you. Please try again in a moment." }] : [])];
  /* A money comparison names two people; each name slot is bound on its own as well as on the whole question. */
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

  /* One person held as both officeholder and candidate is one subject: the committed person/candidacy bridge supplies the aliases, never a matching display name. */
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
  /* A candidate held as a certified card and as a filing with a different party binds to the card; the answer carries both records and both parties, never one merged. */
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

  /* "What is on my ballot?" and "Who is running for state senate in my district?" are answered from the contests the reader's divisions reach, only when the composition can be made (`lib/ask/ballot-summary.ts`). */
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
  /* Start the answer from the code's own reading while the model reads (`lib/ask/speculative-reading.ts`); the model's reading still decides. `WTP_ASK_SPECULATION=off` turns it off. */
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
  /* A question in a canonical shape whose name binds one body identically in every binder is read in code (`lib/ask/lexical-reading.ts`); anything else goes to the model. */
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
   * Resolution, retrieval and composition for one reading of the question. It writes only to the trace it
   * is handed, and an answer that ends here comes back as a response to send, so a speculative run never
   * sends, captures or counts anything.
   */
  async function answerPath(interpretation: AskInterpretation, trace: AskTrace) {
    // A literal reader date outranks inferred tense, including a model's reading.
    if (requestedMeetingDate) {
      interpretation.temporal = { kind: "DATE", localDate: requestedMeetingDate.date };
      trace.interpretation.temporal = interpretation.temporal;
    }

    /* "Who is the mayor of <city>?" names the city its answer is filtered to; the city is not a subject to bind or to ask which of. */
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

    /* Two verdicts end the request before retrieval, and neither may fall through to the reader's own divisions. Both are still captured. */
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
       recorded actions are not retrieved. */
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
    const officeContactSubjects = new Set<string>();
    const addMemberOfficeContacts = async (seat: Parameters<typeof officeContactsForMember>[0]) => {
      if(officeContactSubjects.has(seat.id)) return;
      officeContactSubjects.add(seat.id);
      try { contacts.push(...await officeContactsForMember(seat)); }
      catch {
        denominators.officeContactLoaderFailures = (denominators.officeContactLoaderFailures ?? 0) + 1;
        gaps.push({whose:"OURS",statement:`We couldn’t load the office addresses for ${seat.name} just now.`});
      }
    };
    const canonicalSubjectKeys = new Set<string>(subject ? [subject.id] : []);
    /* A party-conflict card's filing: retrieved beside the card, its money kept under its own id. */
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

      /* A candidate who holds an office is both: the officeholder record travels with the ballot subject, and the action gap is named. */
      if (ballotRecord.kind === "PERSON") {
        for (const seat of candidateSeats) {
          records.push(officeholderEvidence(seat, `office:${seat.id}`));
          denominators.officeholderRecords = (denominators.officeholderRecords ?? 0) + 1;
          contacts.push(contactForOfficeholder(seat));
          await addMemberOfficeContacts(seat);
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
      /* The contacts for a ballot subject come from that subject's own division, not the reader's representatives. */
      /* The body name is the division, unslugged from its id, never the contest title. */
      /* A ballot subject is a contest, a candidate or a measure — it has an AREA
         and no body, so this is the DIVISION question and it asks the division
         resolver by name rather than borrowing the body one. */
      contacts.push(...contactsForDivision(ballotRecord.ocdId, divisionNameOf(ballotRecord.ocdId)));

      /*
       * A candidate with no published positions is a NAMED GAP, never silence.
       * Silence there reads as "they have said nothing", which is a claim about
       * a person made out of our own collection state.
       */

      /* Candidacy → officeholder uses the committed person relationship; officeholder → votes uses the publisher's stable key. An unresolved relationship produces an identity gap, never a name search. The office on every record is the one held. */
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
      const listing = governmentListings.records.find(row => row.id === subject.id);
      if (listing) {
        records.push(governmentListingEvidence(listing));
        denominators.governmentInventoryRecords = 1;
      }
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
      /* With no standing comment rule held, the answer says we have not recorded how, never that the body has not published it. */
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
        /* A body we hold no meeting of carries its code (held-gaps.ts), so the gap a reader is told is work the runner creates. */
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
        /* The sitting is printed in the body's own zone (`lib/ask/meeting-time.ts`). `bodyName` is included only when it differs from `title`. */
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

        /* Every sitting the body holds on the same local day is its own record, with its own id, agenda link and time. */
        /* The structured sittings travel beside the prose, so an answer can offer Add-to-calendar. */
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
        /* One reading of the sitting's held agenda for the whole answer: the records, the document count and the cited document. */
        const holdings = sittingAgendaHoldings(chosen, snapshot?.agendaDocuments ?? [], meetings);
        records.push(...holdings.records);
        denominators.agendaDocumentsForThatMeeting = (denominators.agendaDocumentsForThatMeeting ?? 0) + holdings.documents.length;

        /* Holding no agenda for a sitting is a fact about us (OURS). `lib/ask/agenda-publication.ts` produces THEIRS only from a fresh first-party observation of that exact sitting. */
        /* Only `actionable` crosses this boundary; it is null when publisher surfaces disagree, which falls back to the OURS gap. */
        const reconciledPublication = publicationObservationsFor(chosen.id);
        /* `observationFromMeetingRecord` reads a first-party calendar listing with no agenda link as the publisher's own state, bounded by the freshness window. */
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
          /* No document held for the sitting is the coded gap AGENDA_NOT_HELD, which raises the runner's matching obligation; THEIRS and an unreadable held document stay uncoded. */
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
          /* A document the same body reuses across sittings is a landing page, never one meeting's agenda. */
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

        /* An agenda is not an outcome: a decision question with no outcome record carries a named gap beside the agenda records (`lib/answerability/record-class.ts`). */
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

      /* Contacts describe a sourced relationship, never a ranking (`lib/ask/contacts.ts`). */
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
      /* The officeholder path holds who they are and little of what they have done, and says so; synthesis is given a pack, never the question alone. */
      const seat = officeholders.seats.find((s) => s.id === subject.id);
      if (seat) {
        records.push(officeholderEvidence(seat));
        denominators.officeholderRecords = 1;
        subject.office = seat.officeTitle;
        contacts.push(contactForOfficeholder(seat));
        await addMemberOfficeContacts(seat);
      }
      /* The denominator is stated so the answer can bound its own scope. */
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

      /* The same identity chain on the officeholder path: a sitting legislator reaches their roll calls; a governor reaches the gap. */
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
      const archived = await readPrlForSubject(subject.id, officeholders.seats.find(row => row.id === subject.id)).catch(() => null);
      if (archived) {
        records.push(...prlStatementEvidence(subject.id, archived, question, subject.name));
        denominators.archivedStatementsReturned = archived.statements.length;
      }
    }

    /*
     * Campaign money from the filings held (`lib/ask/local-finance.ts`): linkage is the filing officer's own
     * committee→office register row, never a name match; rows are date-ordered, never ranked or totalled; the
     * independent-expenditure class is always named as not held.
     */
    /* Every money question carries all three regime statements; one regime's absence never stands for all. */
    if (subject?.kind === "PERSON" && !moneyOnly) {
      const keyVotes = await keyVoteEvidenceFor(subject, [...canonicalSubjectKeys]);
      records.push(...keyVotes.records);
      gaps.push(...keyVotes.gaps);
      Object.assign(denominators, keyVotes.denominators);
    }

    /* A comparison retrieves both people's money: the one other held person the question names (exact id, never a context default) is stamped as theirs. */
    const federalMember = subject?.kind === "PERSON" ? [...canonicalSubjectKeys].find(id => /^congress:[A-Z]\d{6}$/.test(id)) ?? subject.id : null;
    const federal = await federalAskEvidence(federalMember, question);
    records.push(...federal.records.map(record => subject?.kind === "PERSON" ? { ...record, subjectId: subject.id } : record));
    gaps.push(...federal.gaps);
    Object.assign(denominators, federal.denominators);
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

    /* A race's candidates' money: every candidate the held ballot lists for the contest, by exact id (`lib/ask/money-answer.ts`). */
    const groupAsk = subject && (subject.kind === "CONTEST" || subject.kind === "BODY") && financeAsked
      ? groupMoneyShapeForBoundSubject(question, inventory, subject.id) : null;
    const groupCandidates: { id: string; name: string; matched: boolean }[] = [];
    let groupStateRecords = 0;
    let groupAbsence: EvidenceRecord | null = null;
    /* The one held contest: the bound contest, or the only contest the ballot holds in a bound body's own division for that
       body's own seats. Two or none is not one; the model reads it as before. */
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

    /* The reader's own officials (`lib/ask/reader-officials.ts`): each one named is a record beside the composed sentence. */
    const officials = officialsAsk && (!subject || officialsAsk.place) ? composeReaderOfficials({ ask: officialsAsk, held: officeholders.held, holdingFailed: officeholders.loaderFailures > 0, placesReached: new Set(ocdIds.filter((id) => /[/]place:[a-z_]+$/.test(id) && !id.endsWith("_ccd"))).size }) : null;
    if (officials) {
      await Promise.all(officials.named.map(({seat})=>addMemberOfficeContacts(seat)));
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

    /* The meetings held for the reader's area in the window they named (`lib/ask/area-meetings.ts`). */
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

    /* A ballot measure drops the reader-representative fallback (`lib/ask/relevance.ts`); gated before contacts become records so the pack and the panel agree. */
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

    /* The authority's own statements of absence, for the subject's division only; with no bound subject, every absence on the reader's ballot. */
    if (ballotRecord && ballotRecord.kind !== "PERSON") {
      /* A CONTEST or a MEASURE is a question about what is on the ballot, and an
         authority saying a race is not on it answers exactly that. A question
         about a PERSON is not a question about the ballot lineup, so an absence
         under it is a document the answer did not rest on. */
      records.push(...absencesForDivisions([ballotRecord.ocdId], absencesWithoutRemovals(ballot.absences, ballot.set?.removals ?? [])));
    } else if (surface === "BALLOT" && !subject) {
      records.push(...absencesForDivisions(ocdIds, absencesWithoutRemovals(ballot.absences, ballot.set?.removals ?? [])));
    }

    /* What an office does, from the held office definitions, only when nothing canonical was bound and `asksWhatAnOfficeDoes`. A stored record or nothing. */
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

    /* The topic sweep enters the one pack as `AGENDA_MENTION` records, scoped to the bound subject where there is one. */
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

    /* The relevance gate (`lib/ask/relevance.ts`) drops records not linked to the resolved subject before the pack is sealed. A null subject gates nothing. */
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

    /* One named gap is said once, even when two same-day sittings carry it. */
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

    /* The caller key is derived from this request, not the environment alone: a local production build also reports NODE_ENV=production. */
    /* A topic timeline is composed in code; the prose passes the same validator a model answer does. */
    const retrievedAt = Date.now();
    const topicComposed = topicTimeline
      ? composeTopicAnswer(topicTimeline, selectionNow)
      : areaTimelines.length > 0 ? composeAreaTopicAnswer(areaTimelines, selectionNow) : null;
    /* When a body sits is composed from the sitting (`lib/ask/sitting-answer.ts`); it must pass the same validator, and a refusal goes to the model. */
    const candidateSittingShape = !topicComposed && !topicFocus && snapshot && subject?.kind === "BODY"
      ? (lexical && sittingShapes.has(lexical.shape) && lexical.subjectId === subject.id ? lexical.shape as "MEETING_TIME" | "BODY_AGENDA" | "MEETING_OUTCOME" | "PUBLIC_COMMENT" : shapeForBoundBody(question, inventory, subject.id)) : null;
    // An explicit outcome date uses its quoted actions or its named outcome
    // gap. Tell the composer this is the requested date, never next/latest.
    const sittingShape = !requestedMeetingDate || (requestedMeetingDate.date && candidateSittingShape === "MEETING_OUTCOME")
      ? candidateSittingShape : null;
    /* "What did they decide" is read off the recorded actions: each quoted action phrase must pass the same validator on
       its own. */
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
    /* A person's campaign money is composed from their state committee records (`lib/ask/money-answer.ts`); the same validator decides and a refusal goes to the model. */
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
    /* A race's candidates, or a body whose race is not on the ballot: the same validator decides; a refusal goes to the model. */
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
  /* The fast writer answers first; the frontier model writes only when that answer fails the same validator (`synthesizeWithLadder`). */
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
      /* The resolved model and effort, read off the outcome that made the call rather than off the constants. */
      model: synthesis.model,
      servedModel: synthesis.servedModel ?? null,
      ...(synthesis.effort ? { effort: synthesis.effort } : {}),
      /* The whole ladder's time, every writer that ran, not only the last. */
      ms: cachedSynthesis ? 0 : written!.attempts.reduce((total, attempt) => total + attempt.ms, 0),
      /* Reused from byte-identical evidence on this instance: no model call was made. */
      ...(cachedSynthesis ? { cached: true } : {}),
      /* The cache numbers travel with the answer, per caller key. */
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
    /* The body inventory is the known-subject universe, so the substitution check refuses prose naming a different government we hold, and only that. */
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
      /* A rejected answer is discarded, not repaired: grounded → structured → honest gap. An answer rejected only for length falls back to composed prose (`lib/ask/length-fallback.ts`). */
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
    /* The failure detail (status code and error-type token) travels with the reason. */
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

  /* Written after the answer exists, so the row describes what the reader received. `captureAskInteraction` writes only when the request carries the returning-reader ID. */
  /* Only when no held record stood behind the answer and no composed or synthesised answer exists: a short general-knowledge answer that names its source. The mode stays NO_EVIDENCE, and a failure leaves the answer as it was. */
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

  /* Each coded gap the delivered answer states adds one to its body's count for that gap and day (`lib/ask/gap-observation.ts`). The plan is decided here; the write runs after the response and never reaches the reader. Synthetic runs count nothing. */
  const gapObservations = planAskGapObservations({
    stated: statedAskGaps({ gaps: packGaps, timelines: topicTimeline ? [topicTimeline] : areaTimelines }),
    runClass: markerFromRequest(request).runClass,
  });
  await afterResponse(() => recordAskGapObservations(gapObservations));

  /* `askAnswer` takes the pack, so the records the reader sees are the ones synthesis was given and the validator checked. */
  const payload: AskAnswerPayload = askAnswer({
    mode,
    pack,
    answer,
    contacts: shownContacts,
    /* In start order, de-duplicated by id: the chosen sitting first, then other sittings the body holds that local day. A client reads [0] as the meeting the answer is about. */
    meetings: resolvedSittings
      .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0)),
    trace,
  });
  payload.agendaLead = Boolean(agendaQuestion);
  payload.meetingListingIdentity = meetingListingKnowledgeFor(snapshot?.meetings ?? [], resolvedSittings.map(meeting => meeting.id)).readback;
  return Response.json(payload);
}

/** Wrapped so a capture failure never withholds an answer. */
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
      /* The coverage stamp is derived by `captureAskInteraction`, never put in the reader's tree. */
      continuityKey: input.continuityKey,
      runClass: marker.runClass,
      runId: marker.runId,
      occurredAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("ask signal capture failed", error);
  }
}
