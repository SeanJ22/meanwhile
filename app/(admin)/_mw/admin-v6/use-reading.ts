"use client";

import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ADMIN_ACTIVITY_EVENT, adminIsActive } from "../admin-activity.ts";
import { PULSE_EVENT } from "./live-connection.ts";
import { ReadingStatus } from "./reading-status.tsx";
import { parseView } from "./view-param.ts";

export type Reading<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: T; readonly at: string; readonly stale: boolean }
  | { readonly kind: "failed"; readonly says: string };

/** Render status directly inside the panel: its parent is the observed viewport boundary. */
export function useReading<T>(url: string, label?: string): { readonly reading: Reading<T>; readonly reload: () => void; readonly status: ReactNode } {
  const screen = parseView(useSearchParams()?.get("view") ?? undefined);
  const key = `${screen}:${url}`;
  const [state, setState] = useState<{ key: string; reading: Reading<T> }>({ key, reading: { kind: "loading" } });
  const [activity, setActivity] = useState({ active: true, now: 0 });
  const anchor = useRef<HTMLParagraphElement>(null);
  const statusRef = useCallback((node: HTMLParagraphElement | null) => { anchor.current = node; }, []);
  const reload = useRef<() => void>(() => {});
  useEffect(() => {
    let stopped = false;
    let onScreen = false;
    let request: AbortController | null = null;
    let last: { data: T; at: string } | null = null;
    const load = async () => {
      if (stopped || request || !onScreen || !adminIsActive()) return;
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { accept: "application/json", "x-admin-screen": screen } });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const says = body !== null && typeof body === "object" && typeof (body as { says?: unknown }).says === "string" ? (body as { says: string }).says : `The console answered ${response.status}.`;
          throw new Error(says);
        }
        if (stopped || controller.signal.aborted) return;
        const at = new Date().toISOString();
        last = { data: body as T, at };
        setState({ key, reading: { kind: "ready", ...last, stale: false } });
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        setState({ key, reading: last ? { kind: "ready", ...last, stale: true } : { kind: "failed", says: error instanceof Error ? error.message : "It could not be read." } });
      } finally {
        if (request === controller) request = null;
      }
    };
    const cancel = () => { request?.abort(); request = null; };
    const activityChanged = () => {
      const active = adminIsActive();
      setActivity({ active, now: Date.now() });
      if (!active) cancel();
      // Resumption refreshes on the shell's next pulse, including its immediate wake-up pulse.
    };
    const pulse = () => { setActivity({ active: adminIsActive(), now: Date.now() }); void load(); };
    const observer = new IntersectionObserver(([entry]) => {
      const entered = entry.isIntersecting && !onScreen;
      onScreen = entry.isIntersecting;
      if (!onScreen) cancel();
      else if (entered) void load();
    });
    const panel = anchor.current?.parentElement;
    if (panel) observer.observe(panel);
    reload.current = () => void load();
    window.addEventListener(PULSE_EVENT, pulse);
    window.addEventListener(ADMIN_ACTIVITY_EVENT, activityChanged);
    activityChanged();
    return () => {
      stopped = true;
      cancel();
      observer.disconnect();
      window.removeEventListener(PULSE_EVENT, pulse);
      window.removeEventListener(ADMIN_ACTIVITY_EVENT, activityChanged);
    };
  }, [url, screen, key]);
  const reading = state.key === key ? state.reading : { kind: "loading" } as const;
  // createElement forwards this callback ref to the status paragraph; it does not read it.
  // eslint-disable-next-line react-hooks/refs
  return { reading, reload: () => reload.current(), status: createElement(ReadingStatus, { ref: statusRef, reading, label, ...activity }) };
}
