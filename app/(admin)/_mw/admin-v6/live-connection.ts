"use client";

/**
 * **IS THIS PAGE LIVE?** The v6 connection indicator, fed by the ONE existing
 * pulse poll.
 *
 * Codex (contract response, 2026-09-28 20:18 UTC): the real page consumes the
 * Admin shell's single `/api/admin/live` poll — `LiveRefresh` in
 * `app/(admin)/_mw/live-refresh.tsx` — through the `meanwhile:admin-pulse`
 * window event. This hook never fetches. It listens, and reports:
 *
 *   connecting    no pulse yet
 *   live          the last pulse is recent
 *   reconnecting  the next pulse is overdue (past RECONNECTING_AFTER_MS)
 *   stale         no pulse within PULSE_STALE_MS
 *   offline       the browser says it has no network
 *
 * It hands every pulse to `onPulse` (LiveSync reads what the pulse announces),
 * and calls `onReconnected` ONCE when a pulse arrives after the page was
 * overdue, stale or offline. Data is replaced, never appended, so catching up
 * cannot double count.
 */
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import { PULSE_INTERVAL_MS, PULSE_STALE_MS, type LivePulse } from "@/lib/control-plane/live-pulse.ts";

import type { Connection } from "./eligibility.ts";

export const PULSE_EVENT = "meanwhile:admin-pulse";
/** A pulse is overdue once a normal interval and a third have passed without one. */
export const RECONNECTING_AFTER_MS = Math.round(PULSE_INTERVAL_MS * 1.34);

export interface LiveConnection {
  readonly connection: Connection;
  readonly pulse: LivePulse | null;
  readonly lastGoodAt: string | null;
  /** True for a few seconds after a lost connection comes back. */
  readonly recovered: boolean;
}

export function isUsablePulse(pulse: unknown): pulse is LivePulse {
  if (!pulse || typeof pulse !== "object") return false;
  const p = pulse as Partial<LivePulse>;
  return typeof p.revision === "string" && p.revision !== "" && p.revision !== "unread" &&
    typeof p.at === "string" && Number.isFinite(Date.parse(p.at));
}

/** Pure: what the indicator says. `receivedAt` is when this page last got a pulse (its own clock). */
export function connectionOf(input: { readonly online: boolean; readonly receivedAt: number | null; readonly now: number }): Connection {
  if (!input.online) return "offline";
  if (input.receivedAt === null) return "connecting";
  const age = input.now - input.receivedAt;
  if (age > PULSE_STALE_MS) return "stale";
  if (age > RECONNECTING_AFTER_MS) return "reconnecting";
  return "live";
}

function subscribeOnline(fn: () => void) {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => { window.removeEventListener("online", fn); window.removeEventListener("offline", fn); };
}

export function usePulseFeed(opts: { readonly onPulse: (pulse: LivePulse) => void; readonly onReconnected: () => void }): LiveConnection {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);
  const [pulse, setPulse] = useState<LivePulse | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [recovered, setRecovered] = useState(false);
  const [awaitingPulse, setAwaitingPulse] = useState(false);
  // navigator.onLine can already be true again when the next pulse arrives.
  // Remember an intervening offline event until that pulse catches up.
  const lostSincePulse = useRef(false);
  const onPulse = useEffectEvent((p: LivePulse) => opts.onPulse(p));
  const onReconnected = useEffectEvent(() => opts.onReconnected());
  const wasLost = useEffectEvent(() => !online || (receivedAt !== null && Date.now() - receivedAt > RECONNECTING_AFTER_MS));

  useEffect(() => {
    let recoverTimer: ReturnType<typeof setTimeout> | undefined;
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    const markOffline = () => { lostSincePulse.current = true; setAwaitingPulse(true); };
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!isUsablePulse(detail)) return;
      const lost = lostSincePulse.current || wasLost();
      lostSincePulse.current = false;
      setAwaitingPulse(false);
      const t = Date.now();
      setPulse(detail);
      setReceivedAt(t);
      setNow(t);
      onPulse(detail);
      if (lost) {
        onReconnected();
        setRecovered(true);
        clearTimeout(recoverTimer);
        recoverTimer = setTimeout(() => setRecovered(false), 8_000);
      }
    };
    window.addEventListener("offline", markOffline);
    window.addEventListener(PULSE_EVENT, handler);
    return () => { window.removeEventListener("offline", markOffline); window.removeEventListener(PULSE_EVENT, handler); clearInterval(clock); clearTimeout(recoverTimer); };
  }, []);

  return {
    connection: online && awaitingPulse ? "reconnecting" :
      connectionOf({ online, receivedAt, now: Math.max(now, receivedAt ?? 0) }),
    pulse,
    lastGoodAt: pulse?.at ?? null,
    recovered,
  };
}
