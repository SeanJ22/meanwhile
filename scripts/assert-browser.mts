/**
 * Asserts, immediately after the browser install step, that the pinned
 * Chromium is where the suite will look, and prints the root it searched, the
 * build directories it found and what is inside each, so a failure is
 * diagnosable at the step rather than later inside unrelated tests.
 *
 * It has no skip flag and no tolerated-absence path; `scripts/browser.mts`
 * still refuses to launch without a browser.
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
 * Playwright's own `chromium.executablePath()` is the same resolution a launch
 * performs, so it is the authority, and the pin must agree with it on the
 * binary, not only the directory.
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
 * The comparison applies only to `EXPECTED`. `SUBSTITUTED` is the deliberate
 * case where the pinned build is absent and another is launched by explicit
 * path, so the two should differ.
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
