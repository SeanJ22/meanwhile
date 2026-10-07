"use client";

/**
 * The route must also render the shell's `LiveRefresh` exactly once: it is the single `/api/admin/live`
 * poller, and this component listens to its `meanwhile:admin-pulse` events.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { scopeParam } from "../scope.ts";
import { CommandCenter } from "./command-center.tsx";
import type { View } from "./context.tsx";
import type { Access } from "./eligibility.ts";
import { liveExecutor } from "./executor.ts";
import { usePulseFeed } from "./live-connection.ts";
import { buildLiveBundle, rememberPlaces, type LiveReference } from "./live-data.ts";
import { LiveSync, type SectionState } from "./live-sync.ts";
import { scopeOfPlaceKey } from "./places.ts";
import type { Place, StateRow } from "./model.ts";
import { workerStatusFromPulse } from "./pulse-view.ts";

export interface LiveCommandCenterProps {
  readonly reference: LiveReference;
  readonly initialScopeKey: string;
  readonly access: Access;
  readonly initialView?: View;
  readonly chatControls?: readonly string[];
}

function fetchNoStore(url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) {
  return fetch(url, { ...init, cache: "no-store" });
}

function scheduleTimeout(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

export function LiveCommandCenter(props: LiveCommandCenterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [scopeKey, setScopeKey] = useState(props.initialScopeKey);
  const [sync] = useState(() => new LiveSync({ scope: props.initialScopeKey, fetch: fetchNoStore, schedule: scheduleTimeout }));
  useEffect(() => () => sync.dispose(), [sync]);

  const snapshot = useSyncExternalStore((fn) => sync.subscribe(fn), () => sync.snapshot(), () => sync.snapshot());
  const conn = usePulseFeed({ onPulse: (pulse) => sync.onPulse(pulse), onReconnected: () => sync.catchUp() });
  const executor = useMemo(() => liveExecutor({ capabilities: () => sync.capabilities(), stateVersion: () => sync.revision() }), [sync]);
  useEffect(() => () => executor.dispose?.(), [executor]);
  const [seen, setSeen] = useState<{ readonly from: SectionState | null; readonly places: readonly Place[] }>({ from: null, places: [] });
  if (seen.from !== snapshot.national) {
    setSeen({ from: snapshot.national, places: rememberPlaces(seen.places, snapshot.national.phase === "live" ? snapshot.national.data as readonly StateRow[] : null) });
  }
  const seenPlaces = seen.places;
  const data = useMemo(() => buildLiveBundle(snapshot, props.reference, workerStatusFromPulse(conn.pulse), seenPlaces), [snapshot, props.reference, conn.pulse, seenPlaces]);

  const onScopeChange = (key: string) => {
    setScopeKey(key);
    sync.setScope(key);
    const scope = scopeOfPlaceKey(key);
    if (scope) {
      const params = new URLSearchParams(search?.toString() ?? "");
      const value = scopeParam(scope);
      if (value === null) params.delete("scope");
      else params.set("scope", value);
      const q = params.toString();
      router.replace(`${pathname}${q ? `?${q}` : ""}`, { scroll: false });
    }
  };

  /** The view is in the address (`?view=reports`), so a link or a refresh lands where you were. */
  const onViewChange = (view: View) => {
    const params = new URLSearchParams(search?.toString() ?? "");
    if (view === "now") params.delete("view");
    else params.set("view", view);
    const q = params.toString();
    router.replace(`${pathname}${q ? `?${q}` : ""}`, { scroll: false });
  };

  return (
    <CommandCenter
      data={data}
      mode="live"
      executor={executor}
      scopeKey={scopeKey}
      onScopeChange={onScopeChange}
      onQuery={(section, params) => sync.setParams(section, params)}
      connection={conn.connection}
      lastGoodAt={conn.lastGoodAt}
      recovered={conn.recovered}
      access={props.access}
      initialView={props.initialView}
      chatControls={props.chatControls}
      onViewChange={onViewChange}
    />
  );
}
