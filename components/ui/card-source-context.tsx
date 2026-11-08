"use client";

import { createContext, useCallback, useContext, useEffect, useId, useState } from "react";
import { mergeSources, type CardSource } from "@/lib/officials/card-sources";

/** Fetched sections retain their citations after a disclosure closes. */
export type CardSourceRegister = (key: string, sources: readonly CardSource[]) => void;
export const CardSourceContext = createContext<CardSourceRegister | null>(null);
const sourceTargets = new WeakMap<HTMLElement, CardSourceRegister>();
const sourceWaiters = new WeakMap<HTMLElement, Set<() => void>>();

/** Late sections join a hydrated ballot card's existing Sources registry. */
export function cardSourceTarget(register: CardSourceRegister) {
  let previous: HTMLElement | null = null;
  return (node: HTMLElement | null) => {
    if (previous && sourceTargets.get(previous) === register) sourceTargets.delete(previous);
    previous = node;
    if (node) {
      sourceTargets.set(node, register);
      sourceWaiters.get(node)?.forEach(notify => queueMicrotask(notify));
    }
  };
}

export const cardSourceTargetFor = (node: HTMLElement) => sourceTargets.get(node);
export function waitForCardSourceTarget(node: HTMLElement, notify: () => void): () => void {
  const listeners = sourceWaiters.get(node) ?? new Set<() => void>();
  listeners.add(notify);
  sourceWaiters.set(node, listeners);
  return () => { listeners.delete(notify); if (!listeners.size) sourceWaiters.delete(node); };
}
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
