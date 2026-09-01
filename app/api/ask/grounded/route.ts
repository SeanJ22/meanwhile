import { readSnapshot } from "@/lib/meetings/snapshot";
import type { Meeting } from "@/lib/sources/types";
import type { AskSitting } from "@/lib/ask/answer";
import { type AgendaDocumentLike } from "@/lib/routing/agenda-search";
import { statewideExecutivesFor } from "@/lib/officials/statewide-executives";
import {
  actionsFor,
  actionText,
  executiveActionStore,
  monthsBefore,
  undatedFor,
} from "@/lib/officials/executive-actions";
import type { BindableEntity } from "@/lib/routing/named-entity";
import { ripcordPulled } from "@/lib/ripcords";
import { intakeLimits, isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";
import { markerFromRequest } from "@/lib/db/run-marker";
import { DIVISION_VINTAGE } from "@/lib/db/search-log";

import {
  evidenceProvenance,
  type EvidenceGap,
  type EvidencePack,
  type EvidenceRecord,
  type EvidenceSubject,
} from "@/lib/ask/evidence";
import { snapshotEntities, titleCaseName } from "@/lib/ask/inventory";
import { canonicalBodyIdentity } from "@/lib/ask/body-identity";
import { outcomeGapStatement, outcomeQuestionClass } from "@/lib/ask/outcome-question";
import { ruleOnQuestion } from "@/lib/answerability/record-class";
import { unavailableInterpretation, type AskInterpretation } from "@/lib/ask/intent";
import { asksWhatAnOfficeDoes, officeInQuestion } from "@/lib/ask/office-question";
import { interpretQuestion, interpretWithoutModel } from "@/lib/ask/interpret";
import { resolveInterpretation } from "@/lib/ask/resolve";
import { readSubjectRefs, type AskSubjectRef } from "@/lib/ask/subject";
import { readableSitting } from "@/lib/ask/meeting-time";
import {
  contactForOfficeholder,
  contactRecord,
  contactsForBody,
  contactsForDivision,
  contactsForRepresentatives,
  MAX_ASK_CONTACTS,
  type AskContact,
} from "@/lib/ask/contacts";
import {
  absencesForDivisions,
  ballotAskInventory,
  ballotRecordsFor,
  ballotSubject,
  type BallotSubjectRecord,
} from "@/lib/ask/ballot-inventory";
import { readLocationOrigin, stampResidency } from "@/lib/ask/residency";
import { captureAskInteraction } from "@/lib/db/ask-signal";
import { askCallerKey, cacheCallLine } from "@/lib/ask/prompt-cache";
import { synthesizeAnswer } from "@/lib/ask/synthesize";
import { sittingsOnSameLocalDay, selectSitting, type AgendaSelection } from "@/lib/ask/select";
import {
  classifyAgendaPublication,
  publisherAgendaObservationsFor,
  observationFromMeetingRecord,
} from "@/lib/ask/agenda-publication";
import {
  outcomeEvidenceFor,
  outcomeGapWhose,
  publicationObservationsFor,
  sittingsForBody,
} from "@/lib/outcomes/store";
import { emptyTrace, type AnswerMode, type AskTrace } from "@/lib/ask/trace";
import { validateAnswer } from "@/lib/ask/validate";
import { loadBallotForDivisions, readerRepresentatives } from "@/lib/ask/server-sources";
import {
  askAnswer,
  clarifyAnswer,
  offAnswer,
  unresolvedAnswer,
  type AskAnswerPayload,
} from "@/lib/ask/answer";
import { agendaTopicEvidence } from "@/lib/ask/agenda-topic";
import {
  financeQuestionAsked,
  financeRegimeNotesFor,
  financeScopeGapFor,
  localFinanceEvidenceFor,
} from "@/lib/ask/local-finance";
import { statesOf, voteEvidenceFor } from "@/lib/ask/votes";

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
 * **It writes nothing today.** `captureAskInteraction` is called at the end,
 * with the delivered answer, and `ripcord.askSignalCapture` ships PULLED so the
 * call returns `GATED` and no row exists. The gate is an operator decision
 * pending the author's approval of reader-facing disclosure copy (NH246) — see
 * `lib/db/ask-signal.ts`, which states that basis honestly rather than citing a
 * rule that governs a different store.
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

const MAX_BODY_BYTES = 16384;
const MAX_QUESTION_CHARS = 400;
/** Bounds spend per instance per day, the same shape the classifier uses. */
const DAILY_MAX = 400;

let ipLimiter: SlidingWindowLimiter | null = null;
function getIpLimiter() {
  ipLimiter ??= new SlidingWindowLimiter(intakeLimits().logEventsPerIpPerMinute, 60_000);
  return ipLimiter;
}

let spentOn = "";
let spent = 0;
function ceiling(): number {
  const raw = Number(process.env.WTP_ASK_GROUNDED_DAILY_MAX);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DAILY_MAX;
}
function allowCall(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (spentOn !== day) {
    spentOn = day;
    spent = 0;
  }
  if (spent >= ceiling()) return false;
  spent += 1;
  return true;
}
/** Test seam — the suite must never inherit another test's counter. */
export function resetGroundedState(): void {
  spentOn = "";
  spent = 0;
}

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
      statement: `We have not recorded any actions in office for ${personName}.`,
    });
    denominators.actionRecordsHeld = 0;
    return;
  }

  const from = trailingMonths ? monthsBefore(today, trailingMonths) : null;
  const windowed = actionsFor(seatId, { from, to: today });
  const held = actionsFor(seatId);

  denominators.actionRecordsHeld = held.length;
  denominators.actionRecordsInAskedWindow = windowed.length;
  denominators.executiveOrdersIndexedAtCollection = store.denominator.indexedAcrossPagesWalked;
  denominators.executiveOrdersReadAtCollection = store.denominator.detailPagesRead;

  for (const action of windowed.slice(0, 25)) {
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
function personEntities(ocdIds: readonly string[]): BindableEntity[] {
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
  for (const seat of statewideExecutivesFor([...new Set(ocdIds)])) {
    if (!seat.name) continue;
    out.push({
      id: `person:${seat.name.toLowerCase().replace(/\s+/g, "_")}`,
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

  const snapshot = readSnapshot();
  if (!snapshot) {
    /* No corpus is a STATE and is reported as one, never as "nothing found" —
       the same absence-as-assertion rule the agenda route follows. */
    return Response.json(
      { error: "the meetings corpus is not available right now" },
      { status: 503 },
    );
  }

  const meetings = snapshot.meetings as MeetingLike[];
  const documents = (snapshot.agendaDocuments ?? []) as AgendaDocumentLike[];
  const ocdIds = Array.isArray(body.ocdIds)
    ? body.ocdIds.filter((v): v is string => typeof v === "string").slice(0, 40)
    : [];
  const surface: "MAP" | "BALLOT" | "UNKNOWN" =
    body.surface === "BALLOT" || body.surface === "MAP" ? body.surface : "UNKNOWN";

  /*
   * Bodies resolve through the CANONICAL REGISTRY, so what a reader binds to is
   * one government rather than a geography several of them share. See
   * `lib/ask/inventory.ts` for the defect this closes.
   */
  const bodies = snapshotEntities(meetings, (bodyId) => canonicalBodyIdentity(bodyId));
  const people = personEntities(ocdIds);

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
  const ballot = await loadBallotForDivisions(ocdIds);
  const ballotInventory = ballotAskInventory(ballot.set, ballot.contests, ballot.nominees);

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
   * The ballot row wins, because it is the one whose id retrieves — a filing,
   * a party, sourced positions — and because the officeholder record is
   * attached to it below by the same name match. The match is EXACT on the
   * normalized name within one state's inventory, which is the conservative
   * form: two different people of the same name holding and seeking office in
   * one state is possible and vanishingly rare, and the cost of not merging is
   * a clarification on every question about a sitting officeholder who is
   * running again.
   */
  const ballotPersonNames = new Set(
    [...ballotInventory.subjects.values()]
      .filter((s) => s.kind === "PERSON")
      .map((s) => s.name.trim().toLowerCase()),
  );
  const inventory = [
    ...bodies,
    ...people.filter((p) => !ballotPersonNames.has(p.name.trim().toLowerCase())),
    ...ballotInventory.entities,
  ];

  /*
   * Today is SUPPLIED, never derived from a model and never guessed. It is
   * read from the server's clock here because this is a server; what matters
   * is that neither model rung invents it, and both are told.
   */
  const today =
    typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);

  /*
   * What the reader has in front of them, as REFERENCES rather than display
   * strings — canonical ids where the surface holds them, so a pronoun can
   * resolve to a person the binder actually verified. See `lib/ask/subject.ts`.
   */
  const activeSubjects: AskSubjectRef[] = readSubjectRefs(body.activeSubjects);
  const priorSubjects: AskSubjectRef[] = readSubjectRefs(body.priorSubjects, 8);

  // ── 1. INTERPRETATION ────────────────────────────────────────────────
  let interpretation: AskInterpretation = unavailableInterpretation();
  const outcome = await interpretQuestion(
    question,
    {
      inventory: inventory.map((e) => ({ name: titleCaseName(e.name), divisionType: e.divisionType })),
      today,
      approximateLocation:
        typeof body.approximateLocation === "string" ? body.approximateLocation : null,
      surface,
      priorTurns: Array.isArray(body.priorTurns)
        ? (body.priorTurns as { question: string; resolvedSubject: string | null }[]).slice(-4)
        : [],
      activeSubjects: activeSubjects.map((s) => s.name).slice(0, 6),
    },
    { allowCall },
  );

  if (outcome.kind === "READ") {
    interpretation = outcome.interpretation;
    trace.interpretation = {
      ran: true,
      model: outcome.model,
      ms: outcome.ms,
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

  // ── 2. CANONICAL RESOLUTION ──────────────────────────────────────────
  const resolution = resolveInterpretation(interpretation, question, inventory, {
    activeSubjects,
    priorSubjects,
  });
  trace.resolution = {
    state: resolution.binding.kind,
    basis: resolution.basis,
    subjectId: resolution.binding.kind === "BOUND" ? resolution.binding.entity.id : null,
    subjectName:
      resolution.binding.kind === "BOUND" ? titleCaseName(resolution.binding.entity.name) : null,
  };

  const residency = stampResidency(readLocationOrigin(body.locationOrigin));
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
    trace.answerMode = "CLARIFY";
    trace.totalMs = Date.now() - started;
    await capture(
      "CLARIFY",
      resolution.binding.candidates.map((c) => c.id),
      null,
      null,
      null,
      [],
      [],
    );
    return Response.json(
      clarifyAnswer(
        resolution.binding.mention,
        resolution.binding.candidates.map((c) => titleCaseName(c.name)),
        trace,
      ),
    );
  }
  if (resolution.binding.kind === "UNRESOLVED") {
    trace.answerMode = "UNRESOLVED";
    trace.totalMs = Date.now() - started;
    await capture("UNRESOLVED", [], null, null, null, [], []);
    return Response.json(unresolvedAnswer(resolution.binding.mention, trace));
  }

  // ── 3. DETERMINISTIC RETRIEVAL ───────────────────────────────────────
  const selection: AgendaSelection =
    interpretation.temporal.kind === "LAST"
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
  /** The sittings this request resolved, for the structured half of the payload. */
  const resolvedSittings: AskSitting[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};
  const contacts: AskContact[] = [];

  if (ballotRecord && ballot.set) {
    /* ── A BALLOT SUBJECT ── contest, candidate or measure, selected by its
       canonical id and nothing else. */
    const retrieved = ballotRecordsFor(ballotRecord, {
      set: ballot.set,
      contests: ballot.contests,
      absences: ballot.absences,
      positions: ballot.positions,
      measureSummary: ballot.measureSummary,
      measureProvisions: ballot.measureProvisions,
      nominees: ballot.nominees,
    });
    records.push(...retrieved.records);
    Object.assign(denominators, retrieved.denominators);

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
      const seat = statewideExecutivesFor([...new Set(ocdIds)]).find(
        (s) => s.name.trim().toLowerCase() === ballotRecord.name.trim().toLowerCase(),
      );
      if (seat) {
        records.push({
          kind: "OFFICEHOLDER",
          id: `office:${seat.id}`,
          text: `${seat.name} holds the office of ${seat.officeTitle}${
            seat.partyLabel ? `, ${seat.partyLabel}` : ""
          }${seat.termEnd ? `, in seat until ${seat.termEnd}` : ""}.`,
          sourceUrl: seat.sourceUrl,
          sourceOrg: seat.provenance?.sourceOrg ?? null,
          retrievedAt: seat.provenance?.collectedAt ?? null,
        });
        denominators.officeholderRecords = 1;
        /* The office the question is ABOUT — the most relevant contact there
           is, and the one an answer about the Governor was missing while it
           listed the reader's state senator. */
        contacts.push(contactForOfficeholder(seat));
        officeholderActionEvidence(
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
    if (ballotRecord.kind === "PERSON" && (denominators.sourcedPositionPassages ?? 0) === 0) {
      gaps.push({
        whose: "OURS",
        statement: `We have not recorded any sourced statement of ${ballotRecord.name}'s positions.`,
      });
    }

    /*
     * ── ASK-06 ── **HOW THEY HAVE ACTUALLY VOTED.** (2026-08-28.)
     *
     * A candidate's positions are what they SAID. A roll call is what they
     * DID, and this product held 12,234 recorded positions that the grounded
     * engine could not reach.
     *
     * Reached through EXACT identity and nothing looser: person → seat by
     * exact normalized full name, unique within the reader's own states; seat
     * → votes by the publisher's own stable officeholder id. Where the name
     * form differs across the join — *Sally Ann Gonzales* on a House ballot
     * line against *Sally Gonzales* the sitting SENATOR — it fails closed to a
     * named gap rather than attaching one chamber's votes to another
     * chamber's candidacy. `lib/ask/votes.ts` holds the whole rule and the
     * measured cost of it.
     *
     * The office on every record is the one they HOLD, never the one they are
     * running for.
     */
    if (ballotRecord.kind === "PERSON") {
      const votes = voteEvidenceFor(ballotRecord.name, { withinStates: statesOf(ocdIds) });
      records.push(...votes.records);
      gaps.push(...votes.gaps);
      Object.assign(denominators, votes.denominators);
    }
  } else if (subject?.kind === "BODY") {
    const forBody = meetingsForBody(meetings, bound);
    denominators.meetingsHeldForThisBody = forBody.length;
    /* The SAME selection the deterministic agenda route uses — one rule, two
       callers, so the two surfaces can never disagree about which meeting a
       tensed question meant. */
    const chosen = selectSitting(selection, forBody, Date.now());

    if (!chosen) {
      gaps.push({
        whose: "OURS",
        statement:
          forBody.length === 0
            ? `We have not recorded any meetings for ${subject.name} yet.`
            : selection === "LAST"
              ? `We hold meetings for ${subject.name} but none that have already happened.`
              : `We hold meetings for ${subject.name} but none scheduled in the future.`,
      });
    } else {
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
      records.push({
        kind: "MEETING",
        id: chosen.id,
        /* The meeting's OWN body, carried from the corpus rather than assumed
           from the subject — so the validator is checking the record against
           the subject rather than checking the subject against itself. */
        bodyId: chosen.bodyId,
        text: `${subject.name}: ${label}, ${readableSitting(chosen)}.`,
        occurredAt: chosen.startsAt,
        sourceUrl: chosen.agendaUrl ?? null,
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
      const sameDay = sittingsOnSameLocalDay(chosen, forBody).filter((m) => m.id !== chosen.id);
      denominators.sittingsThatLocalDay = sameDay.length + 1;
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
            `${subject.name}: ${siblingLabel}, ${readableSitting(sibling)} — the same day as ` +
            `the ${label}.`,
          occurredAt: sibling.startsAt,
          sourceUrl: sibling.agendaUrl ?? null,
        });
      }

      const forMeeting = documents.filter((d) => d.meetingId === chosen.id);
      denominators.agendaDocumentsForThatMeeting = forMeeting.length;

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
        discoveredDocumentUrl: chosen.agendaUrl ?? null,
        observations: publisherObservations,
        now: Date.now(),
      });
      denominators.publisherPublicationObservationsForThatMeeting =
        publisherObservations.length;
      if (publication.gap) gaps.push(publication.gap);

      const newest = [...forMeeting].sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1))[0];
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
          text: `An agenda portal page for ${subject.name}, not a single meeting's agenda.`,
          sourceUrl: newest.documentUrl,
          sourceOrg: newest.sourceOrg ?? null,
          retrievedAt: newest.retrievedAt,
        });
      } else if (publication.acquisition === "ITEMS_READER_READY" && newest) {
        denominators.agendaItemsExtracted = items.length;
        for (const [index, item] of items.slice(0, 40).entries()) {
          records.push({
            kind: "AGENDA_ITEM",
            id: `${chosen.id}#${index}`,
            /* Read out of THAT meeting's document, so it carries THAT meeting's
               body. The chain is BODY -> MEETING -> DOCUMENT -> ITEM and every
               link is an id, not an inference from a heading. */
            bodyId: chosen.bodyId,
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
      const outcomeClass = outcomeQuestionClass(question);
      if (outcomeClass) {
        /*
         * **THE OUTCOME RECORDS, WHICH USED TO EXIST ONLY IN A PROBE SCRIPT.**
         * (2026-08-29.)
         *
         * The measurement that motivated this: 20 Pima Board sittings carry
         * 1,360 agenda items, 525 recorded actions and 2,083 per-person vote
         * rows on the publisher's own API — and the reader could answer an
         * outcome question about ZERO of 30 held sittings, because the harvest
         * lived in a side script and never reached an evidence pack.
         *
         * `outcomeEvidenceFor` is the durable store's contract. It class-filters
         * before it returns, so an AGENDA record is structurally unable to reach
         * a `WHAT_WAS_DECIDED` answer, and what it refused comes back NAMED
         * rather than dropped — which is what lets the answer say "we hold 135
         * agenda records and no outcome record" instead of quietly answering
         * from the agendas.
         */
        const evidence = outcomeEvidenceFor({
          bodyId: subject.id,
          meetingId: chosen.id,
          questionClass: outcomeClass,
        });
        denominators.outcomeRecordsForThatMeeting = evidence.records.length;
        denominators.outcomeRecordClassesRefused = evidence.refused.length;
        denominators.personVotesHeldForThatMeeting = evidence.records.reduce(
          (n, r) => n + (r.recordClass === "ROLL_CALL" ? r.votes.length : 0),
          0,
        );

        /*
         * **WHAT THE ITEM WAS, carried onto every vote row.**
         *
         * A per-member row reading "Rex Scott voted Aye." says who and how and
         * never WHAT. Measured on production 2026-08-29: a sitting produces 285
         * of them, they outnumbered every other record in the pack better than
         * eight to one, and the synthesis rung wrote prose about the votes that
         * never named the body — so `validateAnswer` refused it on
         * `answer-does-not-name-resolved-subject` and the reader got the records
         * with no prose at all. The evidence was right and unusable.
         */
        const itemTitleFor = new Map<number, string>();
        for (const rec of evidence.records) {
          if (rec.recordClass === "AGENDA") itemTitleFor.set(rec.eventItemId, rec.title);
        }
        if (itemTitleFor.size === 0) {
          /*
           * For HOW_DID_THEY_VOTE the class filter returns ROLL_CALL and
           * nothing else - correctly, since an agenda may not answer it - so
           * the titles are not in the evidence and are read off the sitting
           * itself. They are used ONLY to say what a vote was cast on; no
           * agenda record enters the pack for this question class, which is
           * what the filter is protecting.
           */
          const sitting = sittingsForBody(subject.id).find((x) => x.meetingId === chosen.id);
          for (const rec of sitting?.agenda ?? []) itemTitleFor.set(rec.eventItemId, rec.title);
        }
        /*
         * **WHICH SIXTY, AND WHAT BECOMES OF THE REST.** (2026-08-30.)
         *
         * The bound itself is honest — a pack is what the synthesis rung can
         * read, and the denominators report the truncation. What the first
         * version got wrong is WHICH rows spent the budget: a bare first-N in
         * store order, so the answer's substance was shaped by an accident of
         * ingestion sequence. A hard cap that silently decides which votes a
         * reader hears about is still an editorial choice; this makes it an
         * explainable one:
         *
         *   1. An item the QUESTION itself names goes first. Matching is
         *      deliberately conservative — at least two distinct question
         *      tokens of five or more characters found in the item's title —
         *      because a false match would spend the whole budget answering a
         *      question the reader did not ask.
         *   2. DIVIDED roll calls next. A 3-2 is the vote a reader asking
         *      "how did they vote" most needs the members' own rows for; a
         *      unanimous roll is faithfully summarized by its action record.
         *      Division is more than one distinct recorded value — a
         *      selection heuristic over held rows, never a claim in the pack.
         *   3. Store order last, as the stable tail.
         *
         * And WHOLE ITEMS ONLY: a roll call either brings every valid member
         * row or waits. Three members of a five-member roll reads as an
         * absence for the other two, which is a manufactured claim about
         * people who voted. An item that no longer fits is skipped and a
         * later, smaller one may still be taken — coverage, not prefix.
         *
         * One record PER MEMBER, unchanged: a single record listing five
         * names is one claim the validator cannot check a name against. The
         * items-level split is REPORTED in the denominators beside the
         * row-level one, so "60 of 285 rows, 12 of 57 items" is a sentence
         * the synthesis rung can actually write.
         */
        const VOTE_ROWS_MAX = 60;
        let voteRows = 0;

        const rollCalls = evidence.records.filter(
          (r): r is Extract<typeof evidence.records[number], { recordClass: "ROLL_CALL" }> =>
            r.recordClass === "ROLL_CALL",
        );
        const questionTokens = [
          ...new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 5)),
        ];
        const namedByQuestion = (eventItemId: number): boolean => {
          const title = (itemTitleFor.get(eventItemId) ?? "").toLowerCase();
          if (!title) return false;
          return questionTokens.filter((t) => title.includes(t)).length >= 2;
        };
        const ranked = rollCalls
          .map((rec, index) => {
            const votes = rec.votes.filter((v) => v.personName && v.value);
            return {
              rec,
              index,
              votes,
              named: namedByQuestion(rec.eventItemId),
              divided: new Set(votes.map((v) => v.value)).size > 1,
            };
          })
          .filter((r) => r.votes.length > 0)
          .sort(
            (a, b) =>
              Number(b.named) - Number(a.named) ||
              Number(b.divided) - Number(a.divided) ||
              a.index - b.index,
          );

        let rollCallItemsInPack = 0;
        for (const { rec, votes } of ranked) {
          if (voteRows + votes.length > VOTE_ROWS_MAX) continue;
          rollCallItemsInPack += 1;
          for (const vote of votes) {
            voteRows += 1;
            const on = itemTitleFor.get(rec.eventItemId);
            records.push({
              kind: "MEETING_MEMBER_VOTE",
              id: `${rec.eventItemId}#${vote.personId ?? vote.personName}`,
              bodyId: chosen.bodyId,
              text: on
                ? `On "${on}", ${vote.personName} voted ${vote.value}.`
                : `${vote.personName} voted ${vote.value}.`,
              occurredAt: chosen.startsAt,
              sourceUrl: rec.provenance.endpoint,
              sourceOrg: rec.provenance.sourceOrg,
            });
          }
        }
        denominators.rollCallItemsHeldForThatMeeting = rollCalls.length;
        denominators.rollCallItemsInPack = rollCallItemsInPack;

        for (const rec of evidence.records) {
          if (rec.recordClass === "ACTION_SUMMARY") {
            /*
             * `tallyText` is the clerk's prose and travels VERBATIM as their
             * sentence. It is never split into members — that join is the one
             * step between a real record and five fabricated positions.
             */
            const parts = [
              rec.action ? `The board's recorded action was "${rec.action}".` : null,
              rec.mover ? `Moved by ${rec.mover}${rec.seconder ? `, seconded by ${rec.seconder}` : ""}.` : null,
              rec.tallyText ? `The clerk recorded: "${rec.tallyText}"` : null,
              rec.rollCall === "OUTCOME_WITHOUT_ROLL_CALL"
                ? "No per-member roll call was published for this item."
                : null,
            ].filter(Boolean);
            records.push({
              kind: "MEETING_ACTION",
              id: `${rec.eventItemId}#action`,
              bodyId: chosen.bodyId,
              text: `${rec.matterFile ? `${rec.matterFile}: ` : ""}${parts.join(" ")}`,
              occurredAt: chosen.startsAt,
              sourceUrl: rec.provenance.endpoint,
              sourceOrg: rec.provenance.sourceOrg,
            });
          }
        }

        /*
         * The gap. `evidence.gap` is null only on HELD, and its `whose` is
         * derived from the STATE rather than asserted here: `NO_ACTION_RECORDED`
         * and `ACTION_WITHOUT_ROLL_CALL` are facts about a government that we
         * measured from their records; `NOT_YET_INGESTED` and
         * `EXTRACTION_FAILED` are ours. The older sentence stays as the fallback
         * for a body the outcome store holds nothing for at all.
         */
        denominators.personVoteRowsInPack = voteRows;

        if (evidence.gap) {
          gaps.push({ whose: outcomeGapWhose(evidence.state), statement: evidence.gap });
        } else if (!evidence.answerable) {
          const heldClasses = records.some(
            (r) => r.kind === "AGENDA_ITEM" || r.kind === "AGENDA_DOCUMENT",
          )
            ? ["AGENDA"]
            : [];
          const ruling = ruleOnQuestion(outcomeClass, heldClasses);
          denominators.outcomeRecordsHeld = ruling.satisfiedBy.length;
          if (!ruling.answerable) {
            gaps.push({
              whose: "OURS",
              statement: outcomeGapStatement(subject.name, outcomeClass, heldClasses.length > 0),
            });
          }
        }
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
    const seat = statewideExecutivesFor([...new Set(ocdIds)]).find(
      (s) => s.name.toLowerCase() === subject.name.toLowerCase(),
    );
    if (seat) {
      records.push({
        kind: "OFFICEHOLDER",
        id: subject.id,
        /* Identity is person AND office, never either alone — the exact-office
           rule PR #211 landed. A record naming only the person would let a
           later sentence attach an action to the wrong seat. */
        text: `${seat.name} holds the office of ${seat.officeTitle}${
          seat.partyLabel ? `, ${seat.partyLabel}` : ""
        }${seat.termEnd ? `, in seat until ${seat.termEnd}` : ""}.`,
        sourceUrl: seat.sourceUrl,
        sourceOrg: seat.provenance?.sourceOrg ?? null,
        retrievedAt: seat.provenance?.collectedAt ?? null,
      });
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
    if (seat) {
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
    const votes = voteEvidenceFor(subject.name, { withinStates: statesOf(ocdIds) });
    records.push(...votes.records);
    gaps.push(...votes.gaps);
    Object.assign(denominators, votes.denominators);
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
  if (subject && financeQuestionAsked(question)) {
    const finance = localFinanceEvidenceFor(subject);
    if (finance) {
      records.push(...finance.records);
      gaps.push(...finance.gaps);
      Object.assign(denominators, finance.denominators);
    } else {
      gaps.push(financeScopeGapFor(subject));
    }
    // Every regime, on every money answer, whether or not records were found.
    for (const note of financeRegimeNotesFor(subject)) gaps.push(note.gap);
    denominators.financeRegimesNamed = 3;
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
  for (const contact of contacts.slice(0, MAX_ASK_CONTACTS)) {
    records.push(contactRecord(contact));
  }
  denominators.verifiedContacts = Math.min(contacts.length, MAX_ASK_CONTACTS);

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
    records.push(...absencesForDivisions([ballotRecord.ocdId], ballot.absences));
  } else if (surface === "BALLOT" && !subject) {
    records.push(...absencesForDivisions(ocdIds, ballot.absences));
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
  if (sweep.topic) {
    records.push(...sweep.records);
    gaps.push(...sweep.gaps);
    Object.assign(denominators, sweep.denominators);
    /* The intent vocabulary now names this question, so the trace can say the
       sweep ran rather than leaving an operator to infer it from a count. */
    if (interpretation.intent === "UNKNOWN") interpretation.intent = "AGENDA_TOPIC";
  }

  const pack: EvidencePack = {
    question,
    intent: interpretation.intent,
    temporal: interpretation.temporal,
    subject,
    records,
    gaps,
    denominators,
    today,
  };

  trace.retrieval = {
    selection,
    recordCount: records.length,
    sourceCount: new Set(records.map((r) => r.sourceUrl).filter(Boolean)).size,
    gapCount: gaps.length,
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
  const synthesis = await synthesizeAnswer(pack, {
    allowCall,
    callerKey: askCallerKey(process.env, markerFromRequest(request).runClass),
  });
  let answer: string | null = null;
  let answerModel: string | null = null;
  let validationPassed: boolean | null = null;
  let mode: AnswerMode = records.length > 0 ? "STRUCTURED_GROUNDED" : "NO_EVIDENCE";

  if (synthesis.kind === "WROTE") {
    trace.synthesis = {
      ran: true,
      model: synthesis.model,
      ms: synthesis.ms,
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
    };
    /* And into the server console, so a collapsed hit rate is visible in the
       deployment log rather than only in a trace somebody has to go and read.
       Caller key and token counts only — no reader fact reaches this line. */
    console.log(cacheCallLine(synthesis.callerKey, synthesis.usage));
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
       */
      mode = "REJECTED_FELL_BACK";
    }
  } else {
    trace.synthesis = { ran: false, why: synthesis.why, ms: synthesis.ms };
  }

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
   * It ships gated. `captureAskInteraction` checks `ripcord.askSignalCapture`
   * itself, returns GATED, and builds no row at all.
   */
  await capture(mode, subject ? [subject.id] : [], answer, answerModel, validationPassed, records, gaps);

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
    contacts: contacts.slice(0, MAX_ASK_CONTACTS),
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
