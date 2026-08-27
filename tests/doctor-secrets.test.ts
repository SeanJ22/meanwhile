import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { blocking, check, needsRemediation, redact } from "../lib/ops/doctor.ts";

/**
 * **A DIAGNOSTIC TOOL IS THE MOST DANGEROUS PLACE IN A REPOSITORY TO HANDLE A
 * SECRET.** (2026-08-27, the coverage-truth session.)
 *
 * Its entire job is to describe failures, and failures are where secrets leak:
 * a thrown `fetch` carries the URL, a connection error carries the connection
 * string, an `Authorization` header survives into a serialized request, and a
 * report file written for a human to paste into a chat carries all three.
 *
 * So the boundary is tested the only way that means anything: **a sentinel is
 * driven through the FAILING paths and every sink is captured.** A passing
 * check proves nothing about what an exception prints.
 *
 * The sentinel is deliberately unmistakable and deliberately not a real secret
 * shape, so that a test finding it in an output has found a genuine leak of a
 * value the code was handed and not a coincidence.
 */

const SENTINEL = "wtp-SENTINEL-3f8a1c-DO-NOT-EMIT-9b2e";
/** Derivatives that would each be a leak on their own. */
const SENTINEL_PREFIX = SENTINEL.slice(0, 12);
const SENTINEL_SUFFIX = SENTINEL.slice(-12);

const ENV_WITH_SENTINEL: Record<string, string | undefined> = {
  SOME_VENDOR_API_KEY: SENTINEL,
  DATABASE_URL: `postgres://wtp_user:${SENTINEL}@db.example.neon.tech/neondb?sslmode=require`,
  NOT_A_SECRET: "tucson",
};

/* ------------------------------------------------------- the boundary itself */

test("redact removes a secret VALUE wherever it appears", () => {
  const leaked = `connect failed for ${SENTINEL} at 10:04`;
  const out = redact(leaked, ENV_WITH_SENTINEL);
  assert.ok(!out.includes(SENTINEL), `the sentinel survived: ${out}`);
  assert.ok(out.includes("<redacted>"), "the removal must be visible, not silent");
});

test("redact removes a credential-bearing connection string, value list or not", () => {
  /*
   * The SHAPE half. This URL's password is NOT in the environment passed in,
   * so only the pattern can catch it — which is the case of a secret echoed by
   * a remote service or built at runtime.
   */
  const other = "postgres://someone:hunter2SuperSecret@db.example.com/x";
  const out = redact(other, { NOT_A_SECRET: "tucson" });
  assert.ok(!out.includes("hunter2SuperSecret"), `a foreign credential survived: ${out}`);
  assert.match(out, /<credentials-removed>/);
});

test("redact removes an Authorization header and an api-key query parameter", () => {
  const a = redact('failed with headers {"Authorization":"Bearer abcdef0123456789abcdef"}', {});
  assert.ok(!a.includes("abcdef0123456789abcdef"), `a bearer token survived: ${a}`);

  const b = redact("GET https://api.example.gov/v1/x?api_key=ABCD1234EFGH5678 failed", {});
  assert.ok(!b.includes("ABCD1234EFGH5678"), `an api key survived: ${b}`);
});

test("redact turns an ERROR into a class and a clean message, not a raw throw", () => {
  /*
   * The path that leaks in practice. `String(error)` on a failed connection
   * carries the whole DSN, and this is the one place doctor is guaranteed to
   * be holding one.
   */
  const error = new Error(
    `getaddrinfo ENOTFOUND for postgres://wtp_user:${SENTINEL}@db.example.neon.tech/neondb`,
  );
  const out = redact(error, ENV_WITH_SENTINEL);
  assert.ok(!out.includes(SENTINEL), `the sentinel survived an Error: ${out}`);
  assert.ok(!out.includes(SENTINEL_PREFIX), "not even a prefix of it may survive");
  assert.ok(out.startsWith("Error:"), "the error CLASS is useful and is kept");
  assert.match(out, /ENOTFOUND/, "the failure class is useful and is kept — that is the point of redacting rather than discarding");
});

test("redact removes a serialized object carrying a secret", () => {
  const out = redact({ url: "https://x.gov", headers: { authorization: `Bearer ${SENTINEL}` } }, ENV_WITH_SENTINEL);
  assert.ok(!out.includes(SENTINEL), `the sentinel survived JSON serialization: ${out}`);
});

test("check() redacts on the way IN, so no CheckResult can hold a secret", () => {
  const r = check("x", "a thing", "FAIL", new Error(`boom ${SENTINEL}`), "do the thing", ENV_WITH_SENTINEL);
  assert.ok(!JSON.stringify(r).includes(SENTINEL), "a constructed result held the sentinel");
});

test("a check that reports a problem must carry a remediation", () => {
  const bad = check("x", "a thing", "FAIL", "it broke", null, {});
  assert.ok(needsRemediation(bad), "a FAIL with no remediation must be flagged");
  const ok = check("y", "a thing", "FAIL", "it broke", "unbreak it", {});
  assert.ok(!needsRemediation(ok));
  /* OPTIONAL and PASS are not problems and are not required to carry one. */
  assert.ok(!needsRemediation(check("z", "a thing", "OPTIONAL", "not checked", null, {})));
  assert.equal(blocking([bad, ok]).length, 2);
});

/* ------------------------------------- the sentinel, through the REAL command */

test("SENTINEL: doctor leaks nothing through stdout, stderr or its JSON report", () => {
  /*
   * **THE WHOLE COMMAND, WITH A REAL SECRET IN ITS ENVIRONMENT, THROUGH ITS
   * FAILING PATHS, WITH EVERY SINK CAPTURED.**
   *
   * The unit tests above prove the boundary function. This proves that the
   * command actually uses it — on stdout, on stderr, and in the file it writes
   * for a human to paste somewhere. Those are three different sinks and a leak
   * in any one of them is the whole leak.
   *
   * The environment is deliberately hostile: a sentinel key, a sentinel-bearing
   * connection string, and `.next` hidden so at least one check is forced down
   * a non-PASS path.
   */
  const dir = mkdtempSync(join(tmpdir(), "wtp-doctor-"));
  const report = join(dir, "doctor.json");
  try {
    const env = {
      ...process.env,
      SOME_VENDOR_API_KEY: SENTINEL,
      WTP_SENTINEL_TOKEN: SENTINEL,
      /* MALFORMED ON PURPOSE — no scheme — so doctor's DSN shape check THROWS
       * with the whole string in the message. That is the leak path this test
       * exists to police; a well-formed DSN never reaches an error at all and
       * the test would prove nothing. */
      DATABASE_URL: `wtp_user:${SENTINEL}@db.example.neon.tech/neondb`,
    };

    let stdout = "";
    let stderr = "";
    try {
      stdout = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/doctor.mts", "--json", report],
        { cwd: process.cwd(), env, encoding: "utf8", maxBuffer: 1 << 26 },
      );
    } catch (error) {
      /* A non-zero exit is EXPECTED and is not the thing under test — doctor
       * exits 1 whenever anything is blocking. Both streams are captured off
       * the failure exactly as they are off a success. */
      const e = error as { stdout?: string; stderr?: string };
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? "";
    }

    const sinks: [string, string][] = [
      ["stdout", stdout],
      ["stderr", stderr],
      ["the JSON report", existsSync(report) ? readFileSync(report, "utf8") : ""],
    ];

    assert.ok(stdout.length > 0, "doctor produced no stdout at all — this test would then prove nothing");

    for (const [name, text] of sinks) {
      for (const [what, needle] of [
        ["the sentinel", SENTINEL],
        ["a prefix of the sentinel", SENTINEL_PREFIX],
        ["a suffix of the sentinel", SENTINEL_SUFFIX],
      ] as const) {
        assert.ok(
          !text.includes(needle),
          `${what} reached ${name}. doctor may emit a credential's NAME, its presence, its validity ` +
            `state, a failure class and a remediation — and nothing else, through any sink it writes.`,
        );
      }
      /* The connection string's own shape, not just the sentinel inside it. */
      assert.ok(
        !/postgres:\/\/[^\s"@]+:[^\s"@]+@/.test(text),
        `a credential-bearing connection string reached ${name}`,
      );
    }

    /* And it must still be USEFUL: names and states are exactly what may leave. */
    assert.match(stdout, /credential name\(s\) set/, "doctor must still report credentials by count/name");
    assert.match(stdout, /DATABASE_URL/, "the variable NAME is not secret and is what a remediation needs");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SENTINEL: a check driven down a FAILING path still leaks nothing", () => {
  /*
   * A passing check proves nothing about what an exception prints, so the
   * failing path is exercised directly with a secret in hand — the shape of
   * every real leak: a throw whose message was built from a credential.
   */
  const dir = mkdtempSync(join(tmpdir(), "wtp-doctor-fail-"));
  try {
    const probe = join(dir, "probe.json");
    let thrown: unknown = null;
    try {
      JSON.parse(`{ "bad": ${SENTINEL} }`);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, "the probe must actually throw for this to test anything");

    const r = check("probe", "a failing probe", "FAIL", thrown, "fix the probe", ENV_WITH_SENTINEL);
    writeFileSync(probe, JSON.stringify(r), "utf8");
    const written = readFileSync(probe, "utf8");

    assert.ok(!written.includes(SENTINEL), `the sentinel reached a report file via a thrown parse error: ${written}`);
    assert.ok(!written.includes(SENTINEL_PREFIX), "not even a prefix may survive");
    assert.match(written, /SyntaxError|Error/, "the failure class is kept, which is what makes redaction better than discarding");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
