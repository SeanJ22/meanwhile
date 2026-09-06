/**
 * **THE SEEDED FAILURE, AND THE FOUR THINGS THAT MUST NOT BE SHIPPABLE.**
 * (Lane 5, 2026-09-01.)
 *
 * A staging deploy that resolves the PRODUCTION database is the worst failure
 * available to this repository that produces no visible symptom: the site comes
 * up, serves real civic data, and writes every probe row into the store the
 * business sells from. There is no error to catch and no reader-visible
 * difference. So the guard is planted rather than described — a guard whose
 * refusal has never been demonstrated is a comment.
 *
 * Four claims, each with its own failure:
 *
 *   1. a staging context resolving production is REFUSED, and an unclassifiable
 *      database is refused too, because `CANNOT_TELL` fails safe
 *   2. a planted password appears in NO output on ANY path, including the paths
 *      where a naive implementation would rethrow the parse error that carries
 *      the whole connection string back on `err.input`
 *   3. the staging observer cannot write the production integrity record
 *   4. `STAGING_RENDER` does not satisfy the activation gate, and nothing in
 *      the tree decides production-ness by negating the local target
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ACTIVATION_GATING_TARGETS,
  EVALUATION_TARGETS,
  satisfiesActivationGate,
} from "../lib/health/reader-question.ts";
import {
  BRANCH_DEPLOY_CONTEXT,
  PRODUCTION_CONTEXT,
  classifyDatabaseUrl,
  evaluateIsolation,
  recordPathCollides,
  sameEndpointIdentity,
} from "../lib/ops/staging-isolation.ts";
import { RECORD_PATH } from "../scripts/production-integrity.mts";
import { STAGING_RECORD_PATH, STAGING_URL_VARIABLE } from "../scripts/staging-observer.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The planted secret. It is a fabricated string that exists only in this file,
 * so a match anywhere in any output is unambiguous: nothing else in the
 * repository can produce it by coincidence.
 */
const SECRET = "npg_PLANTED_SECRET_v0N0tR3al";

const PRODUCTION_URL = `postgresql://neondb_owner:${SECRET}@ep-still-water-a1b2c3.us-east-2.aws.neon.tech/neondb?sslmode=require`;
const STAGING_URL = `postgresql://neondb_owner:${SECRET}@ep-bold-meadow-z9y8x7.us-east-2.aws.neon.tech/neondb?sslmode=require`;
const LOCAL_URL = `postgres://wtp:${SECRET}@localhost:5432/wtp_local`;

const HINTS = { productionHostHint: PRODUCTION_URL, stagingHostHint: STAGING_URL };

/* ========================================================================== */
/* 1 — THE SEEDED FAILURE                                                      */
/* ========================================================================== */

test("a branch (staging) deploy resolving the PRODUCTION database is REFUSED", () => {
  /*
   * The whole point, planted. `DATABASE_URL` on the branch deploy has been set
   * to the production connection — one line in a settings panel — and every
   * label in sight still says staging.
   */
  const role = classifyDatabaseUrl(PRODUCTION_URL, HINTS);
  assert.equal(role, "production", "the production endpoint must classify as production");

  const verdict = evaluateIsolation({
    context: BRANCH_DEPLOY_CONTEXT,
    role,
    productionRole: "production",
    sameEndpointAsProduction: true,
  });
  assert.equal(verdict.ok, false, "THE SEEDED FAILURE SHIPPED — a staging deploy on production");
  assert.match(verdict.reason, /store/, "the refusal no longer names the harm");
});

test("the ROLE rule refuses on its own, with no collision measurement to lean on", () => {
  /*
   * The rule above and the collision rule are two independent refusals, and a
   * test that only ever exercised them together would not notice one of them
   * being deleted. Here the production endpoint is identified by NAME — a
   * `prod` token, weak evidence admitted only in the refusing direction — and
   * the endpoints are provably distinct, so ONLY the role rule can fire.
   */
  const namedProduction = `postgresql://u:${SECRET}@ep-prod-main-4f4f4f.us-east-2.aws.neon.tech/neondb`;
  const role = classifyDatabaseUrl(namedProduction, { productionHostHint: null, stagingHostHint: null });
  assert.equal(role, "production", "a `prod` token no longer convicts a URL");

  const verdict = evaluateIsolation({
    context: BRANCH_DEPLOY_CONTEXT,
    role,
    productionRole: "production",
    sameEndpointAsProduction: false,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /PRODUCTION database/);
});

test("the collision outranks the labels — same endpoint, whatever either is called", () => {
  /*
   * Both variables confidently labelled staging, both pointing at one database.
   * A guard that trusted the labels would pass this, and it is the shape a
   * copy-pasted settings panel actually produces.
   */
  const verdict = evaluateIsolation({
    context: BRANCH_DEPLOY_CONTEXT,
    role: "staging",
    productionRole: "production",
    sameEndpointAsProduction: true,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /SAME\s+endpoint/i);
});

test("a genuinely separate staging endpoint is PERMITTED — the guard is not a wall", () => {
  /*
   * A refusal that fires on the correct configuration too is a refusal that
   * gets switched off. The permitted case is asserted so the guard is known to
   * discriminate rather than to refuse everything.
   */
  const verdict = evaluateIsolation({
    context: BRANCH_DEPLOY_CONTEXT,
    role: classifyDatabaseUrl(STAGING_URL, HINTS),
    productionRole: "production",
    sameEndpointAsProduction: sameEndpointIdentity(STAGING_URL, PRODUCTION_URL) ?? null,
  });
  assert.equal(verdict.role, "staging");
  assert.equal(verdict.ok, true, verdict.reason);
});

test("production must serve production — the mirror-image misconfiguration", () => {
  for (const role of ["staging", "local", "unknown"] as const) {
    const verdict = evaluateIsolation({ context: PRODUCTION_CONTEXT, role, productionRole: "production" });
    assert.equal(verdict.ok, false, `production serving a ${role} database was permitted`);
  }
  assert.equal(
    evaluateIsolation({
      context: PRODUCTION_CONTEXT,
      role: "production",
      productionRole: "production",
    }).ok,
    true,
  );
});

/* ========================================================================== */
/* 2 — CANNOT_TELL FAILS SAFE                                                  */
/* ========================================================================== */

test("`unknown` is never a pass, and `staging` is never the default", () => {
  /*
   * The direction that matters. Defaulting an unclassifiable URL to the
   * reassuring word is exactly how a production URL passes a guard, so the
   * unclassifiable cases are asserted to be `unknown` FIRST and refused SECOND.
   */
  const unclassifiable = [
    null,
    undefined,
    "",
    "   ",
    "not a url",
    "postgresql://",
    `postgresql://u:${SECRET}@ep-unheard-of-000.eu-central-1.aws.neon.tech/neondb`,
  ];
  for (const url of unclassifiable) {
    const role = classifyDatabaseUrl(url, { productionHostHint: PRODUCTION_URL, stagingHostHint: null });
    assert.notEqual(role, "staging", `${JSON.stringify(url)} defaulted to the safe-sounding answer`);
  }

  assert.equal(
    evaluateIsolation({
      context: BRANCH_DEPLOY_CONTEXT,
      role: "unknown",
      productionRole: "production",
      sameEndpointAsProduction: false,
    }).ok,
    false,
    "an unverifiable staging database was permitted",
  );
});

test("an UNMEASURED collision refuses, exactly as an unasked question should", () => {
  /*
   * `evaluateReleaseFreeze`'s rule 4 in miniature: a caller that omits the
   * measurement gets the strict answer. If this ever passed, "there is no skip
   * flag" would be one omitted argument away from false.
   */
  for (const collision of [undefined, null]) {
    const verdict = evaluateIsolation({
      context: BRANCH_DEPLOY_CONTEXT,
      role: "staging",
      productionRole: "production",
      sameEndpointAsProduction: collision,
    });
    assert.equal(verdict.ok, false, "an unmeasured collision was treated as no collision");
  }
});

test("a missing production anchor is a missing CHECK, not a passing one", () => {
  const verdict = evaluateIsolation({
    context: BRANCH_DEPLOY_CONTEXT,
    role: "staging",
    productionRole: "unknown",
    sameEndpointAsProduction: false,
  });
  assert.equal(verdict.ok, false);
});

test("an unrecognised context is refused rather than assumed harmless", () => {
  for (const context of ["deploy-preview", "dev", "", "PRODUCTION_ISH"]) {
    assert.equal(
      evaluateIsolation({ context, role: "staging", productionRole: "production", sameEndpointAsProduction: false }).ok,
      false,
      `the context ${JSON.stringify(context)} was permitted without anyone classifying it`,
    );
  }
});

test("a local database is local, and a pooled connection resolves to its real branch", () => {
  assert.equal(classifyDatabaseUrl(LOCAL_URL, HINTS), "local");
  assert.equal(classifyDatabaseUrl(`postgres://u:${SECRET}@127.0.0.1:5432/wtp`, HINTS), "local");

  /*
   * A POOLED production string and the DIRECT one are two spellings of ONE
   * database. Comparing hosts would call them different endpoints and let the
   * collision check pass on the worst possible configuration.
   */
  const pooled = `postgresql://u:${SECRET}@ep-pooler-shared.us-east-2.aws.neon.tech/neondb?options=endpoint%3Dep-still-water-a1b2c3`;
  assert.equal(sameEndpointIdentity(pooled, PRODUCTION_URL), true);
  assert.equal(classifyDatabaseUrl(pooled, HINTS), "production");
});

test("`sameEndpointIdentity` returns null, not false, when it cannot tell", () => {
  // `null` is the absence of a measurement. Collapsing it to `false` would
  // report "proven distinct" for a pair nobody could compare.
  assert.equal(sameEndpointIdentity(null, PRODUCTION_URL), null);
  assert.equal(sameEndpointIdentity("not a url", PRODUCTION_URL), null);
  assert.equal(sameEndpointIdentity(PRODUCTION_URL, PRODUCTION_URL), true);
  assert.equal(sameEndpointIdentity(STAGING_URL, PRODUCTION_URL), false);
});

/* ========================================================================== */
/* 3 — THE CREDENTIAL NEVER LEAVES                                             */
/* ========================================================================== */

test("a password inside a connection string reaches NO output, on any path", () => {
  /*
   * THE LEAK THIS CLOSES IS MEASURED, NOT IMAGINED. Node's `new URL()` failure
   * carries the ENTIRE input back on `err.input`, so a `catch` that rethrows,
   * wraps, or writes `err.message` into a reason string puts a live database
   * password into a CI log that everyone with read access can see. Every catch
   * in the module is empty for that reason, and this is the proof.
   */
  const hostile = [
    PRODUCTION_URL,
    STAGING_URL,
    LOCAL_URL,
    `postgresql://u:${SECRET}`, // malformed: authority, no host
    `://${SECRET}`, // malformed: no scheme
    `postgresql://u:${SECRET}@`, // malformed: empty host
    `${SECRET}`, // a bare secret, no URL at all
    `postgresql://u:${SECRET}@ep-x.aws.neon.tech:not-a-port/db`,
  ];

  const outputs: string[] = [];
  for (const url of hostile) {
    // NOTHING here may throw: a thrown error is the leak channel.
    let role: string;
    assert.doesNotThrow(() => {
      role = classifyDatabaseUrl(url, HINTS);
      outputs.push(role);
      outputs.push(String(sameEndpointIdentity(url, PRODUCTION_URL)));
      outputs.push(
        JSON.stringify(
          evaluateIsolation({
            context: BRANCH_DEPLOY_CONTEXT,
            role: classifyDatabaseUrl(url, HINTS),
            productionRole: classifyDatabaseUrl(PRODUCTION_URL, HINTS),
            sameEndpointAsProduction: sameEndpointIdentity(url, PRODUCTION_URL),
          }),
        ),
      );
    }, `classifying ${url.slice(0, 12)}… threw, and a thrown error is how a secret escapes`);
  }

  const all = outputs.join("\n");
  assert.ok(!all.includes(SECRET), "THE PLANTED PASSWORD APPEARED IN OUTPUT");
  assert.ok(!all.includes("neondb_owner"), "the database username appeared in output");
  assert.ok(!all.includes("aws.neon.tech"), "a database host appeared in output");
});

test("the module returns only the role vocabulary — never a value derived from the URL", () => {
  const roles = new Set(["staging", "production", "local", "unknown"]);
  for (const url of [PRODUCTION_URL, STAGING_URL, LOCAL_URL, "", "not a url"]) {
    assert.ok(roles.has(classifyDatabaseUrl(url, HINTS)), "a role outside the vocabulary escaped");
  }
});

test("the isolation gate never formats a raw connection string into a message", () => {
  /*
   * Read as TEXT rather than executed, because the failure being guarded is a
   * line of source that formats a secret — and a run that happens not to have
   * the variable set would prove nothing about that line.
   */
  const src = readFileSync(join(ROOT, "scripts", "staging-isolation-gate.mts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [
    "${runtimeUrl}",
    "${productionUrl}",
    "${stagingUrl}",
    "${value}",
    "runtimeUrl.slice",
    "productionUrl.slice",
    "stagingUrl.slice",
    "runtimeUrl.substring",
    "productionUrl.substring",
    "stagingUrl.substring",
  ]) {
    assert.ok(!code.includes(forbidden), `the gate formats a connection string: ${forbidden}`);
  }
  // Presence is a boolean beside the variable name. Sanitized endpoint evidence
  // is covered by the executable build tests; raw connection strings stay private.
  assert.ok(
    code.includes('value === null ? "NO" : "yes"'),
    "the gate no longer reports set-ness as a boolean beside the variable name",
  );
});

/* ========================================================================== */
/* 4 — THE STAGING OBSERVER CANNOT WRITE THE PRODUCTION RECORD                 */
/* ========================================================================== */

test("the two record paths are two files, and the collision predicate catches every spelling", () => {
  assert.notEqual(STAGING_RECORD_PATH, RECORD_PATH);
  assert.equal(recordPathCollides(STAGING_RECORD_PATH, RECORD_PATH), false);

  // Identical, separator-different and case-different spellings are ONE file on
  // Windows. A case-sensitive comparison would let the third through.
  assert.equal(recordPathCollides(RECORD_PATH, RECORD_PATH), true);
  assert.equal(recordPathCollides(RECORD_PATH.replace(/\\/g, "/"), RECORD_PATH), true);
  assert.equal(recordPathCollides(RECORD_PATH.toUpperCase(), RECORD_PATH), true);
});

test("the staging observer refuses structurally, and takes the staging origin BY NAME", () => {
  const src = readFileSync(join(ROOT, "scripts", "staging-observer.mts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.match(
    code,
    /recordPathCollides\(STAGING_RECORD_PATH,\s*RECORD_PATH\)/,
    "the observer no longer checks its record path against the production one",
  );
  assert.match(code, /STAGING_RENDER_ORIGIN/, "the observer no longer names the staging origin");

  /*
   * NO FLIPPED FLAG. `lib/ops/origins.ts` is explicit that the production
   * origin is never overloaded to select staging behaviour; the same applies to
   * the record. A `--base-url=` or `--record=` reader here would be exactly the
   * single switch that doctrine forbids, so their ABSENCE is asserted.
   */
  for (const forbidden of ['flag("base-url")', 'flag("record")', 'flag("origin")']) {
    assert.ok(!code.includes(forbidden), `the staging observer accepts ${forbidden}`);
  }

  /*
   * AND IT OPENS NO DATABASE. `tests/migration-shipping-invariant.test.ts`
   * holds the set of files that may query the migrations table closed to four;
   * a fifth would be a second verdict free to disagree with the one branch
   * protection trusts.
   */
  assert.ok(
    !/\bdrizzle\.__drizzle_migrations\b/.test(code),
    "the staging observer queries the migrations table directly",
  );
});

test("the observer never files a PRODUCTION database reading under staging", () => {
  /*
   * `scripts/db-shipping-gate.mts` reads ONE variable by a fixed name. Spawned
   * naively, it would read production's database and the answer would be
   * recorded as the staging deploy's migrations state — a true answer to a
   * question nobody asked, filed as the answer to one nobody checked.
   */
  const src = readFileSync(join(ROOT, "scripts", "staging-observer.mts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /*
   * **DELETING THE VARIABLE WOULD NOT HAVE WORKED, AND THAT IS MEASURED.**
   * `scripts/db-shipping-gate.mts` loads `.env.local` itself, so a variable
   * removed from the child's environment comes straight back — pointing at
   * PRODUCTION. So the guard is that the observer never DELETES it and never
   * spawns the gate without a staging credential; it only ever SETS it, which
   * dotenv respects because no `override` is passed.
   */
  assert.ok(
    !/delete\s+childEnv\[/.test(code),
    "the observer deletes a variable from the child env — db-shipping-gate reloads it from .env.local",
  );
  assert.match(
    code,
    /\{\s*\.\.\.process\.env,\s*\[GATE_URL_VARIABLE\]:\s*stagingUrl\s*\}/,
    "the observer no longer points the gate at the staging credential explicitly",
  );
  const gate = readFileSync(join(ROOT, "scripts", "db-shipping-gate.mts"), "utf8");
  assert.match(gate, /loadEnv\(\{\s*path:/, "the gate stopped loading .env.local — re-read this reasoning");
  assert.ok(
    !/override\s*:\s*true/.test(gate),
    "the gate now OVERRIDES process.env from .env.local, which defeats the observer's only safe lever",
  );

  assert.match(code, /migrationsSubject/, "the record no longer says which database the verdict is about");
  assert.equal(STAGING_URL_VARIABLE, "WTP_STAGING_DATABASE_URL_READONLY");
});

/* ========================================================================== */
/* 5 — STAGING_RENDER DOES NOT SATISFY THE ACTIVATION GATE                     */
/* ========================================================================== */

test("STAGING_RENDER is a recorded target and NOT an activation-gating one", () => {
  assert.ok(EVALUATION_TARGETS.includes("STAGING_RENDER"), "the target was never added");
  assert.deepEqual(
    [...ACTIVATION_GATING_TARGETS],
    ["PRODUCTION_RENDER"],
    "RULING 216 counts PRODUCTION_RENDER and nothing else",
  );

  /*
   * THE BYPASS, PLANTED. A staging deploy is unreviewed code against a separate
   * database; a green there counting toward activation would let the gate pass
   * on evidence about a site no reader has ever loaded, and the thing that then
   * reaches a reader is a false claim about a government.
   */
  const staged = satisfiesActivationGate({
    target: "STAGING_RENDER",
    proofClass: "INDEPENDENTLY_REPRODUCED",
  });
  assert.equal(staged.counts, false, "STAGING_RENDER SATISFIED THE ACTIVATION GATE");
  assert.match(staged.why, /RULING 216/);
});

test("both halves of RULING 216 are required, and an absent half never passes", () => {
  assert.equal(satisfiesActivationGate({ target: "LOCAL_RENDER", proofClass: "INDEPENDENTLY_REPRODUCED" }).counts, false);
  assert.equal(satisfiesActivationGate({ target: "PRODUCTION_RENDER", proofClass: "SESSION_MEASURED" }).counts, false);
  assert.equal(satisfiesActivationGate({ target: null, proofClass: "INDEPENDENTLY_REPRODUCED" }).counts, false);
  assert.equal(satisfiesActivationGate({ target: "PRODUCTION_RENDER", proofClass: null }).counts, false);
  assert.equal(
    satisfiesActivationGate({ target: "PRODUCTION_RENDER", proofClass: "INDEPENDENTLY_REPRODUCED" }).counts,
    true,
    "a repair that made the gate unsatisfiable would have traded one defect for another",
  );
});

test("nothing in the tree decides production-ness by NEGATING the local target", () => {
  /*
   * THE CLASS SWEEP (RULING 147). The named instance would be one file writing
   * "the target is not the local one, so it must be production" — a reading
   * that is correct while the vocabulary has two members and wrong the instant
   * it has three. Grepping the tree is what stops the next implementer writing
   * it somewhere this test file has never heard of.
   *
   * `--untracked` because a new file is invisible to a tracked-set sweep until
   * it is git-added, and `-a` because a file carrying a NUL byte is classified
   * binary and SKIPPED — reporting nothing found without having looked.
   */
  let offenders: string[] = [];
  try {
    const out = execFileSync(
      "git",
      [
        "grep",
        "-l",
        "-a",
        "-E",
        "--untracked",
        '(!==?|<>)\\s*"LOCAL_RENDER"',
        "--",
        "lib",
        "scripts",
        "app",
        "components",
      ],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    offenders = out.trim().split("\n").filter(Boolean);
  } catch (err) {
    // git grep exits 1 with no output when nothing matches — that is the pass.
    // Anything else is a real error and must NOT read as clean.
    const e = err as { status?: number; stdout?: string };
    if (e.status !== 1 || e.stdout?.trim()) throw err;
  }

  assert.deepEqual(
    offenders,
    [],
    "these files decide a target's meaning by negating LOCAL_RENDER, which stopped being " +
      "equivalent to PRODUCTION_RENDER when STAGING_RENDER joined the vocabulary. Ask " +
      "`satisfiesActivationGate` (lib/health/reader-question.ts) instead:\n  " +
      offenders.join("\n  "),
  );
});
