/**
 * **THE COMPATIBILITY TEST RULING 228 REQUIRES.**
 *
 * > A compatibility test constructs output through the REAL PRODUCER and
 * > consumes that EXACT ARTIFACT through the REAL CONSUMER; any field or
 * > envelope divergence fails.
 *
 * ## Why a fixture cannot do this job, demonstrated by the fact that one didn't
 *
 * This seam already HAD a fixture. `tests/fixtures/tracker-obligation-handoff.json`
 * matched the consumer exactly, the consumer's tests passed, and the seam was
 * still broken — because the producer had never been run into the consumer. A
 * fixture is a THIRD reading of the specification, written by whichever lane
 * wrote the test, and it agrees with that lane.
 *
 * ```
 *   CONSUMER expected   data/tracker/obligation-handoff.json
 *                       { rows:        [ { trackerId, subjectId, routes  } ] }
 *   PRODUCER shipped    docs/tracker-obligation-handoff.json
 *                       { obligations: [ { rowId,     subject,   routeId } ] }
 * ```
 *
 * Every test below runs `buildTrackerHandoff` — the real producer — into
 * `readTrackerHandoff` — the real consumer — through a real file on disk.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HANDOFF_PATH,
  intakeStateFor,
  validateHandoff,
  type HandoffRow,
} from "../lib/contracts/tracker-handoff.ts";
import {
  CONVERTED_ROWS,
  buildTrackerHandoff,
} from "../lib/tracker/obligation-handoff.ts";
import {
  readTrackerHandoff,
  trackerIntakeProvider,
} from "../lib/control-plane/scheduler/providers/tracker-intake.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";

const STAMP = "2026-08-31";
const NOW = "2026-08-31T12:00:00.000Z";

/** Write the producer's output to a real file and hand the path to the consumer. */
function throughDisk(rows?: readonly HandoffRow[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wtp-handoff-"));
  const path = join(dir, "obligation-handoff.json");
  const artifact = buildTrackerHandoff(STAMP, rows);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return path;
}

test("RULING 228: the producer's OWN output satisfies the shared contract", () => {
  const problems = validateHandoff(buildTrackerHandoff(STAMP));
  assert.deepEqual(
    problems,
    [],
    "a producer that only RESEMBLES the type is not a party to a contract",
  );
});

test("RULING 228: the real producer's artifact is readable by the real consumer", () => {
  const read = readTrackerHandoff(throughDisk());

  assert.notEqual(
    read.state,
    "ABSENT",
    'ABSENT over a file that exists is the exact defect this test was written from — "the ' +
      'converting lane has not shipped one", printed over seven named rows',
  );
  assert.notEqual(read.state, "UNREADABLE", `the consumer could not read it: ${read.detail}`);
  assert.equal(
    read.inputRows,
    CONVERTED_ROWS.length,
    "every row the producer emitted must reach the consumer — a row lost at the seam is a " +
      "tracker row the owner reported and nothing owes",
  );
});

test("the seven real rows are PRESENT_UNSCHEDULABLE, and none is upgraded to look green", () => {
  const read = readTrackerHandoff(throughDisk());

  assert.equal(read.state, "PRESENT_UNSCHEDULABLE");
  assert.equal(read.inputRows, 7);
  assert.equal(read.rows.length, 0, "no row may be manufactured schedulable to make Part D pass");
  assert.equal(read.deferred.length, 7);

  /* The state name itself must never be mistakable for an absence or a success. */
  assert.match(read.detail, /7 input row\(s\) · 0 registered · 7 deferred/);
  assert.doesNotMatch(read.detail, /no tracker handoff/i);
});

test("every deferred row carries the CONVERTING LANE'S OWN reason, not a generic one", () => {
  const read = readTrackerHandoff(throughDisk());

  for (const d of read.deferred) {
    const source = CONVERTED_ROWS.find((r) => r.trackerId === d.trackerId);
    assert.ok(source, `${d.trackerId} came back from the consumer and is not in the producer`);
    const stated = source.needsBeforeItCanCarryANextDue ?? [];
    assert.ok(stated.length > 0, `${d.trackerId} defers with no stated reason`);
    /*
     * The first stated need must appear verbatim. Paraphrasing it here would
     * discard the only analysis anyone has done of why the row is not ready.
     */
    assert.ok(
      d.why.includes(stated[0]),
      `${d.trackerId}'s deferral reason must QUOTE the producer, not summarise it.\n` +
        `  producer: ${stated[0]}\n  consumer: ${d.why}`,
    );
  }
});

test("A SEEDED SCHEDULABLE ROW registers through the same registry, with normal identity", () => {
  /*
   * This is the half the seven real rows cannot prove. None of them is
   * schedulable — correctly — so without a seeded row the test could only show
   * that nothing registers, which is indistinguishable from a seam that does
   * not work at all.
   *
   * The row is SEEDED IN THE TEST and never in the artifact, so proving the
   * seam does not falsely upgrade any real tracker row.
   */
  const seeded: HandoffRow = {
    trackerId: "SEED01",
    recordClass: "meetings",
    subjectId: "seed-body-for-the-contract-test",
    subjectLabel: "a seeded body that exists only in this test",
    readerImpactAt: null,
    routes: [
      {
        routeId: "seed-html",
        label: "the seeded body's own page",
        executorClass: "DETERMINISTIC",
        executorReason: "a plain HTML GET",
        open: { kind: "HTTP_GET", url: "https://example.gov/seed" },
        citation: "tests/tracker-handoff-contract.test.ts",
      },
    ],
  };

  const read = readTrackerHandoff(throughDisk([seeded]));
  assert.equal(read.state, "REGISTERED");
  assert.equal(read.rows.length, 1);
  assert.equal(read.deferred.length, 0);

  /* ...and it must reach the SAME registry the other providers go through. */
  const pass = buildRegistry([trackerIntakeProvider(throughDisk([seeded]))], {
    root: process.cwd(),
    nowIso: NOW,
  });

  assert.equal(pass.units.length, 1, "the seeded row must produce exactly one scheduled unit");
  const unit = pass.units[0];
  assert.equal(unit.providerId, "tracker-intake");
  assert.equal(
    unit.obligation.id,
    "freshness:tracker:seed-body-for-the-contract-test#seed-html",
    "an owner-reported obligation gets the same id shape as every other — there is no second " +
      "control plane for owner-reported work",
  );
  assert.equal(unit.obligation.routeId, "seed-html");
});

test("a row that qualifies BESIDE rows that do not is PARTIALLY_REGISTERED", () => {
  const seeded: HandoffRow = {
    trackerId: "SEED02",
    recordClass: "meetings",
    subjectId: "seed-two",
    readerImpactAt: null,
    routes: [
      {
        routeId: "seed-html-2",
        label: "seeded",
        executorClass: "DETERMINISTIC",
        executorReason: "test",
        open: { kind: "HTTP_GET", url: "https://example.gov/seed2" },
        citation: "test",
      },
    ],
  };
  const read = readTrackerHandoff(throughDisk([...CONVERTED_ROWS, seeded]));

  assert.equal(read.state, "PARTIALLY_REGISTERED");
  assert.equal(read.inputRows, 8);
  assert.equal(read.rows.length, 1);
  assert.equal(read.deferred.length, 7);
});

test("the five zero-shaped states are DERIVED from counts and cannot be asserted apart", () => {
  /*
   * `INGESTED` was once printed over zero usable rows — a success word on a
   * zero, on a field the digest prints. Deriving the state from the counts is
   * what makes that unrepresentable rather than merely discouraged.
   */
  assert.equal(intakeStateFor({ present: false, readable: false, inputRows: 0, registered: 0 }), "ABSENT");
  assert.equal(intakeStateFor({ present: true, readable: false, inputRows: 0, registered: 0 }), "UNREADABLE");
  assert.equal(intakeStateFor({ present: true, readable: true, inputRows: 0, registered: 0 }), "PRESENT_EMPTY");
  assert.equal(intakeStateFor({ present: true, readable: true, inputRows: 7, registered: 0 }), "PRESENT_UNSCHEDULABLE");
  assert.equal(intakeStateFor({ present: true, readable: true, inputRows: 7, registered: 3 }), "PARTIALLY_REGISTERED");
  assert.equal(intakeStateFor({ present: true, readable: true, inputRows: 7, registered: 7 }), "REGISTERED");
});

test("BOTH SIDES import the contract path — neither restates it", () => {
  /*
   * The divergence was a path as much as a shape. This asserts the one place
   * the path is written, rather than trusting two files to keep agreeing.
   */
  assert.deepEqual([...HANDOFF_PATH], ["data", "tracker", "obligation-handoff.json"]);

  const consumerPath = readTrackerHandoff(join(process.cwd(), ...HANDOFF_PATH)).path;
  assert.ok(
    consumerPath.endsWith(join("data", "tracker", "obligation-handoff.json")),
    "the consumer must read the contract path and no other",
  );
});

test("the COMMITTED artifact is what the producer would write today", () => {
  /*
   * A generated artifact is never hand-edited (RULING 92). If these diverge,
   * someone edited the file instead of the producer, and the next
   * `pnpm tracker:handoff` would silently revert their change.
   */
  const committed = readTrackerHandoff(join(process.cwd(), ...HANDOFF_PATH));
  assert.notEqual(
    committed.state,
    "ABSENT",
    "the artifact is not committed at the contract path — run `pnpm tracker:handoff`",
  );

  /*
   * Compared through the CONSUMER rather than by re-reading the bytes: what
   * matters is that the two sides agree on the rows, not that two JSON blobs
   * are byte-identical.
   */
  const fromProducer = readTrackerHandoff(throughDisk());
  assert.equal(committed.inputRows, fromProducer.inputRows);
  assert.deepEqual(
    committed.deferred.map((d) => d.trackerId),
    fromProducer.deferred.map((d) => d.trackerId),
    "the committed artifact and the producer disagree — run `pnpm tracker:handoff`",
  );
});
