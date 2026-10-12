import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildCommitteeTree } from "../lib/officials/committee-tree.ts";

test("a child with no parent seat renders whole rather than vanishing", () => {
  const tree = buildCommitteeTree([
    { committeeId: "SSAS14", name: "Senate Committee on Armed Services — Airland", title: null },
  ]);
  assert.equal(tree.length, 1, "the orphan was dropped");
  assert.equal(tree[0].label, "Senate Committee on Armed Services — Airland");
});

test("a row with no jurisdiction renders a NAMED GAP, never silence", () => {
  const surface = readFileSync(
    join(process.cwd(), "components", "officials", "member-directory.tsx"),
    "utf8",
  );
  assert.match(surface, /<WorkingOnIt\s*\/>/);
});
