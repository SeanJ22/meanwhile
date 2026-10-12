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
 * The Ask panel: one input, two jobs. An autocomplete pick or an exact name is
 * a search and navigates without writing a question row; anything else goes to
 * `/api/ask/grounded`, awaited on every ask. `askWasAnswered` is the single
 * definition of "answered", shared by the render and the log.
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
          {/* One source line, at the bottom. */}
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
  /** For the log only; never district truth. */
  zip: string | null;
  /** The divisions in view, for the log row. */
  ocdIds: string[];
  /** Fly the map to a result and open its popup. Absent, the panel is ask-only with no autocomplete. */
  onSearchPick?: (item: SearchItem) => void;
  /** Opens a body's battlecard; the same opener the who-governs card uses. */
  onOpenBody?: (body: CoveredBody) => void;
  /** Opens a person's battlecard; the same opener the who-governs card uses. */
  onOpenPerson?: (holder: SeatHolder) => void;
}) {
  const { venues, meetings, allMeetings, everydayRouting } = useShellData();
  const ui = useUi();
  /* The reader's home, so an Ask subject is not browse-scoped only. */
  const home = useResolvedLocation(zip);
  const dispatch = useUiDispatch();

  const [text, setText] = useState("");
  const [asked, setAsked] = useState<AskAnswer | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  // Presentation only: the beat words come from a fixed pool, never generated.
  const [working, setWorking] = useState(false);
  const [grounded, setGrounded] = useState<AskAnswerPayload | null>(null);
  /* Follow-up context: the last few resolved subjects, in memory for this mount only. */
  const [priorSubjects, setPriorSubjects] = useState<AskSubjectRef[]>([]);
  const [priorTurns, setPriorTurns] = useState<
    { question: string; resolvedSubject: string | null }[]
  >([]);
  // Drawn per ask in the browser, never during server render.
  const [beat, setBeat] = useState<string>(ASK_BEAT_POOL[0]);
  const debounce = useRef<number | undefined>(undefined);
  const blurTimer = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  /* The beat shows only while the answer is being worked out. */
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
   * Online meetings count in the cache token: they are in no venue, so an
   * index built before they arrived would never be invalidated otherwise.
   */
  const index = useMemo(() => {
    const online = meetings.filter((m) => isOnlineOnly(m));
    const token = `${venues.map((v) => v.key).join(",")}|online:${online
      .map((m) => m.id)
      .join(",")}`;
    return getSearchIndex(token, () => buildSearchIndex(venues, [], online));
  }, [venues, meetings]);

  /* Ids match the search index's own `meeting:${id}` shape. */
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
   * The map filter commits only when the text matches something in the index,
   * so typing a question never empties the map.
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
   * Asked only after the keyword matcher refused; picks a curated topic and
   * writes none of the answer. Any failure returns null.
   */
  const classify = async (question: string): Promise<string | null> => {
    try {
      const response = await fetch("/api/ask/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as AskClassifyReply;
      return typeof body.topic === "string" ? body.topic : null;
    } catch {
      return null;
    }
  };

  /**
   * The one network call for an answer. A failed request returns
   * `transportFailure()`, never null.
   */
  const askGrounded = async (question: string, confirmation?: BodyConfirmation): Promise<AskAnswerPayload> => {
    const active: AskSubjectRef[] = [];
    if (ui.selectedDistrictOcdId) {
      active.push({
        id: ui.selectedDistrictOcdId,
        name: ui.selectedDistrictOcdId,
        kind: "BODY",
        /* The reader clicked this district open. */
        focused: true,
      });
    }
    /* Where the reader lives is present but not focused, so "my district" does not bind to the last tap. */
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
          /* Anonymous per-browser key in its own storage slot; the server stores only a hash. */
          continuityKey: getOrCreateBrowserKey("wtp.ask_key"),
        }),
      });
      if (!response.ok) return transportFailure();
      /* Parsed through the contract; an unknown mode is a transport failure. */
      return readAskAnswer(await response.json()) ?? transportFailure();
    } catch {
      return transportFailure();
    }
  };

  const ask = (confirmation?: BodyConfirmation) => {
    const question = confirmation?.question ?? text.trim();
    if (!question) return;
    if (confirmation) setText(question);

    setAsked(null);
    setDigest(null);
    setGrounded(null);
    setBeat(drawAskBeat());
    setWorking(true);
    // Submitting an ask releases the map filter and closes the autocomplete.
    window.clearTimeout(debounce.current);
    dispatch({ type: "search/input", query: "" });
    dispatch({ type: "search/open", open: false });

    void (async () => {
      let result = answerQuestion(question, coverage, zip, { entities, everydayRouting });

      /* An exact name is a search: it navigates and returns before any question is logged. */
      if (result.exactName && onSearchPick) {
        const hit = index.find((item) => item.id === result.exactName!.entity.id);
        if (hit) {
          setWorking(false);
          pick(hit);
          return;
        }
      }

      const groundedAnswer = await askGrounded(question, confirmation);
      setGrounded(groundedAnswer);
      /* Only a canonical resolution becomes a referent for later turns. */
      if (groundedAnswer?.subject) {
        const resolved = groundedAnswer.subject;
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
      /* The classifier runs only after the matcher refused and the grounded engine bound nothing. */
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

      if (groundedAnswer.mode === "TRANSPORT_FAILED") {
        /* A request that never reached the engine is not logged. */
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
        // The question rides along capped and identifier-free.
        logEvent("QUESTION_ASKED", ocdIds, {
          topic: "NO_ROUTE",
          routed: false,
          question: question.slice(0, REFUSAL_LOG_MAX_CHARS),
        });
      }

      // Built from `allMeetings`, before the UI's filters.
      const built = result.digest
        ? buildDigest(coverage, allMeetings, Date.now())
        : null;

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
      // Enter on a highlighted row is a search; with nothing highlighted, an ask.
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
   * A grounded subject with no contacts must not hide a verified contact the
   * topic router holds; that contact renders under its own body name and source.
   */
  const preservedRoutedContact = Boolean(
    grounded?.subject &&
      (grounded.contacts?.length ?? 0) === 0 &&
      asked &&
      asked.answer.kind === "ROUTED" &&
      asked.answer.topic &&
      asked.contacts.length > 0,
  );

  return (
    <div
      data-ask-panel
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
      {/* Categories are read from `ROUTABLE_CATEGORIES`, so the copy promises only what routes. */}
      <p className="mt-0.5 t-caption leading-relaxed text-voice">
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
        // The static sentence is what a screen reader announces; the dots are visual.
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
                    /* The bound subject comes from the grounded answer; null opens the list unfocused. */
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

      {grounded && showGroundedAnswer(asked, grounded) && (
        <div
          data-ask-grounded
          data-ask-grounded-mode={grounded.mode}
          data-ask-grounded-subject={grounded.subject?.id ?? undefined}
          /* `overscroll-contain` keeps the map from scrolling at the end of the answer. */
          className="mt-2.5 max-h-[60vh] overflow-y-auto overscroll-contain rounded-[8px] border border-[var(--panel-border)] p-3"
        >
          {/* Dismisses the answer and keeps the question in the box. */}
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

          {grounded.mode === "UNRESOLVED" && (
            <p
              data-ask-grounded-state="UNRESOLVED"
              className="t-body leading-relaxed text-voice"
            >
              {unresolvedReadLine(grounded)}
            </p>
          )}

          {grounded.mode === "OFF" && (
            <WorkingOnIt attrs={{ "data-ask-grounded-state": "OFF" }} />
          )}

          {grounded.mode === "TRANSPORT_FAILED" && (
            <p
              data-ask-state="TRANSPORT_FAILED"
              className="t-body leading-relaxed text-voice"
            >
              That didn&rsquo;t reach us. Try again in a moment.
            </p>
          )}

          {grounded.answer && !grounded.agendaLead && (
            <p className="mt-1.5 t-body leading-relaxed text-paper-dim">
              {grounded.answer}
            </p>
          )}

          {/* Keyed on record body ids, never on names in the prose. */}
          <AnswerBodies
            grounded={grounded}
            coverage={coverage}
            onOpenBody={onOpenBody}
          />

          {/* `CalendarLinks` renders nothing for a meeting that is not scheduled. */}
          {(grounded.meetings?.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1" data-ask-calendar>
              {(grounded.meetings ?? [])
                .filter((sitting) => typeof sitting.timeZone === "string" && sitting.timeZone)
                .map((sitting) => (
                <CalendarLinks
                  key={sitting.id}
                  meeting={{
                    ...sitting,
                    bodyId: sitting.bodyId ?? undefined,
                    /* A sitting with no zone is filtered out above. */
                    timeZone: sitting.timeZone as string,
                    agendaUrl: sitting.agendaUrl ?? null,
                  }}
                />
                ))}
            </div>
          )}

          <AskAnswerRecords records={grounded.records ?? []} initiallyOpen={!grounded.answer} agendaLead={grounded.agendaLead} prose={grounded.agendaLead ? grounded.answer : null} />

          {gapsNotInAnswer(grounded.answer, grounded.gaps ?? []).map((g) => (
            <p
              key={g.statement}
              data-ask-gap={g.whose}
              className="mt-1.5 t-detail leading-relaxed text-muted"
            >
              {g.statement}
            </p>
          ))}

          <AskAnswerContacts contacts={grounded.contacts ?? []} />

          {/* Fires only when the grounded subject has no contacts of its own. */}
          {preservedRoutedContact && asked && (
            <div className="mt-3" data-ask-preserved-contact>
              <p className="t-eyebrow text-signal">Who handles this</p>
              <p className="mt-1 t-heading font-semibold text-paper">
                {asked.answer.topic?.label}
              </p>
              <RoutedContactCards contacts={asked.contacts} />
            </div>
          )}

          {/* Suppressed when a routed contact is shown above. */}
          {!preservedRoutedContact &&
            !grounded.answer &&
            (grounded.records?.length ?? 0) === 0 &&
            (grounded.gaps?.length ?? 0) === 0 &&
            grounded.mode !== "CLARIFY" &&
            grounded.mode !== "UNRESOLVED" &&
             /* Both of these render their own sentence above. */
            grounded.mode !== "OFF" &&
            grounded.mode !== "TRANSPORT_FAILED" && (
              <WorkingOnIt
                attrs={{ "data-ask-grounded-state": "NOTHING_HELD" }}
                about={grounded.subject?.name}
                subject={grounded.subject?.kind === "BODY" ? { type: "BODY", id: grounded.subject.id } : null}
              />
            )}

          {/* A null publisher renders as the URL's host. */}
          {(() => {
             /* One line per publisher, not per document. */
            const links = sourceLinks(grounded.records ?? []);
            if (links.length === 0) return null;
            return (
              /* `data-ask-sources` is the publisher count. */
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

      {/* Silent on a transport failure; the grounded block says what happened. */}
      {asked &&
        grounded?.mode !== "TRANSPORT_FAILED" &&
        !askWasAnswered(asked, grounded) && (
          <div data-ask-refusal className="mt-2.5">
          {/* Only where the server did not resolve the name either. */}
          {asked.binding.kind === "UNRESOLVED" && !grounded?.subject && (
            <WorkingOnIt attrs={{ "data-ask-entity-state": "UNRESOLVED" }} about={`“${asked.binding.mention}”`} />
          )}
          {asked.binding.kind === "AMBIGUOUS" && !grounded?.subject && (
            <p
              data-ask-entity-state="AMBIGUOUS"
              className="t-body leading-relaxed text-voice"
            >
              More than one government goes by that name —{" "}
              {asked.binding.candidates.map((c) => c.name).join(" and ")}. Say
              which kind you mean — &ldquo;school district&rdquo;,
              &ldquo;town&rdquo; — and we&apos;ll answer for that one.
            </p>
          )}
          <p className="t-body leading-relaxed text-voice">
            {asked.answer.statement}
          </p>
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

      {asked && asked.answer.kind === "ROUTED" && asked.answer.topic && !answerSaysSomething(grounded) && (
        <div className="mt-3">
          <p className="t-eyebrow text-signal">The answer</p>
          <p className="mt-1 t-heading font-semibold leading-snug text-paper">
            {asked.answer.topic.label}
          </p>
          {asked.contacts.length > 0 && (
            <RoutedContactCards contacts={asked.contacts} />
          )}
          <ol className="mt-2 space-y-2.5">
            {asked.answer.steps.map((step, i) => (
              <li key={i} className="t-detail leading-relaxed">
                <p className="text-voice">{step.why}</p>
                {step.bodies.length > 0 && (
                  /* With no opener the name renders as plain text, never an external link. */
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
                  /* A person with no published contact renders their name only. */
                  <ul className="mt-0.5 space-y-1 t-body">
                    {step.people.map((person) => (
                      <li key={person.id}>
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
                {/* Each gap sentence is said once per answer, on the first step that hits it. */}
                {step.gap &&
                  asked.answer.steps.findIndex((s) => s.gap === step.gap) === i && (
                    <p className="mt-0.5 t-caption leading-relaxed text-voice">
                      {step.gap}
                    </p>
                  )}
              </li>
            ))}
          </ol>
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
 * Body doors for the governments an answer named: the grounded subject and
 * every record's `bodyId`, deduplicated and resolved against the coverage
 * payload. Unresolved ones are dropped; nothing renders when none resolve.
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
    /* Matches a registry body id or a division whose governing body the payload carries. */
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
 * Resolves a body for an opener by exact ocd-id and `#governing` / `#board`
 * slot, never by name. No match renders plain text.
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
  /** Body names in digest rows open their battlecards. */
  onOpenBody?: (body: CoveredBody) => void;
  /** Every person named in the digest opens their battlecard. */
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
        // Census enumerates no boundary for these governments, so they cannot be scoped to a point.
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
        <p className="mt-1 t-caption leading-relaxed text-voice">{gap}</p>
      ) : (
        <>
          <ul className="mt-1 space-y-1">{children}</ul>
          {/* Stated N equals rendered rows. */}
          <p className="mt-1 t-caption text-muted">
            Showing {shown} of {total}.
          </p>
        </>
      )}
    </div>
  );
}
