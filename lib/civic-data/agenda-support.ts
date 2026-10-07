import type { meetingReaderRecords } from "../meetings/reader-records.ts";

export interface AgendaSupportingReaders<TListing> {
  readonly outcomes: () => Promise<ReturnType<typeof meetingReaderRecords>>;
  readonly listingIdentity: () => Promise<TListing>;
}

export async function settleAgendaSupportingHoldings<TListing>(
  meetingId: string,
  bodyId: string | null,
  readers: AgendaSupportingReaders<TListing>,
): Promise<{
  records: ReturnType<typeof meetingReaderRecords>;
  listingIdentity: TListing | null;
  supportingHoldingStatus: "HELD" | "PARTIAL";
  unavailableAuthorities: string[];
}> {
  const [outcomeResult, listingResult] = await Promise.allSettled([
    Promise.resolve().then(() => readers.outcomes()),
    Promise.resolve().then(() => readers.listingIdentity()),
  ]);
  const unavailableAuthorities: string[] = [];
  if (outcomeResult.status === "rejected") unavailableAuthorities.push("MEETING_OUTCOME");
  if (listingResult.status === "rejected") unavailableAuthorities.push("REGISTRY_RUNTIME_BINDING");
  return {
    records: outcomeResult.status === "fulfilled" ? outcomeResult.value : {
      meetingId,
      bodyId,
      status: "HOLDING_UNAVAILABLE",
      agenda: [],
      actions: [],
      rollCalls: [],
      counts: { agenda: 0, actions: 0, rollCalls: 0, votes: 0 },
      sourceUrl: null,
      sourceOrg: null,
    },
    listingIdentity: listingResult.status === "fulfilled" ? listingResult.value : null,
    supportingHoldingStatus: unavailableAuthorities.length ? "PARTIAL" : "HELD",
    unavailableAuthorities,
  };
}
