import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAGE_REFRESH_PER_PASS, pageDoorUrl, pageDoorsDue, recheckPage } from "../lib/doors/page-refresh.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";

/** DB-29: a page door past its refresh date is re-read and its published values are checked against the page. */

const NOW = "2026-10-06T12:00:00.000Z";
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

function page(id: string, lastSuccessDays: number, over: Partial<DoorRecord> = {}): DoorRecord {
  return {
    formatVersion: 1, doorId: id, kind: "page", ocdId: null, bodyIds: [], hosts: ["town.example"],
    config: { url: "https://town.example/council", recordClass: "OFFICIAL_ROSTER" }, holds: ["official-roster"],
    checkEveryMinutes: 30 * 24 * 60, notes: "", meeting: null, status: "OPEN", lastSuccessAt: daysAgo(lastSuccessDays),
    lastFailureAt: null, shutSince: null, readNow: false, origin: "DERIVED", editedAt: null, updatedAt: daysAgo(40), validators: null,
    ...over,
  };
}

describe("DB-29: page doors past their refresh date", () => {
  it("lists only open page doors past their check, most late first", () => {
    const due = pageDoorsDue([
      page("fresh", 5),
      page("late", 35),
      page("later", 60),
      page("shut", 90, { status: "SHUT" }),
      page("feed", 90, { kind: "legistar" }),
    ], NOW);
    assert.deepEqual(due.map((d) => d.doorId), ["later", "late"]);
  });

  it("caps one pass so a backlog drains over passes", () => {
    const many = Array.from({ length: PAGE_REFRESH_PER_PASS + 10 }, (_, i) => page(`p${i}`, 40 + i));
    assert.equal(pageDoorsDue(many, NOW).length, PAGE_REFRESH_PER_PASS);
    assert.equal(pageDoorsDue(many, NOW, 3).length, 3);
    assert.equal(pageDoorsDue(many, NOW, 0).length, 0);
  });

  it("re-fetches the address the door was keyed on", () => {
    assert.equal(pageDoorUrl(page("a", 1)), "https://town.example/council");
    assert.equal(pageDoorUrl(page("b", 1, { config: {} })), null);
  });
});

describe("DB-29: the re-read check", () => {
  const html = "<ul><li>Mayor Jane Doe</li><li><a href='tel:6025550100'>(602) 555-0100</a></li></ul>";
  it("confirms and moves the checked date when every value is still there", () => {
    assert.deepEqual(recheckPage(html, [{ field: "name", value: "Jane Doe" }, { field: "phone", value: "(602) 555-0100" }], NOW), { kind: "CONFIRMED", confirmedAt: NOW });
  });
  it("names the fields that are no longer on the page and confirms nothing", () => {
    assert.deepEqual(recheckPage(html, [{ field: "name", value: "John Roe" }, { field: "phone", value: "(602) 555-0100" }], NOW), { kind: "CHANGED", changedFields: ["name"] });
  });
  it("an empty page or no published values is unreadable, never changed", () => {
    assert.deepEqual(recheckPage("  ", [{ field: "name", value: "Jane Doe" }], NOW), { kind: "UNREADABLE" });
    assert.deepEqual(recheckPage(html, [], NOW), { kind: "UNREADABLE" });
  });
});
