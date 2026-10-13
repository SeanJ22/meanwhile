import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { FieldManualEntry } from "../lib/control-plane/field-manual.ts";
import {
  PLAYBOOK_RETIREMENT_MARKER, PLAYBOOK_SEED_ROWS, ensureRolePlaybooks, retireInstructionsSql, seedRolePlaybooks,
} from "../lib/control-plane/playbook-seed.ts";

const NOW = "2026-10-13T00:00:00.000Z";
const WRITER = "fm-220766cd29b8177fbe15c604";
const CHECKER = "fm-3069eaa6952134d521f4d731";

function withRetire() {
  const repos = createMemoryRepositories();
  const calls: string[] = [];
  const fieldManual = Object.assign(Object.create(repos.fieldManual), repos.fieldManual, {
    retireInstructions: async () => { calls.push("retire"); },
  });
  return { repos: { ...repos, fieldManual }, calls };
}

test("the seed carries ten role instructions, each with its own id and text", () => {
  assert.equal(PLAYBOOK_SEED_ROWS.length, 10);
  assert.equal(new Set(PLAYBOOK_SEED_ROWS.map(row => row.id)).size, 10);
  assert.ok(PLAYBOOK_SEED_ROWS.every(row => row.kind === "PLAYBOOK" && typeof (row.payload as { text?: unknown }).text === "string"));
});

test("seeding creates every missing row once and a second run changes nothing", async () => {
  const repos = createMemoryRepositories();
  assert.deepEqual(await seedRolePlaybooks(repos, NOW), { created: 10, present: 0 });
  const first = await repos.fieldManual.list();
  assert.equal(first.length, 10);
  assert.deepEqual(await seedRolePlaybooks(repos, "2026-10-14T00:00:00.000Z"), { created: 0, present: 10 });
  assert.deepEqual(await repos.fieldManual.list(), first);
});

test("an existing canonical row, with its edits and revision, is never replaced", async () => {
  const repos = createMemoryRepositories();
  await seedRolePlaybooks(repos, NOW);
  const held = (await repos.fieldManual.read(PLAYBOOK_SEED_ROWS[0]!.id))!;
  const edited: FieldManualEntry = { ...held.value, payload: { ...(held.value.payload as object), text: "Edited in Admin.", history: [{ at: NOW }] } };
  const saved = await repos.fieldManual.compareAndSet(held.id, held.revision, edited, "2026-10-13T01:00:00.000Z");
  await seedRolePlaybooks(repos, "2026-10-14T00:00:00.000Z");
  const after = (await repos.fieldManual.read(held.id))!;
  assert.equal(after.revision, saved.revision);
  assert.equal((after.value.payload as { text: string }).text, "Edited in Admin.");
});

test("the measure writer and checker start from the translator instructions already in use", async () => {
  const repos = createMemoryRepositories();
  const legacy: FieldManualEntry = { ...PLAYBOOK_SEED_ROWS[0]!, id: "fm-legacy-translator", role: "MEASURE_WRITER",
    payload: { translator: true, text: "Existing translator text.", history: [{ at: "2026-09-01" }], writerModel: "model-w", checkerModel: "model-c" } };
  await repos.fieldManual.put(legacy.id, legacy, "2026-09-01T00:00:00.000Z");
  await seedRolePlaybooks(repos, NOW);
  assert.deepEqual((await repos.fieldManual.read(WRITER))!.value.payload, { text: "Existing translator text.", history: [{ at: "2026-09-01" }], model: "model-w" });
  assert.deepEqual((await repos.fieldManual.read(CHECKER))!.value.payload, { text: "Existing translator text.", history: [{ at: "2026-09-01" }], model: "model-c" });
});

test("without a translator row the writer and checker take the seeded text", async () => {
  const repos = createMemoryRepositories();
  await seedRolePlaybooks(repos, NOW);
  const seeded = PLAYBOOK_SEED_ROWS.find(row => row.id === WRITER)!;
  assert.deepEqual((await repos.fieldManual.read(WRITER))!.value, seeded);
});

test("the retirement runs once, only after every canonical row exists, and leaves a marker no worker reads", async () => {
  const { repos, calls } = withRetire();
  assert.deepEqual(await ensureRolePlaybooks(repos, NOW), { created: 10, present: 0, retired: true });
  assert.deepEqual(calls, ["retire"]);
  assert.ok(await repos.fieldManual.read(PLAYBOOK_RETIREMENT_MARKER.id), "the marker is written after the removal");
  assert.deepEqual(await ensureRolePlaybooks(repos, "2026-10-14T00:00:00.000Z"), { created: 0, present: 10, retired: false });
  assert.deepEqual(calls, ["retire"], "a later start does not retire again");
});

test("a store with no removal path seeds and retires nothing", async () => {
  const repos = createMemoryRepositories();
  assert.deepEqual(await ensureRolePlaybooks(repos, NOW), { created: 10, present: 0, retired: false });
  assert.equal(await repos.fieldManual.read(PLAYBOOK_RETIREMENT_MARKER.id), null);
});

test("the removal statement lifts the delete guard and restores it inside one statement, and spares every canonical row", () => {
  const sql = retireInstructionsSql();
  assert.match(sql, /^DO \$retire\$ BEGIN\s+ALTER TABLE cp_field_manual_entries DISABLE TRIGGER cp_field_manual_entries_no_rewrite;/);
  assert.match(sql, /ENABLE TRIGGER cp_field_manual_entries_no_rewrite;\s+END \$retire\$;$/);
  for (const row of PLAYBOOK_SEED_ROWS) assert.ok(sql.includes(`'${row.id}'`), `${row.id} is excluded from the removal`);
  for (const doc of ["docs/branch-manifest.md", "docs/zip-playbook.md", "docs/source-ladder.md"]) assert.ok(sql.includes(`'${doc}'`));
});
