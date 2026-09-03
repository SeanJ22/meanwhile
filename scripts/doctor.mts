/**
 * `pnpm doctor` — **CAN THIS MACHINE DO THE WORK?**
 * (2026-08-27, the coverage-truth session.)
 *
 * Every capability this repository depends on, each with a state a machine can
 * read and a remediation a person can act on. It is an OPERATOR-SAFETY and
 * ENVIRONMENT-READINESS instrument and it is deliberately not the data-integrity
 * one — `pnpm coverage` is that.
 *
 * ## Invoke it as `pnpm run doctor`, and the `run` is not optional
 *
 * **pnpm owns the verb `doctor`.** `pnpm doctor` runs pnpm's own installation
 * check — versions, cache directory, registry connectivity — and never reaches
 * this script. It prints "All checks passed", which is true about pnpm and says
 * nothing about this repository, and that is a confusing thing for a readiness
 * tool to have happen to it. The script keeps the name because the name is
 * right; the invocation carries `run`.
 *
 * ```
 * pnpm run doctor
 * pnpm run doctor --json doctor.json
 * ```
 *
 * ## It never calls a credentialed endpoint
 *
 * `pnpm credentials` proves each key by using it and writes the ledger. This
 * reports a credential as PRESENT or MISSING **by name**, and stops there. The
 * separation is not tidiness: a readiness check that authenticates is a
 * readiness check that can be rate-limited, can leak a token into an error, and
 * cannot be run on a plane.
 *
 * ## The secret boundary
 *
 * Everything printed or written goes through `redact` in `lib/ops/doctor.ts`,
 * and `tests/doctor-secrets.test.ts` drives a sentinel through the FAILING
 * paths and captures stdout, stderr and both report files to prove it. A
 * passing check proves nothing about what an exception prints, which is the
 * whole reason that test exists.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  blocking,
  check,
  detectPnpm,
  nameLooksSecret,
  needsRemediation,
  redact,
  type CheckResult,
} from "../lib/ops/doctor.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { resolveChromium, describeChromium } from "../lib/ops/chromium-pin.ts";

const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** `.env.local` is gitignored, so it is read directly. NAMES only ever leave. */
function envLocal(): Record<string, string> {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_0-9]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const FILE_ENV = envLocal();
/** The full environment, for REDACTION. Never for printing. */
const ENV: Record<string, string | undefined> = { ...FILE_ENV, ...process.env };

const results: CheckResult[] = [];
const c = (
  id: string,
  what: string,
  state: Parameters<typeof check>[2],
  detail: unknown,
  remediation: string | null = null,
) => results.push(check(id, what, state, detail, remediation, ENV));

/* ------------------------------------------------------------- the runtime */

const node = process.versions.node;
const major = Number(node.split(".")[0]);
c(
  "node",
  "Node runtime",
  major >= 22 ? "PASS" : "FAIL",
  `node ${node}`,
  major >= 22
    ? null
    : `this repository runs TypeScript through node's own --experimental-strip-types, which needs node 22 or newer. Install it and re-run.`,
);

/*
 * COREPACK IS A KNOWN TRAP HERE, not a preference. `pnpm handoff --ship` run
 * THROUGH corepack breaks its child processes, and the secrets gate then
 * reports a mirror credential leak when its subprocess simply never ran. So
 * this reports which pnpm is on PATH rather than assuming.
 */
/*
 * ON WINDOWS THE EXECUTABLE IS `pnpm.cmd`, and the first version of this check
 * reported `FAIL — spawnSync pnpm ENOENT` on a machine that was running the
 * check THROUGH pnpm. That is the exact failure this whole session is about,
 * committed by the readiness tool: an instrument reporting a fact about the
 * world when the fact was about the instrument. Both spellings are tried, and
 * a genuine absence is still a genuine FAIL.
 */
let pnpmVersion = "";
let pnpmError: unknown = null;
/*
 * **ASK THE RUNNER, DO NOT SPAWN IT.** pnpm sets `npm_config_user_agent` for
 * every script it runs — "pnpm/11.21.0 npm/? node/v24.19.0 win32 x64" — so
 * when doctor is invoked through pnpm the answer is already in hand, exactly
 * and for free.
 *
 * Spawning was the first two attempts and both were wrong on Windows:
 * `execFileSync("pnpm")` is ENOENT because the executable is `pnpm.cmd`, and
 * `execFileSync("pnpm.cmd")` is ENOENT too because `execFile` does no PATHEXT
 * or shell resolution. Both reported `FAIL — pnpm is not on PATH` on a machine
 * that was running the check THROUGH pnpm. That is this session's own subject
 * committed by the readiness tool: a fact about the instrument, reported as a
 * fact about the world.
 */
/* The rule itself lives in `lib/ops/doctor.ts` so a test can drive it with a
 * spawn that throws — see `detectPnpm`, and the control in
 * `tests/doctor-secrets.test.ts` that replays this exact false report. */
const detected = detectPnpm(process.env.npm_config_user_agent, () =>
  /* Not run through pnpm — spawn, with a shell so Windows resolves the shim. */
  execFileSync("pnpm --version", { encoding: "utf8", shell: true, maxBuffer: 1 << 20 }),
);
pnpmVersion = detected.version ?? "";
pnpmError = detected.error;
if (pnpmVersion) {
  c("pnpm", "pnpm on PATH", "PASS", `pnpm ${pnpmVersion}`);
} else {
  c(
    "pnpm",
    "pnpm on PATH",
    "FAIL",
    pnpmError,
    "install pnpm and put it on PATH. Do NOT route the gate commands through corepack: `pnpm handoff --ship` under corepack breaks its child processes and the secrets gate then reports a leak when its subprocess never ran.",
  );
}

/* ------------------------------------------------------------- the browser */

try {
  const chromium = resolveChromium();
  c(
    "chromium",
    "a Chromium for Playwright walks and captures",
    chromium.kind === "ABSENT" ? "MISSING" : chromium.kind === "SUBSTITUTED" ? "COULD_NOT_VERIFY" : "PASS",
    describeChromium(chromium),
    chromium.kind === "ABSENT"
      ? "run `pnpm exec playwright install chromium`. If the browser CDN is not on this machine's egress, point Playwright at a complete local Chromium by path — lib/ops/chromium-pin.ts holds the pin and the substitution rule."
      : chromium.kind === "SUBSTITUTED"
        ? "a Chromium other than the pinned build is being used. Captures will render; a pixel-level comparison against another machine may not match."
        : null,
  );
} catch (error) {
  c("chromium", "a Chromium for Playwright walks and captures", "COULD_NOT_VERIFY", error, "re-run; if this persists, read lib/ops/chromium-pin.ts.");
}

/* ------------------------------------------------------- the build outputs */

/*
 * `tsc --noEmit` CANNOT PASS ON A CLEAN CHECKOUT — `LayoutProps` comes out of
 * `.next/types`, so the type-check depends on a build having happened. That is
 * a real ordering trap and it is worth a check of its own rather than a
 * confusing type error twenty seconds into a gate run.
 */
c(
  "next-build",
  "a Next build exists, which `tsc` depends on",
  existsSync(join(ROOT, ".next", "types")) ? "PASS" : "MISSING",
  existsSync(join(ROOT, ".next", "types")) ? ".next/types present" : ".next/types absent",
  existsSync(join(ROOT, ".next", "types"))
    ? null
    : "run `pnpm build` first. `tsc --noEmit` reads generated route types out of .next/types and cannot pass on a clean checkout without them.",
);

/* --------------------------------------------------- the committed stores */

const REQUIRED_ARTIFACTS: { path: string; what: string; how: string }[] = [
  {
    path: "lib/registry/registry.json",
    what: "the body and division registry",
    how: "run `pnpm registry:build`. It merges the boundary derivation, the curated overlay and lib/registry/promoted-bodies.json.",
  },
  {
    path: "lib/registry/promoted-bodies.json",
    what: "the canonical promoted-body INPUT store",
    how: "this is an INPUT, not a generated file — it cannot be rebuilt. Recover it from git; without it a registry build silently drops every lead-promoted body (NH232).",
  },
  {
    path: "data/meetings-snapshot.json",
    what: "the meetings snapshot",
    how: "run `pnpm ingest composite`. Without it the app serves no meetings and says so.",
  },
  {
    path: "data/states/az/geo/body-territories.geojson",
    what: "territories for governments with no Census division",
    how: "run `pnpm cfd:territory --geojson data/states/az/geo/body-territories.geojson`. Without it, districts smaller than any division reach no reader (NH233).",
  },
  {
    path: "data/derived/resolver-geometry.json",
    what: "which boundary files the resolver loads",
    how: "run `pnpm resolver:manifest`.",
  },
];

for (const a of REQUIRED_ARTIFACTS) {
  const there = existsSync(join(ROOT, a.path));
  c(`artifact:${a.path}`, a.what, there ? "PASS" : "MISSING", there ? a.path : `${a.path} is absent`, there ? null : a.how);
}

/* ------------------------------------------------------------ credentials */

/*
 * NAMES AND PRESENCE. Never a value, never a prefix, never a length — a length
 * is a real hint about a secret and costs nothing to withhold.
 */
const secretNames = Object.keys(FILE_ENV).filter(nameLooksSecret).sort();
const emptyNames = secretNames.filter((n) => (FILE_ENV[n] ?? "").trim() === "");
c(
  "credentials",
  "credentials present in .env.local, by name",
  existsSync(join(ROOT, ".env.local")) ? (emptyNames.length === 0 ? "PASS" : "COULD_NOT_VERIFY") : "MISSING",
  existsSync(join(ROOT, ".env.local"))
    ? `${secretNames.length} credential name(s) set${emptyNames.length > 0 ? `; ${emptyNames.length} present but EMPTY: ${emptyNames.join(", ")}` : ""}`
    : ".env.local is absent",
  existsSync(join(ROOT, ".env.local"))
    ? emptyNames.length > 0
      ? "a variable that exists and is empty reads as configured and behaves as missing. Fill it or remove the line."
      : null
    : "create .env.local. `pnpm credentials` says which keys this repository uses and proves each by calling it — this check never calls anything.",
);
c(
  "credentials-validity",
  "whether those credentials actually work",
  "OPTIONAL",
  "not checked here, by design",
  "run `pnpm credentials`, which proves each key by calling its endpoint and writes docs/credential-ledger.md. A readiness check that authenticates can be rate-limited and can leak a token into an error.",
);

/*
 * THE TWO DATABASE URLS, and the one that is known not to authenticate.
 * DATABASE_URL points at a local Neon branch whose role was created on the
 * production branch and does not exist on the sibling, so no local run can
 * prove a write. That is a KNOWN state and it is COULD_NOT_VERIFY, never FAIL:
 * a check that cannot run has not found a problem.
 */
for (const key of ["DATABASE_URL", "WTP_PRODUCTION_DATABASE_URL_READONLY"]) {
  const raw = (ENV[key] ?? "").trim();
  if (raw === "") {
    c(`db:${key}`, `${key} is set`, "MISSING", `${key} is not set`, `set ${key} in .env.local.`);
    continue;
  }

  /*
   * **WELL-FORMED, WITHOUT CONNECTING — AND THIS IS A REAL LEAK PATH.**
   *
   * A malformed DSN is a genuine and common failure: a copied line that lost
   * its scheme, an unescaped `@` in a password, a trailing quote. It is worth
   * catching before a session spends ten minutes on a connection error.
   *
   * It is also the one place doctor is guaranteed to be HOLDING a credential
   * while something throws, because `new URL(bad)` puts the whole string it was
   * given into the message. So this check is both useful and the path
   * `tests/doctor-secrets.test.ts` drives its sentinel down: with redaction
   * off, the connection string reaches stdout and the JSON report from here.
   */
  /*
   * **WHICH DATABASE, AND IS THE VALUE WELL-FORMED — WITHOUT CONNECTING.**
   *
   * "Which one am I pointed at" is the operator-safety question this command
   * exists for: this repository has two database URLs, one local branch and one
   * production read-only handle, and confusing them is the mistake that cannot
   * be undone. The HOST answers it and the host is not secret.
   *
   * It is also a REAL LEAK PATH, which is why the check is shaped this way. On
   * a malformed value there is no host to extract, so the honest detail is the
   * value itself — and `redact` is the only thing standing between that and
   * stdout, a JSON report and whatever a human pastes them into.
   * `tests/doctor-secrets.test.ts` drives its sentinel down exactly this branch
   * and captures all three sinks; with redaction disabled, the credential
   * reaches every one of them.
   */
  let shape: string;
  let state: "COULD_NOT_VERIFY" | "FAIL" = "COULD_NOT_VERIFY";
  let fix =
    "presence, shape and host only — this check does not connect. Run `pnpm verify:readonly` to prove the read-only handle, and note that the local branch is known not to authenticate today.";
  try {
    const u = new URL(raw);
    shape = `set, parses as ${u.protocol.replace(":", "")}, host ${u.hostname}`;
  } catch {
    state = "FAIL";
    /*
     * Node's `Invalid URL` message deliberately omits the input, so the value
     * is included HERE, through `redact`, rather than being lost — an operator
     * whose DSN lost its scheme needs to see the shape of what is there.
     */
    shape = `does not parse as a URL: ${redact(raw, ENV)}`;
    fix = `${key} does not parse. Check for a missing scheme, an unescaped @ in the password, or a stray quote.`;
  }
  c(`db:${key}`, `${key} is set, well-formed, and points where you expect`, state, shape, fix);
}

/* ------------------------------------------------------------------- git */

try {
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24 })
    .split("\n")
    .filter(Boolean).length;
  c(
    "git",
    "git working tree",
    "PASS",
    `on ${branch}, ${dirty} changed path(s)`,
    null,
  );
  const email = execFileSync("git", ["config", "user.email"], { cwd: ROOT, encoding: "utf8" }).trim();
  c(
    "git-identity",
    "git commit identity",
    email ? "PASS" : "MISSING",
    email ? "user.email is set" : "user.email is unset",
    email ? null : "run `git config user.email <address>` — a commit with no identity cannot be attributed.",
  );
} catch (error) {
  c("git", "git working tree", "COULD_NOT_VERIFY", error, "run this inside a git repository.");
}

/* -------------------------------------------------------------- the shape */

const remediationMissing = results.filter(needsRemediation);
if (remediationMissing.length > 0) {
  /*
   * A check that reports a problem and no way to act on it is half a check,
   * and the half it is missing is the useful one. Refused here rather than
   * left for a reader to notice.
   */
  for (const r of remediationMissing) {
    r.remediation = "NO REMEDIATION RECORDED — this is a defect in pnpm doctor, not in your machine.";
  }
}

/* ------------------------------------------------------------- the report */

const ICON: Record<string, string> = {
  PASS: "ok  ",
  FAIL: "FAIL",
  MISSING: "MISS",
  COULD_NOT_VERIFY: "?   ",
  OPTIONAL: "opt ",
};

console.log("=".repeat(76));
console.log("pnpm run doctor — can this machine do the work?");
console.log("=".repeat(76));
for (const r of results) {
  console.log(`  ${ICON[r.state]} ${r.state.padEnd(17)} ${r.what}`);
  console.log(`       ${r.detail}`);
  if (r.state !== "PASS" && r.remediation) console.log(`       -> ${r.remediation}`);
}

const blocked = blocking(results);
console.log("");
console.log(
  `  ${floorLine(floored("checks that would stop a session", "the capabilities checked", results.length, blocked.length))}`,
);
console.log(
  `  PASS ${results.filter((r) => r.state === "PASS").length} · FAIL ${results.filter((r) => r.state === "FAIL").length} · ` +
    `MISSING ${results.filter((r) => r.state === "MISSING").length} · ` +
    `COULD_NOT_VERIFY ${results.filter((r) => r.state === "COULD_NOT_VERIFY").length} · ` +
    `OPTIONAL ${results.filter((r) => r.state === "OPTIONAL").length}`,
);
console.log(
  "  COULD_NOT_VERIFY is not a pass and not a failure. It means the check could not run,\n" +
    "  and a check that could not run has found nothing either way.",
);

const out = arg("json");
if (out) {
  /* The report goes through the same boundary as stdout: `check` redacted each
   * detail on the way in, so what is serialized here is already clean. */
  writeFileSync(
    out,
    `${JSON.stringify({ generatedAt: null, node, pnpm: redact(pnpmVersion, ENV), results }, null, 1)}\n`,
    "utf8",
  );
  console.log(`\nwrote ${out}`);
}

process.exit(blocked.length > 0 ? 1 : 0);
