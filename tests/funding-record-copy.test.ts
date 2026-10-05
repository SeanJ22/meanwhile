import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FundingDisplay } from "../components/funding/funding-section.tsx";
import { fundingAnswerForTarget } from "../lib/funding/display.ts";
import { refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { concentrationOf } from "../lib/funding/concentration.ts";
import type { ContributionRow } from "../lib/funding/types.ts";

test("the rendered funding origin and categories contain dollars without percentages or disclaimers", async () => {
  await refreshFundingFromPromoted({ store: new MemoryRoutineDataStore() });
  const answer = fundingAnswerForTarget("congress:B001288");
  assert.equal(answer.kind, "funding"); if (answer.kind !== "funding") return;
  const html = renderToStaticMarkup(createElement(FundingDisplay, { data: answer.data, context: null }));
  for (const attribute of ["data-money-origin", "data-money-kind"]) {
    const detail = new RegExp(`<details[^>]*${attribute}[^>]*>([\\s\\S]*?)</details>`).exec(html)?.[1];
    assert.ok(detail, attribute);
    assert.doesNotMatch(detail, /%|single biggest|not the whole|don&#x27;t sort|don&#x27;t give a district/i);
    assert.match(detail, /\$/);
  }
  assert.match(html, /of individual money came from donors giving \$200 or less/);
});

test("unlocated filed money stays outside both the inside-state and outside-state amounts", () => {
  const rows = [{ amount: 100, state: "OR", kind: "INDIVIDUAL" }, { amount: 200, state: "ME", kind: "INDIVIDUAL" },
    { amount: 300, state: null, kind: "INDIVIDUAL" }] as ContributionRow[];
  const c = concentrationOf(rows, "OR");
  assert.ok(c); assert.equal(c.inStateAmount, 100); assert.equal(c.outStateAmount, 200); assert.equal(c.unlocatedAmount, 300);
});
