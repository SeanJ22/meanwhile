"use client";

import { useRef, type ReactNode } from "react";

import { useCardVisibility } from "@/hooks/use-card-visibility";

/**
 * A server-rendered card that records how long it is on screen (S2.4, October
 * 1, 2026). The ballot's cards are server components, which cannot hold the
 * visibility hook; this thin client wrapper does and renders its children
 * unchanged.
 */
export function VisibleCard({
  cardId,
  cardKind,
  className,
  children,
}: {
  cardId: string;
  cardKind: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCardVisibility(ref, cardId, cardKind);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
