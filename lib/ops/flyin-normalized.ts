/**
 * THE HOST-NORMALIZED FLY-IN CRITERION — the statistics, in one place.
 * (The author's amendment to W6 H3, 2026-08-31.)
 *
 * ## What the author replaced, and why the replacement is not a smaller number
 *
 * W6 H3 shipped with an ABSOLUTE target — 55 fps — and the absolute was wrong
 * in the way `scripts/measure-fly.mts` already had a ruling about: *"a check
 * asserting against a made-up threshold is worse than no check."* The evidence
 * was not subtle. On the machine the fix was measured on, a MapLibre map flying
 * with **every district layer, every marker and the whole state-focus layer
 * removed** — nothing of this product left on it — reached 41.3 fps sustained.
 * A 55 fps assertion is unreachable on that host by a map with nothing on it,
 * so it cannot be a statement about this product. It is a statement about the
 * machine, dressed as a statement about the build.
 *
 * The amendment, in the author's words:
 *
 * > Replace the absolute 55 FPS criterion with the host-normalized criterion.
 * > Run the identical fly-in repeatedly on (a) bare MapLibre with application
 * > layers/overlays removed and (b) the actual application. Report median FPS
 * > and frame-time/jank for both. Pass: application median FPS >= 90% of bare
 * > map median FPS on that host. If the bare map itself cannot reach smooth
 * > motion, report that host limit numerically; it does not waive the relative
 * > requirement. Preserve as the permanent performance check.
 *
 * **The bare map is the host's own ceiling, measured rather than assumed.** It
 * carries the rasteriser, the GPU, the display's refresh rate and whatever else
 * is running on the box, in its own number, on the same day. What is left over
 * — the ratio — is the only part of the measurement that belongs to this
 * product. That is why the criterion is relative, and it is also why a slow
 * host does not waive it: a slow host lowers BOTH arms, so the ratio survives
 * exactly the contention the absolute could not.
 *
 * ## Why the headline is a MEDIAN and the mean is printed beside it
 *
 * A mean hides a stall. Three hundred frames at 60 fps with one 400 ms freeze
 * still averages near 55, and a reader watching that flight sees the freeze and
 * nothing else. So the headline statistic is the median frame interval, and the
 * mean is reported next to it precisely so the two can DISAGREE in the report
 * rather than silently in the number.
 *
 * The converse is also true and is the reason jank is reported separately: the
 * median is ROBUST, which means it is also BLIND. The pre-fix build that ran
 * 170 full-viewport `queryRenderedFeatures` calls through one 2.6 s animation
 * had a median of 59.5 fps — a perfect median over a flight that was visibly
 * broken, because the damage was concentrated in 15 long frames out of 127.
 * **So the median criterion is necessary and it is not sufficient**, and the
 * permanent check keeps the load-invariant call-count assertion alongside it
 * for exactly that reason. Neither one is a substitute for the other, and this
 * file exists so that both are computed once and read the same way twice.
 *
 * ## Everything here is PURE
 *
 * No browser, no clock, no filesystem. `scripts/measure-flyin.mts` (the full
 * instrument) and `scripts/walk-all.mts` (the permanent check) both import
 * these functions, so the two can never drift into computing "median fps" two
 * different ways and reporting the difference as a regression.
 */

import { cpus } from "node:os";

/**
 * The intervals between consecutive frame timestamps.
 *
 * Shared rather than re-derived at each call site, so that the full instrument
 * and the permanent check can never disagree about what a "frame time" is. Two
 * functions each computing their own gaps is how a median and a percentile end
 * up describing different populations while both look right.
 */
export function frameGaps(times: number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  return gaps;
}

/**
 * **HOST LOAD, READ OFF THE HOST'S OWN COUNTERS RATHER THAN ASSUMED.**
 *
 * `os.loadavg()` returns `[0, 0, 0]` on Windows, which is where this runs, so
 * the load number has to come from the cumulative per-core tick counters
 * instead. Two snapshots and a subtraction give the busy fraction across
 * exactly the window between them — which is the window one flight occupied.
 *
 * This is recorded WITH EVERY RUN and is never used to adjust a number. It is
 * evidence: a future session re-reading a red result has to be able to tell a
 * regression from a busy machine, and the only way to do that is to have been
 * told what the machine was doing at the time.
 */
export function cpuTicks(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const core of cpus()) {
    idle += core.times.idle;
    total += core.times.idle + core.times.user + core.times.nice + core.times.sys + core.times.irq;
  }
  return { idle, total };
}

/** Busy percentage between two `cpuTicks()` snapshots; null for a zero window. */
export function busyPct(
  before: { idle: number; total: number },
  after: { idle: number; total: number },
): number | null {
  const total = after.total - before.total;
  if (total <= 0) return null;
  return ((total - (after.idle - before.idle)) / total) * 100;
}

/**
 * **THE FLAGS THAT PUT A HEADLESS RUN ON THE REAL ADAPTER.**
 *
 * Playwright launches Chromium with `--enable-unsafe-swiftshader`, so by
 * default every WebGL pixel is rasterised on the CPU. That is not a reader's
 * machine, and on 2026-08-31 it was measured to be the difference between this
 * product passing and failing the criterion below:
 *
 * ```
 * hardware GPU (Intel Iris Xe):   application 59.9 / bare 60.1 fps  = 99.7%
 * software (SwiftShader):         application 15.4 / bare 59.9 fps  = 25.8%
 * ```
 *
 * The bare arm reaches 60 fps on BOTH, which is what makes that pair readable:
 * the software rasteriser is not too slow to fly a map, it is too slow to fly
 * THIS map. See the note on the permanent check in `scripts/walk-all.mts`.
 *
 * Shared here so the permanent check and the full instrument request the same
 * adapter. `--disable-features=Vulkan` is required rather than tidy: SwiftShader
 * arrives through the Vulkan path in this Chromium and would otherwise override
 * the ANGLE request above it.
 */
export const GPU_ARGS = [
  "--use-angle=d3d11",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--disable-features=Vulkan",
];

/**
 * Read the live WebGL renderer back, so no run has to be TRUSTED about it.
 *
 * A string rather than a function: tsx's esbuild transform rewrites named
 * functions through a `__name` helper the page does not have. No regex inside
 * it either — a regex written in a template loses its escapes, still matches,
 * and shifts its capture groups.
 */
export const READ_RENDERER = `(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  if (!gl) return "NO WEBGL";
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "UNKNOWN";
})()`;

/** Whether a renderer string names the CPU rasteriser rather than a GPU. */
export function isSoftwareRenderer(renderer: string): boolean {
  return renderer.toLowerCase().includes("swiftshader");
}

/**
 * A frame slower than this is one a reader can SEE.
 *
 * Two 60 Hz frames. It is not a pass/fail threshold anywhere — nothing in this
 * file fails on a jank count — it is the definition the jank number is reported
 * UNDER, so that "4 long frames" is a statement with a stated meaning rather
 * than a number whose scale the reader has to guess.
 */
export const LONG_FRAME_MS = 33.4;

/** The author's floor: the application must hold this share of the bare map. */
export const NORMALIZED_FLOOR = 0.9;

/**
 * The rate below which the BARE map is reported as not reaching smooth motion.
 *
 * **THIS IS A REPORTING TRIGGER AND IT IS NEVER A PASS CONDITION.** The author
 * was explicit that a host limit "does not waive the relative requirement", so
 * this number changes what gets SAID and never what gets DECIDED: the verdict
 * below is computed from the ratio alone, whether or not this fires.
 */
export const SMOOTH_MOTION_FPS = 55;

/** One measured flight, reduced to the two things the criterion needs. */
export interface ArmRun {
  /** Every interval between consecutive frames in the flight window, in ms. */
  readonly gaps: number[];
  /** What the host's CPU counters said across this run, or null if unread. */
  readonly hostBusyPct: number | null;
}

export interface ArmSummary {
  readonly arm: string;
  /** THE DENOMINATOR: how many flights this arm's numbers are taken over. */
  readonly runs: number;
  /** Per-run median fps, one entry per run, in the order the runs happened. */
  readonly medianFpsPerRun: number[];
  /** THE HEADLINE: the median of the per-run medians. */
  readonly medianFps: number;
  /**
   * The median of the per-run MEAN rates. Printed so it can disagree out loud.
   *
   * Combined by median rather than by mean for the same one-vote-per-run reason
   * every other statistic here is — the point of this field is that the MEAN
   * WITHIN a run is sensitive to a stall the median within that run ignores,
   * not that the arm should be re-exposed to the outlier problem a second time
   * when the runs are combined.
   */
  readonly meanFps: number;
  /** The median of the per-run p95-interval rates — the prior lane's headline. */
  readonly sustainedFps: number;
  /** Frame-time percentiles in ms, POOLED across every run of this arm. */
  readonly frameMs: { p50: number; p95: number; p99: number; max: number };
  /** Frames slower than `LONG_FRAME_MS`, pooled, with its own denominator. */
  readonly longFrames: number;
  readonly framesMeasured: number;
  /** Host busy percentage per run, in run order. Evidence, never an adjustment. */
  readonly hostBusyPct: (number | null)[];
}

/** The q-th value of an already-sorted list, by nearest-rank. */
function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/**
 * The median of a list of numbers.
 *
 * **An empty list REFUSES rather than returning zero** (RULING 159 applied to a
 * rate, the same way `frameStats` does it): `0.0 fps` is indistinguishable from
 * a frozen fly-in and in fact means nothing was measured. A median of nothing
 * is not a median of zero.
 */
export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error(
      "flyin-normalized: asked for the median of an EMPTY population. That is a fact about " +
        "the measurement never having run, not a frame rate of zero — refusing to invent one.",
    );
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Reduce one arm's repeated runs to the numbers the criterion is stated in.
 *
 * **The per-run statistic is computed FIRST and the runs are combined SECOND**,
 * rather than pooling every gap from every run and taking one median over the
 * lot. That ordering is the point of repeating: pooling would let one run that
 * happened to land during another agent's compile contribute proportionally
 * more intervals and drag the arm with it, which is precisely the single-hiccup
 * failure the repetition exists to defeat. Each run gets one vote.
 *
 * The frame-time PERCENTILES are pooled, deliberately and for the opposite
 * reason: a distribution is a statement about the population of frames, and a
 * median of per-run p99s would be a number no frame ever had.
 */
export function summariseArm(arm: string, runs: readonly ArmRun[]): ArmSummary {
  if (runs.length === 0) {
    throw new Error(
      `flyin-normalized: arm "${arm}" completed ZERO runs. Every number below it would be ` +
        "invented, so this refuses rather than reporting an empty arm as a fast one.",
    );
  }
  const usable = runs.filter((r) => r.gaps.length > 0);
  if (usable.length === 0) {
    throw new Error(
      `flyin-normalized: arm "${arm}" ran ${runs.length} time(s) and captured no frame ` +
        "intervals at all. That is a broken recorder, not a slow flight.",
    );
  }

  const medianFpsPerRun = usable.map((r) => 1000 / median(r.gaps));
  const meanFpsPerRun = usable.map(
    (r) => 1000 / (r.gaps.reduce((sum, g) => sum + g, 0) / r.gaps.length),
  );
  const sustainedPerRun = usable.map(
    (r) => 1000 / quantile([...r.gaps].sort((a, b) => a - b), 0.95),
  );

  const pooled = usable.flatMap((r) => r.gaps).sort((a, b) => a - b);
  return {
    arm,
    runs: usable.length,
    medianFpsPerRun,
    medianFps: median(medianFpsPerRun),
    meanFps: median(meanFpsPerRun),
    sustainedFps: median(sustainedPerRun),
    frameMs: {
      p50: quantile(pooled, 0.5),
      p95: quantile(pooled, 0.95),
      p99: quantile(pooled, 0.99),
      max: pooled[pooled.length - 1],
    },
    longFrames: pooled.filter((g) => g > LONG_FRAME_MS).length,
    framesMeasured: pooled.length,
    hostBusyPct: usable.map((r) => r.hostBusyPct),
  };
}

export interface NormalizedVerdict {
  readonly app: ArmSummary;
  readonly bare: ArmSummary;
  /** application median fps / bare-map median fps, on this host, today. */
  readonly ratio: number;
  /** The author's criterion, and the only thing here that decides anything. */
  readonly pass: boolean;
  /**
   * The bare map's own median fps: this host's ceiling for this animation.
   * Reported ALWAYS, numerically, whether or not it is a comfortable number.
   */
  readonly hostCeilingFps: number;
  /**
   * True when the bare map did not reach smooth motion on this host.
   * **Does not affect `pass`.** It changes the sentence, never the verdict.
   */
  readonly hostBelowSmoothMotion: boolean;
}

/**
 * The verdict, derived from the two arms and from nothing else.
 *
 * A bare arm that measured 0 fps would make the ratio infinite and the check
 * green, which is the worst available failure — so it refuses. The bare map
 * being SLOW is a legitimate and reportable state; the bare map having produced
 * no rate at all is a broken instrument, and the two are kept apart the way
 * RULING 24 requires.
 */
export function judgeNormalized(app: ArmSummary, bare: ArmSummary): NormalizedVerdict {
  if (!(bare.medianFps > 0) || !Number.isFinite(bare.medianFps)) {
    throw new Error(
      `flyin-normalized: the bare map's median came back as ${bare.medianFps}. A ratio taken ` +
        "against that would be infinite and would report a PASS for a measurement that never " +
        "happened — refusing.",
    );
  }
  const ratio = app.medianFps / bare.medianFps;
  return {
    app,
    bare,
    ratio,
    pass: ratio >= NORMALIZED_FLOOR,
    hostCeilingFps: bare.medianFps,
    hostBelowSmoothMotion: bare.medianFps < SMOOTH_MOTION_FPS,
  };
}

/**
 * The one-line host condition, so a future session can read a red result.
 *
 * **This is the half the author asked for by name**: a permanent check
 * re-running on an unknown machine under unknown load has to be able to tell a
 * regression from a busy box, and it cannot do that from a ratio alone. So
 * every report states what the host was doing — its measured ceiling for this
 * exact animation, and what its CPUs were busy with while the arms ran.
 */
export function hostCondition(verdict: NormalizedVerdict): string {
  const busy = [...verdict.app.hostBusyPct, ...verdict.bare.hostBusyPct].filter(
    (v): v is number => typeof v === "number",
  );
  const cpu =
    busy.length > 0
      ? `host CPU ${median(busy).toFixed(0)}% busy (median of ${busy.length} run windows)`
      : "host CPU load NOT READ";
  const ceiling =
    `bare-map ceiling ${verdict.hostCeilingFps.toFixed(1)} fps median` +
    (verdict.hostBelowSmoothMotion
      ? ` — BELOW SMOOTH MOTION (${SMOOTH_MOTION_FPS} fps): this host cannot fly this ` +
        "animation smoothly with NOTHING of ours on the map, which is a fact about the " +
        "machine and does not waive the relative requirement"
      : "");
  return `${cpu}; ${ceiling}`;
}
