/**
 * The panels tab (BUILD.md §F) renders the six panels split by whether a
 * producer exists, reads ONLY the owner snapshot (never the fleet-activity
 * scan), and keeps the honesty the panels always carried: no-producer panels
 * are named not faked, publication is UNKNOWN, and spending is three separate
 * rows so a known subtotal of zero and an unknown total stay distinct. These
 * assertions moved here from the map test when the panels moved to their tab.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

import { readFleetPanels } from "../lib/control-plane/fleet-operations.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

function renderPanels(reading: unknown, scratchDir: string): string {
  const file = join(scratchDir, "panels-reading.json");
  writeFileSync(file, JSON.stringify(reading));
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { readFileSync } from 'node:fs';
    import { FleetPanelsTab } from './components/admin/fleet-panels-tab.tsx';
    const reading = JSON.parse(readFileSync(${JSON.stringify(file)}, 'utf8'));
    console.log(renderToStaticMarkup(createElement(FleetPanelsTab, { reading })));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000, maxBuffer: 16_000_000 });
}

test("the panels tab splits by producer and keeps every panel's honesty", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "fleet-panels-"));
  t.after(async () => {
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("fleet-panels-"));
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  });

  const repos = createMemoryRepositories();
  const reading = await readFleetPanels(repos, { observedAt: "2026-09-17T18:00:00.000Z" });
  const html = renderPanels(reading, dir);

  // Both group headers, derived from the panel metadata.
  assert.match(html, /Reads something · 3/);
  assert.match(html, /No producer · 3/);
  // Every panel is present by title.
  for (const p of ["Promotion receipts", "Served publication", "Spending", "Coverage gaps", "Throughput over time", "Reader demand"]) {
    assert.ok(html.includes(p), `panel: ${p}`);
  }
  // Served publication is UNKNOWN, named not faked.
  assert.match(html, /publication\.status/i);
  assert.match(html, /UNKNOWN/);
  // With no cost summary on the snapshot, spending is "not measured" — never a bare $0.
  assert.match(html, /Not measured — the owner snapshot carries no cost summary/);
  assert.ok(!/\$0\.00/.test(html), "spending never prints a bare $0.00");
  // The dashed no-producer group is not amber, and the footer's delivery note is present.
  assert.match(html, /no producer anywhere in the codebase/i);
  assert.match(html, /deliveryFreshness/);

  // With a cost summary present, spending is three distinct rows — a known
  // subtotal of zero and an unknown total stay separate statements.
  const withSpend = { ...reading, spending: { measuredUsd: 0.03, attemptsMeasured: 3, attemptsUnmeasured: 2, entries: 5 } };
  const spendHtml = renderPanels(withSpend, dir);
  assert.match(spendHtml, /Measured<\/dt><dd[^>]*>\$0\.03/);
  assert.match(spendHtml, /Unmeasured rows<\/dt><dd[^>]*>present/);
  assert.match(spendHtml, /Total<\/dt><dd[^>]*>unknown/);
});
