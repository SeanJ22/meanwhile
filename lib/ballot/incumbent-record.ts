import { cache } from "react";

import type { SeatHolder } from "../officials/lookup.ts";
import { getFundingSnapshot } from "../funding/snapshot.ts";
import { seatHolderById } from "../registry/server.ts";

/** Memoised per `targetKey` for one server request (React `cache`); outside a request it runs unmemoised. */
export const incumbentHolderFor = cache(
  async (targetKey: string): Promise<SeatHolder | null> => {
    let candidates;
    try {
      candidates = getFundingSnapshot().candidates;
    } catch {
      return null;
    }
    const candidate = candidates.find((c) => c.targetKeys.includes(targetKey));
    if (!candidate) return null;
    const rosterIds = candidate.targetKeys.filter((k) =>
      k.startsWith("congress:"),
    );
    if (rosterIds.length !== 1) return null;
    return seatHolderById(rosterIds[0]);
  },
);
