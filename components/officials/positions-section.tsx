"use client";

import { useEffect, useId, useRef, useState } from "react";

import { CardSection } from "@/components/officials/card-section";
import { useStanceTopics } from "@/hooks/use-stance-topics";
import type { PositionAnswer } from "@/lib/corpus/positions";
import { formatDateMDY } from "@/lib/map/format";
import { sourceKindLabel } from "@/lib/corpus/source-kinds";

/**
 * D35's THREE ANSWERS, ON SCREEN.
 *
 * The row's requirement is that the three are *"distinguishable in data and on
 * screen"*, and the second half is the one a component can get wrong. So the
 * three do not share a container, a colour or a sentence:
 *
 * * **MATCHED** renders the passages in their own words, each quoted, each
 *   with the page it came from and the date we read it. Filled treatment,
 *   because it is a present value.
 * * **SEARCHED_NOTHING_MATCHED** renders our search and its DENOMINATOR — "we
 *   read N pages and none of them mentioned it" — in the gap's register. It
 *   never says the person has no position, because we do not know that.
 * * **NOT_YET_COLLECTED** renders a different sentence entirely, about US, and
 *   offers their own page. It is a fact about our collection, and CLAUDE.md's
 *   named-gap rule is explicit that a fact about us and a fact about them may
 *   never render as the same sentence.
 *
 * Absence also never wears a present value's styling: both gaps render as
 * plain prose in the muted register, never as a quote block.
 *
 * **The search is this person's corpus only.** It is not the routing chat and
 * it never leaves this card — the row is explicit about that, and the route it
 * calls takes the subject in its path so it cannot answer for anyone else.
 */
export function PositionsSection({
  subjectId,
  subjectName,
  contentOnly = false,
}: {
  subjectId: string;
  /** Used only in the honest-gap sentences, so they read as English. */
  subjectName: string;
  /** The ballot already owns the Positions disclosure. */
  contentOnly?: boolean;
}) {
  const stanceTopics = useStanceTopics();
  const [topic, setTopic] = useState("");
  const [answer, setAnswer] = useState<
    (PositionAnswer & {
      totalMatches: number;
      holdingStatus?: "HELD" | "PARTIAL";
      unavailableAuthorities?: string[];
    }) | null
  >(null);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputId = useId();
  const request = useRef(0);

  useEffect(() => {
    return () => {
      // A card closing mid-flight must not land its answer on the next one.
      request.current += 1;
    };
  }, []);

  const look = async (value: string) => {
    const query = value.trim();
    setTopic(value);
    if (!query) {
      setAnswer(null);
      setFailed(false);
      return;
    }
    const ticket = (request.current += 1);
    setAsking(true);
    setFailed(false);
    try {
      const response = await fetch(
        `/api/positions/${encodeURIComponent(subjectId)}/${encodeURIComponent(query)}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as PositionAnswer & {
        totalMatches: number;
        holdingStatus?: "HELD" | "PARTIAL";
        unavailableAuthorities?: string[];
      };
      // The card may have moved on. A late answer for an old query is a wrong
      // answer, and the keyed-result rule says so in as many words.
      if (ticket !== request.current) return;
      setAnswer(body);
    } catch {
      if (ticket !== request.current) return;
      // A failed retrieval is reported as a failed retrieval. It is never
      // rendered as "nothing found", which would be a claim about a person
      // made because a request did not complete.
      setAnswer(null);
      setFailed(true);
    } finally {
      if (ticket === request.current) setAsking(false);
    }
  };

  const content = (
      <div data-positions-section>
        {/* The register here is PLAYFUL — this is an interaction surface, and
            everything it produces below is level. The seam is the rule. */}
        <label
          htmlFor={inputId}
          className="block text-[0.75rem] leading-relaxed text-voice"
        >
          Look through what {subjectName} has published, in their own words.
          Type a topic, or pick one.
        </label>
        <input
          id={inputId}
          data-positions-search
          type="text"
          value={topic}
          onChange={(e) => void look(e.target.value)}
          placeholder="housing, water, schools…"
          className="mt-1.5 w-full rounded-md border border-[var(--panel-border)] bg-[var(--bg)] px-3 py-2 text-[0.875rem] placeholder:text-muted focus:border-[var(--signal)] focus:outline-none"
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {stanceTopics.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => void look(t)}
              className="cursor-pointer rounded-full border border-[var(--panel-border)] px-2.5 py-1 text-[0.6875rem] text-voice hover:border-[var(--signal)] hover:text-signal"
            >
              {t}
            </button>
          ))}
        </div>

        {asking && (
          <p className="mt-2.5 text-[0.75rem] text-muted" aria-live="polite">
            Reading their pages…
          </p>
        )}

        {failed && (
          <p className="mt-2.5 text-[0.75rem] leading-relaxed text-signal">
            We could not read our record of their pages just now. That is a
            failure on our side — it is not a statement about what they have
            said. Try again in a moment.
          </p>
        )}

        {answer && !asking && (
          <div className="mt-2.5">
            {answer.holdingStatus === "PARTIAL" && (
              <p
                className="mb-2 text-[0.6875rem] leading-relaxed text-signal"
                data-positions-holding-status="PARTIAL"
              >
                These passages are held and source-linked, but an independent
                statement or identity holding is unavailable. This is not a
                complete count; unavailable: {(answer.unavailableAuthorities ?? []).join(", ")}.
              </p>
            )}
            {answer.kind === "MATCHED" && (
              <div data-positions-answer="MATCHED">
                {answer.passages.map((p) => (
                  <figure
                    key={p.snapshotId + p.quote.slice(0, 24)}
                    className="mt-2 rounded-md border border-[var(--signal)]/35 bg-[var(--signal)]/5 p-3"
                  >
                    {/* Verbatim, and marked as a quotation so a screen reader
                        knows these are not our words either. */}
                    <blockquote className="t-record text-[0.8125rem] leading-relaxed text-paper">
                      &ldquo;{p.quote}&rdquo;
                    </blockquote>
                    <figcaption className="mt-1.5 text-[0.625rem] leading-relaxed text-muted">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted underline-offset-2 hover:text-link"
                      >
                        {sourceKindLabel(p.kind)}
                      </a>{" "}
                      · last checked {formatDateMDY(p.retrievedAt.slice(0, 10))}
                      {p.changedSince && (
                        // THAT it changed, and when we last saw it different.
                        // Never what changed, and never what it means.
                        <>
                          {" "}
                          ·{" "}
                          <span className="text-signal">
                            this page changed since{" "}
                            {formatDateMDY(p.changedSince.slice(0, 10))}
                          </span>
                        </>
                      )}
                    </figcaption>
                  </figure>
                ))}
                {/*
                  THE OVERCLAIM THIS LINE EXISTS TO PREVENT, found by reading
                  the real output rather than the code: a state legislator's
                  official page is often a BILL LIST, so a passage matching
                  "housing" can be a row of bill titles. It is genuinely
                  verbatim and genuinely theirs — but under a header reading
                  "Positions", a bill title could be read as a stance on the
                  bill, which is a claim nobody here is entitled to make.

                  The honest fix is not to filter (that would be us deciding
                  which of their words count) and not to characterise. It is to
                  say exactly what the match is: a mention on a page they
                  publish. The reader draws the inference, with the link right
                  there.
                */}
                <p className="mt-2 text-[0.625rem] leading-relaxed text-muted">
                  {answer.holdingStatus === "PARTIAL" ? "Showing" : `Showing ${answer.passages.length} of`} {answer.totalMatches}{" "}
                  passage{answer.totalMatches === 1 ? "" : "s"} that{" "}
                  {answer.totalMatches === 1 ? "mentions" : "mention"} &ldquo;
                  {answer.topic}&rdquo;, across {answer.searched.pages} page
                  {answer.searched.pages === 1 ? "" : "s"} of theirs we hold.
                  These are passages from pages they publish — a mention is not
                  the same as a position on it, and we quote and link rather
                  than characterise either way.
                </p>
              </div>
            )}

            {answer.kind === "SEARCHED_NOTHING_MATCHED" && (
              // OUR search, bounded by its own denominator. Never "no position".
              <p
                data-positions-answer="SEARCHED_NOTHING_MATCHED"
                className="text-[0.75rem] leading-relaxed text-voice"
              >
                {answer.searched.presentButUnquotable > 0 ? (
                  <>
                    {/*
                      ITEM 13 (2026-08-19). The two outcomes are DIFFERENT
                      FACTS and used to render as one sentence.

                      "None of their pages mentions it" is a claim about
                      them. "It is on their page, in a block we will not
                      quote" is a claim about US — our passage rules. A press
                      release rail is a run of headlines with no full stop,
                      so it is one enormous passage, and quoting a clip of it
                      would break a word (RULING 7) and attribute template
                      chrome to a person (RULING 6). Declining is right;
                      saying they never mentioned it was not.
                    */}
                    &ldquo;{answer.topic}&rdquo; does appear on{" "}
                    {answer.searched.presentButUnquotable === 1
                      ? "a page"
                      : `${answer.searched.presentButUnquotable} places on pages`}{" "}
                    we hold from {subjectName} — but only inside a block we
                    won&apos;t quote from, like a run of headlines or a list
                    of links with no sentence in it. Those aren&apos;t their
                    words about the topic, so we don&apos;t show them as such.
                    We read {answer.searched.pages} page
                    {answer.searched.pages === 1 ? "" : "s"} of theirs and
                    found nothing quotable on it.
                  </>
                ) : (
                  <>
                    We read {answer.searched.pages} page
                    {answer.searched.pages === 1 ? "" : "s"} of theirs (
                    {answer.searched.snapshots} snapshot
                    {answer.searched.snapshots === 1 ? "" : "s"}) and none of
                    them mentions &ldquo;{answer.topic}&rdquo;.
                  </>
                )}
                {answer.searched.unreadable > 0 && (
                  <>
                    {" "}
                    {answer.searched.unreadable} more page
                    {answer.searched.unreadable === 1 ? "" : "s"} we hold could
                    not be read, so {answer.searched.unreadable === 1 ? "it was" : "they were"}{" "}
                    not searched.
                  </>
                )}
                {answer.theirPage && (
                  <>
                    {" "}
                    <a
                      href={answer.theirPage}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link underline decoration-dotted underline-offset-2"
                    >
                      Their own page
                    </a>{" "}
                    is the place to look next.
                  </>
                )}
              </p>
            )}

            {answer.kind === "NOT_YET_COLLECTED" && (
              // A DIFFERENT sentence, about a different thing: our collection,
              // not our search. These two may never read alike.
              <p
                data-positions-answer="NOT_YET_COLLECTED"
                className="text-[0.75rem] leading-relaxed text-voice"
              >
                We haven&apos;t collected anything {subjectName} has published
                yet, so there was nothing here to search.
                {answer.theirPage ? (
                  <>
                    {" "}
                    <a
                      href={answer.theirPage}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link underline decoration-dotted underline-offset-2"
                    >
                      Their own page
                    </a>{" "}
                    is where to read them in the meantime.
                  </>
                ) : (
                  <> We haven&apos;t found a page of theirs to link to either.</>
                )}
              </p>
            )}
          </div>
        )}
      </div>
  );
  return contentOnly ? content : <CardSection title="Positions">{content}</CardSection>;
}
