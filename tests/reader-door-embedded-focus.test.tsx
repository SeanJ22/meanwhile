import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DoorOverlay } from "../components/map/door-overlay.tsx";
import { ReaderCard } from "../components/shell/reader-card.tsx";

const noOp = () => {};
const door = {
  door: "bodies" as const,
  coverage: null,
  meetings: [],
  drawnDistricts: [],
  districtOverlayOn: false,
  atAddress: false,
  onShowDistricts: noOp,
  onOpenOfficial: noOp,
  onOpenMeeting: noOp,
  onOpenBody: noOp,
  onClose: noOp,
};

test("an embedded Bodies door exposes only its visible card Close control", () => {
  const markup = renderToStaticMarkup(createElement(ReaderCard, {
    viewKey: "door:bodies",
    kicker: "Bodies here",
    backLabel: null,
    onBack: noOp,
    onClose: noOp,
  }, createElement(DoorOverlay, { ...door, embedded: true })));
  assert.equal([...markup.matchAll(/aria-label="Close"/g)].length, 1);
  assert.match(markup, /data-mw="card-close"/);
  assert.match(markup, /<h2[^>]*>Bodies here<\/h2>/);
});

test("the standalone Bodies door retains its own Close control", () => {
  const markup = renderToStaticMarkup(createElement(DoorOverlay, door));
  assert.equal([...markup.matchAll(/aria-label="Close"/g)].length, 1);
});
