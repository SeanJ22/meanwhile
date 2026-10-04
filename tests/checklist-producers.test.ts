import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHECKLIST_ITEMS, PRODUCERS, hasProducer } from "../lib/coverage/checklist-map.ts";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import { notCapturedOf } from "../lib/coverage/place-measures.ts";
import { scorePlace } from "../lib/control-plane/admin-view/place-scorecard.ts";
import { GROUP_NAMES } from "../lib/coverage/group-names.ts";

const ID = /"((?:GEO|GOV|OFF|MTG|DOC|LEG|ELE|CAN|CAM|FIN|PAR|REF|EXE|PRL)-\d\d)"/g;

test("the overlay's producers match the code that writes each checklist item", () => {
  const producers = Object.entries(PRODUCERS).filter(([name]) => name !== "note") as [string, { file: string; label: string }][];
  assert.ok(producers.length >= 3);
  const written = new Map<string, Set<string>>();
  for (const [name, { file }] of producers) {
    for (const match of readFileSync(new URL(`../${file}`, import.meta.url), "utf8").matchAll(ID)) {
      written.set(match[1], (written.get(match[1]) ?? new Set()).add(name));
    }
  }
  for (const [id, item] of Object.entries(CHECKLIST_ITEMS)) {
    assert.deepEqual([...(written.get(id) ?? [])].sort(), [...(item?.filledBy ?? [])].sort(), `${id}: the overlay says who fills it, and the code must agree`);
  }
  for (const id of written.keys()) assert.ok(CHECKLIST_ITEMS[id], `${id} is written by a producer but is not a checklist item`);
});

test("an item no producer fills says so, and the card splits not-captured into hunted and nothing hunts", () => {
  assert.equal(hasProducer("GOV-01"), true);
  assert.equal(hasProducer("OFF-17"), false);
  const now = "2026-10-04T12:00:00Z";
  const county = "ocd-division/country:us/state:az/county:cochise";
  const rows = buildPlaceOwedList({ divisions: [{ id: county, label: "Cochise County" }], now, held: [],
    subjects: [{ id: "seat:1", kind: "seat", captureKind: "state-legislator", divisionIds: [county], label: "Senator" }] });
  const portrait = rows.find(r => r.subject.id === "seat:1" && r.checklistId === "OFF-17")!;
  assert.equal(portrait.statuses.noProducerWords, "No squad or door covers this item yet");
  const roster = rows.find(r => r.subject.id === "seat:1" && r.checklistId === "OFF-04")!;
  assert.equal(roster.statuses.noProducerWords, null, "a roster has a producer: it is hunted, not found yet");
  const split = notCapturedOf(rows);
  assert.ok(split.huntedNotFound > 0 && split.nothingHunts > 0);
  const score = scorePlace(rows, GROUP_NAMES, []);
  assert.deepEqual(score.notCaptured, split);
  assert.equal(score.familyNotCaptured.reduce((n, f) => n + f.nothingHunts, 0), split.nothingHunts, "the family counts add up");
});
