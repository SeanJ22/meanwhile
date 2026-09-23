/**
 * Render smoke test for the fleet triage rework's remaining components
 * (BUILD.md §A, §B, §C, §E, §G). Each is rendered to static markup with a
 * minimal fixture; a render-time throw (an undefined value, a bad hook, a null
 * dereference) fails here rather than only on the authenticated page. Content
 * assertions confirm each component reached its own copy, not an error
 * boundary.
 *
 * Admin redesign, 2026-09-23: the /admin/fleet Decisions tab (§E) was removed —
 * decisions are answered on Fleet · Now — so the decisions render now smokes
 * the component that answers them there, `_mw/next-steps.tsx`. It renders
 * in-process through the test loader (which compiles TSX and reads the shell's
 * CSS module); the `tsx` child below cannot load a CSS module.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("the header, bands, triage, decisions and blind-spots components render", async () => {
  const html = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
    import { researchProgressHealth } from './lib/control-plane/research-progress-health.ts';
    import { FleetReadClock } from './components/admin/fleet-read-clock.tsx';
    import { FleetTriageBands } from './components/admin/fleet-triage-bands.tsx';
    import { FleetTriageTab } from './components/admin/fleet-triage-tab.tsx';
    import { FleetBlindSpotsTab } from './components/admin/fleet-blind-spots-tab.tsx';
    import { FleetTabStrip } from './components/admin/fleet-tab-strip.tsx';
    const noop = () => {};
    const router = { refresh: noop, push: noop, replace: noop, back: noop, forward: noop, prefetch: noop };
    const withRouter = (el) => h(AppRouterContext.Provider, { value: router }, el);
    const now = '2026-09-17T18:00:00.000Z';
    const progress = researchProgressHealth(null, now);
    const parts = [
      renderToStaticMarkup(withRouter(h(FleetReadClock, { observedAt: now }))),
      renderToStaticMarkup(h(FleetTriageBands, { counts: { red: 2, amber: 5, green: 3, dashed: 3 } })),
      renderToStaticMarkup(h(FleetTriageTab, { progress, findings: [], measured: { receipts: true, spend: true, coverage: true } })),
      renderToStaticMarkup(h(FleetTabStrip, { active: 'triage', badges: { decisions: 5, gaps: 9 } })),
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
  // Admin redesign, 2026-09-23: the tab strip offers no Decisions tab — a second queue would be a competing version of the one on Fleet · Now (an old link to it redirects there).
  const strip = html.split("<!--SEP-->")[3] ?? "";
  assert.match(strip, /class="fleet-tabs"/, "the fourth part is the tab strip");
  assert.match(strip, /Work in flight/);
  assert.doesNotMatch(strip, /tab=decisions|>Decisions</);
  // §G blind spots — count derived from the array length.
  assert.match(html, /9 things this page cannot see or do/);

  // §E decisions — answered on Fleet · Now: each card carries its options and, where it is a real fork, an answer in the owner's own words.
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
  const { NextSteps } = await import("../app/(admin)/_mw/next-steps.tsx");
  const noop = () => {};
  const router = { refresh: noop, push: noop, replace: noop, back: noop, forward: noop, prefetch: noop };
  const card = (rowId: string, kind: "DECISION" | "ACKNOWLEDGE") => ({
    rowId,
    rank: 1,
    title: `Card ${rowId}`,
    whatIsNeeded: "Decide whether to send the capture.",
    why: "It does not reproduce, so no machine can settle it.",
    options: kind === "DECISION" ? [{ option: "Send it", consequence: "placed against a build" }, { option: "Close it", consequence: "closes as unreproducible" }] : [{ option: "Acknowledge", consequence: "closes" }],
    priority: "P1",
    ageDays: 3,
    kind,
    blocker: null,
    ownWords: kind === "DECISION",
  });
  const steps = renderToStaticMarkup(
    h((AppRouterContext as unknown as { Provider: Parameters<typeof h>[0] }).Provider, { value: router } as never,
      h(NextSteps, { cards: [card("OWN01", "DECISION"), card("NH208", "ACKNOWLEDGE")], renderedRevision: "r|s|d", actionRoute: "/api/admin/action", liveRoute: "/api/admin/live", returnTo: "/admin", firstShown: 1 }),
    ),
  );
  assert.match(steps, /Card OWN01/);
  assert.match(steps, /P1 · WAITING 3 DAYS/);
  assert.match(steps, />Send it<\/button>.*>Close it<\/button>/, "the card's options are its buttons");
  assert.match(steps, />Something else<\/button>/, "a real fork can be answered in the owner's own words");
  assert.match(steps, /Show all 2/, "the stated count is the cards given, not the ones shown first");
  assert.doesNotMatch(steps, /Card NH208/, "only the first card is shown until the owner asks for all");
});
