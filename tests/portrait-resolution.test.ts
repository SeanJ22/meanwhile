/**
 * Portrait resolution against the rendered box. `.id-portrait--lg` is 92px with a 3px border and
 * `.id-portrait--sm` 52px, both `object-fit: cover`, so at devicePixelRatio 2 the image's short side needs 172 and
 * 92 device pixels. The floors use the outer box (184 and 104) so they do not move with the border. This pins the
 * current census so the class cannot silently worsen; a publisher's own file can be smaller than the floor.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The large circle at dpr 2. Conservative by the border's 6px, on purpose. */
const LARGE_FLOOR = 184;
/** The small circle at dpr 2. */
const SMALL_FLOOR = 104;

/** A ceiling on the large-card shortfall: it may fall freely and may not rise without a stated reason. */
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
    // An unreadable header is not a small image.
    if (d) out.push({ path, ...d });
  }
  return out;
}

test("OFF-8: the portrait census is readable, and large enough to be a census", () => {
  const all = portraits();
  assert.ok(all.length > 900, `only ${all.length} portraits read — this would pass without looking`);
});

test("OFF-8: no portrait falls below the SMALL card's floor without being named", () => {
  // Small-floor portraits are named rather than counted, so the list can be acted on.
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
  // This portrait is well above the ballot circle's need, so its rendering is not a resolution shortfall.
  const hobbs = portraits().find((p) => /hobbs/i.test(p.path));
  assert.ok(hobbs, "the Hobbs portrait is not in the census any more");
  assert.ok(
    hobbs.w >= SMALL_FLOOR,
    `Hobbs is ${hobbs.w}px wide, under the ballot circle's ${SMALL_FLOOR}px floor — ` +
      "if this ever fails, OFF-10 IS a resolution defect after all",
  );
});

test("OFF-8: the geometry this floor is derived from is still the geometry", () => {
  // The floors are arithmetic over these stylesheet numbers, so they are read rather than remembered.
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.id-portrait--lg\s*\{[^}]*width:\s*92px/, "the large circle is 92px");
  assert.match(css, /\.id-portrait--sm\s*\{[^}]*width:\s*52px/, "the small circle is 52px");
  assert.match(css, /\.id-portrait img\s*\{[^}]*object-fit:\s*cover/, "the short side fills");
});
