"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { CardSource } from "@/lib/officials/card-sources";

/** Fetched sections retain their citations after a disclosure closes. */
export const CardSourceContext = createContext<((key: string, sources: readonly CardSource[]) => void) | null>(null);
export function useCardSourceContribution(key: string, sources: readonly CardSource[]): boolean {
  const register = useContext(CardSourceContext);
  const serialized = JSON.stringify(sources);
  useEffect(() => { if (register && serialized !== "[]") register(key, JSON.parse(serialized) as CardSource[]); }, [key, register, serialized]);
  return register !== null;
}

/** One accumulation rule for the shared frame and the remaining body frame. */
export function useCardSourceRegistry(initial: readonly CardSource[], identity = "card") {
  const [contributed, setContributed] = useState<{ identity: string; rows: Readonly<Record<string, readonly CardSource[]>> }>({ identity, rows: {} });
  const register = useCallback((key: string, rows: readonly CardSource[]) => {
    setContributed(previous => previous.identity === identity && JSON.stringify(previous.rows[key]) === JSON.stringify(rows) ? previous : { identity, rows: { ...(previous.identity === identity ? previous.rows : {}), [key]: rows } });
  }, [identity]);
  const sources = [...new Map([...initial, ...Object.values(contributed.identity === identity ? contributed.rows : {}).flat()].map(row => [JSON.stringify(row), row])).values()];
  return { register, sources };
}
