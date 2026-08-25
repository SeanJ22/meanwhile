/**
 * **`NS15` — a surface whose store is missing must refuse loudly.**
 *
 * Speak Your Mind shipped live on production with its table missing. The surface
 * rendered, the route answered, every insert failed, the route caught the error,
 * and the page carried on as though the words had been kept. A reader typed
 * something they meant and this product dropped it silently.
 *
 * The decision is a PURE function over the tables a server holds, which is what
 * lets it be tested here rather than only against a live database. A check that
 * only a connection can exercise is a check nothing runs, and nothing running is
 * how `NS15` happened — `pnpm db:check` would have caught it and nobody fired
 * it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { SERVING_SURFACES, brokenSurfaces, servingTables } from "../lib/db/serving-surfaces.ts";

const ROOT = join(import.meta.dirname, "..");

describe("NS15 — every serving surface is checked against its store", () => {
  it("catches the ACTUAL failure: speak_your_mind gone, and names what a reader gets", () => {
    /*
     * The instrument shown catching the real instance (RULING 110). These are
     * the tables production held on the morning of 2026-08-24 — everything
     * except the two the unapplied migrations would have created.
     */
    const asItWas = servingTables().filter((t) => t !== "speak_your_mind");
    const broken = brokenSurfaces(asItWas);

    assert.equal(broken.length, 1, "exactly one surface loses its store when speak_your_mind is gone");
    assert.equal(broken[0].surface.id, "speak-your-mind");
    assert.deepEqual(broken[0].missing, ["speak_your_mind"]);
    assert.equal(
      broken[0].surface.effect,
      "ACCEPTS_AND_DROPS",
      "the severity that makes this the worst kind of failure must be recorded, not inferred",
    );
    assert.match(
      broken[0].surface.reader,
      /Speak Your Mind/i,
      "the failure has to name where a READER meets it, not only the table",
    );
  });

  it("a whole database says nothing is broken", () => {
    assert.deepEqual(brokenSurfaces(servingTables()), []);
  });

  it("worst first — a surface that ACCEPTS AND DROPS is reported above one that renders empty", () => {
    /*
     * A run printing six lines must put the one that loses a reader's words at
     * the top. Ordering is part of the message, not a nicety.
     */
    const broken = brokenSurfaces([]);
    assert.ok(broken.length >= 3, "an empty database breaks every declared surface");
    assert.equal(broken[0].surface.effect, "ACCEPTS_AND_DROPS");
    assert.equal(broken[broken.length - 1].surface.effect, "RENDERS_EMPTY");
  });

  it("every table a surface declares is a table the schema actually creates", () => {
    /*
     * The direction that would make this check pass by mistake. A declaration
     * naming a table that does not exist would report BROKEN against every
     * healthy database, and the fix somebody would reach for is deleting the
     * entry — which is the guard being disarmed by its own false alarm.
     */
    const schema = readFileSync(join(ROOT, "lib", "db", "schema.ts"), "utf8");
    const declared = [...schema.matchAll(/pgTable\(\s*\n?\s*"([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(declared.length >= 10, `the schema sweep found only ${declared.length} tables`);
    const unknown = servingTables().filter((t) => !declared.includes(t));
    assert.deepEqual(unknown, [], "a serving surface names a table the schema does not create");
  });

  it("every surface names the code that serves it, so a failure points somewhere", () => {
    for (const s of SERVING_SURFACES) {
      assert.ok(s.servedBy.length > 0, `${s.id} names no code`);
      assert.ok(s.tables.length > 0, `${s.id} names no table`);
      assert.ok(s.reader.length > 20, `${s.id} does not say where a reader meets it`);
    }
  });
});
