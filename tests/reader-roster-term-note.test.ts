import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

import { BODY_ROSTERS, HELD_BODY_ROSTERS, ROSTER_READER_DISPOSITIONS, rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { seatHolderById } from "../lib/registry/server.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";

/** Keep the canonical Node test runner; compile the actual TSX leaf in a child. */
function renderTermNotes(holders: readonly SeatHolder[]): string[] {
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", `
    import { readFileSync } from 'node:fs';
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { OfficialTermNote } from './components/officials/official-term-note.tsx';
    const holders = JSON.parse(readFileSync(0, 'utf8'));
    console.log(JSON.stringify(holders.map(holder => renderToStaticMarkup(createElement(OfficialTermNote, { holder })))));
  `], { cwd: process.cwd(), input: JSON.stringify(holders), encoding: "utf8", timeout: 120_000, maxBuffer: 4_000_000 });
  const result: unknown = JSON.parse(output);
  assert.ok(Array.isArray(result) && result.every(value => typeof value === "string"));
  assert.equal(result.length, holders.length);
  return result;
}

test("every eligible roster term note survives canonical holder lookup and the shared actual reader leaf verbatim", async () => {
  const held = HELD_BODY_ROSTERS.flatMap(roster => roster.members).filter(member => member.termNote);
  assert.ok(held.length > 0);
  const eligible = BODY_ROSTERS.flatMap(roster => roster.members).filter(member => member.termNote);
  const holders = BODY_ROSTERS.flatMap(roster => rosterHoldersForBody(roster.bodyId));
  const markupByHolder = new Map(renderTermNotes(holders).map((markup, index) => [holders[index].id, markup]));
  let rendered = 0;
  for (const roster of BODY_ROSTERS) for (const holder of rosterHoldersForBody(roster.bodyId)) {
    const source = roster.members.find(member => member.id === holder.id)!;
    assert.equal(holder.termNote, source.termNote);
    assert.equal(holder.termEnd, null, "A published note never becomes an inferred end date");
    assert.equal((await seatHolderById(holder.id))?.termNote, source.termNote);
    const markup = markupByHolder.get(holder.id)!;
    if (!source.termNote) { assert.equal(markup, ""); continue; }
    const escaped = renderToStaticMarkup(createElement("span", null, source.termNote)).slice(6, -7);
    assert.ok(markup.includes(escaped), holder.id);
    assert.ok(markup.includes(`data-official-term-note="${holder.id}"`));
    assert.ok(markup.includes(roster.sourceUrl.replaceAll("&", "&amp;")));
    assert.ok(markup.includes(renderToStaticMarkup(createElement("span", null, roster.sourceOrg)).slice(6, -7)));
    rendered++;
  }
  assert.equal(rendered, eligible.length);
  for (const row of ROSTER_READER_DISPOSITIONS.filter(row => row.state === "IDENTITY_UNRESOLVED")) assert.equal(await seatHolderById(row.sourceId), null);
});

test("shared term-note leaf never derives a note from a date or attaches an unresolved roster row", () => {
  const holder = BODY_ROSTERS.flatMap(roster => rosterHoldersForBody(roster.bodyId)).find(row => row.termNote)!;
  assert.equal(renderTermNotes([{ ...holder, termNote: null, termEnd: "2027-01-01" }])[0], "");
  const aliases = ROSTER_READER_DISPOSITIONS.filter(row => row.state === "EXACT_DUPLICATE");
  assert.ok(aliases.length > 0);
  for (const row of aliases) assert.ok(BODY_ROSTERS.every(roster => !roster.members.some(member => member.id === row.sourceId)));
});

test("roster-source link label never supplies a missing note, publisher or read date", () => {
  const holder = BODY_ROSTERS.flatMap(roster => rosterHoldersForBody(roster.bodyId)).find(row => row.termNote && row.sourceUrl && row.provenance)!;
  assert.ok(holder, "The control must start from an actual sourced roster note");
  const noPublisher = { ...holder, provenance: null };
  const [markup, withoutNote, withoutUrl] = renderTermNotes([noPublisher, { ...noPublisher, termNote: null }, { ...noPublisher, sourceUrl: null }]);
  const escapedNote = renderToStaticMarkup(createElement("span", null, holder.termNote)).slice(6, -7);
  assert.ok(markup.includes(escapedNote), "The held note survives the missing publisher field");
  assert.ok(markup.includes(`href="${holder.sourceUrl!.replaceAll("&", "&amp;")}"`));
  assert.ok(markup.includes("data-card-sources"), "The observed URL remains inside Sources");
  assert.ok(!markup.includes(holder.provenance!.sourceOrg), "No organization is borrowed from another field or record");
  assert.match(markup.slice(markup.indexOf("Last checked"), markup.indexOf("Verified")), /data-working-on-it=/, "No read date is invented from missing provenance");
  assert.equal(withoutNote, "");
  assert.ok(withoutUrl.includes(escapedNote));
  assert.ok(!withoutUrl.includes("<a "));
  assert.ok(!withoutUrl.includes("Published roster"), "No source link label substitutes for an absent URL");
});
