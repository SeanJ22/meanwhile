"use client";

import { useReaderCopy } from "@/hooks/use-reader-copy";
import Link from "next/link";

import type { CoverageSummary } from "@/lib/registry/coverage";
import { ASK_PILL_LABELS } from "@/lib/routing/ask-pill-labels";
import type { AskPillPlacement } from "@/lib/map/cluster-placement";
import pearlStyles from "./ask-pearl.module.css";

/** Which small popup is open. At most one, ever (INTERACTIONS §1). */
export type ReaderPop = "zip" | "vote" | "ask" | null;

/**
 * The compound nav and the Ask pill (approved reader design, 2026-09-28).
 *
 * One rounded container with four segments — **Ballot**, the **ZIP**, **Who
 * governs here?** and **Where can I vote?** — separated by 1px dividers, and
 * the Ask pill directly below it, always separate from the nav. Inside the
 * sidebar the nav is always 2×2; in the collapsed header it is 2×2 below
 * 1024px and one row of four above.
 *
 * Each segment only asks `map-entry` to open its view. The ZIP, Where can I
 * vote? and Ask views are small popups anchored to this control; Who governs
 * here? is the large card. `map-entry` owns all of them, so opening one closes
 * every other — this component cannot open a second view on its own.
 *
 * There is exactly one of this component on screen: `map-entry` renders it
 * either in the sidebar or in the collapsed header, never both.
 */
export function PillCluster({
  placement,
  zip,
  pop,
  governsOpen,
  onOpenPop,
  onOpenGoverns,
  onOpenBallot,
}: {
  placement: AskPillPlacement;
  /** The zip the viewport currently resolves to. Null shows a ZIP chooser. */
  zip: string | null;
  coverage: CoverageSummary | null;
  pop: ReaderPop;
  /** The Who governs here? card is the view on screen. */
  governsOpen: boolean;
  /** Toggles a small popup (opening the open one closes it). */
  onOpenPop: (pop: Exclude<ReaderPop, null>) => void;
  onOpenGoverns: () => void;
  /** Ballot opens as the large card (an intercepted route); close any popup first. */
  onOpenBallot?: () => void;
}) {
  const validZip = zip && /^\d{5}$/.test(zip) ? zip : null;
  // The design gives Ask its full example label at every placement: the pill
  // is always alone on its row (300–380px), never beside the ballot pill.
  const readerCopy = useReaderCopy();
  const pill = { ...ASK_PILL_LABELS.sidebar, label: readerCopy("copy.askSidebar"), ariaLabel: readerCopy("copy.askAccessible") };

  return (
    <div className="mw-nav-wrap" data-pill-cluster={placement}>
      <nav className="mw-compound-nav" aria-label="Main">
        <Link
          href={validZip ? `/ballot?zip=${validZip}` : "/ballot"}
          className="mw-nav-seg mw-nav-ballot"
          onClick={onOpenBallot}
          title={`What's on the ballot${validZip ? ` near ${validZip}` : ""}`}
        >
          {/* A marked ballot sheet, not a check in a box: ✓ already means
              "concluded" and "yes" elsewhere in this product. */}
          <svg
            width="18"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="2.8" width="16" height="18.4" rx="2" />
            <path d="M8.3 9.9l2.1 2.1 4.2-4.2" />
            <path d="M8.3 16.4h7.4" />
          </svg>
          <span>Ballot</span>
        </Link>
        <button
          type="button"
          className="mw-nav-seg mw-nav-zip"
          aria-label={validZip ? `Showing ${validZip} — change ZIP` : "Choose a ZIP"}
          aria-expanded={pop === "zip"}
          onClick={() => onOpenPop("zip")}
        >
          <span>{validZip ?? "ZIP"}</span>
          <span className="mw-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        <button
          type="button"
          className="mw-nav-seg"
          aria-expanded={governsOpen}
          onClick={onOpenGoverns}
        >
          Who governs here?
        </button>
        <button
          type="button"
          className="mw-nav-seg"
          aria-expanded={pop === "vote"}
          onClick={() => onOpenPop("vote")}
        >
          Where can I vote?
        </button>
      </nav>

      <button
        type="button"
        className={`ask-pill ${pearlStyles.pearl}`}
        data-ask-pill={placement}
        aria-expanded={pop === "ask"}
        aria-label={pill.ariaLabel}
        onClick={() => onOpenPop("ask")}
      >
        {/* A plain speech bubble: Ask routes a real question to a real body,
            it is not a help icon. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.6-.4L4 21l1.4-4.1A8.2 8.2 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4" />
        </svg>
        <span>{pill.label}</span>
      </button>
    </div>
  );
}
