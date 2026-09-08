import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RAISED_STATE_VARIANT,
  RAISED_STATE_PRESENTATIONS,
  raisedStateVariantFrom,
  raisedStateVariantFromSearch,
} from "../lib/map/raised-state-variants.ts";
import { meetingAreaLabel } from "../lib/map/meeting-area-label.ts";
import type { CoverageSummary, CoveredBody } from "../lib/registry/coverage.ts";
import {
  RELIEF_EDGE_SEAL_LAYER,
  raiseStateReliefEdges,
} from "../lib/map/state-relief.ts";
import type { Map as MapLibreMap } from "maplibre-gl";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("MAP-8: A/B/C are total, deterministic presentation-only treatments", () => {
  assert.deepEqual(Object.keys(RAISED_STATE_PRESENTATIONS), [
    "A_SOFT_LIFT",
    "B_MATERIAL_LIFT",
    "C_DEEP_LIFT",
  ]);
  assert.equal(raisedStateVariantFrom(null), DEFAULT_RAISED_STATE_VARIANT);
  assert.equal(raisedStateVariantFrom("not-a-variant"), DEFAULT_RAISED_STATE_VARIANT);
  assert.equal(raisedStateVariantFromSearch("?raisedState=A_SOFT_LIFT"), "A_SOFT_LIFT");
  assert.equal(raisedStateVariantFromSearch("?raisedState=C_DEEP_LIFT"), "C_DEEP_LIFT");
  assert.equal(RAISED_STATE_PRESENTATIONS.C_DEEP_LIFT.shadowOffsetPx, 12);
  assert.equal(RAISED_STATE_PRESENTATIONS.C_DEEP_LIFT.shadowBlurPx, 24);
  for (const presentation of Object.values(RAISED_STATE_PRESENTATIONS)) {
    assert.deepEqual(Object.keys(presentation).sort(), [
      "darkShadowScale",
      "edgeWidthScale",
      "lightShadowScale",
      "shadowBlurPx",
      "shadowOffsetPx",
      "shadowWidthPx",
      "surfaceScale",
    ]);
  }
});

test("MAP-7/MAP-8: navigation chrome is gone and canonical edges stay sharp", () => {
  const canvas = source("components/map/map-canvas.tsx");
  const relief = source("lib/map/state-relief.ts");
  assert.doesNotMatch(canvas, /\bNavigationControl\b/);
  assert.match(canvas, /AttributionControl/);
  assert.match(relief, /tolerance: 0/g);
  assert.match(relief, /state-relief-edge-seal/);
  assert.match(relief, /"line-blur": 0/);
  assert.match(source("components/map/map-entry.tsx"), /raisedStateVariant=\{raisedStateVariant\}/);
});

test("MAP-8: every asynchronously-added district paint layer stays below the state seal", () => {
  const layers = [
    { id: "base-land", type: "fill" },
    { id: "state-relief-shadow", type: "line" },
    { id: "state-relief-shadow-soft", type: "line" },
    { id: "state-relief-surface", type: "fill" },
    { id: "district-county-fill", type: "fill" },
    { id: "district-county-line", type: "line" },
    { id: RELIEF_EDGE_SEAL_LAYER, type: "line" },
    { id: "state-relief-light", type: "line" },
    { id: "state-relief-dark", type: "line" },
    { id: "district-county-label", type: "symbol" },
    /* This second type simulates the late async insertion that regressed the
       Colorado River edge. */
    { id: "district-school-unified-fill", type: "fill" },
    { id: "district-school-unified-line", type: "line" },
    { id: "district-school-unified-label", type: "symbol" },
    { id: "base-place-label", type: "symbol" },
  ];
  const map = {
    getStyle: () => ({ layers }),
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    moveLayer: (id: string, before?: string) => {
      const from = layers.findIndex((layer) => layer.id === id);
      assert.notEqual(from, -1);
      const [layer] = layers.splice(from, 1);
      const to = before
        ? layers.findIndex((candidate) => candidate.id === before)
        : layers.length;
      layers.splice(to < 0 ? layers.length : to, 0, layer);
    },
  } as unknown as MapLibreMap;

  raiseStateReliefEdges(map);

  const seal = layers.findIndex((layer) => layer.id === RELIEF_EDGE_SEAL_LAYER);
  const firstDistrictLabel = layers.findIndex((layer) => layer.id.endsWith("-label"));
  for (const layer of layers.filter(
    (candidate) =>
      candidate.id.startsWith("district-") &&
      (candidate.id.endsWith("-fill") || candidate.id.endsWith("-line")),
  )) {
    assert.ok(layers.indexOf(layer) < seal, layer.id);
  }
  assert.ok(seal < firstDistrictLabel);
});

test("LAY-14/LAY-15: responsive compositions retain one PillCluster", () => {
  const entry = source("components/map/map-entry.tsx");
  const css = source("components/map/map-entry.module.css");
  assert.equal((entry.match(/^\s*<PillCluster\b/gm) ?? []).length, 1);
  assert.match(entry, /phoneMap \? "phone" : tabletMap \? "tablet"/);
  assert.match(css, /max-width: 639px/);
  assert.match(css, /min-width: 640px[\s\S]*max-width: 1199px/);
  assert.match(css, /grid-template-columns: repeat\(4/);
  assert.match(css, /grid-template-columns: repeat\(6/);
  assert.match(entry, />People<\/button>/);
  assert.match(entry, /!phoneMap \|\| districtExpanded/);
  assert.match(entry, /compactMeetingsLabel/);
  assert.match(entry, /zipFirst=\{phoneMap\}/);
  assert.match(source("components/shell/pill-cluster.tsx"), /map-top-row[\s\S]*?rowRect\.height > 0/);
  assert.match(css, /:global\(\.district-info-pill\)[\s\S]*?animation: none/);
  assert.match(css, /:global\(\.zip-switcher\)[\s\S]*?grid-row: 2/);
  assert.match(css, /:global\(\.ask-expansion\)[\s\S]*?grid-row: 3/);
  assert.match(css, /\.voteSlot\[data-open="true"\][\s\S]*?grid-row: 4/);
  assert.match(css, /\.meetingPanelSlot[\s\S]*?grid-row: 5/);
  assert.match(css, /\.phoneContextNav[\s\S]*?gap: 0\.4rem/);
  assert.match(css, /\.phoneContextNav > button[\s\S]*?border-radius: 999px/);
});

test("LAY-14: compact meeting label chooses only one sourced municipality", () => {
  const tucson = {
    bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    name: null,
    divisionLabel: "Tucson",
    divisionType: "place",
    lsad: null,
    bodyClass: "GOVERNING",
    coverageStatus: "LIVE",
    homepageUrl: null,
    agendaSourceRef: null,
    lookedAt: true,
    tier: "local",
  } satisfies CoveredBody;
  const coverage = { bodies: [tucson] } as CoverageSummary;
  assert.equal(meetingAreaLabel(coverage, "85701"), "Tucson meetings");

  const second = {
    ...tucson,
    bodyId: "ocd-division/country:us/state:az/place:south_tucson#governing",
    ocdId: "ocd-division/country:us/state:az/place:south_tucson",
    divisionLabel: "South Tucson",
  } satisfies CoveredBody;
  assert.equal(
    meetingAreaLabel({ ...coverage, bodies: [tucson, second] }, "85701"),
    "85701 meetings",
  );
});

test("MTG-18/19 and DSN-8: the card order and pill affordance are explicit", () => {
  const panel = source("components/map/meeting-panel.tsx");
  const popup = source("components/map/popup/popup-card.tsx");
  const lumen = source("components/map/popup/lumen-popup.module.css");
  const title = panel.indexOf("{cardTitle.title}");
  const count = panel.indexOf("listingCount.unresolved");
  const address = panel.indexOf("locationLine(venue.name, venue.address)");
  const meta = panel.indexOf('className="reader-meeting-header-meta"');
  assert.ok(title < count && count < address && address < meta);
  assert.match(panel, /headerBodyIds\.size === 1/);
  assert.match(panel, /cardTitle\.basis !== "venue"/);
  assert.match(panel, /className="reader-agenda-bubble"/);
  assert.doesNotMatch(panel, /font-mono/);
  assert.match(popup, /popup-card-more/);
  assert.match(lumen, /\.card :global\(\.popup-card-more\)[\s\S]*?border-radius: 999px/);
});

test("WGH-24/MTG-20: purpose provenance is reachable without hover", () => {
  const label = source("components/map/body-purpose-label.tsx");
  const list = source("components/map/list-overlay.tsx");
  assert.match(label, /href=\{purpose\.basisUrl\}/);
  assert.match(label, /aria-label=\{`\$\{purpose\.label\}\. \$\{purpose\.description\} Source:/);
  assert.match(label, /target="_blank"/);
  assert.match(list, /<\/button>[\s\S]*?<BodyPurposeLabel purpose=\{purpose\}/);
  assert.doesNotMatch(list, /<button(?:(?!<\/button>)[\s\S])*<BodyPurposeLabel/);
});

test("DSN-7: primary Reader map cards and popups opt into Lumen shading", () => {
  for (const path of [
    "components/map/coverage-notice.tsx",
    "components/map/door-overlay.tsx",
    "components/map/list-overlay.tsx",
    "components/map/meeting-panel.tsx",
    "components/map/popup/entity-modal.tsx",
    "components/map/voting-sites-panel.tsx",
    "components/map/welcome-overlay.tsx",
  ]) {
    assert.match(source(path), /reader-lumen-surface|reader-meeting-panel/, path);
  }
  assert.match(source("components/ballot/candidate-battlecard.tsx"), /battlecardStyles\.lumen/);
  assert.match(source("components/ballot/candidate-battlecard.module.css"), /radial-gradient/);
});
