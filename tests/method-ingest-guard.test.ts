import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { MethodKnowledge } from "../lib/method/knowledge.ts";

/**
 * **NO SUCCESSFUL COMMAND MAY SILENTLY ERASE LEARNED INVESTIGATIVE KNOWLEDGE.**
 * (NH254, 2026-08-27.)
 *
 * `pnpm method:ingest` rebuilt `data/method/knowledge.json` from the legacy
 * branch manifest and wrote it over whatever was there. One run took the store
 * from **88 routes at method version 27 down to 62 at version 0** — deleting
 * every route learned since, with its recorded outcomes and earned portability
 * — and printed `routes ingested 62` and `method:check PASSED` while doing it.
 *
 * It is worse than an ordinary overwrite because the method version is what
 * convergence records are stamped with (RULING 179): resetting it to 0 silently
 * re-validates every prior `CONVERGED_AS_OF` claim in the repository.
 *
 * The store was restored from git before anything was committed. This is the
 * guard that means the next session does not have to notice.
 */

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

function store(): MethodKnowledge {
  return JSON.parse(readFileSync(STORE, "utf8")) as MethodKnowledge;
}

test("the store holds more than the legacy manifest, so this guard is not vacuous", () => {
  const k = store();
  assert.ok(
    k.version > 0,
    `method version is ${k.version} — at 0 there is nothing learned to destroy and this file proves nothing`,
  );
  assert.ok(k.routes.length > 62, `only ${k.routes.length} routes — see above`);
});

test("PLANTED: method:ingest REFUSES rather than destroying learned routes", () => {
  /*
   * The real command, run for real, against the real store. Anything less
   * would be testing a copy of the rule rather than the rule.
   */
  const before = store();

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "scripts/method-ingest.mts")],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 },
    );
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    exitCode = e.status ?? 1;
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }

  assert.notEqual(exitCode, 0, "method:ingest exited zero having destroyed the store");
  assert.match(`${stdout}${stderr}`, /REFUSED/, "the refusal must say so in words");
  assert.match(
    `${stdout}${stderr}`,
    /routes lost\s+\d+/,
    "the refusal must NAME how much would be lost, not just decline",
  );
  assert.match(
    `${stdout}${stderr}`,
    /--reset-to-manifest/,
    "a genuine re-bootstrap must remain possible, and the refusal must say how",
  );

  /* AND THE STORE IS UNTOUCHED. This is the assertion that matters; a refusal
   * that still wrote would be worse than no refusal. */
  const after = store();
  assert.equal(after.version, before.version, "the method version moved during a refusal");
  assert.equal(after.routes.length, before.routes.length, "routes changed during a refusal");
  assert.deepEqual(
    after.routes.map((r) => r.id).sort(),
    before.routes.map((r) => r.id).sort(),
    "the route set changed during a refusal",
  );
});

test("the escape hatch is explicit, and the additive path is named", () => {
  /*
   * A guard with no way past it gets deleted the first time somebody genuinely
   * needs to re-bootstrap. The flag exists so that is a typed decision rather
   * than a surprise — and the refusal points at the additive path, because
   * wanting to ADD a route is the case that reaches for this command wrongly.
   */
  const src = readFileSync(join(ROOT, "scripts/method-ingest.mts"), "utf8");
  assert.match(src, /--reset-to-manifest/, "no deliberate re-bootstrap path exists");
  assert.match(src, /runLearnBatch/, "the refusal must point at the additive path");
  assert.ok(
    !/^void readFileSync;/m.test(src),
    "the dead `void readFileSync` marked where reading the store was intended and never done",
  );
});
