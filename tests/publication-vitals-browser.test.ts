import { PUBLIC_SITE_ORIGIN, ADMIN_ORIGIN } from "../lib/ops/origins.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { launchGuarded } from "../scripts/browser.mts";
import { readPublishedFactPage } from "../lib/civic-data/publication-vitals-browser.ts";
import { PublicationVitals } from "../lib/civic-data/publication-vitals.ts";

test("guarded live sampler reads visible fields only inside the requested record", async t => {
  const browser = await launchGuarded({ label: "publication-vitals-fixture" });
  t.after(() => browser.close());
  let pages = 0;
  const source = { page: async () => {
    const page = await browser.page(); pages++;
    await page.route(`${PUBLIC_SITE_ORIGIN}/**`, route => route.fulfill({ status: 200, contentType: "text/html",
      body: '<article id="other"><span class="amount">$5</span></article><article id="target"><span class="amount">$50</span><span class="amount" hidden>$5</span></article>' }));
    return page;
  } };
  const sample = { recordId: "target", url: `${PUBLIC_SITE_ORIGIN}/?zip=10001`, selector: "#target", fields: [{ selector: ".amount", text: "$5" }] };
  const read = await readPublishedFactPage(source, sample);
  assert.deepEqual(read.matches, [{ fields: { ".amount": ["$50"] } }]);
  const at = "2026-10-06T05:00:00Z";
  const vitals = new PublicationVitals(at);
  vitals.published({ id: "event", at, changedRecords: 1, samples: [sample] });
  assert.equal((await vitals.sample(s => readPublishedFactPage(source, s))).facts_confirmed, 0);
  assert.equal(pages, 2);
  await assert.rejects(readPublishedFactPage(source, { ...sample, url: `${ADMIN_ORIGIN}/` }), /PUBLIC_PAGE/);
  assert.equal(pages, 2, "refused destinations launch no page");
});
