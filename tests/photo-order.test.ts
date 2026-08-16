import assert from "node:assert/strict";
import test from "node:test";

import { photosFirst } from "../lib/ballot/photo-order.ts";

/**
 * Item 5b (2026-08-16) — the author's recorded ordering decision, guarded.
 *
 * The ruling is "pictures first, within a contest". The three constraints
 * that keep it from becoming a ranking are what this file holds, because the
 * ruling costs something real — layout position now stacks on the
 * information advantage — and the only thing keeping that cost bounded is
 * that the key is BINARY and the order inside each group is AS FILED.
 */

const contest = [
  { name: "Aaron", photo: false },
  { name: "Beatriz", photo: true },
  { name: "Carl", photo: false },
  { name: "Dana", photo: true },
  { name: "Eli", photo: false },
];

test("photo-holding candidates render before photo-less ones", () => {
  const ordered = photosFirst(contest, (c) => c.photo);
  assert.deepEqual(
    ordered.map((c) => c.name),
    ["Beatriz", "Dana", "Aaron", "Carl", "Eli"],
  );
});

test("order WITHIN each group stays as filed — never alphabetical-by-us", () => {
  // The filing order here is deliberately NOT alphabetical, so a sort that
  // reached for a name key would be visible.
  const filed = [
    { name: "Zeta", photo: true },
    { name: "Yusuf", photo: false },
    { name: "Xiomara", photo: true },
    { name: "Wren", photo: false },
  ];
  const ordered = photosFirst(filed, (c) => c.photo);
  assert.deepEqual(
    ordered.map((c) => c.name),
    ["Zeta", "Xiomara", "Yusuf", "Wren"],
    "photo-holders in filing order, then photo-less in filing order",
  );
});

test("the key is BINARY — nothing else separates two candidates", () => {
  // Two photo-less candidates must never be reordered relative to each
  // other by anything. If a second sort key ever creeps in, this fails.
  const all = [
    { name: "One", photo: false, votes: 900, bio: "long" },
    { name: "Two", photo: false, votes: 1, bio: "" },
    { name: "Three", photo: false, votes: 50, bio: "medium" },
  ];
  assert.deepEqual(
    photosFirst(all, (c) => c.photo).map((c) => c.name),
    ["One", "Two", "Three"],
  );
});

test("a contest where everyone has a photo is unchanged", () => {
  const all = contest.map((c) => ({ ...c, photo: true }));
  assert.deepEqual(
    photosFirst(all, (c) => c.photo).map((c) => c.name),
    all.map((c) => c.name),
  );
});

test("a contest where nobody has a photo is unchanged", () => {
  const none = contest.map((c) => ({ ...c, photo: false }));
  assert.deepEqual(
    photosFirst(none, (c) => c.photo).map((c) => c.name),
    none.map((c) => c.name),
  );
});

test("the input array is never mutated", () => {
  const before = contest.map((c) => c.name);
  photosFirst(contest, (c) => c.photo);
  assert.deepEqual(
    contest.map((c) => c.name),
    before,
    "the caller's filing order is the record; sorting it in place would " +
      "destroy the thing the second group is ordered by",
  );
});
