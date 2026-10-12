import assert from "node:assert/strict";
import test from "node:test";

import { gapsNotInAnswer } from "../lib/text/say-once.ts";

const gap = (statement: string) => ({ whose: "OURS" as const, statement });

test("S2.4: Ask says each gap once", () => {
  const answer = "We have not recorded who your state senator is yet.";
  assert.deepEqual(
    gapsNotInAnswer(answer, [gap("We have not recorded who holds the office of state senator for your area yet.")]),
    [],
  );
  // The identical sentence the composer pushes into both places.
  const decided = "We have not recorded which State Senate district your address is in, so we cannot say which of them is yours.";
  assert.deepEqual(gapsNotInAnswer(`Your state senators are A and B. ${decided}`, [gap(decided)]), []);
  // A different gap that shares the boilerplate is kept.
  const phone = gap("We have not recorded a published phone number or email for Jane Roe.");
  assert.deepEqual(gapsNotInAnswer(answer, [phone]), [phone]);
  // No answer prose, nothing to repeat.
  assert.deepEqual(gapsNotInAnswer(null, [phone]), [phone]);
  assert.deepEqual(gapsNotInAnswer("", [phone]), [phone]);
});
