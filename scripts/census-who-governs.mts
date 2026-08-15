/**
 * The gap census: every body governing a zip, and whether we read its calendar.
 *
 *   pnpm census:zip 03255 07866
 *
 * Written 2026-08-15 for the depth session's step 2 — the brief's order was
 * "census the gap first ... report the table before fetching". It is the
 * playbook's first machine step for a new zip: you cannot claim depth for a
 * place until you can name every government that meets there and say, per
 * body, whether a source is wired, located-but-unwired, or never hunted.
 *
 * The denominator here is the REGISTRY's who-governs set for the point, which
 * is itself audited against the Census of Governments in
 * `docs/coverage-audit-by-county.md`. Those are two different denominators on
 * purpose: this script answers "of the bodies we know govern this point, how
 * many do we read?", and the county audit answers "do we know all the bodies?".
 * Neither one alone earns a coverage claim.
 *
 * Read-only and offline: registry, geometry and wiring are committed files.
 * No vendor is contacted — that is the next step, not this one.
 */

import { resolveZip } from "../lib/geo/zcta.ts";
import { coverageAt } from "../lib/registry/server.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";

const DEFAULT_ZIPS = ["03255", "07866"];

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

async function main() {
  const zips = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a));
  const targets = zips.length ? zips : DEFAULT_ZIPS;

  const wiring = new Map(SOURCE_WIRING.map((w) => [w.bodyId, w]));

  for (const zip of targets) {
    const resolved = resolveZip(zip);
    if (!resolved.ok) {
      console.log(`${zip}: did not resolve (${resolved.reason})`);
      continue;
    }
    const { lat, lng } = resolved.centroid;
    const coverage = await coverageAt(lat, lng, 0);

    const rows = coverage.bodies
      .map((body) => {
        const wired = wiring.get(body.bodyId);
        const state = wired
          ? "INGESTED"
          : body.coverageStatus === "KNOWN_UNCOVERED"
            ? "NOT-INGESTED"
            : body.lookedAt
              ? "NOT-INGESTED"
              : "NOT-ATTEMPTED";
        const vendor = wired
          ? wired.agendaSourceType
          : body.agendaSourceType && body.agendaSourceType !== "NONE"
            ? body.agendaSourceType
            : "—";
        return {
          state,
          vendor,
          tier: body.tier,
          label: body.name ?? body.divisionLabel,
          bodyId: body.bodyId,
          page: wired
            ? (wired.noticeUrl ?? Object.values(wired.config)[0] ?? "")
            : (body.agendaSourceRef ?? body.homepageUrl ?? ""),
        };
      })
      .sort(
        (a, b) => a.state.localeCompare(b.state) || a.label.localeCompare(b.label),
      );

    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.state] = (acc[r.state] ?? 0) + 1;
      return acc;
    }, {});

    console.log(
      `\n## ${zip} — ${rows.length} bodies govern this point ` +
        `(${counts.INGESTED ?? 0} ingested, ` +
        `${counts["NOT-INGESTED"] ?? 0} located but not ingested, ` +
        `${counts["NOT-ATTEMPTED"] ?? 0} never hunted)\n`,
    );
    console.log(
      `${pad("STATE", 14)}${pad("VENDOR", 13)}${pad("TIER", 8)}BODY`,
    );
    for (const r of rows) {
      console.log(
        `${pad(r.state, 14)}${pad(r.vendor, 13)}${pad(r.tier, 8)}${r.label}` +
          (r.page ? `\n${" ".repeat(35)}${r.page}` : ""),
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
