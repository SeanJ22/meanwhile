import assert from "node:assert/strict";
import test from "node:test";

import { saidAtTheTime } from "../lib/corpus/said-at-the-time.ts";
import type { SourceSnapshot, StatementCorpus } from "../lib/corpus/types.ts";

function snap(over: Partial<SourceSnapshot>): SourceSnapshot {
  return {
    id: "s",
    subjectId: "body:council",
    subjectName: "City Council",
    kind: "MINUTES",
    url: "https://city.example/minutes/2025-03-04.pdf",
    contentHash: "h",
    retrievedAt: "2025-03-20T00:00:00.000Z",
    httpStatus: 200,
    extraction: "ok",
    text: "Councilmember Romero said the library budget protects weekend hours. The clerk read the consent items.",
    title: null,
    ...over,
  };
}

const moment = {
  subjectId: "official:romero",
  personName: "Regina Romero",
  itemTitle: "Approve the Library Budget for fiscal year 2026",
  votedOn: "2025-03-04",
  minutesUrl: "https://city.example/minutes/2025-03-04.pdf",
};

test("a minutes passage that names the member and the item is attached, verbatim", () => {
  const r = saidAtTheTime(moment, { snapshots: [snap({})] });
  assert.equal(r.state, "FOUND");
  assert.equal(r.statements.length, 1);
  assert.equal(r.statements[0].quote, "Councilmember Romero said the library budget protects weekend hours.");
  assert.equal(r.statements[0].kindLabel, "minutes");
  assert.equal(r.statements[0].dated, "2025-03-04");
});

test("minutes of a different sitting are not read", () => {
  const other = snap({ id: "o", url: "https://city.example/minutes/2025-04-01.pdf" });
  const r = saidAtTheTime(moment, { snapshots: [other] });
  assert.equal(r.state, "NOT_YET_COLLECTED");
});

test("a dated social post within the window is attached; an undated or distant one is not", () => {
  const post = (id: string, postedOn: string | undefined) => snap({
    id, subjectId: "official:romero", subjectName: "Regina Romero", kind: "SOCIAL_POST", url: `https://social.example/${id}`,
    text: "Voting tonight on the library budget for next year.", ...(postedOn ? { postedOn } : {}),
  });
  const corpus: StatementCorpus = { snapshots: [post("near", "2025-03-05"), post("far", "2025-02-01"), post("undated", undefined)] };
  const r = saidAtTheTime(moment, corpus);
  assert.equal(r.state, "FOUND");
  assert.deepEqual(r.statements.map((s) => s.url), ["https://social.example/near"]);
  assert.equal(r.statements[0].kindLabel, "social post");
  assert.equal(r.statements[0].dated, "2025-03-05");
});

test("someone else's post is never attributed to the member", () => {
  const theirs = snap({ id: "x", subjectId: "official:other", kind: "SOCIAL_POST", url: "https://social.example/x", postedOn: "2025-03-04", text: "The library budget vote is tonight." });
  const r = saidAtTheTime(moment, { snapshots: [theirs] });
  assert.equal(r.statements.length, 0);
});

test("pages read with no matching passage say so with the denominator; nothing held says we have not collected", () => {
  const page = snap({ id: "p", subjectId: "official:romero", kind: "OFFICIAL_PAGE", url: "https://city.example/romero", text: "Regina Romero is the mayor." });
  const none = saidAtTheTime(moment, { snapshots: [page] });
  assert.equal(none.state, "SEARCHED_NOTHING_MATCHED");
  assert.equal(none.searched.pages, 1);
  assert.equal(saidAtTheTime(moment, { snapshots: [] }).state, "NOT_YET_COLLECTED");
});
