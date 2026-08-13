/**
 * Generate the committed officeholder roster.
 *
 *   pnpm officials:build
 *
 * Writes lib/registry/officeholders-us.json, the way `registry:build` writes
 * registry.json. Nothing at runtime fetches this; a page load reads the
 * committed file, server-side.
 *
 * The interesting step is not the fetch, it is the **reconciliation**: every
 * House seat is checked against a division that actually exists in
 * registry.json, and anything that does not match is reported rather than
 * written. At four zips a wrong identifier is invisible; the whole point of
 * doing it here is that it stops being invisible.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { congressSource } from "../lib/sources/congress/index.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

const OUT = join(process.cwd(), "lib", "registry", "officeholders-us.json");

interface RegistryDivision {
  ocdId: string;
}

function knownDivisionIds(): Set<string> {
  const divisions = (registry as { divisions: RegistryDivision[] }).divisions;
  return new Set(divisions.map((d) => d.ocdId));
}

async function main() {
  const collectedAt = new Date().toISOString();

  const raw = await congressSource.fetch();
  const set = congressSource.normalize(raw, collectedAt);

  const known = knownDivisionIds();

  // Senators attach to a state, and the registry has no state division rows —
  // it is built from boundary layers and there is no state layer. That is
  // expected, so state identifiers are not treated as unmatched. See the note
  // on stateOcdId().
  const isStateId = (ocdId: string) =>
    /^ocd-division\/country:us\/state:[a-z]{2}$/.test(ocdId);

  const missing = set.divisions.filter(
    (d) => !isStateId(d.ocdId) && !known.has(d.ocdId),
  );

  const byId = new Map(set.officeholders.map((o) => [o.id, o]));

  console.log(`congress: ${raw.length} fetched`);
  console.log(`  officeholders  ${set.officeholders.length}`);
  console.log(`  senate seats   ${set.divisions.filter((d) => isStateId(d.ocdId)).length}`);
  console.log(`  house seats    ${set.divisions.filter((d) => !isStateId(d.ocdId)).length}`);
  console.log(`  matched to a registry division  ${set.divisions.length - missing.length - set.divisions.filter((d) => isStateId(d.ocdId)).length}`);

  if (missing.length > 0) {
    console.warn(`\n  ${missing.length} House seat(s) matched no division in registry.json:`);
    const byState = new Map<string, number>();
    for (const d of missing) {
      const state = d.ocdId.split("state:")[1]?.slice(0, 2) ?? "??";
      byState.set(state, (byState.get(state) ?? 0) + 1);
      const person = byId.get(d.officeholderId);
      set.unmatched.push({
        officeholderId: d.officeholderId,
        reason: `no division ${d.ocdId} in registry (${person?.name ?? "unknown"})`,
      });
    }
    console.warn(
      `  by state: ${[...byState].map(([s, n]) => `${s}=${n}`).join(" ")}`,
    );
    console.warn(
      "  These are recorded in `unmatched` and their divisions are dropped —\n" +
        "  a seat pointing at a division that does not exist is a dead join, and\n" +
        "  shipping it would render a name against nothing.",
    );
  }

  const kept = set.divisions.filter(
    (d) => isStateId(d.ocdId) || known.has(d.ocdId),
  );

  writeFileSync(
    OUT,
    `${JSON.stringify({ ...set, divisions: kept }, null, 2)}\n`,
    "utf8",
  );

  const result = await congressSource.upsert(set);
  console.log(`\n  wrote ${OUT}`);
  console.log(`  ${kept.length} division links kept, ${set.unmatched.length} unmatched`);
  console.log(`  upsert reported inserted ${result.inserted}, updated ${result.updated}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
