/**
 * **MEASURE WHAT A LEGISTAR TENANT ACTUALLY PUBLISHES ABOUT ITS OWN DECISIONS.**
 *
 * The numbers in `lib/sources/legistar/outcomes.ts` and
 * `tests/legistar-outcomes.test.ts` came from this walk. It exists so the next
 * session can re-run the measurement instead of re-deriving it by hand, and so
 * the same walk can be pointed at a tenant nobody has looked at yet — every
 * wall that falls becomes a rung.
 *
 * ```
 * pnpm exec tsx scripts/legistar-outcomes-probe.mts --slug pima --body 138 \
 *   --from 2026-05-01 --to 2026-08-29
 * ```
 *
 * ## What it counts, and why each count is separate
 *
 * A single "we have votes for N items" number is the report this repository
 * cannot accept, because the interesting cases are the ones it averages away:
 * an item with an action and no roll, an item flagged roll-call whose roll is
 * empty, an item whose prose carries a tally nobody may expand. Each gets its
 * own column.
 *
 * ## Permission
 *
 * `webapi.legistar.com` publishes no `robots.txt` at all — HTTP 404, recorded
 * `NO_ROBOTS` in `docs/sources.md`. Requests go through `lib/sources/legistar/
 * client.ts`, which identifies itself and paces itself; nothing here runs
 * concurrently and nothing here follows a document URL. `EventMinutesFile`
 * resolves to `legistar.granicus.com`, which answers `Disallow: /`, and this
 * script never fetches it.
 *
 * Read-only. Writes no repository file and no database row.
 */

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import {
  fetchEventItemVotes,
  fetchEvents,
  fetchEventItems,
} from "../lib/sources/legistar/client.ts";
import {
  classifyRollCall,
  hasRecordedAction,
  isFailedExtraction,
  readDisposition,
} from "../lib/sources/legistar/outcomes.ts";
import type {
  LegistarEvent,
  LegistarEventItem,
  LegistarVote,
} from "../lib/sources/legistar/types.ts";

interface Args {
  slug: string;
  bodyId: number | null;
  from: string;
  to: string;
}

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at >= 0 && at + 1 < argv.length ? String(argv[at + 1]) : null;
  };
  const body = read("--body");
  return {
    slug: read("--slug") ?? "pima",
    bodyId: body === null ? null : Number(body),
    from: read("--from") ?? "2026-05-01",
    to: read("--to") ?? "2026-08-29",
  };
}

interface Tally {
  sittings: number;
  items: number;
  withAction: number;
  withPassFlag: number;
  readPassed: number;
  readFailed: number;
  readNotRecorded: number;
  rollCallFlagged: number;
  votesRequested: number;
  voteRows: number;
  itemsWithRollCall: number;
  outcomeWithoutRollCall: number;
  noQuestionPut: number;
  failedExtractions: number;
  tallyProseWithNoRollCall: number;
  requestFailures: number;
}

const TALLY_PROSE = /carried by a|carried \d+-\d+|by a \d+-\d+ vote/i;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const events = await fetchEvents<LegistarEvent>(args.slug, {
    from: args.from,
    to: args.to,
  });
  const sittings =
    args.bodyId === null
      ? events
      : events.filter((event) => event.EventBodyId === args.bodyId);

  const tally: Tally = {
    sittings: sittings.length,
    items: 0,
    withAction: 0,
    withPassFlag: 0,
    readPassed: 0,
    readFailed: 0,
    readNotRecorded: 0,
    rollCallFlagged: 0,
    votesRequested: 0,
    voteRows: 0,
    itemsWithRollCall: 0,
    outcomeWithoutRollCall: 0,
    noQuestionPut: 0,
    failedExtractions: 0,
    tallyProseWithNoRollCall: 0,
    requestFailures: 0,
  };
  const passFlagValues = new Map<string, number>();

  /*
   * **THE FLOOR UNDER EVERY NUMBER THIS PROBE PRINTS (RULING 159).**
   *
   * Every count below is a share of the sittings the API returned for this
   * window. A date range that matches nothing, a body id that does not exist on
   * this tenant, a slug typo, or an endpoint that quietly moved all produce the
   * SAME output as a board that genuinely did not meet: a clean run reporting
   * zeros.
   *
   * That reading is the dangerous one, because a zero here says *this body
   * records no outcomes* — a claim about a government — when the truth may be
   * that the probe never reached it. So the population is floored before
   * anything is counted, and an empty window with no stated reason refuses.
   */
  const population = floored(
    `sittings for ${args.slug}${args.bodyId === null ? "" : ` body ${args.bodyId}`}`,
    `webapi.legistar.com events ${args.from}..${args.to}`,
    events.length,
    sittings.length,
  );

  console.log(
    `${args.slug}: ${sittings.length} sitting(s) ${args.from}..${args.to}` +
      (args.bodyId === null ? "" : ` for body ${args.bodyId}`) +
      `\n${floorLine(population)}`,
  );

  for (const event of sittings) {
    const items = await fetchEventItems<LegistarEventItem>(
      args.slug,
      event.EventId,
    );
    // A zero-row extraction is a FAILED extraction, never an empty agenda.
    if (items.length === 0) {
      console.log(
        `  ${event.EventId} ${String(event.EventDate).slice(0, 10)}: ` +
          "the eventitems route returned ZERO rows — a failed extraction, not an " +
          "agenda with nothing on it",
      );
      continue;
    }

    tally.items += items.length;
    let sittingVotes = 0;
    let sittingRolls = 0;

    for (const item of items) {
      if ((item.EventItemActionName?.trim() || null) !== null) tally.withAction += 1;
      const flag = item.EventItemPassedFlagName?.trim() || null;
      if (flag !== null) {
        tally.withPassFlag += 1;
        passFlagValues.set(flag, (passFlagValues.get(flag) ?? 0) + 1);
      }
      if (item.EventItemRollCallFlag === 1) tally.rollCallFlagged += 1;

      const disposition = readDisposition(item).disposition;
      if (hasRecordedAction(item)) {
        if (disposition === "PASSED") tally.readPassed += 1;
        else if (disposition === "FAILED") tally.readFailed += 1;
        else tally.readNotRecorded += 1;
      }

      // Ask about every place a per-person record could be. Asking only one of
      // them is how the other becomes an asserted absence.
      if (!hasRecordedAction(item) && item.EventItemRollCallFlag !== 1) continue;

      let votes: LegistarVote[] | null = null;
      try {
        votes = await fetchEventItemVotes<LegistarVote>(
          args.slug,
          item.EventItemId,
        );
        tally.votesRequested += 1;
      } catch (error) {
        tally.requestFailures += 1;
        console.log(
          `  ${event.EventId}/${item.EventItemId}: votes request failed — ${String(error)}. ` +
            "Recorded as NOT_RETRIEVED, never as an empty roll",
        );
        continue;
      }

      tally.voteRows += votes.length;
      sittingVotes += votes.length;

      const state = classifyRollCall(item, votes);
      if (state === "RECORDED") {
        tally.itemsWithRollCall += 1;
        sittingRolls += 1;
      } else if (state === "OUTCOME_WITHOUT_ROLL_CALL") {
        tally.outcomeWithoutRollCall += 1;
      } else if (state === "NO_QUESTION_PUT") {
        tally.noQuestionPut += 1;
      }
      if (isFailedExtraction(state)) tally.failedExtractions += 1;

      if (state !== "RECORDED" && TALLY_PROSE.test(item.EventItemActionText ?? "")) {
        tally.tallyProseWithNoRollCall += 1;
      }
    }

    console.log(
      `  ${event.EventId} ${String(event.EventDate).slice(0, 10)} ` +
        `${event.EventBodyName}: ${items.length} items, ${sittingRolls} roll call(s), ` +
        `${sittingVotes} per-person row(s), minutes ${event.EventMinutesStatusName ?? "—"}`,
    );
  }

  console.log("");
  console.log("MEASURED, not estimated:");
  for (const [key, value] of Object.entries(tally)) {
    console.log(`  ${key.padEnd(26)} ${value}`);
  }
  console.log(
    `  passFlagValues             ${JSON.stringify([...passFlagValues])}`,
  );
  console.log("");
  console.log(
    "Read each line as a fact about THIS ROUTE on THIS TENANT. " +
      "`outcomeWithoutRollCall` is the publisher having recorded no per-person roll, " +
      "never a record that nobody voted; `failedExtractions` is our retrieval " +
      "coming back empty where the record says a roll call was taken; " +
      "`tallyProseWithNoRollCall` counts the sentences a pipeline must NOT expand " +
      "into member positions.",
  );
}

await main();
