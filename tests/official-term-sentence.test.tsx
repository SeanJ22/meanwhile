import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OfficialTermNote } from "../components/officials/official-term-note.tsx";
import type { SeatHolder } from "../lib/officials/lookup.ts";

const holder = { id: "held:official", termNote: "Elected November 2024 to a four-year term", termEnd: "2028-12-31" } as SeatHolder;

test("an election note reads as one plain sentence with the held end year", () => {
  const html = renderToStaticMarkup(<OfficialTermNote holder={holder} />);
  assert.match(html, />Elected in November 2024 to a four-year term, through 2028\.<\/p>/);
  assert.doesNotMatch(html, /Roster|appointment note|2028-12-31|[“”]/);
});

test("a note keeps all its words without inventing a missing term date", () => {
  const html = renderToStaticMarkup(<OfficialTermNote holder={{ ...holder, termEnd: null }} />);
  assert.match(html, />Elected in November 2024 to a four-year term\.<\/p>/);
  assert.doesNotMatch(html, /through/);
  assert.equal(renderToStaticMarkup(<OfficialTermNote holder={{ ...holder, termNote: "  " }} />), "");
});

test("an appointment sentence and an already stated end year stay intact", () => {
  const html = renderToStaticMarkup(<OfficialTermNote holder={{ ...holder, termNote: "Appointed in March 2025; serves through 2028." }} />);
  assert.match(html, />Appointed in March 2025; serves through 2028\.<\/p>/);
  assert.equal((html.match(/through/g) ?? []).length, 1);
});
