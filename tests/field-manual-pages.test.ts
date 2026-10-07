/**
 * Every role's starting page, rendered from the same manual before and after
 * the manual moved to one row per entry. `fixtures/field-manual-pages/before.json`
 * was rendered by the single-document code from `manual.json` (the document as
 * that code stored it) before the code was replaced. Here the document is
 * copied into rows the way production copies it, each page is rendered again,
 * and every difference must be one of the intended changes listed below.
 * The rows each role read for one job (its slice) are measured against what it
 * renders (its page).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { copyFieldManualDocument, copiedReach, type SingleDocumentManual } from "../lib/control-plane/field-manual-copy.ts";
import { fieldManualLine, readFieldManual, type FieldManualEntry, type FieldManualRead } from "../lib/control-plane/field-manual.ts";
import { readRolePlaybook, rolePlaybook } from "../lib/control-plane/playbooks.ts";
import { readValidatorManual } from "../lib/control-plane/promotion/validator-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { Persisted } from "../lib/control-plane/repository/types.ts";
import { fieldManualBriefLines, scoutFieldManualCatalog, scoutFieldManualProjection, scoutFieldManualQuery } from "../lib/control-plane/scheduler/field-manual-scout.ts";
import { engineerJob } from "../lib/control-plane/workers/engineering-adapter.ts";
import { routeParse } from "../lib/control-plane/workers/model-parser.ts";
import { acquirerQuery } from "../lib/control-plane/workers/research-runtime.ts";
import { TRANSLATION_PLAYBOOK_QUERY, translationPlaybook } from "../lib/translate/worker.ts";

const dir = new URL("./fixtures/field-manual-pages/", import.meta.url);
const document = JSON.parse(readFileSync(new URL("manual.json", dir), "utf8")) as { entries: FieldManualEntry[] };
const jobs = JSON.parse(readFileSync(new URL("jobs.json", dir), "utf8")) as { key: string; ocdId: string; state: string; recordClass: string; host: string; workItemId: string }[];
const before = JSON.parse(readFileSync(new URL("before.json", dir), "utf8")) as {
  pages: Record<string, Record<string, { prompt: string; manual: string[] }>>;
  slices: Record<string, Record<string, { entries: number; bytes: number }>>;
};
const NOW = "2026-10-07T12:00:00.000Z";

/** The old document table in memory, as the copy reads it. */
export function memoryDocument(entries: readonly FieldManualEntry[]): SingleDocumentManual & { readonly retired: () => readonly string[] } {
  const rows = new Map<string, Persisted<{ entries: readonly FieldManualEntry[] }>>([["live", { id: "live", revision: 3, updatedAt: NOW, value: { entries } }]]);
  return {
    read: async (id) => rows.get(id) ?? null,
    retire: async (id, revision, as) => {
      const row = rows.get(id);
      if (!row || row.revision !== revision) return false;
      rows.delete(id);
      rows.set(as, { ...row, id: as });
      return true;
    },
    retired: () => [...rows.keys()],
  };
}

async function copied() {
  const repos = createMemoryRepositories();
  const report = await copyFieldManualDocument(memoryDocument(document.entries), repos, NOW);
  assert.ok(report);
  return { repos, report };
}

type Page = { prompt: string; manual: string[] };
const bytes = (value: unknown) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));

async function renderAfter(repos: ReturnType<typeof createMemoryRepositories>) {
  const pages: Record<string, Record<string, Page>> = {};
  const reads: Record<string, Record<string, FieldManualRead>> = {};
  const put = (role: string, job: string, page: Page, read: FieldManualRead) => {
    (pages[role] ??= {})[job] = page;
    (reads[role] ??= {})[job] = read;
  };
  for (const job of jobs) {
    const opts = { subjectId: job.ocdId, obligationId: job.workItemId, recordClass: job.recordClass, limit: 30 };
    const scout = await readFieldManual(repos, scoutFieldManualQuery(opts));
    const lines = fieldManualBriefLines(scoutFieldManualProjection(scout, opts));
    const catalog = scoutFieldManualCatalog(scout, opts);
    put("SCOUT", job.key, { prompt: rolePlaybook(catalog, "SCOUT").text, manual: lines }, scout);
    put("DETECTIVE", job.key, { prompt: rolePlaybook(catalog, "DETECTIVE").text, manual: lines }, scout);
    const parser = await readFieldManual(repos, { role: "PARSER", state: job.state, recordClass: job.recordClass });
    const route = routeParse(parser.store, { recordClass: job.recordClass, host: job.host });
    put("PARSER", job.key, { prompt: rolePlaybook(parser.store.entries, "PARSER").text, manual: [route.reason, `fields: ${route.knownFieldNames.join(",")}`] }, parser);
    const acquirer = await readFieldManual(repos, acquirerQuery(job.ocdId, job.recordClass));
    put("ACQUIRER", job.key, { prompt: "", manual: [...acquirer.projection.lines] }, acquirer);
    const translator = await readFieldManual(repos, TRANSLATION_PLAYBOOK_QUERY);
    put("TRANSLATOR", job.key, { prompt: translationPlaybook(translator.store.entries).text, manual: [] }, translator);
  }
  const validator = await readValidatorManual(repos);
  put("VALIDATOR", "pass", { prompt: validator.playbook, manual: [...validator.officialLinks].map(([host, ids]) => `${host}: ${ids.join(",")}`).sort() },
    await readFieldManual(repos, { role: "VALIDATOR", kinds: ["OFFICIAL_LINK", "PLAYBOOK"], everywhere: true }));
  put("AUDITOR", "audit", { prompt: (await readRolePlaybook(repos, "AUDITOR")).text, manual: [] },
    await readFieldManual(repos, { role: "AUDITOR", kinds: ["PLAYBOOK"], everywhere: true }));
  const engineer = await readFieldManual(repos, engineerJob({ subjectId: `${jobs[0]!.ocdId}#governing`, recordClass: "meetings" }, "legistar"));
  put("ENGINEER", "adapter", { prompt: (await readRolePlaybook(repos, "ENGINEER")).text, manual: [...engineer.projection.lines] }, engineer);
  return { pages, reads };
}

/** The intended differences, each with the reason a line may leave or join a page. */
const INTENDED = {
  OTHER_PLACE: "a lesson about another place's own source stays with that place",
  NO_PLACE: "a lesson that names no place no longer applies everywhere by default",
  OTHER_STATE: "a lesson from another state reaches this job only through the methods ranking",
  BELOW_LIMIT: "still applies, ranked below the page's line limit by the new order",
  HERE_NOTE: "a method line now says whether it works here, or where it has worked",
  METHOD_ELSEWHERE: "a method from anywhere is offered, ranked by where it has worked",
  PLATFORM_ANY_STATE: "a platform lesson applies on its platform in every state",
  RANKED_IN: "ranked into the page by the new order (this place, its state, national, elsewhere)",
} as const;

const strip = (line: string) => line.replace(/^\s+• /, "").replace(/ \[(works here|untried here[^\]]*|fails here[^\]]*)\]$/, "");

function classify(line: string, side: "removed" | "added", entries: readonly FieldManualEntry[], read: FieldManualRead,
  job: { state: string; ocdId?: string } | null, otherSide: readonly string[]): keyof typeof INTENDED | null {
  const body = strip(line);
  const entry = entries.find((e) => body.startsWith(fieldManualLine(e).replace(/ seen \d{4}-\d{2}-\d{2}$/, "")));
  if (!entry) return null;
  if (otherSide.some((other) => strip(other) === body)) return "HERE_NOTE";
  const inSlice = read.store.entries.some((e) => e.id === entry.id);
  const reach = copiedReach(entry);
  if (side === "removed") {
    if (inSlice) return "BELOW_LIMIT";
    if (reach === "NOWHERE") return "NO_PLACE";
    if (reach === "PLACE") return "OTHER_PLACE";
    if (reach === "STATE" && job !== null && !entry.states.includes(job.state)) return "OTHER_STATE";
    return null;
  }
  if (!inSlice) return null;
  if (reach === "METHOD") return "METHOD_ELSEWHERE";
  if (reach === "PLATFORM" && job !== null && !entry.states.includes(job.state)) return "PLATFORM_ANY_STATE";
  return "RANKED_IN";
}

test("every role's starting page is the old page except for the listed intended changes", async () => {
  const { repos } = await copied();
  const after = await renderAfter(repos);
  const rows = (await repos.fieldManual.list()).map((row) => row.value);
  const tally: Record<string, Record<string, number>> = {};
  for (const [role, byJob] of Object.entries(before.pages)) {
    for (const [key, old] of Object.entries(byJob)) {
      const now = after.pages[role]![key]!;
      assert.equal(now.prompt, old.prompt, `${role} ${key}: the written instructions are unchanged`);
      if (role === "PARSER" || role === "VALIDATOR") {
        assert.deepEqual(now.manual, old.manual, `${role} ${key}: the inherited routing is unchanged`);
        continue;
      }
      const job = jobs.find((j) => j.key === key) ?? (role === "ENGINEER" ? jobs[0]! : null);
      const read = after.reads[role]![key]!;
      const removed = old.manual.filter((line) => !now.manual.includes(line) && line.startsWith("  • "));
      const added = now.manual.filter((line) => !old.manual.includes(line) && (line.startsWith("  • ") || role !== "SCOUT" && role !== "DETECTIVE"));
      for (const [side, lines, other] of [["removed", removed, added], ["added", added, removed]] as const) {
        for (const line of lines) {
          const why = classify(line, side, rows, read, job, other);
          assert.ok(why, `${role} ${key}: an unlisted ${side} line: ${line}`);
          (tally[role] ??= {})[`${side}:${why}`] = ((tally[role] ??= {})[`${side}:${why}`] ?? 0) + 1;
        }
      }
    }
  }
  console.log(JSON.stringify(tally));
});

test("each role reads a slice of the manual, not the whole of it", async () => {
  const { repos } = await copied();
  const after = await renderAfter(repos);
  const whole = (await repos.fieldManual.list()).map((row) => row.value);
  const table: string[] = [];
  for (const [role, byJob] of Object.entries(after.reads)) {
    for (const [key, read] of Object.entries(byJob)) {
      const page = after.pages[role]![key]!;
      const slice = { entries: read.store.entries.length, bytes: bytes(read.store.entries) };
      const pageBytes = bytes(page.prompt) + bytes(page.manual.join("\n"));
      const old = before.slices[role]![key]!;
      table.push(`${role} ${key}: slice ${slice.entries} rows / ${slice.bytes} B (was ${old.entries} / ${old.bytes} B); page ${page.manual.length} lines / ${pageBytes} B`);
      assert.ok(slice.entries < whole.length, `${role} ${key} reads fewer rows than the whole manual`);
      assert.ok(slice.bytes < old.bytes, `${role} ${key} reads fewer bytes than the single document`);
    }
  }
  console.log(table.join("\n"));
});
