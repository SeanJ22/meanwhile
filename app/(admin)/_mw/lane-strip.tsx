"use client";

/**
 * **THE LANES, LIVE.** (MW-029 / MW-071, 2026-09-25.)
 *
 * One gauge per work lane — running now, waiting, how long the oldest waiting
 * row has been owed, and the lane's own blocking reason — drawn first from the
 * research state the page already read, then refreshed from the pulse
 * (`/api/admin/live`, which carries the lanes from the one research state read
 * it already makes). The timer runs only while the page is visible, and a
 * hidden tab asks nothing; coming back to the tab asks once, straight away.
 *
 * A refresh that fails keeps the last reading on screen and says it is stale
 * rather than blanking the gauges or showing zeros.
 */
import { useEffect, useState } from "react";

import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { PULSE_INTERVAL_MS, type LivePulse } from "@/lib/control-plane/live-pulse.ts";

import s from "./mw.module.css";

type PulseLanes = LivePulse["lanes"];

export function LaneStrip({ initial }: { readonly initial: PulseLanes }) {
  const [lanes, setLanes] = useState<PulseLanes>(initial);
  const [failedAt, setFailedAt] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clear();
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(() => void tick(), PULSE_INTERVAL_MS);
    };
    const tick = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/admin/live", { headers: { accept: "application/json" }, cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { readonly lanes?: PulseLanes; readonly revision?: string } | null;
        if (!res.ok || body === null || body.revision === "unread") setFailedAt(new Date().toISOString());
        else {
          setLanes(body.lanes ?? null);
          setFailedAt(null);
        }
      } catch {
        setFailedAt(new Date().toISOString());
      } finally {
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
      else clear();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      stopped = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (lanes === null) {
    return <p className={s.note}>The runner&rsquo;s state records no lane gauges (it predates them, or it was not read), so no lane is shown — not an empty one.</p>;
  }
  return (
    <div className={`${s.insetBox} ${s.stack8}`} aria-live="polite">
      <div className={s.row10}>
        <span className={s.label}>Lanes now</span>
        <span className={s.note}>
          {lanes.final ? "as the last cycle ended" : "mid-cycle"}, {formatEastern(lanes.at)}
          {failedAt !== null ? " — the last refresh failed, so this reading may be stale" : ""}
        </span>
      </div>
      <div className={s.gridAuto240} style={{ gap: 12 }}>
        {lanes.gauges.map((g) => (
          <div key={g.lane} className={s.inset}>
            <span className={s.name14}>{g.name}</span>
            <p className={s.text14}>
              {g.active === null ? "running: not recorded mid-cycle (one at a time)" : `${g.active.toLocaleString("en-US")} running`} · {g.waiting.toLocaleString("en-US")} waiting
            </p>
            <p className={s.note}>
              {g.oldestWaitingDueAt ? `Oldest waiting was due ${formatEastern(g.oldestWaitingDueAt)}.` : g.waiting > 0 ? "When the oldest waiting row fell due is not recorded." : "Nothing waiting."}{" "}
              {g.blockedBy !== null ? `Held: ${g.blockedBy}.` : g.waiting > 0 && !lanes.final ? "Why each waits is counted when the cycle ends." : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
