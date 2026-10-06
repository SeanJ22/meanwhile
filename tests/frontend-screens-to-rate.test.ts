import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lookReviewPrompt } from "../lib/frontend/look-review.ts";
import { validateSweep } from "../lib/feedback/sweep.ts";
import {
  addExampleToStandard, addToSweep, badExamples, ratingToSweptItem, sampleScreensToRate, sweepFolder,
  type RatableScreen, type ScreenRating,
} from "../lib/frontend/screens-to-rate.ts";

const screen = (n: number): RatableScreen => ({ key: `look/2026-10-06/s${n}.png`, label: `card ${n}, 390 wide`, surface: "reader", zip: null, device: "phone", takenAt: "2026-10-06T10:00:00Z" });
const dislike = (s: RatableScreen): ScreenRating => ({ screenKey: s.key, verdict: "dislike", note: "label too small", ratedAt: "2026-10-06T12:00:00Z" });

describe("FE-24: Sean rates a sample of real screens", () => {
  it("samples only unrated screens, without repeats, and is random", () => {
    const all = [1, 2, 3, 4, 5, 6].map(screen);
    const rated = [{ screenKey: all[0].key }, { screenKey: all[1].key }];
    const got = sampleScreensToRate(all, rated, 3, () => 0.5);
    assert.equal(got.length, 3);
    assert.equal(new Set(got.map((s) => s.key)).size, 3);
    assert.ok(got.every((s) => !rated.some((r) => r.screenKey === s.key)));
    assert.equal(sampleScreensToRate(all, rated, 99).length, 4);
    const a = sampleScreensToRate(all, [], 6, () => 0).map((s) => s.key).join();
    const b = sampleScreensToRate(all, [], 6, () => 0.99).map((s) => s.key).join();
    assert.notEqual(a, b);
  });
  it("writes a verdict in the sweep record shape that validates", () => {
    const s = screen(1);
    const bad = addToSweep(null, ratingToSweptItem(s, dislike(s), "fix-1"), "2026-10-06T12:00:00Z");
    assert.equal(bad.folder, "10.6.26");
    assert.deepEqual(validateSweep(bad), []);
    const like = ratingToSweptItem(screen(2), { screenKey: screen(2).key, verdict: "like", note: null, ratedAt: "2026-10-06T12:01:00Z" }, null);
    assert.equal(like.disposition, "POSITIVE_KEPT");
    assert.deepEqual(validateSweep(addToSweep(bad, like, "2026-10-06T12:01:00Z")), []);
    assert.throws(() => ratingToSweptItem(s, dislike(s), null));
    assert.equal(sweepFolder("2026-12-25T00:00:00Z"), "12.25.26");
  });
  it("a dislike becomes a bad example the reviewer's next prompt carries, once per screen", () => {
    const s = screen(1);
    let standard = addExampleToStandard("# Look standard\n\n## One\n\ntext\n", s, dislike(s));
    standard = addExampleToStandard(standard, s, { ...dislike(s), note: "still too small" });
    assert.equal(badExamples(standard).length, 1);
    assert.ok(badExamples(standard)[0].includes("still too small"));
    assert.ok(lookReviewPrompt({ task: "t", standard }).includes("Bad live example (Sean, 2026-10-06): card 1, 390 wide"));
    const liked = addExampleToStandard(standard, screen(2), { screenKey: screen(2).key, verdict: "like", note: null, ratedAt: "2026-10-06T12:01:00Z" });
    assert.equal(badExamples(liked).length, 1);
    assert.ok(liked.includes("Good live example (Sean"));
  });
});
