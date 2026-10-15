import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("ASK-24: structured measure answers lead with the held definition and keep each sourced record exactly once", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { AskAnswerRecords } from './components/ask/answer-records.tsx';
    import { summaryForContest } from './lib/ballot/measure-summary.ts';
    import { readFileSync } from 'node:fs';
    const ballot = Object.values(JSON.parse(readFileSync('data/ballot/2026-general/az.json', 'utf8')).ballots)[0];
    const summary = summaryForContest('ballot-az-pima:prop-141', ballot.measureRecords);
    const records = [
      {kind:'CONTEST', id:'procedure', text:'Procedural details.', sourceUrl:'https://authority.example/procedure'},
      {kind:'MEASURE_ANALYSIS', id:'analysis', text:'Official legal detail.', sourceUrl:'https://authority.example/analysis'},
      {kind:'MEASURE_SUMMARY', id:summary.contestId+'#summary', text:summary.summary, sourceUrl:summary.summarizesUrl},
      {kind:'CONTACT', id:'contact', text:'Rendered by the contact component'}
    ];
    const before = JSON.stringify(records);
    const render = (records, initiallyOpen) => renderToStaticMarkup(createElement(AskAnswerRecords,{records,initiallyOpen}));
    console.log(JSON.stringify({summary, structured:render(records,true), generated:render(records,false), plain:render(records.slice(0,2),true), only:render(records.slice(2,3),true), unchanged:before===JSON.stringify(records)}));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 });
  const { summary, structured, generated, plain, only, unchanged } = JSON.parse(output) as {
    summary: { summary: string; summarizesUrl: string }; structured: string; generated: string; plain: string; only: string; unchanged: boolean;
  };
  assert.ok(unchanged, "presentation never mutates the canonical records");
  assert.match(structured, /data-ask-record-count="3"/);
  assert.match(structured, /data-ask-detail-count="2"/);
  assert.match(structured, /Further records[^<]*\(2\)/);
  assert.ok(structured.indexOf("data-ask-measure-summary") < structured.indexOf("<details"));
  assert.ok(structured.indexOf("#summary") < structured.indexOf("Procedural details."));
  assert.ok(structured.includes(summary.summarizesUrl));
  assert.equal([...structured.matchAll(/data-ask-record-id=/g)].length, 3);
  for (const id of ["procedure", "analysis", "ballot-az-pima:prop-141#summary"]) {
    assert.equal(structured.split(`data-ask-record-id="${id}"`).length - 1, 1, `${id} renders exactly once`);
  }
  assert.ok(!structured.includes('open=""'), "the held definition is visible and further detail starts collapsed");
  assert.ok(!structured.includes('data-ask-record-id="contact"'));
  assert.ok(!generated.includes("data-ask-measure-summary"), "generated-answer flow retains its existing disclosure");
  assert.ok(!generated.includes('open=""'));
  assert.equal([...generated.matchAll(/data-ask-record-id=/g)].length, 3);
  assert.ok(plain.includes('open=""'), "structured answers without a held summary retain their visible records");
  assert.ok(!only.includes("<details"), "a summary alone needs no empty detail disclosure");
});
