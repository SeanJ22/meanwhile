import assert from "node:assert/strict";
import test from "node:test";

import { selectSitting, sittingsOnSameLocalDay } from "../lib/ask/select.ts";

interface Sitting {
  readonly id: string;
  readonly startsAt: string;
  readonly timeZone?: string | null;
}

/* Two sittings at 1 p.m. and 5 p.m. local on one day, plus one the following week. */
const STUDY: Sitting = { id: "m-study", startsAt: "2026-09-08T20:00:00.000Z", timeZone: "America/Phoenix" };
const BUSINESS: Sitting = { id: "m-business", startsAt: "2026-09-09T00:00:00.000Z", timeZone: "America/Phoenix" };
const NEXT_WEEK: Sitting = { id: "m-next", startsAt: "2026-09-15T20:00:00.000Z", timeZone: "America/Phoenix" };

const ALL = [STUDY, BUSINESS, NEXT_WEEK];
const BEFORE = Date.parse("2026-09-01T00:00:00.000Z");

test("SEEDED ASK-24: the 5 p.m. sitting is on the SAME local day as the 1 p.m. one", () => {
  /*
   * This is the whole trap. 5 p.m. Arizona on 2026-09-08 is 00:00Z on
   * 2026-09-09, so grouping on the UTC date splits one afternoon into two days
   * and the second sitting silently stops being "today's".
   */
  const chosen = selectSitting("NEXT", ALL, BEFORE);
  assert.equal(chosen?.id, "m-study", "the earliest upcoming sitting is still the chosen one");

  const sameDay = sittingsOnSameLocalDay(chosen as Sitting, ALL);
  assert.deepEqual(
    sameDay.map((m) => m.id),
    ["m-study", "m-business"],
    "both sittings, in start order, and the following week's is not one of them",
  );
});

test("ASK-24: a body with ONE sitting that day returns exactly that sitting", () => {
  const chosen = selectSitting("NEXT", [NEXT_WEEK], BEFORE);
  const sameDay = sittingsOnSameLocalDay(chosen as Sitting, [NEXT_WEEK]);
  assert.deepEqual(sameDay.map((m) => m.id), ["m-next"]);
});

test("ASK-24: the chosen sitting is always included, so a caller cannot drop it", () => {
  const chosen = selectSitting("NEXT", ALL, BEFORE) as Sitting;
  assert.ok(
    sittingsOnSameLocalDay(chosen, ALL).some((m) => m.id === chosen.id),
    "a caller renders this list directly; excluding the chosen sitting would lose the meeting " +
      "the reader actually asked about",
  );
});

test("SEEDED ASK-24: sittings are ordered by start, never by corpus order", () => {
  const shuffled = [BUSINESS, NEXT_WEEK, STUDY];
  const chosen = selectSitting("NEXT", shuffled, BEFORE) as Sitting;
  assert.deepEqual(
    sittingsOnSameLocalDay(chosen, shuffled).map((m) => m.id),
    ["m-study", "m-business"],
    "'at 1 p.m. and again at 5 p.m.' is only true if the list is in time order",
  );
});
