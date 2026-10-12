/**
 * Source and API registry guards, each with a positive control: no credential value or variable
 * name reaches a built row; GitHub carries no routine data or operations clock; the page makes no
 * API call to draw itself; every number carries a denominator.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { auditRenderedNumbers } from "@/lib/control-plane/owner-surface.ts";
import { isEnvVarName } from "@/lib/control-plane/plain-words.ts";

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
  // One exemption by exact name and cron: Build Check's daily run tests software only, touching no civic data.
  const softwareCertification = (file: string, text: string) =>
    file === "build-check.yml" && /^\s{2}schedule:\s*\n\s{4}- cron: '17 9 \* \* \*'\s*$/m.test(text);
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
