import assert from "node:assert/strict";
import test from "node:test";

import { sourceLabelReadDate, splitLabelReadStamp } from "../lib/ballot/label-read-stamp.ts";

test("FE-14: a trailing read stamp leaves the label and goes to Sources", () => {
  assert.deepEqual(
    splitLabelReadStamp("County Attorney’s Office — 4 Court Street, Concord NH 03301 (read 2026-08-22, example.gov)"),
    { text: "County Attorney’s Office — 4 Court Street, Concord NH 03301", readAt: "2026-08-22", host: "example.gov" },
  );
  assert.deepEqual(splitLabelReadStamp("Campaign office line"), { text: "Campaign office line", readAt: null, host: null });
  assert.deepEqual(splitLabelReadStamp("Office line (read 2026-08-22)"), { text: "Office line", readAt: "2026-08-22", host: null });
});

test("a source label's read date fills Last checked instead of a gap", () => {
  assert.deepEqual(sourceLabelReadDate("In the campaign's words — example.com, read 2026-08-21"), { org: "In the campaign's words — example.com", readAt: "2026-08-21" });
  assert.deepEqual(sourceLabelReadDate("Their own site"), { org: "Their own site", readAt: "" });
  assert.deepEqual(sourceLabelReadDate(null), { org: "", readAt: "" });
});
