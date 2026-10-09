import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PRODUCT_NAME, titleFor } from "../lib/brand.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { fetchBodies } from "../lib/sources/legistar/client.ts";

const ROOT = join(import.meta.dirname, "..");
const OLD_NAME = /We[ -]the[ -]People/i;

/** The product name lives in one constant; no literal appears on reader surfaces, and the repo's off-site identity is untouched. */

/** Every file a reader's browser can be served from. app/api/ is not one: its outbound User-Agent is an off-site identifier, covered by the last tests. */
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
  // The outbound User-Agent carries the repo URL as its contact route, so it keeps the old token on purpose: a public body must find the same identifier in its logs.
  /* The token lives in one home that the adapters import, so the call sites cannot drift. */
  for (const path of [
    join("lib", "sources", "http.ts"),
    // The outbound User-Agent both geocoder-calling routes send.
    join("lib", "geo", "outbound-agent.ts"),
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

test("Legistar and the shared known-release transport send the repo-derived token", async () => {
  const requests: { url: string; userAgent: string | null }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), userAgent: new Headers(init?.headers).get("user-agent") });
    return new Response("[]", { headers: { "content-type": "application/json" } });
  };
  await fetchBodies("fixture", { fetchImpl });
  await acquireKnownRelease({
    sourceId: "plural-openstates", releaseId: "current", parserVersion: "plural-roster/2",
    url: "https://publisher.example/people.json", signal: AbortSignal.timeout(10_000),
    maxBytes: 1024, checkAfterMs: 86_400_000, fetchImpl,
    store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks,
  });
  assert.equal(requests.length, 2, "both actual request paths must be exercised");
  for (const request of requests) {
    assert.equal(request.userAgent, sourceUserAgent(), `${request.url} must send the shared source identity`);
    assert.match(request.userAgent!, /we-the-people/);
  }
});
