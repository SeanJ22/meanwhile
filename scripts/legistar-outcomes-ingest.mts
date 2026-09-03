/**
 * **THE DURABLE INGEST — move Legistar outcomes off a terminal and into a store.**
 * (WS-LEGI, 2026-08-29.)
 *
 * `scripts/legistar-outcomes-probe.mts` MEASURES a tenant and writes nothing.
 * That is the right thing for a probe to be, and it is why reader outcome
 * answerability sat at 0 of 30 held Pima Board sittings while the repository
 * was demonstrably able to retrieve all twenty it had walked: the data was
 * harvested and then discarded, every run.
 *
 * This command is the same walk with a destination.
 *
 * ```bash
 * # Bounded historical backfill — a window and a per-run sitting budget.
 * pnpm outcomes:ingest --slug pima --body 138 --from 2026-05-01 --to 2026-08-29
 *
 * # Afterwards: incremental. Only sittings the PUBLISHER says changed.
 * pnpm outcomes:ingest --slug pima --body 138
 *
 * # See what it would do, ask nothing of the tenant beyond the event list.
 * pnpm outcomes:ingest --slug pima --dry-run
 * ```
 *
 * ## Acquisition discipline, and why each piece is here
 *
 * - **Bounded backfill.** `--max-sittings` caps one run. The cap is a BUDGET and
 *   never a completion condition: a run that hits it says so and exits with the
 *   cursor intact, because a finite attempt count never earns an absence
 *   (RULING 170, RULING 184).
 * - **Incremental refresh.** `refreshDecision` in `lib/outcomes/ingest.ts` keys
 *   on the publisher's own `EventLastModifiedUtc`. After the first backfill a
 *   refresh costs one `events` request per tenant plus the items and votes of
 *   only the sittings whose stamp moved.
 * - **Durable resume.** The store is written after EVERY sitting. Kill this
 *   command in the middle of Pima's 545 vote requests and the next run resumes
 *   at the first unwalked sitting rather than starting again.
 * - **Bounded concurrency: exactly one.** `client.ts` serializes and paces at
 *   350 ms per request against a single tenant, with `Retry-After` honoured.
 *   Nothing here parallelizes against one host. Where a future run walks several
 *   TENANTS, they are different hosts' budgets and may proceed independently.
 * - **Retryable failures stay open.** A votes request that threw is persisted as
 *   a failure on the sitting and re-walked next run (`OPEN_VOTE_FAILURES`). It
 *   is never written as an empty roll, which is the one thing that would make
 *   the failure permanent and invisible.
 *
 * ## Permission
 *
 * `webapi.legistar.com` publishes no robots.txt — HTTP 404, recorded `NO_ROBOTS`
 * in `docs/sources.md`. Requests go through `lib/sources/legistar/client.ts`,
 * which identifies itself with a contact address and paces itself. **Nothing
 * here follows a document URL.** Every Pima and Mesa `EventAgendaFile` and
 * `EventMinutesFile` resolves to `legistar.granicus.com`, which answers
 * `User-agent: *` with `Disallow: /`; those URLs are RECORDED as leads and are
 * not fetched.
 *
 * Writes exactly one repository file: `data/states/az/outcomes/legistar-outcomes.json`.
 * Touches no database and makes no request to Meanwhile's own production.
 *
 * `@freshness-reads-here` — RULING 107's declared carve-out, and it is the rule
 * being obeyed rather than sidestepped. The clock reading in this file mints
 * `PersistedPublicationStatus.observedAt`, which is stamped in the same run that
 * just read `/events` for that tenant, on the rows that read returned. It is the
 * retrieval path, so a date from the clock here is a true statement about when
 * the publisher's surface was actually read. The freshness stamps that travel on
 * the RECORDS are a different matter and are NOT taken from a clock: `receiptFor`
 * in `lib/sources/legistar/outcomes.ts` mints those from the reply itself, so a
 * sitting whose items route came back empty carries `NEVER_READ` rather than
 * today's date on a document nobody received.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { today as stampToday } from "./doc-dates.mjs";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import {
  fetchEventItemVotes,
  fetchEventItems,
  fetchEvents,
} from "../lib/sources/legistar/client.ts";
import { findClient, LEGISTAR_CLIENTS } from "../lib/sources/legistar/client-registry.ts";
import { legistarStartsAt } from "../lib/sources/legistar/index.ts";
import { collectEventOutcomes } from "../lib/sources/legistar/outcomes.ts";
import type {
  LegistarEvent,
  LegistarEventItem,
  LegistarVote,
} from "../lib/sources/legistar/types.ts";
import {
  countSitting,
  emptyTally,
  mergeSnapshot,
  refreshDecision,
  toPersistedSitting,
} from "../lib/outcomes/ingest.ts";
import { OUTCOME_SNAPSHOT_PATH } from "../lib/outcomes/store.ts";
import type {
  OutcomeSnapshot,
  PersistedSittingOutcomes,
} from "../lib/outcomes/types.ts";

interface Args {
  slug: string;
  bodyId: number | null;
  from: string | null;
  to: string | null;
  maxSittings: number;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at >= 0 && at + 1 < argv.length ? String(argv[at + 1]) : null;
  };
  const body = read("--body");
  const max = read("--max-sittings");
  return {
    slug: read("--slug") ?? "pima",
    bodyId: body === null ? null : Number(body),
    from: read("--from"),
    to: read("--to"),
    /*
     * A BUDGET, not a completion condition. A run that stops here reports that
     * it stopped here and what remains; it never reports the tenant as done.
     */
    maxSittings: max === null ? 40 : Number(max),
    dryRun: argv.includes("--dry-run"),
    /*
     * Rewalk regardless of the publisher's modification stamp.
     *
     * For the case the incremental key cannot see: a change in OUR transform.
     * When the shape a sitting is persisted in changes — a field added, a
     * derivation corrected — the publisher's row has not moved and
     * `refreshDecision` correctly reports UNCHANGED_SKIP, so the held rows keep
     * the old shape forever. It is deliberately a flag and not a default,
     * because the whole point of the incremental path is that a refresh does not
     * cost a tenant 545 requests.
     */
    force: argv.includes("--force"),
  };
}

const STORE = join(process.cwd(), ...OUTCOME_SNAPSHOT_PATH);

function loadStore(): OutcomeSnapshot {
  try {
    return JSON.parse(readFileSync(STORE, "utf8")) as OutcomeSnapshot;
  } catch {
    return { generatedOn: "UNKNOWN", generatedAt: "UNKNOWN", tenants: [], sittings: [] };
  }
}

function writeStore(snapshot: OutcomeSnapshot): void {
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

/**
 * The sitting's start as an ISO instant, preferring the served snapshot.
 *
 * The snapshot's value is what a reader is already being shown, so agreeing
 * with it byte for byte is worth a file read. But the snapshot's window is
 * NARROWER than a backfill's — four of Pima's twenty backfilled sittings are
 * older than the served horizon — so a miss falls back to `legistarStartsAt`,
 * which is the same reassembly `normalize()` performs. Null only when the
 * publisher gives no usable time at all.
 */
function startsAtFromMeetings(meetingId: string): string | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "data", "meetings-snapshot.json"), "utf8"),
    ) as unknown;
    const rows = Array.isArray(raw)
      ? raw
      : ((raw as { meetings?: unknown[] }).meetings ?? []);
    for (const row of rows as { id?: string; startsAt?: string }[]) {
      if (row.id === meetingId) return row.startsAt ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = findClient(args.slug);
  if (client === undefined) {
    console.error(
      `No LegistarClient is wired for slug "${args.slug}". Known: ` +
        `${LEGISTAR_CLIENTS.map((c) => c.slug).join(", ")}. ` +
        "A tenant needs an ocdId, a bodyId and a time zone before its outcomes " +
        "can be linked to anything — add it to lib/sources/legistar/client-registry.ts. " +
        "This is a gap in OUR wiring and says nothing about the tenant.",
    );
    process.exitCode = 1;
    return;
  }

  const to = args.to ?? stampToday();
  const from = args.from ?? "2026-01-01";

  const events = await fetchEvents<LegistarEvent>(args.slug, { from, to });
  const sittings = (
    args.bodyId === null
      ? events
      : events.filter((event) => event.EventBodyId === args.bodyId)
  ).sort((a, b) => String(b.EventDate).localeCompare(String(a.EventDate)));

  /*
   * **THE FLOOR UNDER EVERY NUMBER BELOW (RULING 159, RULING 116).**
   *
   * Every count this run prints is a share of the sittings the events route
   * returned for this window. A window that matches nothing, a body id that is
   * not on this tenant, a slug typo, or an endpoint that quietly moved all
   * produce the SAME output as a board that genuinely did not meet: a clean run
   * reporting zeros.
   *
   * A zero here would read as *this body records no outcomes* — a claim about a
   * government — when the truth may be that the run never reached it. So the
   * population is floored before anything is counted.
   */
  const population = floored(
    `sittings for ${args.slug}${args.bodyId === null ? "" : ` body ${args.bodyId}`}`,
    `webapi.legistar.com events ${from}..${to}`,
    events.length,
    sittings.length,
    events.length === 0
      ? "the events route returned NO rows for this window, so there is no " +
        "denominator to measure against and nothing is asserted about this body"
      : undefined,
  );

  console.log(
    `${args.slug}: ${sittings.length} sitting(s) ${from}..${to}` +
      (args.bodyId === null ? "" : ` for body ${args.bodyId}`) +
      `\n${floorLine(population)}`,
  );

  /*
   * A zero-sitting window is NOT "this body did not meet". It is one of: a
   * window that matches nothing, a body id that is not on this tenant, a slug
   * typo, or a route that moved. Every one of those produces a clean run
   * printing zeros, and the dangerous reading is a claim about a government.
   */
  if (sittings.length === 0) {
    console.log(
      "ZERO sittings returned for this window. That is a fact about THIS ROUTE with " +
        "THESE ARGUMENTS and never a fact about the body. Nothing was written. " +
        "Check the slug, the body id and the window before concluding anything.",
    );
    return;
  }

  let store = loadStore();
  const heldById = new Map(store.sittings.map((s) => [s.meetingId, s]));
  const tally = emptyTally();
  const observedAt = new Date().toISOString();
  let budgetExhausted = false;

  for (const event of sittings) {
    tally.sittingsSeen += 1;
    const meetingId = `legistar:${client.slug}:${event.EventId}`;
    const decision = args.force
      ? ({ walk: true, reason: "FORCED" } as const)
      : refreshDecision(event, heldById.get(meetingId));

    if (!decision.walk) {
      tally.skippedUnchanged += 1;
      continue;
    }

    if (tally.walked >= args.maxSittings) {
      budgetExhausted = true;
      break;
    }

    if (args.dryRun) {
      console.log(`  would walk ${meetingId} — ${decision.reason}`);
      tally.walked += 1;
      continue;
    }

    let persisted: PersistedSittingOutcomes;
    try {
      const collected = await collectEventOutcomes(args.slug, event.EventId, {
        sourceOrg: client.publishingOrg,
        fetchItems: (slug, id) => fetchEventItems<LegistarEventItem>(slug, id),
        fetchVotes: (slug, id) => fetchEventItemVotes<LegistarVote>(slug, id),
      });
      persisted = toPersistedSitting({
        event,
        client,
        collected,
        observedAt,
        startsAt:
          startsAtFromMeetings(meetingId) ?? legistarStartsAt(event, client.timeZone),
        // Only routes that actually returned. `WEBAPI_EVENTITEM_VOTES` is listed
        // because it was ASKED for every acted item; whether any given item had
        // a roll is the item's own recorded state, not this route's.
        routesWalked: ["WEBAPI_EVENTS", "WEBAPI_EVENTITEMS", "WEBAPI_EVENTITEM_VOTES"],
      });
    } catch (error) {
      persisted = toPersistedSitting({
        event,
        client,
        collected: {
          slug: args.slug,
          eventId: event.EventId,
          agenda: [],
          outcomes: [],
          rollCalls: [],
          failedRollCallExtractions: [],
          voteRequestFailures: [],
        },
        observedAt,
        startsAt:
          startsAtFromMeetings(meetingId) ?? legistarStartsAt(event, client.timeZone),
        routesWalked: ["WEBAPI_EVENTS"],
        requestError: String(error),
      });
    }

    countSitting(tally, persisted);

    /*
     * DURABLE RESUME. Written after every sitting rather than once at the end,
     * so an interrupted run keeps everything it paid for. Pima's backfill is
     * 545 vote requests; losing it to a dropped connection at request 500 would
     * be the kind of cost that makes a later session decide the source is too
     * expensive to collect.
     */
    store = mergeSnapshot(store, [persisted], {
      generatedOn: stampToday(),
      generatedAt: new Date().toISOString(),
    });
    writeStore(store);

    console.log(
      `  ${meetingId} ${String(event.EventDate).slice(0, 10)} (${decision.reason}): ` +
        `${persisted.agenda.length} item(s), ${persisted.outcomes.length} action(s), ` +
        `${persisted.rollCalls.length} roll call(s), ` +
        `${persisted.rollCalls.reduce((n, r) => n + r.votes.length, 0)} per-person row(s)` +
        (persisted.extraction === "RETRIEVED" ? "" : ` — ${persisted.extraction}`),
    );
  }

  console.log("");
  console.log("MEASURED, not estimated:");
  for (const [key, value] of Object.entries(tally)) {
    console.log(`  ${key.padEnd(28)} ${value}`);
  }

  if (budgetExhausted) {
    console.log("");
    console.log(
      `STOPPED AT THE PER-RUN BUDGET of ${args.maxSittings} sitting(s), with ` +
        `${sittings.length - tally.sittingsSeen + 1} sitting(s) in this window not yet ` +
        "reached. This is a BUDGET and not a completion condition — the tenant is " +
        "not done, the store is consistent, and the next run resumes here. A finite " +
        "attempt count never earns an absence (RULING 170).",
    );
  }
}

await main();
