"use client";

import { CardGapContribution } from "@/components/ui/card-gap-context";
import type { CardGap } from "@/lib/design/card-gaps";

/** Ask's whole-answer absence uses the same request as missing card sections. */
export function WorkingOnIt({ about, subject, attrs, className, inline = false }: {
  about?: string | null;
  subject?: CardGap["subject"];
  attrs?: Record<`data-${string}`, string>;
  className?: string;
  inline?: boolean;
}) {
  const Frame = inline ? "span" : "div";
  return <Frame data-working-on-it="not-searched" {...attrs} className={className}>
    <CardGapContribution id="ask-answer" label={about ?? "an answer"} subject={subject} inline={inline} />
  </Frame>;
}
