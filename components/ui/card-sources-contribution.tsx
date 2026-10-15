"use client";

import { useId } from "react";
import type { CardSource } from "@/lib/officials/card-sources";
import { useCardSourceContribution } from "./card-source-context";

/** Sections contribute citations; only the containing card renders Sources. */
export function CardSourcesContribution({ id, sources }: { id: string; sources: readonly CardSource[] }) {
  const instance = useId();
  useCardSourceContribution(`${id}:${instance}`, sources);
  return null;
}
