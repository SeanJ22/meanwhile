import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { newFieldManualEntry, readFieldManual, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { readRolePlaybook, workerSystemPrompt, WORKER_SAFETY_FRAME } from "../lib/control-plane/playbooks.ts";
import { playbookEditView, updateRolePlaybook } from "../lib/control-plane/playbook-edit.ts";

const at = "2026-10-05T12:00:00Z";
test("edited instructions reach the next worker and undo restores the previous cached-system version", async () => {
  const repos = createMemoryRepositories();
  const before = await readRolePlaybook(repos, "SCOUT");
  const edit = { role: "SCOUT" as const, text: "Read the current calendar and its saved pages.", expectedVersion: before.version, id: "edit", at, why: "Clearer instructions" };
  await updateRolePlaybook(repos, edit);
  const current = await readRolePlaybook(repos, "SCOUT");
  assert.equal(current.text, edit.text);
  assert.notEqual(current.version, before.version);
  assert.ok(workerSystemPrompt("SCOUT", current.text).startsWith(WORKER_SAFETY_FRAME));
  const read = await readFieldManual(repos);
  const row = playbookEditView(read.store.entries, "SCOUT");
  assert.equal(row.history[0].before, before.text);
  assert.equal(row.history[0].factory, undefined);
  assert.deepEqual(await updateRolePlaybook(repos, edit), { version: current.version, changed: false });
  await updateRolePlaybook(repos, { ...edit, id: "undo", text: row.undo!.text, expectedVersion: row.undo!.expectedVersion, undoOf: row.undo!.id });
  assert.deepEqual((await readRolePlaybook(repos, "SCOUT")).text, before.text);
  assert.equal((await readRolePlaybook(repos, "SCOUT")).version, before.version);
});

test("editing one role preserves other instructions and learned doors, and stale edits or a stale undo are refused", async () => {
  const repos = createMemoryRepositories();
  const door = newFieldManualEntry("door", "one", { role: "SHARED", kind: "ROUTE", title: "Calendar", summary: "Read the calendar", outcome: "YIELDED" });
  await writeFieldManual(repos, [door], at);
  const parser = await readRolePlaybook(repos, "PARSER");
  const before = await readRolePlaybook(repos, "SCOUT");
  const edit = { role: "SCOUT" as const, text: "First change", expectedVersion: before.version, id: "first", at, why: "" };
  await updateRolePlaybook(repos, edit);
  await assert.rejects(updateRolePlaybook(repos, { ...edit, text: "Stale change", id: "stale" }), /refresh before/);
  const first = await readRolePlaybook(repos, "SCOUT");
  await updateRolePlaybook(repos, { ...edit, text: "Second change", id: "second", expectedVersion: first.version });
  const second = await readRolePlaybook(repos, "SCOUT");
  await assert.rejects(updateRolePlaybook(repos, { ...edit, id: "old-undo", text: before.text, expectedVersion: second.version, undoOf: "first" }), /refresh before/);
  await assert.rejects(updateRolePlaybook(repos, { ...edit, id: "false-undo", text: "Invented earlier version", expectedVersion: second.version, undoOf: "second" }), /restore the previous/);
  assert.equal((await readRolePlaybook(repos, "PARSER")).version, parser.version);
  assert.ok((await readFieldManual(repos)).store.entries.some(e => e.id === door.id));
});

test("multiple imported texts become one edited playbook and every earlier instruction remains in history", async () => {
  const repos = createMemoryRepositories();
  await writeFieldManual(repos, ["one", "two"].map(id => newFieldManualEntry("legacy", id, { role: "SCOUT", kind: "PLAYBOOK", title: id,
    summary: id, outcome: "REFERENCE", payload: { text: id } })), at);
  const before = await readRolePlaybook(repos, "SCOUT");
  await updateRolePlaybook(repos, { role: "SCOUT", text: "Replacement", expectedVersion: before.version, id: "edit", at, why: "" });
  const read = await readFieldManual(repos);
  assert.equal(read.store.entries.filter(e => e.kind === "PLAYBOOK" && e.role === "SCOUT").length, 1);
  assert.equal(playbookEditView(read.store.entries, "SCOUT").history[0].before, before.text);
});
