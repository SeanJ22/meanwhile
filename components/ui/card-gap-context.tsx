"use client";

import { useContext } from "react";
import { useReaderCopy } from "@/hooks/use-reader-copy";
import { DemandPill } from "@/components/demand/demand-pill";
import { feedbackHref } from "@/lib/feedback/shape";
import { mergeCardGaps, type CardGap } from "@/lib/design/card-gaps";
import { CardSubjectContext } from "./card-subject-context";

/** Missing information stays beside the facts it belongs to. */
export function CardGapContribution(gap: CardGap & { inline?: boolean }) {
  const readerCopy = useReaderCopy();
  const inheritedSubject = useContext(CardSubjectContext);
  const subject = gap.subject === undefined ? inheritedSubject : gap.subject;
  if ((gap.count ?? 1) <= 0) return null;
  const Frame = gap.inline ? "span" : "div";
  return <Frame data-card-gap={gap.id} className="my-2 t-detail leading-relaxed text-voice">
    <span>{gap.kind === "not-posted" ? `${gap.label.charAt(0).toUpperCase()}${gap.label.slice(1)} not posted yet.` : readerCopy("copy.working")}</span>{" "}
    {subject ? <DemandPill subjectType={subject.type} subjectId={subject.id} inline={gap.inline} />
      : <a className="text-link hover:underline" href={feedbackHref({ about: gap.label })}>Want us to get this sooner?</a>}
  </Frame>;
}

/** A section needs one request even when several of its facts are missing. */
export function CardGapsContribution({ id, gaps }: { id: string; gaps: readonly CardGap[] }) {
  const missing = mergeCardGaps(gaps);
  const uncollected = missing.find(gap => gap.kind !== "not-posted");
  const unposted = [...new Map(missing.filter(gap => gap.kind === "not-posted").map(gap => [gap.label, gap])).values()];
  return <>{unposted.map(gap => <CardGapContribution key={gap.id} {...gap} />)}
    {uncollected && <CardGapContribution {...uncollected} id={id} />}</>;
}
