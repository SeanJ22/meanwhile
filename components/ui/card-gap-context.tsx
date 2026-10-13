"use client";

import { createContext, useCallback, useContext, useEffect, useId, useState } from "react";
import { mergeCardGaps, type CardGap } from "@/lib/design/card-gaps";
import { CardSubjectContext } from "./card-subject-context";

export const CardGapContext = createContext<((key: string, gaps: readonly CardGap[]) => void) | null>(null);

export function useCardGapContribution(key: string, gaps: readonly CardGap[]) {
  const register = useContext(CardGapContext);
  const subject = useContext(CardSubjectContext);
  const serialized = JSON.stringify(gaps.map(gap => ({ ...gap, subject: gap.subject === undefined ? subject : gap.subject })));
  useEffect(() => {
    if (!register) return;
    register(key, JSON.parse(serialized) as CardGap[]);
    return () => register(key, []);
  }, [key, register, serialized]);
}

export function CardGapsContribution({ id, gaps }: { id: string; gaps: readonly CardGap[] }) {
  const instance = useId();
  useCardGapContribution(`${id}:${instance}`, gaps);
  return null;
}

export function CardGapContribution(gap: CardGap) {
  return <CardGapsContribution id={gap.id} gaps={[gap]} />;
}

export function useCardGapRegistry(initial: readonly CardGap[] = [], identity = "card") {
  const parent = useContext(CardGapContext);
  const instance = useId();
  useCardGapContribution(`frame:${instance}`, initial);
  const [contributed, setContributed] = useState<{ identity: string; rows: Readonly<Record<string, readonly CardGap[]>> }>({ identity, rows: {} });
  const register = useCallback((key: string, gaps: readonly CardGap[]) => {
    setContributed(previous => previous.identity === identity && JSON.stringify(previous.rows[key] ?? []) === JSON.stringify(gaps) ? previous
      : { identity, rows: { ...(previous.identity === identity ? previous.rows : {}), [key]: gaps } });
  }, [identity]);
  const gaps = mergeCardGaps([...initial, ...Object.values(contributed.identity === identity ? contributed.rows : {}).flat()]);
  return { register: parent ?? register, gaps, insideCard: parent !== null };
}
