"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { parseView } from "./admin-v6/view-param.ts";
import { PULSE_ACTIVE_INTERVAL_MS, PULSE_INTERVAL_MS, PULSE_STALE_MS, type LivePulse } from "@/lib/control-plane/live-pulse.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { s } from "./legacy-styles";
import { adminIsActive, watchAdminActivity } from "./admin-activity.ts";

/** One visible-tab subscription shared by every page in the Admin shell. */
export function LiveRefresh() {
  const search = useSearchParams();
  const screen = parseView(search.get("view") ?? undefined);
  const [failed, setFailed] = useState(false);
  const [unread, setUnread] = useState<readonly string[]>([]);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let stopped = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | null = null;
    const tick = async () => {
      if (stopped || pending || !adminIsActive()) return;
      pending = true;
      const controller = new AbortController();
      request = controller;
      let interval = PULSE_INTERVAL_MS;
      try {
        const response = await fetch("/api/admin/live", { signal: controller.signal, cache: "no-store", headers: { accept: "application/json", "x-admin-screen": screen } });
        const pulse = await response.json() as LivePulse;
        if (!response.ok || !pulse.revision || !Number.isFinite(Date.parse(pulse.at))) throw new Error("pulse unread");
        if (stopped || controller.signal.aborted || !adminIsActive()) return;
        // Even if the control-plane store is unread, this authenticated pulse
        // can advertise a newly deployed compatible read API. Mounted adapters
        // listen to the same event and retry only their eligible scoped read.
        window.dispatchEvent(new CustomEvent("meanwhile:admin-pulse", { detail: pulse }));
        if (pulse.revision === "unread") {
          setFailed(true);
          setUnread(pulse.unread);
          return;
        }
        setFailed(false);
        setLastSuccessfulAt(pulse.at);
        setUnread(pulse.unread);
        if ((pulse.counts.agentJobsRunning ?? 0) > 0 || pulse.lanes?.final === false) interval = PULSE_ACTIVE_INTERVAL_MS;
      } catch {
        if (!stopped && !controller.signal.aborted) setFailed(true);
      } finally {
        pending = false;
        request = null;
        if (!stopped) setClock(Date.now());
        if (!stopped && adminIsActive()) timer = setTimeout(() => void tick(), controller.signal.aborted ? 0 : interval);
      }
    };
    const unwatch = watchAdminActivity(() => {
      clearTimeout(timer);
      const active = adminIsActive();
      setPaused(!active);
      setClock(Date.now());
      if (active) timer = setTimeout(() => void tick(), 0);
      else request?.abort();
    });
    return () => { stopped = true; clearTimeout(timer); request?.abort(); unwatch(); };
  }, [screen]);
  const age = lastSuccessfulAt === null ? null : clock - Date.parse(lastSuccessfulAt);
  const stale = failed || age !== null && age > PULSE_STALE_MS;
  const checked = lastSuccessfulAt === null ? "No live check has succeeded yet" :
    `Last live check ${formatEastern(lastSuccessfulAt)}`;
  return <p className={s.note} role="status">{paused
    ? `Live updates paused while this tab is hidden or idle. ${checked}.`
    : lastSuccessfulAt === null && !failed
    ? "Connecting to live updates. No live check has succeeded yet."
    : stale
    ? `Live updates are disconnected or stale. ${checked}; the page may be out of date.`
    : unread.length
      ? `Live updates on. ${checked}. Unavailable: ${unread.join("; ")}. Other readings continue to update.`
      : `Live updates on while this page is visible. ${checked}.`}</p>;
}
