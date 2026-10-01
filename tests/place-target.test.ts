import assert from "node:assert/strict";
import test from "node:test";
import { PLACE_TARGET_KEY, defaultAdminConfig, placeTargetOf, withPlaceTarget } from "../lib/control-plane/gateway/admin-config.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";

const at = "2026-10-01T09:00:00.000Z";
const set = (c: ReturnType<typeof defaultAdminConfig>, key: string, goalPercent: number | null, receiptId = "r1") => withPlaceTarget(c, { key, goalPercent, decidedAt: at, decidedBy: "owner", receiptId });

test("a target is kept per place with the receipt that set it, changed in place, cleared by null, and every other decision stays", () => {
  const base = { ...defaultAdminConfig(at), fleetSpendCeiling: { rollingCeilingUsd: 50, previousUsd: 25, decidedAt: at, decidedBy: "owner", receiptId: "c" } };
  const one = set(base, "geo:az.zcta.85635", 95);
  assert.deepEqual(placeTargetOf(one, "geo:az.zcta.85635"), { key: "geo:az.zcta.85635", goalPercent: 95, setAt: at, decidedBy: "owner", receiptId: "r1" });
  assert.equal(one.fleetSpendCeiling?.rollingCeilingUsd, 50, "the ceiling is carried through");
  const two = set(set(one, "st:az", 80, "r2"), "geo:az.zcta.85635", 90, "r3");
  assert.deepEqual(two.placeTargets?.map((t) => [t.key, t.goalPercent, t.receiptId]), [["geo:az.zcta.85635", 90, "r3"], ["st:az", 80, "r2"]], "one entry per place, the later one wins");
  const cleared = set(two, "geo:az.zcta.85635", null);
  assert.equal(placeTargetOf(cleared, "geo:az.zcta.85635"), null);
  assert.equal(placeTargetOf(cleared, "st:az")?.goalPercent, 80);
});

test("a malformed target reads as none, never as a goal, and only real place keys are accepted", () => {
  const bad = { ...defaultAdminConfig(at), placeTargets: [{ key: "st:az", goalPercent: 140, setAt: at, decidedBy: "o", receiptId: "r" }, { key: "st:nj", goalPercent: Number.NaN, setAt: at, decidedBy: "o", receiptId: "r" }] };
  assert.equal(placeTargetOf(bad, "st:az"), null);
  assert.equal(placeTargetOf(bad, "st:nj"), null);
  assert.equal(placeTargetOf(null, "st:az"), null);
  for (const ok of ["us", "st:az", "geo:az.county.04019", "geo:az.zcta.85635"]) assert.ok(PLACE_TARGET_KEY.test(ok), ok);
  for (const no of ["", "az", "geo:az.zcta", "st:AZ", "geo:az.zcta.85635; drop", "us/../x"]) assert.equal(PLACE_TARGET_KEY.test(no), false, no);
});

test("the Admin controls send the place and the percent, or none to clear", () => {
  const src = (over: object) => ({ target: "geo:az.zcta.85635", scopeKey: "geo:az.zcta.85635", amount: "", words: "", option: "", selected: [], ...over }) as never;
  assert.deepEqual(actionInput("target-set", src({ amount: "95" })), { placeKey: "geo:az.zcta.85635", goalPercent: 95 });
  assert.deepEqual(actionInput("target-clear", src({})), { placeKey: "geo:az.zcta.85635", goalPercent: null });
});
