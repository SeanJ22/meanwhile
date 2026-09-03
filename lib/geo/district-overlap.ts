/**
 * **A POINT RESOLVES TO ONE DISTRICT. A POLYGON MAY OVERLAP MANY.**
 * (WGH-16, 2026-08-28.)
 *
 * ## The class, stated before the instance
 *
 * Two different questions have been answered by one shape all over this
 * product, and the shape fits only one of them:
 *
 * ```
 * WHICH DISTRICT IS THIS READER IN?     a POINT.   Exactly one, per level.
 * WHICH DISTRICTS DOES THIS GOVERNMENT  a POLYGON. As many as it crosses.
 *   SPAN?
 * ```
 *
 * A field typed `legislativeDistrict: string | null` can express the first and
 * **cannot express the second at all**. Hung off a municipality, a school
 * district or a fire district — every one of which is a polygon — it is not a
 * value that happens to be incomplete. It is a value that is structurally
 * incapable of being right, and it fails silently, because one of the districts
 * it spans is always a correct-looking answer.
 *
 * ## Measured, not reasoned about
 *
 * `data/states/az/hunt/85641-district-territory.json` is 44 probed points against 20
 * walked ArcGIS layers from Pima County's open data. The point labels are
 * **shared across layers**, so co-occurrence at a point is exact rather than
 * inferred — two districts that hold the same label demonstrably overlap on the
 * ground, and no geometry is re-derived here to find that out.
 *
 * What it shows at ZIP 85641:
 *
 * ```
 * Vail Unified School District      38/44 points   spans LD 19 AND LD 17
 * Corona de Tucson Fire District     6/44 points   spans LD 19 AND LD 17
 * Rincon Valley Fire District        7/44 points   spans LD 19 AND LD 17
 * Pima County JTED                  36/44 points   spans LD 19 AND LD 17
 * Pima CC taxation district 4       44/44 points   spans LD 19 AND LD 17
 * Empire Elementary District         4/44 points   spans LD 19 only
 * Sahuarita Unified District         1/44 points   spans LD 19 only
 * ```
 *
 * **The last two are the load-bearing rows.** A resolver that answered "many"
 * for everything would pass the Vail test and be worthless. Empire and Sahuarita
 * genuinely sit inside one legislative district, and reporting them as spanning
 * two would be the same fabrication in the opposite direction.
 *
 * And the POINT half is measured too, not assumed: across all 20 layers, **no
 * probed point falls in more than one district of the same layer.** That is what
 * makes the singular answer correct for a reader and wrong for a territory.
 *
 * ## What this module refuses to do
 *
 * - **It never reports absence as absence.** A district holding none of the
 *   probed points is missing from the findings, and the instrument's own note
 *   says why: *"A district absent from this list was not found to contain any
 *   probed point. That is a statement about the probed points and the walked
 *   layers, never a statement that the district does not govern this ZIP."*
 *   {@link spansAtLayer} therefore returns `null` for a territory it has no
 *   findings for — distinct from `[]`, which would be a claim.
 * - **It never keys on a bare id.** `scripts/build-zip-division-ids.mts` records
 *   a GEOID collision that produced this exact defect shape in a different join
 *   — Morris County NJ `34027` against NJ `sldu:27` `34027` — and was fixed by
 *   keying on `(layer, GEOID)`. Every lookup here is keyed on
 *   `(layer, district)` for the same reason: a district number is unique inside
 *   its layer and meaningless outside it.
 * - **It never invents geometry.** It reads recorded probe results. A finer
 *   answer needs more probed points, which is a hunting question, not a
 *   reasoning one.
 */

/** One district found to hold at least one probed point, in one walked layer. */
export interface ProbeFinding {
  /** The walked layer. Half of every key — see the GEOID-collision note. */
  layer: string;
  publisher: string;
  /** How authoritative the layer is for the question being asked. */
  strength: string;
  vintage: string;
  /** The district's own identifier WITHIN its layer. Never unique outside it. */
  district: string;
  pointsHeld: number;
  /**
   * The probe points this district holds.
   *
   * **Shared across layers**, which is the whole instrument: two findings from
   * two different layers that name the same label are two districts covering
   * one piece of ground. That is measured co-occurrence, not an intersection
   * this module computes.
   */
  pointLabels: string[];
}

export interface ProbeInstrument {
  zip: string;
  probedPoints: number;
  layers: { key: string; status: string; detail: string }[];
  findings: ProbeFinding[];
  note: string;
}

/** The one finding for `(layer, district)`, or null. Keyed on BOTH, always. */
export function findingFor(
  instrument: ProbeInstrument,
  layer: string,
  district: string,
): ProbeFinding | null {
  const hits = instrument.findings.filter(
    (f) => f.layer === layer && f.district === district,
  );
  return hits.length === 1 ? hits[0] : null;
}

/**
 * **THE POLYGON ANSWER.** Which districts of `atLayer` a territory is MEASURED
 * to span.
 *
 * Returns districts in descending order of shared points, so the caller reads
 * the largest overlap first and never has to sort a claim into order itself.
 *
 * `null` — never `[]` — when the subject territory has no findings in the
 * instrument. An empty array here would say *"this territory spans no district
 * at that level"*, which is a claim about a government; `null` says *"this
 * instrument did not measure it"*, which is a claim about us. Those are
 * different facts and may never render the same way.
 */
export function spansAtLayer(
  instrument: ProbeInstrument,
  subject: { layer: string; district: string },
  atLayer: string,
): string[] | null {
  const finding = findingFor(instrument, subject.layer, subject.district);
  if (finding === null) return null;

  const held = new Set(finding.pointLabels);
  return instrument.findings
    .filter((f) => f.layer === atLayer)
    .map((f) => ({
      district: f.district,
      shared: f.pointLabels.filter((p) => held.has(p)).length,
    }))
    .filter((entry) => entry.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.district.localeCompare(b.district))
    .map((entry) => entry.district);
}

/**
 * **THE POINT ANSWER.** The one district of `layer` a single probed point falls
 * in, or null where the walked layer does not reach it.
 *
 * Null is *"this point is outside every district this layer holds"* — true of
 * the 29 points outside any fire district at 85641 — and never *"this point has
 * no fire district"*, which nobody measured.
 *
 * **Throws when a point holds two districts of one layer.** That is not a
 * defensive flourish: it is the invariant the whole singular-field class rests
 * on, and if it ever stops holding, every consumer that trusted a point to
 * resolve to one district is wrong and must be told loudly rather than handed
 * an arbitrary first match. A silent `[0]` here is exactly how
 * `legislativeDistrict: string | null` looked correct for a year.
 */
export function districtAtPoint(
  instrument: ProbeInstrument,
  pointLabel: string,
  layer: string,
): string | null {
  const hits = instrument.findings.filter(
    (f) => f.layer === layer && f.pointLabels.includes(pointLabel),
  );
  if (hits.length > 1) {
    throw new Error(
      `${pointLabel} falls in ${hits.length} districts of ${layer} ` +
        `(${hits.map((h) => h.district).join(", ")}) — a POINT must resolve to ` +
        `one district per layer, and every singular district field in this ` +
        `repository assumes it does`,
    );
  }
  return hits.length === 1 ? hits[0].district : null;
}

/** Every distinct probed point label the instrument mentions. */
export function probePoints(instrument: ProbeInstrument): string[] {
  return [
    ...new Set(instrument.findings.flatMap((f) => f.pointLabels)),
  ];
}

/** Every layer that produced at least one finding. */
export function walkedLayers(instrument: ProbeInstrument): string[] {
  return [...new Set(instrument.findings.map((f) => f.layer))];
}
