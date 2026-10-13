import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkingOnIt } from "../components/demand/working-on-it.tsx";
import { PersonCard } from "../components/ui/person-card.tsx";
import { cardGapLine } from "../lib/design/card-gaps.ts";
import { copy } from "../lib/design/copy.ts";
import congress from "./fixtures/ui-01-congress-legislators-hinson.json" with { type: "json" };

test("the card gap counts missing facts once even when more than one section reports them", () => {
  assert.equal(cardGapLine([
    { id: "agenda:one", label: "agendas", unit: "meeting", kind: "not-posted" },
    { id: "agenda:two", label: "agendas", unit: "meeting", kind: "not-posted" },
    { id: "agenda:one", label: "agendas", unit: "meeting", kind: "not-posted" },
    { id: "places", label: "meeting places", count: 2, unit: "meeting", kind: "not-posted" },
  ]), "Not posted yet: agendas for 2 meetings, meeting places for 2 meetings.");
});

test("a publisher's unposted facts and our uncollected facts retain their meaning in one line", () => {
  assert.equal(cardGapLine([
    { id: "agenda", label: "an agenda", unit: "meeting", kind: "not-posted" },
    { id: "contact", label: "contact details" },
    { id: "rosters", label: "members", count: 2, unit: "body" },
  ]), "Not posted yet: an agenda for 1 meeting; Still gathering: contact details, members for 2 bodies.");
  assert.equal(cardGapLine([]), null);
  assert.equal(cardGapLine([
    { id: "held", label: "agendas", count: 0 },
    { id: "unnamed", label: "  " },
  ]), null);
});

test("Ask's whole-answer absence keeps valid inline HTML and published copy overrides", () => {
  const html = renderToStaticMarkup(<p><WorkingOnIt inline /></p>);
  assert.doesNotMatch(html, /<div/);
  assert.match(html, /data-working-on-it="not-searched"/);
  assert.equal(copy("copy.working", { "copy.working": "Gathering this information" }), "Gathering this information");
  assert.equal(copy("copy.working", { "copy.working": "  " }), copy("copy.working"));
});

test("a sparse person card renders held sections and one gap above its only Sources section", () => {
  const [member] = parse(congress.yaml["legislators-current"]) as { name: { official_full: string }; terms: { url: string }[] }[];
  const [directory] = parse(congress.yaml["legislators-district-offices"]) as { offices: { city: string }[] }[];
  const html = renderToStaticMarkup(<PersonCard
    title={member.name.official_full}
    identity={<p>{member.name.official_full}</p>}
    contact={<a href={member.terms.at(-1)!.url}>Website</a>}
    subject={{ type: "CANDIDATE", id: "congress:H001091" }}
    sections={{ offices: <p>{directory.offices[0].city}</p> }}
  />);
  const headers = [...html.matchAll(/class="card-section-title"[^>]*>(.*?)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(headers, ["Offices near you", "Sources"]);
  assert.match(html, /Waterloo/);
  assert.equal((html.match(/data-card-gap=/g) ?? []).length, 1);
  assert.equal((html.match(/data-demand-pill=/g) ?? []).length, 1);
  assert.equal((html.match(/data-card-sources=/g) ?? []).length, 1);
  assert.match(html, /Still gathering: what this office does, positions, committees, campaign money, voting record\./);
  assert.doesNotMatch(html, /working on getting this info|Want us to get this info sooner|contact details/);
  assert.ok(html.indexOf("data-person-contact") < html.indexOf("Offices near you"));
  assert.ok(html.indexOf("data-card-gap") < html.indexOf("Ask us to find this"));
  assert.ok(html.indexOf("Ask us to find this") < html.indexOf("data-card-sources"));
});

test("a person with no held contact or sections has one request and no empty field headers", () => {
  const html = renderToStaticMarkup(<PersonCard title="Person" identity={<p>Person</p>} contact={null}
    sections={{}} subject={{ type: "CANDIDATE", id: "candidate:one" }} />);
  const headers = [...html.matchAll(/class="card-section-title"[^>]*>(.*?)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(headers, ["Sources"]);
  assert.doesNotMatch(html, /data-person-contact|working on getting this info|Want us to get this info sooner/);
  assert.match(html, /voting record, contact details\./);
  assert.equal((html.match(/data-card-gap=/g) ?? []).length, 1);
  assert.equal((html.match(/data-demand-pill=/g) ?? []).length, 1);
});
