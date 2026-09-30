import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { emptyFieldManual, fieldManualEntryId, upsertEntries } from "../lib/control-plane/field-manual.ts";
import { readMethodStore } from "../lib/method/candidate.ts";
import { KNOWLEDGE_SOURCE, knowledgeEntries, learnedRouteIds } from "../lib/method/manual-bridge.ts";
import { reassembleResearchDoc, researchDocEntries, sectionEntryId, splitMarkdownDocument } from "../lib/method/research-docs.ts";

const ROOT = process.cwd();
const noHints = () => [] as string[];

function markdownUnder(dir: string): string[] {
  const out: string[] = [];
  for (const d of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) out.push(...markdownUnder(rel));
    else if (d.name.endsWith(".md")) out.push(rel);
  }
  return out.sort();
}

const nonBlankLines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

test("a heading inside a code fence is not a section, and the preamble is kept", () => {
  const text = ["# Title", "intro line", "", "## Real", "body one", "```", "## not a heading", "```", "### Sub", "body two"].join("\n");
  const { preamble, sections } = splitMarkdownDocument(text);
  assert.equal(preamble, "# Title\nintro line");
  assert.deepEqual(sections.map((s) => s.heading), ["Real", "Sub"]);
  assert.match(sections[0]!.body, /## not a heading/);
});

test("a repeated heading gets its own entry and the first keeps the id it always had", () => {
  const text = "## Same\nfirst\n## Same\nsecond\n";
  const entries = researchDocEntries({ path: "states/zz/NOTES.md", text, states: ["zz"], platformHints: noHints });
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(fieldManualEntryId("states/zz/NOTES.md", "Same")), "the first occurrence keeps the pre-existing id");
  assert.ok(ids.includes(sectionEntryId("states/zz/NOTES.md", "Same", 2)));
  assert.deepEqual(entries.filter((e) => e.kind === "STATE_NOTE" && (e.payload as { body?: string }).body).map((e) => (e.payload as { body: string }).body), ["first", "second"]);
});

test("every line of every state dossier and detective write-up is in the manual, in full", () => {
  const paths = [...markdownUnder("states"), ...markdownUnder("docs/detective")];
  assert.ok(paths.length >= 20, `expected the research docs, found ${paths.length}`);
  for (const path of paths) {
    const text = readFileSync(join(ROOT, path), "utf8");
    const entries = researchDocEntries({ path, text, states: [], platformHints: noHints });
    const held = new Set(nonBlankLines(reassembleResearchDoc(entries)));
    const missing = nonBlankLines(text).filter((line) => !held.has(line));
    assert.deepEqual(missing.slice(0, 3), [], `${path}: ${missing.length} line(s) of the document are not in the manual`);
  }
});

test("the document entries that used to be pointers keep their ids, now carrying the text", () => {
  for (const state of ["az", "nh", "nj"]) {
    for (const name of ["sources", "NOTES", "tenancy", "descent", "descent-candidates"]) {
      const path = `states/${state}/${name}.md`;
      const entries = researchDocEntries({ path, text: readFileSync(join(ROOT, path), "utf8"), states: [state], platformHints: noHints });
      assert.ok(entries.some((e) => e.id === fieldManualEntryId(path, "doc")), `${path} lost its document entry`);
    }
  }
});

test("folding the method store keeps every route, and routing reads the same routes back from the manual", () => {
  const store = readMethodStore(join(ROOT, "data", "method", "knowledge.json"));
  const entries = knowledgeEntries(store);
  assert.equal(entries.length, store.routes.length);
  assert.ok(entries.every((e) => e.source === KNOWLEDGE_SOURCE && e.id === fieldManualEntryId(KNOWLEDGE_SOURCE, (e.payload as { id: string }).id)));
  const manual = upsertEntries(emptyFieldManual(), entries, "2026-09-29");
  assert.deepEqual([...learnedRouteIds(manual)].sort(), store.routes.map((r) => r.id).sort());
});

test("a route an agent writes as a ROUTE entry is learned on the next read, with no human step", () => {
  const store = readMethodStore(join(ROOT, "data", "method", "knowledge.json"));
  let manual = upsertEntries(emptyFieldManual(), knowledgeEntries(store), "2026-09-29");
  assert.equal(learnedRouteIds(manual).has("agent-found-route"), false);
  manual = upsertEntries(manual, [{
    id: fieldManualEntryId("agent", "agent-found-route"), role: "SCOUT", kind: "ROUTE", title: "found by an agent", summary: "x",
    states: [], recordClasses: [], platforms: [], outcome: "YIELDED", url: null, source: "agent", observedAt: "2026-09-29", tier: null,
    payload: { routeId: "agent-found-route" },
  }], "2026-09-29");
  assert.equal(learnedRouteIds(manual).has("agent-found-route"), true);
});

test("dispatch routes differently after an agent writes a route: UNGRADUATED before, GRADUATED after, no human step", async () => {
  const { methodMaturityFromManual } = await import("../lib/control-plane/scheduler/maturity.ts");
  const { decideExecutor } = await import("../lib/control-plane/scheduler/dispatch.ts");
  const { createMemoryRepositories } = await import("../lib/control-plane/repository/memory.ts");
  const { newFieldManualEntry, writeFieldManual } = await import("../lib/control-plane/field-manual.ts");

  const repos = createMemoryRepositories();
  await assert.rejects(methodMaturityFromManual(repos), /has not been seeded/);

  await writeFieldManual(repos, knowledgeEntries(readMethodStore(join(ROOT, "data", "method", "knowledge.json"))), "2026-09-29");
  const before = await methodMaturityFromManual(repos);
  const descriptor = { executorClass: "BOUNDED_MODEL_WORKER" as const, open: { kind: "HTTP_GET" } };
  assert.equal(decideExecutor({ routeId: "agent-found-route", descriptor, maturity: before }).kind, "BOUNDED_MODEL_WORKER");

  // An earlier agent wrote what it learned.
  await writeFieldManual(repos, [newFieldManualEntry("agent", "agent-found-route", {
    role: "SCOUT", kind: "ROUTE", title: "found by an agent", summary: "answers with the agenda list", outcome: "YIELDED",
    payload: { routeId: "agent-found-route" },
  })], "2026-09-29");

  const after = await methodMaturityFromManual(repos);
  assert.equal(decideExecutor({ routeId: "agent-found-route", descriptor, maturity: after }).kind, "DETERMINISTIC");
});
