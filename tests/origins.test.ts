import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ADMIN_ORIGIN,
  LEGACY_NETLIFY_ORIGIN,
  NETLIFY_SITE_ID_DEFAULT,
  ORIGINS,
  PUBLIC_SITE_ORIGIN,
  STAGING_RENDER_ORIGIN,
  hostOf,
  isProductionOrigin,
  originRole,
} from "../lib/ops/origins.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the three origins are three distinct hosts", () => {
  const hosts = [PUBLIC_SITE_ORIGIN, STAGING_RENDER_ORIGIN, ADMIN_ORIGIN].map(
    hostOf,
  );
  assert.equal(new Set(hosts).size, 3, `three roles, three hosts: ${hosts}`);
  assert.equal(hostOf(PUBLIC_SITE_ORIGIN), "meanwhileusa.com");
  assert.equal(hostOf(STAGING_RENDER_ORIGIN), "test.meanwhileusa.com");
  assert.equal(hostOf(ADMIN_ORIGIN), "admin.meanwhileusa.com");
  for (const origin of Object.values(ORIGINS)) {
    assert.match(origin, /^https:\/\//, "every origin is https");
    assert.ok(!origin.endsWith("/"), "no trailing slash");
  }
});

test("the legacy host is NOT one of ours", () => {
  // The Netlify default subdomain still answers, so it must not classify as production.
  assert.equal(originRole(LEGACY_NETLIFY_ORIGIN), null);
  assert.equal(isProductionOrigin(LEGACY_NETLIFY_ORIGIN + "/api/build"), false);
  assert.equal(isProductionOrigin(PUBLIC_SITE_ORIGIN + "/api/build"), true);
  assert.equal(isProductionOrigin(STAGING_RENDER_ORIGIN + "/api/build"), false);
  assert.equal(originRole(ADMIN_ORIGIN + "/x"), "admin");
  assert.equal(originRole("not a url"), null);
  assert.equal(originRole("https://example.com/"), null);
});

test("the Netlify site id is kept apart from the public origin", () => {
  // The deploy-record reader asks the API about the site id; asking about the public host returns 404.
  assert.equal(NETLIFY_SITE_ID_DEFAULT, "sparkwtp.netlify.app");
  assert.notEqual(NETLIFY_SITE_ID_DEFAULT, hostOf(PUBLIC_SITE_ORIGIN));
});

/** Where the production host may appear as a literal, and why. Each entry is a fact about that file. */
const LITERAL_ALLOWED = new Map<string, string>([
  [
    "lib/ops/origins.ts",
    "the declaration itself — this is where the fact lives",
  ],
  [
    "netlify.toml",
    "the platform redirect config, read by Netlify and not by our code",
  ],
  [
    ".github/workflows/build-check.yml",
    "a comment naming the endpoint a human would curl",
  ],
  [
    ".github/workflows/post-deploy-integrity.yml",
    "a comment naming the endpoint a human would curl",
  ],
  ["tests/origins.test.ts", "this file asserts the host's value"],
  [
    "tests/fixtures/ui-01-tusd-reader-promotion.json",
    "recordedFrom retains the actual source URL of the captured production response, never a runtime call site",
  ],
  [
    "lib/control-plane/admin-google.ts",
    // An enrolled identity is an email address, not an origin, so it is not derived from PUBLIC_SITE_ORIGIN.
    "the enrolled owner address — an identity, never a call site",
  ],
]);

/**
 * Allowlisted files may hold prose naming the host, never a bare origin literal (a call site):
 *
 *     "https://meanwhileusa.com"          <- a call site. Refused, allowlisted or not.
 *     "…deploys to meanwhileusa.com. …"   <- prose. Allowed.
 */
const BARE_ORIGIN_LITERAL = /(["'`])https:\/\/(?:[a-z]+\.)?meanwhileusa\.com\/?\1/g;

/** Source trees the sweep covers. Docs and recorded data are history, not code. */
const SWEPT = ["app", "components", "lib", "scripts", "tests", "hooks", "netlify"];

function gitGrepFiles(pattern: string, paths: string[]): string[] {
  try {
    const out = execFileSync(
      "git",
      ["grep", "-l", "-a", "--untracked", pattern, "--", ...paths],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return out.trim().split("\n").filter(Boolean);
  } catch (err) {
    // git grep exits 1 with no output when nothing matches.
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1 && !e.stdout?.trim()) return [];
    throw err;
  }
}

test("the production host is not hardcoded outside the origins module", () => {
  const offenders = gitGrepFiles("meanwhileusa\\.com", [
    ...SWEPT,
    "netlify.toml",
    "next.config.ts",
    ".github",
  ]).filter((f) => !LITERAL_ALLOWED.has(f.replace(/\\/g, "/")));

  assert.deepEqual(
    offenders,
    [],
    "import PUBLIC_SITE_ORIGIN from lib/ops/origins.ts instead of writing the host again:\n  " +
      offenders.join("\n  "),
  );
});

test("an allowlisted file holds PROSE, never a bare origin literal", () => {
  const offenders: string[] = [];
  for (const file of LITERAL_ALLOWED.keys()) {
    if (file === "lib/ops/origins.ts") continue; // the declaration itself
    if (file === "tests/origins.test.ts") continue; // this file asserts the value
    if (file === "netlify.toml") continue; // platform config, read by Netlify
    let src: string;
    try {
      src = readFileSync(join(ROOT, file), "utf8");
    } catch {
      offenders.push(`${file} is allowlisted and does not exist — stale entry`);
      continue;
    }
    for (const m of src.matchAll(BARE_ORIGIN_LITERAL)) {
      offenders.push(`${file} carries the bare origin literal ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "an allowlist entry covers prose, not a call site:\n  " + offenders.join("\n  "),
  );
});

test("the legacy host survives only as the site id and the redirect", () => {
  const allowed = new Set([
    "lib/ops/origins.ts",
    "netlify.toml",
    "scripts/deploy-live.mjs",
    "tests/origins.test.ts",
  ]);
  const offenders = gitGrepFiles("sparkwtp", [
    ...SWEPT,
    "netlify.toml",
    "next.config.ts",
    ".github",
  ]).filter((f) => !allowed.has(f.replace(/\\/g, "/")));

  assert.deepEqual(
    offenders,
    [],
    "the legacy host is not a target for new work:\n  " + offenders.join("\n  "),
  );
});

test("netlify.toml forwards the legacy host with a 301", () => {
  const toml = readFileSync(join(ROOT, "netlify.toml"), "utf8");
  assert.ok(
    toml.includes(`from = "${LEGACY_NETLIFY_ORIGIN}/*"`),
    "the legacy host is redirected by full-URL match, so previews are untouched",
  );
  assert.ok(toml.includes(`to = "${PUBLIC_SITE_ORIGIN}/:splat"`));
  assert.ok(toml.includes("status = 301"));
  assert.ok(toml.includes("force = true"));
});
