/**
 * The four pilot zips, verified by hand against the national output
 * (Prompt B items 5.4 and 5.6, 2026-08-20).
 *
 * The pilots are a VERIFICATION SUBSET, not the target. The join ran
 * nationally; this checks that what it produced for four known places is what
 * a person who knows those places would expect. A national number nobody
 * spot-checked is a national number nobody has read.
 *
 * RULING 10 IS ANSWERED HERE TOO (item 5.4). A ZCTA is not a ZIP code, the
 * crosswalk between them is lossy in both directions, and every figure this
 * session reports is a ZCTA figure wearing a zip's name unless it says
 * otherwise. This prints the mapping method and the size of the loss.
 *
 * Run:  corepack pnpm pilot:verify
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readTable } from "../lib/reference/index.ts";

const DERIVED = join(process.cwd(), "data", "derived");

type Edge = { layer: string; id: string; name: string; samples: number };
const zipGov = JSON.parse(
  readFileSync(join(DERIVED, "zip-governments.json"), "utf8"),
) as { zips: Record<string, Edge[]>; totals: Record<string, number> };

const PILOTS = [
  { zip: "85701", what: "downtown Tucson, Arizona" },
  { zip: "85641", what: "Vail, Arizona — UNINCORPORATED" },
  { zip: "07866", what: "Rockaway Township, New Jersey" },
  { zip: "03255", what: "Newbury, New Hampshire" },
];

const LAYER_LABEL: Record<string, string> = {
  county: "county",
  place: "municipality (incorporated place or CDP)",
  cousub: "county subdivision / township",
  unsd: "unified school district",
  elsd: "elementary school district",
  scsd: "secondary school district",
};

/* -------------------------------------------------------------------------- */
/* RULING 10 — ZIP is not ZCTA                                                */
/* -------------------------------------------------------------------------- */

console.log("RULING 10 — ZIP CODES AND ZCTAs ARE NOT THE SAME THING");
console.log("");
console.log("A USPS ZIP code is a DELIVERY ROUTE. It has no areal geometry at all:");
console.log("it is a set of addresses served by a carrier, and some of them —");
console.log("PO-box-only, single-building, and military ZIPs — enclose no territory");
console.log("whatsoever. A ZCTA is the Census Bureau's AREAL APPROXIMATION of one,");
console.log("built by assigning each census block the ZIP most common among its");
console.log("addresses. The crosswalk is lossy in BOTH directions.");
console.log("");
console.log("THE MAPPING METHOD USED IN THIS SESSION: none. There is no crosswalk");
console.log("step. Every geographic answer here is computed on ZCTA polygons and is");
console.log("a ZCTA answer. A reader typing 85701 is served the 85701 ZCTA's");
console.log("governments, and where those differ from the 85701 delivery route's,");
console.log("the difference is unmeasured by this session.");
console.log("");

const zctaCount = Object.keys(zipGov.zips).length;
console.log(`ZCTAs in the 2020 boundary file, all mapped: ${zctaCount}`);

// The committed centroid table is a different Census product of the SAME
// vintage, and it does not agree. Stated rather than reconciled away.
const centroids = JSON.parse(
  readFileSync(join(process.cwd(), "lib", "geo", "zcta-centroids.json"), "utf8"),
) as { centroids: Record<string, unknown>; vintage: string };
const centroidCount = Object.keys(centroids.centroids).length;
console.log(
  `ZCTAs in the committed 2020 Gazetteer centroid table:  ${centroidCount}`,
);
console.log(
  `  DIFFERENCE: ${zctaCount - centroidCount} — two Census products of the same 2020 vintage,`,
);
console.log(
  "  disagreeing on how many ZCTAs there are. Stated, not reconciled: nothing in",
);
console.log("  this session depends on which is right, and guessing would be worse.");

/* The real ZIP universe we can see: mailing addresses on the 90,837 Census
 * units. Not a complete USPS list — it is every ZIP a government's office
 * sits in — but it is a real list of real delivery ZIPs, and asking how many
 * of them have no ZCTA is the honest form of the question. */
const units = readTable("census_govt_units_2022");
const zipCol = units.header.indexOf("zip");
const uspsZips = new Set<string>();
for (const r of units.rows) {
  const z = (r[zipCol] ?? "").trim();
  if (/^\d{5}$/.test(z)) uspsZips.add(z);
}
const noZcta = [...uspsZips].filter((z) => !(z in zipGov.zips));
console.log("");
console.log(
  `USPS ZIPs observable in the Census unit file (a government's office sits there): ${uspsZips.size}`,
);
console.log(
  `  of those, WITH NO ZCTA at all: ${noZcta.length} (${((noZcta.length / uspsZips.size) * 100).toFixed(2)}%)`,
);
console.log(
  "  A ZIP with no ZCTA cannot be answered geographically by this session at all.",
);
console.log(`  First twenty, named: ${noZcta.slice(0, 20).sort().join(", ")}`);
console.log("");
console.log("PILOT ZIPS WITH NO ZCTA:");
for (const p of PILOTS) {
  console.log(
    `  ${p.zip}: ${p.zip in zipGov.zips ? "has a ZCTA — answerable geographically" : "*** NO ZCTA ***"}`,
  );
}

/* -------------------------------------------------------------------------- */
/* The four pilots                                                            */
/* -------------------------------------------------------------------------- */

for (const pilot of PILOTS) {
  const edges = zipGov.zips[pilot.zip];
  console.log("");
  console.log("=".repeat(78));
  console.log(`${pilot.zip} — ${pilot.what}`);
  console.log("=".repeat(78));

  if (!edges) {
    console.log("*** NO ZCTA — this zip resolves to nothing, and that is a fact about");
    console.log("    our method, never a claim that no government governs it.");
    continue;
  }

  const byLayer = new Map<string, Edge[]>();
  for (const e of edges) byLayer.set(e.layer, [...(byLayer.get(e.layer) ?? []), e]);

  for (const layer of ["county", "place", "cousub", "unsd", "elsd", "scsd"]) {
    const rows = byLayer.get(layer) ?? [];
    console.log(`\n  ${LAYER_LABEL[layer]} — ${rows.length}`);
    if (rows.length === 0) {
      // An empty layer is a NAMED absence, in the gap's own words. This is the
      // render-default rule applied to a diagnostic: "none" here means TIGER
      // published no such government overlapping this ZCTA, which for 85641
      // is the true and interesting answer.
      console.log(
        "    none — TIGER publishes no government of this kind overlapping this ZCTA",
      );
      continue;
    }
    for (const r of rows.sort((a, b) => b.samples - a.samples)) {
      const evidence =
        r.samples === 0
          ? "recovered from the government's side (smaller than the sampling lattice)"
          : `${r.samples} sample points`;
      console.log(`    ${r.name}  [${r.id}]  — ${evidence}`);
    }
  }

  console.log("\n  SPECIAL DISTRICTS: 0 resolvable.");
  console.log(
    "    TIGER publishes no special-district boundaries at any vintage, so this",
  );
  console.log(
    "    zip's special districts are UNRESOLVED — a work item, never a false.",
  );
}

console.log("");
console.log("=".repeat(78));
console.log("85641 — THE UNINCORPORATED CHECK (item 5.6)");
console.log("=".repeat(78));
const vail = zipGov.zips["85641"] ?? [];
const vailPlaces = vail.filter((e) => e.layer === "place");
const vailCounty = vail.filter((e) => e.layer === "county");
const vailSchools = vail.filter((e) => ["unsd", "elsd", "scsd"].includes(e.layer));
console.log(`county:           ${vailCounty.length} — ${vailCounty.map((e) => e.name).join(", ")}`);
console.log(
  `school districts: ${vailSchools.length} — ${vailSchools.map((e) => e.name).join(", ") || "none"}`,
);
console.log(`places:           ${vailPlaces.length}`);
for (const p of vailPlaces) console.log(`    ${p.name} [${p.id}] — ${p.samples} sample points`);
console.log("");
console.log(
  "Every incorporated municipality and every census-designated place is in the",
);
console.log(
  "same TIGER `place` layer, so a CDP appearing above is NOT a municipality. A",
);
console.log(
  "CDP has no government at all — it is a name the Census gives a populated",
);
console.log(
  "area so it can publish statistics for it. Whether 85641 is governed by any",
);
console.log(
  "municipality is decided by the LSAD code on those rows, printed above as part",
);
console.log("of NAMELSAD, and read below.");
