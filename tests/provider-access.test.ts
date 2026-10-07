import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BLOCKED_BY_DEFAULT,
  DEFAULT_PROVIDER_CEILING,
  MAPTILER,
  MAPTILER_HOSTS,
  MAX_PROVIDER_CEILING,
  PROVIDER_ACCESS_VAR,
  PROVIDER_CEILING_VAR,
  decideProviderRequest,
  describeLedger,
  newProviderLedger,
  providerHostOf,
  providerOf,
  resolveProviderPolicy,
} from "../lib/ops/provider-access.ts";
import { THIRD_PARTY_HOSTS } from "../lib/ops/origin-confinement.ts";

/**
 * The map-tile quota barrier, asked of every named host, scheme, both gates, the ceiling, and lookalike hostnames a
 * substring match would get wrong. `tests/maptiler-barrier.test.ts` proves a real browser obeys it.
 */

const ALLOWED = { [PROVIDER_ACCESS_VAR]: MAPTILER } as const;

test("every named MapTiler host is a provider host, and is blocked by default", () => {
  /* The denominator, stated. */
  assert.ok(MAPTILER_HOSTS.length >= 2, "the host list has collapsed");
  assert.ok(
    MAPTILER_HOSTS.includes("api.maptiler.com"),
    "api.maptiler.com is the style host — it is the one that spends the tile allowance",
  );
  assert.ok(
    MAPTILER_HOSTS.includes("tiles.maptiler.com"),
    "tiles.maptiler.com is the tile host named in the brief",
  );

  for (const host of MAPTILER_HOSTS) {
    for (const url of [`https://${host}/`, `https://${host}/maps/basic-v2-dark/style.json?key=abc`]) {
      assert.equal(providerOf(url), MAPTILER, `${url} must be recognised as MapTiler`);
      const decision = decideProviderRequest(url, BLOCKED_BY_DEFAULT, 0);
      assert.equal(decision.verdict, "BLOCKED_BY_DEFAULT", `${url} must be blocked by default`);
      assert.equal(decision.provider, MAPTILER);
    }
  }
});

test("a subdomain nobody has added yet is blocked the day it appears", () => {
  /* The matcher is the registrable domain, so an unseen host is blocked on arrival. */
  for (const host of ["maptiler.com", "cdn.maptiler.com", "eu-central-1.tiles.maptiler.com"]) {
    assert.equal(providerOf(`https://${host}/x`), MAPTILER, `${host} must match`);
  }
});

test("a lookalike hostname is somebody else's host", () => {
  for (const host of [
    "maptiler.com.example.net",
    "notmaptiler.com",
    "maptiler.example.com",
    "api.maptiler.co",
  ]) {
    assert.equal(providerOf(`https://${host}/x`), null, `${host} must NOT be treated as MapTiler`);
  }
});

test("only http and https can reach a provider; everything else is not a provider host", () => {
  for (const url of [
    "data:text/html,<p>hi</p>",
    "blob:https://api.maptiler.com/abc",
    "about:blank",
    "chrome-error://chromewebdata/",
    "not a url at all",
    "",
  ]) {
    assert.equal(providerOf(url), null, `${url} cannot carry a request to a provider`);
  }
});

test("every OTHER third party this product's pages reach is untouched by the barrier", () => {
  // The barrier bounds one provider's quota and is not a general egress block: every other third-party host in
  // `lib/ops/origin-confinement.ts` must not match.
  const matched: string[] = [];
  for (const host of THIRD_PARTY_HOSTS) {
    if (providerOf(host) !== null) matched.push(host);
  }
  assert.deepEqual(
    matched.sort(),
    ["https://api.maptiler.com", "https://tiles.maptiler.com"],
    "the barrier must bound MapTiler and nothing else",
  );
  assert.ok(THIRD_PARTY_HOSTS.length >= 10, "the third-party denominator shrank");
});

test("both gates are required, and neither alone opens the door", () => {
  // Neither.
  assert.equal(resolveProviderPolicy({}).mode, "BLOCKED");
  assert.equal(resolveProviderPolicy({ requested: null, env: {} }).mode, "BLOCKED");

  // The environment alone: a shell that once exported the variable must not inherit the ability to spend.
  assert.equal(
    resolveProviderPolicy({ requested: null, env: ALLOWED }).mode,
    "BLOCKED",
    `${PROVIDER_ACCESS_VAR} alone must not unblock a run that never asked — that is how a ` +
      "broad visual sweep would silently inherit the mode",
  );

  // The call site alone, named as its own refusal.
  const asked = resolveProviderPolicy({ requested: MAPTILER, env: {} });
  assert.equal(asked.mode, "REFUSED_NOT_OPTED_IN");
  assert.equal(asked.ceiling, 0);
  assert.match(asked.says, new RegExp(PROVIDER_ACCESS_VAR));

  // Both.
  const open = resolveProviderPolicy({ requested: MAPTILER, env: ALLOWED });
  assert.equal(open.mode, "ALLOWED_BOUNDED");
  assert.equal(open.provider, MAPTILER);
  assert.equal(open.ceiling, DEFAULT_PROVIDER_CEILING);
  assert.match(open.says, /SPENDS EXTERNAL MAPTILER QUOTA/, "an opted-in run must say so out loud");
});

test("a blocked policy is blocked whatever the request looks like", () => {
  const blocked = resolveProviderPolicy({ requested: MAPTILER, env: {} });
  const decision = decideProviderRequest("https://api.maptiler.com/maps/x/style.json", blocked, 0);
  assert.equal(decision.verdict, "BLOCKED_BY_DEFAULT");
});

test("the ceiling is hard, and the request that crosses it is refused rather than counted", () => {
  const policy = resolveProviderPolicy({
    requested: MAPTILER,
    env: { ...ALLOWED, [PROVIDER_CEILING_VAR]: "2" },
  });
  assert.equal(policy.ceiling, 2);

  const url = "https://api.maptiler.com/maps/basic-v2/style.json?key=abc";
  assert.equal(decideProviderRequest(url, policy, 0).verdict, "ALLOWED_UNDER_CEILING");
  assert.equal(decideProviderRequest(url, policy, 1).verdict, "ALLOWED_UNDER_CEILING");
  const over = decideProviderRequest(url, policy, 2);
  assert.equal(over.verdict, "REFUSED_CEILING_EXCEEDED");
  assert.match(over.says ?? "", /CEILING EXCEEDED/);
});

test("a ceiling nobody can raise past the maximum, and a nonsense one falls back to the default", () => {
  const huge = resolveProviderPolicy({
    requested: MAPTILER,
    env: { ...ALLOWED, [PROVIDER_CEILING_VAR]: "1000000" },
  });
  assert.equal(huge.ceiling, MAX_PROVIDER_CEILING, "a run may not raise its own ceiling arbitrarily");

  for (const raw of ["", "  ", "0", "-4", "lots", "12.9.3"]) {
    const policy = resolveProviderPolicy({
      requested: MAPTILER,
      env: { ...ALLOWED, [PROVIDER_CEILING_VAR]: raw },
    });
    assert.ok(
      policy.ceiling > 0 && policy.ceiling <= MAX_PROVIDER_CEILING,
      `a ceiling of ${JSON.stringify(raw)} must fall back to a real bound, got ${policy.ceiling}`,
    );
  }
});

test("the ledger records what a run spent, and never a key", () => {
  const ledger = newProviderLedger(BLOCKED_BY_DEFAULT);
  ledger.blocked = 3;
  ledger.hosts.add(providerHostOf("https://api.maptiler.com/maps/x/style.json?key=SECRETVALUE"));
  const line = describeLedger(ledger);
  assert.match(line, /0 request\(s\) spent, 3 blocked/);
  assert.match(line, /api\.maptiler\.com/);
  assert.doesNotMatch(line, /SECRETVALUE/, "the ledger records hosts, never a URL carrying a key");
  assert.doesNotMatch(line, /key=/, "a query string must never reach a report");
});

/* --------------------------------------------------------------------------
 * The structural half: the barrier is only real if the shared site calls it.
 * ------------------------------------------------------------------------ */

test("the shared browser site enforces the barrier, and enforces it first", async () => {
  const src = await readFile(join(process.cwd(), "scripts", "browser.mts"), "utf8");

  assert.match(
    src,
    /from "\.\.\/lib\/ops\/provider-access\.ts"/,
    "scripts/browser.mts must import the policy rather than restate it — a copy inside the " +
      "harness is remembered rather than enforced, which is the argument RULING 101 already made",
  );
  assert.match(
    src,
    /decideProviderRequest\(/,
    "the shared site must ASK the policy about every request",
  );
  assert.match(
    src,
    /route\.abort\("blockedbyclient"\)/,
    "a blocked provider request must be aborted, so MapLibre falls to FALLBACK_STYLE",
  );

  /* The barrier runs before the confinement decision, so a request that will not leave never has its headers computed. */
  const barrierAt = src.indexOf("decideProviderRequest(");
  const confineAt = src.indexOf("confine(request.url()");
  assert.ok(barrierAt > 0 && confineAt > 0, "both decisions must be present in the route handler");
  assert.ok(
    barrierAt < confineAt,
    "the provider barrier must be decided before origin confinement",
  );

  /* Two gates: a launch option alone cannot open the door. */
  assert.match(
    src,
    /resolveProviderPolicy\(\{[\s\S]{0,200}?requested:[\s\S]{0,120}?env:/,
    "the policy must be resolved from BOTH the launch option and the process environment",
  );
  /* The ceiling has teeth: a breached run must end non-zero. */
  assert.match(
    src,
    /provider\.exceeded[\s\S]{0,400}?throw new Error\(/,
    "close() must throw when the ceiling was exceeded, so a breached run cannot report success",
  );
});
