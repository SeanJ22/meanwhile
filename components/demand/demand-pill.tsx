"use client";

import { useState } from "react";

/**
 * **"WANT US TO GET THIS INFO SOONER?"** (OWN-Q6, the owner's amendment on
 * Q6/Q7, authorized 2026-08-31.)
 *
 * The owner asked for a clickable pill that registers the click with a brief
 * confirmation. This is the whole surface, and every bound on it is the
 * owner's own.
 *
 * ## What the reader can do with it, exhaustively
 *
 * Tap it once. There is no text box, no rating, no second step, and no undo —
 * an undo needs to know WHICH row to retract, which needs an identifier the
 * feature deliberately does not have. Tapping twice records two asks, which is
 * what the pill literally says it does.
 *
 * ## What it never shows
 *
 * A count. A total. A rank. Anything about anyone else's taps, in any form
 * including aggregate. `CLAUDE.md`'s no-user-to-user rule reaches this by name
 * — *stored and aggregated, never rendered back to any user* — and the owner's
 * own instruction was that results are never shown to readers. There is no
 * read path behind this component to render one from, which is a stronger
 * guarantee than remembering not to.
 *
 * ## The confirmation is about the ASK, not about the outcome
 *
 * *"Thanks — we've noted it."* We have noted the ask. We have NOT promised the
 * record, and a confirmation reading *"we'll get it soon"* would be a claim
 * about a government's publication schedule that nothing on our side controls.
 * The product does not announce its own failure (RULING 139) and it does not
 * announce a success it cannot deliver either.
 *
 * A failed write says so plainly, because a pill that silently does nothing
 * while looking like it worked is the quiet lie this codebase keeps catching.
 *
 * ## Symmetry
 *
 * One component, used on the body card and the candidate card with the same
 * props. `tests/demand-signal.test.ts` asserts both call sites, so it renders
 * on every body and candidate card or on none — never on the well-covered ones
 * only, which would make the pill itself a coverage claim.
 */
export type DemandSubjectType = "BODY" | "CANDIDATE";

type Phase = "IDLE" | "SENDING" | "NOTED" | "FAILED";

export function DemandPill({
  subjectType,
  subjectId,
  /** The map view's point, for approximate location only. Never an address. */
  lat = null,
  lng = null,
  className,
}: {
  subjectType: DemandSubjectType;
  subjectId: string;
  lat?: number | null;
  lng?: number | null;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("IDLE");

  const send = async () => {
    setPhase("SENDING");
    try {
      const response = await fetch("/api/demand-signal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectType,
          subjectId,
          signal: "WANT_THIS_SOONER",
          ...(typeof lat === "number" && typeof lng === "number" ? { lat, lng } : {}),
        }),
      });
      // 204 stored, 202 accepted with no store behind it. Both are the ask
      // reaching us, which is what the confirmation claims and all it claims.
      setPhase(response.ok ? "NOTED" : "FAILED");
    } catch {
      setPhase("FAILED");
    }
  };

  if (phase === "NOTED") {
    return (
      <p
        data-demand-pill={subjectType}
        data-demand-state="NOTED"
        className={`text-[0.6875rem] leading-relaxed text-muted ${className ?? ""}`}
      >
        Thanks — we&apos;ve noted it.
      </p>
    );
  }

  return (
    <p className={className}>
      <button
        type="button"
        data-demand-pill={subjectType}
        data-demand-state={phase}
        data-demand-subject={subjectId}
        disabled={phase === "SENDING"}
        onClick={() => void send()}
        className="cursor-pointer text-[0.6875rem] text-link hover:underline disabled:cursor-default disabled:text-muted"
      >
        {phase === "SENDING" ? "Noting…" : "Want us to get this info sooner?"}
      </button>
      {phase === "FAILED" && (
        // Ours, said as ours. Never "try again" over a tap that may have landed.
        <span className="ml-1.5 text-[0.625rem] text-muted">
          We couldn&apos;t note that just now.
        </span>
      )}
    </p>
  );
}
