import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  districtAtPoint,
  findingFor,
  probePoints,
  spansAtLayer,
  walkedLayers,
  type ProbeInstrument,
} from "../lib/geo/district-overlap.ts";
import {
  parseRepresentation,
  type Representation,
} from "../lib/hunt/wikipedia.ts";

/**
 * **WGH-16 — A POINT RESOLVES TO ONE DISTRICT; A POLYGON MAY OVERLAP MANY.**
 *
 * Every assertion below is measured against
 * `data/states/az/hunt/85641-district-territory.json` — 44 probed points across 20 walked
 * Pima County ArcGIS layers — rather than reasoned about. The probe point
 * labels are shared across layers, so co-occurrence at a point is exact.
 *
 * The controls are the point of the file:
 *
 * - **NAMED** — Vail Unified School District, the case in the report.
 * - **UNNAMED** — Corona de Tucson Fire District. A different layer, a
 *   different government type, a different publisher's dataset. If the rule
 *   were really about Vail it would not hold here.
 * - **NEGATIVE** — Empire Elementary and Sahuarita Unified, which genuinely sit
 *   inside ONE legislative district. A resolver that answered "many" for
 *   everything would pass the first two and be worthless; these two are what
 *   make the first two mean anything.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTRUMENT = "data/states/az/hunt/85641-district-territory.json";

const probe = JSON.parse(
  readFileSync(join(ROOT, INSTRUMENT), "utf8"),
) as ProbeInstrument;

const LD = "pima-state-legislative";
const SCHOOLS = "pima-school-districts";
const FIRE = "pima-fire-taxation";

/* ═══════════════════════════════ the instrument ═══════════════════════════ */

test("WGH-16: the instrument is the one it claims to be", () => {
  assert.equal(probe.zip, "85641");
  assert.equal(probe.probedPoints, 44);
  assert.equal(probePoints(probe).length, 44, "44 distinct shared point labels");
  assert.ok(walkedLayers(probe).length >= 15, "at least 15 layers produced findings");

  // The note is load-bearing law, not commentary: it is what stops a missing
  // district reading as a district that does not govern here.
  assert.match(probe.note, /never a statement that the district does not govern/i);
});

/* ══════════════════════════════ the POINT rule ════════════════════════════ */

test("WGH-16 POINT: a probed point resolves to EXACTLY ONE district per layer", () => {
  /*
   * The invariant every singular district field in this repository rests on,
   * measured rather than assumed — across all 44 points and every walked layer,
   * not just the legislative one.
   *
   * `districtAtPoint` THROWS on a second hit, so a future instrument that broke
   * this would fail here loudly instead of handing back an arbitrary first
   * match. That silent `[0]` is exactly how a singular field looks correct.
   */
  let resolved = 0;
  let outside = 0;
  for (const point of probePoints(probe)) {
    for (const layer of walkedLayers(probe)) {
      const district = districtAtPoint(probe, point, layer); // throws on >1
      if (district === null) outside += 1;
      else resolved += 1;
    }
  }
  assert.ok(resolved > 0, "the sweep must actually have resolved something");

  // And specifically at the legislative layer, every one of the 44 points is
  // in exactly one district — none is outside, and none is in two.
  const ldAnswers = probePoints(probe).map((p) => districtAtPoint(probe, p, LD));
  assert.equal(ldAnswers.filter((d) => d !== null).length, 44);
  assert.deepEqual([...new Set(ldAnswers)].sort(), ["17", "19"]);

  // `outside` is a real state and is NOT a defect: a point outside every fire
  // district is outside every fire district. It may never render as "no fire
  // district exists here", which nobody measured.
  assert.ok(outside > 0, "some points are genuinely outside some layers");
});

/* ═════════════════════════ the POLYGON rule — NAMED ═══════════════════════ */

test("WGH-16 NAMED: Vail Unified School District spans LD 19 AND LD 17", () => {
  const spans = spansAtLayer(
    probe,
    { layer: SCHOOLS, district: "VAIL UNIFIED SCHOOL DISTRICT" },
    LD,
  );
  assert.deepEqual(
    spans,
    ["19", "17"],
    "38 of 44 probed points, and they do not all sit in one legislative district",
  );

  // The singular field this class of defect is made of would have returned
  // whichever of these the parser saw first — a correct-looking wrong answer.
  assert.equal(spans!.length, 2);

  const finding = findingFor(probe, SCHOOLS, "VAIL UNIFIED SCHOOL DISTRICT");
  assert.equal(finding?.pointsHeld, 38);
  assert.equal(finding?.strength, "REGULATORY");
});

/* ═══════════════════════ the POLYGON rule — UNNAMED ═══════════════════════ */

test("WGH-16 UNNAMED CONTROL: Corona de Tucson Fire District also spans LD 19 AND LD 17", () => {
  /*
   * Nobody reported this one. Different layer, different government type,
   * different dataset — a fire taxation district rather than a school district
   * — which is what makes the rule a rule rather than a fact about Vail.
   */
  const spans = spansAtLayer(probe, { layer: FIRE, district: "CORONA DE TUCSON" }, LD);
  assert.deepEqual(spans, ["19", "17"]);
  assert.equal(findingFor(probe, FIRE, "CORONA DE TUCSON")?.pointsHeld, 6);
});

test("WGH-16 UNNAMED CONTROL: and it is not the only one — four more span both", () => {
  // Reported as a class, so the class is asserted, not one instance of it.
  const alsoBoth: [string, string][] = [
    [FIRE, "RINCON VALLEY"],
    ["pima-jted-territory", "11"],
    ["pima-jted-governing-board", "4"],
    ["pima-community-college-taxation", "4"],
  ];
  for (const [layer, district] of alsoBoth) {
    /*
     * Compared as a SET. `spansAtLayer` orders by shared-point count so the
     * caller reads the largest overlap first, and which of 17 and 19 that is
     * differs per territory — Rincon Valley leans 17, Vail leans 19. Asserting
     * one order here would be asserting an accident of these polygons rather
     * than the fact under test, which is that both are spanned.
     */
    assert.deepEqual(
      spansAtLayer(probe, { layer, district }, LD)?.slice().sort(),
      ["17", "19"],
      `${layer}/${district} spans both legislative districts`,
    );
  }
});

/* ═══════════════════════ the POLYGON rule — NEGATIVE ══════════════════════ */

test("WGH-16 NEGATIVE CONTROL: Empire Elementary spans ONLY LD 19", () => {
  /*
   * **The assertion that makes the other three worth having.** A resolver that
   * simply reported "many" everywhere would pass Vail and Corona de Tucson and
   * be worthless. Empire Elementary genuinely sits inside one legislative
   * district, and saying it spans two would be the same fabrication as the
   * singular field, pointed the other way.
   */
  const spans = spansAtLayer(
    probe,
    { layer: SCHOOLS, district: "EMPIRE ELEMENTARY SCHOOL DISTRICT" },
    LD,
  );
  assert.deepEqual(spans, ["19"]);
  assert.equal(spans!.length, 1, "one district, and the answer says one");
  assert.equal(findingFor(probe, SCHOOLS, "EMPIRE ELEMENTARY SCHOOL DISTRICT")?.pointsHeld, 4);
});

test("WGH-16 NEGATIVE CONTROL: Sahuarita Unified spans ONLY LD 19", () => {
  assert.deepEqual(
    spansAtLayer(probe, { layer: SCHOOLS, district: "SAHUARITA UNIFIED SCHOOL DISTRICT" }, LD),
    ["19"],
  );
});

/* ═════════════════════════ absence is never asserted ══════════════════════ */

test("WGH-16: an unmeasured territory answers NULL, never an empty list", () => {
  /*
   * `[]` would say *this territory spans no legislative district* — a claim
   * about a government. `null` says *this instrument did not measure it* — a
   * claim about us. CLAUDE.md: absence is never asserted, and the name of a gap
   * says whose gap it is.
   */
  assert.equal(
    spansAtLayer(probe, { layer: SCHOOLS, district: "A DISTRICT NOBODY PROBED" }, LD),
    null,
  );
  assert.equal(findingFor(probe, "a-layer-nobody-walked", "19"), null);
});

test("WGH-16: lookups key on (layer, district), never on the id alone", () => {
  /*
   * `scripts/build-zip-division-ids.mts` records a GEOID collision that produced
   * this exact defect shape in a different join — Morris County NJ 34027 against
   * NJ sldu:27 34027 — fixed by keying on (layer, GEOID). The same district
   * STRING is live in several layers here and means a different government in
   * each, so a bare-id lookup would silently cross them.
   */
  const four = probe.findings.filter((f) => f.district === "4");
  assert.ok(four.length > 1, `"4" is ambiguous across layers — saw ${four.length}`);

  assert.equal(findingFor(probe, "pima-community-college-taxation", "4")?.pointsHeld, 44);
  assert.equal(findingFor(probe, "pima-jted-governing-board", "4")?.pointsHeld, 36);
});

/* ══════════════════ the shipping structure the rule repairs ═══════════════ */

test("WGH-16: Representation carries district LISTS, and multi-captures them", () => {
  /*
   * The one live singular structure at the head of this defect:
   *
   *   congressionalDistrict: string | null   // ONE, off a MunicipalityParse
   *   legislativeDistrict:   string | null   // ONE, and a municipality is a
   *                                          //      POLYGON
   *
   * with a parser that used `.exec()` — first match only — so the field and the
   * parser agreed with each other perfectly while both were wrong.
   */
  const twoDistricts = parseRepresentation(
    "It is split between the 6th Congressional District and the 7th " +
      "Congressional District, and between the 17th state legislative district " +
      "and the 19th state legislative district.",
  );
  assert.deepEqual(twoDistricts.congressionalDistricts, ["6", "7"]);
  assert.deepEqual(twoDistricts.legislativeDistricts, ["17", "19"]);
});

test("WGH-16: both legislative spellings are scanned, not just the first that hits", () => {
  // The `??` this replaced stopped at whichever pattern matched at all, so a
  // section using both forms lost every district named in the other one.
  const both = parseRepresentation(
    "the 25th state legislative district, and also state legislative district 26",
  );
  assert.deepEqual(both.legislativeDistricts, ["25", "26"]);
});

test("WGH-16: one district still parses as one — plural is not a claim of many", () => {
  const one = parseRepresentation(
    "Boonton is in the 11th Congressional District and is part of New Jersey's " +
      "26th state legislative district.",
  );
  assert.deepEqual(one.congressionalDistricts, ["11"]);
  assert.deepEqual(one.legislativeDistricts, ["26"]);
});

test("WGH-16: naming none yields an empty list, which is about the SECTION", () => {
  const none = parseRepresentation("The township is governed by a mayor and council.");
  assert.deepEqual(none.congressionalDistricts, []);
  assert.deepEqual(none.legislativeDistricts, []);
});

test("WGH-16: a repeated district is named once, and state does not leak between calls", () => {
  // A `g` regex carries `lastIndex`. A shared module-level literal would make
  // the SECOND municipality parsed return different results from the first,
  // which is the worst class of parser bug: order-dependent and invisible.
  const text = "the 11th Congressional District ... the 11th Congressional District";
  const first = parseRepresentation(text);
  const second = parseRepresentation(text);
  assert.deepEqual(first.congressionalDistricts, ["11"]);
  assert.deepEqual(second.congressionalDistricts, first.congressionalDistricts);
});

/* ══════════════════════════ the migrated committed data ═══════════════════ */

test("WGH-16: the committed NJ Morris walk is migrated, with no value lost", () => {
  const doc = JSON.parse(
    readFileSync(join(ROOT, "data/states/nj/hunt/wikipedia-nj-morris.json"), "utf8"),
  ) as { municipalities: { title: string; representation: Representation | null }[] };

  assert.equal(doc.municipalities.length, 39);

  for (const muni of doc.municipalities) {
    const rep = muni.representation;
    if (rep === null) continue;
    assert.ok(
      Array.isArray(rep.congressionalDistricts),
      `${muni.title}: congressionalDistricts must be a list`,
    );
    assert.ok(
      Array.isArray(rep.legislativeDistricts),
      `${muni.title}: legislativeDistricts must be a list`,
    );
    // The singular fields are GONE, not shadowed. A record carrying both would
    // let a consumer keep reading the one that cannot be right.
    assert.ok(!("congressionalDistrict" in rep), `${muni.title}: singular CD survives`);
    assert.ok(!("legislativeDistrict" in rep), `${muni.title}: singular LD survives`);
  }

  // The migration widened the shape and re-parsed nothing, so every value it
  // held is still there. Boonton is the spot-check.
  const boonton = doc.municipalities.find((m) => m.title === "Boonton, New Jersey");
  assert.deepEqual(boonton?.representation?.congressionalDistricts, ["11"]);
  assert.deepEqual(boonton?.representation?.legislativeDistricts, ["26"]);
});
