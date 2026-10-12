import assert from "node:assert/strict";
import test from "node:test";

import {
  KEY_MATRIX,
  PRODUCTION_READER_ORIGINS,
  SMOKE_ORIGIN,
  STAGING_READER_ORIGIN,
  keyIdentityFor,
  refuseSharedKey,
  smokeStyleUrl,
  type DeployContext,
} from "../lib/map/key-matrix.ts";
import { providerOf, MAPTILER } from "../lib/ops/provider-access.ts";
import { PUBLIC_SITE_ORIGIN, STAGING_RENDER_ORIGIN } from "../lib/ops/origins.ts";
import { resolveBasemap } from "../lib/map/style.ts";

const EVERY_CONTEXT: readonly DeployContext[] = [
  "production",
  "branch-deploy:staging",
  "deploy-preview",
  "branch-deploy:other",
  "ci",
  "local",
  "synthetic-provider-smoke",
];

test("every deploy context is served by exactly one key identity", () => {
  const seen = new Map<DeployContext, string>();
  for (const context of EVERY_CONTEXT) {
    const identity = keyIdentityFor(context);
    seen.set(context, identity.name);
  }
  assert.equal(seen.size, EVERY_CONTEXT.length, "a deploy context resolved to no identity");

  /* Every identity is reachable from at least one context. */
  for (const identity of KEY_MATRIX) {
    assert.ok(identity.contexts.length > 0, `${identity.name} is declared but unreachable`);
  }
});

test("no two identities share a deploy context — a key cannot cross environments", () => {
  const claimed = new Map<DeployContext, string[]>();
  for (const identity of KEY_MATRIX) {
    for (const context of identity.contexts) {
      claimed.set(context, [...(claimed.get(context) ?? []), identity.name]);
    }
  }
  const shared = [...claimed.entries()].filter(([, names]) => names.length > 1);
  assert.deepEqual(
    shared,
    [],
    "two identities claim one deploy context, so two keys are reachable from one environment — " +
      "which is how synthetic usage lands in production's number",
  );
});

test("production allows the exact Reader origins and never a wildcard", () => {
  const production = keyIdentityFor("production");
  assert.equal(production.name, "meanwhile-prod-browser");
  assert.deepEqual([...production.allowedOrigins].sort(), [...PRODUCTION_READER_ORIGINS].sort());

  for (const identity of KEY_MATRIX) {
    for (const origin of identity.allowedOrigins) {
      assert.doesNotMatch(
        origin,
        /\*/,
        `${identity.name} allows ${origin} — a wildcard merges test and admin usage into ` +
          "production attribution, which is the ambiguity MAPQ-3 exists to remove",
      );
      assert.doesNotMatch(origin, /^\?|\?$/, "an unknown-origin allowance is never permitted");
      assert.match(origin, /^https?:\/\/[a-z0-9.-]+$/, `${origin} must be an exact origin`);
    }
  }
});

test("staging is one origin, and it is not a production origin", () => {
  const staging = keyIdentityFor("branch-deploy:staging");
  assert.deepEqual(staging.allowedOrigins, [STAGING_READER_ORIGIN]);
  /* The matrix names this repository's own hosts from one place, so the two cannot drift. */
  assert.equal(STAGING_READER_ORIGIN, STAGING_RENDER_ORIGIN);
  assert.ok(PRODUCTION_READER_ORIGINS.includes(PUBLIC_SITE_ORIGIN));
  for (const origin of PRODUCTION_READER_ORIGINS) {
    assert.notEqual(origin, STAGING_READER_ORIGIN);
  }
});

test("the smoke key is restricted to the smoke's own origin and ships nowhere else", () => {
  const smoke = keyIdentityFor("synthetic-provider-smoke");
  assert.equal(smoke.name, "meanwhile-synthetic-provider-smoke");
  assert.deepEqual(smoke.allowedOrigins, [SMOKE_ORIGIN]);
  assert.equal(
    smoke.envVar,
    "WTP_MAPTILER_SMOKE_KEY",
    "the smoke key must live in its own variable — sharing NEXT_PUBLIC_MAPTILER_KEY would ship " +
      "it to the browser as the production or staging key",
  );
  assert.deepEqual(
    smoke.contexts,
    ["synthetic-provider-smoke"],
    "the smoke key must never be reachable from a production or staging build",
  );
  /* The smoke origin is not a public Reader origin, so its traffic is distinguishable in the provider's numbers. */
  for (const origin of [...PRODUCTION_READER_ORIGINS, STAGING_READER_ORIGIN]) {
    assert.notEqual(SMOKE_ORIGIN, origin);
  }
});

test("local, CI and preview deploys carry no browser key at all", () => {
  for (const context of ["local", "ci", "deploy-preview", "branch-deploy:other"] as DeployContext[]) {
    const identity = keyIdentityFor(context);
    assert.equal(identity.name, "none", `${context} must carry no browser key`);
    assert.equal(identity.envVar, null);
    assert.deepEqual(identity.allowedOrigins, []);
  }
});

test("with no key configured the app already draws its fallback, which is the expected local picture", () => {
  const previous = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  delete process.env.NEXT_PUBLIC_MAPTILER_KEY;
  try {
    assert.equal(
      resolveBasemap("dark"),
      null,
      "no key must mean no provider — never a substituted one",
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_MAPTILER_KEY;
    else process.env.NEXT_PUBLIC_MAPTILER_KEY = previous;
  }
});

test("the smoke refuses to spend the production key", () => {
  const same = refuseSharedKey({ smokeKey: "SAMEVALUE", productionKey: "SAMEVALUE" });
  assert.equal(same.ok, false);
  assert.match(same.ok === false ? same.says : "", /REFUSING/);
  assert.doesNotMatch(
    same.ok === false ? same.says : "",
    /SAMEVALUE/,
    "a refusal must never quote the value it refused",
  );

  const missing = refuseSharedKey({ smokeKey: undefined, productionKey: "P" });
  assert.equal(missing.ok, false);
  assert.match(missing.ok === false ? missing.says : "", /NEEDS OWNER/);

  assert.deepEqual(refuseSharedKey({ smokeKey: "SMOKE", productionKey: "PROD" }), { ok: true });
  assert.deepEqual(refuseSharedKey({ smokeKey: "SMOKE", productionKey: undefined }), { ok: true });
});

test("the smoke asks the real provider, on the URL shape the app builds", () => {
  const url = smokeStyleUrl("basic-v2-dark", "SMOKEKEY");
  assert.equal(providerOf(url), MAPTILER, "the smoke must exercise the real provider host");

  /* The two constructors agree on everything except the key's variable, so the smoke tests the Reader's URL shape. */
  const previous = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  process.env.NEXT_PUBLIC_MAPTILER_KEY = "SMOKEKEY";
  try {
    assert.equal(resolveBasemap("dark")?.styleUrl, url);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_MAPTILER_KEY;
    else process.env.NEXT_PUBLIC_MAPTILER_KEY = previous;
  }
});
