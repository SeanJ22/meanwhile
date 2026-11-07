"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import type { CardSource } from "@/lib/officials/card-sources";
import type { Tier } from "@/lib/ocd/tiers";
import { TIER_LABEL } from "@/lib/ocd/tiers";
import { centerWhenStable } from "@/lib/ballot/center-card";

/** One card open at a time across the whole ballot, scorecard included. */
const AccordionContext = createContext<{ openId: string | null; toggle: (id: string) => void } | null>(null);

export function ResultAccordion({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = useCallback((id: string) => setOpenId(current => current === id ? null : id), []);
  const value = useMemo(() => ({ openId, toggle }), [openId, toggle]);
  return <AccordionContext.Provider value={value}>
    <div className="rc-accordion" data-open={openId ? "true" : undefined}>{children}</div>
  </AccordionContext.Provider>;
}

export interface ResultCardProps {
  id: string;
  title: string;
  tier?: Tier | null;
  /** Under the title: "Vote for 1 · 4-year term", "Yes or no". */
  rule?: string | null;
  /** Always visible under the header: outcome and status rows. */
  summary?: ReactNode;
  sources: CardSource[];
  attrs?: Readonly<Record<`data-${string}`, string>>;
  className?: string;
  /** Visible in the header beside the title (jurisdiction mark). */
  titleAfter?: ReactNode;
  /** Expanded body. */
  children: ReactNode;
}

export function ResultCard({ id, title, tier = null, rule = null, summary, sources, attrs, className = "", titleAfter, children }: ResultCardProps) {
  const accordion = useContext(AccordionContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = accordion ? accordion.openId === id : localOpen;
  const root = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const toggle = () => accordion ? accordion.toggle(id) : setLocalOpen(value => !value);
  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    if (opened && root.current) return centerWhenStable(root.current);
  }, [open]);
  const bodyId = `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}-body`;
  return <div ref={root} className="rc-root">
    <Card title={title} titleVisible={false} sources={sources} attrs={{ ...attrs, "data-result-card": id, "data-open": open ? "true" : "false" }}
      className={`rc-card ${className}`}>
      <div className="rc-header" onClick={event => { if (!(event.target as HTMLElement).closest("a,button,input,textarea,select")) toggle(); }}>
        <button type="button" className="rc-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <span className="rc-heading">
            <span className="rc-title-row">
              <span className="rc-title" aria-hidden="true">{title}</span>
              {tier && <span className="rc-tier" style={{ color: `var(--accent-${tier})` }}>{TIER_LABEL[tier]}</span>}
              {titleAfter}
            </span>
            {rule && <span className="rc-rule">{rule}</span>}
          </span>
          <span className="rc-chevron" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 7l4.5 4.5L13.5 7" /></svg>
          </span>
        </button>
        {summary && <div className="rc-summary">{summary}</div>}
      </div>
      <div id={bodyId} className="rc-body" hidden={!open}>{children}</div>
    </Card>
  </div>;
}
