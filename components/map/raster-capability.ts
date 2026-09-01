/**
 * **IS THIS READER'S BROWSER PAINTING WEBGL ON A GPU, OR ON THE CPU?**
 * (Session C, 2026-09-01. The adjacent finding from W6 H3.)
 *
 * ## What this is for, stated as a reader rather than as a metric
 *
 * W6 H3 established that the zip fly-in holds 99.7% of a bare MapLibre map on
 * hardware, and that is not reopened. The same instrument, pointed at the
 * SOFTWARE rasteriser, measured the application at 17.2 fps median against a
 * bare map's 59.9 on the identical host in the same minutes — 28.8%, with 189
 * of 194 frames over 33.4 ms. **The bare map reaches 60 fps there too**, which
 * is the whole reason that reading means anything: the CPU rasteriser is not
 * too slow to fly a map, it is too slow to fly THIS map.
 *
 * The people that describes are real and they are not a rounding error: older
 * machines, virtual machines, remote desktop sessions, blocklisted graphics
 * drivers, and anyone who has switched hardware acceleration off. What they get
 * today is a two-and-a-half second slideshow when they enter their zip.
 *
 * ## What it does NOT do
 *
 * It does not decide anything on its own, it does not run on a timer, and it is
 * never consulted more than once per page. It answers one question — which
 * rasteriser is under this canvas — and `components/map/map-canvas.tsx` decides
 * what to do about it. Keeping the reading here rather than inline is what lets
 * `tests/flyin-software-degrade.test.ts` walk every renderer string this has to
 * classify without a browser.
 *
 * ## Why a string match is the instrument, and what it refuses to guess
 *
 * There is no capability bit for "this WebGL context is rasterised on the CPU".
 * The renderer string is what the platform actually exposes, and the CPU
 * rasterisers name themselves in it — SwiftShader (Chromium's), llvmpipe and
 * softpipe (Mesa's), Microsoft's Basic Render Driver, Apple's software
 * renderer. So the match is on those names.
 *
 * **AN UNREADABLE RENDERER IS `"unknown"` AND IS TREATED AS HARDWARE.** That is
 * a deliberate asymmetry and it is the safe direction: `"unknown"` covers a
 * browser that withholds `WEBGL_debug_renderer_info` for fingerprinting
 * reasons, and the overwhelming majority of those readers are on a GPU.
 * Degrading a treatment for everyone whose browser declines to identify itself
 * would take the author's design away from readers who can afford it, to fix a
 * problem they do not have. The degradation is applied only where the CPU
 * rasteriser is NAMED — a positive identification, never an inference from
 * silence.
 *
 * This mirrors the rule the product applies to its own data one layer up: a
 * failure to read something is a fact about the read, never a fact about the
 * thing.
 */

/** What is painting this page's WebGL. `"unknown"` is treated as hardware. */
export type RasterKind = "hardware" | "software" | "unknown";

/**
 * The CPU rasterisers, by the names they give themselves.
 *
 * Lower-cased substrings, matched against the renderer string. Exported so the
 * test can assert the list rather than re-typing it, and so a future session
 * adding a name does not have to find the match site.
 */
export const SOFTWARE_RENDERER_NAMES = [
  /* Chromium's, which is what `--enable-unsafe-swiftshader` selects and what
     every measurement of this defect was taken through. */
  "swiftshader",
  /* Mesa's two, which is what a Linux reader with no working driver gets. */
  "llvmpipe",
  "softpipe",
  /* Windows' fallback when no display driver claims the adapter — the usual
     shape of a VM or a remote desktop session. */
  "basic render",
  "microsoft basic",
  /* Apple's, and the generic self-description some ANGLE builds emit. */
  "apple software renderer",
  "software rasterizer",
  "software rasteriser",
] as const;

/**
 * Classify a renderer string.
 *
 * PURE, and separated from the reading below for exactly that reason: the
 * classification is the part with judgement in it, and a browser is not needed
 * to check judgement. An empty or missing string is `"unknown"` rather than
 * `"hardware"` — the two are the same DECISION here and they are not the same
 * FACT, and a later session reading a log needs to be able to tell them apart.
 */
export function classifyRenderer(renderer: string | null | undefined): RasterKind {
  if (typeof renderer !== "string" || renderer.trim() === "") return "unknown";
  const lower = renderer.toLowerCase();
  return SOFTWARE_RENDERER_NAMES.some((name) => lower.includes(name))
    ? "software"
    : "hardware";
}

/**
 * Read the renderer string out of a throwaway WebGL context.
 *
 * A throwaway canvas rather than MapLibre's own: the map's context belongs to
 * the map, and asking it for an extension is a side effect on a live renderer
 * for a question that does not need one. Both contexts come from the same
 * adapter on the same page, which is the only property this needs.
 *
 * Every failure path returns `null`, which `classifyRenderer` reads as
 * `"unknown"` and the caller treats as hardware. A page with no WebGL at all
 * has no map either, so it never reaches here.
 */
export function readRendererString(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    /*
     * The unmasked string when the browser gives it, and the masked one
     * otherwise. The masked `RENDERER` is generic on older engines and useless
     * for this — but on current Chromium it carries the real adapter, and a
     * useless string classifies as `"unknown"`, which is the correct answer
     * rather than a wrong one.
     */
    const unmasked = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return typeof unmasked === "string" && unmasked.trim() !== "" ? unmasked : null;
  } catch {
    /* A context that refuses to be created or queried is a fact about the
       browser, not about the adapter. `unknown`, and the design stays. */
    return null;
  }
}

/** The reading and the classification together, for the one caller that wants both. */
export function detectRaster(): { kind: RasterKind; renderer: string | null } {
  const renderer = readRendererString();
  return { kind: classifyRenderer(renderer), renderer };
}
