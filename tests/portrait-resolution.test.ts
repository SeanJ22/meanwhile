/**
 * **OFF-8 / OFF-10 — THE PORTRAIT FLOOR, MEASURED AND PINNED.**
 * (The 8.30.26 sweep, worked 2026-08-31.)
 *
 * The owner reported *photo resolution too low for the display* and, on the
 * ballot, *Katie Hobbs photo renders badly*. The row's blocker named the
 * prerequisite exactly: **a measurement of the served image's intrinsic
 * dimensions against the rendered box at devicePixelRatio 1 and 2, then a
 * source-side decision about which resolutions we hold.** No fix was to be
 * attempted without it. This is that measurement, made permanent.
 *
 * ## The geometry, from the stylesheet rather than from memory
 *
 * ```
 *   .id-portrait--lg   92px, 3px border  →  86 CSS px of image
 *   .id-portrait--sm   52px, 3px border  →  46 CSS px of image
 *   object-fit: cover                    →  the SHORT side scales to fill
 * ```
 *
 * At devicePixelRatio 2 the large circle therefore needs **172 device pixels**
 * across the image's short side, and the small one 92. The floor below is 184 —
 * the outer 92px box rather than its content box — deliberately conservative by
 * 12px, because the border is a rendering detail and a floor that tracks it
 * would move the day someone restyles a ring.
 *
 * ## What the measurement found, 2026-08-31, over 1057 committed portraits
 *
 * ```
 *   144 (13.6%) are narrower than 184 device px — soft on the large card at dpr 2
 *     8  (0.8%) are narrower than 104 — the small card's floor
 * ```
 *
 * **And Katie Hobbs is NOT one of them.** Her portrait is 284×354, which is
 * 1.65× the large circle's need and 3.09× the ballot circle's. OFF-10's report
 * is real and it is not a resolution shortfall; whatever renders badly there is
 * a different fact, and this test says so rather than letting a resolution fix
 * take credit for it.
 *
 * ## The source-side half, which is the part that decides the disposition
 *
 * Attributed by publisher, then each publisher's own page fetched:
 *
 * ```
 *   129  gc.nh.gov        101-180px — THE PUBLISHER'S OWN FILE IS THAT SIZE.
 *                         gc.nh.gov/house/images/memberpics/376521.jpg is
 *                         101x152 at the source. We hold the record at the
 *                         resolution it exists at.
 *     5  tucsonaz.gov     we hold 150x150; the same page's own asset serves
 *                         480x720 with or without its dimension parameter. A
 *                         higher-resolution ORIGINAL is publicly available.
 *     5  govboard.tusd1   117x160, which is what tusd1.org publishes.
 *     4  njleg.state.nj.us 151px.
 * ```
 *
 * The five Tucson originals were acquired but not shipped in that pass.
 * New and replacement image bindings now use the saved second-source check
 * in docs/rulings.md §3; no separate author approval is required.
 *
 * ## What this test is FOR
 *
 * Not to fail today — it pins today's census so the class cannot silently
 * worsen. A portrait shipped below the small card's floor, or a rise in the
 * number under the large card's, fails here with the file named.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The large circle at dpr 2. Conservative by the border's 6px, on purpose. */
const LARGE_FLOOR = 184;
/** The small circle at dpr 2. */
const SMALL_FLOOR = 104;

/**
 * The census as measured on 2026-08-31. A CEILING, not a target: the number
 * may fall freely and may not rise without somebody changing this line and
 * saying why.
 *
 * **Raised 144 → 148 on 2026-09-01, and here is the why the line demands.**
 *
 * The author approved the nine OWN03 portraits (`RULING 55`,
 * `docs/evidence/own03-promotion.json`). Four of them are under the large
 * card's floor, and all four are Arizona Corporation Commissioners served from
 * `azcc.gov`:
 *
 * ```
 *   Nick Myers            133x200
 *   Rachel Walden         133x200
 *   Lea Márquez Peterson  165x206
 *   René Lopez            137x206
 * ```
 *
 * **They are THUMBNAIL RENDITIONS, and the full-size originals are published
 * one path segment away.** The URLs the pick took carry `tmb-thumb200` and
 * `MaxWidth=165`; dropping those parameters on the same host returns the same
 * photographs at 3275×4913, 3138×4707, 2828×3600 and 2533×3800 — measured
 * 2026-09-01, HTTP 200 on all four.
 *
 * That makes this RULING 206 rather than a resolution shortfall: one
 * representation is not the record, and a better representation of the same
 * record is available. The four originals were retained in
 * `data/photos/staged/`; a replacement now needs its §3 second-source check.
 * The ceiling records the historical interim state:
 * four readers-see-a-face-today portraits that are softer than the card wants.
 */
const LARGE_SHORTFALL_CEILING = 148;

/** Intrinsic dimensions from the file header. No decoder, no dependency. */
function intrinsic(buf: Buffer): { w: number; h: number } | null {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (buf.subarray(0, 4).toString("ascii") === "RIFF") {
    const fmt = buf.subarray(12, 16).toString("ascii");
    if (fmt === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (fmt === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function portraits(): { path: string; w: number; h: number }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(jpe?g|png|webp)$/i.test(entry)) files.push(full);
    }
  };
  walk("public");
  const out: { path: string; w: number; h: number }[] = [];
  for (const path of files) {
    const d = intrinsic(readFileSync(path).subarray(0, 200_000));
    // A header this parser cannot read is NOT a small image, and recording it
    // as one would be an absence asserted as a fact.
    if (d) out.push({ path, ...d });
  }
  return out;
}

test("OFF-8: the portrait census is readable, and large enough to be a census", () => {
  const all = portraits();
  assert.ok(all.length > 900, `only ${all.length} portraits read — this would pass without looking`);
});

test("OFF-8: no portrait falls below the SMALL card's floor without being named", () => {
  /*
   * The small circle is the one every reader meets on every card. Eight
   * portraits sat under it on 2026-08-31 and they are named here rather than
   * counted, because eight is a list somebody can act on and a number is not.
   */
  const under = portraits()
    .filter((p) => p.w < SMALL_FLOOR)
    .map((p) => `${p.path.split(/[\\/]/).pop()} ${p.w}x${p.h}`)
    .sort();
  assert.ok(
    under.length <= 8,
    `${under.length} portrait(s) are below the small card's ${SMALL_FLOOR}px floor, up from 8:\n  ${under.join("\n  ")}`,
  );
});

test("OFF-8: the large card's shortfall does not grow", () => {
  const under = portraits().filter((p) => p.w < LARGE_FLOOR);
  assert.ok(
    under.length <= LARGE_SHORTFALL_CEILING,
    `${under.length} portrait(s) are below the large card's ${LARGE_FLOOR}px floor, up from ` +
      `${LARGE_SHORTFALL_CEILING} on 2026-08-31. A NEW portrait below the floor is a source ` +
      `decision somebody made — name it and lower this line, or acquire a larger original.`,
  );
});

test("OFF-10: the reported portrait is NOT a resolution shortfall, and that is stated", () => {
  /*
   * The owner reported Katie Hobbs rendering badly on the ballot. Her file is
   * 284×354 — 3.09× what the ballot circle needs at dpr 2 — so a resolution
   * fix would have shipped and changed nothing she saw. Pinned here so the row
   * cannot be closed by the fix for a different defect.
   */
  const hobbs = portraits().find((p) => /hobbs/i.test(p.path));
  assert.ok(hobbs, "the Hobbs portrait is not in the census any more");
  assert.ok(
    hobbs.w >= SMALL_FLOOR,
    `Hobbs is ${hobbs.w}px wide, under the ballot circle's ${SMALL_FLOOR}px floor — ` +
      "if this ever fails, OFF-10 IS a resolution defect after all",
  );
});

test("OFF-8: the geometry this floor is derived from is still the geometry", () => {
  /*
   * The floors above are arithmetic over two numbers in the stylesheet. A
   * design pass that grows the circle silently invalidates every assertion in
   * this file, so the numbers are read rather than remembered.
   */
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.id-portrait--lg\s*\{[^}]*width:\s*92px/, "the large circle is 92px");
  assert.match(css, /\.id-portrait--sm\s*\{[^}]*width:\s*52px/, "the small circle is 52px");
  assert.match(css, /\.id-portrait img\s*\{[^}]*object-fit:\s*cover/, "the short side fills");
});
