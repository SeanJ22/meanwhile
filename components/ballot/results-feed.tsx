"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { afterBallotReady } from "./ballot-narrowing";

/** The checked results for one state's ballot: loading until the ballot accepts input, then settled with whatever the feed holds. */
export type ResultsFeed = { status: "loading" } | { status: "settled"; facts: Readonly<Record<string, unknown>>; clockZone: string | null };

export const ResultsFeedContext = createContext<ResultsFeed>({ status: "loading" });
export const useResultsFeed = (): ResultsFeed => useContext(ResultsFeedContext);

/** The first fact held under any of these ids. */
export function resultFor<T>(feed: ResultsFeed, ids: readonly (string | undefined)[]): T | undefined {
  if (feed.status !== "settled") return undefined;
  return ids.flatMap(id => id && feed.facts[id] !== undefined ? [feed.facts[id]] : [])[0] as T | undefined;
}

/**
 * Results never ride on the ballot read. The browser asks the published feed once, after the ballot has
 * painted and accepts input, and every card fills from that one answer. A failed or empty answer settles
 * with no facts, so each card says it is working on results.
 */
export function ResultsFeedProvider({ state, contestIds, children }: { state: string; contestIds: readonly string[]; children: ReactNode }) {
  const [feed, setFeed] = useState<ResultsFeed>({ status: "loading" });
  const key = contestIds.join(",");
  useEffect(() => {
    const controller = new AbortController();
    const settle = (facts: Readonly<Record<string, unknown>>, clockZone: string | null = null) => { if (!controller.signal.aborted) setFeed({ status: "settled", facts, clockZone }); };
    const cancel = afterBallotReady(() => {
      const url = `/api/election-results?${new URLSearchParams({ state, contests: key })}`;
      const request = url.length <= 6_000
        ? fetch(url, { signal: controller.signal, priority: "low" })
        : fetch("/api/election-results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, contests: key.split(",") }), signal: controller.signal, priority: "low" });
      void request.then(async response => {
        const body = response.ok ? await response.json() as { state?: unknown; facts?: unknown; clockZone?: unknown } : null;
        const facts = body && body.state === state && body.facts && typeof body.facts === "object" && !Array.isArray(body.facts) ? body.facts as Record<string, unknown> : {};
        settle(facts, body?.state === state && typeof body.clockZone === "string" ? body.clockZone : null);
      }).catch(() => settle({}));
    });
    return () => { controller.abort(); cancel(); };
  }, [state, key]);
  return <ResultsFeedContext.Provider value={feed}>{children}</ResultsFeedContext.Provider>;
}
