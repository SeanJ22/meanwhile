import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  HEADROOM,
  ceilingCap,
  committedBudget,
  evaluate,
} from "../scripts/check-build-output.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * EVERY REFUSAL DIRECTION, PLANTED AND PROVEN (g17, 2026-08-18, AUD-02 1c).
 *
 * A budget that has never refused is not known to work. This repo has already
 * shipped one of those: the synthetic-run guard asserted that a constant
 * appeared in a source file, and it was green through two live leaks, because
 * appearing in source and reaching the wire are different facts.
 *
 * So the guard here is behavioural. Each test builds a synthetic `.next` tree
 * on disk, asserts the CLEAN tree produces zero failures — the green control,
 * without which "it refused" proves only that it refuses everything — then
 * applies exactly one plant and asserts the refusal names it.
 *
 * The controls are not decoration. A check that refuses unconditionally and a
 * check that refuses nothing are both broken, and only a control tells them
 * apart.
 */

/* -- the fixture ---------------------------------------------------------- */

type Tree = {
  root: string;
  next: string;
  /** Write a trace manifest whose `files` are repo-relative paths. */
  manifest: (key: string, repoFiles: string[]) => void;
  /** Write a repo file the manifests can point at. */
  repoFile: (rel: string, contents: string) => void;
  /** Write a static chunk and return its `/_next/...` src. */
  chunk: (name: string, contents: Buffer | string) => string;
  /** Write the prerendered `/` naming the given srcs. */
  indexHtml: (srcs: string[]) => void;
  /** Make the tree read as a standalone build. */
  standalone: () => void;
};

const trees: string[] = [];

function newTree(): Tree {
  const root = mkdtempSync(join(tmpdir(), "wtp-budget-"));
  trees.push(root);
  const next = join(root, ".next");
  mkdirSync(next, { recursive: true });

  const write = (abs: string, contents: Buffer | string) => {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  };

  return {
    root,
    next,
    manifest(key, repoFiles) {
      const abs = join(next, key);
      const base = dirname(abs);
      write(
        abs,
        JSON.stringify({
          files: repoFiles.map((f) =>
            relative(base, join(root, f)).replace(/\\/g, "/"),
          ),
        }),
      );
    },
    repoFile(rel, contents) {
      write(join(root, rel), contents);
    },
    chunk(name, contents) {
      write(join(next, "static", "chunks", name), contents);
      return `/_next/static/chunks/${name}`;
    },
    indexHtml(srcs) {
      write(
        join(next, "server", "app", "index.html"),
        `<!doctype html><html><body>${srcs
          .map((s) => `<script src="${s}" async></script>`)
          .join("")}</body></html>`,
      );
    },
    standalone() {
      mkdirSync(join(next, "standalone", ".next", "server"), { recursive: true });
    },
  };
}

test.after(() => {
  for (const t of trees) rmSync(t, { recursive: true, force: true });
});

/** A budget with round numbers, so a plant's arithmetic is readable. */
function fixtureBudget() {
  return {
    serverTrace: {
      appManifest: { largestManifestFiles: 100, ceiling: 115 },
      frameworkRuntime: {
        default: { largestManifestFiles: 900, ceiling: 1035 },
        standalone: { largestManifestFiles: 1100, ceiling: 1265 },
      },
    },
    client: {
      initialJsBytes: 100_000,
      initialJsCeiling: 115_000,
      transferBytes: 50_000,
      transferCeiling: 57_500,
    },
  };
}

/**
 * A tree that passes everything, and the base every plant is applied to.
 *
 * Deliberately exercises the paths a plant will break: an app manifest and a
 * framework manifest, a traced repo file, a MapLibre-identifying chunk beside
 * an application chunk, and a prerendered `/` that names both.
 */
function cleanTree() {
  const t = newTree();
  t.repoFile("lib/thing.ts", "export const thing = 1;\n");
  t.manifest("server/app/api/meetings/route.js.nft.json", ["lib/thing.ts"]);
  t.manifest("server/next-server.js.nft.json", ["lib/thing.ts"]);
  // ~40 KB that gzips small, and it says `maplibre` so the split is exercised.
  const map = t.chunk("map.js", `/* maplibre-gl */\n${"a".repeat(40_000)}`);
  const app = t.chunk("app.js", `${"b".repeat(20_000)}`);
  t.indexHtml([map, app]);
  return t;
}

function run(t: Tree, budget = fixtureBudget()) {
  return evaluate({ root: t.root, budget });
}

/** Asserts the control is green, then that the plant refuses with `expected`. */
function planted(
  name: string,
  plant: (t: Tree) => { tree: Tree; budget?: ReturnType<typeof fixtureBudget> },
  expected: RegExp,
) {
  test(name, () => {
    const control = cleanTree();
    const before = run(control);
    assert.deepEqual(
      before.failures,
      [],
      `GREEN CONTROL FAILED — the clean fixture refuses, so this test could not\n` +
        `tell a working guard from one that refuses everything:\n${before.failures.join("\n")}`,
    );

    const { tree, budget } = plant(cleanTree());
    const after = run(tree, budget);
    assert.ok(
      after.failures.length > 0,
      "the plant did not refuse — this refusal direction is not known to work",
    );
    assert.ok(
      after.failures.some((f: string) => expected.test(f)),
      `refused, but for the wrong reason:\n${after.failures.join("\n---\n")}`,
    );
  });
}

/* -- direction 1: nothing was checked at all ------------------------------ */

planted(
  "REFUSES when there are no trace manifests at all",
  () => {
    // A `.next` with no manifests: the artifact is unverified, and unverified
    // is the state R23 existed to end.
    const t = newTree();
    return { tree: t };
  },
  /no trace manifests under \.next/,
);

/* -- direction 2: tests ride along ---------------------------------------- */

planted(
  "REFUSES when a file under tests/ is traced into the artifact",
  (t) => {
    t.repoFile("tests/mirror-code.test.ts", "// a fixture\n");
    t.manifest("server/app/ballot/page.js.nft.json", [
      "lib/thing.ts",
      "tests/mirror-code.test.ts",
    ]);
    return { tree: t };
  },
  /file\(s\) under tests\/ are traced/,
);

/* -- direction 3: a credential shape rides along -------------------------- */

planted(
  "REFUSES when a traced repo file carries a credential-shaped value",
  (t) => {
    // Assembled at runtime rather than written literally: a real key shape in
    // a committed test file is the exact class of thing R23 removed.
    t.repoFile("lib/leaky.ts", `const k = "${"sk-ant-"}${"A".repeat(24)}";\n`);
    t.manifest("server/app/leak/page.js.nft.json", ["lib/leaky.ts"]);
    return { tree: t };
  },
  /credential-shaped value/,
);

/* -- direction 4: budget 1a measured nothing ------------------------------ */

planted(
  "REFUSES when no app route manifest exists, rather than passing an unmeasured 1a",
  () => {
    const t = newTree();
    t.repoFile("lib/thing.ts", "export const thing = 1;\n");
    t.manifest("server/next-server.js.nft.json", ["lib/thing.ts"]);
    const map = t.chunk("map.js", `/* maplibre-gl */\n${"a".repeat(40_000)}`);
    t.indexHtml([map]);
    return { tree: t };
  },
  /no app route trace manifest was found/,
);

/* -- direction 5: an app route's trace explodes (R23's own shape) --------- */

planted(
  "REFUSES when an app trace exceeds its ceiling",
  (t) => {
    const many = Array.from({ length: 200 }, (_, i) => `lib/gen/f${i}.ts`);
    for (const f of many) t.repoFile(f, "export {};\n");
    t.manifest("server/app/ballot/page.js.nft.json", many);
    return { tree: t };
  },
  /app trace cardinality 200 files [^]* exceeds the committed\s+ceiling of 115/,
);

/* -- direction 6: no baseline for the mode that was built ----------------- */

planted(
  "REFUSES when the build mode has no committed framework baseline",
  (t) => {
    t.standalone();
    const budget = fixtureBudget();
    // @ts-expect-error — deleting the standalone baseline is the plant.
    delete budget.serverTrace.frameworkRuntime.standalone;
    return { tree: t, budget };
  },
  /no framework-runtime baseline is committed for standalone mode/,
);

/* -- direction 7: the framework runtime trace grows ----------------------- */

planted(
  "REFUSES when the framework runtime trace exceeds its ceiling for the mode built",
  (t) => {
    const many = Array.from({ length: 1200 }, (_, i) => `lib/gen/n${i}.ts`);
    for (const f of many) t.repoFile(f, "export {};\n");
    t.manifest("server/next-server.js.nft.json", many);
    return { tree: t };
  },
  /framework runtime trace 1200 files [^]*default mode/,
);

/* -- direction 8: budget 2 measured nothing, two ways --------------------- */

planted(
  "REFUSES when / was not prerendered, rather than reading a missing file as zero bytes",
  (t) => {
    rmSync(join(t.next, "server", "app", "index.html"));
    return { tree: t };
  },
  /budget 2 measured nothing/,
);

planted(
  "REFUSES when the prerendered / names no scripts at all",
  (t) => {
    t.indexHtml([]);
    return { tree: t };
  },
  /budget 2 measured nothing/,
);

/* -- direction 9: the reader's initial JavaScript grows ------------------- */

planted(
  "REFUSES when initial JS for / exceeds its ceiling",
  (t) => {
    // Highly compressible, so this trips the RAW ceiling and not the transfer
    // one — the two are separate questions and each needs its own direction.
    const fat = t.chunk("fat.js", "c".repeat(200_000));
    const map = t.chunk("map.js", `/* maplibre-gl */\n${"a".repeat(40_000)}`);
    t.indexHtml([map, fat]);
    return { tree: t };
  },
  /initial JS for \/ is \d+ bytes, over the committed ceiling of 115000/,
);

planted(
  "REFUSES when compressed transfer for / exceeds its ceiling",
  (t) => {
    // Incompressible, so gzip is about the raw size. Sized to break the
    // transfer ceiling (57,500) while staying under the raw one (115,000).
    const noise = t.chunk("noise.js", randomBytes(90_000));
    t.indexHtml([noise]);
    return { tree: t };
  },
  /compressed transfer for \/ is \d+ bytes, over the committed ceiling of 57500/,
);

/* -- direction 10: the page names a chunk that is not there --------------- */

planted(
  "REFUSES when / references a chunk absent from .next",
  (t) => {
    t.indexHtml(["/_next/static/chunks/never-emitted.js"]);
    return { tree: t };
  },
  /chunk\(s\) referenced by the prerendered \/ are absent/,
);

/* -- the clean tree is green, and its measurements are real --------------- */

test("the green control passes, and budget 2 splits MapLibre from application bytes", () => {
  const t = cleanTree();
  const { failures, measurements } = run(t);
  assert.deepEqual(failures, [], failures.join("\n"));
  assert.ok(measurements, "a clean tree measured nothing");
  assert.equal(measurements.mode, "default");
  assert.equal(measurements.worstApp?.files, 1);
  assert.equal(measurements.client?.chunks, 2);
  assert.equal(measurements.client?.missing, 0);
  assert.ok(
    measurements.client!.mapRaw > 0 && measurements.client!.mapRaw < measurements.client!.raw,
    "the MapLibre split collapsed — it is either everything or nothing",
  );
  /*
   * R53 (g18): a tree with no source maps must report the split as an ESTIMATE
   * and say so, not print it as measurement. The fixture builds chunks with no
   * `sourceMappingURL`, which is exactly the deployed build's shape.
   */
  assert.equal(
    measurements.client!.provenance.available,
    false,
    "a tree with no maps must not report a provenance split",
  );
  assert.match(
    String(measurements.client!.provenance.why ?? ""),
    /WTP_ATTRIBUTION_BUILD/,
    "and must say how to measure it properly",
  );
});

test("standalone mode is read off the artifact, not off the environment", () => {
  const t = cleanTree();
  t.standalone();
  const { measurements } = run(t);
  assert.equal(measurements?.mode, "standalone");
});

test("a manifest duplicated under standalone/.next is counted once", () => {
  const t = cleanTree();
  t.standalone();
  const many = Array.from({ length: 5 }, (_, i) => `lib/gen/d${i}.ts`);
  for (const f of many) t.repoFile(f, "export {};\n");
  t.manifest("server/app/dup/page.js.nft.json", many);
  t.manifest("standalone/.next/server/app/dup/page.js.nft.json", many);
  const { measurements } = run(t);
  assert.equal(
    measurements?.worstApp?.key,
    "server/app/dup/page.js.nft.json",
    "the standalone copy was counted as a second manifest",
  );
});

/* -- the committed budget obeys the stated rule --------------------------- */

/**
 * THE RULE IS ENFORCED, NOT MERELY DESCRIBED.
 *
 * Before this, the ceiling of 1300 was a number with no reasoning attached —
 * headroom by choice, which is indistinguishable from headroom bought to make
 * a red check green. `HEADROOM` states the rule once and this test holds every
 * committed ceiling to it. A ceiling TIGHTER than the cap is fine and needs no
 * reason; a looser one cannot have come from anywhere but a number being moved.
 */
test("every committed ceiling is at most the baseline plus the stated headroom", () => {
  const b = committedBudget(ROOT);
  const checks: Array<[string, number, number, number]> = [
    [
      "serverTrace.appManifest",
      b.serverTrace.appManifest.largestManifestFiles,
      b.serverTrace.appManifest.ceiling,
      10,
    ],
    ["client.initialJs", b.client.initialJsBytes, b.client.initialJsCeiling, 10_000],
    ["client.transfer", b.client.transferBytes, b.client.transferCeiling, 10_000],
  ];
  for (const [mode, fw] of Object.entries(b.serverTrace.frameworkRuntime)) {
    if (typeof fw !== "object" || fw === null || !("ceiling" in fw)) continue;
    const runtime = fw as { largestManifestFiles: number; ceiling: number };
    checks.push([
      `serverTrace.frameworkRuntime.${mode}`,
      runtime.largestManifestFiles,
      runtime.ceiling,
      10,
    ]);
  }

  assert.equal(HEADROOM, 0.15, "the headroom rule changed — say so in the file first");
  for (const [name, baseline, ceiling, unit] of checks) {
    const cap = ceilingCap(baseline, unit);
    assert.ok(
      ceiling <= cap,
      `${name}: ceiling ${ceiling} is above the cap of ${cap} for a baseline of ${baseline}.\n` +
        "  A ceiling only moves because a re-measured baseline moved it. Re-measure, commit\n" +
        "  the baseline with what changed recorded as its reason, and derive the ceiling.",
    );
    assert.ok(ceiling >= baseline, `${name}: ceiling ${ceiling} is below its own baseline`);
  }
});

/**
 * The client budget's baseline is the measurement, and it is recorded as
 * having been taken on the build that deploys — ubuntu, standalone mode. A
 * baseline measured somewhere else is how the framework budget was wrong for a
 * day: 927 was real, and it described a build nobody ships.
 */
test("the client baseline records where it was measured", () => {
  const b = committedBudget(ROOT);
  assert.match(
    String(b.client.measuredOn ?? ""),
    /ubuntu/i,
    "client.measuredOn does not name the platform the baseline was taken on",
  );
  assert.match(String(b.client.measuredOn ?? ""), /standalone/i);
});

test("the client split is by provenance, and the gzip split stays retired", () => {
  /*
   * R53 (g18). This test used to assert that MapLibre + application summed to
   * the total, raw AND gzip. Both halves of that were wrong in a way the sum
   * could not see.
   *
   * The RAW figures summed because the substring method attributes every chunk
   * to one side or the other — so they always summed, and they were still
   * wrong: whole chunks were credited to MapLibre for mentioning it, and the
   * figure moved 21,490 bytes across a re-chunk that touched no map code.
   *
   * The GZIP figures summed by construction and meant nothing at all.
   * Compression is not additive: the gzipped size of a subset of a stream is
   * not a share of the whole, because matches reach across module boundaries.
   * A test asserting they sum was asserting arithmetic, not a fact about the
   * build. They are retired rather than recomputed, and this pins that.
   */
  const b = committedBudget(ROOT);

  assert.equal(
    b.client.maplibreTransferBytes,
    undefined,
    "gzip is not splittable by module — this field must not come back",
  );
  assert.equal(b.client.applicationTransferBytes, undefined);
  assert.match(
    String(b.client.splitMethod ?? ""),
    /attribute-client-bytes\.mjs/,
    "the split must name the instrument that produces it",
  );
  assert.match(
    String(b.client.splitMethod ?? ""),
    /reconcile/i,
    "and state that its buckets reconcile to the total",
  );
});
