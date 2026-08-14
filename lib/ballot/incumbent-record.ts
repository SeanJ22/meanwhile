import type { SeatHolder } from "../officials/lookup.ts";
import { getFundingSnapshot } from "../funding/snapshot.ts";
import { seatHolderById } from "../registry/server.ts";

/**
 * The incumbent behind a ballot candidacy, where the join is EXACT (4,
 * 2026-08-19).
 *
 * An incumbent on a ballot IS an official we already hold, and the pairing
 * already exists: the FEC snapshot's targetKeys bind a roster id
 * (`congress:…`, matched by the bioguide bridge) and the ballot candidacy
 * keys (matched by roster-person reuse or scoped search) to one FEC
 * candidate exactly when they are the same person. This reads that
 * pairing — never a name string.
 *
 * No link rather than a wrong one: a ballot key with no snapshot pairing,
 * a pairing carrying zero or several roster ids, or a roster id the
 * officeholder index doesn't hold all return null. Federal only by
 * construction — the roster ids in targetKeys are congressional; a state
 * incumbent has no roll-call surface to link yet anyway.
 */
export async function incumbentHolderFor(
  targetKey: string,
): Promise<SeatHolder | null> {
  let candidates;
  try {
    candidates = getFundingSnapshot().candidates;
  } catch {
    // No snapshot, no join — the card simply has no record link.
    return null;
  }
  const candidate = candidates.find((c) => c.targetKeys.includes(targetKey));
  if (!candidate) return null;
  const rosterIds = candidate.targetKeys.filter((k) =>
    k.startsWith("congress:"),
  );
  if (rosterIds.length !== 1) return null;
  return seatHolderById(rosterIds[0]);
}
