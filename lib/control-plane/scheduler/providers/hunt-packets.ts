/** Keeps every hunt packet an owner's order created registered: one government, one obligation, one hunter route. */
import { HUNT_PACKET_NAMESPACE, HUNT_PACKET_RECORD_CLASS, HUNT_PACKET_ROUTE_ID, governmentOfPacketObligation, huntPacketObligationId } from "../../../hunt/packet.ts";
import { HUNT_PACKET_ROUTE, huntPacketPlan } from "../../../hunt/packet-plan.ts";
import { NOTHING_MATERIALIZED, type MaterializedReading } from "../provider-inputs.ts";
import type { ObligationProvider, ProvidedObligation, ProviderYield } from "../registry.ts";

export const HUNT_PACKETS_PROVIDER_ID = "hunt-packets";

export function huntPacketsProvider(input: { readonly materialized?: () => MaterializedReading } = {}): ObligationProvider {
  const readMaterialized = input.materialized ?? (() => NOTHING_MATERIALIZED);
  return {
    id: HUNT_PACKETS_PROVIDER_ID,
    describe: "one hunt packet per government an owner's order sent agents to, holding every blank it still owes",
    scheduledId: record => huntPacketObligationId(record.subjectId),
    enumerate(): ProviderYield {
      const materialized = readMaterialized();
      if ("unreadable" in materialized) {
        return { obligations: [], readFailure: `the hunt packets the owner's orders created could not be read (${materialized.unreadable})`, emptyReason: null };
      }
      const obligations: ProvidedObligation[] = [...materialized.ids].filter(id => id.startsWith(HUNT_PACKET_NAMESPACE)).sort()
        .flatMap(id => {
          const governmentId = governmentOfPacketObligation(id);
          return governmentId === null ? [] : [{
            recordClass: HUNT_PACKET_RECORD_CLASS, subjectId: governmentId, scopeDivisions: [governmentId],
            readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null,
            routes: [HUNT_PACKET_ROUTE], autonomousPlans: { [HUNT_PACKET_ROUTE_ID]: huntPacketPlan(governmentId) },
          }];
        });
      return { obligations, readFailure: null, emptyReason: obligations.length === 0 ? "no order has sent agents to a government yet" : null };
    },
  };
}
