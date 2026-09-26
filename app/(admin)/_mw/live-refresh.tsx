"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PULSE_ACTIVE_INTERVAL_MS, PULSE_INTERVAL_MS, type LivePulse } from "@/lib/control-plane/live-pulse.ts";
import s from "./mw.module.css";

/** One visible-tab subscription shared by every page in the Admin shell. */
export function LiveRefresh() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    let pending = false;
    let revision: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped || pending || document.visibilityState !== "visible") return;
      pending = true;
      let interval = PULSE_INTERVAL_MS;
      try {
        const response = await fetch("/api/admin/live", { cache: "no-store", headers: { accept: "application/json" } });
        const pulse = await response.json() as LivePulse;
        if (!response.ok || !pulse.revision || pulse.revision === "unread") throw new Error("pulse unread");
        if (stopped) return;
        setFailed(pulse.unread.length > 0);
        window.dispatchEvent(new CustomEvent("meanwhile:admin-pulse", { detail: pulse }));
        // The first successful pulse also reconciles work done since the server render.
        if (revision !== pulse.revision) { revision = pulse.revision; router.refresh(); }
        if ((pulse.counts.agentJobsRunning ?? 0) > 0 || pulse.lanes?.final === false) interval = PULSE_ACTIVE_INTERVAL_MS;
      } catch {
        if (!stopped) setFailed(true);
      } finally {
        pending = false;
        if (!stopped && document.visibilityState === "visible") timer = setTimeout(() => void tick(), interval);
      }
    };
    const visibility = () => { clearTimeout(timer); if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", visibility);
    void tick();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [router]);
  return <p className={s.note} role="status">{failed ? "Live updates could not be fully read. The last successful readings remain visible." : "Live updates on while this page is visible."}</p>;
}
