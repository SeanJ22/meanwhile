/**
 * A minimal PNG reader for exactly what Playwright emits: 8-bit, non-
 * interlaced, colour type 6 (RGBA) or 2 (RGB).
 *
 * Hand-rolled rather than added as a dependency: the only thing in the
 * repository that needs to look at a pixel is its own visual measurements,
 * and a decoder that is `zlib` plus the five PNG filter types is cheaper to
 * keep honest than a package that would ship to nobody.
 *
 * Lifted out of `scripts/measure-extrusion.mts` for g5 item 1, because the
 * coverage measurement the brief asks for needs SATURATION as well as
 * luminance — "measurably darker AND less saturated" is two numbers, and a
 * decoder that only returns one of them is how a check ends up measuring the
 * wrong thing.
 */
import { inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  /** Rec. 709 luminance per pixel — the eye's own weighting. */
  luminance: Float32Array;
  /** Raw interleaved samples, `channels` per pixel. */
  pixels: Uint8Array;
  channels: number;
}

export function decodePng(buffer: Buffer): DecodedPng {
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

  const luminance = new Float32Array(width * height);
  for (let i = 0, at = 0; i < luminance.length; i += 1, at += channels) {
    luminance[i] =
      0.2126 * pixels[at] + 0.7152 * pixels[at + 1] + 0.0722 * pixels[at + 2];
  }

  return { width, height, luminance, pixels, channels };
}

export interface PatchStats {
  /** Mean Rec. 709 luminance over the patch. */
  luma: number;
  /**
   * Mean chroma — max(r,g,b) − min(r,g,b), 0–255.
   *
   * Not HSV saturation: the scrim desaturates by `saturate(0.68)`, which is a
   * multiplication in linear RGB about the luminance axis, and chroma is the
   * quantity that actually shrinks. HSV saturation divides by value and so
   * moves when the mute's own colour rect changes brightness, which would make
   * the exterior check pass or fail for the wrong reason.
   */
  chroma: number;
  /** Standard deviation of luminance — a blurred patch has less of it. */
  detail: number;
}

/** Mean luminance, chroma and local detail over a square patch of pixels. */
export function patchStats(
  png: DecodedPng,
  cx: number,
  cy: number,
  half = 6,
): PatchStats {
  const { width, height, pixels, channels, luminance } = png;
  let n = 0;
  let sumL = 0;
  let sumC = 0;
  const values: number[] = [];
  for (let y = Math.max(0, cy - half); y <= Math.min(height - 1, cy + half); y += 1) {
    for (let x = Math.max(0, cx - half); x <= Math.min(width - 1, cx + half); x += 1) {
      const i = y * width + x;
      const at = i * channels;
      const r = pixels[at];
      const g = pixels[at + 1];
      const b = pixels[at + 2];
      sumC += Math.max(r, g, b) - Math.min(r, g, b);
      sumL += luminance[i];
      values.push(luminance[i]);
      n += 1;
    }
  }
  if (n === 0) return { luma: 0, chroma: 0, detail: 0 };
  const luma = sumL / n;
  let variance = 0;
  for (const v of values) variance += (v - luma) ** 2;
  return { luma, chroma: sumC / n, detail: Math.sqrt(variance / n) };
}
