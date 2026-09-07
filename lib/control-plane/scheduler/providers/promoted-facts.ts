/**
 * **THE SIXTH PROVIDER: ONE OBLIGATION PER FACT CLASS PER BODY.**
 * (Fleet Promotion Readiness, PRDY-5, 2026-09-06.)
 *
 * The five providers RULING 229 named are corpus-shaped: a body in the
 * snapshot, a jurisdiction in the state file, a tracker row. This one is
 * fact-shaped. It enumerates the (record class, canonical body) pairs the
 * promotion pipeline holds bridged facts for and schedules the feed each was
 * acquired from, so `freshness:meeting-times:<bodyId>` and
 * `freshness:agendas:<bodyId>` exist as durable obligations with the
 * scheduler's own cadence, next-due, occurrences and debt.
 *
 * The subjects are read from the control plane BEFORE the registry is built
 * (`factSubjectsFromStates` over the pipeline states) and handed in; the
 * provider itself is synchronous and file-free like the other five. A
 * `local-jurisdictions` route obligation for the same subject stays a separate
 * row: an upstream route being fresh says nothing about a fact being fresh.
 */
import { PROMOTED_FACTS_PROVIDER_ID, factObligationId, type FactSubject } from "../../promotion/fact-freshness.ts";
import type { ObligationProvider, ProvidedObligation, ProviderYield, RouteDescriptor } from "../registry.ts";

export function promotedFactsProvider(subjects: readonly FactSubject[]): ObligationProvider {
  return {
    id: PROMOTED_FACTS_PROVIDER_ID,
    describe:
      "one obligation per (record class, canonical body) the promotion pipeline holds a bridged " +
      "meeting-time or agenda fact for, worked through the official feed the fact was acquired from",
    scheduledId: (record) => factObligationId(record.recordClass as FactSubject["recordClass"], record.subjectId),
    enumerate(): ProviderYield {
      const obligations: ProvidedObligation[] = subjects.map((subject) => {
        const route: RouteDescriptor = {
          routeId: subject.sourceKey,
          label: `${subject.sourceKey} — the official feed the ${subject.recordClass} facts were bridged from`,
          executorClass: "DETERMINISTIC",
          executorReason:
            "an HTTP GET against the same official representation the fact was acquired from; " +
            "no model is needed to re-derive a route the evidence already names",
          open: { kind: "HTTP_GET", url: subject.canonicalUrl },
          citation: "the promotion pipeline's FLEET_EXTRACTION records — the fact's own acquisition",
        };
        return {
          recordClass: subject.recordClass,
          subjectId: subject.subjectId,
          readerImpactAt: subject.nextApplicableAt,
          observedChangeRateHours: null,
          lastWorkedAt: subject.lastAcquiredAt,
          routes: [route],
        };
      });
      return {
        obligations,
        readFailure: null,
        emptyReason: obligations.length === 0
          ? "the promotion pipeline holds no bridged meeting-time or agenda fact yet, so no fact class has a body to be fresh for; this is the mapped state, not an empty read"
          : null,
      };
    },
  };
}
