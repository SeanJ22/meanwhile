/** The resident-task file is well formed and names no particular place. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const file = JSON.parse(readFileSync(new URL("../data/health/resident-tasks.json", import.meta.url), "utf8")) as {
  surfaces: string[];
  tasks: { id: string; title: string; source: string; start: string; success: string; tapBudget: number; question?: string }[];
};

test("every task has a start surface, a reader-terms success condition and a tap budget", () => {
  const ids = new Set<string>();
  for (const t of file.tasks) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
    assert.ok(file.surfaces.includes(t.start), `${t.id}: unknown surface ${t.start}`);
    assert.ok(t.title.length > 0 && t.success.length > 0);
    assert.ok(Number.isInteger(t.tapBudget) && t.tapBudget >= 1 && t.tapBudget <= 6, `${t.id}: tap budget`);
    assert.ok(!/\b[A-Z][a-z]+, [A-Z]{2}\b|\b\d{5}\b/.test(t.title + t.success), `${t.id}: names a place`);
  }
});

test("seeded with the three 6.11 tasks, the six Ask questions and the 6.7 items", () => {
  assert.equal(file.tasks.filter((t) => t.source === "design 6.11").length, 3);
  assert.equal(file.tasks.filter((t) => t.source === "design 11" && t.question).length, 6);
  assert.ok(file.tasks.filter((t) => t.source === "design 6.7").length >= 6);
});
