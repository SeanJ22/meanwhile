import assert from "node:assert/strict";
import test from "node:test";
import { meetingCardSources, moneyCardSources, voteCardSources, actionCardSources } from "../lib/officials/card-sources.ts";
import type { Meeting, Provenance } from "../lib/sources/types.ts";
const provenance: Provenance = { sourceUrl: "https://body.gov/source", sourceOrg: "Public body", collectedAt: "2026-10-05T12:00:00Z", verifiedAt: null };
test("CP-16: meeting Sources include every supplied family with the captured time", () => {
  const meeting = { title: "Regular meeting", agendaUrl: "https://body.gov/agenda", provenance } as Meeting;
  const rows = meetingCardSources(meeting, [], { agendas: [{ ...provenance, sourceUrl: "https://body.gov/agenda-text" }],
    minutes: [{ ...provenance, sourceUrl: "https://body.gov/minutes" }], records: [{ ...provenance, sourceUrl: "https://body.gov/decisions" }],
    commentAccess: [{ ...provenance, sourceUrl: "https://body.gov/comment" }], cadence: [{ ...provenance, sourceUrl: "https://body.gov/schedule" }] });
  assert.equal(rows.length, 7);
  assert.ok(rows.every(row => row.provenance.collectedAt === provenance.collectedAt));
  assert.ok(rows.some(row => row.what === "Meeting minutes"));
  assert.ok(rows.some(row => row.what === "How to take part"));
});
test("CP-16: money, votes and actions retain their actual filing and document URLs", () => {
  assert.deepEqual(moneyCardSources([{ provenance }])[0].provenance, provenance);
  const vote = voteCardSources([{ title: "Budget", chamber: "house", rollCallUrl: "https://clerk.house.gov/roll/1", retrievedAt: provenance.collectedAt }]);
  assert.equal(vote[0].provenance.sourceUrl, "https://clerk.house.gov/roll/1");
  const actions = actionCardSources([{ designation: "Order 1", sourceUrl: provenance.sourceUrl!, documentUrl: "https://body.gov/order.pdf",
    sourceOrg: provenance.sourceOrg, collectedAt: provenance.collectedAt }]);
  assert.deepEqual(actions.map(row => row.provenance.sourceUrl), [provenance.sourceUrl, "https://body.gov/order.pdf"]);
  assert.deepEqual(moneyCardSources([]), []); assert.deepEqual(voteCardSources([]), []); assert.deepEqual(actionCardSources([]), []);
});
