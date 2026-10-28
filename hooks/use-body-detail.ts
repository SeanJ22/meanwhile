"use client";

import { useEffect, useState } from "react";
import { loadBodyDetail } from "@/lib/registry/body-roster-client";
import type { ReaderBodyDetail } from "@/lib/reader/body-detail";

export type BodyDetailState =
  | { readonly status: "idle" | "loading" | "unavailable"; readonly detail: null }
  | { readonly status: "ready"; readonly detail: ReaderBodyDetail };

/** Resolve only the body whose card is open; discard answers for a prior card. */
export function useBodyDetail(state: string | null, bodyId: string | null, required: boolean): BodyDetailState {
  const key = required && state && bodyId ? JSON.stringify([state, bodyId]) : null;
  const [held, setHeld] = useState<{ key: string; value: BodyDetailState } | null>(null);
  const [previousKey, setPreviousKey] = useState(key);
  if (previousKey !== key) {
    setPreviousKey(key);
    setHeld(null);
  }
  useEffect(() => {
    if (!key || !state || !bodyId) return;
    let active = true;
    void loadBodyDetail(state, bodyId).then(detail => {
      if (active) setHeld({ key, value: { status: "ready", detail } });
    }).catch(() => {
      if (active) setHeld({ key, value: { status: "unavailable", detail: null } });
    });
    return () => { active = false; };
  }, [key, state, bodyId]);
  if (!required) return { status: "idle", detail: null };
  if (!key) return { status: "unavailable", detail: null };
  return held?.key === key ? held.value : { status: "loading", detail: null };
}
