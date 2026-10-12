"use client";

import { useContext } from "react";
import { CardSubjectContext } from "@/components/ui/card-subject-context";
import { DemandPill, type DemandSubjectType } from "./demand-pill";
import { mayShowNotFound, type SweepRecord } from "@/lib/corpus/statement-sweep";
import { copy } from "@/lib/design/copy";
import { useCardSourceContribution } from "@/components/ui/card-source-context";
import { CardSourcesList } from "@/components/officials/card-sources-list";
import type { CardSource } from "@/lib/officials/card-sources";
import { useReaderCopy } from "@/hooks/use-reader-copy";

/**
 * What a reader sees wherever we do not hold the information yet: the one
 * sentence, plus the "Want us to get this info sooner?" tap where the gap
 * belongs to a body or a candidate.
 */
export const WORKING_ON_IT = copy("copy.working");

export type WorkingState =
  | { kind: "not-searched" }
  | { kind: "searched"; topic: string; sweep: SweepRecord; checkedAt?: string }
  | { kind: "not-published"; item: string };

export function workingLine(state?: WorkingState): string {
  if (state?.kind === "not-published") return copy("copy.notPublished", {}, { item: state.item });
  if (state?.kind === "searched" && mayShowNotFound(state.sweep, state.topic)) return copy("copy.notFound");
  return WORKING_ON_IT;
}

export function WorkingOnIt({
  about,
  subject,
  attrs,
  className,
  state,
  inline = false,
}: {
  /** A name the gap is about, said after the sentence. */
  about?: string | null;
  /** The body or candidate the tap is for. No subject, no pill. */
  subject?: { type: DemandSubjectType; id: string } | null;
  /** The data-* markers the surface already carries for this state. */
  attrs?: Record<`data-${string}`, string>;
  className?: string;
  state?: WorkingState;
  /** For a row, sentence, or counter that cannot contain a block. */
  inline?: boolean;
}) {
  const Frame = inline ? "span" : "div";
  const Text = inline ? "span" : "p";
  const inheritedSubject = useContext(CardSubjectContext);
  const demandSubject = subject === undefined ? inheritedSubject : subject;
  const readerCopy = useReaderCopy();
  const searched = state?.kind === "searched" && mayShowNotFound(state.sweep, state.topic) ? state : null;
  const searchedSources: CardSource[] = searched ? (searched.sweep.topics.find(row => row.topic === searched.topic)?.sourcesSearched ?? []).map(source => ({
    what: `${searched.topic}: sources checked (${source.kindLabel})`, provenance: { sourceUrl: source.url, sourceOrg: source.kindLabel, collectedAt: searched.checkedAt ?? "", verifiedAt: null },
  })) : [];
  const insideCard = useCardSourceContribution(searched ? `sweep:${searched.sweep.subjectId}:${searched.topic}` : "gap", searchedSources);
  const line = state?.kind === "not-published" ? readerCopy("copy.notPublished", { item: state.item })
    : state?.kind === "searched" && mayShowNotFound(state.sweep, state.topic) ? readerCopy("copy.notFound") : readerCopy("copy.working");
  return (
    <Frame data-working-on-it={state?.kind ?? "not-searched"} {...attrs} className={className}>
      <Text className="t-body leading-relaxed text-voice">
        {about && (!state || state.kind === "not-searched") ? `${line} on ${about}.` : `${line}.`}
      </Text>
      {searched && !insideCard && !inline && <div data-card-sources><details><summary>Sources</summary><CardSourcesList sources={searchedSources} /></details></div>}
      {demandSubject ? <DemandPill subjectType={demandSubject.type} subjectId={demandSubject.id} className="mt-1" /> : null}
    </Frame>
  );
}
