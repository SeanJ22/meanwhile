"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";

import {
  answerQuestion,
  askWasAnswered,
  REFUSAL_LOG_MAX_CHARS,
  type AskAnswer,
} from "@/lib/routing/ask";
import { buildDigest, type Digest } from "@/lib/routing/digest";
import { ROUTABLE_CATEGORIES } from "@/lib/routing/destinations";
import type { NameableEntity } from "@/lib/routing/exact-name";
import { ASK_BEAT_POOL, beatStem, drawAskBeat } from "@/lib/routing/ask-beat-pool";
import type { CoverageSummary, CoveredBody } from "@/lib/registry/coverage";
import type { SeatHolder } from "@/lib/officials/lookup";
import { logEvent } from "@/lib/log/client";
import { readBrowserKey } from "@/lib/state/browser-key";
import { readLocationOriginFor } from "@/lib/state/location-origin";
import type { AskSubjectRef } from "@/lib/ask/subject";
import { hostOf } from "@/lib/ask/host";
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
import { tierVars } from "@/components/shell/tier-style";

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
 * ## What still runs beside it, and the boundary that keeps it honest
 *
 * Two older rungs are retained because the grounded engine does not supersede
 * them, and each is confined to something that is NOT a claim about a
 * government's records:
 *
 * * **The curated destination router** (`answerQuestion`) offers the four
 *   in-app surfaces. That is NAVIGATION. It is consulted after the grounded
 *   reply, never instead of it.
 * * **The topic agenda search** (`/api/ask/agenda`, called with
 *   `scope: "TOPIC_ONLY"`) sweeps every readable agenda in the reader's area
 *   for a topic — *"is there a data centre coming?"* — which is a different
 *   question with a different denominator. Under that scope the route REFUSES
 *   to answer a named body's docket at all, so the boundary is enforced in the
 *   server rather than promised by this file.
 *
 * Nothing here can silently bypass the grounded pipeline: it is called on every
 * ask, first, and its verdict is what the panel leads with.
 *
 * ## What is unchanged and load-bearing
 *
 * **Every sentence a reader sees here is curated copy, registry data, or prose
 * the grounded pipeline generated from an evidence pack and then validated.**
 * The panel never writes a civic fact of its own.
 *
 * M119 (2026-08-17) merges the sidebar's two inputs into this one. The
 * author's ruling was one input, keyword-first: text matching a known meeting,
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
 * ## The author's matcher ruling (2026-08-17), as it lands here
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

/**
 * What `/api/ask/grounded` returns — THE Ask answer.
 *
 * Every optional field is optional because the pipeline degrades rather than
 * fails: grounded prose -> structured records -> a named gap. This component
 * renders whatever arrived and **never discards a useful reply because one
 * field is null**, which is the defect class PR #211 found repeatedly in this
 * file's own handling of the agenda reply.
 */
interface GroundedRecord {
  kind: string;
  id: string;
  text: string;
  sourceUrl?: string | null;
  sourceOrg?: string | null;
}

interface GroundedContact {
  id: string;
  name: string;
  officeTitle: string;
  relationship: string;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  sourceUrl: string | null;
  sourceOrg: string | null;
}

interface GroundedReply {
  mode: string;
  subject?: { kind: string; id: string; name: string; office?: string | null } | null;
  answer?: string | null;
  records?: GroundedRecord[];
  gaps?: { whose: "OURS" | "THEIRS"; statement: string }[];
  contacts?: GroundedContact[];
  mention?: string;
  candidates?: string[];
}

/**
 * What `/api/ask/agenda` returns for A03. Every string in it is read off a
 * document a government published — the quote is the clerk's own line.
 */
interface AgendaAnswer {
  topic: { id: string; label: string } | null;
  /**
   * The government the SERVER resolved (2026-08-27). It binds against the
   * whole corpus; this component binds against the search index and the
   * reader own covered bodies, both scoped to their area. So the server can
   * hold a government this component cannot see, and its verdict wins.
   */
  namedEntity?:
    | { state: "BOUND"; ocdId: string; name: string }
    | { state: "AMBIGUOUS"; candidates: string[] }
    | { state: "UNRESOLVED"; mention: string }
    | null;
  radiusMiles: number | null;
  hits: {
    quote: string;
    matchedPhrase: string;
    documentUrl: string;
    sourceOrg: string;
    bodyName: string | null;
    /** ASK-4: the exact division key behind this hit, or null. */
    ocdId: string | null;
    title: string | null;
    startsAt: string | null;
    agendaUrl: string | null;
  }[];
  /** The denominators — stated N equals rendered rows. */
  hitsFound: number;
  searched: number;
  unreadable: number;
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
  const { venues, meetings, allMeetings } = useShellData();
  const ui = useUi();
  const dispatch = useUiDispatch();

  const [text, setText] = useState("");
  const [asked, setAsked] = useState<AskAnswer | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  // The visible-work beat (the author's presentation call, session brief
  // 3). PRESENTATION ONLY — the routing below runs instantly and
  // deterministically on-device before the timer starts, and nothing new
  // is logged. The words come from the author's FIXED pool
  // (lib/routing/ask-beat-pool.ts, CLAUDE.md's register rule): playful,
  // acknowledgment register, and never a deliberation label — nothing a
  // reader sees here is generated, and a deliberation word would claim
  // otherwise. The prohibited list lives with the pool.
  const [working, setWorking] = useState(false);
  // A03's answer, kept beside the routed answer rather than inside it:
  // an agenda hit is evidence from a document, not a step in a route.
  const [agenda, setAgenda] = useState<AgendaAnswer | null>(null);
  /*
   * THE GROUNDED ANSWER. It leads the panel, because it is the one that
   * resolves a canonical government and retrieves that government's own
   * records; everything else below it is navigation or a topic sweep.
   */
  const [grounded, setGrounded] = useState<GroundedReply | null>(null);
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
  /*
   * The SERVER own verdict on the government the reader named, when it has
   * one. It sees the whole corpus and this component sees the reader area, so
   * where the two disagree the server is right — and the disagreement was
   * reader-visible: this component said "we do not have a government recorded
   * under vail" about a government the server had already resolved.
   */
  const [serverEntity, setServerEntity] = useState<AgendaAnswer["namedEntity"]>(null);
  // Drawn per ask, in the browser, at click time — never during server
  // render, which would freeze one line into the HTML or mismatch on
  // hydration. Seeded with the first entry so the type is never null.
  const [beat, setBeat] = useState<string>(ASK_BEAT_POOL[0]);
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounce = useRef<number | undefined>(undefined);
  const blurTimer = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  // 6e (2026-08-14 second session), the author's retune: the beat showed
  // ~250ms and disappeared too quickly. It now holds ~3 seconds with the
  // trailing dots animating in sequence for the duration. Presentation
  // only, still: routing and logging happen before the timer starts.
  /**
   * **ASK-6 (2026-08-24, the author's instruction) — the beat is DRAWN, not
   * fixed.**
   *
   * It held exactly 3000ms on every ask since 2026-08-14, and a beat that is
   * the same length every single time reads as a progress bar somebody set to
   * a constant. The draw is between 2.4 and 3.1 seconds in 0.1-second steps —
   * eight values — taken FRESH PER SUBMISSION, so two asks in a row do not
   * match.
   *
   * **Presentation only, exactly as before.** The routing runs
   * deterministically on-device before this timer starts and nothing is logged
   * inside it, so the draw cannot change an answer or a record — it changes how
   * long the acknowledgment holds and nothing else. The floor and the ceiling
   * are named constants because the test reads them rather than a literal.
   */
  const BEAT_MIN_MS = 2400;
  const BEAT_MAX_MS = 3100;
  const BEAT_STEP_MS = 100;
  const drawBeatMs = () =>
    BEAT_MIN_MS +
    Math.floor(Math.random() * ((BEAT_MAX_MS - BEAT_MIN_MS) / BEAT_STEP_MS + 1)) *
      BEAT_STEP_MS;
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
      if (beatTimer.current) clearTimeout(beatTimer.current);
    };
  }, []);

  /*
   * The autocomplete index, carried over from the sidebar's search box
   * unchanged — including D18's reason for counting online meetings in the
   * cache token: a meeting held online is in no venue, so an index built
   * before it arrived would never be invalidated by it turning up.
   */
  const index = useMemo(() => {
    const online = meetings.filter((m) => m.location === null);
    const token = `${venues.map((v) => v.key).join(",")}|online:${online
      .map((m) => m.id)
      .join(",")}`;
    return getSearchIndex(token, () => buildSearchIndex(venues, [], online));
  }, [venues, meetings]);

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
      const body = (await response.json()) as { topic?: string | null };
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
   * A failure of any kind returns null and the panel degrades to the rungs
   * below rather than to a wrong answer.
   */
  const askGrounded = async (question: string): Promise<GroundedReply | null> => {
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
    try {
      const response = await fetch("/api/ask/grounded", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          ocdIds,
          approximateLocation: zip,
          surface: "MAP",
          activeSubjects: active,
          priorSubjects,
          priorTurns,
          locationOrigin: readLocationOriginFor(zip),
          /*
           * **READ, NEVER MINTED.** The Ask store's continuity value counts
           * distinct readers in a store that is not being written, so this
           * panel does not put a new identifier on anybody's device for a
           * capability that is switched off — this box keeps nothing on the
           * reader's machine, which is what the transparency page tells them.
           * Absent, the request carries none and the capture path refuses the
           * row rather than digesting an empty string, which would report one
           * distinct reader forever. Minting is part of ACTIVATION.
           *
           * Its OWN slot, whenever that day comes: sharing one with reactions
           * or Speak Your Mind would make one browser produce one value across
           * stores the constitution says share no key.
           */
          continuityKey: readBrowserKey("wtp.ask_key") ?? "",
        }),
      });
      if (!response.ok) return null;
      return (await response.json()) as GroundedReply;
    } catch {
      return null;
    }
  };

  /**
   * A03 (2026-08-18): the agenda rung.
   *
   * Asked BEFORE the classifier and independently of the topic router,
   * because "is there a data center coming?" is not a question about who
   * owns a topic — it is a question about what is on an agenda, and the two
   * are different answers to different questions. The corpus lives on the
   * server (about 850 KB of extracted document text), so the client asks it
   * rather than carrying it.
   *
   * Everything it returns is a line a clerk typed, quoted. Nothing here is
   * summarised or generated, and a failure of any kind returns null and
   * leaves the rest of the pipeline exactly as it was.
   */
  const askAgenda = async (
    question: string,
  ): Promise<AgendaAnswer | null> => {
    try {
      const response = await fetch("/api/ask/agenda", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The divisions the reader is standing in — the same approximate
        // basis the log row uses, and a better scope than distance: a
        // rezoning in your own town is your business at any distance.
        //
        // `TOPIC_ONLY` is the ownership boundary, declared. Under it the route
        // refuses to answer a named body's docket at all — that question now
        // belongs to `/api/ask/grounded` and to nothing else, and the refusal
        // lives in the server so this file cannot drift back into owning it.
        body: JSON.stringify({ question, ocdIds, scope: "TOPIC_ONLY" }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as AgendaAnswer;
      /*
       * ONE SHAPE on this surface. The route is called with `scope:
       * "TOPIC_ONLY"` and refuses the named-body docket, which the grounded
       * engine owns — so there is no second discriminator to read here.
       */
      /*
       * **THE TOPIC IS NOT THE ONLY THING WORTH KEEPING, AND THIS DISCARD HAS
       * NOW BITTEN THREE TIMES.**
       *
       * The original `body.topic ? body : null` threw away the whole reply
       * whenever the agenda rung had no topic — first the body-agenda answer,
       * and then the server-resolved namedEntity, which is precisely the case
       * where the topic IS null: a question naming a government that carries no
       * agenda keyword. The server had resolved Vail and this line dropped it.
       *
       * So the reply is kept when it carries anything the caller can use.
       */
      return "topic" in body && (body.topic || body.namedEntity) ? body : null;
    } catch {
      return null;
    }
  };

  const ask = () => {
    const question = text.trim();
    if (!question) return;

    // The beat starts immediately — it now covers real work on the refusal
    // path (one network call) as well as the deterministic path, and the
    // reader sees the same acknowledgment either way.
    if (beatTimer.current) clearTimeout(beatTimer.current);
    setAsked(null);
    setDigest(null);
    setAgenda(null);
    /* The standing grounded answer goes with the question it answered — a
       previous subject left on screen under a new question reads as this
       product having answered the new one about the old government. */
    setGrounded(null);
    setServerEntity(null);
    setBeat(drawAskBeat());
    setWorking(true);
    // Submitting an ASK releases the map filter and closes the autocomplete.
    // The question is not a narrowing, and leaving a stale one applied would
    // answer beside a map showing less than the answer talks about.
    window.clearTimeout(debounce.current);
    dispatch({ type: "search/input", query: "" });
    dispatch({ type: "search/open", open: false });

    void (async () => {
      const started = Date.now();
      let result = answerQuestion(question, coverage, zip, { entities });

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
       * **THE GROUNDED ENGINE RUNS FIRST, AND IT RUNS ON EVERY ASK.**
       * (PR #212 follow-up, 2026-08-28.)
       *
       * This is the line that closes the defect: before it, this component
       * answered from the classifier and the topic-agenda rung while the
       * grounded pipeline sat unused one directory away. Nothing below can
       * bypass it — it is awaited here, unconditionally, for every submission
       * that is not an exact-name navigation.
       *
       * The topic sweep runs beside it, scoped, because it answers a different
       * question. Both are awaited together rather than in sequence: they are
       * independent, and serialising two network calls would put the slower
       * one's latency on top of the faster one's for no reason.
       */
      const [groundedAnswer, agendaAnswer] = await Promise.all([
        askGrounded(question),
        askAgenda(question),
      ]);
      if (groundedAnswer) setGrounded(groundedAnswer);
      /*
       * The bounded conversation advances only when something CANONICAL was
       * resolved. A turn that resolved nothing contributes no referent, and
       * recording it would let a later pronoun point at a question rather than
       * at a government.
       */
      if (groundedAnswer?.subject) {
        const resolved = groundedAnswer.subject;
        setPriorSubjects((prior) =>
          [...prior, { id: resolved.id, name: resolved.name, kind: "PERSON" as const }].slice(-4),
        );
        setPriorTurns((prior) =>
          [...prior, { question, resolvedSubject: resolved.name }].slice(-4),
        );
      } else {
        setPriorTurns((prior) => [...prior, { question, resolvedSubject: null }].slice(-4));
      }
      /*
       * A03's remainder, closed 2026-08-19 (g20): a ZERO-HIT search is a
       * result and it renders.
       *
       * Until now this block rendered only when there was a hit, so a
       * reader who asked "is there a data center coming?" and got nothing
       * saw no trace that anything had been searched. Silence there reads
       * as "no", and "no" is precisely the claim we are not entitled to
       * make — the standing rule is that absence is never asserted, and a
       * search that ran and found nothing is not the same fact as a search
       * that never ran.
       *
       * So the rung reports whenever it RECOGNISED the topic, and the
       * sentence carries what it actually looked at. A null topic still
       * renders nothing: that means this rung had no opinion, not that it
       * looked and came back empty.
       */
      /*
       * **THE BODY-AGENDA BRANCH IS GONE FROM THIS SURFACE.**
       *
       * A named government's own docket is the grounded engine's question now,
       * and it answers it better: it reads the reader's TENSE (next versus
       * last, rather than `upcoming[0] ?? past[0]`), it prints the sitting in
       * the body's own time zone, and any prose it produces is validated
       * against the evidence pack it was built from. Keeping a second answer
       * to the same question here would put two governments' worth of truth on
       * one screen and let the reader pick.
       *
       * The route refuses that mode under `scope: "TOPIC_ONLY"`, so this is
       * enforced rather than merely intended.
       */
      if (agendaAnswer && "topic" in agendaAnswer) {
        if (agendaAnswer.namedEntity) setServerEntity(agendaAnswer.namedEntity);
        if (agendaAnswer.topic) setAgenda(agendaAnswer);
      }

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
      if (result.answer.kind !== "ROUTED" && !groundedAnswer?.subject) {
        const topic = await classify(question);
        if (topic) {
          result = answerQuestion(question, coverage, zip, {
            classified: topic,
            entities,
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
      // An agenda hit is an ANSWER, and the roadmap contains only what we
      // could not do — so a question this rung answered must not be logged
      // as a refusal. Same defect G05 rule 4d found with destinations, and
      // the fix is the same: the shared definition learns about the new
      // rung, rather than the component growing a second opinion.
      /* The two shapes again. A body-agenda answer counts as ONE answered rung —
         it named a government and answered from that government. */
      const topicAgenda =
        agendaAnswer && "topic" in agendaAnswer ? agendaAnswer : null;
      /* Only the TOPIC shape survives on this surface: the named-body docket
         is the grounded engine's question and the route refuses to answer it
         under the scope this component declares. */
      const answeredHits = topicAgenda?.hits.length ?? 0;
      /*
       * The grounded engine's own evidence counts as answered. Without this a
       * question it answered from real sourced records would be logged
       * `NO_ROUTE` with its text and filed into A06's roadmap of things this
       * product CANNOT do — building the roadmap out of the successes. That is
       * the g11 defect exactly, one rung later, and the fix is the same one:
       * the shared definition learns the new rung rather than this component
       * growing a second opinion. The evidence is assembled here so the call
       * below stays the one readable line `tests/ask-matcher.test.ts` pins.
       */
      const answeredEvidence = {
        agendaHits: answeredHits,
        groundedRecords: groundedAnswer?.records?.length ?? 0,
        groundedAnswer: Boolean(groundedAnswer?.answer),
      };
      if (askWasAnswered(result, answeredEvidence)) {
        logEvent("QUESTION_ASKED", ocdIds, {
          topic:
            result.match?.topicId ??
            (result.digest
              ? "DIGEST"
              : result.destination
                ? "DESTINATION_ONLY"
                : groundedAnswer?.subject
                  ? "GROUNDED"
                  : `AGENDA_${topicAgenda?.topic?.id ?? "TOPIC"}`),
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

      // The beat holds its full drawn length whatever the rung cost, so the
      // box never flickers on a fast answer or feels stalled on a slow one.
      // ASK-6: drawn once per submission, here, so the ask that started it is
      // the ask that gets that length.
      const remaining = Math.max(0, drawBeatMs() - (Date.now() - started));
      beatTimer.current = setTimeout(() => {
        setAsked(result);
        setDigest(built);
        setWorking(false);
      }, remaining);
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
        className="block text-[0.9375rem] font-semibold leading-snug text-paper"
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
      <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-voice">
        {/* F01 8.3 (2026-08-19, the author): "a pothole is close to the worst
            possible example to lead with." It reads as "report a pothole", and
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
            className="w-full min-w-0 rounded-md border border-[var(--panel-border)] bg-[var(--bg)] px-3 py-2 text-[0.875rem] placeholder:text-muted focus:border-[var(--signal)] focus:outline-none"
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
          onClick={ask}
          className="shrink-0 cursor-pointer rounded-md border border-[var(--action)] bg-[var(--action)] px-3.5 text-[0.8125rem] font-semibold text-[var(--action-on)] transition-opacity hover:opacity-90"
        >
          Ask
        </button>
      </div>

      {working && (
        // The beat — presentation only, and an acknowledgment rather than a
        // claim of deliberation. The static sentence is what a screen
        // reader announces; the cycling dots are visual, which is why the
        // author's trailing ellipsis is stripped from the stem.
        <p
          className="mt-2.5 text-[0.8125rem] italic leading-relaxed text-voice"
          aria-live="polite"
          data-ask-beat
        >
          {beatStem(beat)}
          <span aria-hidden="true">{".".repeat(dots)}</span>
        </p>
      )}

      {asked && digest && (
        <DigestAnswer
          digest={digest}
          coverage={coverage}
          onOpenBody={onOpenBody}
          onOpenPerson={onOpenPerson}
        />
      )}

      {asked && asked.destination && (
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
          <p className="mt-1 text-[0.9375rem] font-semibold leading-snug text-paper">
            {asked.destination.destination.label}
          </p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-voice">
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
              className="mt-2 inline-flex min-h-11 items-center rounded-md border border-[var(--signal)]/45 bg-[var(--signal)]/10 px-3 text-[0.8125rem] font-semibold text-link no-underline"
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
                    dispatch({ type: "list/open", open: true });
                  } else {
                    dispatch({ type: "door/open", door: action.door });
                  }
                }}
                className="mt-2 inline-flex min-h-11 items-center rounded-md border border-[var(--signal)]/45 bg-[var(--signal)]/10 px-3 text-[0.8125rem] font-semibold text-link"
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
      {grounded && (
        <div
          data-ask-grounded
          data-ask-grounded-mode={grounded.mode}
          data-ask-grounded-subject={grounded.subject?.id ?? undefined}
          className="mt-2.5 rounded-[8px] border border-[var(--panel-border)] p-3"
        >
          {grounded.subject && (
            <p className="text-[0.8125rem] font-semibold leading-snug text-paper">
              {grounded.subject.name}
              {grounded.subject.office ? (
                <span className="font-normal text-muted"> · {grounded.subject.office}</span>
              ) : null}
            </p>
          )}

          {/* Named, and more than one thing fits. ASKED — never chosen. */}
          {grounded.mode === "CLARIFY" && (
            <p
              data-ask-grounded-state="CLARIFY"
              className="text-[0.8125rem] leading-relaxed text-voice"
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
              className="text-[0.8125rem] leading-relaxed text-voice"
            >
              We don&rsquo;t have anything recorded under &ldquo;{grounded.mention}&rdquo;.
            </p>
          )}

          {/* The validated sentence, where one survived checking. */}
          {grounded.answer && (
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
              {grounded.answer}
            </p>
          )}

          {/* The structured half of the ladder: real records, no prose. */}
          {!grounded.answer && (grounded.records?.length ?? 0) > 0 && (
            <ul className="mt-1.5 space-y-1">
              {(grounded.records ?? [])
                .filter((r) => r.kind !== "CONTACT")
                .slice(0, 8)
                .map((r) => (
                  <li
                    key={r.id}
                    className="border-l-2 border-[var(--panel-border)] pl-3 text-[0.75rem] leading-relaxed text-paper-dim"
                  >
                    {r.text}
                  </li>
                ))}
            </ul>
          )}

          {/* Each gap says whose it is. "We haven't recorded this" is a fact
              about us; "they haven't published it" is a fact about them, and
              rendering them as one sentence is the defect the constitution
              names. */}
          {grounded.gaps?.map((g) => (
            <p
              key={g.statement}
              data-ask-gap={g.whose}
              className="mt-1.5 text-[0.75rem] leading-relaxed text-muted"
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
          {(grounded.contacts?.length ?? 0) > 0 && (
            <div className="mt-2" data-ask-contacts={grounded.contacts?.length}>
              <p className="t-eyebrow text-muted">Who this is</p>
              <ul className="mt-0.5 space-y-0.5">
                {(grounded.contacts ?? []).map((c) => (
                  <li key={c.id} className="text-[0.75rem] leading-relaxed text-paper-dim">
                    <span className="text-paper">{c.name}</span> — {c.relationship}
                    {c.email ? (
                      <>
                        {" · "}
                        <a
                          href={`mailto:${c.email}`}
                          className="underline decoration-dotted underline-offset-2 hover:text-link"
                        >
                          {c.email}
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
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
          {!grounded.answer &&
            (grounded.records?.length ?? 0) === 0 &&
            (grounded.gaps?.length ?? 0) === 0 &&
            grounded.mode !== "CLARIFY" &&
            grounded.mode !== "UNRESOLVED" && (
              <p
                data-ask-grounded-state="NOTHING_HELD"
                className="text-[0.8125rem] leading-relaxed text-voice"
              >
                {grounded.subject
                  ? `We hold ${grounded.subject.name}, but nothing recorded that answers that.`
                  : "We haven't recorded anything that answers that yet. Naming a government — a school district, a county board, someone on your ballot — is what this can answer from."}
              </p>
            )}

          {/* The sources, always, and a null publisher renders as the HOST
              rather than as a phrase like "the record" — a mechanical read of
              a URL already on screen, never a claim about who published it. */}
          {(() => {
            const sourced = (grounded.records ?? []).filter((r) => r.sourceUrl);
            if (sourced.length === 0) return null;
            const unique = [...new Map(sourced.map((r) => [r.sourceUrl, r])).values()];
            return (
              <p className="mt-2 text-[0.6875rem] text-muted">
                Source{unique.length > 1 ? "s" : ""}:{" "}
                {unique.map((r, i) => (
                  <span key={r.sourceUrl}>
                    {i > 0 ? ", " : ""}
                    <a
                      href={r.sourceUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-dotted underline-offset-2 hover:text-link"
                    >
                      {r.sourceOrg ?? hostOf(r.sourceUrl)}
                    </a>
                  </span>
                ))}
              </p>
            );
          })()}
        </div>
      )}

      {/*
        **THE SERVER'S VERDICT RENDERS ON EVERY PATH, NOT ONLY ON REFUSAL.**
        (2026-08-27.)

        It was inside the refusal block, which meant a question that ROUTED
        never showed it — and "when does the Vail school board meet" routes to
        schools-policy. So at a Tucson zip the reader was told *"We haven't
        matched 'vail' to a government near you"* by the step gap, while this
        component was holding the server's answer that we DO hold Vail and
        rendering it nowhere.

        That sentence is true — the client really did only search nearby — but
        stopping there when the better answer is already in hand is a different
        failure from the false one it replaced: honest, and needlessly unhelpful.
      */}
      {asked && serverEntity?.state === "BOUND" && (
        <p
          data-ask-server-entity="BOUND"
          data-ask-server-entity-id={serverEntity.ocdId}
          className="mt-2.5 text-[0.8125rem] leading-relaxed text-voice"
        >
          We do hold {serverEntity.name} — search for it by name to open it.
        </p>
      )}

      {/*
        A03 (2026-08-18): the refusal reads the SHARED definition of
        answered, with the agenda rung's evidence passed in — otherwise a
        reader who got a real answer off a real agenda would be told
        underneath it that we have no sourced answer for their question.
        Two contradictory sentences on one screen is worse than either.
      */}
      {asked &&
        !askWasAnswered(asked, { agendaHits: agenda?.hits.length ?? 0, groundedRecords: grounded?.records?.length ?? 0, groundedAnswer: Boolean(grounded?.answer) }) && (
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
                    {asked.binding.kind === "UNRESOLVED" && serverEntity?.state !== "BOUND" && (
            <p
              data-ask-entity-state="UNRESOLVED"
              className="text-[0.8125rem] leading-relaxed text-voice"
            >
              We haven&apos;t matched &ldquo;{asked.binding.mention}&rdquo; to a
              government near you.
            </p>
          )}
          {asked.binding.kind === "AMBIGUOUS" && (
            <p
              data-ask-entity-state="AMBIGUOUS"
              className="text-[0.8125rem] leading-relaxed text-voice"
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
          <p className="text-[0.8125rem] leading-relaxed text-voice">
            {asked.answer.statement}
          </p>
          {/*
            The author's ruling: where the classifier is pulled or unavailable,
            a weak match gets the honest refusal WITH THE DESTINATIONS OFFERED
            — never a low-confidence route. The offer is the four curated
            surfaces, named, so a refusal still leaves the reader somewhere to
            go. It claims nothing about their question.
          */}
          <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
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
          **THE NAMED GOVERNMENT'S OWN DOCKET MOVED, IT DID NOT DISAPPEAR.**
          (PR #212 follow-up, 2026-08-28.)

          This block rendered `/api/ask/agenda`'s body-agenda answer. That
          question — what has this named government scheduled to discuss —
          belongs to the grounded engine now, which answers it strictly
          better: it reads the reader's TENSE rather than taking
          `upcoming[0] ?? past[0]`, it prints the sitting in the body's own
          time zone rather than as a UTC instant a day off, and any prose it
          produces is validated against the pack it was built from.

          Two answers to one question on one screen is two definitions of Ask
          truth with the reader left to pick. The route refuses that mode
          under `scope: "TOPIC_ONLY"`, so this is enforced rather than
          merely intended, and the grounded block above is where it renders.
        */}

        {agenda && agenda.topic && (
          /*
            A03 (2026-08-18). Placed ABOVE the routed steps on purpose: the
            reader asked whether a thing is coming, and a line a clerk put
            on an agenda answers that question, where the body that owns
            the topic answers a different one. Both render; the direct
            answer leads.

            LEVEL register — this is a claim surface about what a
            government has scheduled. Every line inside is the document's
            own words, quoted, with the document linked beside it. Nothing
            here is summarised: a summary of a zoning agenda is a claim
            about what a government is about to do, made by us.

            The denominator is in the sentence, not in a tooltip. "3 of 3"
            and "3 of 40" are different answers and a reader who sees only
            the three cannot tell which they got.
          */
          <div className="mt-2">
            <p className="t-eyebrow text-muted">
              {agenda.hitsFound > 0
                ? "On an agenda near you"
                : "What we searched"}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-paper-dim">
              {agenda.searched === 0
                ? // Nothing searched is NOT nothing found. The two read the
                  // same to a reader unless we say which one happened.
                  `We don't hold any readable agendas for your area yet, so nothing was searched for ${agenda.topic?.label ?? "this"}. That is a gap in what we have, not a statement that nothing is planned.`
                : agenda.hitsFound === 0
                  ? `No mention of ${agenda.topic?.label ?? "this"} in the ${agenda.searched} agenda${agenda.searched === 1 ? "" : "s"} we hold for your area.`
                  : agenda.hits.length === agenda.hitsFound
                    ? `${agenda.hitsFound} mention${agenda.hitsFound === 1 ? "" : "s"} of ${agenda.topic?.label ?? "this"} across the ${agenda.searched} agenda${agenda.searched === 1 ? "" : "s"} we hold for your area.`
                    : `${agenda.hitsFound} mentions of ${agenda.topic?.label ?? "this"} across the ${agenda.searched} agendas we hold for your area — the first ${agenda.hits.length} are below.`}
              {agenda.unreadable > 0 &&
                ` ${agenda.unreadable} more agenda${agenda.unreadable === 1 ? "" : "s"} we hold but could not read, so ${agenda.unreadable === 1 ? "it is" : "they are"} not included.`}
            </p>
            {/*
              A03's remainder, stated where the reader is (2026-08-19, g20).
              This rung searches AGENDAS. A permit application, a rezoning
              filing and a site-plan submission all exist in a jurisdiction's
              permitting system BEFORE they reach an agenda, and often
              without ever reaching one. Letting "no mention on an agenda"
              stand unqualified would let a reader take it for "nothing has
              been filed" — a much bigger claim, about records we have not
              wired. So the limit of the corpus rides with the answer, in
              the hit case as well as the empty one: a reader who found one
              mention also needs to know there may be filings behind it.
            */}
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted">
              This searches meeting agendas — what bodies have scheduled to
              discuss. It is not the permit or zoning-application record:
              something can be filed with a planning department long before
              it reaches an agenda, and we haven&apos;t wired those systems
              yet.
            </p>
            <ul className="mt-1.5 space-y-2">
              {agenda.hits.map((hit) => (
                <li
                  key={`${hit.documentUrl}-${hit.quote.slice(0, 40)}`}
                  className="border-l-2 border-[var(--panel-border)] pl-3"
                >
                  {hit.bodyName && (
                    <p className="text-[0.75rem] font-medium text-paper">
                      {/* ASK-4: the body name is a door here too. */}
                      <BodyName
                        label={hit.bodyName}
                        ocdId={hit.ocdId}
                        coverage={coverage}
                        onOpenBody={onOpenBody}
                      />
                    </p>
                  )}
                  {/* The clerk's own line. Never rewritten, never trimmed
                      of meaning — only of length, and then it says so. */}
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-paper-dim">
                    &ldquo;{hit.quote}&rdquo;
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] text-muted">
                    {hit.sourceOrg}
                    {" · "}
                    <a
                      href={hit.agendaUrl ?? hit.documentUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-dotted underline-offset-2 hover:text-link"
                    >
                      the agenda
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

      {asked && asked.answer.kind === "ROUTED" && asked.answer.topic && (
        <div className="mt-3">
          {/* The answer's own header: eyebrow naming the register, the
              topic as the heading. Same data as before, dressed to be
              read as the authoritative answer it is. */}
          <p className="t-eyebrow text-signal">The answer</p>
          <p className="mt-1 text-[0.9375rem] font-semibold leading-snug text-paper">
            {asked.answer.topic.label}
          </p>
          {asked.contacts.length > 0 && (
            // The everyday answer: the office that owns the fix, with the
            // real line. A service line that owns the topic IS the answer.
            <div className="mt-2 space-y-2">
              {asked.contacts.map((contact) => (
                <div
                  key={`${contact.body}|${contact.service}`}
                  className="rounded-md border border-[var(--signal)]/35 bg-[var(--signal)]/5 p-3"
                >
                  <p className="text-[0.875rem] font-semibold text-paper">
                    {contact.body}
                  </p>
                  <p className="text-[0.75rem] leading-relaxed text-voice">
                    {contact.service}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                        className="font-mono text-[0.9375rem] font-semibold text-link"
                      >
                        {contact.phone}
                      </a>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-[0.75rem] text-link underline decoration-dotted underline-offset-2"
                      >
                        {contact.email}
                      </a>
                    )}
                    {contact.requestUrl && (
                      <a
                        href={contact.requestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[0.75rem] text-link underline decoration-dotted underline-offset-2"
                      >
                        online request
                      </a>
                    )}
                  </p>
                  {contact.note && (
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-voice">
                      {contact.note}
                    </p>
                  )}
                  {/*
                    **SRC-3 (2026-08-24) — ONE SOURCE LINE, AT THE BOTTOM.**

                    This was a per-item `source — {org}` link on every contact
                    card. It is the same sentence the meeting cards now carry,
                    in the same place, in the level register: the publisher is
                    named in full and verbatim, and it is not a competing click
                    target beside the phone number the reader came for.

                    The URL is NOT deleted — it is on the record, and the
                    battlecard this contact belongs to lists it under Sources.
                    What changed is what renders.
                  */}
                  <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
                    This was sourced from {contact.sourceOrg}.
                  </p>
                </div>
              ))}
            </div>
          )}
          <ol className="mt-2 space-y-2.5">
            {asked.answer.steps.map((step, i) => (
              <li key={i} className="text-[0.75rem] leading-relaxed">
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
                  <p className="mt-0.5 text-[0.8125rem]">
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
                  <ul className="mt-0.5 space-y-1 text-[0.8125rem]">
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
                          <span className="ml-1 text-[0.75rem]">
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
                    <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-voice">
                      {step.gap}
                    </p>
                  )}
              </li>
            ))}
          </ol>
          {/* The denominator, always stated — never implied completeness. */}
          <p className="mt-2 border-t border-[var(--panel-border)] pt-1.5 text-[0.625rem] leading-relaxed text-muted">
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
      <p className="mt-1 text-[0.9375rem] font-semibold leading-snug text-paper">
        What&apos;s going on
      </p>
      <p className="mt-0.5 text-[0.625rem] leading-relaxed text-muted">
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
          <li key={row.id} className="text-[0.75rem] leading-relaxed">
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
                  className="text-[0.6875rem] text-link underline decoration-dotted underline-offset-2"
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
          <li key={row.id} className="text-[0.75rem] leading-relaxed">
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
                  className="text-[0.6875rem] text-link underline decoration-dotted underline-offset-2"
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
          <li key={`${seatLabel}|${holder.id}`} className="text-[0.75rem] leading-relaxed">
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
        <p className="mt-2 text-[0.625rem] leading-relaxed text-muted">
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
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-voice">{gap}</p>
      ) : (
        <>
          <ul className="mt-1 space-y-1">{children}</ul>
          {/* Stated N equals rendered rows, and the denominator is always
              said — a clip must never read as the whole of what we hold. */}
          <p className="mt-1 text-[0.625rem] text-muted">
            Showing {shown} of {total}.
          </p>
        </>
      )}
    </div>
  );
}
