/**
 * `pnpm resolver:manifest` — P-003, the geometry the SERVER resolver may read.
 *
 * ## What was wrong
 *
 * `lib/registry/server.ts` discovered its geometry with `readdir` over
 * `public/geo`, excluding one file by name. That directory is not a resolver
 * input list: it is what the CLIENT downloads, plus the inputs to the scripts
 * that build it. So the resolver loaded **`cd119.geojson`, the 1.63 MB national
 * congressional file** — 441 features and 80,115 coordinates, 68% of every
 * coordinate the resolver holds — alongside `cd119-04`, `cd119-33` and
 * `cd119-34`, its own per-state derivatives, which `pnpm cd:split` writes and
 * which the map has used since g4 item 3.
 *
 * The national file is not wrong data. It is REDUNDANT data: every feature in
 * it that could ever match a covered point is byte-identical to a feature in
 * one of the three per-state files, by construction of the split. The resolver
 * paid for all 435 other districts on every sweep, and it did so because a
 * directory listing cannot tell an input from a product.
 *
 * ## What this writes, and the rule it follows
 *
 * `data/derived/resolver-geometry.json`: the files the resolver reads, the
 * files it does not, and WHY for each. Every `.geojson` in the directory is
 * accounted for on one list or the other — a file that is neither would be the
 * silent-skip shape this repo names most often.
 *
 * The rule is stated as SUPERSESSION, not as an allow-list. A national file is
 * excluded exactly when per-state derivatives exist for every covered state; if
 * a state is onboarded and its split has not been generated, the national file
 * stays in and the resolver keeps answering correctly. An allow-list would rot
 * the other way — a new district type silently absent — which is the failure
 * the `readdir` comment in `server.ts` was already worried about.
 *
 * ## The correctness gate is not in this file
 *
 * `pnpm resolver:identity` resolves every supported zip against both the old
 * discovery and this manifest and asserts an IDENTICAL set of division
 * identifiers. A geometry change that speeds up a lookup and alters one answer
 * is a wrong answer that arrived faster.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COVERED_STATES } from "../lib/coverage/states.ts";
import { today } from "./doc-dates.mjs";

const GEO_DIR = join(process.cwd(), "public", "geo");
const OUT = join(process.cwd(), "data", "derived", "resolver-geometry.json");

/**
 * Geometry that is not a district boundary at all.
 *
 * `state-outlines.geojson` is a GENERALIZED state boundary, drawn only to
 * decide which pixels the state-focus effect mutes. Its own header says it must
 * never answer a question about who governs a point, and a half-kilometre
 * accurate outline answering one is exactly what that forbids. Carried over
 * from `server.ts` verbatim, reason included.
 */
const NOT_DISTRICT_GEOMETRY: Record<string, string> = {
  "state-outlines.geojson":
    "a generalized state outline for the focus effect — never a governance boundary",
  "body-territories.geojson":
    "BODY territories, not DIVISION boundaries (NH233) — recorded plats belonging to governments " +
    "the Census enumerates no division for, such as the Rocking K South Community Facilities " +
    "District. It is loaded and point-tested by lib/registry/body-territory.ts on the same sweep, " +
    "and it is excluded HERE because every feature in this manifest is keyed by ocdId and these " +
    "features deliberately have none. Including it would make the division resolver answer with a " +
    "body id, which is the join confusion this session spent its day removing.",
};

/** `cd119.geojson` → `cd119`; `cd119-04.geojson` → `cd119` + state `04`. */
function parseName(file: string): { type: string; fips: string | null } {
  const stem = file.replace(/\.geojson$/, "");
  const m = /^(.*)-(\d{2})$/.exec(stem);
  return m ? { type: m[1], fips: m[2] } : { type: stem, fips: null };
}

const files = readdirSync(GEO_DIR).filter((n) => n.endsWith(".geojson")).sort();

const perStateByType = new Map<string, Set<string>>();
for (const file of files) {
  const { type, fips } = parseName(file);
  if (!fips) continue;
  if (!perStateByType.has(type)) perStateByType.set(type, new Set());
  perStateByType.get(type)!.add(fips);
}

const covered = COVERED_STATES.map((s) => s.fips);

interface Row {
  file: string;
  features: number;
  coordinates: number;
}

const included: Row[] = [];
const excluded: { file: string; reason: string }[] = [];

for (const file of files) {
  const notDistrict = NOT_DISTRICT_GEOMETRY[file];
  if (notDistrict) {
    excluded.push({ file, reason: notDistrict });
    continue;
  }

  const { type, fips } = parseName(file);
  if (fips === null) {
    const splits = perStateByType.get(type);
    const complete = splits !== undefined && covered.every((f) => splits.has(f));
    if (complete) {
      excluded.push({
        file,
        reason:
          `superseded by per-state derivatives for every covered state ` +
          `(${covered.map((f) => `${type}-${f}.geojson`).join(", ")}) — the same features, ` +
          "clipped, so loading both tests every polygon twice and the national file's " +
          "other states not at all",
      });
      continue;
    }
    if (splits !== undefined) {
      const missing = covered.filter((f) => !splits.has(f));
      excluded.push({
        file,
        reason: `KEPT — per-state derivatives are missing for ${missing.join(", ")}`,
      });
      // Not actually excluded: fall through and include it.
      excluded.pop();
    }
  }

  const parsed = JSON.parse(readFileSync(join(GEO_DIR, file), "utf8")) as {
    features?: { geometry: { type: string; coordinates: unknown } }[];
  };
  let coordinates = 0;
  for (const feature of parsed.features ?? []) {
    const polys =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates as number[][][]]
        : (feature.geometry.coordinates as number[][][][]);
    for (const poly of polys) for (const ring of poly) coordinates += ring.length;
  }
  included.push({ file, features: parsed.features?.length ?? 0, coordinates });
}

const totals = included.reduce(
  (acc, r) => ({ features: acc.features + r.features, coordinates: acc.coordinates + r.coordinates }),
  { features: 0, coordinates: 0 },
);

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      $comment: [
        "GENERATED by scripts/build-resolver-manifest.mts (pnpm resolver:manifest).",
        "P-003: the geometry lib/registry/server.ts may read. Never hand-edited.",
        "Every .geojson in public/geo appears on exactly one of the two lists.",
      ],
      generatedAt: today(),
      coveredStateFips: covered,
      totals,
      files: included.map((r) => r.file),
      detail: included,
      excluded,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const unaccounted = files.filter(
  (f) => !included.some((r) => r.file === f) && !excluded.some((r) => r.file === f),
);

console.log(`\nresolver manifest — ${today()}\n`);
console.log(`  read by the resolver   ${included.length} file(s)`);
console.log(`  excluded               ${excluded.length} file(s)`);
for (const row of excluded) console.log(`      ${row.file} — ${row.reason.slice(0, 96)}`);
console.log(`\n  features               ${totals.features.toLocaleString()}`);
console.log(`  coordinates            ${totals.coordinates.toLocaleString()}`);
console.log(`\n  unaccounted            ${unaccounted.length}${unaccounted.length ? ` — ${unaccounted.join(", ")}` : ""}`);
console.log(`\n  written ${OUT}\n`);

if (unaccounted.length > 0) process.exit(1);
