import { readSnapshot } from "@/lib/meetings/snapshot";
import { agendaItems, type AgendaDocumentLike } from "@/lib/routing/agenda-search";
import { statewideExecutivesFor } from "@/lib/officials/statewide-executives";
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
import { unavailableInterpretation, type AskInterpretation } from "@/lib/ask/intent";
import { interpretQuestion, interpretWithoutModel } from "@/lib/ask/interpret";
import { resolveInterpretation } from "@/lib/ask/resolve";
import { readSubjectRefs, type AskSubjectRef } from "@/lib/ask/subject";
import { readableSitting } from "@/lib/ask/meeting-time";
import {
  contactRecord,
  contactsForBody,
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
import { synthesizeAnswer } from "@/lib/ask/synthesize";
import { selectSitting, type AgendaSelection } from "@/lib/ask/select";
import { emptyTrace, type AnswerMode, type AskTrace } from "@/lib/ask/trace";
import { validateAnswer } from "@/lib/ask/validate";
import { loadBallotForDivisions, readerRepresentatives } from "@/lib/ask/server-sources";

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
  ocdId: string | null;
  title: string;
  bodyName: string;
  startsAt: string;
  timeZone?: string | null;
  agendaUrl?: string | null;
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
    return Response.json({ mode: "OFF", why: "ripcord" }, { status: 200 });
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

  const bodies = snapshotEntities(meetings);
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
    return Response.json({
      mode: "CLARIFY" as AnswerMode,
      mention: resolution.binding.mention,
      candidates: resolution.binding.candidates.map((c) => titleCaseName(c.name)),
      trace,
    });
  }
  if (resolution.binding.kind === "UNRESOLVED") {
    trace.answerMode = "UNRESOLVED";
    trace.totalMs = Date.now() - started;
    await capture("UNRESOLVED", [], null, null, null, [], []);
    return Response.json({
      mode: "UNRESOLVED" as AnswerMode,
      mention: resolution.binding.mention,
      trace,
    });
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
        gaps.push({
          whose: "OURS",
          statement:
            "We have not recorded this official's actions in office — vetoes, bills signed or executive orders. We hold who they are, not yet what they have done.",
        });
        denominators.actionRecordsHeld = 0;
      }
    }
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
  } else if (subject?.kind === "BODY") {
    const forBody = meetings.filter((m) => m.ocdId === subject.id);
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
        text: `${subject.name}: ${label}, ${readableSitting(chosen)}.`,
        occurredAt: chosen.startsAt,
        sourceUrl: chosen.agendaUrl ?? null,
      });

      const forMeeting = documents.filter((d) => d.meetingId === chosen.id);
      denominators.agendaDocumentsForThatMeeting = forMeeting.length;
      const newest = [...forMeeting].sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1))[0];

      /*
       * A document the same body reuses across sittings is a LANDING PAGE by
       * construction — one page cannot be the agenda of two meetings. The
       * agenda route found 56 of 198 documents in this state, nine of them on
       * Vail's own portal root. Handing one to the synthesis rung as "this
       * meeting's agenda" would produce a confident summary of a navigation
       * menu.
       */
      const sharedWith = newest
        ? new Set(
            documents.filter((d) => d.documentUrl === newest.documentUrl).map((d) => d.meetingId),
          ).size
        : 0;
      const items = newest?.text ? agendaItems(newest.text) : [];

      if (forMeeting.length === 0) {
        gaps.push({
          whose: "THEIRS",
          statement: `No agenda has been published for that ${subject.name} meeting yet.`,
        });
      } else if (!newest?.text) {
        gaps.push({
          whose: "OURS",
          statement: `We hold an agenda document for that meeting but could not read its text.`,
        });
      } else if (sharedWith > 1 && items.length === 0) {
        gaps.push({
          whose: "OURS",
          statement: `The link we hold for that meeting is ${subject.name}'s agenda portal rather than the agenda itself.`,
        });
        records.push({
          kind: "AGENDA_DOCUMENT",
          id: newest.documentUrl,
          text: `An agenda portal page for ${subject.name}, not a single meeting's agenda.`,
          sourceUrl: newest.documentUrl,
          sourceOrg: newest.sourceOrg ?? null,
          retrievedAt: newest.retrievedAt,
        });
      } else if (items.length === 0) {
        gaps.push({
          whose: "OURS",
          statement: `We hold the agenda document for that meeting but could not extract its items.`,
        });
      } else {
        denominators.agendaItemsExtracted = items.length;
        for (const [index, item] of items.slice(0, 40).entries()) {
          records.push({
            kind: "AGENDA_ITEM",
            id: `${chosen.id}#${index}`,
            text: item,
            occurredAt: chosen.startsAt,
            sourceUrl: newest.documentUrl,
            sourceOrg: newest.sourceOrg ?? null,
            retrievedAt: newest.retrievedAt,
          });
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
    contacts.push(...contactsForBody(subject.id, subject.name));
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
    }
    /*
     * **THE DENOMINATOR IS STATED, so the answer can bound its own scope.**
     *
     * "Here are the actions in the records we currently hold" is a true
     * sentence. "Here is what she did" is not one this corpus can earn, and
     * the difference between them is a number the pack has to carry.
     */
    gaps.push({
      whose: "OURS",
      statement:
        "We have not recorded this official's actions in office — vetoes, bills signed or executive orders. We hold who they are, not yet what they have done.",
    });
    denominators.actionRecordsHeld = 0;
  }

  /*
   * The reader's own legislators, for any question that resolved. A relationship
   * the geometry established: their divisions reach this district. It is not an
   * address-verified constituency and the wording does not claim one.
   */
  if (subject) {
    contacts.push(...contactsForRepresentatives(readerRepresentatives(ocdIds)));
  }
  for (const contact of contacts.slice(0, MAX_ASK_CONTACTS)) {
    records.push(contactRecord(contact));
  }
  denominators.verifiedContacts = Math.min(contacts.length, MAX_ASK_CONTACTS);

  /*
   * The authority's own statements of absence for the reader's divisions — "no
   * Vail governing board race is on this ballot", in Pima County's words. These
   * are evidence, not error handling.
   */
  if (surface === "BALLOT" || ballotRecord) {
    records.push(...absencesForDivisions(ocdIds, ballot.absences));
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
  const synthesis = await synthesizeAnswer(pack, { allowCall });
  let answer: string | null = null;
  let answerModel: string | null = null;
  let validationPassed: boolean | null = null;
  let mode: AnswerMode = records.length > 0 ? "STRUCTURED_GROUNDED" : "NO_EVIDENCE";

  if (synthesis.kind === "WROTE") {
    trace.synthesis = { ran: true, model: synthesis.model, ms: synthesis.ms };
    const verdict = validateAnswer(synthesis.answer, synthesis.citedUrls, pack);
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

  return Response.json({
    mode,
    subject,
    answer,
    /* The records travel WHATEVER the mode, so a client that receives a
       rejected or unavailable synthesis still has everything it needs to
       render the true structured answer. Discarding a useful server reply
       because one optional field is null is the exact class PR #211 found
       repeatedly, and it is not reintroduced here. */
    records,
    gaps,
    contacts: contacts.slice(0, MAX_ASK_CONTACTS),
    denominators,
    trace,
  });
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
