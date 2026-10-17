import { factReader } from "../../facts/db.ts";
import type { Query } from "../../facts/publish.ts";
import { publisherSizeForState } from "../../sources/publisher-size.ts";
import type { FreshnessObligation } from "./obligation.ts";
import { scoutStateHint } from "./field-manual-scout.ts";

/** Held facts about the website being requested, never the hunt's jurisdiction. */
export interface WebsiteSize {
  readonly kind: "local-government" | "school-district" | "state" | "federal" | "national";
  readonly population?: number | null;
  readonly students?: number | null;
}

export type WebsiteSizeForUrl = (url: string) => WebsiteSize | null | undefined;

/** Resolve the requested publisher across the job's states; shared hosts stay unknown. Each state is read once, then URLs are answered from it. */
export async function websiteSizeFromHoldings(states: readonly string[], query: Query | null = factReader()): Promise<WebsiteSizeForUrl> {
  const readers = await Promise.all([...new Set(states.map(state => state.toLowerCase()))].map(state => publisherSizeForState(query, state)));
  return url => {
    let found: WebsiteSize | null = null;
    for (const read of readers) {
      const size = read(url);
      if (!size) continue;
      if (found) return null;
      found = size;
    }
    return found;
  };
}

export function websiteSizeForObligation(obligation: Pick<FreshnessObligation, "id" | "subjectId" | "autonomousPlan" | "scopeDivisions">, query?: Query | null): Promise<WebsiteSizeForUrl> {
  return websiteSizeFromHoldings([
    ...(obligation.autonomousPlan ? [obligation.autonomousPlan.jurisdiction] : []),
    ...scoutStateHint(obligation.subjectId, obligation.id),
    ...(obligation.scopeDivisions ?? []).flatMap(division => scoutStateHint(division, null)),
  ], query);
}

/** Only known small local publishers have a ten-request cap. */
export function websiteRequestLimit(size?: WebsiteSize | null): 10 | null {
  const count = size?.kind === "local-government" ? size.population
    : size?.kind === "school-district" ? size.students : null;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  return count < (size?.kind === "school-district" ? 5_000 : 10_000) ? 10 : null;
}
