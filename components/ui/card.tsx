"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import { CardSourceContext } from "./card-source-context";
import { X } from "lucide-react";
import type { CardSource } from "@/lib/officials/card-sources";
import { CardSourcesList } from "@/components/officials/card-sources-list";
import { CardSection, CardSectionGroup } from "@/components/officials/card-section";
import { WorkingOnIt } from "@/components/demand/working-on-it";

/** Shared reader frame. Sources are required even when the list is empty. */
export function Card({
  title, eyebrow, onClose, children, sources, sourcesContent, className = "", independent = false, titleVisible = true,
}: {
  title: string;
  eyebrow?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  sources: CardSource[];
  /** Server-rendered Sources rows use the same disclosure as fetched rows. */
  sourcesContent?: ReactNode;
  className?: string;
  independent?: boolean;
  /** Identity blocks already carry the person's visible name. */
  titleVisible?: boolean;
}) {
  const titleId = useId();
  const [contributed, setContributed] = useState<Readonly<Record<string, readonly CardSource[]>>>({});
  const register = useCallback((key: string, rows: readonly CardSource[]) => {
    setContributed(previous => JSON.stringify(previous[key]) === JSON.stringify(rows) ? previous : { ...previous, [key]: rows });
  }, []);
  const allSources = [...new Map([...sources, ...Object.values(contributed).flat()].map(row => [JSON.stringify(row), row])).values()];
  return (
    <CardSourceContext.Provider value={register}><article className={`reader-card ${className}`} aria-labelledby={titleId}>
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
            <CardSection title="Sources" meta={allSources.length ? String(allSources.length) : null}>
              {allSources.length > 0 && <CardSourcesList sources={allSources} />}
              {sourcesContent}
              {!allSources.length && !sourcesContent && <WorkingOnIt />}
            </CardSection>
          </div>
        </CardSectionGroup>
      </div>
    </article></CardSourceContext.Provider>
  );
}
