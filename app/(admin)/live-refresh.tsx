"use client";

/**
 * **THE CONSOLE KEEPS ITSELF CURRENT, AND SAYS SO.** (ADM-34, §9A.5, §9A.17.)
 *
 * The owner asked the question directly and the page had no answer on it:
 * *"do I have to manually refresh the site to get more information? Is it going
 * to auto-update if I just simply leave it open? My feeling is I have to
 * manually refresh it but I don't know."*
 *
 * This island answers it in the header of every live view:
 *
 * ```
 *   Updated 20 seconds ago · checking every 45 seconds     [ Refresh now ]
 * ```
 *
 * ## What it actually does
 *
 * Polls `/api/admin/live` — a handful of aggregate reads, no table scans. When
 * the pulse's revision differs from the one the server rendered with, it calls
 * `router.refresh()`, which re-renders the server tree in place: no full page
 * reload, scroll position kept, open disclosures kept, typed text kept.
 *
 * ## Why it stops when you are not looking
 *
 * `document.hidden` pauses the loop entirely — a console left open on a second
 * monitor for a week must not spend a week of queries. On becoming visible it
 * polls at once, so the first thing a returning owner sees is current.
 *
 * ## When the loop breaks
 *
 * It says so. A failed poll is shown as "live updates stopped" with the reason
 * and the manual control, because an indicator that silently freezes at
 * "Updated 2 minutes ago" is worse than no indicator: it is a confident claim
 * that the data is two minutes old when nobody knows how old it is.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { PULSE_ACTIVE_INTERVAL_MS, PULSE_INTERVAL_MS, type LivePulse } from "@/lib/control-plane/live-pulse.ts";
import { readRefusal } from "@/lib/control-plane/admin-refusal.ts";

function agoWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

export function LiveRefresh({
  renderedAt,
  revision,
  active,
}: {
  /** The ISO instant the server rendered this page. */
  readonly renderedAt: string;
  /** The revision the server rendered with. */
  readonly revision: string;
  /** True while an owner-triggered job is visibly in progress: poll faster. */
  readonly active?: boolean;
}) {
  const router = useRouter();
  const [lastOk, setLastOk] = useState<number>(() => Date.parse(renderedAt) || 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * The age is a fact about the BROWSER's clock, and the server does not have
   * it. Rendering it on both sides produces two different strings for the same
   * markup, React refuses to patch the mismatch, and hydration fails — which on
   * this console loses the theme attribute with it (measured 2026-09-05). So
   * the server renders the stable half and `now` stays null until the first
   * timer tick, which is also why the clock is READ in a timer rather than
   * during render: `Date.now()` in a render body is impure, and setting state
   * synchronously inside an effect cascades renders. One timer answers both.
   */
  const [now, setNow] = useState<number | null>(null);
  const revisionRef = useRef(revision);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  const poll = useCallback(
    async (force: boolean) => {
      setBusy(true);
      try {
        const res = await fetch("/api/admin/live", { cache: "no-store", headers: { accept: "application/json" } });
        if (!res.ok) {
          /*
           * ADM-49 (class): the live poll used to throw the status, so a signed
           * -out console said "the server answered 401" every forty-five
           * seconds without once saying that the sign-in had run out. The
           * refusal names itself now.
           */
          const contentType = res.headers.get("content-type");
          const body: unknown = await res.json().catch(() => null);
          const refusal = readRefusal({ status: res.status, body, contentType });
          throw new Error(refusal.whatToDo === null ? refusal.says : `${refusal.says} ${refusal.whatToDo}`);
        }
        const pulse = (await res.json()) as LivePulse;
        setLastOk(Date.now());
        setError(null);
        if (force || pulse.revision !== revisionRef.current) {
          revisionRef.current = pulse.revision;
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "the console could not reach the server");
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  // The clock that redraws "Updated N ago". One second is enough; it does no IO.
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // The poll loop. Paused entirely while the tab is hidden; polls at once on return.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const every = () => (active ? PULSE_ACTIVE_INTERVAL_MS : PULSE_INTERVAL_MS);
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(async () => {
        if (!document.hidden) await poll(false);
        schedule();
      }, every());
    };
    const onVisible = () => {
      if (!document.hidden) void poll(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll, active]);

  const mounted = now !== null;
  const age = now === null ? 0 : now - lastOk;
  const stale = error !== null;
  return (
    <span className={`live-refresh${stale ? " live-stopped" : ""}`} aria-live="polite">
      {stale ? (
        <span className="live-dot live-dot-bad" aria-hidden="true" />
      ) : (
        <span className="live-dot live-dot-ok" aria-hidden="true" />
      )}
      <span className="live-words">
        {stale ? (
          <>
            <strong>Live updates stopped.</strong> {error} Last successful update {agoWords(age)}.
          </>
        ) : (
          <>
            {mounted ? `Updated ${agoWords(age)}` : "This page keeps itself up to date"} · checking every{" "}
            {Math.round((active ? PULSE_ACTIVE_INTERVAL_MS : PULSE_INTERVAL_MS) / 1000)} seconds
          </>
        )}
      </span>
      <button type="button" className="live-now" onClick={() => void poll(true)} disabled={busy}>
        {busy ? "Refreshing…" : "Refresh now"}
      </button>
    </span>
  );
}
