import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * M26 — the narrowing prompt, held to its spec: the author's verbatim
 * wording, the computed ambiguity trigger, and the device-locality claims.
 */

const ROOT = join(import.meta.dirname, "..");

test("the approved wording is verbatim in the component — never paraphrased", () => {
  const source = readFileSync(
    join(ROOT, "components", "map", "narrowing-prompt.tsx"),
    "utf8",
  );
  // The two approved sentences (docs/state.md §9). The counts are computed,
  // so the first sentence appears as its template parts around them.
  assert.ok(source.includes(". Do you want to narrow it?"));
  assert.ok(
    source.includes(
      "What&apos;s the street you live on? That will help us narrow it",
    ),
  );
  assert.ok(source.includes("no house or apartment number needed"));
});

test("the street index exists for the exemplar zips, ambiguity computed", () => {
  const summary = JSON.parse(
    readFileSync(join(ROOT, "lib", "registry", "street-index-summary.json"), "utf8"),
  ) as { zips: Record<string, { municipalities: number; schoolDistricts: number; streets: number }> };

  // The two exemplars the author named. Counts are whatever the data says —
  // asserted >1 on at least one axis (the trigger), never a literal.
  for (const zip of ["85641", "07866"]) {
    const entry = summary.zips[zip];
    assert.ok(entry, `${zip} must be in the ambiguity summary`);
    assert.ok(
      entry.municipalities > 1 || entry.schoolDistricts > 1,
      `${zip}: the prompt only exists where the answer changes`,
    );
    assert.ok(entry.streets > 0, `${zip}: an index with no streets is broken`);
    // The per-zip file the client fetches actually exists and parses.
    const file = JSON.parse(
      readFileSync(join(ROOT, "public", "streets", `${zip}.json`), "utf8"),
    ) as { municipalities: unknown[]; schoolDistricts: unknown[]; streets: Record<string, unknown> };
    assert.equal(file.municipalities.length, entry.municipalities);
    assert.equal(file.schoolDistricts.length, entry.schoolDistricts);
    assert.equal(Object.keys(file.streets).length, entry.streets);
  }
});

test("every written index file is ambiguous — no prompt where nothing changes", () => {
  const summary = JSON.parse(
    readFileSync(join(ROOT, "lib", "registry", "street-index-summary.json"), "utf8"),
  ) as { zips: Record<string, { municipalities: number; schoolDistricts: number }> };
  const files = readdirSync(join(ROOT, "public", "streets")).filter((n) =>
    n.endsWith(".json"),
  );
  assert.equal(
    files.length,
    Object.keys(summary.zips).length,
    "summary and files drifted",
  );
  for (const [zip, entry] of Object.entries(summary.zips)) {
    assert.ok(
      entry.municipalities > 1 || entry.schoolDistricts > 1,
      `${zip}: an unambiguous zip must not carry a prompt file`,
    );
  }
});

test("the narrowing store never transmits — the code has no network write", () => {
  const hook = readFileSync(join(ROOT, "hooks", "use-narrowing.ts"), "utf8");
  // The hook owns the two keys and must be purely local: no fetch, no
  // beacon, no XHR anywhere in it.
  assert.ok(hook.includes("wtp.selected_divisions"));
  assert.ok(hook.includes("wtp.selected_street"));
  for (const banned of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket"]) {
    assert.ok(!hook.includes(banned), `use-narrowing.ts must not contain ${banned}`);
  }
});
