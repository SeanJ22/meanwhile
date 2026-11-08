"use client";

import { startTransition } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { CardSourceContext, cardSourceTargetFor, waitForCardSourceTarget, type CardSourceRegister } from "@/components/ui/card-source-context";
import { ResultView } from "./deferred-result-views";
import { deferredResultStyles } from "./deferred-result-styles";
import type { ResultChoice, ResultFeedResponse } from "./deferred-result-types";

let rootSequence = 0;

const aliasesOf = (node: HTMLElement): string[] => {
  try { const value: unknown = JSON.parse(node.dataset.candidateAliases ?? "[]"); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; }
  catch { return []; }
};
const statePlace = (state: string) => `ocd-division/country:us/${state === "DC" ? "district" : ["AS", "GU", "MP", "PR", "VI"].includes(state) ? "territory" : "state"}:${state.toLowerCase()}`;

/** Existing identity attributes choose facts; text supplies display labels only. */
function mountCard(card: HTMLElement, feed: ResultFeedResponse, register: CardSourceRegister): () => void {
  const body = card.querySelector<HTMLElement>(".reader-card-body");
  if (!body || !card.dataset.contestId) return () => {};
  const id = card.dataset.contestId, ocdId = card.dataset.ocdId ?? statePlace(feed.state);
  const heading = body.querySelector<HTMLElement>(":scope > .flex > h2");
  const title = card.querySelector(".reader-card-header h2")?.textContent?.trim() ?? "Election results";
  const rule = heading?.parentElement?.querySelector(".t-eyebrow")?.textContent?.match(/\bVote for (\d+)\b/i);
  const voteFor = rule ? Number(rule[1]) : null;
  const candidates = [...card.querySelectorAll<HTMLElement>("li[data-candidate-target]")];
  const choices: ResultChoice[] = candidates.map(node => ({
    id: node.dataset.candidateTarget!, aliases: [...aliasesOf(node), ...node.dataset.candidateTicket ? [node.dataset.candidateTicket] : []],
    name: (node.querySelector("[data-ticket-label]") ?? node.querySelector(".candidate-row .min-w-0.flex-1 > div:first-child > :first-child"))?.textContent?.trim() ?? "",
  }));
  const hosts: HTMLElement[] = [];
  const summary = document.createElement("div");
  if (heading?.parentElement) heading.parentElement.after(summary);
  else body.prepend(summary);
  hosts.push(summary);
  const fact = feed.facts[id] as { outcome?: unknown } | undefined;
  const measure = fact?.outcome !== undefined || card.closest("[data-measure-scope]") !== null;
  const portals = [createPortal(measure
    ? <ResultView kind="measure" id={id} title={title} ocdId={ocdId} measureId={card.querySelector<HTMLElement>("[data-measure-question]")?.dataset.measureQuestion} feed={feed} />
    : <ResultView kind="contest" id={id} title={title} ocdId={ocdId} voteFor={voteFor} choices={choices} feed={feed} />, summary, `contest:${id}`)];
  for (const [index, node] of candidates.entries()) {
    const header = node.querySelector<HTMLElement>(".candidate-row .min-w-0.flex-1 > div:first-child");
    if (!header) continue;
    const host = document.createElement("div");
    header.after(host); hosts.push(host);
    const choice = choices[index], candidate = feed.facts[choice.id] as { incumbent?: unknown } | undefined;
    portals.push(createPortal(<ResultView kind="candidate" id={choice.id} aliases={choice.aliases} contestId={id} incumbent={candidate?.incumbent === true} feed={feed} />, host, `candidate:${choice.id}`));
  }
  const root = createRoot(document.createElement("div"), { identifierPrefix: `election-result-${++rootSequence}:` });
  startTransition(() => root.render(<CardSourceContext.Provider value={register}>{portals}</CardSourceContext.Provider>));
  return () => { queueMicrotask(() => { root.unmount(); hosts.forEach(host => host.remove()); }); };
}

/** This module and the checked feed are loaded only after the original ballot accepts input. */
export async function enhanceBallotResults(signal: AbortSignal): Promise<() => void> {
  const cards = [...document.querySelectorAll<HTMLElement>("article[data-contest-id]")];
  const main = cards[0]?.closest("main");
  const state = (cards.flatMap(node =>
    /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(node.dataset.ocdId ?? "")?.[1] ?? [])[0]
    ?? main?.querySelector<HTMLElement>("[data-office-state]")?.dataset.officeState)?.toUpperCase();
  const ids = cards.flatMap(card => card.dataset.contestId ? [card.dataset.contestId] : []);
  if (!state || !/^[A-Z]{2}$/.test(state) || !ids.length || signal.aborted) return () => {};
  const url = `/api/election-results?${new URLSearchParams({ state, contests: ids.join(",") })}`;
  const response = url.length <= 6_000
    ? await fetch(url, { signal, priority: "low" })
    : await fetch("/api/election-results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, contests: ids }), signal, priority: "low" });
  if (!response.ok || signal.aborted) return () => {};
  const feed = await response.json() as ResultFeedResponse;
  if (signal.aborted || feed.state !== state || !feed.facts || typeof feed.facts !== "object" || Array.isArray(feed.facts)) return () => {};
  let disposed = false;
  const style = document.createElement("style");
  style.dataset.electionResultStyles = ""; style.textContent = deferredResultStyles; document.head.append(style);
  const cleanups: (() => void)[] = [() => style.remove()];
  for (const card of cards) {
    let mounted = false, unmount: (() => void) | undefined;
    const ready = () => {
      if (disposed || mounted || !card.isConnected) return;
      const register = cardSourceTargetFor(card);
      if (!register || [...card.querySelectorAll<HTMLButtonElement>("[data-battlecard-pill]")].some(button => button.disabled)) return;
      mounted = true; observer.disconnect(); stopWaiting();
      unmount = mountCard(card, feed, register);
    };
    const observer = new MutationObserver(ready);
    const stopWaiting = waitForCardSourceTarget(card, ready);
    observer.observe(card, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
    ready();
    cleanups.push(() => { observer.disconnect(); stopWaiting(); unmount?.(); });
  }
  let last = cards.at(-1)!;
  while (last.parentElement && last.parentElement !== main && last.parentElement !== document.body) last = last.parentElement;
  const summary = document.createElement("div"); last.after(summary);
  const root = createRoot(summary, { identifierPrefix: `election-summary-${++rootSequence}:` });
  startTransition(() => root.render(<ResultView kind="summary" feed={feed} />));
  cleanups.push(() => queueMicrotask(() => { root.unmount(); summary.remove(); }));
  const dispose = () => { if (disposed) return; disposed = true; signal.removeEventListener("abort", dispose); cleanups.forEach(cleanup => cleanup()); };
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
