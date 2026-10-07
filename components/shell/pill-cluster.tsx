"use client";

import { useReaderCopy } from "@/hooks/use-reader-copy";
import Link from "next/link";

import type { CoverageSummary } from "@/lib/registry/coverage";
import { ASK_PILL_LABELS } from "@/lib/routing/ask-pill-labels";
import type { AskPillPlacement } from "@/lib/map/cluster-placement";
import pearlStyles from "./ask-pearl.module.css";

/** Which small popup is open. At most one. */
export type ReaderPop = "zip" | "vote" | "ask" | null;

/**
 * The compound nav (Ballot, ZIP, Who governs here?, Where can I vote?) with
 * the Ask pill below it. Each segment asks `map-entry` to open its view, so
 * opening one closes every other. `map-entry` renders exactly one instance.
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
  // Ask's full example label at every placement; the pill is always alone on its row.
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
