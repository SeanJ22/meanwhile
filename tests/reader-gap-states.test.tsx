import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkingOnIt } from "../components/demand/working-on-it.tsx";
import { PersonCard } from "../components/ui/person-card.tsx";
import { CardGapsContribution } from "../components/ui/card-gap-context.tsx";
import { copy } from "../lib/design/copy.ts";
import congress from "./fixtures/ui-01-congress-legislators-hinson.json" with { type: "json" };

const sectionParts = (html: string) => html.split(/(?=<section class="card-section")/).slice(1);
const titleOf = (html: string) => /class="card-section-title"[^>]*>(.*?)<\/span>/.exec(html)?.[1];
const missingText = /We(?:&#x27;|'|’)re working on getting this info/;

test("a section deduplicates its missing requests without making a list", () => {
  const html = renderToStaticMarkup(<CardGapsContribution id="meeting-info" gaps={[
    { id: "agenda:one", label: "agendas", unit: "meeting", kind: "not-posted" },
    { id: "agenda:two", label: "agendas", unit: "meeting", kind: "not-posted" },
    { id: "agenda:one", label: "agendas", unit: "meeting", kind: "not-posted" },
    { id: "join", label: "online join links" },
    { id: "place", label: "meeting places" },
  ]} />);
  assert.equal((html.match(/data-card-gap=/g) ?? []).length, 2);
  assert.equal((html.match(/Agendas not posted yet\./g) ?? []).length, 1);
  assert.match(html, missingText);
  assert.equal((html.match(/Want us to get this sooner\?/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Still gathering|for \d+ meetings|online join links, meeting places/);
});

test("facts held already do not create missing-information messages", () => {
  assert.equal(renderToStaticMarkup(<CardGapsContribution id="none" gaps={[]} />), "");
  assert.equal(renderToStaticMarkup(<CardGapsContribution id="held" gaps={[
    { id: "held", label: "agendas", count: 0 },
    { id: "unnamed", label: "  " },
  ]} />), "");
});

test("Ask's whole-answer absence keeps valid inline HTML and the section request", () => {
  const html = renderToStaticMarkup(<p><WorkingOnIt inline /></p>);
  assert.doesNotMatch(html, /<div/);
  assert.match(html, /data-working-on-it="not-searched"/);
  assert.match(html, missingText);
  assert.match(html, /Want us to get this sooner\?/);
  assert.equal(copy("copy.working", { "copy.working": "Gathering this information" }), "Gathering this information");
  assert.equal(copy("copy.working", { "copy.working": "  " }), copy("copy.working"));
});

test("a sparse person card keeps held facts and puts each request in its own section", () => {
  const [member] = parse(congress.yaml["legislators-current"]) as { name: { official_full: string }; terms: { url: string }[] }[];
  const [directory] = parse(congress.yaml["legislators-district-offices"]) as { offices: { city: string }[] }[];
  const html = renderToStaticMarkup(<PersonCard
    title={member.name.official_full}
    identity={<p>{member.name.official_full}</p>}
    contact={<a href={member.terms.at(-1)!.url}>Website</a>}
    subject={{ type: "CANDIDATE", id: "congress:H001091" }}
    sections={{ offices: <p>{directory.offices[0].city}</p> }}
  />);
  const sections = sectionParts(html);
  assert.deepEqual(sections.map(titleOf), ["Contact", "What this office does", "Positions", "Committees", "Offices near you", "Campaign money", "Voting record", "Sources"]);
  assert.match(sections.find(section => titleOf(section) === "Offices near you")!, /Waterloo/);
  for (const section of sections) {
    if (["Contact", "Offices near you", "Sources"].includes(titleOf(section)!)) continue;
    assert.match(section, /data-card-gap-contribution=/, `${titleOf(section)} contributes its gap`);
  }
  for (const title of ["Contact", "Offices near you"]) {
    assert.doesNotMatch(sections.find(section => titleOf(section) === title)!, /data-card-gap/);
  }
  assert.equal((html.match(/data-card-sources=/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Still gathering|contact details/);
  assert.doesNotMatch(html.slice(html.indexOf("data-card-footer")), /person:.*:(?:office|positions|money|record)/);
});

test("a person with no held contact or sections says so in every applicable section", () => {
  const html = renderToStaticMarkup(<PersonCard title="Person" identity={<p>Person</p>} contact={null}
    sections={{}} subject={{ type: "CANDIDATE", id: "candidate:one" }} />);
  const sections = sectionParts(html);
  assert.deepEqual(sections.map(titleOf), ["Contact", "What this office does", "Positions", "Committees", "Offices near you", "Campaign money", "Voting record", "Sources"]);
  for (const section of sections.filter(section => titleOf(section) !== "Sources")) {
    assert.match(section, /data-card-gap-contribution=/);
  }
  assert.doesNotMatch(html, /Still gathering/);
});
