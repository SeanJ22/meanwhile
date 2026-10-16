"use client";

import { CardGapContribution } from "@/components/ui/card-gap-context";
import { useEffect, useId, useRef, useState } from "react";

import { CardSection } from "@/components/officials/card-section";
import { useStanceTopics } from "@/hooks/use-stance-topics";
import type { PositionAnswer } from "@/lib/corpus/positions";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { sourceKindLabel } from "@/lib/corpus/source-kinds";
import { AskAnswerRecords } from "@/components/ask/answer-records";
import type { StoredTopicAnswer } from "@/lib/corpus/topic-answers";


export function PositionsSection({
  subjectId,
  subjectName,
  contentOnly = false,
  topicAnswers,
}: {
  subjectId: string;
  /** Used only in the honest-gap sentences, so they read as English. */
  subjectName: string;
  /** The ballot already owns the Positions disclosure. */
  contentOnly?: boolean;
  /** Answers published ahead of time, keyed by chip label; a chip with one renders it without a request. */
  topicAnswers?: Readonly<Record<string, StoredTopicAnswer>>;
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
  const [stored, setStored] = useState<StoredTopicAnswer | null>(null);
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
    const ready = topicAnswers?.[query] ?? null;
    request.current += 1;
    setStored(ready);
    if (ready) {
      setAnswer(null);
      setFailed(false);
      setAsking(false);
      return;
    }
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
      // A late answer for an old query is dropped.
      if (ticket !== request.current) return;
      setAnswer(body);
    } catch {
      if (ticket !== request.current) return;
      // A failed retrieval is never rendered as "nothing found".
      setAnswer(null);
      setFailed(true);
    } finally {
      if (ticket === request.current) setAsking(false);
    }
  };

  const content = (
      <div data-positions-section>
        {answer?.kind === "MATCHED" && <CardSourcesContribution id={`positions:${subjectId}:${answer.topic}`} sources={answer.passages.map(passage => ({ what: `Published passages mentioning ${answer.topic}`, provenance: { sourceUrl: passage.url, sourceOrg: `${subjectName} · ${sourceKindLabel(passage.kind)}`, collectedAt: passage.retrievedAt, verifiedAt: null } }))} />}

        <label
          htmlFor={inputId}
          className="block t-detail leading-relaxed text-voice"
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
          className="mt-1.5 w-full rounded-md border border-[var(--panel-border)] bg-[var(--bg)] px-3 py-2 t-body placeholder:text-muted focus:border-[var(--signal)] focus:outline-none"
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {stanceTopics.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => void look(t)}
              className="cursor-pointer rounded-full border border-[var(--panel-border)] px-2.5 py-1 t-caption text-voice hover:border-[var(--signal)] hover:text-signal"
            >
              {t}
            </button>
          ))}
        </div>

        {stored && (
          <div className="mt-2.5" data-positions-stored={stored.topicId}>
            {stored.prose || stored.records.length > 0 ? (
              <>
                {stored.prose && <p className="t-body leading-relaxed text-paper" data-positions-stored-prose>{stored.prose}</p>}
                <AskAnswerRecords records={stored.records} initiallyOpen={!stored.prose} />
              </>
            ) : (
              <CardGapContribution id={`positions:${subjectId}:${topic}`} label={topic ? `published statements about ${topic}` : "published statements"} subject={{ type: "CANDIDATE", id: subjectId }} />
            )}
          </div>
        )}

        {asking && (
          <p className="mt-2.5 t-detail text-muted" aria-live="polite">
            Reading their pages…
          </p>
        )}

        {failed && <CardGapContribution id={`positions:${subjectId}:${topic}`} label={topic ? `published statements about ${topic}` : "published statements"} subject={{ type: "CANDIDATE", id: subjectId }} />}

        {answer && !asking && (
          <div className="mt-2.5">
            {answer.holdingStatus === "PARTIAL" && <CardGapContribution id={`positions:${subjectId}:${topic}`} label={topic ? `published statements about ${topic}` : "published statements"} subject={{ type: "CANDIDATE", id: subjectId }} />}

            {answer.kind === "MATCHED" && (
              <div data-positions-answer="MATCHED">
                {answer.passages.map((p) => (
                  <figure
                    key={p.snapshotId + p.quote.slice(0, 24)}
                    className="mt-2 rounded-md border border-[var(--signal)]/35 bg-[var(--signal)]/5 p-3"
                  >
                    {/* Verbatim, marked as a quotation. */}
                    <blockquote className="t-record t-body leading-relaxed text-paper">
                      &ldquo;{p.quote}&rdquo;
                    </blockquote>

                  </figure>
                ))}
                {/* A match is a mention on a page they publish (often a bill list), never a stance. */}
                <p className="mt-2 t-caption leading-relaxed text-muted">
                  {answer.holdingStatus === "PARTIAL" ? "Showing" : `Showing ${answer.passages.length} of`} {answer.totalMatches}{" "}
                  passage{answer.totalMatches === 1 ? "" : "s"} that{" "}
                  {answer.totalMatches === 1 ? "mentions" : "mention"} &ldquo;
                  {answer.topic}&rdquo;, across {answer.searched.pages} page
                  {answer.searched.pages === 1 ? "" : "s"} of theirs we hold.
                </p>
              </div>
            )}

            {answer.kind === "SEARCHED_NOTHING_MATCHED" && <CardGapContribution id={`positions:${subjectId}:${topic}`} label={topic ? `published statements about ${topic}` : "published statements"} subject={{ type: "CANDIDATE", id: subjectId }} />}
            {answer.kind === "NOT_YET_COLLECTED" && <CardGapContribution id={`positions:${subjectId}:${topic}`} label={topic ? `published statements about ${topic}` : "published statements"} subject={{ type: "CANDIDATE", id: subjectId }} />}
          </div>
        )}
      </div>
  );
  return contentOnly ? content : <CardSection title="Positions">{content}</CardSection>;
}
