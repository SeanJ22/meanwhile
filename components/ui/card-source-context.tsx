"use client";

import { createContext, useCallback, useContext, useEffect, useId, useState } from "react";
import { mergeSources, type CardSource } from "@/lib/officials/card-sources";

/** Fetched sections retain their citations after a disclosure closes. */
export const CardSourceContext = createContext<((key: string, sources: readonly CardSource[]) => void) | null>(null);
export function useCardSourceContribution(key: string, sources: readonly CardSource[]): boolean {
  const register = useContext(CardSourceContext);
  const serialized = JSON.stringify(sources);
  useEffect(() => {
    if (!register) return;
    register(key, JSON.parse(serialized) as CardSource[]);
    return () => register(key, []);
  }, [key, register, serialized]);
  return register !== null;
}

/** One accumulation rule for the shared frame and the remaining body frame. */
export function useCardSourceRegistry(initial: readonly CardSource[], identity = "card") {
  const parent = useContext(CardSourceContext);
  const instance = useId();
  useCardSourceContribution(`frame:${instance}`, initial);
  const [contributed, setContributed] = useState<{ identity: string; rows: Readonly<Record<string, readonly CardSource[]>> }>({ identity, rows: {} });
  const register = useCallback((key: string, rows: readonly CardSource[]) => {
    setContributed(previous => previous.identity === identity && JSON.stringify(previous.rows[key] ?? []) === JSON.stringify(rows) ? previous : { identity, rows: { ...(previous.identity === identity ? previous.rows : {}), [key]: rows } });
  }, [identity]);
  const sources = mergeSources([...initial, ...Object.values(contributed.identity === identity ? contributed.rows : {}).flat()]);
  return { register: parent ?? register, sources, insideCard: parent !== null };
}
