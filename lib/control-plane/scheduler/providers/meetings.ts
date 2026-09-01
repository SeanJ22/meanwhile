/**
 * **PROVIDER ONE — MEETINGS.** (Session C, PART D1, 2026-08-31.)
 *
 * This is what the runner used to be hard-wired to, expressed as one provider
 * among several rather than as the loop's only possible input. Nothing about
 * what it produces changed, and that is deliberate: the durable control plane
 * already holds `freshness:meetings:<subject>` rows carrying next-dues,
 * occurrence counts and debt that this process did not create and must not
 * reset. A registry that renamed them would silently start every body's clock
 * again from zero, which is the same defect as having no durable state, wearing
 * a registry.
 *
 * ## One record, one representation — and that is a FACT about this corpus
 *
 * A body's calendar has exactly one route here because the snapshot's
 * provenance records exactly one `sourceUrl` per body. That is not a claim that
 * a calendar has one representation; the agenda PDF, the ICS feed and the
 * vendor API are all materially distinct representations of the same record and
 * RULING 207 says none of them retires the others. **We simply have not
 * enumerated them, and the shape of this provider is what will hold them when
 * we do** — `routes` is a list here for the same reason it is a list for
 * campaign finance.
 *
 * ## The route id is the PUBLISHER, and it resolves UNGRADUATED
 *
 * `provenance.sourceOrg` is a publisher name ("Pima County"); the method store
 * identifies routes by method id. Nothing joins them, so every meetings unit
 * dispatches to the bounded lane by `chooseExecutor`'s reading while the
 * DECLARED executor stays deterministic. That reading is honest and it is
 * `maturity.ts`'s recorded finding, not a new one. The `executorClass` below is
 * DETERMINISTIC because an HTTP GET is deterministic, and the digest's
 * decision/fact split is where the disagreement shows.
 */

import { readSnapshot } from "../../../meetings/snapshot.ts";

import type {
  ObligationProvider,
  ProvidedObligation,
  ProviderContext,
  ProviderYield,
  RouteDescriptor,
} from "../registry.ts";

export const MEETINGS_PROVIDER_ID = "meetings";

/** The obligation id shape the durable store already holds. Do not change. */
export function meetingsObligationId(subjectId: string): string {
  return `freshness:meetings:${subjectId}`;
}

export function meetingsProvider(): ObligationProvider {
  return {
    id: MEETINGS_PROVIDER_ID,
    describe:
      "one obligation per BODY in the committed meetings snapshot, worked through the calendar " +
      "URL that body's own provenance recorded",

    scheduledId: (record) => meetingsObligationId(record.subjectId),

    enumerate(ctx: ProviderContext): ProviderYield {
      let snapshot: ReturnType<typeof readSnapshot>;
      try {
        snapshot = readSnapshot(ctx.root);
      } catch (error) {
        return {
          obligations: [],
          readFailure:
            `data/meetings-snapshot.json could not be parsed (${
              error instanceof Error ? error.message : String(error)
            }). Nothing is scheduled for meetings this cycle, and this is a failure to read OUR ` +
            "corpus rather than a statement that no body publishes a calendar.",
          emptyReason: null,
        };
      }
      if (snapshot === null) {
        return {
          obligations: [],
          readFailure:
            "data/meetings-snapshot.json is not present, so no body's calendar can be scheduled. " +
            "An absent corpus is an absent corpus; it is not an empty one.",
          emptyReason: null,
        };
      }

      const nowMs = Date.parse(ctx.nowIso);
      const byBody = new Map<
        string,
        {
          subjectId: string;
          sourceOrg: string | null;
          sourceUrl: string | null;
          nextSittingMs: number | null;
          lastReadMs: number | null;
        }
      >();

      for (const meeting of snapshot.meetings) {
        const subjectId = meeting.bodyId ?? meeting.ocdId;
        if (!subjectId) continue;
        const row =
          byBody.get(subjectId) ??
          { subjectId, sourceOrg: null, sourceUrl: null, nextSittingMs: null, lastReadMs: null };

        /* Only a FUTURE sitting is a reader deadline. A meeting that has
           happened carries no staleness a refresh could still prevent. */
        const starts = Date.parse(meeting.startsAt);
        if (Number.isFinite(starts) && starts > nowMs) {
          row.nextSittingMs =
            row.nextSittingMs === null ? starts : Math.min(row.nextSittingMs, starts);
        }

        const collected = Date.parse(meeting.provenance?.collectedAt ?? "");
        if (Number.isFinite(collected)) {
          row.lastReadMs = row.lastReadMs === null ? collected : Math.max(row.lastReadMs, collected);
        }

        row.sourceOrg = row.sourceOrg ?? meeting.provenance?.sourceOrg ?? null;
        row.sourceUrl = row.sourceUrl ?? meeting.provenance?.sourceUrl ?? null;
        byBody.set(subjectId, row);
      }

      const obligations: ProvidedObligation[] = [];
      for (const row of [...byBody.values()].sort((a, b) =>
        a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0,
      )) {
        /*
         * NO ROUTE ID MEANS NO SCHEDULED UNIT, and the count difference is
         * reported by the caller. `openOccurrence` returns null for a routeless
         * obligation anyway; producing one here would manufacture a row whose
         * only possible outcome is NO_ROUTE_TASK.
         */
        if (row.sourceOrg === null) continue;

        const route: RouteDescriptor = {
          routeId: row.sourceOrg,
          label: `${row.sourceOrg} — the body's own published calendar`,
          executorClass: "DETERMINISTIC",
          executorReason:
            "an HTTP GET against a URL this project already holds provenance for; no model is " +
            "needed to re-derive a route we recorded",
          open:
            row.sourceUrl === null
              ? {
                  kind: "NOT_MACHINE_EXECUTABLE",
                  target: row.subjectId,
                  reason:
                    "the snapshot records this body's publisher but no sourceUrl for it, so there " +
                    "is no held representation to open. That is a gap in OUR provenance and the " +
                    "record stays owed.",
                }
              : { kind: "HTTP_GET", url: row.sourceUrl },
          citation: "data/meetings-snapshot.json — the body's own provenance",
        };

        obligations.push({
          recordClass: "meetings",
          subjectId: row.subjectId,
          readerImpactAt:
            row.nextSittingMs === null ? null : new Date(row.nextSittingMs).toISOString(),
          /*
           * Honestly null. No change-rate series exists per publisher, and one
           * derived from a single `collectedAt` is one observation wearing a
           * rate's name. Rows fall to the reader-impact signal or to RULING
           * 212's daily default and `cadenceSource` says which.
           */
          observedChangeRateHours: null,
          lastWorkedAt: row.lastReadMs === null ? null : new Date(row.lastReadMs).toISOString(),
          routes: [route],
        });
      }

      return {
        obligations,
        readFailure: null,
        emptyReason:
          obligations.length === 0
            ? `the meetings snapshot was READ and holds ${snapshot.meetings.length} meeting(s), none of ` +
              "which carried both a body identity and a publisher. A snapshot that parses and yields " +
              "no schedulable body is a defect in the corpus, not an empty domain."
            : null,
      };
    },
  };
}
