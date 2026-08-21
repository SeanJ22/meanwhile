/**
 * **A PORTRAIT'S CONTAINER IS NEVER A FINDING ABOUT THE PERSON** (built
 * 2026-08-21, NH Hunt 4 item 2).
 *
 * `stripImageMetadata` handles JPEG and PNG by byte surgery and returns
 * anything else unchanged with `stripped: false`, and `ship:candidate` refuses
 * to ship bytes it cannot inspect — both correct. The consequence was not:
 * campaign sites now serve WebP as a matter of course (and Squarespace serves
 * WebP bytes under a `.jpg` URL), so a portrait a person had read and approved
 * could not ship because of its container format. That is the absence of a
 * tool standing in for a fact about a candidate, which `CLAUDE.md` forbids by
 * name.
 *
 * This normalises a portrait through the one client that decodes every format
 * a browser decodes. It does three things and reports each:
 *
 * 1. **Decodes any container** — WebP and AVIF included.
 * 2. **Names the format from the BYTES, never from the plan.** The first run of
 *    this hunt shipped a JPEG under a `.png` filename because the plan said
 *    `.png` and nothing checked. A file whose extension disagrees with its
 *    bytes is served with the wrong content type, and it is the same class of
 *    defect as a render default manufacturing a claim: the name asserts
 *    something the contents do not support.
 * 3. **Caps the served size.** The same run shipped a 2.7 MB portrait onto a
 *    card. Reader friction is a defect with the standing of a wrong number, and
 *    a multi-megabyte thumbnail is friction. Anything over the cap is resampled
 *    and the resampling is RECORDED in the photo's source string, because a
 *    picture we re-encoded is not byte-identical to the one the source
 *    published and a reader comparing them deserves to know which is which.
 *
 * The pixels remain the source's. Nothing here judges whether the image is a
 * clean solo portrait of the right person — that is a human judgement about a
 * named person's face and the four-door rule keeps it there.
 *
 * A render that produces no pixels THROWS. A zero-byte image is a FAILED
 * transcode, never an empty portrait.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { launchGuarded } from "./browser.mts";

/** The long edge, in pixels, above which a portrait is resampled for serving. */
export const PORTRAIT_MAX_EDGE = 1200;
/** The byte ceiling above which a portrait is resampled even if it is small enough. */
export const PORTRAIT_MAX_BYTES = 600_000;

export type ImageKind = "jpeg" | "png" | "webp" | "avif" | "unknown";

/** What the BYTES say this is. Never what the filename says. */
export function kindOf(bytes: Buffer<ArrayBufferLike>): ImageKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  if (
    bytes.length > 12 &&
    bytes.subarray(4, 8).toString("latin1") === "ftyp" &&
    /avif|avis/.test(bytes.subarray(8, 12).toString("latin1"))
  ) {
    return "avif";
  }
  return "unknown";
}

export const EXTENSION_FOR: Record<Exclude<ImageKind, "unknown">, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
};

export interface NormalisedPortrait {
  bytes: Buffer<ArrayBuffer>;
  /** The extension the bytes actually deserve — `jpg` or `png`, always. */
  extension: "jpg" | "png";
  /** The source's own pixel dimensions, before any resampling. */
  sourceWidth: number;
  sourceHeight: number;
  /** Present only when the bytes were changed, and then it says exactly how. */
  note: string | null;
}

/**
 * Return bytes this repo can serve, plus the note recording what was done.
 *
 * A JPEG or PNG inside both caps comes back untouched with `note: null` — the
 * common case does no work and claims none.
 */
export async function normalisePortrait(
  input: Buffer<ArrayBufferLike>,
): Promise<NormalisedPortrait> {
  const kind = kindOf(input);
  if (kind === "unknown") {
    throw new Error(
      "normalisePortrait: these bytes are not a JPEG, PNG, WebP or AVIF. Bytes we cannot " +
        "identify do not ship, and an unidentifiable file is a failed retrieval rather than a portrait.",
    );
  }

  const dir = mkdtempSync(join(tmpdir(), "wtp-portrait-"));
  const source = join(dir, `source.${EXTENSION_FOR[kind]}`);
  writeFileSync(source, input);
  const browser = await launchGuarded({ label: "normalise-portrait" });
  try {
    const page = await browser.page({ viewport: { width: 800, height: 800 } });
    await page.goto(pathToFileURL(source).toString(), { waitUntil: "load", timeout: 45_000 });
    await page.waitForFunction(
      "(() => { const i = document.querySelector('img'); return i && i.complete; })()",
      undefined,
      { timeout: 45_000 },
    );
    const dims = (await page.evaluate(
      "(() => { const i = document.querySelector('img'); return i ? { w: i.naturalWidth, h: i.naturalHeight } : { w: 0, h: 0 }; })()",
    )) as { w: number; h: number };
    if (!dims.w || !dims.h) {
      throw new Error(
        `normalisePortrait read no pixels from a ${kind} of ${input.length} bytes — ` +
          "a FAILED decode, never an empty image",
      );
    }

    const longEdge = Math.max(dims.w, dims.h);
    const withinCaps = longEdge <= PORTRAIT_MAX_EDGE && input.length <= PORTRAIT_MAX_BYTES;
    if ((kind === "jpeg" || kind === "png") && withinCaps) {
      return {
        bytes: Buffer.from(input) as Buffer<ArrayBuffer>,
        extension: EXTENSION_FOR[kind] as "jpg" | "png",
        sourceWidth: dims.w,
        sourceHeight: dims.h,
        note: null,
      };
    }

    const scale = Math.min(1, PORTRAIT_MAX_EDGE / longEdge);
    const width = Math.max(1, Math.round(dims.w * scale));
    const height = Math.max(1, Math.round(dims.h * scale));
    const dataUrl = (await page.evaluate(
      `(() => {
        const img = document.querySelector('img');
        const canvas = document.createElement('canvas');
        canvas.width = ${width};
        canvas.height = ${height};
        canvas.getContext('2d').drawImage(img, 0, 0, ${width}, ${height});
        return canvas.toDataURL('image/jpeg', 0.85);
      })()`,
    )) as string;
    const encoded = Buffer.from(dataUrl.split(",")[1] ?? "", "base64") as Buffer<ArrayBuffer>;
    if (encoded.length === 0) {
      throw new Error("normalisePortrait encoded zero bytes — a FAILED transcode");
    }
    const parts: string[] = [];
    if (kind !== "jpeg") parts.push(`${kind.toUpperCase()} source decoded to JPEG`);
    if (scale < 1) parts.push(`resampled ${dims.w}x${dims.h} to ${width}x${height} for serving`);
    else parts.push(`re-encoded as JPEG at ${width}x${height} for serving`);
    return {
      bytes: encoded,
      extension: "jpg",
      sourceWidth: dims.w,
      sourceHeight: dims.h,
      note: `${parts.join(", ")} by pnpm ship:candidate`,
    };
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
