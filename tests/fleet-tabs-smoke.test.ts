/**
 * Render smoke test for the fleet triage rework's remaining components
 * (BUILD.md §A, §B, §C, §E, §G). Each is rendered to static markup with a
 * minimal fixture; a render-time throw (an undefined value, a bad hook, a null
 * dereference) fails here rather than only on the authenticated page. Content
 * assertions confirm each component reached its own copy, not an error
 * boundary.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("the header, bands, triage, decisions and blind-spots components render", () => {
  const html = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
    import { researchProgressHealth } from './lib/control-plane/research-progress-health.ts';
    import { FleetReadClock } from './components/admin/fleet-read-clock.tsx';
    import { FleetTriageBands } from './components/admin/fleet-triage-bands.tsx';
    import { FleetTriageTab } from './components/admin/fleet-triage-tab.tsx';
    import { FleetDecisionsTab } from './components/admin/fleet-decisions-tab.tsx';
    import { FleetBlindSpotsTab } from './components/admin/fleet-blind-spots-tab.tsx';
    const noop = () => {};
    const router = { refresh: noop, push: noop, replace: noop, back: noop, forward: noop, prefetch: noop };
    const withRouter = (el) => h(AppRouterContext.Provider, { value: router }, el);
    const now = '2026-09-17T18:00:00.000Z';
    const progress = researchProgressHealth(null, now);
    const parts = [
      renderToStaticMarkup(withRouter(h(FleetReadClock, { observedAt: now }))),
      renderToStaticMarkup(h(FleetTriageBands, { counts: { red: 2, amber: 5, green: 3, dashed: 3 } })),
      renderToStaticMarkup(h(FleetTriageTab, { progress, findings: [], measured: { receipts: true, spend: true, coverage: true } })),
      renderToStaticMarkup(withRouter(h(FleetDecisionsTab, { cards: [], stateVersion: 'v1' }))),
      renderToStaticMarkup(h(FleetBlindSpotsTab, {})),
    ];
    console.log(parts.join('\\n<!--SEP-->\\n'));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000, maxBuffer: 16_000_000 });

  // §A read clock — the honest no-cycle sentence.
  assert.match(html, /Nothing re-reads this page/);
  // §B bands — all four, derived counts, the dashed one named.
  assert.match(html, /Makes the rest unreliable/);
  assert.match(html, /Decisions in this queue/);
  assert.match(html, /No producer/);
  // §C triage — the ledger groups render even with no red findings.
  assert.match(html, /Everything else, by what you can do about it/);
  assert.match(html, /Measured · 4/);
  // §E decisions — the worked-card framing and the derived heading.
  assert.match(html, /How you answer one/);
  assert.match(html, /0 decisions\./);
  // §G blind spots — count derived from the array length.
  assert.match(html, /9 things this page cannot see or do/);
});
