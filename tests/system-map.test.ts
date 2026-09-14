/**
 * The Target Operating Model component renders faithfully and stays honest.
 *
 * Renders the actual <SystemMap/> with react-dom/server (out of process, via tsx —
 * the strip-types loader does not handle TSX) and asserts: the not-live banner is
 * present; every node, ring and journey from the model is on the page; code-name
 * labels appear (default on); the default selection's detail (purpose/next action)
 * renders; and the "not shown here" overlay boundary is stated. This is a static,
 * illustrative surface — the test also proves it names no live measurement as fact.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  SYSTEM_BANDS,
  SYSTEM_JOURNEYS,
  SYSTEM_NODES,
  SYSTEM_NOT_SHOWN,
  SYSTEM_RINGS,
} from "../lib/admin/system-map-model.ts";

function render(): string {
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { SystemMap } from './components/admin/system-map.tsx';
    console.log(renderToStaticMarkup(createElement(SystemMap)));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000, maxBuffer: 16_000_000 });
}

test("the system map renders the whole model, labelled as target architecture, not live status", () => {
  const html = render();

  // The honesty banner and its framing.
  assert.match(html, /TARGET OPERATING MODEL — NOT LIVE OPERATIONAL STATUS/);
  assert.match(html, /authorises no backend change/);
  assert.match(html, /belongs? to the Admin fleet operations overlay|belong to the Admin fleet operations overlay/);

  // Every node title and code-name (code-names default visible).
  for (const n of SYSTEM_NODES) {
    assert.ok(html.includes(escapeHtml(n.title)), `node title present: ${n.title}`);
    assert.ok(html.includes(escapeHtml(n.code)), `code-name present: ${n.code}`);
  }
  assert.equal(SYSTEM_NODES.length, 20);

  // The four layers, five rings, two journeys + architecture-only.
  for (const b of Object.values(SYSTEM_BANDS)) assert.ok(html.includes(escapeHtml(b.title)), `band: ${b.title}`);
  for (const r of SYSTEM_RINGS) assert.ok(html.includes(escapeHtml(r.title)), `ring: ${r.title}`);
  for (const j of SYSTEM_JOURNEYS) assert.ok(html.includes(escapeHtml(j.label)), `journey: ${j.label}`);
  assert.match(html, /Architecture only/);

  // The default selection (scheduler) detail renders its fields.
  const scheduler = SYSTEM_NODES.find((n) => n.id === "scheduler")!;
  assert.ok(html.includes(escapeHtml(scheduler.purpose)), "default detail purpose renders");
  assert.match(html, /Next action/i);
  assert.match(html, /Connected to/i);

  // The overlay boundary is named, not faked.
  for (const o of SYSTEM_NOT_SHOWN) assert.ok(html.includes(escapeHtml(o.title)), `not-shown: ${o.title}`);
  assert.match(html, /unavailable measurement stays unavailable/);
});

/** Match react-dom/server's HTML entity escaping for the assertions above. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
