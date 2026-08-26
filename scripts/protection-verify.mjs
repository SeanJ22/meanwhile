#!/usr/bin/env node
/**
 * `pnpm protection:verify` — is the protection on `main` still what we think?
 * (2026-08-26, the unblock-pushers session. RULING 163.)
 *
 * The judgement lives in `lib/ops/protection-state.ts` and has no network in
 * it, so the intended end state is testable. This file is the I/O and nothing
 * else: it reads the live GitHub API and prints the verdict.
 *
 * IT ASKS THE SERVER, DELIBERATELY. Every other gate in this repo answers a
 * question about the working tree. Branch protection is not in the tree — it is
 * edited in a web UI by a person, under no diff and no review, and the only
 * place the truth exists is the server (RULING 75's third part, RULING 125's
 * reason for asking Netlify rather than the site).
 *
 * EXIT CODES:  0 intact · 1 drifted · 2 could-not-tell.
 *
 * `cannot-tell` exits NON-ZERO on purpose. No credential is not a pass.
 *
 * **IT IS STANDALONE, AND IT IS NOT WIRED INTO `pnpm gates` — `NH205`.**
 * Reading branch protection needs an ADMIN-scoped token. Putting an admin token
 * into CI so that CI can check that CI cannot bypass protection hands every
 * workflow the credential that would let it edit the protection it is checking.
 * The check would then be verifying a rule it had just been given the power to
 * remove, which is RULING 147's compare-a-parser-to-itself one floor up and a
 * far worse trade than running this by hand from a session. It runs at
 * close-out, by a person or a session that already holds the token, and it says
 * `cannot-tell` and exits non-zero anywhere that does not.
 *
 * Usage:
 *   node scripts/protection-verify.mjs
 *   node scripts/protection-verify.mjs --json
 */

import { spawnSync } from "node:child_process";

import { judgeProtection } from "../lib/ops/protection-state.ts";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";

const REPO = "SeanJ22/We-The-People";

/**
 * One authenticated read. Returns `{ ok, body }` rather than throwing, so the
 * caller decides what a failure means — and a 404 on the classic-protection
 * endpoint is a legitimate ANSWER ("no classic protection"), not a failure.
 */
function api(path) {
  const r = spawnSync("gh", ["api", path], {
    encoding: "utf8",
    shell: false,
    env: { ...process.env, GH_PROMPT: "disabled", GH_PAGER: "cat" },
  });
  if (r.error) return { ok: false, notFound: false, reason: String(r.error.message ?? r.error) };
  const out = (r.stdout ?? "").trim();
  const err = (r.stderr ?? "").trim();
  if (r.status !== 0) {
    // "Branch not protected" comes back 404 and is a real answer.
    const notFound = /HTTP 404|Branch not protected/i.test(err);
    return { ok: false, notFound, reason: err || `gh exited ${r.status}` };
  }
  try {
    return { ok: true, notFound: false, body: JSON.parse(out) };
  } catch (e) {
    return { ok: false, notFound: false, reason: `unparseable JSON from ${path}: ${String(e)}` };
  }
}

function read() {
  const unreachable = [];

  const classicRes = api(`repos/${REPO}/branches/main/protection`);
  let classic = null;
  if (classicRes.ok) classic = classicRes.body;
  else if (classicRes.notFound) classic = null;
  else unreachable.push(`branches/main/protection: ${classicRes.reason}`);

  const listRes = api(`repos/${REPO}/rulesets`);
  const rulesets = [];
  if (listRes.ok) {
    for (const r of listRes.body ?? []) {
      // The list endpoint omits rules and bypass_actors; only the per-id read
      // carries them, and judging a ruleset without its rules would report a
      // ruleset with no required checks as one with none required.
      const full = api(`repos/${REPO}/rulesets/${r.id}`);
      if (full.ok) rulesets.push(full.body);
      else unreachable.push(`rulesets/${r.id}: ${full.reason}`);
    }
  } else if (!listRes.notFound) {
    unreachable.push(`rulesets: ${listRes.reason}`);
  }

  /*
   * THE DEPLOY KEYS, BECAUSE THE BYPASS IS GRANTED TO THE CATEGORY.
   * (2026-08-26, RULING 165.)
   *
   * `bypass_actors` names `DeployKey` with `actor_id: null` — there is no way
   * to grant it to ONE key. Every write-enabled deploy key on this repository
   * therefore holds the bypass, so the count belongs in the protection reading
   * and not in a separate report somebody remembers to run.
   *
   * `null` when unread, which is NOT an empty list: a count nobody could read
   * must never be judged as one.
   */
  const keysRes = api(`repos/${REPO}/keys`);
  let deployKeys = null;
  if (keysRes.ok) deployKeys = keysRes.body ?? [];
  else unreachable.push(`keys: ${keysRes.reason}`);

  return { classic, rulesets, deployKeys, complete: unreachable.length === 0, unreachable };
}

const reading = read();
const report = judgeProtection(reading, REQUIRED_CONTEXTS);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...report, reading: { shape: report.shape, unreachable: reading.unreachable } }, null, 2));
} else {
  console.log(`\nprotection:verify · ${REPO} · main\n`);
  for (const a of report.assertions) {
    const mark = a.ok === true ? "PASS" : a.ok === false ? "FAIL" : "????";
    console.log(`  [${mark}] ${a.name}`);
    console.log(`         ${a.detail}`);
  }
  console.log(`\n  ${report.summary}\n`);
}

process.exit(report.verdict === "intact" ? 0 : report.verdict === "drifted" ? 1 : 2);
