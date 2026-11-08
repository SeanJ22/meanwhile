"use client";

import { createContext, startTransition, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { StateResultFeed } from "@/lib/election-results/feed-types";

export interface ResultChoice {
  id: string;
  aliases?: readonly string[];
  name: string;
}

export type ResultSlotProps =
  | { kind: "contest"; id: string; aliases?: readonly string[]; title: string; ocdId: string; voteFor: number | null; choices: readonly ResultChoice[] }
  | { kind: "candidate"; id: string; aliases?: readonly string[]; contestId: string; incumbent: boolean }
  | { kind: "measure"; id: string; aliases?: readonly string[]; measureId?: string; measureAliases?: readonly string[]; title: string; ocdId: string }
  | { kind: "summary" };

export type ResultFeedResponse = { available: boolean } & Pick<StateResultFeed, "state" | "facts"> & Partial<StateResultFeed>;
export type ResultViewProps = ResultSlotProps & { feed: ResultFeedResponse };
const ResultsContext = createContext<{ View: ComponentType<ResultViewProps>; feed: ResultFeedResponse } | null>(null);

/** A result request never competes with the first usable ballot. */
export function afterBallotReady(ids: readonly string[], start: () => void): () => void {
  let stopped = false, queued = false, cardsReady = false, firstFrame = 0, secondFrame = 0, idle: number | undefined;
  const visible = (node: Element) => node.getClientRects().length > 0;
  const run = () => { if (!stopped) { performance.mark("ballot-results-ready"); start(); } };
  const check = () => {
    if (stopped || queued || document.readyState !== "complete") return;
    if (!cardsReady) {
      const cards = new Set([...document.querySelectorAll<HTMLElement>("[data-contest-id]")].map(node => node.dataset.contestId));
      cardsReady = ids.every(id => cards.has(id));
      if (!cardsReady) return;
    }
    const pills = [...document.querySelectorAll<HTMLButtonElement>("[data-battlecard-pill]")];
    const controls = pills.length ? pills : [...document.querySelectorAll<HTMLButtonElement>('[data-kind="pick"] button')];
    if (controls.length && !controls.some(node => !node.disabled && visible(node))) return;
    queued = true;
    observer.disconnect();
    window.removeEventListener("load", check);
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (stopped) return;
        if ("requestIdleCallback" in window) idle = window.requestIdleCallback(run, { timeout: 1_000 });
        else run();
      });
    });
  };
  const observer = new MutationObserver(check);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
  window.addEventListener("load", check);
  check();
  return () => {
    stopped = true;
    observer.disconnect();
    window.removeEventListener("load", check);
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(secondFrame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}

export function DeferredBallotResults({ state, contestIds, children }: { state: string; contestIds: readonly string[]; children: ReactNode }) {
  const [loaded, setLoaded] = useState<{ View: ComponentType<ResultViewProps>; feed: ResultFeedResponse; selection: string } | null>(null);
  const selection = JSON.stringify(contestIds);
  useEffect(() => {
    const ids = JSON.parse(selection) as string[];
    if (!state || !ids.length) return;
    const controller = new AbortController();
    const cancel = afterBallotReady(ids, () => {
      const params = new URLSearchParams({ state, contests: ids.join(",") });
      const url = `/api/election-results?${params}`;
      const request = url.length <= 6_000
        ? fetch(url, { signal: controller.signal })
        : fetch("/api/election-results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, contests: ids }), signal: controller.signal });
      void Promise.all([import("./deferred-result-views"), request]).then(async ([views, response]) => {
        if (!response.ok) return;
        const feed = await response.json() as ResultFeedResponse;
        if (!controller.signal.aborted && feed.state === state && feed.facts && typeof feed.facts === "object") {
          startTransition(() => setLoaded({ View: views.ResultView, feed, selection }));
        }
      }).catch(() => { /* The ballot remains usable when the result cache cannot be reached. */ });
    });
    return () => { controller.abort(); cancel(); };
  }, [state, selection]);
  return <ResultsContext.Provider value={loaded?.selection === selection && loaded.feed.state === state ? loaded : null}>{children}</ResultsContext.Provider>;
}

/** Empty during the initial render; the existing card and its controls stay mounted. */
export function DeferredResult(props: ResultSlotProps) {
  const loaded = useContext(ResultsContext);
  return loaded ? <loaded.View {...props} feed={loaded.feed} /> : null;
}
