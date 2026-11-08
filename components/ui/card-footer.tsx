"use client";

import { CardSection } from "@/components/officials/card-section";
import { CardSourcesList } from "@/components/officials/card-sources-list";
import type { CardSource } from "@/lib/officials/card-sources";

/** Every source stays in the card's final section. */
export function CardFooter({ sources }: { sources: CardSource[] }) {
  return <div data-card-footer>
    <div data-card-sources="">
      <CardSection title="Sources" keepMounted={sources.length === 0} meta={sources.length ? String(sources.length) : null}>
        <CardSourcesList sources={sources} />
      </CardSection>
    </div>
  </div>;
}
