import { readSnapshot } from "@/lib/meetings/snapshot";
import { agendaItems, type AgendaDocumentLike } from "@/lib/routing/agenda-search";
import { statewideExecutivesFor } from "@/lib/officials/statewide-executives";
import type { BindableEntity } from "@/lib/routing/named-entity";
import { ripcordPulled } from "@/lib/ripcords";
import { intakeLimits, isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";

import type { EvidenceGap, EvidencePack, EvidenceRecord, EvidenceSubject } from "@/lib/ask/evidence";
import { snapshotEntities, titleCaseName } from "@/lib/ask/inventory";
import { unavailableInterpretation, type AskInterpretation } from "@/lib/ask/intent";
import { interpretQuestion, interpretWithoutModel } from "@/lib/ask/interpret";
import { resolveInterpretation } from "@/lib/ask/resolve";
import { synthesizeAnswer } from "@/lib/ask/synthesize";
import { selectSitting, type AgendaSelection } from "@/lib/ask/select";
import { emptyTrace, type AnswerMode, type AskTrace } from "@/lib/ask/trace";
import { validateAnswer } from "@/lib/ask/validate";

/**
 * **POST /api/ask/grounded — the grounded civic answer (ASK01, 2026-08-27).**
 *
 * ```
 *   question
 *      ↓  Claude, given the entity inventory and today's date
 *   INTERPRETATION           intent · entity mentions · tense · referent
 *      ↓  the registry's own binder, unchanged
 *   CANONICAL RESOLUTION     BOUND · AMBIGUOUS · UNRESOLVED · NONE
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
 * ## What this route deliberately does NOT do
 *
 * **It stores nothing.** The signal record ASK03 designs is not written here
 * and `ripcord.askSignalCapture` ships pulled, because the data-privacy
 * policy requires honest disclosure at the box before a reader's typed
 * question may enter a store whose aggregates may reach campaigns. That copy
 * is NH246's and it is not approved. The path is built; it is not running.
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

const MAX_BODY_BYTES = 4096;
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
  const states = new Set<string>();
  for (const id of ocdIds) {
    const m = id.match(/^ocd-division\/country:us\/state:[a-z]{2}$/);
    if (m) states.add(id);
  }
  for (const seat of statewideExecutivesFor([...states])) {
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

  const bodies = snapshotEntities(meetings);
  const people = personEntities(ocdIds);
  const inventory = [...bodies, ...people];

  /*
   * Today is SUPPLIED, never derived from a model and never guessed. It is
   * read from the server's clock here because this is a server; what matters
   * is that neither model rung invents it, and both are told.
   */
  const today =
    typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);

  // ── 1. INTERPRETATION ────────────────────────────────────────────────
  let interpretation: AskInterpretation = unavailableInterpretation();
  const outcome = await interpretQuestion(
    question,
    {
      inventory: inventory.map((e) => ({ name: titleCaseName(e.name), divisionType: e.divisionType })),
      today,
      approximateLocation:
        typeof body.approximateLocation === "string" ? body.approximateLocation : null,
      surface:
        body.surface === "BALLOT" || body.surface === "MAP" ? body.surface : "UNKNOWN",
      priorTurns: Array.isArray(body.priorTurns)
        ? (body.priorTurns as { question: string; resolvedSubject: string | null }[]).slice(-4)
        : [],
      activeSubjects: Array.isArray(body.activeSubjects)
        ? (body.activeSubjects as string[]).slice(0, 6)
        : [],
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
  const resolution = resolveInterpretation(interpretation, question, inventory);
  trace.resolution = {
    state: resolution.binding.kind,
    basis: resolution.basis,
    subjectId: resolution.binding.kind === "BOUND" ? resolution.binding.entity.id : null,
    subjectName:
      resolution.binding.kind === "BOUND" ? titleCaseName(resolution.binding.entity.name) : null,
  };

  /*
   * Two verdicts end the request before any retrieval, and both are answers
   * rather than errors. Neither may fall through to the reader's own
   * divisions: that fall-through is exactly how a question about Vail was
   * answered with Sunnyside.
   */
  if (resolution.binding.kind === "AMBIGUOUS") {
    trace.answerMode = "CLARIFY";
    trace.totalMs = Date.now() - started;
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

  const subject: EvidenceSubject | null =
    resolution.binding.kind === "BOUND"
      ? {
          kind: resolution.binding.entity.divisionType === "person" ? "PERSON" : "BODY",
          id: resolution.binding.entity.id,
          name: titleCaseName(resolution.binding.entity.name),
        }
      : null;

  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};

  if (subject?.kind === "BODY") {
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
       * The body's OWN zone travels with the timestamp, never the reader's.
       * Letting a client default to local time prints an Arizona board meeting
       * in the reader's zone, which is a wrong fact in a small font — the same
       * reason the agenda route carries `timeZone` on its meeting object.
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
        text: `${subject.name}: ${label}, starting ${chosen.startsAt}${
          chosen.timeZone ? ` in time zone ${chosen.timeZone}` : ""
        }.`,
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
  } else if (subject?.kind === "PERSON") {
    /*
     * **THE PERSON PATH IS HONEST ABOUT BEING THIN, AND THAT IS THE POINT.**
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
    gaps.push({
      whose: "OURS",
      statement:
        "We have not recorded this official's actions in office — vetoes, bills signed or executive orders. We hold who they are, not yet what they have done.",
    });
    denominators.actionRecordsHeld = 0;
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
  let mode: AnswerMode = records.length > 0 ? "STRUCTURED_GROUNDED" : "NO_EVIDENCE";

  if (synthesis.kind === "WROTE") {
    trace.synthesis = { ran: true, model: synthesis.model, ms: synthesis.ms };
    const verdict = validateAnswer(synthesis.answer, synthesis.citedUrls, pack);
    trace.validation = {
      ran: true,
      passed: verdict.kind === "PASSED",
      checked: verdict.checked,
      failed: verdict.kind === "FAILED" ? verdict.failed : undefined,
    };
    if (verdict.kind === "PASSED") {
      answer = synthesis.answer;
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
    denominators,
    trace,
  });
}
