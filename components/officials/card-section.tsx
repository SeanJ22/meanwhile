"use client";

// @server-boundary-exempt setOpenId is a REACT CONTEXT value, not a component
// prop. It is created by CardSectionGroup and read by CardSection, both of them
// client components inside one boundary, so it never crosses from a Server
// Component and the 500 this guard prevents cannot occur here. The guard reads
// interface members and cannot tell a context value from a prop; renaming it to
// onSetOpen would slip past while making the name worse.

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

/**
 * **ONE PILL OPEN AT A TIME** — F01 4.1, 2026-08-19.
 *
 * Opening a pill collapses every other, so only one is ever expanded. The
 * instance was Ciscomani's card with Committees and Offices near you both
 * standing open; the rule is the class.
 *
 * ## Why a context and not a prop
 *
 * The pills on a person's card are constructed by FIVE different components —
 * `official-modal` owns four of them directly, and `MemberDirectory`,
 * `PositionsSection`, `RecentVotes` and `KeyVotes` each own their own. Lifting
 * `open` into a prop would mean threading it through all five and every future
 * one, and the first component that forgot would silently reintroduce exactly
 * the defect. A context makes the DEFAULT correct: a `CardSection` inside a
 * group is exclusive without its author doing anything, and a `CardSection`
 * outside one keeps its own state as before, so nothing that is not a person
 * card changes behaviour.
 *
 * This is the pill sibling of the standing one-popup-at-a-time rule. There was
 * no shared implementation of that rule to extend — it is enforced per surface
 * in `map-entry` — so this is the first one, and it is written to be the one a
 * later surface reuses rather than a second copy of the idea.
 *
 * ## Sub-sections are deliberately NOT exclusive
 *
 * `level="sub"` sections ("Votes on laws", "Votes on people") live INSIDE
 * another section's open pane. Closing one because the reader opened its
 * sibling would collapse half of a pane the reader had just chosen to look at,
 * and the rule is about the top-level pills. Subs keep
 * their own state; F01 5.3 governs what they default to.
 */
interface CardSectionGroupValue {
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /**
   * Approved reader design (2026-09-28): on the Battlecard every section is
   * its own disclosure, and Campaign money and Public statements start open.
   * `independent` keeps the group (so callers need no second structure) but
   * lets each section open and close on its own.
   */
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
 * A collapsible section of a person's battlecard — item 6b4, 2026-08-15.
 *
 * ## What this is for
 *
 * Every major block on a person card collapses, so the card never reads as
 * infinite scroll. Identity stays open; contact, campaign
 * money, contributions, recent votes, when-it-mattered and everything else
 * collapses to a header.
 *
 * ## The header's bar, and why it is a pill
 *
 * The bar is that the header must make a reader want to open it, with the
 * shape left to the design. A pill is what
 * this system already uses for every OTHER tappable thing that is not a link
 * — the funding type pills, the narrowing chip, the map floaters — so a pill
 * here is not a new pattern, it is the existing one applied. Nothing that
 * hits the bar harder turned up inside the committed tokens, and inventing a
 * second affordance language to beat it would cost more than it won.
 *
 * **It draws its strength from item 5, not from adding another loud thing.**
 * The palette pass took the interactive accent off structural labels, seat
 * titles and counters; what is left wearing it is small and deliberate, so a
 * pill in the link accent now pops by CONTRAST. Before that pass this header
 * would have been the seventh gold thing on the card and would have
 * disappeared into the others — which is exactly why 5 and 6b4 were designed
 * together and share one token family.
 *
 * ## The equal-effort rule, enforced at the component
 *
 * A section renders its header whether or not it has anything behind it: the
 * SET of sections is identical for every person of an office class, and the
 * honest empty content lives inside. Hiding a section for a thin challenger
 * and showing it for the incumbent would make the incumbent's card taller and
 * more substantial — a layout asymmetry, which is precisely the information
 * asymmetry the equal-effort rule exists to catch. Collapse is
 * organization. It is never a way to render some people smaller than others.
 */
export function CardSection({
  title,
  /** Rendered beside the title — a count, a date range. Never a judgement. */
  meta,
  defaultOpen = false,
  /**
   * `"sub"` is a section INSIDE another section's pane (item 6, 2026-08-16).
   *
   * "Votes on laws" and "Votes on people" live inside Voting Record, and at
   * the top level's size and colour the three read as peers rather than as a
   * thing containing two things — which is half of why the pane looked empty.
   * A sub-group indents behind a rule and steps down in scale, keeping its
   * chevron and its tap target so it still says "a new thing to click".
   */
  level = "top",
  keepMounted = false,
  children,
}: {
  title: string;
  meta?: string | null;
  defaultOpen?: boolean;
  level?: "top" | "sub";
  /** Sources retain their observed rows while the disclosure is closed. */
  keepMounted?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const group = useContext(CardSectionGroupContext);
  // Only TOP-LEVEL pills join the group. See the note on CardSectionGroup.
  const grouped = group !== null && !group.independent && level !== "sub";

  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = grouped ? group.openId === id : localOpen;

  // A grouped section that asks to start open claims the group's one slot at
  // mount. Two such sections on one card would be a contradiction the group
  // resolves the same way a reader's click does — last one wins — rather than
  // by silently rendering two open pills, which is the defect itself.
  useEffect(() => {
    if (grouped && defaultOpen) group!.setOpenId(id);
    // Mount only: re-running on `openId` would reopen the section every time
    // the reader closed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    if (grouped) group!.setOpenId(open ? null : id);
    else setLocalOpen((v) => !v);
  };

  return (
    <section
      className="card-section"
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
        <div id={id} className="card-section-body" hidden={!open}>
          {children}
        </div>
      )}
    </section>
  );
}
