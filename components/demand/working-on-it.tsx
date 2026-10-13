"use client";

import { useContext, useId } from "react";
import { CardGapContext, useCardGapContribution } from "@/components/ui/card-gap-context";
import type { CardGap } from "@/lib/design/card-gaps";
import { useReaderCopy } from "@/hooks/use-reader-copy";

/** Ask's whole-answer absence; inside a card it joins the card's single gap line. */
export function WorkingOnIt({ about, subject, attrs, className, inline = false }: {
  about?: string | null;
  subject?: CardGap["subject"];
  attrs?: Record<`data-${string}`, string>;
  className?: string;
  inline?: boolean;
}) {
  const insideCard = useContext(CardGapContext) !== null;
  const id = useId();
  useCardGapContribution(`ask:${id}`, [{ id: `ask:${id}`, label: about ? `information on ${about}` : "an answer", subject }]);
  const readerCopy = useReaderCopy();
  if (insideCard) return null;
  const Frame = inline ? "span" : "div";
  return <Frame data-working-on-it="not-searched" {...attrs} className={className}>
    {readerCopy("copy.working")}{about ? ` on ${about}.` : "."}
  </Frame>;
}
