/**
 * `pnpm measure:extrusion` — the MEASURED acceptance check for the state
 * extrusion (g4 item 2).
 *
 * ## Why this exists at all
 *
 * g3's lesson, in the brief's own words: three defects survived screenshots
 * and died to measurement. The extrusion is the worst case of that class,
 * because the thing being judged — "does this read as a soft rise, or as a
 * drawn line?" — is exactly the judgement an eye makes badly on a scaled
 * screenshot. The author still rules on four frames; this is the FLOOR his
 * eye is the ceiling of.
 *
 * ## The instrument: two shots of the same frame
 *
 * The effect is measured against ITSELF. One screenshot with the overlay
 * live, one with `.state-focus-layer` display-none — same camera, no reload,
 * no tile refetch — and the DIFFERENCE is the extrusion and nothing else.
 * Every pixel of terrain, every label, the pins and the zip shading are
 * identical in both and cancel exactly.
 *
 * That subtraction is what makes the thresholds mean anything. The first
 * version of this script sampled absolute luminance along normals to the
 * border and reported adjacent steps of 38 and 115 — which were real, and
 * were a highway and a place label in the basemap tiles. Nothing about the
 * extrusion was being measured at all.
 *
 * ## The three tests, and why these three
 *
 * 1. **PRESENT.** The effect must actually draw. Every smoothness test ever
 *    written passes against an effect that is not there, and "the effect
 *    never disappears" is the author's standing ruling — so the floor comes
 *    first, and a silent release reads as a failure rather than a pass.
 *
 * 2. **NO HARD EDGE.** The largest adjacent-pixel change in the DIFFERENCE
 *    image, anywhere on the canvas. This is the direct test for what the
 *    author reported: a stroke changes by its full strength over one or two
 *    pixels, and a Gaussian spread over 9–16 px of sigma cannot. It is
 *    measured over the whole frame rather than along chosen normals, so
 *    there is nowhere for a hard edge to hide.
 *
 * 3. **ONE LIGHT SOURCE.** The brightened pixels' centroid must lie UP AND
 *    LEFT of the darkened pixels' centroid. This is the reference's actual
 *    mechanic reduced to something a machine can check, and it is the test
 *    the rejected build fails: two opposed strokes 4 px apart composite to
 *    grey on every side at once, so their light and dark centroids sit on
 *    top of each other and neither leads the other. No amount of blur tuning
 *    fakes it.
 *
 * Every number is printed, passing or failing, because a threshold reported
 * only when it trips tells the next session nothing about margin.
 *
 * `MEASURE_BASE_URL=… pnpm measure:extrusion`
 */
import { chromium } from "playwright";
import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

/**
 * C05 (2026-08-17): this run declares itself so the rows it writes to
 * production's search log are never counted as a reader's. The runner cannot
 * mark the row — the route writes it — so it says who it is in a header.
 */
const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() ||
    makeRunId("measure-extrusion", new Date().toISOString()),
});

import { inflateSync } from "node:zlib";

const BASE = (process.env.MEASURE_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

/**
 * Thresholds, in 0–255 luminance. All three are stated, not tuned to pass.
 *
 * `MAX_STEP` is the one that matters. The rejected build's white and black
 * line layers were 7 px wide with 6 px of blur; where such a stroke meets
 * untouched terrain the difference image steps by most of the stroke's own
 * strength in a pixel or two. A shadow blurred at sigma 9–16 changes by well
 * under a unit per pixel, so anything approaching double figures means
 * something in the stack is still drawing an edge.
 */
const MAX_STEP = 6;
/** The effect has to be visible: peak difference, anywhere. */
const MIN_PRESENCE = 3;
/** How far the lit centroid must lead the shaded one, in pixels. */
const MIN_LEAD = 4;
/** Pixels quieter than this are noise, not the effect. */
const SIGNAL = 1.5;

/* ------------------------------------------------------------- PNG --- */

/**
 * A minimal PNG reader for exactly what Playwright emits: 8-bit, non-
 * interlaced, colour type 6 (RGBA) or 2 (RGB).
 *
 * Hand-rolled rather than added as a dependency: this is the only thing in
 * the repository that needs to look at a pixel, and a decoder that is
 * `zlib` plus the five PNG filter types is cheaper to keep honest than a
 * package that would ship to nobody.
 */
function decodePng(buffer: Buffer): {
  width: number;
  height: number;
  luminance: Float32Array;
} {
  let offset = 8; // the signature
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data.readUInt8(8);
      const colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (depth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
        throw new Error(
          `unexpected PNG: depth ${depth}, colour type ${colorType}, interlace ${interlace}`,
        );
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);

  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x];
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y > 0 ? pixels[previous + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[previous + x - channels] : 0;
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          restored = value + predictor;
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      pixels[row + x] = restored & 0xff;
    }
    source += stride;
  }

  // Rec. 709 — the eye's own weighting, which is what "reads as a line" means.
  const luminance = new Float32Array(width * height);
  for (let i = 0, at = 0; i < luminance.length; i += 1, at += channels) {
    luminance[i] =
      0.2126 * pixels[at] + 0.7152 * pixels[at + 1] + 0.0722 * pixels[at + 2];
  }

  return { width, height, luminance };
}

/* ---------------------------------------------------------- the pass --- */

const browser = await chromium.launch();
let failures = 0;
let frames = 0;

for (const theme of ["dark", "light"] as const) {
  const context = await browser.newContext({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width: 1100, height: 900 },
    // Device pixel ratio 1: the thresholds are in the same pixels the
    // profiles are computed in, and a 2× screenshot would silently halve
    // every one of them.
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: theme,
  });
  await context.addInitScript(
    ({ theme }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: "85701", savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.theme", theme);
      } catch {
        // The pass still runs; the theme comes from the media query.
      }
    },
    { theme },
  );

  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(11_000);

  for (const [label, zoomOut] of [
    // Two zooms, per the brief: the frame where the border is a detail in the
    // corner, and the frame where the whole outline is on screen at once —
    // which is where the rejected build's sawing was worst. Cumulative from
    // the zip's own altitude, so these land at roughly zoom 8 and zoom 4.
    ["regional", 5],
    ["continental", 2],
  ] as const) {
    await page.evaluate(
      (by) =>
        (window as unknown as { __wtpZoomOut?: (n?: number) => void }).__wtpZoomOut?.(
          by,
        ),
      zoomOut,
    );
    await page.waitForTimeout(3500);

    const zoom = await page.evaluate(
      () => (window as unknown as { __wtpZoom?: () => number }).__wtpZoom?.() ?? -1,
    );
    const focus = await page.evaluate(
      () =>
        (
          window as unknown as {
            __wtpMapProbe?: () => { focusOcdId: string | null };
          }
        ).__wtpMapProbe?.().focusOcdId ?? null,
    );
    const box = await page.locator(".maplibregl-canvas").first().boundingBox();

    if (!focus || !box) {
      // COULD NOT RUN is reported separately from FAILED (the g3 rule): an
      // unreachable instrument is not a broken feature. It still counts as a
      // failure of the PASS, because a measurement that measured nothing must
      // never read as a green check.
      console.log(
        `  ${theme}/${label}: CANNOT RUN — ${!focus ? "no state is focused" : "no map canvas"}`,
      );
      failures += 1;
      continue;
    }

    /*
     * THE CHROME IS HIDDEN FOR BOTH SHOTS, not excluded afterwards.
     *
     * Two rounds were spent trying to subtract the app's own controls out of
     * the result — first by rectangle, then by z-index, then by area — and
     * every version left something behind, most stubbornly the who-governs
     * card, which is 45% of the map and does not present as chrome to any
     * simple test. It kept reporting an adjacent step of 165 at the same
     * pixel: the card's own edge, changing its antialiasing because toggling
     * the scrim changes the compositing tree.
     *
     * Hiding it in BOTH shots removes the problem instead of measuring
     * around it. `visibility: hidden` keeps layout identical, applies to both
     * frames equally, and leaves exactly the canvas and the extrusion — which
     * is the only pair the subtraction was ever meant to compare.
     */
    const chromeHidden = await page.addStyleTag({
      content:
        "body * { visibility: hidden !important; } " +
        ".maplibregl-canvas-container, .maplibregl-canvas-container *, " +
        ".state-focus-layer, .state-focus-layer * { visibility: visible !important; }",
    });
    await page.waitForTimeout(400);

    const shoot = async () =>
      decodePng(
        await page.screenshot({
          type: "png",
          animations: "disabled",
          caret: "hide",
        }),
      );

    const maxDifference = (
      a: { width: number; luminance: Float32Array },
      b: { luminance: Float32Array },
      bounds: { x0: number; y0: number; x1: number; y1: number },
    ) => {
      let worst = 0;
      for (let y = bounds.y0; y < bounds.y1; y += 1) {
        for (let x = bounds.x0; x < bounds.x1; x += 1) {
          const i = y * a.width + x;
          const d = Math.abs(a.luminance[i] - b.luminance[i]);
          if (d > worst) worst = d;
        }
      }
      return worst;
    };

    // Confined to the MAP's own rectangle, inset a little. Outside it lies
    // the sidebar, where the scrim does not reach and the canvas edge would
    // read as a hard edge in the effect — which is the map ending, not the
    // extrusion stepping.
    /*
     * Inset well clear of the map's own edges.
     *
     * The diff map showed the only differences at regional zoom sitting in
     * two-cell bands along the left and right edges of the canvas and across
     * the bottom — the scrim's overscan meeting the sidebar, and the bottom
     * chrome's compositing. None of it is the extrusion, and all of it is
     * hard-edged by nature, so it dominated the step test while the terrain
     * in between showed nothing at all.
     */
    const INSET = 44;
    const bounds = {
      x0: Math.round(box.x) + INSET,
      y0: Math.round(box.y) + INSET,
      x1: Math.min(1100, Math.round(box.x + box.width)) - INSET,
      y1: Math.min(900, Math.round(box.y + box.height)) - INSET,
    };

    /*
     * THE FRAME MUST BE STILL BEFORE IT CAN BE SUBTRACTED.
     *
     * This check was added after the pass reported peaks of 121 and adjacent
     * steps of 167 — an order of magnitude more than a translucent scrim can
     * produce — at identical coordinates in every theme. Nothing about the
     * extrusion was wrong. The map was still loading TILES: the two
     * screenshots were seconds apart, a vector tile landed between them, and
     * the subtraction attributed a newly drawn motorway to the shadow.
     *
     * So the instrument now proves its own premise. Two shots with the
     * overlay LIVE must agree to within `SIGNAL` before the third shot is
     * taken; until they do, the difference is measuring the basemap arriving.
     * Without this the pass was capable of failing a perfect build and — far
     * worse — of passing a broken one, because tile noise swamps the signal
     * in both directions.
     */
    let on = await shoot();
    let settled = false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const again = await shoot();
      if (maxDifference(on, again, bounds) <= SIGNAL) {
        on = again;
        settled = true;
        break;
      }
      on = again;
      await page.waitForTimeout(2500);
    }

    if (!settled) {
      console.log(
        `  ${theme}/${label}: CANNOT RUN — the map never stopped repainting, ` +
          "so a difference would be measuring tiles rather than the extrusion",
      );
      failures += 1;
      continue;
    }

    /*
     * The effect is turned OFF by neutralising its PAINT, never by removing
     * its element — and that distinction is the second thing this instrument
     * got wrong.
     *
     * `display: none` on `.state-focus-layer` destroys the `backdrop-filter`
     * element, and with it the composited layer that element forces. Chromium
     * then re-rasterizes the page's text with a different antialiasing mode,
     * so every glyph edge on the screen changes by up to 120 luminance units.
     * The pass reported peaks of 121 and steps of 167 at pixel-identical
     * coordinates through four unrelated code changes, which is what finally
     * gave it away: a measurement that does not move when the thing it
     * measures moves is not measuring it.
     *
     * Keeping the element and zeroing what it draws leaves the compositing
     * tree byte-identical between the two shots, so the difference really is
     * the extrusion.
     */
    const hidden = await page.addStyleTag({
      content:
        // An IDENTITY backdrop-filter, not `none`. `none` removes the
        // property and destroys the composited layer just as `display: none`
        // did — which is why both spellings produced the same wrong numbers
        // to two decimal places. `blur(0) saturate(1) brightness(1)` keeps
        // the backdrop root alive and paints nothing through it.
        ".state-focus-scrim { backdrop-filter: blur(0px) saturate(1) " +
        "brightness(1) !important; background: transparent !important; } " +
        ".state-focus-art { opacity: 0 !important; }",
    });
    await page.waitForTimeout(400);
    const off = await shoot();
    await hidden.evaluate((node) => (node as unknown as Element).remove());
    await chromeHidden.evaluate((node) => (node as unknown as Element).remove());
    await page.waitForTimeout(300);

    const { x0, y0, x1, y1 } = bounds;

    /*
     * THE STEP TEST RUNS ON THE LOW-FREQUENCY COMPONENT, and the difference
     * image is what forced that.
     *
     * Rendered out and looked at, the difference is exactly the design: a
     * soft white glow along Arizona's north-west border, a dark edge along
     * the south-east, and flat nothing inside. But it also contains every
     * PLACE NAME outside the state, because the scrim blurs the basemap's
     * labels along with its terrain — and blurring a glyph changes single
     * pixels by more than a hundred luminance units. The step test was
     * reading "Hermosillo".
     *
     * That is not a defect to fix; it is the mute working on text. So the
     * step is measured on 8x8 block means, where a letterform averages away
     * and a stroke does not: the rejected build's grey band was a continuous
     * ridge tracing the whole polygon, which survives any amount of
     * downsampling. This is the difference between measuring the EDGE and
     * measuring the type.
     */
    const CELL = 8;
    const cols = Math.ceil((x1 - x0) / CELL);
    const rows = Math.ceil((y1 - y0) / CELL);
    const coarse = new Float32Array(cols * rows);
    const counts = new Float32Array(cols * rows);

    let peak = 0;
    let litX = 0;
    let litY = 0;
    let litWeight = 0;
    let darkX = 0;
    let darkY = 0;
    let darkWeight = 0;
    let touched = 0;

    const delta = (x: number, y: number) =>
      on.luminance[y * on.width + x] - off.luminance[y * off.width + x];

    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const here = delta(x, y);
        const magnitude = Math.abs(here);
        if (magnitude > peak) peak = magnitude;

        const cell = Math.floor((y - y0) / CELL) * cols + Math.floor((x - x0) / CELL);
        coarse[cell] += here;
        counts[cell] += 1;

        if (magnitude >= SIGNAL) touched += 1;
      }
    }

    for (let i = 0; i < coarse.length; i += 1) {
      if (counts[i] > 0) coarse[i] /= counts[i];
    }

    /*
     * The asymmetry is read from the STRONG lobes, not from every touched
     * pixel — because the scrim has a sign of its own and it is not the
     * light's.
     *
     * In dark mode the mute darkens and in light mode it BRIGHTENS, so a
     * centroid taken over everything the effect touches is really the
     * centroid of "outside the state", and in light mode it reported the lit
     * lobe trailing the shaded one by 71 px while the rendered difference
     * plainly showed a white glow on the north-west border. The shadows are
     * the high-magnitude tail; the scrim is a low uniform floor. Thresholding
     * at a fraction of the peak separates them without needing to know which
     * theme is in play.
     */
    let brightest = 0;
    let darkest = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const here = delta(x, y);
        if (here > brightest) brightest = here;
        if (here < darkest) darkest = here;
      }
    }
    /*
     * Each side is thresholded against ITS OWN extreme, not against the
     * shared peak.
     *
     * White at 0.5 over a light basemap is a small change; black at 0.42
     * over the same basemap is a large one. A single threshold taken from
     * the overall peak is therefore set by the dark lobe in light mode, and
     * admits almost none of the lit lobe — which is why light mode reported
     * the two centroids as coincident while the rendered difference showed a
     * clear white glow along the north-west border. Per-side thresholds make
     * the test about WHERE each lobe is, which is the question, rather than
     * about how strong it happens to be against this theme's ground.
     */
    const LIT_LOBE = brightest * 0.35;
    const DARK_LOBE = darkest * 0.35;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const here = delta(x, y);
        if (here > LIT_LOBE) {
          litX += x * here;
          litY += y * here;
          litWeight += here;
        } else if (here < DARK_LOBE) {
          darkX += x * -here;
          darkY += y * -here;
          darkWeight += -here;
        }
      }
    }

    let worstStep = 0;
    let worstStepAt = "";
    for (let r = 0; r < rows; r += 1) {
      for (let q = 0; q < cols; q += 1) {
        const here = coarse[r * cols + q];
        for (const [dq, dr] of [
          [1, 0],
          [0, 1],
        ] as const) {
          if (q + dq >= cols || r + dr >= rows) continue;
          const step = Math.abs(coarse[(r + dr) * cols + (q + dq)] - here);
          if (step > worstStep) {
            worstStep = step;
            worstStepAt = `${q * CELL},${r * CELL}`;
          }
        }
      }
    }

    const presentOk = peak >= MIN_PRESENCE;
    // Expressed PER PIXEL. The blocks exist to average type away, not to
    // change the units the threshold is stated in.
    const gradient = worstStep / CELL;
    const stepOk = gradient <= MAX_STEP;

    // The lit lobe must LEAD the shaded one toward the light at top-left.
    const lead =
      litWeight > 0 && darkWeight > 0
        ? (darkX / darkWeight - litX / litWeight + (darkY / darkWeight - litY / litWeight)) /
          2
        : 0;
    const lightRan = litWeight > 0 && darkWeight > 0;
    const lightOk = lightRan && lead >= MIN_LEAD;

    frames += 1;
    if (!presentOk || !stepOk || !lightOk) failures += 1;

    console.log(
      `  ${theme}/${label} (zoom ${zoom.toFixed(2)}, ${touched} px touched): ` +
        `peak ${peak.toFixed(2)} >= ${MIN_PRESENCE} ${presentOk ? "OK" : "FAIL"}; ` +
        `steepest gradient ${gradient.toFixed(2)}/px <= ${MAX_STEP} ${stepOk ? "OK" : "FAIL"} at ${worstStepAt}; ` +
        (lightRan
          ? `lit centroid leads shaded by ${lead.toFixed(1)}px >= ${MIN_LEAD} ${lightOk ? "OK" : "FAIL"}`
          : `light asymmetry FAIL — only ${litWeight > 0 ? "lit" : "shaded"} pixels present`),
    );
  }

  await context.close();
}

await browser.close();

console.log(
  failures === 0
    ? `extrusion measurement: ${frames} frames, every test passed`
    : `extrusion measurement: ${failures} failure(s) across ${frames} measured frame(s)`,
);
process.exit(failures === 0 ? 0 : 1);
