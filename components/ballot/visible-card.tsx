"use client";

import { useRef, type ReactNode } from "react";

import { useCardVisibility } from "@/hooks/use-card-visibility";

/**
 * Records how long a server-rendered card is on screen; server components
 * cannot hold the visibility hook. Renders children unchanged.
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
