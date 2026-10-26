import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { federalCardSources } from "../lib/sources/congress/presentation.ts";
import { CardSourcesList } from "../components/officials/card-sources-list.tsx";
import type { FederalFact } from "../lib/sources/congress/types.ts";

test("lobbying records describe their facts and dates without the API contribution code", () => {
  const record = { kind: "LOBBYING_CONTRIBUTION", source: "senate-lda", title: "feca", sourceUrl: "https://lda.senate.gov/filing/571", publisher: "U.S. Senate Office of Public Records",
    publishedAt: "2026-10-15T10:05:02Z", checkedAt: "2026-10-24T12:10:55Z", honoreeName: "Sen. John Cornyn (R-TX)",
    honoreeJoin: { status: "JOINED", matchedName: "John Cornyn", chamber: "senate", state: "TX", sourceUrl: "https://senate.gov/cornyn", sourceOrg: "U.S. Senate", checkedAt: "2026-10-24" },
  } as FederalFact;
  const sources = federalCardSources([record]);
  const html = renderToStaticMarkup(<CardSourcesList sources={sources} />);
  assert.match(html, /Campaign contributions reported by lobbyists/);
  assert.match(html, /Sen. John Cornyn \(R-TX\), is John Cornyn, who serves in the U.S. Senate for Texas/);
  assert.match(html, /October 15, 2026/);
  assert.match(html, /October 24, 2026/);
  assert.doesNotMatch(html, /feca|cannot vouch|Honoree identity|2026-10-15T|2026-10-24T/);
  for (const url of [record.sourceUrl, "https://senate.gov/cornyn"]) assert.ok(html.includes(`href="${url}"`));
});
