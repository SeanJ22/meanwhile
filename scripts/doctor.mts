/**
 * `pnpm run doctor` — can this machine do the work? Every capability this
 * repository depends on, each with a state and a remediation. It is an
 * environment-readiness check, not the data-integrity one (`pnpm coverage`).
 *
 * Invoke it as `pnpm run doctor`: pnpm owns the verb `doctor`, and `pnpm
 * doctor` runs pnpm's own installation check instead.
 *
 * ```
 * pnpm run doctor
 * pnpm run doctor --json doctor.json
 * ```
 *
 * It never calls a credentialed endpoint: credentials are reported PRESENT or
 * MISSING by name only (`pnpm credentials` proves them by calling). Everything
 * printed or written goes through `redact`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { resolveChromium, describeChromium } from "../lib/ops/chromium-pin.ts";

const ROOT = process.cwd();

type CheckState = "PASS" | "FAIL" | "MISSING" | "COULD_NOT_VERIFY" | "OPTIONAL";

interface CheckResult {
  id: string;
  what: string;
  state: CheckState;
  detail: string;
  remediation: string | null;
}

const SECRET_NAME_SHAPES: readonly RegExp[] = [
  /KEY$/i,
  /_KEY_/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /DATABASE_URL/i,
  /_URL$/i,
  /_DSN$/i,
  /AUTH/i,
  /SIGNING/i,
  /PRIVATE/i,
];

function nameLooksSecret(name: string): boolean {
  return SECRET_NAME_SHAPES.some((shape) => shape.test(name));
}

const SECRET_VALUE_SHAPES: readonly { re: RegExp; as: string }[] = [
  { re: /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]+:[^\s/@]+@/gi, as: "$1://<credentials-removed>@" },
  { re: /\bauthorization["'\s:=]+(bearer|basic|token)?\s*[^\s"',}]+/gi, as: "authorization: <removed>" },
  { re: /([?&](?:api[_-]?key|key|token|access[_-]?token|secret)=)[^&\s"']+/gi, as: "$1<removed>" },
  // 24+ characters, so an ordinary word, a short git SHA or an OCD id never matches.
  { re: /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\b/g, as: "<token-removed>" },
  { re: /\b(?:sk|pk|ghp|gho|ghs|glpat|xox[baprs])[_-][A-Za-z0-9_-]{8,}\b/gi, as: "<token-removed>" },
];

/** The only way text leaves this script: known secret values first, then secret-shaped text. */
function redact(text: unknown, env: Record<string, string | undefined>): string {
  let s: string;
  if (text instanceof Error) s = `${text.name}: ${text.message}`;
  else if (typeof text === "string") s = text;
  else {
    try {
      s = JSON.stringify(text);
    } catch {
      s = "<unserializable>";
    }
  }
  if (s === "") return s;
  const values = Object.entries(env)
    .filter(([name, value]) => typeof value === "string" && value.length >= 8 && nameLooksSecret(name))
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
  for (const v of values) s = s.split(v).join("<redacted>");
  for (const { re, as } of SECRET_VALUE_SHAPES) s = s.replace(re, as);
  return s;
}

function check(
  id: string,
  what: string,
  state: CheckState,
  detail: unknown,
  remediation: string | null,
  env: Record<string, string | undefined>,
): CheckResult {
  return { id, what, state, detail: redact(detail, env), remediation };
}

function needsRemediation(r: CheckResult): boolean {
  return r.state !== "PASS" && r.state !== "OPTIONAL" && (r.remediation ?? "").trim().length === 0;
}

function blocking(results: readonly CheckResult[]): CheckResult[] {
  return results.filter((r) => r.state === "FAIL" || r.state === "MISSING");
}

/** pnpm sets `npm_config_user_agent` for every script it runs; spawn only when not run through pnpm. */
function detectPnpm(userAgent: string | undefined, spawn: () => string): { version: string | null; error: unknown } {
  const fromUa = /(?:^|\s)pnpm\/(\S+)/.exec(userAgent ?? "");
  if (fromUa) return { version: fromUa[1], error: null };
  try {
    return { version: spawn().trim() || null, error: null };
  } catch (error) {
    return { version: null, error };
  }
}

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

/* Reports which pnpm is on PATH rather than assuming; corepack-routed pnpm breaks child processes. */
let pnpmVersion = "";
let pnpmError: unknown = null;
const detected = detectPnpm(process.env.npm_config_user_agent, () =>
  /* With a shell, so Windows resolves the `pnpm.cmd` shim. */
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
    "install pnpm and put it on PATH.",
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

/* `tsc --noEmit` reads generated route types out of `.next/types`, so it needs a build first. */
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
    path: "data/states/az/geo/body-territories.geojson",
    what: "territories for governments with no Census division",
    how: "recover it from git. Without it, districts smaller than any division reach no reader (NH233).",
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

/* Names and presence only: never a value, a prefix or a length. */
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
  "run `pnpm credentials`, which proves each key by calling its endpoint and prints the result. A readiness check that authenticates can be rate-limited and can leak a token into an error.",
);

/*
 * Presence, shape and host only, without connecting. The local branch is known
 * not to authenticate, so an unconnected check is COULD_NOT_VERIFY, never FAIL.
 * A malformed value has no host to show, so the value itself goes through `redact`.
 */
for (const key of ["DATABASE_URL", "WTP_PRODUCTION_DATABASE_URL_READONLY"]) {
  const raw = (ENV[key] ?? "").trim();
  if (raw === "") {
    c(`db:${key}`, `${key} is set`, "MISSING", `${key} is not set`, `set ${key} in .env.local.`);
    continue;
  }

  let shape: string;
  let state: "COULD_NOT_VERIFY" | "FAIL" = "COULD_NOT_VERIFY";
  let fix =
    "presence, shape and host only — this check does not connect. Run `pnpm verify:readonly` to prove the read-only handle, and note that the local branch is known not to authenticate today.";
  try {
    const u = new URL(raw);
    shape = `set, parses as ${u.protocol.replace(":", "")}, host ${u.hostname}`;
  } catch {
    state = "FAIL";
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
  /* `check` redacted each detail on the way in. */
  writeFileSync(
    out,
    `${JSON.stringify({ generatedAt: null, node, pnpm: redact(pnpmVersion, ENV), results }, null, 1)}\n`,
    "utf8",
  );
  console.log(`\nwrote ${out}`);
}

process.exit(blocked.length > 0 ? 1 : 0);
