import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HANDOFF = readFileSync(join(ROOT, "scripts", "handoff.mjs"), "utf8");

/**
 * The deploy gate, guarded (2026-08-16).
 *
 * `main@705f73b` merged green and production kept serving the previous build
 * for an hour, because Netlify's build failed type-check on a walk SCRIPT the
 * session had written after its last `pnpm build`. The gate that stops it
 * recurring is `buildGate()` in `scripts/handoff.mjs`.
 *
 * A source scan rather than an execution test, deliberately: actually running
 * the gate means running a full production build inside the unit suite, which
 * would take `pnpm test` from three seconds to two minutes and would be
 * testing Next rather than us. What can silently rot is the WIRING — someone
 * moving the call, or adding a skip flag — and that is exactly what a scan
 * catches. The gate's own behaviour was proven by running it against a
 * deliberately broken tree on the day it was written; that is recorded in
 * state.md §31 rather than re-run here.
 */

test("the ship path runs a build gate before it pushes anything", () => {
  assert.match(
    HANDOFF,
    /function buildGate\(\)/,
    "buildGate() is gone — the deploy gate has been removed",
  );

  const shipAt = HANDOFF.indexOf("function ship()");
  assert.ok(shipAt > 0, "ship() is gone");
  const shipBody = HANDOFF.slice(shipAt);

  const gateCall = shipBody.indexOf("buildGate()");
  const firstPush = shipBody.indexOf('"push"');
  assert.ok(gateCall > 0, "ship() no longer calls buildGate()");
  assert.ok(
    firstPush > 0 && gateCall < firstPush,
    "buildGate() must run BEFORE the first push — a gate after the push has already lost",
  );
  assert.match(
    shipBody.slice(gateCall - 40, gateCall + 40),
    /if \(!buildGate\(\)\) return;/,
    "the gate's result must be acted on, not merely called",
  );
});

test("the gate runs the command Netlify runs, and has no way to be skipped", () => {
  const gateAt = HANDOFF.indexOf("function buildGate()");
  const gate = HANDOFF.slice(gateAt, HANDOFF.indexOf("function ship()"));

  // The same command as `netlify.toml`'s `corepack pnpm run build`. A `tsc`
  // run is NOT equivalent: tsconfig includes `.next/types/**/*.ts`, which
  // Next generates during a build, so a bare tsc checks whatever those files
  // said last time.
  // Matched on the command TEXT rather than an args array: the gate spawns
  // through a shell with one literal string, because `execFileSync` cannot
  // run pnpm's `.cmd` shim on Windows at all. This assertion caught that
  // change the moment it was made, which is the assertion working.
  assert.match(
    gate,
    /execSync\(\s*"pnpm run build"/,
    "the gate must run `pnpm run build` — the command Netlify runs",
  );
  const netlify = readFileSync(join(ROOT, "netlify.toml"), "utf8");
  assert.match(
    netlify,
    /pnpm run build/,
    "netlify.toml no longer runs `pnpm run build` — the gate is now checking something else",
  );

  // `"incremental": true` is on and Netlify starts from a clean checkout.
  assert.match(
    gate,
    /tsconfig\.tsbuildinfo/,
    "the gate must clear the incremental build info so the check is fresh",
  );

  // An escape hatch on a gate is how the gate stops meaning anything.
  assert.ok(
    !/--skip-build|--no-build|SKIP_BUILD/.test(HANDOFF),
    "a skip flag was added to the deploy gate",
  );
});
