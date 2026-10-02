/**
 * **THE SOURCE / API CAPABILITY REGISTRY'S SEEDED FAILURES.** (ADM-C11, §6 and
 * §7 of the Admin C brief, 2026-09-06.)
 *
 * Each of these is a defect that would be invisible in normal use — the page
 * would look right and be wrong:
 *
 * ```
 *   1  a credential VALUE or a variable NAME reaching a built row, and from
 *      there the browser
 *   2  a key that lives with an off-host acquisition process being reported as "not
 *      configured" because this process cannot see that store — a falsehood
 *      with a tick beside it
 *   3  a routine-data GitHub clock coming back while the page reports the
 *      terminal software-CI-only boundary
 *   4  a disposition vocabulary the owner cannot tell apart, because a member
 *      is unreachable or two members mean the same thing
 *   5  a NOT_APPLICABLE with no justification behind it
 *   6  a "named in the handoff, absent from this repository" claim that is
 *      typed rather than measured, and goes stale the day somebody wires it
 *   7  the page burning an API call to draw itself
 *   8  a stated N over a list of a different length, or a number with no
 *      denominator
 * ```
 *
 * Every detector that could look at nothing has a positive control beside it.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { auditRenderedNumbers } from "@/lib/control-plane/owner-surface.ts";
import { isEnvVarName } from "@/lib/control-plane/plain-words.ts";
import { checkCredentialReport, readCredentialStores } from "@/lib/ops/credential-report.ts";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");

/** Every screaming-snake token inside a serialised row, wherever it sits. */
function snakeTokensIn(value: unknown): string[] {
  return [...JSON.stringify(value).matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)].map((m) => m[0]);
}

test("ADM-C11: the name detector catches a planted one", () => {
  const planted = { id: "planted", spendConcern: "set FEC_API_KEY and WTP_ADMIN_SECRET first" };
  const caught = snakeTokensIn(planted).filter((t) => isEnvVarName(t));
  assert.deepEqual(caught.sort(), ["FEC_API_KEY", "WTP_ADMIN_SECRET"], "the detector missed a planted name");
});

/** Whether workflow text declares a cron. Comments do not count. */
function workflowHasSchedule(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l));
  const body = lines.join("\n");
  return /^\s{2}schedule:/m.test(body) && /cron:/.test(body);
}

test("§7: every obsolete refresh workflow definition is deleted", () => {
  const refreshFiles = readdirSync(WORKFLOWS).filter((file) => /^refresh-.*\.ya?ml$/.test(file));
  assert.deepEqual(refreshFiles, []);
});

test("§7: GitHub carries no routine data or operations clock", () => {
  const workflows = readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));
  /*
   * One exemption, by exact name and exact cron (2026-10-02, owner's CI cost
   * order via S0): Build Check's hourly run certifies SOFTWARE — the whole test
   * suite on main's tip, the safety net behind affected-only pull-request
   * tests. It reads and writes no civic data and runs no operation; it is the
   * same read-only workflow a push runs.
   */
  const softwareCertification = (file: string, text: string) =>
    file === "build-check.yml" && /^\s{2}schedule:\s*\n\s{4}- cron: '17 \* \* \* \*'\s*$/m.test(text);
  const scheduled = workflows.filter((file) => {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    return workflowHasSchedule(text) && !softwareCertification(file, text);
  });
  assert.deepEqual(scheduled, [], `scheduled GitHub workflow(s) survived PDC: ${scheduled.join(", ")}`);
});

test("§7: the terminal-zero workflow detector catches a planted cron", () => {
  assert.equal(workflowHasSchedule("name: planted\non:\n  schedule:\n    - cron: '0 0 * * *'\n"), true);
  assert.equal(workflowHasSchedule("#   schedule:\n#     - cron: '0 0 * * *'\non:\n  push:\n"), false);
});

test("ADM-C11: the no-call detector catches a call", () => {
  const planted = "async function draw() { const r = await fetch('https://api.open.fec.gov/v1/candidates/'); return r; }";
  assert.ok(/\bfetch\s*\(/.test(stripComments(planted)), "the detector missed a plain fetch");
  assert.ok(!/\bfetch\s*\(/.test(stripComments("// await fetch(url) was removed here\n")), "a comment is not a call");
});

/** Block and line comments removed, so a comment about a defect is not the defect. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

test("ADM-C11: the audit catches a number with no denominator", () => {
  const verdict = auditRenderedNumbers([{ label: "planted", value: 14, denominator: null, contract: "some contract" }]);
  assert.equal(verdict.ok, false, "the audit accepted a bare number");
});

test("ADM-C11: a credential event may say which store it landed in, and a store nobody can name is refused", () => {
  const complete = {
    kind: "CREATED",
    reportedAt: "2026-09-06",
    name: "the standing data runner's state-vote key",
    provider: "LegiScan",
    context: "standing production acquisition",
    scope: "read the published dataset",
    actor: "the owner",
    ownerCopyLocation: "the private settings file, under the key's own name",
  };

  assert.deepEqual(checkCredentialReport(complete), { ok: true }, "the field is optional; an older event is not retroactively incomplete");
  assert.deepEqual(
    checkCredentialReport({ ...complete, stores: ["REFRESH_JOB", "WORKSTATION"] }),
    { ok: true },
    "a report naming real stores passes",
  );

  for (const bad of [[], ["EVERYWHERE"], "REFRESH_JOB", [7], null]) {
    const verdict = checkCredentialReport({ ...complete, stores: bad });
    assert.equal(verdict.ok, false, `stores ${JSON.stringify(bad)} should be refused`);
    if (!verdict.ok) {
      assert.deepEqual(verdict.missing, ["stores"], `stores ${JSON.stringify(bad)} names exactly that field`);
      assert.deepEqual(verdict.refused, [], "an unusable store list is not a leaked value");
    }
  }

  assert.deepEqual(readCredentialStores(["SITE_RUNTIME"]), { ok: true, stores: ["SITE_RUNTIME"] });
  assert.deepEqual(readCredentialStores(["site_runtime"]), { ok: false }, "the store list is case-exact");
});
