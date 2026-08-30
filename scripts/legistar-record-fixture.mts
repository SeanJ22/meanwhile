/**
 * **RECORD A LEGISTAR REPLY INTO `tests/fixtures/`, VERBATIM.**
 * (WS-LEGI, 2026-08-29.)
 *
 * `CLAUDE.md`: no live calls in tests. A fixture is how a real reply becomes a
 * test, and recording it with a script rather than by hand is what keeps it an
 * actual reply — a hand-written fixture is a guess about a server's output
 * dressed as evidence, and it agrees with the code that was written from the
 * same guess.
 *
 * ```bash
 * pnpm exec tsx scripts/legistar-record-fixture.mts --slug mesa --events --from 2026-05-01 --to 2026-08-29
 * pnpm exec tsx scripts/legistar-record-fixture.mts --slug mesa --eventitems 4717
 * pnpm exec tsx scripts/legistar-record-fixture.mts --slug mesa --votes 123456
 * ```
 *
 * Writes only into `tests/fixtures/legistar/`. Fetches only
 * `webapi.legistar.com`, which publishes no robots.txt (HTTP 404 → `NO_ROBOTS`),
 * through the paced identified client. It follows no document URL.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import {
  fetchEventItemVotes,
  fetchEventItems,
  fetchEvents,
} from "../lib/sources/legistar/client.ts";

const argv = process.argv.slice(2);
const read = (flag: string): string | null => {
  const at = argv.indexOf(flag);
  return at >= 0 && at + 1 < argv.length ? String(argv[at + 1]) : null;
};

const slug = read("--slug") ?? "pima";
const dir = join(process.cwd(), "tests", "fixtures", "legistar");

function write(name: string, endpoint: string, rows: unknown): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  // LF, and a trailing newline. `tests/fixtures` is `-text` in .gitattributes,
  // so a CRLF working copy can hide behind an LF blob and make a later diff
  // unreadable.
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`.replace(/\r\n/g, "\n"), "utf8");

  /*
   * **THE FLOOR ON WHAT THIS SCRIPT PRINTS (RULING 159).**
   *
   * "wrote 0 rows" from a route that answered, and "wrote 0 rows" from a slug
   * typo, a moved endpoint or a window matching nothing, are the same line —
   * and the second one silently produces a fixture that a later test will treat
   * as evidence of what a tenant publishes. So a zero-row reply refuses to
   * report itself as a measurement and says what it could not assert instead.
   *
   * The fixture is still WRITTEN in that case: a recorded zero is a real
   * observation of a route, and RULING 100's whole point is that deciding what
   * it means happens where the item is in scope, not here with only an array.
   */
  const count = Array.isArray(rows) ? rows.length : 1;
  const measured = floored(
    `rows recorded from ${endpoint}`,
    endpoint,
    count,
    count,
    count === 0
      ? "the route returned ZERO rows. The fixture records that reply verbatim, and " +
        "it is NOT evidence that the underlying record does not exist — check the " +
        "slug, the id and the window before treating this file as a measurement"
      : undefined,
  );
  console.log(`wrote ${path}\n  ${floorLine(measured)}`);
}

if (argv.includes("--events")) {
  const rows = await fetchEvents(slug, {
    from: read("--from") ?? "2026-05-01",
    to: read("--to") ?? "2026-08-29",
  });
  write(`legistar-${slug}-events-recorded.json`, `${slug}/events`, rows);
}

const items = read("--eventitems");
if (items !== null) {
  write(
    `legistar-${slug}-eventitems-${items}.json`,
    `${slug}/events/${items}/eventitems`,
    await fetchEventItems(slug, Number(items)),
  );
}

const votes = read("--votes");
if (votes !== null) {
  write(
    `legistar-${slug}-votes-${votes}.json`,
    `${slug}/eventitems/${votes}/votes`,
    await fetchEventItemVotes(slug, Number(votes)),
  );
}
