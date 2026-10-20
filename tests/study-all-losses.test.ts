import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lessonKinds, lossRows, studyAllLosses, type LossReading } from "../lib/method/study-all-losses.ts";
import type { PlaceTraits } from "../lib/method/study-losses.ts";

const AT = "2026-10-06T03:00:00.000Z";
const r = (kind: LossReading["kind"], subject: string, placeId: string, failed: boolean): LossReading => ({ kind, subject, subjectWords: subject, placeId, failed, at: AT });
const traits = new Map<string, PlaceTraits>([
  ["p1", { platform: "civicplus", state: "az", agendasAsImages: true }],
  ["p2", { platform: "civicplus", state: "nh", agendasAsImages: true }],
  ["p3", { platform: "legistar", state: "az", agendasAsImages: false }],
  ["p4", { platform: "granicus", state: "nj", agendasAsImages: false }],
]);

describe("DP-29: every kind of loss is studied", () => {
  it("studies shut doors, empty hunts, checker holds and auditors' reds the way methods are studied", () => {
    const readings = [
      r("shut-door", "agenda page", "p1", true), r("shut-door", "agenda page", "p2", true), r("shut-door", "agenda page", "p3", false),
      r("empty-hunt", "meeting minutes", "p1", true), r("empty-hunt", "meeting minutes", "p2", true), r("empty-hunt", "meeting minutes", "p4", false),
      r("checker", "date outside its window", "p1", true), r("checker", "date outside its window", "p2", true),
      r("audit", "meeting times", "p1", true), r("audit", "meeting times", "p4", true), r("audit", "meeting times", "p3", false),
    ];
    const lessons = studyAllLosses(readings, traits, AT);
    assert.deepEqual(lessonKinds(lessons), ["shut-door", "empty-hunt", "checker"]);
    const door = lessons.find((l) => l.kind === "shut-door")!;
    assert.match(door.says, /^Lesson from shut doors: agenda page failed in 2 places that share agendas posted as images \(yes\); platform \(civicplus\), and none of the 1 place where it worked do\.$/);
    assert.deepEqual(door.entry.platforms, ["civicplus"]);
    assert.equal(door.entry.kind, "LESSON");
    // The auditors' reds share nothing the working place lacks: no lesson, and nothing guessed.
    assert.equal(lessons.some((l) => l.kind === "audit"), false);
  });

  it("a front-end red that repeats across places is the page, not the place", () => {
    const readings = [
      r("front-end", "ballot page, phone: the deadline label", "p3", true),
      r("front-end", "ballot page, phone: the deadline label", "p4", true),
      r("front-end", "ballot page, phone: the deadline label", "p1", false),
    ];
    const lessons = studyAllLosses(readings, traits, AT);
    assert.equal(lessons.length, 1);
    assert.match(lessons[0].says, /was red at 2 places, so it is the page, not the place/);
  });

  it("the same study run twice gives the same lessons, so a repeat updates instead of adding", () => {
    const readings = [r("shut-door", "agenda page", "p1", true), r("shut-door", "agenda page", "p2", true)];
    const a = studyAllLosses(readings, traits, AT), b = studyAllLosses(readings, traits, "2026-10-07T00:00:00.000Z");
    assert.deepEqual(a.map((l) => l.entry.id), b.map((l) => l.entry.id));
  });

  it("a place with any failure for a subject counts as failing there", () => {
    const rows = lossRows([r("audit", "x", "p1", false), r("audit", "x", "p1", true), r("audit", "x", "p1", false)]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "FAILS");
  });
});

describe("DP-29: where each kind of loss is read from", () => {
  it("doors, hunts, holds, audits and look checks become readings, with traits from what we hold", async () => {
    const { absenceReadings, auditReadings, doorReadings, holdReadings, lookReadings, placeTraitsFrom } = await import("../lib/method/loss-readings.ts");
    const { lossLessonUpdates } = await import("../lib/method/study-all-losses.ts");
    const div = (s: string, c: string) => `ocd-division/country:us/state:${s}/county:${c}`;
    const doors = [
      { kind: "civicplus", ocdId: div("az", "a"), holds: ["meetings"], status: "SHUT" as const, updatedAt: AT, shutSince: AT },
      { kind: "civicplus", ocdId: div("nh", "b"), holds: ["meetings"], status: "SHUT" as const, updatedAt: AT, shutSince: AT },
      { kind: "legistar", ocdId: div("az", "c"), holds: ["meetings"], status: "OPEN" as const, updatedAt: AT },
      { kind: "legistar", ocdId: null, holds: ["votes"], status: "SHUT" as const, updatedAt: AT },
    ];
    const d = doorReadings(doors);
    assert.equal(d.length, 3);
    assert.equal(d.filter((r) => r.failed).length, 2);
    const items = [
      { subject: div("az", "a"), autonomousPlan: { jurisdiction: "AZ", contract: { recordClass: "meetings" } }, publicationOutcome: { status: "HELD", at: AT } },
      { subject: div("az", "c"), autonomousPlan: { jurisdiction: "AZ", contract: { recordClass: "meetings" } }, publicationOutcome: { status: "PUBLISHED", at: AT } },
      { subject: "x", publicationOutcome: { status: "HELD", at: AT } },
    ];
    assert.deepEqual(holdReadings(items).map((r) => r.failed), [true, false]);
    assert.deepEqual(absenceReadings([
      { recordClass: "minutes", subjectId: "s1", lastWorkedAt: AT, absentUntil: "2026-10-09T00:00:00.000Z" },
      { recordClass: "minutes", subjectId: "s2", lastWorkedAt: AT, absentUntil: null },
      { recordClass: "minutes", subjectId: "s3", lastWorkedAt: null },
    ], AT).map((r) => r.failed), [true, false]);
    assert.deepEqual(auditReadings([{ family: "meetings", area: "a", verdict: "RED", checkedAt: AT }, { family: "meetings", area: "b", verdict: "INCONCLUSIVE", checkedAt: AT }]).length, 1);
    const pass = { sha: "abc1234", at: AT, runId: "r", zips: ["00001"], red: 1, green: 0, notReviewed: 0, reviewerSays: null, verdict: "red" as const,
      screens: [{ surface: "ballot" as const, zip: "00001", profile: "phone" as const, label: "ballot page, phone (390 wide)", shot: null, issues: {}, issueLines: [], failed: null, verdict: "red" as const, element: "The deadline label", answers: {}, fixId: null }] };
    assert.equal(lookReadings([pass])[0].placeId, "zip:00001");
    const traits = placeTraitsFrom({ doors, items, places: [...d.map((r) => r.placeId), "x"] });
    assert.deepEqual(traits.get(div("az", "a")), { platform: "civicplus", state: "az" });
    assert.equal(traits.has("x"), false);

    const lessons = studyAllLosses(d, traits, AT);
    assert.equal(lessons.length, 1);
    assert.match(lessons[0].says, /^Lesson from shut doors: doors for meetings failed in 2 places that share platform \(civicplus\)/);
    const [update] = lossLessonUpdates(lessons, AT);
    assert.equal(update.id, `lesson:${lessons[0].entry.id}`);
    assert.equal(update.label, "TESTING");
  });
});
