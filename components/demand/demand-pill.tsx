"use client";

import { useState } from "react";
import { getOrCreateBrowserKey, mintBrowserKey } from "@/lib/state/browser-key";

/**
 * "Want us to get this info sooner?" One tap records one ask; there is no
 * undo, since rows carry no identifier to retract. It never shows a count or
 * anything about other readers' taps, and has no read path to do so. A failed
 * write says so.
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
    const tapAt = new Date().toISOString();
    const tapId = mintBrowserKey();
    try {
      const response = await fetch("/api/demand-signal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectType,
          subjectId,
          signal: "WANT_THIS_SOONER",
          // Returning-reader ID, exact time and a per-tap event id, so a retried request is counted once.
          continuityKey: getOrCreateBrowserKey("wtp.ask_key"),
          occurredAt: tapAt,
          eventId: tapId,
          ...(typeof lat === "number" && typeof lng === "number" ? { lat, lng } : {}),
        }),
      });
      // 204 stored, 202 accepted with no store behind it; both mean the ask reached us.
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
        <span className="ml-1.5 text-[0.625rem] text-muted">
          We couldn&apos;t note that just now.
        </span>
      )}
    </p>
  );
}
