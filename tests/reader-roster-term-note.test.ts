import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BODY_ROSTERS, HELD_BODY_ROSTERS, ROSTER_READER_DISPOSITIONS, rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { seatHolderById } from "../lib/registry/server.ts";
import { OfficialTermNote } from "../components/officials/official-term-note.tsx";

test("every eligible roster term note survives canonical holder lookup and the shared actual reader leaf verbatim", async () => {
  const held = HELD_BODY_ROSTERS.flatMap(roster => roster.members).filter(member => member.termNote);
  assert.ok(held.length > 0);
  const eligible = BODY_ROSTERS.flatMap(roster => roster.members).filter(member => member.termNote);
  let rendered = 0;
  for (const roster of BODY_ROSTERS) for (const holder of rosterHoldersForBody(roster.bodyId)) {
    const source = roster.members.find(member => member.id === holder.id)!;
    assert.equal(holder.termNote, source.termNote);
    assert.equal(holder.termEnd, null, "A published note never becomes an inferred end date");
    assert.equal((await seatHolderById(holder.id))?.termNote, source.termNote);
    const markup = renderToStaticMarkup(createElement(OfficialTermNote, { holder }));
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
  assert.equal(renderToStaticMarkup(createElement(OfficialTermNote, { holder: { ...holder, termNote: null, termEnd: "2027-01-01" } })), "");
  const aliases = ROSTER_READER_DISPOSITIONS.filter(row => row.state === "EXACT_DUPLICATE");
  assert.ok(aliases.length > 0);
  for (const row of aliases) assert.ok(BODY_ROSTERS.every(roster => !roster.members.some(member => member.id === row.sourceId)));
});
