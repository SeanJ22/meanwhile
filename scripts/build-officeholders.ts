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

import { FIPS_BY_SLUG } from "../lib/coverage/states.ts";
import { congressSource } from "../lib/sources/congress/index.ts";
import {
  fetchAll,
  GRAPHQL_DAILY_QUOTA,
  indexDivisions,
  normalize as normalizePlural,
  PLURAL_STATES,
  requestCount,
} from "../lib/sources/plural/index.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

const OUT = join(process.cwd(), "lib", "registry", "officeholders-us.json");

/** Per-state files are named by FIPS, so adding a state is adding a file. */
const STATE_FIPS: Record<string, string> = FIPS_BY_SLUG;

function stateOut(state: string): string {
  return join(
    process.cwd(),
    "lib",
    "registry",
    `officeholders-${STATE_FIPS[state]}.json`,
  );
}

interface RegistryDivision {
  ocdId: string;
  label: string;
  divisionType: string;
}

function allDivisions(): RegistryDivision[] {
  return (registry as { divisions: RegistryDivision[] }).divisions;
}

function knownDivisionIds(): Set<string> {
  return new Set(allDivisions().map((d) => d.ocdId));
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

  await buildStates(collectedAt);
}

/**
 * State legislators, one file per state.
 *
 * The match rate is printed per state and per chamber because it is the only
 * thing that distinguishes the two ways a link can fail to appear: a district
 * this repo holds no boundary for — expected, since the registry is clipped to
 * three counties — and a designation the two sides spell differently, which is
 * a bug. New Hampshire's House is the case that makes the difference visible:
 * Plural designates districts "Merrimack 8" and the registry's identifiers are
 * Census numeric codes, so a naive join scores zero out of 201.
 */
async function buildStates(collectedAt: string) {
  const index = indexDivisions(allDivisions());
  const people = await fetchAll();

  console.log(`\nplural: ${people.length} legislators fetched across ${PLURAL_STATES.length} states`);

  // Printed every run so the quota stays a visible number. The free tier is
  // 500 GraphQL requests/day at 1/sec; static bulk files are not metered
  // against it, and the two are reported separately so nothing reads as
  // pressure on a ceiling it is not approaching.
  console.log(
    `  requests: ${requestCount.bulk} bulk (unmetered) · ${requestCount.graphql} GraphQL of ${GRAPHQL_DAILY_QUOTA}/day`,
  );
  if (requestCount.graphql > GRAPHQL_DAILY_QUOTA * 0.5) {
    console.warn(
      `  WARNING: this run used over half the daily GraphQL quota. Cache harder or move the work to bulk.`,
    );
  }

  for (const state of PLURAL_STATES) {
    const mine = people.filter((p) => p.state === state);
    const set = normalizePlural(mine, index, collectedAt, STATE_FIPS[state]);

    const upper = set.divisions.filter((d) => d.ocdId.includes("/sldu:")).length;
    const lower = set.divisions.filter((d) => d.ocdId.includes("/sldl:")).length;

    // How many seats the registry actually holds for this state — the honest
    // denominator. Matching 8 of 30 is complete coverage of a clipped file, not
    // a 27% failure, and printing the raw fraction alone would read as the
    // second.
    const held = new Set(
      allDivisions()
        .filter(
          (d) =>
            d.ocdId.includes(`state:${state}/sldu:`) ||
            d.ocdId.includes(`state:${state}/sldl:`),
        )
        .map((d) => d.ocdId),
    );
    const covered = new Set(set.divisions.map((d) => d.ocdId));
    const holes = [...held].filter((id) => !covered.has(id));

    writeFileSync(stateOut(state), `${JSON.stringify(set, null, 2)}\n`, "utf8");

    console.log(
      `  ${state.toUpperCase()}  ${mine.length} legislators · ${set.divisions.length} linked (${upper} senate, ${lower} house)`,
    );
    console.log(
      `        registry holds ${held.size} district(s) here; ${held.size - holes.length} of them now have someone`,
    );
    if (holes.length > 0) {
      console.warn(
        `        ${holes.length} district(s) in the registry matched nobody: ${holes
          .map((id) => id.split("/").pop())
          .slice(0, 8)
          .join(", ")}${holes.length > 8 ? " …" : ""}`,
      );
    }
    console.log(`        wrote ${stateOut(state)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
