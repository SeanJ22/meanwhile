import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PRODUCT_NAME, titleFor } from "../lib/brand.ts";

const ROOT = join(import.meta.dirname, "..");
const OLD_NAME = /We[ -]the[ -]People/i;

/**
 * B01 interim, 2026-08-17 — the name lives in one place.
 *
 * The rename was a task rather than an edit because "We the People" was
 * written out longhand in eight files and twelve places. Interim means it is
 * expected to move again, so what these guards protect is not the string but
 * the SHAPE: one constant, no literals on reader surfaces, and the repo's own
 * off-site identity untouched.
 */

/**
 * Every file a reader's browser can be served from.
 *
 * `app/api/` is deliberately NOT one. Those routes send OUTBOUND requests to
 * other people's servers, and `app/api/geocode/route.ts` identifies this
 * product to the Census geocoder with `we-the-people-civic-app/0.1` — an
 * off-site identifier, on the same footing as the repo URL in the source
 * adapters' User-Agents, and covered by the last test in this file rather than
 * this one. Renaming it would change who we say we are to a public body.
 */
function readerSurfaces(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path === join(ROOT, "app", "api")) continue;
        walk(path);
      } else if (/\.(tsx|ts)$/.test(entry.name)) out.push(path);
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "components"));
  walk(join(ROOT, "lib", "calendar"));
  return out;
}

test("the product name is a constant, and the title helper uses it", () => {
  assert.equal(PRODUCT_NAME, "Meanwhile");
  assert.equal(titleFor("What this site collects"), "What this site collects — Meanwhile");
  assert.ok(titleFor("x").endsWith(PRODUCT_NAME), "the helper must not hardcode the name");
});

test("no reader surface carries the old name", () => {
  const offenders: string[] = [];
  for (const path of readerSurfaces()) {
    const source = readFileSync(path, "utf8");
    // Comments are stripped: an explanation of the rename is not a breach of
    // it, and picks-card.tsx's header quotes what the card used to say.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    if (OLD_NAME.test(code)) offenders.push(path.slice(ROOT.length + 1));
  }
  assert.deepEqual(
    offenders,
    [],
    `the old product name is still rendered by:\n  ${offenders.join("\n  ")}\n` +
      `Use PRODUCT_NAME from lib/brand.ts.`,
  );
});

test("no reader surface hardcodes the new name either", () => {
  // The failure that would undo this the moment the name moves again: a
  // literal "Meanwhile" typed into a component because it was quicker.
  const offenders: string[] = [];
  for (const path of readerSurfaces()) {
    if (path.endsWith(join("lib", "brand.ts"))) continue;
    const source = readFileSync(path, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    if (new RegExp(`["'\`>]\\s*${PRODUCT_NAME}\\b`).test(code)) {
      offenders.push(path.slice(ROOT.length + 1));
    }
  }
  assert.deepEqual(offenders, [], `hardcoded product name in:\n  ${offenders.join("\n  ")}`);
});

test("the repo's off-site identity is deliberately unchanged", () => {
  // Renaming the repository would break every URL pointing at it, and the
  // outbound User-Agent this product sends to public bodies carries that URL
  // as its contact route. A body with our identifier in last week's logs must
  // find the same identifier this week. So these keep the old token ON PURPOSE
  // and this test is the record of that decision, not an oversight.
  for (const path of [
    join("lib", "sources", "http.ts"),
    join("lib", "sources", "congress", "index.ts"),
    join("lib", "sources", "legistar", "client.ts"),
    join("lib", "sources", "plural", "index.ts"),
    // The geocoder's outbound User-Agent, same reasoning.
    join("app", "api", "geocode", "route.ts"),
  ]) {
    const source = readFileSync(join(ROOT, path), "utf8");
    assert.match(
      source,
      /we-the-people/,
      `${path} lost the repo-derived User-Agent token — that identifier is what a public body ` +
        `has in its logs, and it is not the display name`,
    );
  }
});
