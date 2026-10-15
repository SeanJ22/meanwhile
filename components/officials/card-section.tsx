"use client";

// @server-boundary-exempt setOpenId is a React context value created by
// CardSectionGroup and read by CardSection, both client components; it never
// crosses from a Server Component.

import { CardGapContribution, CardGapsContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";

import {
  Children,
  Fragment,
  isValidElement,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

/**
 * One top-level pill open at a time inside a group. A context, so a
 * `CardSection` inside a group is exclusive by default and one outside keeps
 * its own state. `level="sub"` sections are never exclusive.
 */
interface CardSectionGroupValue {
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /** Every section opens and closes on its own while keeping the group. */
  independent: boolean;
}

const CardSectionGroupContext = createContext<CardSectionGroupValue | null>(null);

export function CardSectionGroup({
  children,
  independent = false,
}: {
  children: React.ReactNode;
  independent?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ openId, setOpenId, independent }), [openId, independent]);
  return (
    <CardSectionGroupContext.Provider value={value}>
      {children}
    </CardSectionGroupContext.Provider>
  );
}

/**
 * A collapsible section of held facts. A section that resolves to only gap
 * or source contributions stays mounted without an empty disclosure.
 */
export function CardSection({
  title,
  /** Beside the title: a count, a date range. Never a judgement. */
  meta,
  defaultOpen = false,
  /** `"sub"` is a section inside another section's pane, indented and stepped down in scale. */
  level = "top",
  keepMounted = true,
  children,
}: {
  title: string;
  meta?: string | null;
  defaultOpen?: boolean;
  level?: "top" | "sub";
  /** Sections keep their facts, gaps and citations registered while closed. */
  keepMounted?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const group = useContext(CardSectionGroupContext);
  // Only top-level pills join the group.
  const grouped = group !== null && !group.independent && level !== "sub";

  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const [empty, setEmpty] = useState(false);
  // Async sections may resolve to contributions only. Keep them mounted to
  // register their gap, while omitting a disclosure with no readable content.
  const observeContent = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const check = () => setEmpty(!node.textContent?.trim() && !node.querySelector("img,svg,video,audio,canvas,input,button,a[href]"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  const open = grouped ? group.openId === id : localOpen;

  // A grouped section that starts open claims the group's slot at mount; last one wins.
  useEffect(() => {
    if (grouped && defaultOpen) group!.setOpenId(id);
    // Mount only: re-running on `openId` would reopen it after the reader closed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    if (grouped) group!.setOpenId(open ? null : id);
    else setLocalOpen((v) => !v);
  };

  if (!hasSectionContent(children)) return <>{children}</>;

  return (
    <section
      className="card-section"
      hidden={empty && title !== "Sources"}
      data-open={open || undefined}
      data-level={level === "sub" ? "sub" : undefined}
    >
      <button
        type="button"
        className="card-section-header"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
      >
        <span className="card-section-title">{title}</span>
        {meta && <span className="card-section-meta">{meta}</span>}
        <svg
          className="card-section-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {(open || keepMounted) && (
        <div ref={observeContent} id={id} className="card-section-body" hidden={!open}>
          {children}
        </div>
      )}
    </section>
  );
}

/** Contributions register at the frame even when a section has no visible facts. */
function hasSectionContent(children: React.ReactNode): boolean {
  return Children.toArray(children).some(child => {
    if (!isValidElement<{ children?: React.ReactNode }>(child)) return typeof child === "number" || (typeof child === "string" && child.trim().length > 0);
    if (child.type === CardGapContribution || child.type === CardGapsContribution || child.type === CardSourcesContribution) return false;
    if (child.type === Fragment) return hasSectionContent(child.props.children);
    return true;
  });
}
