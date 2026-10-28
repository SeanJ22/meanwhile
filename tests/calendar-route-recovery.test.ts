import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { readCalendarRoute } from "../lib/sources/calendar-route.ts";

test("a moved archive is learned only from the body's own link, then reused as data", async () => {
  const store = new MemoryEvidenceStore();
  const seen: string[] = [];
  let roots = 0;
  const read = async (url: string) => { seen.push(url); if (url.endsWith("old-archive")) throw new Error("KNOWN_SOURCE_HTTP_404"); return "body's meeting archive"; };
  const fetchImpl: typeof fetch = async input => {
    roots++; assert.equal(String(input), "https://body.gov/");
    return new Response('<a href="https://other.gov/AgendaCenter">Agendas</a><a href="/AgendaCenter">Agendas and minutes</a>');
  };
  const first = await readCalendarRoute({ url: "https://body.gov/old-archive", read, fetchImpl, store });
  assert.equal(first.url, "https://body.gov/AgendaCenter");
  assert.equal((await readCalendarRoute({ url: "https://body.gov/old-archive", read, fetchImpl, store })).url, first.url);
  assert.equal(roots, 1);
  assert.deepEqual(seen, ["https://body.gov/old-archive", first.url, first.url]);
});
