import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkingOnIt, workingLine } from "../components/demand/working-on-it.tsx";
import { PersonCard } from "../components/ui/person-card.tsx";
import { copy } from "../lib/design/copy.ts";
import type { SweepRecord } from "../lib/corpus/statement-sweep.ts";

const sweep: SweepRecord = { subjectId: "candidate:one", unreadable: 0, equalEffort: true,
  topics: [{ topic: "Housing", answer: "SEARCHED_NOTHING_MATCHED", passages: 0,
    sourcesSearched: [{ url: "https://example.gov/candidate", kindLabel: "Campaign", basis: "THEIRS" }] }] };

test("a gap cannot turn into a searched absence without an equal-effort topic record", () => {
  assert.equal(workingLine(), copy("copy.working"));
  assert.equal(workingLine({ kind: "searched", topic: "Housing", sweep }), copy("copy.notFound"));
  for (const record of [{ ...sweep, equalEffort: false }, { ...sweep, topics: [] }]) {
    assert.equal(workingLine({ kind: "searched", topic: "Housing", sweep: record }), copy("copy.working"));
  }
  assert.equal(workingLine({ kind: "searched", topic: "Education", sweep }), copy("copy.working"));
  assert.equal(workingLine({ kind: "not-published", item: "Agenda" }), "Agenda not posted yet");
});

test("gap rows retain their valid inline HTML and published copy overrides", () => {
  const html = renderToStaticMarkup(<p><WorkingOnIt inline /></p>);
  assert.doesNotMatch(html, /<div/);
  assert.match(html, /data-working-on-it="not-searched"/);
  assert.equal(copy("copy.working", { "copy.working": "Gathering this information" }), "Gathering this information");
  assert.equal(copy("copy.working", { "copy.working": "  " }), copy("copy.working"));
});

test("an official and a thin candidate share every section header and contact position", () => {
  const render = (sections: { office?: React.ReactNode }) => renderToStaticMarkup(<PersonCard title="Person" identity={<p>Person</p>} contact={<a href="mailto:public@example.gov">Email</a>} sections={sections} />);
  const headers = (html: string) => [...html.matchAll(/class="card-section-title"[^>]*>(.*?)<\/span>/g)].map(match => match[1]);
  const official = render({ office: <p>The office makes public decisions.</p> });
  const candidate = render({});
  assert.deepEqual(headers(official), headers(candidate));
  assert.equal(headers(candidate).length, 7);
  assert.ok(candidate.indexOf("data-person-contact") < candidate.indexOf("What this office does"));
  assert.equal((candidate.match(/data-card-sources=/g) ?? []).length, 1);
});
