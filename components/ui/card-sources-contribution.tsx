"use client";

import type { CardSource } from "@/lib/officials/card-sources";
import { useCardSourceContribution } from "./card-source-context";
import { CardSection } from "@/components/officials/card-section";
import { CardSourcesList } from "@/components/officials/card-sources-list";

/** A section contributes to its card, or has a Sources disclosure when used alone. */
export function CardSourcesContribution({ id, sources }: { id: string; sources: readonly CardSource[] }) {
  const insideCard = useCardSourceContribution(id, sources);
  if (insideCard || sources.length === 0) return null;
  return <div data-card-sources><CardSection title="Sources" keepMounted><CardSourcesList sources={[...sources]} /></CardSection></div>;
}
