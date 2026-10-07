/**
 * Site speed and reliability per surface, from the latest worst-case speed
 * pass: visits over three seconds, visits that never finished, and dead links
 * from the link sweep. A surface past its threshold goes to the top of the
 * stuck list and opens one fix-list item. Pure. These are our own test
 * visits; nothing about real readers' timing is collected.
 */
import { registerSetting } from "../control-plane/settings.ts";
import type { AdminV6StuckItem } from "../control-plane/admin-view/v6-stuck-read.ts";
import type { SpeedPass } from "./worst-case-speed.ts";
import { surfaceWords } from "./worst-case-speed.ts";

/** The share of a surface's test visits over three seconds (or unfinished) at which it is treated as broken. */
export const SLOW_SURFACE_SHARE_SETTING = "health.slowSurfaceShare";
export const SLOW_SURFACE_SHARE_DEFAULT = 0.2;
registerSetting({
  key: SLOW_SURFACE_SHARE_SETTING, label: "Share of a page's test visits that may be over the time limit", defaultValue: SLOW_SURFACE_SHARE_DEFAULT,
  readerFacing: false, control: "number",
  validate: (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1,
});

/** Dead links on one surface that make it a fix item. */
export const DEAD_LINKS_SURFACE_SETTING = "health.deadLinksPerSurface";
export const DEAD_LINKS_SURFACE_DEFAULT = 1;
registerSetting({
  key: DEAD_LINKS_SURFACE_SETTING, label: "Dead links on one kind of link before it is fixed", defaultValue: DEAD_LINKS_SURFACE_DEFAULT, unit: "links",
  readerFacing: false, control: "number",
  validate: (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 10_000,
});

export interface SurfaceSpeed {
  readonly surface: string;
  /** Test visits judged (surface, ZIP, phone or desktop; an Ask question counts on its own). */
  readonly visits: number;
  /** Visits whose slowest run was over the budget. */
  readonly slow: number;
  /** Visits where at least one run never finished: the errors. */
  readonly errors: number;
  /** Visits that failed for either reason. */
  readonly over: number;
  readonly worstMs: number | null;
}

export function surfaceSpeeds(pass: SpeedPass): readonly SurfaceSpeed[] {
  const bySurface = new Map<string, SpeedPass["rows"][number][]>();
  for (const row of pass.rows) bySurface.set(row.surface, [...(bySurface.get(row.surface) ?? []), row]);
  return [...bySurface].map(([surface, rows]): SurfaceSpeed => {
    const finished = rows.flatMap((r) => (r.worstMs === null ? [] : [r.worstMs]));
    return {
      surface, visits: rows.length,
      slow: rows.filter((r) => r.worstMs !== null && r.worstMs > pass.budgetMs).length,
      errors: rows.filter((r) => r.unfinished > 0).length,
      over: rows.filter((r) => r.verdict === "FAIL").length,
      worstMs: finished.length === 0 ? null : Math.max(...finished),
    };
  }).sort((a, b) => a.surface.localeCompare(b.surface));
}

export const surfaceName = (surface: string): string => (surface === "ask" ? "Ask" : surfaceWords({ surface }));
export const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** Surfaces whose share of over-limit visits is above the threshold; a threshold of 0 means any failing visit. */
export function slowSurfaces(speeds: readonly SurfaceSpeed[], threshold: number): readonly SurfaceSpeed[] {
  return speeds.filter((s) => s.visits > 0 && s.over > 0 && s.over / s.visits > threshold);
}

/** One surface's dead-link count from the link sweep's door record. */
export interface DeadLinkReading { readonly surface: string; readonly links: number; readonly dead: number; readonly sweptAt: string | null }

/** The link sweep's per-surface records (kind "link-sweep"), read from the doors list. */
export function deadLinkReadings(doors: readonly { readonly kind: string; readonly config: Readonly<Record<string, unknown>> }[]): readonly DeadLinkReading[] {
  return doors.filter((d) => d.kind === "link-sweep").flatMap((d) => {
    const c = d.config;
    return typeof c.surface === "string" && typeof c.dead === "number"
      ? [{ surface: c.surface, links: typeof c.links === "number" ? c.links : 0, dead: c.dead, sweptAt: typeof c.sweptAt === "string" ? c.sweptAt : null }]
      : [];
  }).sort((a, b) => a.surface.localeCompare(b.surface));
}

export function deadLinkSurfaces(readings: readonly DeadLinkReading[], threshold: number): readonly DeadLinkReading[] {
  return readings.filter((r) => r.dead >= threshold);
}

/* ------------------------------------------------------------------ the stuck list and the fix list */

const ageWords = (sinceIso: string, nowIso: string): { words: string; rank: number } => {
  const hours = Math.max(0, (Date.parse(nowIso) - Date.parse(sinceIso)) / 3_600_000);
  return hours < 1 ? { words: "since just now", rank: 0 }
    : hours < 24 ? { words: `for ${Math.floor(hours)} hours`, rank: 0 }
    : { words: `for ${Math.floor(hours / 24)} days`, rank: Math.floor(hours / 24) };
};

/** The stable sentence a surface's fix item carries: the same gap reported twice is one item, so it names the limit and not the latest count. */
export function slowSurfaceFix(speed: Pick<SurfaceSpeed, "surface">, threshold: number): { where: string; says: string } {
  return {
    where: surfaceName(speed.surface),
    says: threshold <= 0
      ? "A test visit took longer than three seconds or never finished."
      : `More than ${percent(threshold)} of the test visits took longer than three seconds or never finished.`,
  };
}

export function deadLinkFix(reading: Pick<DeadLinkReading, "surface">, threshold: number): { where: string; says: string } {
  return { where: `Links: ${reading.surface}`, says: `${threshold === 1 ? "A link" : `${threshold} or more links`} no longer work.` };
}

/** Stuck-list items for the surfaces over the limit, ranked after shut doors by how bad they are. `pass.at` is how long they have been seen. */
export function slowSurfaceItems(pass: SpeedPass | null, threshold: number, nowIso: string): readonly AdminV6StuckItem[] {
  if (pass === null) return [];
  const age = ageWords(pass.at, nowIso);
  return [...slowSurfaces(surfaceSpeeds(pass), threshold)]
    .sort((a, b) => b.over / b.visits - a.over / a.visits || a.surface.localeCompare(b.surface))
    .map((s): AdminV6StuckItem => {
      const fix = slowSurfaceFix(s, threshold);
      const worst = s.worstMs === null ? "never finished" : `slowest ${(s.worstMs / 1000).toFixed(1)} seconds`;
      return {
        id: `surface:${s.surface}`, title: `${fix.where} is too slow or failing`, applies: [], lane: "auto",
        cause: `${s.over} of ${s.visits} test visits were over three seconds or never finished (${worst}).`,
        age: age.words, ageRank: age.rank, tried: "—", helped: "—",
        next: "The slow step is found and fixed; the next scheduled test visit checks it.",
        owner: "The factory", readersAffected: true, group: "slow-surface", actions: [],
      };
    });
}

/** Stuck-list items for link kinds with dead links at or over the limit. */
export function deadLinkItems(readings: readonly DeadLinkReading[], threshold: number, nowIso: string): readonly AdminV6StuckItem[] {
  return [...deadLinkSurfaces(readings, threshold)].sort((a, b) => b.dead - a.dead || a.surface.localeCompare(b.surface)).map((r): AdminV6StuckItem => {
    const age = r.sweptAt === null ? { words: "for an unknown time", rank: 0 } : ageWords(r.sweptAt, nowIso);
    return {
      id: `links:${r.surface}`, title: `${r.dead} dead link${r.dead === 1 ? "" : "s"}: ${r.surface}`, applies: [], lane: "auto",
      cause: `The last link check found ${r.dead} of ${r.links} ${r.surface} no longer working.`,
      age: age.words, ageRank: age.rank, tried: "—", helped: "—",
      next: "Each dead address is shown as plain text until a working one is found; the next link check confirms it.",
      owner: "The factory", readersAffected: true, group: "dead-links", actions: [],
    };
  });
}
