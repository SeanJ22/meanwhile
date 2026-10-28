"use client";

import { useEffect, useState } from "react";
import { bodyDetailState, loadBodyDetail } from "@/lib/registry/body-roster-client";
import type { ReaderBodyDetail } from "@/lib/reader/body-detail";
import type { CoveredBody } from "@/lib/registry/coverage";

/** A list surface asks only for the bodies whose people it displays. */
export function useBodyDetails(bodies: readonly CoveredBody[], enabled: boolean) {
  const targets = bodies.flatMap(body => enabled && !body.readerRoster && body.rosterSummary?.memberCount
    ? [{ id: body.bodyId, state: bodyDetailState(body) }] : []);
  const key = JSON.stringify(targets);
  const [held, setHeld] = useState<{ key: string; values: Record<string, ReaderBodyDetail | null> }>({ key, values: {} });
  if (held.key !== key) setHeld({ key, values: {} });
  useEffect(() => {
    const requested = JSON.parse(key) as { id: string; state: string | null }[];
    if (!requested.length) return;
    let active = true, next = 0;
    const run = async () => {
      while (active && next < requested.length) {
        const target = requested[next++];
        const value = target.state ? await loadBodyDetail(target.state, target.id).catch(() => null) : null;
        if (active) setHeld(prior => prior.key === key ? { key, values: { ...prior.values, [target.id]: value } } : prior);
      }
    };
    for (let index = 0; index < Math.min(6, requested.length); index++) void run();
    return () => { active = false; };
  }, [key]);
  const values = held.key === key ? held.values : {};
  const enriched = bodies.map(body => {
    const detail = values[body.bodyId];
    return detail ? { ...body, readerRoster: detail.roster, fieldSources: detail.fieldSources } : body;
  });
  return { bodies: enriched, pending: targets.some(target => !(target.id in values)),
    failed: targets.some(target => target.id in values && values[target.id] === null) };
}
