"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

const ReaderNamesContext = createContext<readonly string[]>([]);

/** Held names travel with their reader view, including nested cards and Sources. */
export function ReaderNamesProvider({ names, children }: { names: readonly string[]; children: ReactNode }) {
  const inherited = useReaderNames();
  const value = useMemo(() => [...new Set([...inherited, ...names].filter(Boolean))], [inherited, names]);
  return <ReaderNamesContext value={value}>{children}</ReaderNamesContext>;
}

export function useReaderNames(): readonly string[] {
  return useContext(ReaderNamesContext);
}
