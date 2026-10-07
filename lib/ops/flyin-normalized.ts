/** The host-normalized fly-in criterion: the application must hold a share of the bare map's frame rate on the same host. */

import { cpus } from "node:os";

/** The intervals between consecutive frame timestamps, shared so every statistic describes the same population. */
export function frameGaps(times: number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  return gaps;
}

/** Host busy fraction from cumulative per-core tick counters (`os.loadavg()` is zeros on Windows). Recorded, never used to adjust. */
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

/** Chromium flags that put a headless run on the hardware GPU rather than the CPU rasteriser. */
export const GPU_ARGS = [
  "--use-angle=d3d11",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--disable-features=Vulkan",
];

/** Reads the live WebGL renderer back. A string, not a function or regex: the transform and template escaping would break either. */
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

/** A frame slower than this is visible: two 60 Hz frames. A reporting definition, never a threshold. */
export const LONG_FRAME_MS = 33.4;

/** The floor: the application must hold this share of the bare map. */
export const NORMALIZED_FLOOR = 0.9;

/** The software rasteriser's floor; its runs are a separate population, never averaged with hardware. */
export const SOFTWARE_NORMALIZED_FLOOR = 0.75;

/** The share of frames over `LONG_FRAME_MS` the software path may not exceed; the median alone is not sufficient. */
export const SOFTWARE_JANK_CEILING = 0.2;

/** Below this the bare map is reported as not reaching smooth motion. A reporting trigger, never a pass condition. */
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
  /** The median of the per-run mean rates, printed so it can disagree with the headline. */
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

/** The median of a list; an empty list refuses rather than returning zero. */
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

/** Reduce one arm's runs: the per-run statistic first, then combined by median, one vote per run. */
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
  /** The criterion, and the only thing here that decides anything. */
  readonly pass: boolean;
  /** The bare map's own median fps, this host's ceiling for the animation; always reported. */
  readonly hostCeilingFps: number;
  /** True when the bare map did not reach smooth motion on this host; changes the sentence, never the verdict. */
  readonly hostBelowSmoothMotion: boolean;
}

/** The verdict from the two arms alone; a bare arm with no rate refuses rather than passing. */
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

export interface SoftwareVerdict {
  /** application median fps / bare-map median fps, on the CPU rasteriser. */
  readonly ratio: number;
  /** Frames over `LONG_FRAME_MS` as a share of the application arm's frames. */
  readonly jankFraction: number;
  /** Whether the ratio clears `SOFTWARE_NORMALIZED_FLOOR`. */
  readonly ratioPass: boolean;
  /** Whether the jank share is under `SOFTWARE_JANK_CEILING`. */
  readonly jankPass: boolean;
  /** BOTH, because either one alone has been measured to be insufficient. */
  readonly pass: boolean;
}

/** The software-rasteriser verdict: the ratio and the jank share, never one. */
export function judgeSoftware(app: ArmSummary, bare: ArmSummary): SoftwareVerdict {
  if (!(bare.medianFps > 0) || !Number.isFinite(bare.medianFps)) {
    throw new Error(
      `flyin-normalized: the software bare arm's median came back as ${bare.medianFps}. A ratio ` +
        "against that would report a PASS for a measurement that never happened — refusing.",
    );
  }
  if (app.framesMeasured <= 0) {
    throw new Error(
      "flyin-normalized: the software application arm measured ZERO frames, so its jank share " +
        "has no denominator. That is a broken recorder, not a smooth flight (RULING 159).",
    );
  }
  const ratio = app.medianFps / bare.medianFps;
  const jankFraction = app.longFrames / app.framesMeasured;
  const ratioPass = ratio >= SOFTWARE_NORMALIZED_FLOOR;
  const jankPass = jankFraction < SOFTWARE_JANK_CEILING;
  return { ratio, jankFraction, ratioPass, jankPass, pass: ratioPass && jankPass };
}

/** The one-line host condition, so a red result can be told from a busy machine. */
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
