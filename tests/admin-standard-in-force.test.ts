/**
 * **EVERY ADMIN HEADER NAMES THE READINESS STANDARD IN FORCE.** (2026-09-25.)
 *
 * Every Fleet page's strip said "STANDARD not versioned yet" because the pages
 * passed `standard: null` by hand, while the standard is versioned data
 * (MW-063, `lib/control-plane/readiness/standard.json`) and the Readiness pages
 * already named it. The page base now carries the version in force, read from
 * the manifest (no second copy of its id), and every page hands the strip that
 * — or what its own readings were measured under. "Not versioned yet" is left
 * for the one case it is true: a manifest whose `current` names no version.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MwShell, standardWords } from "@/app/(admin)/_mw/shell.tsx";
import { READINESS_STANDARD, standardInForce, type ReadinessStandard } from "@/lib/control-plane/readiness/standard.ts";
import { filesThatWouldBeCommitted } from "@/lib/ops/repo-files.ts";

const ROOT = join(import.meta.dirname, "..");

test("the standard in force is the manifest's current version, and is absent only when the manifest names none", () => {
  assert.equal(standardInForce(), READINESS_STANDARD.current);
  assert.notEqual(standardInForce(), null, "today's manifest names a version in force");
  const unversioned: ReadinessStandard = { ...READINESS_STANDARD, current: "readiness/no-such-version@9" };
  assert.equal(standardInForce(unversioned), null, "a current id with no version on the list is not versioned");
});

/** Every Admin file that draws the shell. */
function shellPages(): readonly string[] {
  return filesThatWouldBeCommitted({ cwd: ROOT, paths: ["app/(admin)"] })
    .filter((f) => f.startsWith("app/(admin)/") && /\.tsx?$/.test(f))
    .filter((f) => readFileSync(join(ROOT, f), "utf8").includes("<MwShell"));
}

test("no Admin page hands the strip a hard-coded standard: each takes the page base's, or what its own readings were measured under", () => {
  const pages = shellPages();
  assert.ok(pages.length >= 5, `expected every redesigned page, saw ${pages.length}`);
  const findings: string[] = [];
  for (const file of pages) {
    const source = readFileSync(join(ROOT, file), "utf8");
    // `standard: null`, `null as string | null`, or a contract constant (a second copy of the id) all fail here.
    const props = [...source.matchAll(/^\s*standard:\s*(.+?),?\s*$/gm)].map((m) => m[1]);
    if (props.length === 0) findings.push(`${file}: draws the shell with no standard of its own`);
    for (const value of props) if (value !== "base.standard") findings.push(`${file}: standard: ${value}`);
    // A later assignment may name the page's own measurement, and falls back to the standard in force — never to null.
    for (const m of source.matchAll(/shellProps\.standard\s*=([\s\S]*?);/g)) {
      if (/:\s*null\s*$/.test(m[1].trim()) || !m[1].includes("base.standard")) findings.push(`${file}: shellProps.standard =${m[1].trim()}`);
    }
  }
  assert.deepEqual(findings, []);
});

test("the strip names the standard it is handed, and says 'not versioned yet' only for none", async () => {
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
  const noop = () => {};
  const router = { refresh: noop, push: noop, replace: noop, back: noop, forward: noop, prefetch: noop };
  const draw = (standard: string | null) =>
    renderToStaticMarkup(
      h(
        (AppRouterContext as unknown as { Provider: Parameters<typeof h>[0] }).Provider,
        { value: router } as never,
        h(MwShell, {
          area: "fleet",
          tab: "now",
          scope: { kind: "all" },
          scopeLabel: "Everywhere · 3 tracked states",
          scopeGroups: [{ label: null, options: [{ value: "all", label: "Everywhere · 3 tracked states" }] }],
          here: "/admin",
          observedAt: "2026-09-25T20:00:00.000Z",
          standard,
          children: null,
        }),
      ),
    );
  const inForce = draw(standardInForce());
  assert.ok(inForce.includes(standardWords(READINESS_STANDARD.current)), "the strip names the version in force, in words");
  assert.ok(inForce.includes(`title="${READINESS_STANDARD.current}"`), "and keeps the exact id on hover for anyone who needs it");
  assert.ok(!inForce.includes("not versioned yet"));
  assert.ok(draw(null).includes("not versioned yet"), "and says so when there is none");
});
