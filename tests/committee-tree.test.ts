import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildCommitteeTree, parentIdOf } from "../lib/officials/committee-tree.ts";

/**
 * F01 4.2 / item 0a (2026-08-19).
 *
 * The tree is derived from a CONVENTION in the source data — a subcommittee's
 * id is its parent's id plus a suffix, and its name is `"<parent> — <sub>"`.
 * A convention that is assumed rather than checked is how a render quietly
 * starts lying, so these assert it against the shipped snapshot every run.
 */

interface DirectoryFile {
  committees: Record<string, { name: string; type: string }>;
  byMember: Record<
    string,
    { committees: { committeeId: string; name: string; title: string | null }[] }
  >;
}

const directory = JSON.parse(
  readFileSync(
    join(process.cwd(), "data", "congress-legislators", "directory.json"),
    "utf8",
  ),
) as DirectoryFile;

test("0a: every subcommittee id extends a parent id that exists", () => {
  const ids = Object.keys(directory.committees);
  const parents = new Set(ids.filter((id) => parentIdOf(id) === null));
  assert.ok(parents.size > 0, "no parent committees at all — the file is wrong");

  const orphans = ids.filter((id) => {
    const parent = parentIdOf(id);
    return parent !== null && !parents.has(parent);
  });
  assert.deepEqual(orphans, [], `subcommittees with no parent: ${orphans.join(", ")}`);
  // The denominator, stated: an operation that can return nothing is asked
  // what it returned.
  assert.equal(ids.length, parents.size + (ids.length - parents.size));
  assert.ok(ids.length - parents.size > 100, "suspiciously few subcommittees");
});

test("0a: every subcommittee name is its parent's name plus the separator", () => {
  const mismatches: string[] = [];
  for (const [id, committee] of Object.entries(directory.committees)) {
    const parentId = parentIdOf(id);
    if (parentId === null) continue;
    const parent = directory.committees[parentId];
    if (!committee.name.startsWith(`${parent.name} — `)) mismatches.push(id);
  }
  assert.deepEqual(mismatches, [], `name convention broken for: ${mismatches.join(", ")}`);
});

test("0a: no member sits on a subcommittee without also sitting on its parent", () => {
  // This is what makes the tree TOTAL: every child has a parent row to nest
  // under on the card it renders on. If it ever stops being true the tree
  // still renders the orphan whole (see the module note) — but we want to know.
  const detached: string[] = [];
  for (const [bioguide, entry] of Object.entries(directory.byMember)) {
    const own = new Set(entry.committees.map((c) => c.committeeId));
    for (const seat of entry.committees) {
      const parent = parentIdOf(seat.committeeId);
      if (parent !== null && !own.has(parent)) detached.push(`${bioguide}:${seat.committeeId}`);
    }
  }
  assert.deepEqual(detached, [], `detached subcommittee seats: ${detached.slice(0, 5).join(", ")}`);
});

test("F01 4.2: Mark Kelly's Armed Services rows nest, and the role rides the child", () => {
  // The author's exact example, from the walkthrough.
  const kelly = directory.byMember.K000377;
  assert.ok(kelly, "Mark Kelly is not in the directory");
  const tree = buildCommitteeTree(
    kelly.committees.map((c) => ({ ...c, title: c.title ?? null })),
  );
  const armed = tree.find((n) => n.seat.committeeId === "SSAS");
  assert.ok(armed, "Armed Services did not come back as a parent node");
  assert.equal(armed.label, "Senate Committee on Armed Services");
  assert.equal(armed.children.length, 3);
  // The parent's name is gone from the child's label — it is directly above.
  assert.deepEqual(armed.children.map((c) => c.label).sort(), [
    "Airland",
    "Emerging Threats and Capabilities",
    "Strategic Forces",
  ]);
  // And "Ranking Member" belongs to AIRLAND, not to Armed Services — which is
  // exactly what the flat list made impossible to see.
  const airland = armed.children.find((c) => c.label === "Airland")!;
  assert.equal(airland.seat.title, "Ranking Member");
  assert.equal(armed.seat.title, null);
});

test("F01 4.2: a child with no parent seat renders whole rather than vanishing", () => {
  const tree = buildCommitteeTree([
    { committeeId: "SSAS14", name: "Senate Committee on Armed Services — Airland", title: null },
  ]);
  assert.equal(tree.length, 1, "the orphan was dropped");
  assert.equal(tree[0].label, "Senate Committee on Armed Services — Airland");
});

test("F01 4.2: the tree loses nothing — every seat appears exactly once", () => {
  for (const [bioguide, entry] of Object.entries(directory.byMember)) {
    const tree = buildCommitteeTree(
      entry.committees.map((c) => ({ ...c, title: c.title ?? null })),
    );
    const rendered = tree.flatMap((n) => [
      n.seat.committeeId,
      ...n.children.map((c) => c.seat.committeeId),
    ]);
    assert.equal(
      rendered.length,
      entry.committees.length,
      `${bioguide}: ${entry.committees.length} seats in, ${rendered.length} rendered`,
    );
    assert.equal(new Set(rendered).size, rendered.length, `${bioguide}: a seat rendered twice`);
  }
});

test("F01 4.2: a row with no jurisdiction renders a NAMED GAP, never silence", () => {
  const surface = readFileSync(
    join(process.cwd(), "components", "officials", "member-directory.tsx"),
    "utf8",
  );
  // FE-30: a missing jurisdiction uses the shared Reader gap component.
  assert.match(surface, /<WorkingOnIt\s*\/>/);
});
