import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { blocking, check, detectPnpm, needsRemediation, redact } from "../lib/ops/doctor.ts";

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

/**
 * The script, addressed ABSOLUTELY so the command can be driven from any working
 * directory. Which matters, because the working directory is what decides
 * whether doctor finds a `.env.local` at all.
 */
const DOCTOR = join(process.cwd(), "scripts", "doctor.mts");

type DoctorRun = { stdout: string; stderr: string; report: string };

function runDoctor(cwd: string, env: NodeJS.ProcessEnv, reportPath: string): DoctorRun {
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync(
      process.execPath,
      ["--experimental-strip-types", DOCTOR, "--json", reportPath],
      { cwd, env, encoding: "utf8", maxBuffer: 1 << 26 },
    );
  } catch (error) {
    /* A non-zero exit is EXPECTED and is not the thing under test — doctor
     * exits 1 whenever anything is blocking. Both streams are captured off the
     * failure exactly as they are off a success. */
    const e = error as { stdout?: string; stderr?: string };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }
  return { stdout, stderr, report: existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "" };
}

/** Every sink doctor writes, checked for the sentinel and for DSN shape. */
function assertNothingLeaked(run: DoctorRun, context: string): void {
  assert.ok(
    run.stdout.length > 0,
    `doctor produced no stdout at all (${context}) — this test would then prove nothing`,
  );

  const sinks: [string, string][] = [
    ["stdout", run.stdout],
    ["stderr", run.stderr],
    ["the JSON report", run.report],
  ];

  for (const [name, text] of sinks) {
    for (const [what, needle] of [
      ["the sentinel", SENTINEL],
      ["a prefix of the sentinel", SENTINEL_PREFIX],
      ["a suffix of the sentinel", SENTINEL_SUFFIX],
    ] as const) {
      assert.ok(
        !text.includes(needle),
        `${what} reached ${name} (${context}). doctor may emit a credential's NAME, its presence, ` +
          `its validity state, a failure class and a remediation — and nothing else, through any ` +
          `sink it writes.`,
      );
    }
    /* The connection string's own shape, not just the sentinel inside it. */
    assert.ok(
      !/postgres:\/\/[^\s"@]+:[^\s"@]+@/.test(text),
      `a credential-bearing connection string reached ${name} (${context})`,
    );
  }
}

/** A hostile environment: a sentinel key, and a DSN built to THROW on parse. */
function hostileEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SOME_VENDOR_API_KEY: SENTINEL,
    WTP_SENTINEL_TOKEN: SENTINEL,
    /* MALFORMED ON PURPOSE — no scheme — so doctor's DSN shape check THROWS
     * with the whole string in the message. That is the leak path this test
     * exists to police; a well-formed DSN never reaches an error at all and
     * the test would prove nothing. */
    DATABASE_URL: `wtp_user:${SENTINEL}@db.example.neon.tech/neondb`,
  };
}

test("SENTINEL: doctor leaks nothing when it READS a credential file full of secrets", () => {
  /*
   * **THE WHOLE COMMAND, WITH A REAL SECRET-BEARING `.env.local` ON DISK,
   * THROUGH ITS FAILING PATHS, WITH EVERY SINK CAPTURED.**
   *
   * `.env.local` is the single most dangerous file doctor touches: it opens it,
   * parses it, and reports on its contents. So the file is CONSTRUCTED here, in
   * a temporary working directory, holding sentinels — rather than left to
   * whatever the machine happens to have.
   *
   * That is not only determinism. Until this test constructed the file, the
   * credential-reading path was never actually driven with a secret in it: on a
   * developer's machine doctor read the real `.env.local` (whose values no test
   * knows, so no test could assert they had not leaked), and on CI there is no
   * `.env.local` at all, so the branch did not execute. Both were blind, and
   * the CI one additionally made the usefulness assertion below unreachable —
   * which is how this test came to fail on CI while passing locally.
   */
  const dir = mkdtempSync(join(tmpdir(), "wtp-doctor-envfile-"));
  const report = join(dir, "doctor.json");
  try {
    writeFileSync(
      join(dir, ".env.local"),
      [
        `SOME_VENDOR_API_KEY=${SENTINEL}`,
        `WTP_SENTINEL_TOKEN=${SENTINEL}`,
        `DATABASE_URL=postgres://wtp_user:${SENTINEL}@db.example.neon.tech/neondb`,
        /* Deliberately NOT secret-shaped, so the count below also proves doctor
         * counts by name shape rather than counting every line in the file.
         * (`NOT_A_SECRET` would not do: it contains "SECRET" and is matched.) */
        "WTP_PILOT_ZIP=85641",
      ].join("\n"),
      "utf8",
    );

    const run = runDoctor(dir, hostileEnv(), report);
    assertNothingLeaked(run, "a constructed .env.local");

    /*
     * And it must still be USEFUL. Names, counts and states are exactly what may
     * leave, and this run is the one where the count is DETERMINED: three of the
     * four names written above are secret-shaped.
     */
    assert.match(
      run.stdout,
      /3 credential name\(s\) set/,
      "doctor must still report credentials by count — a boundary that redacts everything is not a boundary, it is a broken tool",
    );
    assert.match(run.stdout, /DATABASE_URL/, "the variable NAME is not secret and is what a remediation needs");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SENTINEL: doctor leaks nothing through stdout, stderr or its JSON report", () => {
  /*
   * The same sentinel through the command AS THIS REPOSITORY ACTUALLY RUNS IT —
   * real working directory, real artifacts, real `.env.local` or none. The test
   * above controls the environment to make an assertion about the credential
   * count possible; this one deliberately does not, because a boundary that
   * only holds in a constructed directory is not the boundary that ships.
   */
  const dir = mkdtempSync(join(tmpdir(), "wtp-doctor-"));
  const report = join(dir, "doctor.json");
  try {
    const run = runDoctor(process.cwd(), hostileEnv(), report);
    assertNothingLeaked(run, "the real working tree");

    /*
     * USEFULNESS, asserted in the one way that is true on every machine. Whether
     * `.env.local` exists differs between a developer's checkout and CI, so the
     * COUNT is not assertable here — but a NAMED state always is, and the set is
     * closed. Blank the credentials check and this fails on both.
     */
    assert.match(
      run.stdout,
      /credentials present in \.env\.local, by name/,
      "the credentials check must still appear and still be named",
    );
    assert.match(
      run.stdout,
      /credential name\(s\) set|\.env\.local is absent/,
      "the credentials check must report one of its two named states, never nothing",
    );
    assert.match(run.stdout, /DATABASE_URL/, "the variable NAME is not secret and is what a remediation needs");
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

/* ------------------------------- the instrument's own false report, replayed */

test("PLANTED: doctor asks the RUNNER for pnpm rather than spawning it", () => {
  /*
   * **THE READINESS TOOL REPORTED A FACT ABOUT ITSELF AS A FACT ABOUT THE
   * WORLD.** `pnpm run doctor` printed `FAIL — pnpm is not on PATH` on a
   * machine that was running the check THROUGH pnpm — twice, for two different
   * Windows reasons: `execFileSync("pnpm")` is ENOENT because the executable is
   * `pnpm.cmd`, and `execFileSync("pnpm.cmd")` is ENOENT too because
   * `execFile` does no PATHEXT resolution.
   *
   * The control is the whole point: the spawn is made to THROW. If the version
   * still comes back, it came from the runner's own `npm_config_user_agent`
   * and no process was involved. Restore either spawning implementation and
   * this fails.
   */
  const explode = () => {
    throw new Error("spawnSync pnpm ENOENT");
  };

  const throughPnpm = detectPnpm("pnpm/11.21.0 npm/? node/v24.19.0 win32 x64", explode);
  assert.equal(
    throughPnpm.version,
    "11.21.0",
    "doctor spawned a process instead of reading the user agent pnpm already set",
  );
  assert.equal(throughPnpm.error, null);

  /* A GENUINE absence is still a genuine failure — the repair must not have
   * turned the check into one that can never fail. */
  const notPnpm = detectPnpm("npm/10.0.0 node/v24.19.0", explode);
  assert.equal(notPnpm.version, null, "an absent pnpm must still report absent");
  assert.ok(notPnpm.error, "and must carry the failure, not a silent null");

  /* And the spawn path still works when it is the only one available. */
  const spawned = detectPnpm(undefined, () => "10.33.0\n");
  assert.equal(spawned.version, "10.33.0");
});

test("the documented invocation is `pnpm run doctor`, and the script exists under that name", () => {
  /*
   * pnpm OWNS the verb `doctor`: `pnpm doctor` runs pnpm's own installation
   * check, prints "All checks passed" about pnpm, and never reaches this
   * repository's script. An earlier brief asked for `pnpm doctor` and the right
   * answer is not to fight the package manager for the name.
   */
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.ok(pkg.scripts.doctor, "package.json has no `doctor` script");
  assert.match(pkg.scripts.doctor, /doctor\.mts/);

  const header = readFileSync(join(process.cwd(), "scripts/doctor.mts"), "utf8").slice(0, 2000);
  assert.match(
    header,
    /pnpm run doctor/,
    "the script must document the invocation that actually reaches it",
  );
});
