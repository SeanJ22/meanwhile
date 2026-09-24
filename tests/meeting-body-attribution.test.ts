import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { meetingPartitionsForSource } from "../lib/civic-data/meeting-partitions.ts";
import { PDC_V2_POST_IMPORT_MEETING_PARTITIONS } from "../lib/holdings/reader-execution-authority.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { Registry } from "../lib/registry/types.ts";

/**
 * **A MEETING BELONGS TO A BODY, NOT TO A DIVISION.**
 * (2026-08-27, the coverage-truth session. Red Control 4's second half.)
 *
 * ## What this guards
 *
 * The author's 2026-08-27 review caught the Central Arizona Water Conservation
 * District card reading **"Meetings · 0 upcoming"** while the board's own 2026
 * schedule listed board meetings on September 3, October 1, November 5 and
 * December 3. Two separate defects were behind one rendered number, and only
 * the first is the obvious one:
 *
 * 1. **A stale snapshot.** The CivicClerk wiring row for `capaz` landed on
 *    2026-08-27 in `9e75bea`; the committed snapshot was generated
 *    2026-08-26T19:36Z. The adapter had never been asked — `civicclerk` did
 *    not even appear in the snapshot's own list of sources, so "this source
 *    returned nothing" and "this source was never run" looked identical.
 *    Regenerating produced 12/12 sources and 14 CAWCD sittings.
 *
 * 2. **The join.** A body card filtered `allMeetings` on `m.ocdId ===
 *    body.ocdId`. Measured on the regenerated snapshot: **10 of the 18
 *    divisions carrying meetings hold more than one body, and 364 of 460
 *    meetings would render on a body that did not hold them.** All 80 Tucson
 *    sittings appeared on each of 58 appointed commissions; the Pima County
 *    Board of Supervisors' agenda appeared on the water district's card.
 *
 * So CAWCD's "0 upcoming" was a false absence, and a great many other cards
 * carried the opposite defect at the same time — a full calendar that was
 * somebody else's.
 *
 * ## The rule
 *
 * Every adapter builds its meetings inside a loop over the wiring row that
 * says which body it serves, and already wrote `ocdId` from it. `bodyId` now
 * travels the same way. These tests hold the two halves that make it real:
 * the data carries it, and no reader surface goes back to the division.
 */

const ROOT = process.cwd();

function snapshot(): { meetings: Meeting[]; sources: { source: string }[] } {
  return JSON.parse(readFileSync(join(ROOT, "data", "meetings-snapshot.json"), "utf8")) as {
    meetings: Meeting[];
    sources: { source: string }[];
  };
}

function registry(): Registry {
  return JSON.parse(readFileSync(join(ROOT, "lib", "registry", "registry.json"), "utf8")) as Registry;
}

test("every meeting in the snapshot names the body that held it", () => {
  const { meetings } = snapshot();
  assert.ok(meetings.length > 0, "an empty snapshot proves nothing");

  const missing = meetings.filter((m) => !m.bodyId).map((m) => `${m.id} (${m.bodyName})`);
  assert.deepEqual(
    missing,
    [],
    `${missing.length} meeting(s) carry no bodyId, so no body card can show them and nothing says ` +
      `why. Every adapter builds inside a wiring-row loop — add \`bodyId: wiring.bodyId\` beside ` +
      `\`ocdId: wiring.ocdId\`.\n  ${missing.slice(0, 15).join("\n  ")}`,
  );
});

test("every meeting's bodyId resolves to a body the registry holds", () => {
  const { meetings } = snapshot();
  const ids = new Set(registry().bodies.map((b) => b.id));
  const dangling = meetings
    .filter((m) => m.bodyId && !ids.has(m.bodyId))
    .map((m) => `${m.id} -> ${m.bodyId}`);
  assert.deepEqual(
    dangling,
    [],
    `${dangling.length} meeting(s) name a body the registry does not hold. A dangling attribution ` +
      `renders as an empty card, which is a false absence.\n  ${dangling.slice(0, 15).join("\n  ")}`,
  );
});

test("the snapshot reports EVERY wired source, including one that returned nothing", () => {
  /*
   * **THE HALF THAT WAS MISSING WHEN CAWCD READ ZERO.**
   *
   * `civicclerk` was registered in `lib/sources/composite/wiring.ts` and did
   * not appear in the 2026-08-26 snapshot's `sources` array at all. An adapter
   * that contributes nothing and an adapter that was never asked produced the
   * same artifact, and the reader got a confident "0 upcoming" over it.
   *
   * The composite's own run summary counts sources attempted against sources
   * read; this asserts the record it leaves behind carries one row per source
   * so the next session can tell those two states apart from the file alone.
   */
  const snap = snapshot();
  const reported = new Set(snap.sources.map((s) => s.source));
  const wiringSource = readFileSync(join(ROOT, "lib", "sources", "composite", "wiring.ts"), "utf8");
  const registered = [...wiringSource.matchAll(/^\s*name: "([a-z0-9-]+)",$/gm)].map((m) => m[1]);

  assert.ok(registered.length >= 10, `only ${registered.length} adapter names parsed — this guard is stale`);
  /*
   * The snapshot is the bootstrap fixture frozen at the permanent data-plane
   * cutover (generatedAt 2026-09-06); live acquisition now writes one partition
   * per source/body and never this file. An adapter registered after it froze
   * cannot have a row in it, so each one is NAMED here — never a pattern that
   * would let the next unreported adapter through.
   */
  const REGISTERED_AFTER_FIXTURE = new Set(["pima-edu"]);
  // The bundled snapshot is FROZEN at the PDC v2 import. An adapter every one
  // of whose partitions was registered after that import cannot appear in it;
  // it is exempt only by being named, partition by partition, in
  // PDC_V2_POST_IMPORT_MEETING_PARTITIONS — never by inference.
  const postImportOnly = new Set(
    registered.filter((name) => {
      const partitions = meetingPartitionsForSource(name);
      return partitions.length > 0 && partitions.every((p) => PDC_V2_POST_IMPORT_MEETING_PARTITIONS.includes(p.id));
    }),
  );
  const silent = registered.filter(
    (n) => !reported.has(n) && !REGISTERED_AFTER_FIXTURE.has(n) && !postImportOnly.has(n),
  );
  for (const late of REGISTERED_AFTER_FIXTURE) {
    assert.ok(registered.includes(late), `${late} is exempted but no longer registered — remove the exemption`);
    assert.ok(!reported.has(late), `${late} now has a fixture row — remove the exemption`);
  }
  assert.deepEqual(
    silent,
    [],
    `${silent.length} registered adapter(s) left NO row in the snapshot's source list: ` +
      `${silent.join(", ")}. "returned nothing" and "was never run" must not look the same — ` +
      `regenerate with \`pnpm ingest composite\`.`,
  );
});

test("no reader surface joins a meeting to a body by their shared division", () => {
  /*
   * The architectural half. The data can be correct today and the render can
   * go back to `ocdId` tomorrow, so the shape is banned where it makes a
   * membership-or-calendar claim about a specific body.
   *
   * Division-scoped surfaces — the map, the meeting list, the district card —
   * legitimately filter meetings by `ocdId`, and this does not touch them. It
   * bans the exact pairing that says "these are THIS BODY's sittings".
   */
  const offenders: string[] = [];
  for (const file of filesThatWouldBeCommitted({ cwd: ROOT })) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (file === "tests/meeting-body-attribution.test.ts") continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    const code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    /* `m.ocdId === body.ocdId` in any spelling: a meeting compared to a BODY's
     * division. The body variable is what makes it a claim about a body. */
    if (/\bocdId\s*===\s*\w*[Bb]ody\.ocdId/.test(code) || /\b[Bb]ody\.ocdId\s*===\s*\w+\.ocdId/.test(code)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} module(s) match a meeting to a body on their shared division:\n  ` +
      offenders.join("\n  ") +
      "\n\nJoin on Meeting.bodyId. `ocdId` answers WHERE and is shared by every body in the division.",
  );
});

test("CONTROL: the division join really would over-match, on the data as it stands", () => {
  /*
   * A guard that only passes proves nothing. This replays the deleted join and
   * requires it to still be wrong — so if a later snapshot ever happened to
   * put one body per division, the tests above would be shown to be vacuous
   * rather than quietly passing for the wrong reason.
   */
  const { meetings } = snapshot();
  const reg = registry();
  const bodiesByDivision = new Map<string, number>();
  for (const b of reg.bodies) {
    if (!b.ocdId) continue;
    bodiesByDivision.set(b.ocdId, (bodiesByDivision.get(b.ocdId) ?? 0) + 1);
  }

  const overMatched = meetings.filter((m) => m.ocdId && (bodiesByDivision.get(m.ocdId) ?? 0) > 1);
  assert.ok(
    overMatched.length > 0,
    "no meeting sits on a division with more than one body, so the old join would have been " +
      "harmless and these guards would be testing nothing. It was 364 of 460 on 2026-08-27.",
  );

  /* And the new join does not: each of those meetings names exactly one body. */
  for (const m of overMatched.slice(0, 50)) {
    assert.ok(m.bodyId, `${m.id} sits on a shared division and names no body`);
  }
});
