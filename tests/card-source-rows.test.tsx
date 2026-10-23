import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "yaml";
import { CardSourcesList } from "../components/officials/card-sources-list.tsx";
import { ReaderNamesProvider } from "../components/ui/reader-names-context.tsx";
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
  assert.match(html, /District offices/);
  assert.match(html, /Published by/);
  assert.match(html, /Read from/);
  assert.match(html, /Last checked/);
  assert.doesNotMatch(html, /Verified|Other ·|districtOffices|and \d+ more from this source|working on getting this info|Want us to get|not yet|no published page/);
  assert.equal(fieldSourceLabel("committees"), "Committees");
});

test("a source with no held publisher, page or dates renders coverage alone", () => {
  const html = renderToStaticMarkup(<CardSourcesList sources={[{
    what: "District offices", provenance: { sourceOrg: "", sourceUrl: null, collectedAt: "", verifiedAt: null },
  }]} />);
  assert.match(html, /District offices/);
  assert.doesNotMatch(html, /popup-row|Published by|Read from|Last checked|Verified|working on|not yet/);
});

test("a held verification date renders as its own date", () => {
  const html = renderToStaticMarkup(<CardSourcesList sources={[{
    what: "District offices", provenance: { ...holder.provenance!, verifiedAt: "2026-10-11T12:00:00Z" },
  }]} />);
  assert.match(html, /Verified<\/span><span[^>]*>2026-10-11/);
});

test("source quotes read as sentences with held names while saved evidence stays exact", () => {
  const sources = [{ what: "COMMON COUNCIL MEMBERS", provenance: {
    sourceOrg: "CITY OF MILWAUKEE", sourceUrl: "https://city.milwaukee.gov/",
    collectedAt: "2026-10-23", verifiedAt: null,
    quote: "ALD. MOORE SERVES ON THE COMMON COUNCIL IN MILWAUKEE. FEMA SUPPORT IS AVAILABLE.",
  } }];
  const saved = structuredClone(sources);
  const html = renderToStaticMarkup(<ReaderNamesProvider names={["Ald. Moore", "Common Council", "Milwaukee"]}>
    <CardSourcesList sources={sources} />
  </ReaderNamesProvider>);
  assert.match(html, /Ald\. Moore serves on the Common Council in Milwaukee\. FEMA support is available\./);
  assert.match(html, /City of Milwaukee/);
  assert.deepEqual(sources, saved);
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
  assert.match(html, /2026-10-10/);
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
  assert.match(html, /Identity; Office; Term/);
  assert.equal(mergeSources(entries.map(entry => ({ ...entry, provenance: { ...entry.provenance, sourceUrl: null } }))).length, 3,
    "without a held URL, distinct recorded publishers remain separate sources");
});

test("empty popup values disappear while a held zero remains", () => {
  for (const value of [null, undefined, false, "", "  ", [], <>{null}{false}{" "}</>]) {
    assert.equal(renderToStaticMarkup(<PopupRow label="Upcoming">{value}</PopupRow>), "");
  }
  assert.match(renderToStaticMarkup(<PopupRow label="Upcoming">{0}</PopupRow>), />0<\/span>/);
});
