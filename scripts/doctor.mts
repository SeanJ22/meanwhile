import { productionKeysStore } from "../lib/core/keys-store.ts";
import { storedKeyEnvironment } from "../lib/core/keys-values.ts";
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
 * It reports saved credential test results from the control plane. Everything
 * printed or written goes through `redact`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
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

const nameLooksSecret = (name: string) => /KEY$|_KEY_|TOKEN|SECRET|PASSW(?:OR)?D|CREDENTIAL|DATABASE_URL|_URL$|_DSN$|AUTH|SIGNING|PRIVATE/i.test(name);

const SECRET_VALUE_SHAPES: readonly { re: RegExp; as: string }[] = [
  { re: /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]+:[^\s/@]+@/gi, as: "$1://<credentials-removed>@" },
  { re: /\bauthorization["'\s:=]+(bearer|basic|token)?\s*[^\s"',}]+/gi, as: "authorization: <removed>" },
  { re: /([?&](?:api[_-]?key|key|token|access[_-]?token|secret)=)[^&\s"']+/gi, as: "$1<removed>" },
  // 24+ characters, so an ordinary word, a short git SHA or an OCD id never matches.
  { re: /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\b/g, as: "<token-removed>" },
  { re: /\b(?:sk|pk|ghp|gho|ghs|glpat|xox[baprs])[_-][A-Za-z0-9_-]{8,}\b/gi, as: "<token-removed>" },
];

/** Redact saved values and common credential forms before reporting diagnostics. */
function redact(text: unknown, env: Record<string, string | undefined>): string {
  let output: string;
  try { output = text instanceof Error ? `${text.name}: ${text.message}` : typeof text === "string" ? text : JSON.stringify(text); }
  catch { output = "<unserializable>"; }
  const values = Object.entries(env).filter(([name, value]) => value && value.length >= 8 && nameLooksSecret(name)).map(([, value]) => value!).sort((a,b) => b.length-a.length);
  for (const value of values) output = output.split(value).join("<redacted>");
  for (const { re, as } of SECRET_VALUE_SHAPES) output = output.replace(re, as);
  return output;
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

/** The full environment, for REDACTION. Never for printing. */
const ENV: Record<string, string | undefined> = { ...storedKeyEnvironment() };

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

try {
  const keys = await productionKeysStore().list();
  const working = keys.filter(key => key.working).length;
  c("credentials", "saved keys", keys.length && working === keys.length ? "PASS" : "COULD_NOT_VERIFY",
    keys.length ? `${keys.length} saved keys; ${working} Working; ${keys.length - working} Not working` : "The Keys box has no saved keys.",
    keys.length && working === keys.length ? null : "Check the Keys box in Admin Settings. The runner tests saved keys daily.");
} catch {
  c("credentials", "saved keys", "COULD_NOT_VERIFY", "This session could not reach the saved keys.", "Use a runner session with access to the Keys box; saved values do not need to be pasted again.");
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
