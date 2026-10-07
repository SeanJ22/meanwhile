/**
 * Whether this browser rasterises WebGL on the GPU or the CPU. Answers only
 * that; `components/map/map-canvas.tsx` decides what to do about it. There is
 * no capability bit, so the renderer string is matched against the CPU
 * rasterisers' own names. An unreadable renderer is `"unknown"` and treated
 * as hardware: degradation applies only where a CPU rasteriser is named.
 */

/** What is painting this page's WebGL. `"unknown"` is treated as hardware. */
export type RasterKind = "hardware" | "software" | "unknown";

/** The CPU rasterisers' names, as lower-cased substrings of the renderer string. */
export const SOFTWARE_RENDERER_NAMES = [
  /* Chromium's; what `--enable-unsafe-swiftshader` selects. */
  "swiftshader",
  /* Mesa's. */
  "llvmpipe",
  "softpipe",
  /* Windows' fallback when no display driver claims the adapter (VMs, remote desktop). */
  "basic render",
  "microsoft basic",
  /* Apple's, and the generic self-description some ANGLE builds emit. */
  "apple software renderer",
  "software rasterizer",
  "software rasteriser",
] as const;

/**
 * Classify a renderer string. Empty or missing is `"unknown"`, kept distinct
 * from `"hardware"` in logs although it is treated the same.
 */
export function classifyRenderer(renderer: string | null | undefined): RasterKind {
  if (typeof renderer !== "string" || renderer.trim() === "") return "unknown";
  const lower = renderer.toLowerCase();
  return SOFTWARE_RENDERER_NAMES.some((name) => lower.includes(name))
    ? "software"
    : "hardware";
}

/**
 * Read the renderer string from a throwaway WebGL context, so the map's own
 * context is never touched. Every failure returns `null` (`"unknown"`).
 */
export function readRendererString(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    /* The unmasked string when available, else the masked one; a useless string classifies as `"unknown"`. */
    const unmasked = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return typeof unmasked === "string" && unmasked.trim() !== "" ? unmasked : null;
  } catch {
    return null;
  }
}

/** The reading and the classification together, for the one caller that wants both. */
export function detectRaster(): { kind: RasterKind; renderer: string | null } {
  const renderer = readRendererString();
  return { kind: classifyRenderer(renderer), renderer };
}
