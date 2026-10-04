/**
 * FE-16: each page measurement lists its issue with the element, over
 * synthetic observations. The browser half (collectPageObservation) is run by
 * the harnesses against a real page.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  collectPageObservation,
  contrastRatio,
  measurePage,
  type ObservedElement,
  type PageObservation,
} from "../lib/health/page-metrics.ts";

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

function el(over: Partial<ObservedElement> = {}): ObservedElement {
  return {
    selector: "div.card > p.line",
    text: "Council meets Tuesday",
    rect: { x: 16, y: 100, width: 300, height: 48 },
    interactive: false,
    compact: false,
    hasOwnText: true,
    fontSizePx: 14,
    fontWeight: 400,
    spacingPx: [{ property: "padding-top", value: 16 }],
    scrollWidth: 300,
    clientWidth: 300,
    scrollHeight: 48,
    clientHeight: 48,
    overflowX: "visible",
    overflowY: "visible",
    textOverflow: "clip",
    color: BLACK,
    background: WHITE,
    ...over,
  };
}

function page(elements: ObservedElement[], over: Partial<PageObservation> = {}): PageObservation {
  return {
    url: "https://example.test/",
    viewport: { width: 390, height: 844 },
    documentScrollWidth: 390,
    layoutShifts: [],
    elements,
    ...over,
  };
}

test("a clean page lists nothing", () => {
  const r = measurePage(page([el()]));
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.notMeasured, []);
});

test("layout shift over the bar is listed; input-caused shifts do not count", () => {
  const bad = measurePage(page([], { layoutShifts: [{ value: 0.08, hadRecentInput: false }, { value: 0.06, hadRecentInput: false }] }));
  assert.equal(bad.issues[0].kind, "layout-shift");
  const fine = measurePage(page([], { layoutShifts: [{ value: 0.5, hadRecentInput: true }] }));
  assert.deepEqual(fine.issues, []);
});

test("no recorder is 'not measured', never a pass", () => {
  const r = measurePage(page([], { layoutShifts: null }));
  assert.equal(r.issues.length, 0);
  assert.equal(r.notMeasured[0].kind, "layout-shift");
});

test("horizontal overflow names the page and the element", () => {
  const r = measurePage(
    page([el({ selector: "table.votes", rect: { x: 0, y: 0, width: 500, height: 40 } })], { documentScrollWidth: 500 }),
  );
  const kinds = r.issues.filter((i) => i.kind === "horizontal-overflow").map((i) => i.element);
  assert.deepEqual(kinds, ["page", "table.votes"]);
});

test("a scroller is not overflow", () => {
  const r = measurePage(page([el({ rect: { x: 0, y: 0, width: 900, height: 40 }, overflowX: "auto" })]));
  assert.deepEqual(r.issues, []);
});

test("cut-off text: hidden or ellipsised content wider than its box", () => {
  const r = measurePage(page([el({ overflowX: "hidden", textOverflow: "ellipsis", scrollWidth: 340, clientWidth: 300 })]));
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].kind, "cut-off-text");
  assert.match(r.issues[0].detail, /40px too wide/);
});

test("tap targets: 44 normally, 40 compact", () => {
  const small = el({ interactive: true, hasOwnText: false, rect: { x: 0, y: 0, width: 44, height: 36 } });
  const compactOk = el({ selector: "button.c", interactive: true, compact: true, hasOwnText: false, rect: { x: 0, y: 0, width: 40, height: 40 } });
  const r = measurePage(page([small, compactOk]));
  assert.deepEqual(r.issues.map((i) => i.kind), ["small-tap-target"]);
  assert.equal(r.issues[0].element, small.selector);
});

test("font size and spacing off the token scales", () => {
  const r = measurePage(page([el({ fontSizePx: 9, spacingPx: [{ property: "padding-left", value: 10 }] })]));
  assert.deepEqual(r.issues.map((i) => i.kind).sort(), ["off-scale-font-size", "off-scale-spacing"]);
});

test("contrast under the bar is listed; large text gets the lower bar; image backdrops are not measured", () => {
  const grey = { r: 130, g: 130, b: 130 };
  assert.ok(contrastRatio(grey, WHITE) < 4.5 && contrastRatio(grey, WHITE) > 3);
  const low = el({ color: grey });
  const large = el({ selector: "h1", color: grey, fontSizePx: 24 });
  const onImage = el({ selector: "p.hero", background: null });
  const r = measurePage(page([low, large, onImage]));
  assert.deepEqual(r.issues.map((i) => i.element), [low.selector]);
  assert.equal(r.notMeasured[0].kind, "low-contrast");
});

test("collectPageObservation is self-contained (serialisable to a page)", () => {
  const src = collectPageObservation.toString();
  assert.doesNotMatch(src, /\b(contrastRatio|SPACE_PX|TYPE_SCALE_PX)\b/);
});
