"use client";

import { useContext } from "react";
import { CardSection } from "@/components/officials/card-section";
import { CardSourcesList } from "@/components/officials/card-sources-list";
import { DemandPill } from "@/components/demand/demand-pill";
import { cardGapLine, type CardGap } from "@/lib/design/card-gaps";
import type { CardSource } from "@/lib/officials/card-sources";
import { CardSubjectContext } from "./card-subject-context";

/** The foot of a card: one missing-information line, one request, then its sources. */
export function CardFooter({ gaps, sources }: { gaps: readonly CardGap[]; sources: CardSource[] }) {
  const inheritedSubject = useContext(CardSubjectContext);
  const subjects = [...new Map(gaps.flatMap(gap => gap.subject ? [[`${gap.subject.type}:${gap.subject.id}`, gap.subject] as const] : [])).values()];
  const subject = inheritedSubject ?? (subjects.length === 1 ? subjects[0] : null);
  const line = cardGapLine(gaps);
  return <div data-card-footer>
    {line && <div className="px-5 py-3">
      <p data-card-gap className="t-detail leading-relaxed text-voice">{line}</p>
      {subject && <DemandPill key={`${subject.type}:${subject.id}`} subjectType={subject.type} subjectId={subject.id} className="mt-1" />}
    </div>}
    <div data-card-sources="">
      <CardSection title="Sources" keepMounted meta={sources.length ? String(sources.length) : null}>
        <CardSourcesList sources={sources} />
      </CardSection>
    </div>
  </div>;
}
