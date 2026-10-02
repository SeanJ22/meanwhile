/**
 * **THE HOST-NORMALIZED FLY-IN CRITERION, TESTED WHERE IT CAN BE TESTED.**
 * (Amendment to W6 H3, 2026-08-31.)
 *
 * The measurement itself needs a GPU, a production build and a quiet-ish
 * machine, and it produces a different number every time it runs. None of that
 * is testable. What IS testable — and what carries the whole verdict — is the
 * arithmetic between the frames and the pass/fail, so it lives in a pure module
 * and is exercised here against PLANTED populations whose right answer is known
 * in advance.
 *
 * Two of these cases are the failure modes that would otherwise report a green
 * check for a measurement that never happened: a bare arm with no frames, and a
 * bare arm whose rate came back as zero. Both make the ratio meaningless, and
 * one of them makes it INFINITE — which is the worst available outcome, because
 * `Infinity >= 0.9` is true and the check would pass.
 *
 * The `constructor(readonly x)` and `enum` forms are absent on purpose: this
 * suite runs under `node --test --experimental-strip-types`, which refuses both
 * outright while `tsc` accepts them, so either one would kill this whole file
 * at parse while the type check stayed green.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  busyPct,
  frameGaps,
  hostCondition,
  judgeNormalized,
  LONG_FRAME_MS,
  median,
  NORMALIZED_FLOOR,
  summariseArm,
  SMOOTH_MOTION_FPS,
} from "../lib/ops/flyin-normalized.ts";

/** A run of `count` frames each `ms` apart, with `slow` frames of `slowMs`. */
const run = (count: number, ms: number, slow = 0, slowMs = 100) => ({
  gaps: [...Array(count - slow).fill(ms), ...Array(slow).fill(slowMs)],
  hostBusyPct: 40,
});

describe("frameGaps", () => {
  it("turns timestamps into the intervals between them", () => {
    assert.deepEqual(frameGaps([0, 16, 33, 50]), [16, 17, 17]);
  });

  it("returns nothing for a window that captured under two frames", () => {
    assert.deepEqual(frameGaps([12]), []);
    assert.deepEqual(frameGaps([]), []);
  });
});

describe("median", () => {
  it("averages the middle pair on an even population", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  it("takes the middle value on an odd population", () => {
    assert.equal(median([5, 1, 3]), 3);
  });

  it("REFUSES an empty population rather than returning zero", () => {
    /* RULING 159 applied to a rate: a median of nothing is not a median of
       zero, and `0.0 fps` reads as a frozen fly-in. */
    assert.throws(() => median([]), /EMPTY population/);
  });
});

describe("summariseArm", () => {
  it("gives each RUN one vote rather than pooling every frame", () => {
    /*
     * Three runs at a steady 60 fps and one long run at 30. Pooling the gaps
     * would let the long run's frame count outvote the others; per-run medians
     * cannot, so the arm's median stays at 60 and the outlier is visible in
     * `medianFpsPerRun` instead of hidden inside the headline.
     */
    const arm = summariseArm("planted", [
      run(10, 16.6667),
      run(10, 16.6667),
      run(10, 16.6667),
      run(400, 33.3333),
    ]);
    assert.equal(arm.runs, 4);
    assert.ok(Math.abs(arm.medianFps - 60) < 0.5, `median was ${arm.medianFps}`);
    assert.equal(arm.medianFpsPerRun.length, 4);
  });

  it("pools the frame-time percentiles, and counts jank with its denominator", () => {
    /* 100 frames at 16ms plus 10 at 100ms, in one run. */
    const arm = summariseArm("planted", [run(110, 16, 10, 100)]);
    assert.equal(arm.framesMeasured, 110);
    assert.equal(arm.longFrames, 10);
    assert.ok(arm.longFrames < arm.framesMeasured);
    assert.equal(arm.frameMs.max, 100);
    assert.ok(arm.frameMs.p50 <= arm.frameMs.p95);
    assert.ok(arm.frameMs.p95 <= arm.frameMs.p99);
  });

  it("counts a frame as jank only above the stated threshold", () => {
    const under = summariseArm("planted", [{ gaps: [LONG_FRAME_MS], hostBusyPct: null }]);
    assert.equal(under.longFrames, 0);
    const over = summariseArm("planted", [{ gaps: [LONG_FRAME_MS + 0.1], hostBusyPct: null }]);
    assert.equal(over.longFrames, 1);
  });

  it("lets the MEAN disagree with the median when one flight stalls", () => {
    /* The whole reason both are reported: 149 frames at 16ms and one at 400
       leaves the median untouched and drags the mean down by a third. */
    const arm = summariseArm("planted", [run(150, 16, 1, 400)]);
    assert.ok(Math.abs(arm.medianFps - 62.5) < 1, `median was ${arm.medianFps}`);
    assert.ok(arm.meanFps < arm.medianFps - 5, `mean ${arm.meanFps} vs median ${arm.medianFps}`);
  });

  it("REFUSES an arm that completed no runs at all", () => {
    assert.throws(() => summariseArm("planted", []), /ZERO runs/);
  });

  it("REFUSES an arm whose runs captured no frame intervals", () => {
    assert.throws(
      () => summariseArm("planted", [{ gaps: [], hostBusyPct: null }]),
      /no frame intervals/,
    );
  });
});

describe("judgeNormalized", () => {
  it("PASSES an application holding more than the floor of the bare map", () => {
    const bare = summariseArm("bare", [run(100, 16.6667)]);
    const app = summariseArm("app", [run(100, 17.5)]);
    const verdict = judgeNormalized(app, bare);
    assert.ok(verdict.ratio > NORMALIZED_FLOOR);
    assert.equal(verdict.pass, true);
  });

  it("FAILS an application that costs more than a tenth of the bare map", () => {
    /* 60 fps bare against 50 fps app is 0.833 — under the floor. */
    const bare = summariseArm("bare", [run(100, 16.6667)]);
    const app = summariseArm("app", [run(100, 20)]);
    const verdict = judgeNormalized(app, bare);
    assert.ok(verdict.ratio < NORMALIZED_FLOOR, `ratio was ${verdict.ratio}`);
    assert.equal(verdict.pass, false);
  });

  it("passes exactly AT the floor, which is what >= means", () => {
    const bare = summariseArm("bare", [{ gaps: [10], hostBusyPct: null }]);
    const app = summariseArm("app", [{ gaps: [10 / NORMALIZED_FLOOR], hostBusyPct: null }]);
    const verdict = judgeNormalized(app, bare);
    assert.ok(Math.abs(verdict.ratio - NORMALIZED_FLOOR) < 1e-9);
    assert.equal(verdict.pass, true);
  });

  it("A SLOW HOST DOES NOT WAIVE THE REQUIREMENT — it is reported beside it", () => {
    /*
     * If the bare map itself cannot reach smooth motion, that host limit is
     * reported numerically; it does not waive the relative requirement.
     * So a bare map at 25 fps still yields a real verdict, and
     * the host limit changes the SENTENCE rather than the decision.
     */
    const bare = summariseArm("bare", [run(100, 40)]);
    const slowApp = summariseArm("app", [run(100, 50)]);
    const slow = judgeNormalized(slowApp, bare);
    assert.equal(slow.hostBelowSmoothMotion, true);
    assert.ok(slow.hostCeilingFps < SMOOTH_MOTION_FPS);
    assert.equal(slow.pass, false, "a slow host must not turn a failing ratio green");

    const okApp = summariseArm("app", [run(100, 42)]);
    const held = judgeNormalized(okApp, bare);
    assert.equal(held.hostBelowSmoothMotion, true);
    assert.equal(held.pass, true, "a slow host must not turn a passing ratio red either");
  });

  it("REFUSES a bare arm whose rate is zero rather than passing on Infinity", () => {
    /*
     * The worst available failure. A bare median of 0 makes the ratio Infinity,
     * `Infinity >= 0.9` is true, and the check would report a confident PASS
     * for an experiment in which the control never ran.
     */
    const bare = summariseArm("bare", [{ gaps: [Number.POSITIVE_INFINITY], hostBusyPct: null }]);
    const app = summariseArm("app", [run(100, 16.6667)]);
    assert.throws(() => judgeNormalized(app, bare), /refusing/i);
  });
});

describe("hostCondition", () => {
  it("states the ceiling numerically and names a host that cannot hold smooth motion", () => {
    const bare = summariseArm("bare", [run(100, 40)]);
    const app = summariseArm("app", [run(100, 42)]);
    const line = hostCondition(judgeNormalized(app, bare));
    assert.match(line, /bare-map ceiling 25\.0 fps median/);
    assert.match(line, /BELOW SMOOTH MOTION/);
    assert.match(line, /does not waive the relative requirement/);
    assert.match(line, /host CPU 40% busy/);
  });

  it("says the load was NOT READ rather than implying a quiet host", () => {
    const bare = summariseArm("bare", [{ gaps: [16, 16, 16], hostBusyPct: null }]);
    const app = summariseArm("app", [{ gaps: [16, 16, 16], hostBusyPct: null }]);
    const line = hostCondition(judgeNormalized(app, bare));
    assert.match(line, /host CPU load NOT READ/);
    assert.doesNotMatch(line, /BELOW SMOOTH MOTION/);
  });
});

describe("busyPct", () => {
  it("reports the busy share between two tick snapshots", () => {
    assert.equal(busyPct({ idle: 0, total: 0 }, { idle: 25, total: 100 }), 75);
  });

  it("returns null for a zero-length window rather than a made-up 0% or 100%", () => {
    assert.equal(busyPct({ idle: 10, total: 100 }, { idle: 10, total: 100 }), null);
  });
});
