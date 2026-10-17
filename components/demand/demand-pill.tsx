"use client";

import { useState } from "react";
import { submitDemandSignal } from "@/lib/demand/client";

/**
 * "Ask us to find this" One tap records one ask; there is no
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
    const stored = await submitDemandSignal(subjectType, subjectId, { lat, lng });
    setPhase(stored ? "NOTED" : "FAILED");
  };

  if (phase === "NOTED") {
    return (
      <p
        data-demand-pill={subjectType}
        data-demand-state="NOTED"
        className={`text-[0.6875rem] leading-relaxed text-muted ${className ?? ""}`}
      >
        Noted.
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
        {phase === "SENDING" ? "Noting…" : "Ask us to find this"}
      </button>
      {phase === "FAILED" && (
        <span className="ml-1.5 text-[0.625rem] text-muted">
          We couldn&apos;t confirm that was noted.
        </span>
      )}
    </p>
  );
}
