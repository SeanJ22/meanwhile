import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installRegistryAuthority, registryFixtureForState } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

import { rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { BODY_ROSTERS, HELD_BODY_ROSTERS, ROSTER_READER_DISPOSITIONS } from "./fixtures/held-body-rosters.ts";
import { seatHolderById } from "../lib/registry/server.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import { OfficialTermNote } from "../components/officials/official-term-note.tsx";
import { Card } from "../components/ui/card.tsx";
import { personCardSources } from "../lib/officials/card-sources.ts";
import { getRegistryRuntimeReadModel, selectedRegistryStates, withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { statesForRegistryDivisions } from "../lib/civic-data/state-scopes.ts";

/** The actual term-note leaf inside its card, whose footer owns the source link. */
function renderTermNotes(holders: readonly SeatHolder[]): string[] {
  return holders.map(holder => renderToStaticMarkup(createElement(Card, {
    title: holder.name, sources: personCardSources(holder), children: createElement(OfficialTermNote, { holder }),
  })));
}

test("every eligible roster term note survives canonical holder lookup and the plain-language reader sentence", async () => {
  const held = HELD_BODY_ROSTERS.flatMap(roster => roster.members).filter(member => member.termNote);
  assert.ok(held.length > 0);
  const eligible = BODY_ROSTERS.flatMap(roster => roster.members).filter(member => member.termNote);
  const holders = BODY_ROSTERS.flatMap(roster => rosterHoldersForBody(roster.bodyId));
  const markupByHolder = new Map(renderTermNotes(holders).map((markup, index) => [holders[index].id, markup]));
  const wholeRegistry = getRegistryRuntimeReadModel(), selectedStates = selectedRegistryStates();
  const stateFixtures = new Map(selectedStates.map(state => [state, registryFixtureForState(state, wholeRegistry)]));
  const canonicalHolder = async (holder: SeatHolder, bodyId: string) => {
    const state = statesForRegistryDivisions([bodyId])[0];
    assert.ok(state, `The roster must name its state: ${bodyId}`);
    const fixture = stateFixtures.get(state);
    assert.ok(fixture, `The held state fixture must exist: ${state}`);
    try {
      return await withRegistryRuntimeProjection(fixture, [state], () => seatHolderById(holder.id, state));
    } finally {
      withRegistryRuntimeProjection(wholeRegistry, selectedStates, () => undefined);
    }
  };
  let rendered = 0;
  for (const roster of BODY_ROSTERS) for (const holder of rosterHoldersForBody(roster.bodyId)) {
    const source = roster.members.find(member => member.id === holder.id)!;
    assert.equal(holder.termNote, source.termNote);
    assert.equal(holder.termEnd, null, "A published note never becomes an inferred end date");
    assert.equal((await canonicalHolder(holder, roster.bodyId))?.termNote, source.termNote);
    const markup = markupByHolder.get(holder.id)!;
    if (!source.termNote) { assert.doesNotMatch(markup, /data-official-term-note/); continue; }
    const escaped = renderToStaticMarkup(createElement("span", null, source.termNote)).slice(6, -7);
    const sentence = markup.match(/data-official-term-note="[^"]*"[^>]*><p>(.*?)<\/p>/)?.[1];
    assert.ok(sentence, holder.id);
    const words = (value: string) => value.replace(/\bin\b/g, "").replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
    assert.equal(words(sentence), words(escaped), holder.id);
    assert.doesNotMatch(sentence, /Roster term|appointment note|[“”]/);
    assert.ok(markup.includes(`data-official-term-note="${holder.id}"`));
    assert.ok(markup.includes(roster.sourceUrl.replaceAll("&", "&amp;")));
    assert.ok(markup.includes(renderToStaticMarkup(createElement("span", null, roster.sourceOrg)).slice(6, -7)));
    assert.equal((markup.match(/data-card-sources=/g) ?? []).length, 1);
    rendered++;
  }
  assert.equal(rendered, eligible.length);
  for (const row of ROSTER_READER_DISPOSITIONS.filter(row => row.state === "IDENTITY_UNRESOLVED")) assert.equal(await seatHolderById(row.sourceId), null);
});

test("shared term-note leaf never derives a note from a date or attaches an unresolved roster row", () => {
  const holder = BODY_ROSTERS.flatMap(roster => rosterHoldersForBody(roster.bodyId)).find(row => row.termNote)!;
  assert.doesNotMatch(renderTermNotes([{ ...holder, termNote: null, termEnd: "2027-01-01" }])[0], /data-official-term-note/);
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
  assert.ok(markup.includes(escapedNote.replace(/^Elected /, "Elected in ")), "The held note survives the missing publisher field");
  assert.ok(markup.includes(`href="${holder.sourceUrl!.replaceAll("&", "&amp;")}"`));
  assert.ok(markup.includes("data-card-sources"), "The observed URL remains inside Sources");
  assert.ok(!markup.includes(holder.provenance!.sourceOrg), "No organization is borrowed from another field or record");
  assert.doesNotMatch(markup, /Last checked|Verified|Published by|data-working-on-it/, "Missing metadata rows are omitted");
  assert.doesNotMatch(withoutNote, /data-official-term-note/);
  assert.ok(withoutUrl.includes(escapedNote.replace(/^Elected /, "Elected in ")));
  assert.doesNotMatch(withoutUrl, /href="https?:/, "A missing source never gets an invented source link");
  assert.match(withoutUrl, /Want us to get this sooner/, "The missing Sources section keeps its request link");
  assert.ok(!withoutUrl.includes("Published roster"), "No source link label substitutes for an absent URL");
});
