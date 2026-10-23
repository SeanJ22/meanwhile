"use client";

import { useId, type ReactNode } from "react";
import { CardSourceContext, useCardSourceRegistry } from "./card-source-context";
import { X } from "lucide-react";
import type { CardSource } from "@/lib/officials/card-sources";
import { CardFooter } from "./card-footer";
import { CardGapContext, useCardGapRegistry } from "./card-gap-context";
import type { CardGap } from "@/lib/design/card-gaps";
import { CardSectionGroup } from "@/components/officials/card-section";
import { ReaderNamesProvider } from "./reader-names-context";
import { readerText } from "@/lib/text/reader-names";

/** Shared reader frame. Sources are required even when the list is empty. */
export function Card({
  title, eyebrow, onClose, children, sources, gaps = [], className = "", independent = false, titleVisible = true, attrs, titleAfter,
}: {
  title: string;
  /** Inline identity tag; follows the last word and wraps with the title. */
  titleAfter?: ReactNode;
  attrs?: Readonly<Record<`data-${string}`, string>>;
  eyebrow?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  sources: CardSource[];
  gaps?: readonly CardGap[];
  className?: string;
  independent?: boolean;
  /** Identity blocks already carry the person's visible name. */
  titleVisible?: boolean;
}) {
  const titleId = useId();
  const { register, sources: allSources, insideCard } = useCardSourceRegistry(sources, title);
  const { register: registerGaps, gaps: allGaps } = useCardGapRegistry(gaps, title);
  return (
    <ReaderNamesProvider names={[title]}><CardSourceContext.Provider value={register}><CardGapContext.Provider value={registerGaps}><article {...attrs} className={`reader-card ${className}`} aria-labelledby={titleId}>
      <header className="reader-card-header">
        <div>
          {eyebrow && <div className="t-caption text-label">{typeof eyebrow === "string" ? readerText(eyebrow) : eyebrow}</div>}
          <h2 id={titleId} className={titleVisible ? "t-title font-semibold text-paper" : "sr-only"}>{readerText(title)}{titleAfter && <> {titleAfter}</>}</h2>
        </div>
        {onClose && (
          <button type="button" className="reader-card-close" onClick={onClose} aria-label={`Close ${title}`}>
            <X aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="reader-card-body t-body text-paper">
        <CardSectionGroup independent={independent}>
          {children}
          {!insideCard && <CardFooter gaps={allGaps} sources={allSources} />}
        </CardSectionGroup>
      </div>
    </article></CardGapContext.Provider></CardSourceContext.Provider></ReaderNamesProvider>
  );
}
