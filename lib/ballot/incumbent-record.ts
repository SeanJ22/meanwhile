import { cache } from "react";

import type { SeatHolder } from "../officials/lookup.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import { seatHolderById } from "../registry/server.ts";
import { statePeopleScopeForId } from "../officials/people-identity.ts";

/** Memoised per `targetKey` for one server request (React `cache`); outside a request it runs unmemoised. */
export const incumbentHolderFor = cache(
  async (targetKey: string): Promise<SeatHolder | null> => {
    const direct = await seatHolderById(targetKey);
    if (direct || targetKey.startsWith("congress:") || statePeopleScopeForId(targetKey)) return direct;
    const identity = readerPersonKeys(targetKey);
    if (identity.status === "IDENTITY_UNRESOLVED") return null;
    const holders = await Promise.all(identity.keys.map(key => seatHolderById(key)));
    const unique = new Map(holders.flatMap(holder => holder ? [[holder.id, holder] as const] : []));
    return unique.size === 1 ? unique.values().next().value! : null;
  },
);
