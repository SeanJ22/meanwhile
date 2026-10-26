import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "yaml";
import { CardSourcesList, readableSourceQuotes } from "../components/officials/card-sources-list.tsx";
import { PersonIdentity } from "../components/officials/person-identity.tsx";
import { PopupRow } from "../components/map/popup/popup-row.tsx";
import { fieldSourceLabel, mergeSources, personCardSources } from "../lib/officials/card-sources.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { indexByOfficeholderId } from "../lib/officials/lookup.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/ui-01-congress-legislators-hinson.json", import.meta.url), "utf8"));
const projection = normalizeCongressDirectory(Object.fromEntries(Object.entries(fixture.yaml).map(([name, yaml]) => [name, parse(yaml as string)])), fixture.revision, fixture.retrievedAt);
const holder = indexByOfficeholderId([projection.roster]).get("congress:H001091")!;

test("the live person identity preserves its held party pill", () => {
  const html = renderToStaticMarkup(<PersonIdentity holder={holder} seatLabel="IA-2" />);
  assert.match(html, /id-chip[^>]*data-fill="true"[^>]*>Republican/);
});

test("the saved Congress source renders held metadata and reader field labels", () => {
  assert.ok(holder);
  assert.equal(holder.provenance?.verifiedAt, null);
  assert.ok(holder.fieldSources?.districtOffices);
  const html = renderToStaticMarkup(<CardSourcesList sources={personCardSources(holder)} />);
  assert.match(html, /District offices and how to reach them/);
  assert.match(html, /Published by/);
  assert.match(html, /Read from/);
  assert.match(html, /Last checked/);
  assert.doesNotMatch(html, /Verified|Other ·|districtOffices|and \d+ more from this source|working on getting this info|Want us to get|not yet|no published page/);
  assert.equal(fieldSourceLabel("committees"), "The committees they serve on");
  assert.equal(fieldSourceLabel("new_internal_field"), "The facts shown on this card");
});

test("a source with no held publisher, page or dates renders coverage alone", () => {
  const html = renderToStaticMarkup(<CardSourcesList sources={[{
    what: "District offices", provenance: { sourceOrg: "", sourceUrl: null, collectedAt: "", verifiedAt: null },
  }]} />);
  assert.match(html, /District offices/);
  assert.doesNotMatch(html, /popup-row|Published by|Read from|Last checked|Verified|working on|not yet/);
});

test("a held confirmation date renders as a readable date", () => {
  const html = renderToStaticMarkup(<CardSourcesList sources={[{
    what: "District offices", provenance: { ...holder.provenance!, verifiedAt: "2026-10-11T12:00:00Z" },
  }]} />);
  assert.match(html, /Confirmed<\/span><span[^>]*>October 11, 2026/);
});

test("one source preserves captured identities and last checked dates", () => {
  const provenance = holder.provenance!;
  const sources = mergeSources([
    { what: "Office", provenance, dataAttrs: { "data-captured-office": "current" } },
    { what: "District offices", provenance: { ...provenance, collectedAt: "2026-10-10" }, dataAttrs: { "data-captured-office": "previous" } },
  ]);
  const html = renderToStaticMarkup(<CardSourcesList sources={sources} />);
  assert.equal(sources.length, 1);
  assert.equal((html.match(/>Published by</g) ?? []).length, 1);
  assert.equal((html.match(/>Read from</g) ?? []).length, 1);
  assert.match(html, /data-captured-office="current"/);
  assert.match(html, /data-captured-office="previous"/);
  assert.match(html, /October 10, 2026/);
  assert.doesNotMatch(html, /2026-10-10/);
  assert.deepEqual(mergeSources([...sources, ...sources]), sources);
});

test("a held source URL appears once when contributions differ in publisher knowledge", () => {
  const provenance = holder.provenance!;
  const entries = [
    { what: "Identity", provenance: { ...provenance, sourceOrg: "" } },
    { what: "Office", provenance },
    { what: "Term", provenance: { ...provenance, sourceOrg: new URL(provenance.sourceUrl!).host } },
  ];
  const sources = mergeSources(entries);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].provenance.sourceOrg, `${provenance.sourceOrg}; ${new URL(provenance.sourceUrl!).host}`);
  assert.deepEqual(mergeSources([...sources, ...entries]), sources);
  const html = renderToStaticMarkup(<CardSourcesList sources={sources} />);
  assert.equal((html.match(/>Published by</g) ?? []).length, 1);
  assert.equal((html.match(/>Read from</g) ?? []).length, 1);
  for (const coverage of ["Identity", "Office", "Term"]) assert.match(html, new RegExp(`>${coverage}<`));
  assert.equal(mergeSources(entries.map(entry => ({ ...entry, provenance: { ...entry.provenance, sourceUrl: null } }))).length, 3,
    "without a held URL, distinct recorded publishers remain separate sources");
});

test("empty popup values disappear while a held zero remains", () => {
  for (const value of [null, undefined, false, "", "  ", [], <>{null}{false}{" "}</>]) {
    assert.equal(renderToStaticMarkup(<PopupRow label="Upcoming">{value}</PopupRow>), "");
  }
  assert.match(renderToStaticMarkup(<PopupRow label="Upcoming">{0}</PopupRow>), />0<\/span>/);
});


test("raw roster evidence shows only its readable supporting words", () => {
  const quote = "2028-12-31T00:00:00 2021-01-01T00:00:00 Member Supervisor Rex Scott 138 206 571";
  assert.deepEqual(readableSourceQuotes(quote), ["Member Supervisor Rex Scott"]);
  assert.deepEqual(readableSourceQuotes("571"), []);
  assert.deepEqual(readableSourceQuotes("PersonId 571"), []);
  assert.deepEqual(readableSourceQuotes("McDonald and LeBron spoke about iPhone access"), ["McDonald and LeBron spoke about iPhone access"]);
  assert.deepEqual(readableSourceQuotes('{"id":571,"name":"Rex Scott"}'), []);
  assert.deepEqual(readableSourceQuotes("Elected November 2024 to a four-year term"), ["Elected November 2024 to a four-year term"]);
  assert.deepEqual(readableSourceQuotes("Their term runs through 2028"), ["Their term runs through 2028"]);
  const html = renderToStaticMarkup(<CardSourcesList sources={[{ what: "Who sits on this board and their terms", provenance: {
    sourceUrl: "https://pima.gov/board/571", sourceOrg: "Pima County", collectedAt: "2026-10-23T12:34:56Z", verifiedAt: null, quote,
  } }]} />);
  assert.match(html, /Member Supervisor Rex Scott/);
  assert.match(html, /October 23, 2026/);
  assert.match(html, /href="https:\/\/pima.gov\/board\/571"/);
  assert.doesNotMatch(html.replace(/href="[^"]*"/g, ""), /2028-12-31|2021-01-01|00:00:00|138 206 571|2026-10-23T/);
});

test("stored roster keys become descriptions while every linked source remains", () => {
  const provenance = { sourceUrl: "https://county.gov/roster", sourceOrg: "County Clerk", collectedAt: "2026-10-23", verifiedAt: null };
  const sources = personCardSources({ ...holder, provenance, fieldSources: {
    termStart: { ...provenance, sourceUrl: "https://county.gov/terms" },
    internal_record_id: { ...provenance, sourceUrl: "https://county.gov/person/571", quote: "571" },
    officeEmail: { ...provenance, sourceUrl: "https://county.gov/contact" },
  } });
  const html = renderToStaticMarkup(<CardSourcesList sources={sources} />);
  assert.match(html, /Their name, office and term/);
  assert.match(html, /How to email the office/);
  assert.match(html, /The facts shown on this card/);
  assert.doesNotMatch(html, /termStart|Term start date|internal_record_id|Internal record id|officeEmail|>571</);
  for (const url of ["https://county.gov/roster", "https://county.gov/terms", "https://county.gov/person/571", "https://county.gov/contact"]) assert.ok(html.includes(`href="${url}"`));
});
