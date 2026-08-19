/**
 * R53 — THE SPLIT MUST SURVIVE A RE-CHUNK (g18, 2026-08-18).
 *
 * The auditor asked for MapLibre and application cost tracked separately for
 * one reason: so map cost cannot hide inside application cost. The split that
 * existed could not do that job, because it attributed a WHOLE CHUNK to
 * MapLibre whenever the chunk's bytes contained the string `maplibre`. Move
 * the same modules into different chunks and the number moves, though nothing
 * about what the reader downloads has changed.
 *
 * That is not a hypothetical. It happened twice on record:
 *   - AUD-03's re-chunking moved the figure from 2,155,530 to 1,148,412 with
 *     no map code touched at all.
 *   - g18's own AUD-06 change touched application modules only, and the
 *     reported `applicationBytes` was byte-identical across three builds
 *     (1,568,189 every time) while `maplibreBytes` absorbed the whole delta in
 *     both directions (+159, then −123).
 *
 * So the test is not "does it produce a number". It is: **the same modules,
 * laid out in different chunks, must attribute identically** — and the old
 * heuristic must be shown to fail that, or the new one passing proves nothing.
 * Both are asserted below, on the same two fixtures.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  attributeByProvenance,
  attributeChunk,
} from "../scripts/attribute-client-bytes.mjs";

/* -- fixtures -------------------------------------------------------------- */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard source-map VLQ, written out so the fixture owes nothing to a dep. */
function vlq(value: number): string {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}

const MAPLIBRE = "turbopack:///[project]/node_modules/maplibre-gl/dist/maplibre-gl.js";
const APP = "turbopack:///[project]/components/map/map-canvas.tsx";

/**
 * One generated line built from runs of code, each owned by a source index.
 *
 * Returns the line and the mappings group for it. Each run becomes one
 * four-field segment at the column where the run starts, which is exactly the
 * shape a minifier emits: a few very long lines, boundaries at module edges.
 */
function line(runs: { source: number; text: string }[]) {
  let code = "";
  let col = 0;
  let prevCol = 0;
  let prevSource = 0;
  const segments: string[] = [];
  for (const run of runs) {
    segments.push(
      vlq(col - prevCol) + vlq(run.source - prevSource) + vlq(0) + vlq(0),
    );
    prevCol = col;
    prevSource = run.source;
    code += run.text;
    col += run.text.length;
  }
  return { code, group: segments.join(",") };
}

interface Chunk {
  name: string;
  code: string;
  sources: string[];
  mappings: string;
}

/** A chunk holding the given runs, in order, on one generated line. */
function chunk(name: string, sources: string[], runs: { source: number; text: string }[]): Chunk {
  const { code, group } = line(runs);
  return { name, code, sources, mappings: group };
}

/** Write chunks (and their maps) into a throwaway `.next` and attribute them. */
function attribute(chunks: Chunk[]) {
  const root = mkdtempSync(join(tmpdir(), "wtp-attr-"));
  try {
    const dir = join(root, "static", "chunks");
    mkdirSync(dir, { recursive: true });
    for (const c of chunks) {
      const mapName = `${c.name}.map`;
      writeFileSync(
        join(dir, c.name),
        `${c.code}\n//# sourceMappingURL=${mapName}`,
      );
      writeFileSync(
        join(dir, mapName),
        JSON.stringify({
          version: 3,
          sources: c.sources,
          names: [],
          // The leading `;` skips generated line 1... there is none to skip:
          // the code is line 1 and the sourceMappingURL comment is line 2.
          mappings: c.mappings,
        }),
      );
    }
    return attributeByProvenance({
      next: root,
      srcs: chunks.map((c) => `/_next/static/chunks/${c.name}`),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The heuristic this row replaces, applied to the same fixture. */
function substringSplit(chunks: Chunk[]) {
  let mapRaw = 0;
  for (const c of chunks) {
    const bytes = `${c.code}\n//# sourceMappingURL=${c.name}.map`;
    if (/maplibre|mapbox-gl/i.test(bytes)) mapRaw += Buffer.byteLength(bytes);
  }
  return mapRaw;
}

/*
 * THE SAME MODULES, TWO LAYOUTS.
 *
 * `M` is map-library code and `A` is application code, byte-for-byte identical
 * between the layouts. Only which chunk they sit in differs — which is exactly
 * what a re-chunk is, and exactly what must not move the answer.
 */
const M = "MAPLIBRE_CODE_".repeat(400); // 5,600 bytes
const A = "APPLICATION_CODE_".repeat(400); // 6,800 bytes

const TOGETHER: Chunk[] = [
  chunk("both.js", [MAPLIBRE, APP], [
    { source: 0, text: M },
    { source: 1, text: A },
  ]),
];

const APART: Chunk[] = [
  chunk("lib.js", [MAPLIBRE], [{ source: 0, text: M }]),
  chunk("app.js", [APP], [{ source: 0, text: A }]),
];

/**
 * Narrow the result to its measured shape, or fail loudly.
 *
 * The return type is a union — measured, or refused with a reason — and that
 * union is the point of the design, so the tests narrow it explicitly rather
 * than casting it away.
 */
function measured(r: ReturnType<typeof attributeByProvenance>) {
  assert.ok(r.available, `expected a measurable fixture: ${String(r.why ?? "")}`);
  return r as {
    available: true;
    chunksWithMaps: number;
    chunksTotal: number;
    total: number;
    mapLibrary: number;
    application: number;
    unmapped: number;
  };
}

/* -- the tests ------------------------------------------------------------- */

test("attribution by provenance is identical across a re-chunk", () => {
  const together = measured(attribute(TOGETHER));
  const apart = measured(attribute(APART));
  assert.equal(
    together.mapLibrary,
    M.length,
    "the map library's own bytes, and only those",
  );
  assert.equal(together.application, A.length, "the application's own bytes");
  assert.equal(
    together.mapLibrary,
    apart.mapLibrary,
    "re-chunking moved the MapLibre attribution — the split is measuring the layout, not the modules",
  );
  assert.equal(
    together.application,
    apart.application,
    "re-chunking moved the application attribution",
  );
});

test("the substring heuristic FAILS the same re-chunk — the control", () => {
  /*
   * Without this, the test above proves only that some number is stable. This
   * is the plant: the old method, on the identical fixtures, moves by the
   * whole application chunk. It is the defect, reproduced and pinned, so
   * nobody restores the heuristic believing it was equivalent.
   */
  const together = substringSplit(TOGETHER);
  const apart = substringSplit(APART);

  assert.notEqual(
    together,
    apart,
    "the substring split was expected to move across a re-chunk and did not — " +
      "if it has been fixed, this control is stale and should be retired",
  );
  assert.ok(
    together > M.length + A.length,
    "co-located, the substring test attributes the application's bytes to MapLibre too",
  );
});

test("every byte lands in exactly one bucket, and the total reconciles", () => {
  const r = measured(attribute(TOGETHER));
  assert.equal(
    r.mapLibrary + r.application + r.unmapped,
    r.total,
    "a split that loses bytes is not a measurement",
  );
  // The sourceMappingURL comment is generated punctuation owned by no module.
  assert.ok(r.unmapped > 0, "the unmapped bucket is real and is reported");
});

test("a chunk with no source map is UNATTRIBUTED, never assumed to be application", () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-attr-"));
  try {
    const dir = join(root, "static", "chunks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mapped.js"), `${M}\n//# sourceMappingURL=mapped.js.map`);
    writeFileSync(
      join(dir, "mapped.js.map"),
      JSON.stringify({
        version: 3,
        sources: [MAPLIBRE],
        names: [],
        mappings: line([{ source: 0, text: M }]).group,
      }),
    );
    writeFileSync(join(dir, "bare.js"), A);

    const r = measured(
      attributeByProvenance({
        next: root,
        srcs: ["/_next/static/chunks/mapped.js", "/_next/static/chunks/bare.js"],
      }),
    );
    assert.equal(r.application, 0, "an unmapped chunk is never credited to application");
    assert.ok(
      r.unmapped >= A.length,
      "an unmapped chunk's bytes are reported as unattributed",
    );
    assert.equal(r.chunksWithMaps, 1);
    assert.equal(r.chunksTotal, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no maps at all REFUSES rather than reporting a zero split", () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-attr-"));
  try {
    const dir = join(root, "static", "chunks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bare.js"), A);
    const r = attributeByProvenance({
      next: root,
      srcs: ["/_next/static/chunks/bare.js"],
    });
    assert.equal(r.available, false, "unmeasured must not read as a measurement");
    assert.match(String(r.why), /WTP_ATTRIBUTION_BUILD/, "and it says how to measure it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("attributeChunk credits a one-field segment to nobody", () => {
  // A segment with only a generated column marks emitted code with no source.
  // Crediting the span to the PREVIOUS module would be the same invention the
  // whole row is about, one level down.
  const text = "AAAABBBB";
  const mappings = [vlq(0) + vlq(0) + vlq(0) + vlq(0), vlq(4)].join(",");
  const { bySource, unmapped } = attributeChunk(text, mappings);
  assert.equal(bySource.get(0), 4, "the mapped run is credited to its source");
  assert.equal(unmapped, 4, "the sourceless run is credited to nobody");
});
