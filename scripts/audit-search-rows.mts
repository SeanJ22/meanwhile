/**
 * M135 — the every-row-opens-a-card audit, measured for the ask panel's
 * autocomplete.
 *
 * ## Why this is measured rather than read off the source
 *
 * M135's open half asks whether every row on every list surface opens a card.
 * For the autocomplete the answer is not readable from the code, because what a
 * row does depends on the DATA behind it: `onSearchPick` selects a venue when
 * the row carries a `venueKey`, flies the camera when the row carries a
 * lat/lng, and — before this session — did nothing at all for a row carrying
 * neither. D18 named that defect for the meetings LIST ("a row that answers a
 * click with silence") and fixed it there; the sibling handler never got it.
 *
 * How many rows that actually was is a question about production data, so it is
 * asked of production data, with the denominator stated.
 *
 * ## The two models, and why both are printed
 *
 * BEFORE is the handler as it stood: venue, else geometry, else nothing.
 * AFTER is the handler as it now stands: venue, else a card for the kinds that
 * have one, else geometry, else nothing.
 *
 * Printing both is the point. A fix reported without its delta is a fix nobody
 * can size, and this audit has already caught one change of its own that moved
 * no number at all — an earlier attempt reordered which meeting represents a
 * body aggregate, on the theory that an online sitting was shadowing a located
 * one. The before and after were identical (21 silent either way), because
 * venue meetings are iterated ahead of online ones and the aggregate already
 * preferred a located representative. That change was reverted rather than
 * shipped with a story attached.
 *
 * AFTER models the handler; it does not execute it. What keeps the model honest
 * is `tests/search-rows.test.ts`, which pins the handler's branches in source —
 * so a later edit that deletes a fallback fails there rather than quietly
 * making this script's AFTER column a fiction.
 *
 * ## The rows this run writes
 *
 * Every `/api/meetings` GET writes a search-log row, so this script is not
 * read-only against the store. It declares itself SYNTHETIC on every request;
 * without that its rows land ORGANIC in the store the business sells from.
 */

import { syntheticRunHeaders, makeRunId } from "../lib/db/run-marker.ts";
import { buildSearchIndex, type SearchItem } from "../lib/search/index.ts";
import { groupByVenue } from "../lib/meetings/venues.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(
  /\/$/,
  "",
);

const ZIPS = [
  { zip: "85701", lat: 32.21696, lng: -110.971, name: "Tucson" },
  { zip: "85641", lat: 32.04903, lng: -110.62291, name: "Vail" },
  { zip: "07866", lat: 40.95499, lng: -74.48801, name: "Rockaway" },
  { zip: "03255", lat: 43.31403, lng: -72.02455, name: "Newbury" },
] as const;

const runId = makeRunId("m135-search-audit", new Date().toISOString());
const headers = syntheticRunHeaders({ WTP_RUN_ID: runId });

type Outcome = "venue panel" | "card" | "flies only" | "SILENT";

/**
 * The handler's resolution of a body row, modelled exactly as
 * `onSearchPick` resolves it.
 *
 * Several bodies share one division and `CoveredBody.name` is null on derived
 * rows, so a match on ocdId alone would open one body's card from another
 * body's row. Division AND name, or a division that holds exactly one body.
 * Anything else resolves to nothing, because no card is strictly better than
 * the wrong card.
 */
function resolveBody(bodies: CoveredBody[], item: SearchItem): CoveredBody | null {
  const candidates = bodies.filter(
    (b) => b.ocdId !== null && b.ocdId === item.ocdId,
  );
  const named = candidates.filter((b) => b.name === item.label);
  if (named.length === 1) return named[0];
  if (candidates.length === 1) return candidates[0];
  return null;
}

function outcomeBefore(item: SearchItem): Outcome {
  if (item.venueKey !== null) return "venue panel";
  if (item.lat !== null && item.lng !== null) return "flies only";
  return "SILENT";
}

function outcomeAfter(
  item: SearchItem,
  meetings: Meeting[],
  bodies: CoveredBody[],
): Outcome {
  if (item.venueKey !== null) return "venue panel";
  if (item.kind === "meeting") {
    const found = meetings.some((m) => `meeting:${m.id}` === item.id);
    if (found) return "card";
  }
  if (item.kind === "body" && resolveBody(bodies, item) !== null) return "card";
  if (item.lat !== null && item.lng !== null) return "flies only";
  return "SILENT";
}

interface Tally {
  rows: number;
  venue: number;
  card: number;
  flies: number;
  silent: number;
}

function empty(): Tally {
  return { rows: 0, venue: 0, card: 0, flies: 0, silent: 0 };
}

function add(t: Tally, outcome: Outcome): void {
  t.rows += 1;
  if (outcome === "venue panel") t.venue += 1;
  else if (outcome === "card") t.card += 1;
  else if (outcome === "flies only") t.flies += 1;
  else t.silent += 1;
}

function line(label: string, t: Tally): string {
  return (
    `    ${label.padEnd(16)} rows ${String(t.rows).padStart(3)}  ` +
    `venue ${String(t.venue).padStart(3)}  ` +
    `card ${String(t.card).padStart(3)}  ` +
    `flies ${String(t.flies).padStart(3)}  ` +
    `SILENT ${String(t.silent).padStart(3)}`
  );
}

async function main(): Promise<void> {
  console.log(`M135 autocomplete audit — ${BASE}`);
  console.log(`run id ${runId} (SYNTHETIC; every /api/meetings GET writes a log row)\n`);

  let gets = 0;
  let failed = 0;
  const totalBefore = empty();
  const totalAfter = empty();
  const stillSilent: string[] = [];

  for (const z of ZIPS) {
    const url = `${BASE}/api/meetings?zip=${z.zip}&lat=${z.lat}&lng=${z.lng}`;
    const res = await fetch(url, { headers });
    gets += 1;
    if (!res.ok) {
      // A failed retrieval is reported as a failed retrieval, never as an empty
      // result: the zip is named with its status and the run continues.
      console.log(`${z.zip} ${z.name}: FETCH FAILED — HTTP ${res.status}`);
      failed += 1;
      continue;
    }
    const body = (await res.json()) as {
      meetings?: Meeting[];
      coverage?: { bodies?: CoveredBody[] } | null;
    };
    const meetings = body.meetings ?? [];
    const bodies = body.coverage?.bodies ?? [];
    const venues = groupByVenue(meetings.filter((m) => m.location !== null));
    const online = meetings.filter((m) => m.location === null);

    // The ask box's own call, verbatim — including the empty district array,
    // which is why district rows (silent by construction in the library) are
    // unreachable on the shipped surface rather than merely absent here.
    const index = buildSearchIndex(venues, [], online);

    const before = empty();
    const after = empty();
    for (const item of index) {
      add(before, outcomeBefore(item));
      const a = outcomeAfter(item, meetings, bodies);
      add(after, a);
      if (a === "SILENT") stillSilent.push(`${z.zip} ${item.kind}: ${item.label}`);
    }

    console.log(
      `${z.zip} ${z.name}: ${meetings.length} meetings, ${venues.length} venues, ` +
        `${online.length} online-only, ${bodies.length} covered bodies, ` +
        `${index.length} autocomplete rows`,
    );
    console.log(line("BEFORE", before));
    console.log(line("AFTER", after));

    for (const [t, total] of [
      [before, totalBefore],
      [after, totalAfter],
    ] as const) {
      total.rows += t.rows;
      total.venue += t.venue;
      total.card += t.card;
      total.flies += t.flies;
      total.silent += t.silent;
    }
  }

  console.log(`\nTOTAL across ${ZIPS.length} zips (${failed} zip(s) unreachable)`);
  console.log(line("BEFORE", totalBefore));
  console.log(line("AFTER", totalAfter));
  console.log(
    `\nSilence: ${totalBefore.silent} rows before, ${totalAfter.silent} after ` +
      `— ${totalBefore.silent - totalAfter.silent} converted.`,
  );
  console.log(`${gets} production GETs, all declared SYNTHETIC under ${runId}`);

  if (stillSilent.length > 0) {
    console.log("\nEvery row STILL silent, named — this is the remainder, not a rounding:");
    for (const s of stillSilent) console.log(`  ${s}`);
  }
}

await main();
