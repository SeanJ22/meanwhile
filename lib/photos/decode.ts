import sharp from "sharp";

export const MIN_PORTRAIT_EDGE = 96;
export const MAX_PORTRAIT_BYTES = 10 * 1024 * 1024;
export const MAX_PORTRAIT_PIXELS = 25_000_000;
export const PORTRAIT_DECODER_VERSION = "sharp-0.35.3/static-webp/1";
export type ImageFormat = "png" | "jpeg" | "gif" | "webp";
export const PORTRAIT_FORMATS: readonly ImageFormat[] = ["png", "jpeg", "gif", "webp"];
export const PORTRAIT_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

export type DecodeVerdict =
  | { ok: true; format: ImageFormat; width: number; height: number; bytes: number }
  | { ok: false; reason: "EMPTY" | "NOT_AN_IMAGE" | "TRUNCATED" | "NO_IMAGE_DATA" | "TOO_SMALL" | "TOO_LARGE" | "MULTIPLE_FRAMES"; detail: string; bytes: number };
export type NormalizedPortrait = { verdict: Extract<DecodeVerdict, {ok:true}>; bytes: Uint8Array } | { verdict: Extract<DecodeVerdict, {ok:false}> };

/** Decode every pixel before accepting it; metadata alone is never an image check. */
export async function normalizePortrait(input: Uint8Array): Promise<NormalizedPortrait> {
  const bytes = input.byteLength;
  const refuse = (reason: Extract<DecodeVerdict, {ok:false}>["reason"], detail: string): NormalizedPortrait => ({verdict:{ok:false,reason,detail,bytes}});
  if (!bytes) return refuse("EMPTY", "zero bytes");
  if (bytes > MAX_PORTRAIT_BYTES) return refuse("TOO_LARGE", `Portrait exceeds ${MAX_PORTRAIT_BYTES} source bytes`);
  try {
    const image = sharp(input, {failOn:"warning",limitInputPixels:MAX_PORTRAIT_PIXELS,limitInputChannels:4,sequentialRead:true});
    const meta = await image.metadata();
    if (!PORTRAIT_FORMATS.includes(meta.format as ImageFormat)) return refuse("NOT_AN_IMAGE", `Unsupported portrait format ${meta.format ?? "unknown"}`);
    if ((meta.pages ?? 1) !== 1) return refuse("MULTIPLE_FRAMES", "A portrait must be one complete static image");
    if (!meta.width || !meta.height) return refuse("NO_IMAGE_DATA", "Image dimensions are absent");
    if (meta.width * meta.height > MAX_PORTRAIT_PIXELS) return refuse("TOO_LARGE", "Image exceeds the decoded pixel limit");
    if (meta.width < MIN_PORTRAIT_EDGE || meta.height < MIN_PORTRAIT_EDGE) return refuse("TOO_SMALL", `${meta.width}x${meta.height}, below ${MIN_PORTRAIT_EDGE}px on an edge`);
    // Re-encoding strips EXIF, XMP and comments. Apply orientation before removing its tag.
    const result = await image.rotate().toColourspace("srgb").resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true})
      .webp({quality:90,effort:4}).timeout({seconds:10}).toBuffer({resolveWithObject:true});
    if (result.data.byteLength > MAX_PORTRAIT_BYTES) return refuse("TOO_LARGE", "Normalized image exceeds the byte limit");
    return {verdict:{ok:true,format:meta.format as ImageFormat,width:result.info.width,height:result.info.height,bytes},bytes:new Uint8Array(result.data)};
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse(/pixel limit|exceeds|timeout/i.test(detail) ? "TOO_LARGE" : /unsupported image format/i.test(detail) ? "NOT_AN_IMAGE" : "TRUNCATED", detail.slice(0,240));
  }
}

export async function decodeImage(input: Uint8Array): Promise<DecodeVerdict> {
  return (await normalizePortrait(input)).verdict;
}
export interface PortraitDecodeRecord {
  ok: boolean; format?: ImageFormat; width?: number; height?: number; bytes?: number; reason?: string; detail?: string;
  decodedAt: string;
}
export function decodeRecord(verdict: DecodeVerdict, decodedAt: string): PortraitDecodeRecord {
  return {...verdict,decodedAt};
}
