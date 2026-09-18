"use client";

/**
 * The fleet read clock (BUILD.md §A, WIRING.md §4).
 *
 * The deliberate inverse of the control centre header: that one counts DOWN a
 * ~45-second cycle; this one counts UP from the instant the page was read,
 * because nothing re-reads this surface. The honest sentence — "Nothing
 * re-reads this page. There is no cycle here." — is the deliverable; the button
 * only triggers a fresh server read via `router.refresh()`. There is no
 * polling, by design: an operator must never mistake a stale read for a live
 * one, and the count-up age is what tells them how old it is.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function ageWords(fromIso: string, nowMs: number): string {
  const ms = nowMs - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const h = Math.floor(minutes / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

export function FleetReadClock({ observedAt }: { readonly observedAt: string }) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [rereading, setRereading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fleet-read-clock">
      <p className="frc-line">
        <span className="frc-dot" aria-hidden="true" />
        Read <span className="frc-age">{ageWords(observedAt, nowMs)}</span>, when you opened this page.
        <button
          type="button"
          className="frc-again"
          disabled={rereading}
          onClick={() => {
            setRereading(true);
            router.refresh();
            // The server read is the source of truth; clear the pending state
            // once the refreshed tree is likely in. No polling.
            setTimeout(() => setRereading(false), 1200);
          }}
        >
          {rereading ? "Reading…" : "Read again"}
        </button>
      </p>
      <p className="frc-note">
        Nothing re-reads this page. There is no cycle here — the read happens once, because you
        navigated, and again only when you press the button. Every number below is as old as the clock
        above.
      </p>
    </div>
  );
}
