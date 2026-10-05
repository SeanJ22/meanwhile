"use client";

import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import type { CardSource } from "@/lib/officials/card-sources";
import { CardSourcesList } from "@/components/officials/card-sources-list";
import { CardSection, CardSectionGroup } from "@/components/officials/card-section";
import { WorkingOnIt } from "@/components/demand/working-on-it";

/** Shared reader frame. Sources are required even when the list is empty. */
export function Card({
  title, eyebrow, onClose, children, sources, className = "", independent = false, titleVisible = true,
}: {
  title: string;
  eyebrow?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  sources: CardSource[];
  className?: string;
  independent?: boolean;
  /** Identity blocks already carry the person's visible name. */
  titleVisible?: boolean;
}) {
  const titleId = useId();
  return (
    <article className={`reader-card ${className}`} aria-labelledby={titleId}>
      <header className="reader-card-header">
        <div>
          {eyebrow && <div className="t-caption text-label">{eyebrow}</div>}
          <h2 id={titleId} className={titleVisible ? "t-title font-semibold text-paper" : "sr-only"}>{title}</h2>
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
          <div data-card-sources="">
            <CardSection title="Sources" meta={sources.length ? String(sources.length) : null}>
              {sources.length ? <CardSourcesList sources={sources} /> : <WorkingOnIt />}
            </CardSection>
          </div>
        </CardSectionGroup>
      </div>
    </article>
  );
}
