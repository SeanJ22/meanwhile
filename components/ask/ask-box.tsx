"use client";

import { AskBodyConfirmation } from "./body-confirmation";
import type { BodyConfirmation } from "@/lib/ask/body-confirmation";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";
import { telHref } from "@/lib/officials/phone-numbers";
import { AskAnswerRecords } from "./answer-records";
import { AskAnswerContacts } from "./answer-contacts";

import {
  answerQuestion,
  askWasAnswered,
  showGroundedAnswer,
  REFUSAL_LOG_MAX_CHARS,
  type AskAnswer,
} from "@/lib/routing/ask";
import { buildDigest, type Digest } from "@/lib/routing/digest";
import { ROUTABLE_CATEGORIES } from "@/lib/routing/destinations";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import type { NameableEntity } from "@/lib/routing/exact-name";
import { ASK_BEAT_POOL, beatStem, drawAskBeat } from "@/lib/routing/ask-beat-pool";
import type { CoverageSummary, CoveredBody } from "@/lib/registry/coverage";
import type { SeatHolder } from "@/lib/officials/lookup";
import { logEvent } from "@/lib/log/client";
import { getOrCreateBrowserKey } from "@/lib/state/browser-key";
import { readLocationOriginFor } from "@/lib/state/location-origin";
import { subjectKindOf, type AskSubjectRef } from "@/lib/ask/subject";
import {
  readAskAnswer,
  answerSaysSomething,
  unresolvedReadLine,
  transportFailure,
  type AskAnswerPayload,
  type AskClassifyReply,
} from "@/lib/ask/answer";
import { sourceLinks } from "@/lib/ask/host";
import {
  KIND_LABEL,
  buildSearchIndex,
  flattenGroups,
  getSearchIndex,
  groupResults,
  highlightParts,
  searchItems,
  type SearchItem,
  type SearchKind,
} from "@/lib/search";
import { formatMeetingDate } from "@/lib/map/format";
import { useShellData } from "@/lib/state/data";
import { useUi, useUiDispatch } from "@/lib/state/provider";
import { isOnlineOnly } from "@/lib/meetings/online";
import { MeetingStatusPill } from "@/components/map/meeting-status-pill";
import { CalendarLinks } from "@/components/map/popup/calendar-links";
import { useResolvedLocation } from "@/hooks/use-resolved-location";
import { tierVars } from "@/components/shell/tier-style";
import { bodyDisplayName } from "@/lib/text/reader-names";
import { gapsNotInAnswer } from "@/lib/text/say-once";

/**
 * THE ASK PANEL — one input, two jobs, and ONE Ask engine behind the second.
 *
 * ## What changed, and why it had to (PR #212 follow-up, 2026-08-28)
 *
 * PR #212 built a grounded Ask engine — Claude reads the question, the app
 * canonical-binds the entity, the app retrieves only that entity's records, the
 * app builds an evidence pack, Claude explains the pack, and structural
 * validation runs before a word reaches a reader — and **this component did not
 * use it.** It went on calling `/api/ask/classify` and `/api/ask/agenda`. The
 * new engine shipped, was tested, answered correctly through a harness, and the
 * product's primary Ask surface routed around it.
 *
 * That is worse than not having built it. It means the repository held TWO
 * definitions of what an Ask answer is, and which one a reader met depended on
 * which page they were standing on: the ballot got the grounded pipeline, the
 * map got the older classifier-and-topic path. A defect fixed in one is not
 * fixed for the reader.
 *
 * So the submission path is now:
 *
 * ```
 *   an exact name, or an autocomplete pick   ->  SEARCH. Navigates. Unchanged.
 *   anything else                            ->  /api/ask/grounded
 * ```
 *
 * ## ONE ANSWER, AND THE SECOND ONE IS GONE (ASK-05, 2026-08-28)
 *
 * The follow-up above left a second engine running beside the first. This file
 * posted to `/api/ask/agenda` with `scope: "TOPIC_ONLY"` and awaited it through
 * the SAME `Promise.all` as the grounded engine, then rendered its reply as a
 * whole second civic answer — its own eyebrow, its own four-way denominator
 * sentence, its own corpus caveat, its own list of quoted clerk lines. Both
 * could paint on one screen from one submission. **Two competing civic
 * authorities, no precedence between them, reader picks.**
 *
 * The sweep was never the problem and it is not deleted. It runs inside the one
 * engine now (`lib/ask/agenda-topic.ts`), its hits arrive as `AGENDA_MENTION`
 * records in the one evidence pack, and every sentence it used to build arrives
 * as a NAMED GAP with a `whose` on it. What it lost is its standing as a rival
 * answer.
 *
 * So there is one network call for an answer, one contract
 * (`lib/ask/answer.ts`, imported rather than hand-copied), and one rung beside
 * it:
 *
 * * **The curated destination router** (`answerQuestion`) offers the four
 *   in-app surfaces. That is NAVIGATION, never a claim about a government's
 *   records, which is why it may coexist. It is consulted after the grounded
 *   reply, never instead of it, and its own binder sentences are suppressed
 *   wherever the engine bound a subject — the engine binds against a superset
 *   of this file's inventory, so two binder verdicts on one screen would be
 *   the same defect in miniature.
 *
 * Nothing here can silently bypass the grounded pipeline: it is awaited on
 * every ask, unconditionally, and its verdict is what the panel leads with.
 *
 * ## What is unchanged and load-bearing
 *
 * **Every sentence a reader sees here is curated copy, registry data, or prose
 * the grounded pipeline generated from an evidence pack and then validated.**
 * The panel never writes a civic fact of its own.
 *
 * M119 (2026-08-17) merges the sidebar's two inputs into this one. The
 * design is one input, keyword-first: text matching a known meeting,
 * body, district or person filters and navigates exactly as the search did,
 * and anything else routes as an ask. Both halves now live on one control, and
 * **the two logs do not blur** — a keystroke lands in exactly one of them:
 *
 * * A pick from the autocomplete, or an EXACT NAME typed whole, is a SEARCH.
 *   It navigates. It never writes a question row, and it certainly never
 *   writes a refusal row.
 * * Anything submitted that is not a name is an ASK. It logs its topic when it
 *   routed, or the capped question text when it did not.
 *
 * ## The matcher rule (2026-08-17), as it lands here
 *
 * The keyword layer routes only on a STRONG match — two or more distinct
 * keyword hits, or an exact name. Anything weaker falls through to the Level 1
 * classifier, which reads the whole question and either picks the right
 * curated drawer or says nothing routes. The classifier is consulted ONLY
 * after `answerQuestion` has already refused, so it can never overrule a
 * deterministic match; it generates nothing and selects only among curated
 * destinations; and when it is off, over its ceiling or unreachable, the weak
 * match gets the honest refusal with the destinations offered rather than a
 * low-confidence route.
 *
 * ## A06's roadmap contains only what we could not do
 *
 * `askWasAnswered` is the single definition of "answered", read by both the
 * render and the log so they cannot disagree. A destination, a digest or an
 * exact name is an ANSWER — logging one as `NO_ROUTE` would put a question the
 * product just answered into the roadmap of things it cannot do, and the
 * roadmap would be built on it.
 *
 * The question is stored NOWHERE beyond the identifier-free search log's
 * rules, and no state survives this component. Disclosed on /transparency in
 * the same commit (tests/ask-box.test.ts pins the coupling).
 */

const DEBOUNCE_MS = 120;
const BLUR_CLOSE_MS = 150;

/** The kinds the exact-name rung honors, mapped from the index's own kinds. */
const NAME_CLASS: Readonly<Record<SearchKind, NameableEntity["nameClass"]>> = {
  meeting: "meeting",
  body: "body",
  district: "district",
  place: "place",
  officeholder: "person",
};

/*
 * **THE HAND-COPIED CONTRACT IS GONE.** (ASK-05, 2026-08-28.)
 *
 * This file used to declare its own `GroundedRecord`, `GroundedContact`,
 * `GroundedReply` and `AgendaAnswer` — four interfaces describing shapes the
 * server produced and neither side owned. They had already drifted:
 *
 * * `mode` was typed `string`, so the server's `mode: "OFF"` typechecked here,
 *   matched no render branch, and painted an EMPTY PANEL at a reader.
 * * `EvidenceRecord.kind` is a 16-member union; the copy flattened it to
 *   `string`, so a branch on a kind the server cannot send would have compiled.
 * * `AskContact.basis` and `AskContact.retrievedAt` were simply absent, which
 *   made the provenance of a sourced civic relationship **unrenderable by
 *   declaration** — on the wire, and unreachable from any render.
 * * `AskTrace` rides on every reply and appeared nowhere.
 * * `AgendaAnswer` was a SECOND reader-facing civic answer, fetched
 *   concurrently and rendered beside the first.
 *
 * The contract is now `lib/ask/answer.ts`, imported by the routes that produce
 * it and by both surfaces that render it.
 */


/**
 * The everyday-answer contact card(s): the office that owns the reader's topic,
 * with the real line, its own body name over it, and one source line at the
 * bottom. Shared by the standalone ROUTED answer and — when a contactless
 * grounded subject would otherwise suppress the routed block (#7) — by the
 * grounded answer, so a held, verified civic contact is delivered identically
 * on both paths and the render/civic proofs see the same markup. One
 * implementation, so the two placements cannot drift.
 */
function citedContactUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? value : null;
  } catch { return null; }
}

function RoutedContactCards({ contacts }: { contacts: AskAnswer["contacts"] }) {
  return (
    <div className="mt-2 space-y-2">
      {contacts.map((contact) => (
        <div
          key={`${contact.body}|${contact.service}`}
          className="rounded-md border border-[var(--signal)]/35 bg-[var(--signal)]/5 p-3"
        >
          <p className="t-body font-semibold text-paper">
            {contact.body}
          </p>
          <p className="t-detail leading-relaxed text-voice">
            {contact.service}
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {contact.phone && (
              <a
                href={telHref(contact.phone)}
                className="font-mono t-heading font-semibold text-link"
              >
                {contact.phone}
              </a>
            )}
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="t-detail text-link underline decoration-dotted underline-offset-2"
              >
                {contact.email}
              </a>
            )}
            {contact.requestUrl && (
              <a
                href={contact.requestUrl}
                target="_blank"
                rel="noreferrer"
                className="t-detail text-link underline decoration-dotted underline-offset-2"
              >
                online request
              </a>
            )}
          </p>
          {contact.note && (
            <p className="mt-1 t-caption leading-relaxed text-voice">
              {contact.note}
            </p>
          )}
          {/* SRC-3: one source line, at the bottom, in the level register —
              the publisher named in full, never a competing click target. */}
          <p className="mt-1.5 t-caption leading-relaxed text-muted">
            This was sourced from {citedContactUrl(contact.sourceUrl)
              ? <a href={contact.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline decoration-dotted underline-offset-2 hover:text-link">{contact.sourceOrg}</a>
              : contact.sourceOrg}.
          </p>
        </div>
      ))}
    </div>
  );
}

export function AskBox({
  coverage,
  zip,
  ocdIds,
  onSearchPick,
  onOpenBody,
  onOpenPerson,
}: {
  coverage: CoverageSummary;
  /** Orientation only, for the log — never district truth. */
  zip: string | null;
  /** The divisions in view, for the log row. */
  ocdIds: string[];
  /**
   * M119's search half: fly the map to a result and open its popup, exactly
   * as the sidebar's search box did. Absent, the panel is ask-only and the
   * autocomplete does not render — which is what a placement with no map
   * behind it needs.
   */
  onSearchPick?: (item: SearchItem) => void;
  /**
   * **ASK-4 / ASK-8 (2026-08-24).** Opens a body's battlecard. This is the
   * SAME opener the who-governs card is handed, so the two surfaces cannot
   * resolve one name to two different bodies.
   */
  onOpenBody?: (body: CoveredBody) => void;
  /**
   * **ASK-3 / ASK-8 (2026-08-24).** Opens a person's battlecard. Again the
   * who-governs card's own opener, threaded through rather than reimplemented.
   */
  onOpenPerson?: (holder: SeatHolder) => void;
}) {
  const { venues, meetings, allMeetings, everydayRouting } = useShellData();
  const ui = useUi();
  /* WGH-15: the reader's HOME, so an Ask subject is not browse-scoped only. */
  const home = useResolvedLocation(zip);
  const dispatch = useUiDispatch();

  const [text, setText] = useState("");
  const [asked, setAsked] = useState<AskAnswer | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  // The visible-work beat (session brief 3). PRESENTATION ONLY — the
  // routing below runs instantly and deterministically on-device before
  // the timer starts, and nothing new is logged. The words come from a
  // FIXED pool
  // (lib/routing/ask-beat-pool.ts, CLAUDE.md's register rule): playful,
  // acknowledgment register, and never a deliberation label — nothing a
  // reader sees here is generated, and a deliberation word would claim
  // otherwise. The prohibited list lives with the pool.
  const [working, setWorking] = useState(false);
  /*
   * THE GROUNDED ANSWER. It leads the panel, because it is the one that
   * resolves a canonical government and retrieves that government's own
   * records; everything else below it is navigation or a topic sweep.
   */
  const [grounded, setGrounded] = useState<AskAnswerPayload | null>(null);
  /*
   * **THE BOUNDED FOLLOW-UP CONTEXT — and the emphasis is on bounded.**
   *
   * What makes *"and what did they decide?"* answerable is knowing what the
   * previous question resolved to. What would make it a privacy problem is
   * keeping a person's political conversation. So this holds the last few
   * turns, in memory, for this mount only: it does not persist, it does not
   * leave the browser except as the subject reference the next request needs,
   * and closing the panel ends it.
   */
  const [priorSubjects, setPriorSubjects] = useState<AskSubjectRef[]>([]);
  const [priorTurns, setPriorTurns] = useState<
    { question: string; resolvedSubject: string | null }[]
  >([]);
  // Drawn per ask, in the browser, at click time — never during server
  // render, which would freeze one line into the HTML or mismatch on
  // hydration. Seeded with the first entry so the type is never null.
  const [beat, setBeat] = useState<string>(ASK_BEAT_POOL[0]);
  const debounce = useRef<number | undefined>(undefined);
  const blurTimer = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  /*
   * **The beat is shown only while the answer is being worked out.** (2026-09-30,
   * Sean's rulings §6: a user-facing action over three seconds fails, measured
   * until the result is usable.) It used to be held for a drawn 2.4-3.1 seconds
   * (ASK-6) whatever the answer cost, which made every ask take at least that
   * long on screen. The answer now replaces it the moment it is ready.
   */
  const [dots, setDots] = useState(1);
  useEffect(() => {
    if (!working) return;
    const interval = setInterval(() => {
      setDots((d) => (d % 3) + 1);
    }, 400);
    return () => clearInterval(interval);
  }, [working]);
  const inputId = useId();

  useEffect(() => {
    return () => {
      window.clearTimeout(debounce.current);
      window.clearTimeout(blurTimer.current);
    };
  }, []);

  /*
   * The autocomplete index, carried over from the sidebar's search box
   * unchanged — including D18's reason for counting online meetings in the
   * cache token: a meeting held online is in no venue, so an index built
   * before it arrived would never be invalidated by it turning up.
   */
  const index = useMemo(() => {
    const online = meetings.filter((m) => isOnlineOnly(m));
    const token = `${venues.map((v) => v.key).join(",")}|online:${online
      .map((m) => m.id)
      .join(",")}`;
    return getSearchIndex(token, () => buildSearchIndex(venues, [], online));
  }, [venues, meetings]);

  /*
   * MTG-14 (2026-08-28): the autocomplete is a DISCOVERY surface and it never
   * marked an online sitting — a reader who found a meeting here saw a body and
   * a date, and no way to learn there is no room to attend before opening it.
   * Ids match the search index's own `meeting:${id}` shape.
   */
  const onlineItemIds = useMemo(
    () => new Set(meetings.filter(isOnlineOnly).map((m) => `meeting:${m.id}`)),
    [meetings],
  );

  const groups = useMemo(
    () => (onSearchPick ? groupResults(searchItems(index, text)) : []),
    [index, text, onSearchPick],
  );
  const flat = useMemo(() => flattenGroups(groups), [groups]);

  /** Everything the reader could name outright, for the exact-name rung. */
  const entities: NameableEntity[] = useMemo(
    () =>
      index.map((item) => ({
        id: item.id,
        name: item.label,
        nameClass: NAME_CLASS[item.kind],
      })),
    [index],
  );

  /*
   * M119's sharpest edge, caught in a screenshot rather than reasoned about:
   * ONE INPUT, TWO JOBS, AND ONLY ONE OF THEM SHOULD TOUCH THE MAP.
   *
   * The rail's search box committed every keystroke to `search/input`, which
   * is a FILTER — `lib/state/derive.ts` drops every meeting whose text does
   * not match it. That was right when the box could only be a search. Merged,
   * it is wrong the moment someone types a question: "whats going on where i
   * live" matched no meeting, so the count badge read **0 meetings** and the
   * map emptied while the reader was mid-sentence. An empty map is the one
   * thing this product may never render, and here it was rendering one in
   * response to a question it was about to answer.
   *
   * So the filter commits only when the text actually MATCHES something in the
   * index. Typing a body name still narrows the map keystroke by keystroke,
   * exactly as before; typing a question leaves the map alone. The rule is
   * mechanical and checkable — it is the same `searchItems` the autocomplete
   * below renders from, so what filters is always exactly what the reader can
   * see offered.
   */
  function commit(value: string) {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      const matches = value.trim() ? searchItems(index, value).length : 0;
      dispatch({ type: "search/input", query: matches > 0 ? value : "" });
    }, DEBOUNCE_MS);
  }

  function pick(item: SearchItem) {
    window.clearTimeout(blurTimer.current);
    setText(item.label);
    dispatch({ type: "search/input", query: item.label });
    dispatch({ type: "search/open", open: false });
    onSearchPick?.(item);
  }

  /**
   * The second rung (6d, 2026-08-15). Asked ONLY when the on-device keyword
   * matcher refused, and asked for one thing: which curated topic this
   * question belongs to. It writes none of the answer — the sentences below
   * are the same curated route the keyword path renders. A failure of any
   * kind (off, over ceiling, unreachable) returns null and the reader gets
   * the honest refusal they would have had.
   */
  const classify = async (question: string): Promise<string | null> => {
    try {
      const response = await fetch("/api/ask/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!response.ok) return null;
      /* Read through the DECLARED shape, not an inline restatement of it —
         one more hand-copied contract retired (ASK-05). */
      const body = (await response.json()) as AskClassifyReply;
      return typeof body.topic === "string" ? body.topic : null;
    } catch {
      return null;
    }
  };

  /**
   * **THE ASK ENGINE.** (PR #212 follow-up, 2026-08-28.)
   *
   * One call, and it is the one that decides what this panel says. The server
   * holds interpretation, canonical resolution, retrieval, the evidence pack,
   * synthesis and validation; this function holds a fetch and a shape.
   *
   * What the client contributes is CONTEXT it can honestly supply and the
   * server cannot infer:
   *
   * * `ocdIds` — the divisions in view, the same basis the log row uses.
   * * `activeSubjects` — what the reader has OPEN, as canonical references
   *   rather than display strings, so a pronoun has something the binder can
   *   verify. A district the reader clicked is `focused`; that is the whole
   *   difference between a defensible referent and a guess.
   * * `priorSubjects` / `priorTurns` — the bounded conversation, in memory.
   * * `locationOrigin` — WHAT THE READER DID to give us this zip, never what
   *   that act proves. `stampResidency` on the server decides that, so no
   *   client can assert a location confidence it did not earn.
   *
   * **A FAILURE IS A STATE AND IT IS SAID.** (ASK-05, 2026-08-28.) This used
   * to return null on a bad status or a thrown fetch, and the panel rendered
   * NOTHING — while the ballot surface, on the identical engine, said *"That
   * didn't reach us."* One engine may not degrade two ways, and silence is the
   * worse of the two: it is indistinguishable from a working product with
   * nothing to say. `transportFailure()` is the shared constructor.
   */
  const askGrounded = async (question: string, confirmation?: BodyConfirmation): Promise<AskAnswerPayload> => {
    const active: AskSubjectRef[] = [];
    if (ui.selectedDistrictOcdId) {
      active.push({
        id: ui.selectedDistrictOcdId,
        name: ui.selectedDistrictOcdId,
        kind: "BODY",
        /* The reader clicked this district open. That is the fact that makes
           it a defensible referent for "they" rather than one of many things
           merely present on a map. */
        focused: true,
      });
    }
    /* WGH-15: the tapped district is `focused`; where the reader LIVES is
       present but NOT focused. Without this, "my district" binds to whatever
       they last tapped. `focused` still marks the clicked referent, so the
       existing binder semantics are unchanged. */
    for (const id of home.confirmedDivisionIds) {
      if (id !== ui.selectedDistrictOcdId) {
        active.push({ id, name: id, kind: "BODY", focused: false });
      }
    }
    try {
      const response = await fetch("/api/ask/grounded", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          confirmation,
          ocdIds,
          approximateLocation: zip,
          surface: "MAP",
          activeSubjects: active,
          priorSubjects,
          priorTurns,
          locationOrigin: readLocationOriginFor(zip),
          /*
           * **THE RETURNING-READER ID** (October 1, 2026): a random value this
           * browser mints on its first question and keeps, so the Ask store can
           * count distinct readers. It is anonymous (never tied to a name, an
           * email or an address) and has its OWN slot: sharing one with
           * reactions or Speak Your Mind would make one browser produce one
           * value across stores that share no key. The server stores only a
           * hash of it.
           */
          continuityKey: getOrCreateBrowserKey("wtp.ask_key"),
        }),
      });
      if (!response.ok) return transportFailure();
      /* Parsed THROUGH the contract, not cast to it. A cast is what let
         `mode: "OFF"` reach the render and match nothing; a reply whose mode
         is not a member is refused here and reported as a transport failure
         rather than rendered as an empty panel. */
      return readAskAnswer(await response.json()) ?? transportFailure();
    } catch {
      return transportFailure();
    }
  };

  /*
   * **THE SECOND NETWORK CALL IS GONE, AND SO IS THE SECOND ANSWER.**
   * (ASK-05, 2026-08-28.)
   *
   * `askAgenda` posted to `/api/ask/agenda` with `scope: "TOPIC_ONLY"`,
   * concurrently with the grounded engine, and its reply rendered as a WHOLE
   * SECOND CIVIC ANSWER further down this file: its own eyebrow, its own
   * four-way denominator sentence, its own corpus caveat, its own hit list.
   * Both could paint on one screen from one submission. Two competing civic
   * authorities, no precedence between them, and the reader deciding which
   * to believe.
   *
   * The topic sweep still runs and still answers *"is there a data centre
   * coming?"*. It runs INSIDE the one engine now (`lib/ask/agenda-topic.ts`),
   * its hits arrive as `AGENDA_MENTION` records in the one evidence pack, and
   * its four denominator sentences arrive as named gaps with a `whose` on
   * each. Nothing this component used to say about it was lost; what was lost
   * is its standing as a rival answer.
   */
  const ask = (confirmation?: BodyConfirmation) => {
    const question = confirmation?.question ?? text.trim();
    if (!question) return;
    if (confirmation) setText(question);

    // The beat starts immediately — it now covers real work on the refusal
    // path (one network call) as well as the deterministic path, and the
    // reader sees the same acknowledgment either way.
    setAsked(null);
    setDigest(null);
    /* The standing grounded answer goes with the question it answered — a
       previous subject left on screen under a new question reads as this
       product having answered the new one about the old government. */
    setGrounded(null);
    setBeat(drawAskBeat());
    setWorking(true);
    // Submitting an ASK releases the map filter and closes the autocomplete.
    // The question is not a narrowing, and leaving a stale one applied would
    // answer beside a map showing less than the answer talks about.
    window.clearTimeout(debounce.current);
    dispatch({ type: "search/input", query: "" });
    dispatch({ type: "search/open", open: false });

    void (async () => {
      let result = answerQuestion(question, coverage, zip, { entities, everydayRouting });

      /*
       * M119's first rule: an exact name is a SEARCH, not a question.
       *
       * The reader typed a body, a person, a district, a place or a meeting
       * whole. There is nothing to answer — they asked to be taken there. It
       * navigates through the same path the autocomplete uses, so it lands in
       * the search log exactly as it always did, and NOTHING is written to the
       * question log. That is the "two logs must not blur" rule, and it is
       * checked here rather than promised: this branch returns before any
       * `logEvent("QUESTION_ASKED", …)` can run.
       */
      if (result.exactName && onSearchPick) {
        const hit = index.find((item) => item.id === result.exactName!.entity.id);
        if (hit) {
          setWorking(false);
          pick(hit);
          return;
        }
      }

      /*
       * **ONE ENGINE, ONE AWAIT, ONE ANSWER.** The `Promise.all` that used to
       * stand here raced the topic sweep against the grounded engine so that
       * both could render. The sweep is inside the engine now, so there is one
       * call and there is nothing left to race.
       *
       * It is still awaited unconditionally on every submission that is not an
       * exact-name navigation — that is the line that closed the PR #212
       * defect and nothing below may bypass it.
       */
      const groundedAnswer = await askGrounded(question, confirmation);
      setGrounded(groundedAnswer);
      /*
       * The bounded conversation advances only when something CANONICAL was
       * resolved. A turn that resolved nothing contributes no referent, and
       * recording it would let a later pronoun point at a question rather than
       * at a government.
       */
      if (groundedAnswer?.subject) {
        const resolved = groundedAnswer.subject;
        /*
         * **THE KIND IS THE SUBJECT'S OWN KIND.** (ASK-05, 2026-08-28.)
         *
         * This pushed `kind: "PERSON"` for EVERY resolved subject — a school
         * district, a ballot measure, a contest, all of them recorded as
         * people in the follow-up context that a later pronoun resolves
         * against. `resolveSubjectRef` matches on the id first, so it did not
         * usually produce a wrong answer; it produced a wrong REASON, and the
         * moment a reference without an id needed the kind to disambiguate,
         * it would have.
         */
        setPriorSubjects((prior) =>
          [
            ...prior,
            { id: resolved.id, name: resolved.name, kind: subjectKindOf(resolved.kind) },
          ].slice(-4),
        );        setPriorTurns((prior) =>
          [...prior, { question, resolvedSubject: resolved.name }].slice(-4),
        );
      } else {
        setPriorTurns((prior) => [...prior, { question, resolvedSubject: null }].slice(-4));
      }
      /*
       * **EVERY SENTENCE THIS BLOCK USED TO SET UP NOW TRAVELS AS A GAP.**
       * (ASK-05, 2026-08-28.)
       *
       * It set `agenda` and `serverEntity` from the second reply. What it was
       * protecting is preserved and moved, not dropped — g20's rule that a
       * ZERO-HIT search is a RESULT and must render, because silence reads as
       * "no" and "no" is the claim we are not entitled to make. That is now a
       * named gap emitted by `lib/ask/agenda-topic.ts` whenever the sweep ran,
       * alongside the three other distinctions the old four-way ternary drew:
       * nothing searched, nothing found, and a clipped list.
       *
       * `serverEntity` is gone for the same reason. It existed because this
       * component binds against the reader's area while the server binds
       * against the whole corpus, so the server could hold a government this
       * file could not see. The grounded engine binds against a SUPERSET of
       * both and its verdict is already on screen as `grounded.subject`, so a
       * second server verdict rendered separately would be the two-authorities
       * problem in miniature.
       */
      /*
       * Keyword-first, structurally: the classifier is consulted only after the
       * deterministic matcher has already refused.
       *
       * **AND ONLY WHERE THE GROUNDED ENGINE BOUND NOTHING** (2026-08-28). It
       * selects a curated DESTINATION — one of four in-app surfaces — and never
       * a fact about a government, so it is navigation rather than an answer.
       * Running it beneath a grounded answer about a resolved government would
       * put a vaguer second reply under a specific first one, which is the
       * two-answers-on-one-screen problem this follow-up exists to end.
       */
      if (result.answer.kind !== "ROUTED" && !answerSaysSomething(groundedAnswer)) {
        const topic = await classify(question);
        if (topic) {
          result = answerQuestion(question, coverage, zip, {
            classified: topic,
            entities,
            everydayRouting,
          });
        }
      }

      /*
       * A06's roadmap contains only what we could not do.
       *
       * `askWasAnswered` is the one definition, shared with the render, so a
       * question the surface answered can never be logged as one it could
       * not. G05 rule 4d found this the first time with destinations; A02's
       * digest and M119's exact names are the same shape and are covered by
       * the same function rather than by three copies of the same check.
       *
       * Every id logged is a curated constant — a topic, one of four
       * destinations, or the digest — and carries no more about a reader than
       * a topic id always has.
       */
      /*
       * **THE ONE REPLY, HANDED TO THE ONE DEFINITION.** (ASK-05.)
       *
       * Three loose numbers used to be assembled here from two concurrent
       * replies, two of them from an engine that no longer exists. The
       * shared definition takes the declared payload now, so a question the
       * engine answered — with prose, with records, or with a NAMED GAP —
       * can never be logged as one this product could not do. That is G05
       * rule 4d and g11's defect, and the fix is the same both times: the
       * shared definition learns the rung, rather than this component
       * growing a second opinion about what 'answered' means.
       */
      /*
       * **A TRANSPORT FAILURE LOGS NEITHER.** (ASK-05, 2026-08-28.)
       *
       * The engine was never reached, so nothing was asked of the records and
       * nothing may be concluded about them. Logging it ANSWERED would credit
       * a reply that never arrived; logging it NO_ROUTE would file a question
       * this product may well answer perfectly into A06's roadmap of things it
       * CANNOT do — and the roadmap is built on that row. So the row is not
       * written, and the reader is told the request did not reach us.
       */
      if (groundedAnswer.mode === "TRANSPORT_FAILED") {
        /* nothing is recorded about a question we never got to ask */
      } else if (askWasAnswered(result, groundedAnswer)) {
        logEvent("QUESTION_ASKED", ocdIds, {
          topic:
            result.match?.topicId ??
            (result.digest
              ? "DIGEST"
              : result.destination
                ? "DESTINATION_ONLY"
                : "GROUNDED"),
          routed: true,
          ...(result.match?.via ? { via: result.match.via } : {}),
          ...(result.destination
            ? { destination: result.destination.destination.id }
            : {}),
        });
      } else {
        // The refusal is the roadmap: the question rides along, capped,
        // identifier-free like every row.
        logEvent("QUESTION_ASKED", ocdIds, {
          topic: "NO_ROUTE",
          routed: false,
          question: question.slice(0, REFUSAL_LOG_MAX_CHARS),
        });
      }

      // A02 is assembled from rows this product already holds, at ask time,
      // from `allMeetings` — the cascade's answer before the UI's filters, so
      // a chip the reader left on cannot silently shrink a digest that claims
      // to be about their divisions.
      const built = result.digest
        ? buildDigest(coverage, allMeetings, Date.now())
        : null;

      // The answer replaces the beat the moment it is ready: no held minimum.
      setAsked(result);
      setDigest(built);
      setWorking(false);
    })();
  };

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      dispatch({ type: "search/open", open: false });
      return;
    }

    if (
      onSearchPick &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      if (flat.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Wraps, so holding an arrow key never dead-ends at either edge.
      const next =
        (ui.search.highlighted + step + flat.length + 1) % (flat.length + 1);
      dispatch({ type: "search/highlight", index: next === flat.length ? -1 : next });
      dispatch({ type: "search/open", open: true });
      return;
    }

    if (event.key === "Enter") {
      // M119: Enter on a highlighted autocomplete row is a SEARCH. Enter with
      // nothing highlighted is an ASK. One key, two jobs, and which one fired
      // is never ambiguous to the reader — the highlight is on screen.
      const item = onSearchPick ? flat[ui.search.highlighted] : undefined;
      event.preventDefault();
      if (item) {
        pick(item);
        return;
      }
      ask();
    }
  }

  const acOpen = Boolean(onSearchPick) && ui.search.open && flat.length > 0;
  let cursor = -1;

  /*
   * #7 — A CONTACTLESS GROUNDED SUBJECT MUST NOT SUPPRESS A HELD CIVIC CONTACT.
   *
   * Grounded precedence (below) hides the standalone routed block whenever the
   * question resolved to a grounded subject, so one answer leads the panel
   * (ASK-05). But when that subject is CONTACTLESS — e.g. "Board of Assessment
   * Commissioners" for a property-tax question — and the topic router DID hold
   * a verified everyday contact for the reader ("Borough of Rockaway — Tax
   * Collector"), plain suppression drops a real, source-linked answer, which
   * ASK-05 ("nothing lost") forbids. In that exact case we surface the held
   * routed contact inside the grounded answer, under its OWN body name and
   * source — never merged with, or attributed to, the grounded subject.
   */
  const preservedRoutedContact = Boolean(
    grounded?.subject &&
      (grounded.contacts?.length ?? 0) === 0 &&
      asked &&
      asked.answer.kind === "ROUTED" &&
      asked.answer.topic &&
      asked.contacts.length > 0,
  );

  // The flagship treatment (design pass, item 1): a standout feature
  // dressed as one — a raised block, a real heading, an input that
  // invites, a filled Ask.
  return (
    <div
      data-ask-panel
      /*
       * **WHICH GOVERNMENT THIS ANSWER IS ABOUT, INSPECTABLE FROM THE DOM**
       * (2026-08-27). Not decoration and not analytics: the substitution defect
       * was invisible precisely because nothing on the page said which entity
       * had been resolved, so a walk could only guess from prose. The refusal
       * branch renders a sentence for AMBIGUOUS and UNRESOLVED; this carries
       * the verdict on EVERY path, including the routed one where the reader
       * gets a real answer and the check still has to know what it is about.
       */
      data-ask-entity={asked ? asked.binding.kind : undefined}
      data-ask-entity-id={
        asked && asked.binding.kind === "BOUND" ? asked.binding.entity.id : undefined
      }
      className="mt-3.5 rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3.5 shadow-[var(--shadow-panel)]"
    >
      <label
        htmlFor={inputId}
        className="block t-heading font-semibold leading-snug text-paper"
      >
        Ask, or find a thing by name
      </label>
      {/*
        G05 rule 4d (2026-08-17): the copy may only promise what the router
        can route. The four in-app categories are READ FROM the router
        (`ROUTABLE_CATEGORIES`), so a category cannot be named here unless a
        route for it exists in destinations.ts, and removing a route removes
        its promise in the same edit. The topic half of the sentence keeps
        its concrete examples, which is what actually teaches the box.
      */}
      <p className="mt-0.5 t-caption leading-relaxed text-voice">
        {/* F01 8.3 (2026-08-19): a pothole is a poor example to lead
            with. It reads as "report a pothole", and
            this box does not file service requests — it NAMES the office that
            owns the thing, which is a different and smaller promise. The
            routing itself is unchanged and a pothole still routes; it simply
            stops being the first thing a reader is taught to expect. */}
        Your kid&apos;s school, the library, a pothole in the road —
        we&apos;ll point you at the office that owns it. Or ask for{" "}
        {ROUTABLE_CATEGORIES.map((category, i) => (
          <span key={category}>
            {i > 0 && (i === ROUTABLE_CATEGORIES.length - 1 ? " or " : ", ")}
            <span className="text-paper">{category.toLowerCase()}</span>
          </span>
        ))}
        {onSearchPick
          ? ". Type a meeting, body or district by name to go straight to it."
          : "."}
      </p>
      <div className="mt-2.5 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id={inputId}
            data-ask-box
            type="text"
            value={text}
            role={onSearchPick ? "combobox" : undefined}
            aria-expanded={onSearchPick ? acOpen : undefined}
            aria-controls={onSearchPick ? "search-autocomplete" : undefined}
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value);
              if (onSearchPick) commit(e.target.value);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (onSearchPick && text.trim()) {
                dispatch({ type: "search/open", open: true });
              }
            }}
            onBlur={() => {
              // Delayed so a mousedown on a row still registers.
              blurTimer.current = window.setTimeout(
                () => dispatch({ type: "search/open", open: false }),
                BLUR_CLOSE_MS,
              );
            }}
            placeholder={
              onSearchPick
                ? "my kid's school, a meeting, Planning Commission…"
                : "the library, my kid's school, a meeting…"
            }
            className="w-full min-w-0 rounded-md border border-[var(--panel-border)] bg-[var(--bg)] px-3 py-2 t-body placeholder:text-muted focus:border-[var(--signal)] focus:outline-none"
          />

          {onSearchPick && (
            <div
              id="search-autocomplete"
              ref={listRef}
              className={`search-autocomplete${acOpen ? " open" : ""}`}
              role="listbox"
            >
              {groups.map((group) => (
                <div key={group.kind}>
                  <div className="search-ac-group">{group.kind}</div>
                  {group.items.map((item) => {
                    cursor++;
                    const idx = cursor;
                    const [before, hit, after] = highlightParts(item.label, text);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="search-ac-item"
                        data-index={idx}
                        data-selected={idx === ui.search.highlighted}
                        role="option"
                        aria-selected={idx === ui.search.highlighted}
                        style={tierVars(item.tier)}
                        onMouseEnter={() =>
                          dispatch({ type: "search/highlight", index: idx })
                        }
                        onClick={() => pick(item)}
                      >
                        <span className="search-ac-type">
                          {KIND_LABEL[item.kind]}
                        </span>
                        <span className="search-ac-name">
                          {before}
                          <b>{hit}</b>
                          {after}
                        </span>
                        {onlineItemIds.has(item.id) && (
                          <MeetingStatusPill status="online" />
                        )}
                        {item.meta && (
                          <span className="search-ac-meta">{item.meta}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => ask()}
          className="shrink-0 cursor-pointer rounded-md border border-[var(--action)] bg-[var(--action)] px-3.5 t-body font-semibold text-[var(--action-on)] transition-opacity hover:opacity-90"
        >
          Ask
        </button>
      </div>

      {working && (
        // The beat — presentation only, and an acknowledgment rather than a
        // claim of deliberation. The static sentence is what a screen
        // reader announces; the cycling dots are visual, which is why the
        // pool's trailing ellipsis is stripped from the stem.
        <p
          className="mt-2.5 t-body italic leading-relaxed text-voice"
          aria-live="polite"
          data-ask-beat
        >
          {beatStem(beat)}
          <span aria-hidden="true">{".".repeat(dots)}</span>
        </p>
      )}

      {asked && digest && !grounded?.subject && !grounded?.confirmation && !grounded?.clarification && (
        <DigestAnswer
          digest={digest}
          coverage={coverage}
          onOpenBody={onOpenBody}
          onOpenPerson={onOpenPerson}
        />
      )}

      {asked && asked.destination && !grounded?.confirmation && !grounded?.clarification && (
        /*
          G05 rule 4d: the in-app destination. It rides ALONGSIDE the topic
          answer rather than replacing it — "when does the school board meet"
          is both a meetings destination and a schools topic, and dropping one
          would answer less than we know.

          Level throughout: every word describes what is on a surface, and
          none of it claims the surface is complete. The gaps each surface
          already states stay that surface's job to state.
        */
        <div
          data-ask-destination={asked.destination.destination.id}
          className="mt-3 rounded-md border border-[var(--signal)]/35 bg-[var(--signal)]/5 p-3"
        >
          <p className="t-eyebrow text-signal">Where to look</p>
          <p className="mt-1 t-heading font-semibold leading-snug text-paper">
            {asked.destination.destination.label}
          </p>
          <p className="mt-1 t-detail leading-relaxed text-voice">
            {asked.destination.destination.statement}
          </p>
          {/*
            ASK-1 (2026-08-23): THE READER GETS SOMETHING TO TAP, ALWAYS.

            This used to render only when `href` was set, and three of the four
            destinations open IN PLACE and carry no href — so "when is the next
            meeting?" returned a heading, a label and a sentence about what the
            map shows, with nothing to click. The reader was told where to look
            and left to go find it.

            Both branches render the same control at the same size. `min-h-11`
            is 44px, the tap target a thumb needs; the old link was a 12px
            underlined string, which is a mouse affordance rendered on a phone.
          */}
          {asked.destination.destination.href ? (
            <a
              href={asked.destination.destination.href}
              data-ask-destination-go
              className="mt-2 inline-flex min-h-11 items-center rounded-md border border-[var(--signal)]/45 bg-[var(--signal)]/10 px-3 t-body font-semibold text-link no-underline"
            >
              {asked.destination.destination.label}
            </a>
          ) : (
            asked.destination.destination.action && (
              <button
                type="button"
                data-ask-destination-go
                onClick={() => {
                  const action = asked.destination!.destination.action!;
                  if (action.kind === "LIST_OPEN") {
                    /*
                     * ── ASK-22 ── **THE SUBJECT TRAVELS WITH THE OPEN.**
                     * (2026-08-31.)
                     *
                     * This was `dispatch({ type: "list/open", open: true })` —
                     * a generic open carrying nothing. The reader had just been
                     * answered about ONE body and the pill handed them every
                     * meeting in the ZIP, which left them hunting.
                     *
                     * The subject comes from the GROUNDED answer's bound
                     * subject, which is the engine's own decision about what the
                     * question resolved to — not from the question text, and not
                     * from anything this component inferred. When nothing was
                     * bound (a topic answer, a destination with no government in
                     * it) both fields are null and the open is exactly the
                     * unfocused one it always was.
                     */
                    const bound =
                      grounded?.subject?.kind === "BODY" ? grounded.subject : null;
                    dispatch({
                      type: "list/open",
                      open: true,
                      focusBodyId: bound?.id ?? null,
                      focusBodyName: bound?.name ?? null,
                    });
                  } else {
                    dispatch({ type: "door/open", door: action.door });
                  }
                }}
                className="mt-2 inline-flex min-h-11 items-center rounded-md border border-[var(--signal)]/45 bg-[var(--signal)]/10 px-3 t-body font-semibold text-link"
              >
                {asked.destination.destination.label}
              </button>
            )
          )}
        </div>
      )}

      {/*
        **THE GROUNDED ANSWER — and it LEADS, because it is the one that
        resolved a canonical government and read that government's own records.**
        (PR #212 follow-up, 2026-08-28.)

        Every branch renders something TRUE and no branch renders silence. The
        degradation ladder is visible in the order: validated prose first, the
        structured records where prose was rejected or unavailable, then the
        named gaps — each saying WHOSE gap it is — then the verified contacts,
        then the sources. A reply whose `answer` is null still carries
        everything needed to answer honestly, and throwing it away because one
        optional field is null is the exact class PR #211 found repeatedly in
        this file.
      */}
      {grounded && showGroundedAnswer(asked, grounded) && (
        <div
          data-ask-grounded
          data-ask-grounded-mode={grounded.mode}
          data-ask-grounded-subject={grounded.subject?.id ?? undefined}
          /*
            **ASK-17 (2026-08-30) — THE ANSWER SCROLLS.**

            The TUSD answer ran past the bottom of the panel and stopped, cut
            mid-roster, with no way to reach the rest.

            An answer a reader cannot finish reading is an answer they did not
            get, which makes this the reader contract and not a layout
            preference. `max-h` with `overflow-y-auto` bounds the panel and
            gives the overflow somewhere to go; ASK-21's collapsed roster
            reduces how often it is needed and does not remove the need, which
            is why both ship together rather than either alone.

            `overscroll-contain` so reaching the end of the answer does not
            then scroll the map underneath it.
          */
          className="mt-2.5 max-h-[60vh] overflow-y-auto overscroll-contain rounded-[8px] border border-[var(--panel-border)] p-3"
        >
          {/*
            **ASK-16 (2026-08-30) — A WAY OUT.**

            Once a question was asked the answer had no close, no minimise and
            no back.

            Reader friction is a defect with the same standing as a wrong
            number, and being unable to leave a surface is the most basic form
            of it. This dismisses the ANSWER and leaves the question in the box,
            which is the state a reader who wants to rephrase is trying to
            reach — clearing both would make "close" cost them their typing.

            `setGrounded(null)` is the same reset the submit path already runs
            when a new question arrives, so there is one way to retire an
            answer rather than two that can diverge.
          */}
          <div className="flex items-start justify-between gap-2">
            {grounded.subject ? (
              <p className="min-w-0 flex-1 t-body font-semibold leading-snug text-paper">
                {grounded.subject.name}
                {grounded.subject.office ? (
                  <span className="font-normal text-muted"> · {grounded.subject.office}</span>
                ) : null}
              </p>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            <button
              type="button"
              data-ask-dismiss
              aria-label="Close this answer"
              onClick={() => { setGrounded(null); setAsked(null); setDigest(null); }}
              className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 t-detail leading-none text-muted hover:text-paper"
            >
              Close
            </button>
          </div>

          {/* Named, and more than one thing fits. ASKED — never chosen. */}
          <AskBodyConfirmation answer={grounded} working={working} onConfirm={ask} onClarify={() => {
            setGrounded(null);
            setAsked(null);
            setDigest(null);
            document.getElementById(inputId)?.focus();
          }} />
          {grounded.mode === "CLARIFY" && !grounded.confirmation && !grounded.clarification && (
            <p
              data-ask-grounded-state="CLARIFY"
              className="t-body leading-relaxed text-voice"
            >
              More than one goes by &ldquo;{grounded.mention}&rdquo;
              {grounded.candidates?.length ? `: ${grounded.candidates.join(", ")}` : ""}.
              Which did you mean?
            </p>
          )}

          {/*
            Named, and we hold no such thing. SAID — never quietly swapped for
            whatever is nearest, which is the whole defect this pipeline exists
            to close. The word is "anything" rather than "a government": the
            binder resolves bodies, people, contests and measures alike, and
            naming one of the four would be wrong about the other three.
          */}
          {grounded.mode === "UNRESOLVED" && (
            <p
              data-ask-grounded-state="UNRESOLVED"
              className="t-body leading-relaxed text-voice"
            >
              {unresolvedReadLine(grounded)}
            </p>
          )}

          {/*
            **THE ENGINE IS SWITCHED OFF, SAID OUT LOUD.** (ASK-05, 2026-08-28.)

            The server has answered `mode: "OFF"` under `ripcord.askGrounded`
            since the route shipped, and `"OFF"` was not a member of
            `AnswerMode`. Both clients typed `mode` as a bare string, so it
            typechecked, matched NO branch, and rendered an empty panel back at
            a reader who had just typed a question. A switched-off capability
            looked identical to a working one with nothing to say.

            A fact about us, attributed, with no verdict on ourselves in it.
          */}
          {grounded.mode === "OFF" && (
            <WorkingOnIt attrs={{ "data-ask-grounded-state": "OFF" }} />
          )}

          {/*
            **THE REQUEST NEVER REACHED US.** (ASK-05, 2026-08-28.)

            The ballot surface has had this state since it shipped
            (`data-ask-state="TRANSPORT_FAILED"`) and this one did not: the
            fetch caught, returned null, and the panel rendered NOTHING. One
            engine, two surfaces, and only one of them told the reader the
            truth about the same failure.

            It is deliberately not "we found nothing", which would be a claim
            about a government made out of a failed request.
          */}
          {grounded.mode === "TRANSPORT_FAILED" && (
            <p
              data-ask-state="TRANSPORT_FAILED"
              className="t-body leading-relaxed text-voice"
            >
              That didn&rsquo;t reach us. Try again in a moment.
            </p>
          )}

          {/* The validated sentence, where one survived checking. */}
          {grounded.answer && !grounded.agendaLead && (
            <p className="mt-1.5 t-body leading-relaxed text-paper-dim">
              {grounded.answer}
            </p>
          )}

          {/*
            ── OWN-Q9 ── **THE GOVERNMENTS AN ANSWER NAMED, EACH OPENING ITS
            OWN CARD.** (The amendment on Q9, 2026-08-31.)

            The special districts in the answer must be clickable. The
            disclosure rows on the who-governs card have opened their cards
            since WGH-18; the governments named inside an ASK answer were the
            one place in the product where reading about a district was a
            dead end.

            **Keyed on ids, never on the prose.** The obvious implementation
            is to scan the sentence for names we recognise, and it is the
            wrong one twice over: nine Morris County governments answer to
            "Township Council", so a name match is a door onto the wrong
            government — the exact reason `BodyName` below exists — and
            highlighting words inside generated prose would let the synthesis
            rung decide what is clickable. These come off the RECORDS the
            answer was built from, which carry `bodyId` precisely so the
            identity check is mechanical (`lib/ask/evidence.ts`).

            A body the coverage payload cannot resolve renders NOTHING rather
            than an inert chip: an entry that looks like a door and is not is
            worse than no entry.
          */}
          <AnswerBodies
            grounded={grounded}
            coverage={coverage}
            onOpenBody={onOpenBody}
          />

          {/*
            ── ASK-20 / ASK-24 ── **THE SAME CONTROL THE MEETING CARD OFFERS.**
            (Session B closure, 2026-08-31.)

            The gap: an Ask answer that names a meeting date carried no Add to
            calendar, while the map card beside it carried one for the same
            sitting. The reason was upstream — the answer payload shipped the
            meeting as PROSE and an id, which is everything a reader needs to
            read and nothing a control needs to act — so this is the render half
            of the widened payload.

            EVERY sitting the answer resolved, not just the first (ASK-24): a
            body that sits at 1 p.m. and again at 5 p.m. gets two entries,
            because a reader offered one calendar entry for a two-sitting day
            has been handed the wrong afternoon half the time.

            `CalendarLinks` renders nothing for a meeting that is not SCHEDULED,
            so a concluded sitting produces no control rather than an offer to
            attend something that has happened.
          */}
          {(grounded.meetings?.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1" data-ask-calendar>
              {(grounded.meetings ?? [])
                .filter((sitting) => typeof sitting.timeZone === "string" && sitting.timeZone)
                .map((sitting) => (
                <CalendarLinks
                  key={sitting.id}
                  meeting={{
                    ...sitting,
                    /* The one field the two shapes disagree on. Adapted HERE,
                       explicitly, rather than cast at the boundary — a cast is
                       how a null reaches something that declared it could not
                       be one. */
                    bodyId: sitting.bodyId ?? undefined,
                    /* The body's own zone. Absent is not a zone, and a
                       calendar entry with no zone lands an hour wrong for
                       half the year - so a sitting with none renders no
                       control rather than a guessed one (filtered above). */
                    timeZone: sitting.timeZone as string,
                    /* Absent and null are one fact to a calendar entry: there
                       is no agenda link to put in the description. */
                    agendaUrl: sitting.agendaUrl ?? null,
                  }}
                />
                ))}
            </div>
          )}

          <AskAnswerRecords records={grounded.records ?? []} initiallyOpen={!grounded.answer} agendaLead={grounded.agendaLead} prose={grounded.agendaLead ? grounded.answer : null} />

          {/* Each gap says whose it is. "We haven't recorded this" is a fact
              about us; "they haven't published it" is a fact about them, and
              rendering them as one sentence is the defect the constitution
              names. */}
          {gapsNotInAnswer(grounded.answer, grounded.gaps ?? []).map((g) => (
            <p
              key={g.statement}
              data-ask-gap={g.whose}
              className="mt-1.5 t-detail leading-relaxed text-muted"
            >
              {g.statement}
            </p>
          ))}

          {/*
            **THE CONTACTS, AND WHY EACH ONE IS HERE.**

            Not "who to call" and not a ranking — the product may not order
            people by influence. Each line states the sourced RELATIONSHIP
            between that person and the thing the reader asked about, which is
            a fact, and stops.
          */}
          {/*
            **ASK-21 (2026-08-30) — COLLAPSED BY DEFAULT.**

            This rendered every member expanded inside every answer: name,
            role, body, ward email and the date we read it, five to eight rows
            deep — too much information, and it is what pushed the TUSD answer
            off the bottom of the panel (ASK-17).

            The same collapse-by-default rule as MTG-5, BAL-8 and BAL-16 — this
            is the surface it had not reached. **Nothing is removed** (RULING
            26, RULING 27): every contact is still rendered, still sourced,
            still one click away, and the COUNT is on the summary so a reader
            knows what is behind it before they open it.

            The title stays the one already on the surface, so the label a
            reader has learned does not move under them.
          */}
          <AskAnswerContacts contacts={grounded.contacts ?? []} />

          {/*
            #7: a CONTACTLESS grounded subject must not suppress a held,
            verified everyday contact the topic router found for the reader.
            Rendered under the contact's OWN body name and source — evidence
            under the one grounded answer, never attributed to the grounded
            subject or silently merged with it. `preservedRoutedContact` only
            fires when the grounded subject carries no contacts of its own, so
            this never competes with or duplicates `grounded.contacts` above.
          */}
          {preservedRoutedContact && asked && (
            <div className="mt-3" data-ask-preserved-contact>
              <p className="t-eyebrow text-signal">Who handles this</p>
              <p className="mt-1 t-heading font-semibold text-paper">
                {asked.answer.topic?.label}
              </p>
              <RoutedContactCards contacts={asked.contacts} />
            </div>
          )}

          {/*
            **NO BRANCH MAY RENDER SILENCE.** A reply with no subject, no
            records and no gaps rendered an empty panel back at a reader who had
            just typed a question — found on the ballot surface by reading the
            sentence rather than the DOM, and prevented here by construction.

            The wording is the constitution's shape: the ATTRIBUTION is required
            and the verdict on ourselves is struck (RULING 139). Then it offers
            the narrowing and stops.
          */}
          {/* #7: when a held routed contact is surfaced above for a
              contactless grounded subject, the engine's "nothing recorded"
              sentence would contradict a civic answer that IS on screen — the
              civic proof asserts NOTHING_HELD is absent in exactly that case. */}
          {!preservedRoutedContact &&
            !grounded.answer &&
            (grounded.records?.length ?? 0) === 0 &&
            (grounded.gaps?.length ?? 0) === 0 &&
            grounded.mode !== "CLARIFY" &&
            grounded.mode !== "UNRESOLVED" &&
            /* Both of these render their own sentence above. Without them here
               a switched-off engine or an unreachable one would print the
               "we hold nothing" line as well, which claims something about our
               records that neither state got far enough to check. */
            grounded.mode !== "OFF" &&
            grounded.mode !== "TRANSPORT_FAILED" && (
              <WorkingOnIt
                attrs={{ "data-ask-grounded-state": "NOTHING_HELD" }}
                about={grounded.subject?.name}
                subject={grounded.subject?.kind === "BODY" ? { type: "BODY", id: grounded.subject.id } : null}
              />
            )}

          {/* The sources, always, and a null publisher renders as the HOST
              rather than as a phrase like "the record" — a mechanical read of
              a URL already on screen, never a claim about who published it. */}
          {(() => {
            /* One line per PUBLISHER. Six executive orders from one office are
               six links and one source, and listing the office seven times is
               an attribution nobody can read. */
            const links = sourceLinks(grounded.records ?? []);
            if (links.length === 0) return null;
            return (
              /* `data-ask-sources` carries the PUBLISHER count, not a reader
                 string — the same convention `data-ask-contacts` already uses.
                 The reader-contract evaluator requires a visible source record
                 before any answer may be green (A.1 WI1), and counting anchors
                 inside the panel would count contact `mailto:` links too. */
              <p className="mt-2 t-caption text-muted" data-ask-sources={links.length}>
                Source{links.length > 1 ? "s" : ""}:{" "}
                {links.map((l, i) => (
                  <span key={l.label}>
                    {i > 0 ? ", " : ""}
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-dotted underline-offset-2 hover:text-link"
                    >
                      {l.label}
                    </a>
                  </span>
                ))}
              </p>
            );
          })()}
        </div>
      )}

      {/*
        **THE SERVER'S VERDICT IS THE GROUNDED SUBJECT NOW.** (ASK-05.)

        A separate paragraph stood here — *"We do hold Vail — search for it by
        name to open it"* — built from a binding the topic route returned
        alongside its sweep. It existed because this component binds against
        the reader's own area while a server binds against the whole corpus,
        so the server could hold a government this file could not see.

        That is still true and it is answered better: the grounded engine
        binds against a SUPERSET of both inventories and its verdict already
        renders above, as the subject line of the answer itself. A second
        server verdict in its own paragraph would be a second authority on the
        same screen, which is the whole defect ASK-05 exists to close.
      */}
      {/*
        The refusal reads the SHARED definition of answered, handed the ONE
        engine's reply — otherwise a reader who got a real answer off real
        records would be told underneath it that we have no sourced answer for
        their question. Two contradictory sentences on one screen is worse than
        either of them alone.

        **AND IT IS SILENT ON A TRANSPORT FAILURE.** (ASK-05, 2026-08-28.)
        *"We haven't got a sourced answer for that"* is a claim about our own
        records, and it may not be made when the request never reached them.
        The grounded block above says what actually happened.
      */}
      {asked &&
        grounded?.mode !== "TRANSPORT_FAILED" &&
        !askWasAnswered(asked, grounded) && (
          <div data-ask-refusal className="mt-2.5">
          {/*
            **THE GOVERNMENT THEY NAMED, WHEN WE COULD NOT PIN IT DOWN**
            (2026-08-27). Without this the refusal is honest but mute: a reader
            who typed a district's name and got the general "we haven't routed
            this" sentence cannot tell whether we misread the name, never held
            that government, or simply do not answer questions of that shape.
            It sits ABOVE the refusal because it is the more specific fact, and
            it is the one that tells them what to try next.
          */}
          {/*
            **THE SERVER'S VERDICT WINS, BECAUSE IT SEES MORE.** (2026-08-27.)

            This component binds against the search index and the reader's own
            covered bodies, both scoped to their area. The route binds against
            the whole corpus. So at a Tucson zip this said *"we don't have a
            government recorded under 'vail'"* — a claim about OUR OWN HOLDINGS,
            and a false one, about a government the server had already resolved.

            Saying "we don't have it" about something we hold is the same class
            as saying "nothing is scheduled" about a meeting we never looked
            for, pointed inward. So where the server resolved the name, that is
            what the reader is told.
          */}
          {asked.binding.kind === "UNRESOLVED" && !grounded?.subject && (
            <WorkingOnIt attrs={{ "data-ask-entity-state": "UNRESOLVED" }} about={`“${asked.binding.mention}”`} />
          )}
          {asked.binding.kind === "AMBIGUOUS" && !grounded?.subject && (
            <p
              data-ask-entity-state="AMBIGUOUS"
              className="t-body leading-relaxed text-voice"
            >
              {/* NOT "choose one" — nothing here is choosable, and asking a
                  reader to do something the product has not built is a claim
                  about the product. Saying which KIND does work: the binder
                  reads the class of government out of the reader's own words. */}
              More than one government goes by that name —{" "}
              {asked.binding.candidates.map((c) => c.name).join(" and ")}. Say
              which kind you mean — &ldquo;school district&rdquo;,
              &ldquo;town&rdquo; — and we&apos;ll answer for that one.
            </p>
          )}
          <p className="t-body leading-relaxed text-voice">
            {asked.answer.statement}
          </p>
          {/*
            The rule: where the classifier is pulled or unavailable,
            a weak match gets the honest refusal WITH THE DESTINATIONS OFFERED
            — never a low-confidence route. The offer is the four curated
            surfaces, named, so a refusal still leaves the reader somewhere to
            go. It claims nothing about their question.
          */}
          <p className="mt-1.5 t-caption leading-relaxed text-muted">
            You can still head straight to{" "}
            {ROUTABLE_CATEGORIES.map((category, i) => (
              <span key={category}>
                {i > 0 && (i === ROUTABLE_CATEGORIES.length - 1 ? " or " : ", ")}
                <span className="text-paper">{category.toLowerCase()}</span>
              </span>
            ))}
            .
          </p>
        </div>
      )}

      {/*
        **THE SECOND CIVIC ANSWER IS GONE, AND ITS EVIDENCE IS UPSTAIRS.**
        (ASK-05, 2026-08-28.)

        A whole second answer rendered here, ninety-odd lines of it: the topic
        sweep's own eyebrow ("On an agenda near you" / "What we searched"), its
        own four-way denominator sentence with an `unreadable` suffix, its own
        corpus caveat, and its own list of quoted clerk lines with body-name
        doors. It was fetched CONCURRENTLY with the grounded engine through one
        `Promise.all`, so a single question could paint both — two competing
        civic authorities on one screen, with no precedence between them and the
        reader left to decide which was the answer.

        **Nothing it said was wrong and nothing it said is lost.** The sweep runs
        inside the one engine now (`lib/ask/agenda-topic.ts`). Its hits arrive as
        `AGENDA_MENTION` records and render in the structured list above, with
        the clerk's line quoted and the agenda linked in the source line. Its
        four denominator states — nothing searched, nothing found, a clipped
        list, documents held but unreadable — arrive as NAMED GAPS, each saying
        whose gap it is, and render in the gap list above. The corpus caveat
        (agendas are not the permit record) rides on every outcome, hit or empty,
        exactly as it did here.

        What changed is standing: it is evidence under one answer instead of
        being a second one.
      */}

      {asked && asked.answer.kind === "ROUTED" && asked.answer.topic && !answerSaysSomething(grounded) && (
        <div className="mt-3">
          {/* The answer's own header: eyebrow naming the register, the
              topic as the heading. Same data as before, dressed to be
              read as the authoritative answer it is. */}
          <p className="t-eyebrow text-signal">The answer</p>
          <p className="mt-1 t-heading font-semibold leading-snug text-paper">
            {asked.answer.topic.label}
          </p>
          {asked.contacts.length > 0 && (
            // The everyday answer: the office that owns the fix, with the real
            // line. A service line that owns the topic IS the answer. Same card
            // as the grounded-precedence path (#7) — one shared component, so
            // the two placements cannot drift.
            <RoutedContactCards contacts={asked.contacts} />
          )}
          <ol className="mt-2 space-y-2.5">
            {asked.answer.steps.map((step, i) => (
              <li key={i} className="t-detail leading-relaxed">
                <p className="text-voice">{step.why}</p>
                {step.bodies.length > 0 && (
                  /*
                    **ASK-4 (2026-08-24) — A BODY'S NAME OPENS ITS BATTLECARD,
                    NEVER THE EXTERNAL SITE.**

                    This rendered `body.homepageUrl` in a `target="_blank"`
                    anchor, so the only thing a reader could do with "Tucson
                    Unified District" in an answer was LEAVE. The who-governs
                    card settled the grammar on 2026-08-16 — a body's row opens
                    the body's large card, and every external door lives inside
                    it — and Ask was the surface still doing it the old way.

                    **ASK-8**: this is the shared renderer, so the sidebar, the
                    collapsed top-right pill and any future placement all
                    inherit the fix at once. There is exactly one `AskBox` and
                    exactly one `PillCluster` constructing it.

                    The opener is OPTIONAL, and the fallback is plain text
                    rather than the old external link: a placement with no map
                    behind it has nowhere to open a card, and sending that
                    reader out of the product instead would be re-introducing
                    the defect on the one surface nobody looks at.
                  */
                  <p className="mt-0.5 t-body">
                    {step.bodies.map((body, j) => (
                      <span key={body.label}>
                        {j > 0 && <span className="text-muted"> · </span>}
                        {onOpenBody ? (
                          <button
                            type="button"
                            onClick={() => onOpenBody(body.body)}
                            className="text-left text-link underline decoration-dotted underline-offset-2 hover:text-paper"
                          >
                            {body.label}
                          </button>
                        ) : (
                          <span className="text-paper">{body.label}</span>
                        )}
                      </span>
                    ))}
                  </p>
                )}
                {step.people.length > 0 && (
                  /*
                    A04 (2026-08-18): "Who can I contact about X?" — the row
                    now answers the second half of its own question.
                    `SeatHolder` has carried `phone`, `email` and
                    `contactFormUrl` since 3a; this list rendered a name, an
                    office and a source link, and stopped. A reader who has
                    just been told WHO owns their problem and is then left to
                    go and find them has been given a lookup, not an answer,
                    and every click between them and the phone number is the
                    reader-friction rule's own defect.

                    An absence is an absence: a person with no published
                    contact renders their name and nothing after it. Nothing
                    is inferred from a colleague's number or a body's
                    switchboard — a wrong phone number for a named official
                    is a false claim about a real person, and the reader
                    finds out by being ignored.
                  */
                  <ul className="mt-0.5 space-y-1 t-body">
                    {step.people.map((person) => (
                      <li key={person.id}>
                        {/*
                          **ASK-3 (2026-08-24) — THE NAME IS THE PRIMARY CLICK
                          TARGET, and it opens this person's battlecard.**

                          A reader who has just been told WHO owns their
                          problem wants to know about that person, and the name
                          is where they will aim. It rendered as inert text.

                          **SRC-4** is what cleared the room for it: the inline
                          `source` tag that used to sit beside every name is
                          gone from this answer entirely. It was a second,
                          smaller, competing target one word away from the name
                          — and the record it pointed at is in the battlecard's
                          Sources tab, which is where the sourcing rule says it
                          belongs. Nothing is de-sourced: `person.sourceUrl` and
                          the whole provenance still travel on the row and
                          render inside the card the name now opens.
                        */}
                        {onOpenPerson ? (
                          <button
                            type="button"
                            onClick={() => onOpenPerson(person)}
                            className="text-left font-medium text-link underline decoration-dotted underline-offset-2 hover:text-paper"
                          >
                            {person.name}
                          </button>
                        ) : (
                          <span className="font-medium text-paper">
                            {person.name}
                          </span>
                        )}
                        <span className="text-muted"> · {readerOfficeTitle(person.officeTitle)}</span>
                        {(person.phone || person.email || person.contactFormUrl) && (
                          <span className="ml-1 t-detail">
                            {person.phone && (
                              <a
                                href={`tel:${person.phone.replace(/[^\d+]/g, "")}`}
                                className="text-link underline decoration-dotted underline-offset-2"
                              >
                                {person.phone}
                              </a>
                            )}
                            {person.phone && (person.email || person.contactFormUrl) && (
                              <span className="text-muted"> · </span>
                            )}
                            {person.email && (
                              <a
                                href={`mailto:${person.email}`}
                                className="text-link underline decoration-dotted underline-offset-2"
                              >
                                {person.email}
                              </a>
                            )}
                            {person.email && person.contactFormUrl && (
                              <span className="text-muted"> · </span>
                            )}
                            {!person.email && person.phone && person.contactFormUrl && (
                              <span className="text-muted"> · </span>
                            )}
                            {person.contactFormUrl && (
                              <a
                                href={person.contactFormUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-link underline decoration-dotted underline-offset-2"
                              >
                                contact form
                              </a>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {/*
                  M94 (2026-08-16), the footnote collapse: a gap sentence is
                  said ONCE per answer, on the first step that hits it.

                  A four-step route where three steps land on bodies we hold
                  and no roster for rendered "We haven't sourced who sits on
                  this body yet." three times, one line apart. Repeating a
                  notice does not make it more honest — it makes the answer
                  look like it is mostly apology, and it buries the steps
                  that DID resolve. The rule is the same one the transparency
                  diet applied to every other repeated line: state it, and
                  state it once.

                  It is still per-SENTENCE, not per-answer: two DIFFERENT gap
                  sentences are two different facts and both are said.
                */}
                {step.gap &&
                  asked.answer.steps.findIndex((s) => s.gap === step.gap) === i && (
                    <p className="mt-0.5 t-caption leading-relaxed text-voice">
                      {step.gap}
                    </p>
                  )}
              </li>
            ))}
          </ol>
          {/* The denominator, always stated — never implied completeness. */}
          <p className="mt-2 border-t border-[var(--panel-border)] pt-1.5 t-caption leading-relaxed text-muted">
            Based on what we track here
            {zip ? ` around ${zip}` : ""} — {asked.answer.grounding.stepsWithSomeone}{" "}
            of {asked.answer.grounding.totalSteps} steps point at a body or
            person we can actually name.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A02 — the digest, rendered. Three blocks, three denominators, three named
 * gaps; nothing here is written, and every row is a record the product already
 * holds. See `lib/routing/digest.ts` for why the blocks never share a count.
 */
/**
 * **OWN-Q9 — the governments an Ask answer named, as doors.** (2026-08-31.)
 *
 * The set is derived, in this order, and every step is an id join:
 *
 * 1. `grounded.subject` — what the question resolved to.
 * 2. every `record.bodyId` — whose record each piece of evidence is.
 *
 * Then deduplicated, resolved against the SAME coverage payload the card
 * behind it renders from, and dropped where it does not resolve. A district
 * the reader's coverage does not carry is a district this surface has no card
 * for, and offering one would be a door onto a page that cannot exist.
 *
 * It renders nothing at all when nothing resolves — no heading, no empty
 * state. The answer above it already says what it says; a "no districts"
 * line under a paragraph naming three would be a surface contradicting
 * itself, which is the WGH-19 / WGH-21 / MAP-5 class.
 */
function AnswerBodies({
  grounded,
  coverage,
  onOpenBody,
}: {
  grounded: AskAnswerPayload;
  coverage: CoverageSummary;
  onOpenBody?: (body: CoveredBody) => void;
}) {
  if (!onOpenBody) return null;

  const wanted: string[] = [];
  const subjectId = grounded.subject?.id;
  if (typeof subjectId === "string" && subjectId) wanted.push(subjectId);
  for (const record of grounded.records ?? []) {
    if (typeof record.bodyId === "string" && record.bodyId) wanted.push(record.bodyId);
  }

  const seen = new Set<string>();
  const rows: CoveredBody[] = [];
  for (const id of wanted) {
    if (seen.has(id)) continue;
    seen.add(id);
    /* Both id spaces a body card answers to: the registry body id, and a
       division whose governing body the payload carries. Same join
       `BodyName` performs, one level up. */
    const body =
      coverage.bodies.find((b) => b.bodyId === id) ??
      coverage.bodies.find(
        (b) => b.ocdId === id && (b.bodyId === `${id}#governing` || b.bodyId === `${id}#board`),
      );
    if (body) rows.push(body);
  }

  if (rows.length === 0) return null;

  return (
    <p data-ask-answer-bodies className="mt-2 t-body leading-relaxed">
      {rows.map((body, i) => (
        <span key={body.bodyId}>
          {i > 0 && <span className="text-muted"> · </span>}
          <button
            type="button"
            data-ask-body-open={body.bodyId}
            onClick={() => onOpenBody(body)}
            className="text-left text-link underline decoration-dotted underline-offset-2 hover:text-paper"
          >
            {bodyDisplayName(body)}
          </button>
        </span>
      ))}
    </p>
  );
}

/**
 * **ASK-4 (2026-08-24) — one resolver, so every Ask template opens the same
 * body for the same name.**
 *
 * Templates that carry a `CoveredBody` outright (the routed steps) hand it
 * straight to the opener. Templates that carry a MEETING — the digest rows,
 * the agenda hits — carry the division's ocd-id instead, and this resolves it
 * against the same coverage the answer was built from.
 *
 * **Matched on the exact ocd-id and on the `#governing` / `#board` slot,
 * never on the name string.** Two governments share a name constantly
 * (Rockaway township and Rockaway borough sit in one county), and a
 * name-matched door is a door onto the wrong government. No match renders
 * plain text — an inert name is honest, a wrong battlecard is not.
 */
function BodyName({
  label,
  ocdId,
  coverage,
  onOpenBody,
}: {
  label: string;
  ocdId: string | null;
  coverage: CoverageSummary;
  onOpenBody?: (body: CoveredBody) => void;
}) {
  const body = ocdId
    ? coverage.bodies.find(
        (b) =>
          b.ocdId === ocdId &&
          (b.bodyId === `${ocdId}#governing` || b.bodyId === `${ocdId}#board`),
      )
    : undefined;
  if (!body || !onOpenBody) return <>{label}</>;
  return (
    <button
      type="button"
      onClick={() => onOpenBody(body)}
      className="text-left text-link underline decoration-dotted underline-offset-2 hover:text-paper"
    >
      {label}
    </button>
  );
}

function DigestAnswer({
  digest,
  coverage,
  onOpenBody,
  onOpenPerson,
}: {
  digest: Digest;
  coverage: CoverageSummary;
  /** ASK-4: body names in digest rows open their battlecards. */
  onOpenBody?: (body: CoveredBody) => void;
  /** ASK-3: every person named in the digest opens their battlecard. */
  onOpenPerson?: (holder: SeatHolder) => void;
}) {
  return (
    <div data-ask-digest className="mt-3">
      <p className="t-eyebrow text-signal">Where you live</p>
      <p className="mt-1 t-heading font-semibold leading-snug text-paper">
        What&apos;s going on
      </p>
      <p className="mt-0.5 t-caption leading-relaxed text-muted">
        Scoped to the {digest.divisionLabels.length} division
        {digest.divisionLabels.length === 1 ? "" : "s"} your point sits in.
      </p>

      <DigestSection
        title={`Coming up — next ${digest.windows.upcomingDays} days`}
        shown={digest.upcoming.rows.length}
        total={digest.upcoming.total}
        gap={digest.upcoming.gap}
      >
        {digest.upcoming.rows.map((row) => (
          <li key={row.id} className="t-detail leading-relaxed">
            <span className="font-medium text-paper">
              <BodyName
                label={row.bodyName}
                ocdId={row.ocdId}
                coverage={coverage}
                onOpenBody={onOpenBody}
              />
            </span>
            <span className="text-muted"> · </span>
            <span className="text-voice">
              {row.startPrecision === "DAY"
                ? `${formatMeetingDate(row)} (no start time published)`
                : formatMeetingDate(row)}
            </span>
            {row.agendaUrl && (
              <>
                {" "}
                <a
                  href={row.agendaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="t-caption text-link underline decoration-dotted underline-offset-2"
                >
                  agenda
                </a>
              </>
            )}
          </li>
        ))}
      </DigestSection>

      <DigestSection
        title={`Recently decided — last ${digest.windows.recentDays} days`}
        shown={digest.recent.rows.length}
        total={digest.recent.total}
        gap={digest.recent.gap}
      >
        {digest.recent.rows.map((row) => (
          <li key={row.id} className="t-detail leading-relaxed">
            <span className="font-medium text-paper">
              <BodyName
                label={row.bodyName}
                ocdId={row.ocdId}
                coverage={coverage}
                onOpenBody={onOpenBody}
              />
            </span>
            <span className="text-muted"> · </span>
            <span className="text-voice">
              {formatMeetingDate(row)}
            </span>
            {row.agendaUrl && (
              <>
                {" "}
                <a
                  href={row.agendaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="t-caption text-link underline decoration-dotted underline-offset-2"
                >
                  agenda
                </a>
              </>
            )}
          </li>
        ))}
      </DigestSection>

      <DigestSection
        title="Who represents you"
        shown={digest.representation.rows.length}
        total={digest.representation.total}
        gap={digest.representation.gap}
      >
        {digest.representation.rows.map(({ seatLabel, holder }) => (
          <li key={`${seatLabel}|${holder.id}`} className="t-detail leading-relaxed">
            {/* ASK-3: the name is the door. SRC-4: the inline source tag is
                gone — the record travels on the row and renders inside the
                battlecard this name opens. */}
            {onOpenPerson ? (
              <button
                type="button"
                onClick={() => onOpenPerson(holder)}
                className="text-left font-medium text-link underline decoration-dotted underline-offset-2 hover:text-paper"
              >
                {holder.name}
              </button>
            ) : (
              <span className="font-medium text-paper">{holder.name}</span>
            )}
            <span className="text-muted"> · {readerOfficeTitle(holder.officeTitle)}</span>
          </li>
        ))}
      </DigestSection>

      {digest.unscopedMeetingCount > 0 && (
        // Never dropped: Census enumerates no boundary for these governments,
        // so they cannot be scoped to a point — which is a fact about the
        // boundary file, not evidence that they are not the reader's.
        <p className="mt-2 t-caption leading-relaxed text-muted">
          {digest.unscopedMeetingCount} meeting
          {digest.unscopedMeetingCount === 1 ? "" : "s"} we hold belong to
          bodies with no Census division, so they cannot be matched to your
          point by boundary. They are on the map.
        </p>
      )}
    </div>
  );
}

function DigestSection({
  title,
  shown,
  total,
  gap,
  children,
}: {
  title: string;
  shown: number;
  total: number;
  gap: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2.5 border-t border-[var(--panel-border)] pt-2">
      <p className="t-eyebrow text-muted">{title}</p>
      {gap ? (
        // The named gap, in the gap's own register — never an empty section
        // and never a sentence borrowed from another block.
        <p className="mt-1 t-caption leading-relaxed text-voice">{gap}</p>
      ) : (
        <>
          <ul className="mt-1 space-y-1">{children}</ul>
          {/* Stated N equals rendered rows, and the denominator is always
              said — a clip must never read as the whole of what we hold. */}
          <p className="mt-1 t-caption text-muted">
            Showing {shown} of {total}.
          </p>
        </>
      )}
    </div>
  );
}
