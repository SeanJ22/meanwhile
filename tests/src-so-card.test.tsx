import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenDataFacts } from "../components/map/open-data.tsx";
import { normalizeEcho, normalizeSocrata } from "../lib/sources/open-data/normalize.ts";
import { parseCatalogPage } from "../lib/sources/open-data/acquire.ts";
import { streamCsvObjects } from "../lib/sources/prl/streaming.ts";
test("Actual open-data card renders official attribution, dates and one bottom Sources list",async()=>{
  const text=readFileSync(new URL("./fixtures/src-so/echo-exporter-sample.csv",import.meta.url),"utf8");
  const records=[];for await(const row of streamCsvObjects((async function*(){yield text;})())){records.push(normalizeEcho(row,"2026-10-12T23:24:00.000Z","2026-10-11T02:25:45.000Z"));break;}
  const raw=parseCatalogPage(readFileSync(new URL("./fixtures/src-so/socrata-ny.json",import.meta.url),"utf8")).rows[0];records.push(normalizeSocrata(raw,"2026-10-12T23:24:00.000Z"));
  const html=renderToStaticMarkup(<OpenDataFacts records={records} />);
  assert.match(html,/TITAN CLEANERS/);assert.match(html,/Quarters with noncompliance: 1/);assert.match(html,/Published 2026-10-11/);
  assert.match(html,/U.S. Environmental Protection Agency/);assert.match(html,/Official/);
  assert.equal((html.match(/>Sources</g)??[]).length,1);assert.ok(html.indexOf("data-card-sources")>html.indexOf("</ul>"));
});
