/**
 * **A STEP THAT REPORTS SUCCESS IS ASKED WHETHER IT DID THE THING.**
 * (`NH106`, 2026-08-23. RULING 113.)
 *
 * ## What this exists for
 *
 * `main` went red at `3d453fd` with four failures and one cause:
 * `NO CHROMIUM INSTALLED. Wanted build 1234; searched /home/runner/.cache/ms-playwright`.
 * The workflow step before it — *Install the browser the suite needs* —
 * reported **success in 27 seconds**, and its own log said
 *
 * ```
 * Chrome for Testing 151.0.7922.34 (playwright chromium v1234) downloaded to
 *   /home/runner/.cache/ms-playwright/chromium-1234
 * ```
 *
 * The install worked. The install landed in exactly the directory the suite
 * searched. What failed was `lib/ops/chromium-pin.ts`, which looked for the
 * binary at the LEGACY `chrome-linux/chrome` path while Chrome for Testing
 * puts it at `chrome-linux64/chrome`.
 *
 * ## Why a separate step and not a better test
 *
 * The defect was found eighty seconds later, inside four unrelated tests, in a
 * job that had already run a 2,000-line suite. The information needed to name
 * it was available the instant the install step exited. **Where a step's
 * product can be observed, it is observed at the step** — so this runs
 * immediately after the install, fails there, and prints the root it searched,
 * the build directories it found, and what is inside each one.
 *
 * That last part is the bit that would have saved the session: the old failure
 * said "NO CHROMIUM INSTALLED" about a directory containing a Chromium, which
 * points every reader at the installer.
 *
 * ## What it must never become
 *
 * A step that passes when there is no browser. `scripts/browser.mts` refuses
 * to launch without one and that refusal is the guard; this only moves the
 * discovery earlier. There is no skip flag and no tolerated-absence path.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

import {
  EXPECTED_CHROMIUM_REVISION,
  browsersRoot,
  describeChromium,
  resolveChromium,
} from "../lib/ops/chromium-pin.ts";

const root = browsersRoot();
const resolved = resolveChromium();

console.log(`browsers root      : ${root}`);
console.log(`wanted build       : ${EXPECTED_CHROMIUM_REVISION}`);
console.log(`platform           : ${process.platform}`);

/* Printed whatever the verdict, because the listing is what makes a failure
 * diagnosable without a second CI round trip. */
let entries: string[] = [];
try {
  entries = readdirSync(root);
} catch {
  console.log("browsers root      : UNREADABLE — nothing has been installed here");
}
for (const entry of entries) {
  if (!entry.startsWith("chromium")) continue;
  let inner: string[] = [];
  try {
    inner = readdirSync(join(root, entry));
  } catch {
    /* Listed for the reader either way; an unreadable child is itself news. */
  }
  console.log(`  ${entry}/       : ${inner.join(", ") || "(empty or unreadable)"}`);
}

/*
 * PLAYWRIGHT'S OWN ANSWER, AND THE DRIFT CHECK BETWEEN IT AND OURS.
 *
 * `chromium.executablePath()` is the same resolution a launch performs, so it
 * is the authority. Ours has to agree with it. The two agreed
 * on the DIRECTORY and disagreed on the binary inside it for as long as this
 * pin has existed, and nothing was comparing them — which is why a green
 * install step and a red suite could coexist.
 */
const authoritative = chromium.executablePath();
console.log(`playwright says    : ${authoritative}`);
console.log(`this repo resolves : ${describeChromium(resolved)}`);

if (resolved.kind === "ABSENT") {
  console.error("");
  console.error(describeChromium(resolved));
  console.error(
    "The install step above reported success. Either it did not install what it said it did, " +
      "or lib/ops/chromium-pin.ts cannot read what it installed. The listing above says which.",
  );
  process.exit(1);
}

/*
 * The comparison is only meaningful for `EXPECTED`. A `SUBSTITUTED` resolution
 * is the deliberate case where the pinned build is ABSENT and another one is
 * launched by explicit path, so the two SHOULD differ — and `browser.mts`
 * prints that substitution rather than absorbing it. Asserting equality there
 * would turn a working fallback into a failure.
 */
if (resolved.kind === "EXPECTED" && resolved.executablePath !== authoritative) {
  console.error("");
  console.error("BROWSER RESOLUTION DRIFT.");
  console.error(`  playwright will launch : ${authoritative}`);
  console.error(`  this repo resolved     : ${resolved.executablePath}`);
  console.error(
    "These must be the same file. When they are not, every guard written against the resolver " +
      "is describing a different browser from the one the suite actually drives.",
  );
  process.exit(1);
}

if (resolved.kind === "SUBSTITUTED") {
  console.warn("");
  console.warn(
    `The pinned build ${EXPECTED_CHROMIUM_REVISION} is NOT installed. Launching ${resolved.revision} ` +
      "by explicit path. This is a stated substitution, not a pass for the pinned build.",
  );
}

console.log("");
console.log(`OK — ${describeChromium(resolved)}`);
