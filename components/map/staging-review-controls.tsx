"use client";

import { useMemo, useSyncExternalStore } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { RAISED_STATE_CANDIDATES, type RaisedStateCandidate } from "@/lib/review/contract";

const enabled = process.env.WTP_BUILD_CONTEXT === "branch-deploy" && process.env.WTP_BUILD_BRANCH === "test";
const readSearch = () => enabled ? window.location.search : "";
const serverSearch = () => "";
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};

export type ReviewPopup = "district" | "school" | "body" | "meeting" | "official";
const popupTypes: ReviewPopup[] = ["district", "school", "body", "meeting", "official"];

export function useStagingReview() {
  const search = useSyncExternalStore(subscribe, readSearch, serverSearch);
  return useMemo(() => {
    const params = new URLSearchParams(search);
    const candidate = RAISED_STATE_CANDIDATES.find(item => item.id === params.get("raisedState"))?.id;
    const zip = params.get("zip");
    const popup = popupTypes.find(type => type === params.get("popup")) ?? null;
    return { enabled, zip: zip && /^\d{5}$/.test(zip) ? zip : null, popup,
      candidate: candidate ?? "A_SOFT_LIFT" as RaisedStateCandidate,
      frameState: enabled && (candidate !== undefined || params.get("review") === "raised-state") };
  }, [search]);
}

export function StagingReviewControls({ candidate, zip }: { candidate: RaisedStateCandidate; zip: string | null }) {
  if (!enabled) return null;
  return (
    <details style={{ position: "fixed", right: 12, top: 0, zIndex: 1402,
      background: "var(--panel)", color: "var(--text)", borderRadius: 6, padding: "5px 8px", maxWidth: 240, fontSize: 11 }}>
      <summary>Visual review</summary>
      <label style={{ display: "block", marginTop: 10 }} htmlFor="staging-raised-state">Raised state · awaiting owner choice</label>
      <select id="staging-raised-state" value={candidate} style={{ minHeight: 44, maxWidth: "100%" }} onChange={event => {
        const url = new URL(window.location.href);
        url.searchParams.set("raisedState", event.target.value);
        url.searchParams.set("review", "raised-state");
        if (zip) url.searchParams.set("zip", zip);
        window.history.replaceState(null, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}>
        {RAISED_STATE_CANDIDATES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}><span>Theme</span><ThemeToggle /></div>
    </details>
  );
}
