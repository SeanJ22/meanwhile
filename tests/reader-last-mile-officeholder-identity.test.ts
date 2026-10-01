import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ROSTER_FILES } from "../lib/coverage/artifacts.ts";
import { rosterPath } from "../lib/holdings/runtime-paths.ts";
import { allSeatHolders, seatHolderById, seatHoldersForDivision } from "../lib/registry/server.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import type { AskAnswerPayload } from "../lib/ask/answer.ts";

const sets = ROSTER_FILES.map((file) => ({ file, set: JSON.parse(readFileSync(rosterPath(file), "utf8")) as OfficeholderSet }));
const rawPeople = sets.flatMap(({ set }) => set.officeholders);

test("every committed officeholder survives exact-ID lookup, independent of held geometry", async () => {
  const all = new Map((await allSeatHolders()).map((holder) => [holder.id, holder]));
  assert.equal(rawPeople.length, 1159, "finite current canonical roster denominator");
  for (const raw of rawPeople) {
    const holder = await seatHolderById(raw.id);
    assert.ok(holder, `${raw.id} ${raw.name}`);
    assert.equal(holder.id, raw.id);
    assert.equal(holder.name, raw.name);
    assert.equal(holder.officeTitle, raw.officeTitle);
    assert.equal(holder.email, raw.email);
    assert.equal(holder.phone, raw.phone);
    assert.equal(holder.sourceUrl, raw.provenance.sourceUrl);
    assert.ok(all.has(raw.id));
  }
  assert.equal(await seatHolderById("plural:unresolved-person"), null);
});

test("making unmapped people readable never manufactures a geographic membership", async () => {
  const linked = new Set(sets.flatMap(({ set }) => set.divisions.map((link) => link.officeholderId)));
  const unlinked = rawPeople.filter((person) => !linked.has(person.id));
  assert.equal(unlinked.length, 496, "66 AZ, 325 NH, 99 NJ, and six federal delegates have no held division join");
  const divisionIds = [...new Set(sets.flatMap(({ set }) => set.divisions.map((link) => link.ocdId)))];
  const geographyPeople = new Set((await Promise.all(divisionIds.map(seatHoldersForDivision))).flat().map((person) => person.id));
  for (const person of unlinked) {
    assert.ok(await seatHolderById(person.id), person.id);
    assert.ok(!geographyPeople.has(person.id), `${person.name} must not become a representative of a place through the by-ID index`);
  }
});

test("Ask can answer an explicitly named unmapped official without calling them the reader's representative", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  resetGroundedState();
  const id = "plural:e60aed5e-cbb4-4b27-ab1b-2ce1dd787dac";
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-all-officials" },
    body: JSON.stringify({ question: "How can I contact Aboul Khan?", surface: "MAP", ocdIds: ["ocd-division/country:us/state:az"], today: "2026-09-04" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as AskAnswerPayload;
  assert.equal(body.subject?.id, id);
  assert.ok(body.records.some((record) => record.kind === "OFFICEHOLDER" && record.id === id));
  assert.ok(body.contacts.some((contact) => contact.id === `office:${id}`));
  assert.ok(body.contacts.every((contact) => contact.basis !== "READER_REPRESENTATIVE"));
  assert.equal(body.answer, null, "the held record alone supplies this answer");
});
