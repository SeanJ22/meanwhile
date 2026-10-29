"use client";

import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { useReaderCopy } from "@/hooks/use-reader-copy";
import { DemandPill } from "@/components/demand/demand-pill";
import { feedbackHref } from "@/lib/feedback/shape";
import { mergeCardGaps, type CardGap } from "@/lib/design/card-gaps";
import { CardSubjectContext } from "./card-subject-context";
import { readerText } from "@/lib/text/reader-names";

type Gap = CardGap & { inline?: boolean };
const SectionGaps = createContext<((key: string, gap: Gap | null) => void) | null>(null);

/** Missing fields contribute to their nearest section, which shows one request. */
export function CardGapSection({ children, label, inherit = false }: { children: ReactNode; label: string; inherit?: boolean }) {
  const parent = useContext(SectionGaps);
  const id = useId();
  const [gaps, setGaps] = useState<Readonly<Record<string, Gap>>>({});
  const register = useCallback((key: string, gap: Gap | null) => {
    setGaps(previous => {
      if (JSON.stringify(previous[key] ?? null) === JSON.stringify(gap)) return previous;
      const next = { ...previous };
      if (gap) next[key] = gap;
      else delete next[key];
      return next;
    });
  }, []);
  if (inherit && parent) return children;
  const missing = mergeCardGaps(Object.values(gaps));
  const uncollected = missing.filter(gap => gap.kind !== "not-posted");
  const subject = uncollected.length && uncollected.every(gap => gap.subject?.type === uncollected[0].subject?.type && gap.subject?.id === uncollected[0].subject?.id)
    ? uncollected[0].subject : null;
  const unposted = [...new Map(missing.filter(gap => gap.kind === "not-posted").map(gap => [gap.label, gap])).values()];
  return <SectionGaps.Provider value={register}>
    {children}
    {unposted.map(gap => <GapMessage key={gap.label} {...gap} id={`${id}:${gap.label}`} />)}
    {uncollected.length > 0 && <GapMessage id={id} label={label} subject={subject} />}
  </SectionGaps.Provider>;
}

export function CardGapContribution(gap: Gap) {
  const register = useContext(SectionGaps);
  const inheritedSubject = useContext(CardSubjectContext);
  const instance = useId();
  const serialized = JSON.stringify({ ...gap, subject: gap.subject === undefined ? inheritedSubject : gap.subject });
  useEffect(() => {
    if (!register) return;
    register(instance, JSON.parse(serialized) as Gap);
    return () => register(instance, null);
  }, [instance, register, serialized]);
  return register ? <span hidden data-card-gap-contribution={gap.id} /> : <GapMessage {...gap} />;
}

/** The one line a section renders for its missing information. */
function GapMessage(gap: Gap) {
  const readerCopy = useReaderCopy();
  const inheritedSubject = useContext(CardSubjectContext);
  const subject = gap.subject === undefined ? inheritedSubject : gap.subject;
  if ((gap.count ?? 1) <= 0) return null;
  const Frame = gap.inline ? "span" : "div";
  const label = readerText(gap.label);
  return <Frame data-card-gap={gap.id} className="my-2 t-detail leading-relaxed text-voice">
    <span>{gap.kind === "not-posted" ? `${label.charAt(0).toUpperCase()}${label.slice(1)} not posted yet.` : readerCopy("copy.working")}</span>{" "}
    {subject ? <DemandPill subjectType={subject.type} subjectId={subject.id} inline={gap.inline} />
      : <a className="text-link hover:underline" href={feedbackHref({ about: gap.label, intent: "sooner" })}>Want us to get this sooner?</a>}
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
