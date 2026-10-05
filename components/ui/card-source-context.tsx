"use client";

import { createContext, useContext, useEffect } from "react";
import type { CardSource } from "@/lib/officials/card-sources";

/** Fetched sections retain their citations after a disclosure closes. */
export const CardSourceContext = createContext<((key: string, sources: readonly CardSource[]) => void) | null>(null);
export function useCardSourceContribution(key: string, sources: readonly CardSource[]): boolean {
  const register = useContext(CardSourceContext);
  const serialized = JSON.stringify(sources);
  useEffect(() => { if (register && serialized !== "[]") register(key, JSON.parse(serialized) as CardSource[]); }, [key, register, serialized]);
  return register !== null;
}
