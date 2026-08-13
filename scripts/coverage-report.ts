/**
 * The session gate: what each target zip actually resolves through the live
 * composite source.
 *
 *   pnpm meetings:report
 *
 * For each of the four target zips: how many meetings, which sources
 * contributed, and which bodies governing the point still have no wired
 * source. The composite's own per-source accounting prints at the end. Live
 * network — this is a report, not a test.
 */

import { searchMeetings } from "../lib/meetings/query.ts";
import {
  getActiveComposite,
  getMeetingSource,
} from "../lib/meetings/registry.ts";
import { resolveZip } from "../lib/geo/zcta.ts";
import { coverageAt } from "../lib/registry/server.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";

const TARGET_ZIPS = ["85701", "85641", "07866", "03255"];

async function main() {
  const source = getMeetingSource();
  console.log(`active source: ${source.name}\n`);

  const wired = new Set(SOURCE_WIRING.map((w) => w.bodyId));

  for (const zip of TARGET_ZIPS) {
    const resolved = resolveZip(zip);
    if (!resolved.ok) {
      console.log(`${zip}: zip did not resolve (${resolved.reason})`);
      continue;
    }
    const { lat, lng } = resolved.centroid;
    const result = await searchMeetings(lat, lng);

    const bySource = new Map<string, number>();
    for (const m of result.meetings) {
      const s = m.id.split(":")[0];
      bySource.set(s, (bySource.get(s) ?? 0) + 1);
    }
    const contributions = [...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s} ${n}`)
      .join(", ");

    const coverage = await coverageAt(lat, lng, result.meetings.length);
    const unwired = coverage.bodies.filter((b) => !wired.has(b.bodyId));

    console.log(
      `${zip}: ${result.meetings.length} meetings (tier ${result.tier}, ` +
        `${result.radiusKm} km) — sources: ${contributions || "none"}`,
    );
    console.log(
      `  bodies governing here: ${coverage.bodies.length}, ` +
        `without a wired source: ${unwired.length}` +
        (unwired.length
          ? ` — ${unwired.map((b) => b.divisionLabel).join(", ")}`
          : ""),
    );
  }

  const composite = getActiveComposite();
  if (composite?.lastReport) {
    console.log("\nper-source accounting (last run):");
    for (const child of composite.lastReport.children) {
      const d = child.drops;
      console.log(
        child.ok
          ? `  ${child.source}: ${child.fetched} fetched, ${child.normalized} normalized — ` +
              `drops: ${d.unknownVenue} unknownVenue / ${d.placeless} placeless / ` +
              `${d.unplaceableInTime} unplaceableInTime / ${d.notConfigured} notConfigured`
          : `  ${child.source}: FAILED — ${child.error}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
