import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("Ask renders every grounded non-contact record with its own source even beside a prose answer", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { AskAnswerRecords } from './components/ask/answer-records.tsx';
    const records = Array.from({ length: 17 }, (_, i) => ({ kind: 'VOTE', id: 'held:vote:' + i, text: 'Held vote ' + i, sourceUrl: 'https://clerk.example/roll/' + i, sourceOrg: 'Clerk', retrievedAt: '2026-09-01' }));
    records.push({ kind: 'CONTACT', id: 'contact:one', text: 'Rendered by the contact panel' });
    console.log(JSON.stringify([false, true].map(initiallyOpen => renderToStaticMarkup(createElement(AskAnswerRecords, { records, initiallyOpen })))));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
  const renders = JSON.parse(output.trim()) as string[];
  for (const markup of renders) {
    assert.match(markup, /data-ask-record-count="17"/);
    assert.equal([...markup.matchAll(/data-ask-record-id=/g)].length, 17);
    for (let i = 0; i < 17; i++) {
      assert.ok(markup.includes(`data-ask-record-id="held:vote:${i}"`));
      assert.ok(markup.includes(`https://clerk.example/roll/${i}`));
    }
    assert.ok(!markup.includes("contact:one"));
  }
  assert.ok(!renders[0].includes('open=""'), "prose keeps records reachable under disclosure");
  assert.ok(renders[1].includes('open=""'), "structured answer exposes records immediately");
});

test("a held filing revision renders its exact statement and both source documents without resurrecting a candidacy", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { readFileSync } from 'node:fs';
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { FilingChanges } from './components/ballot/filing-changes.tsx';
    const removals = JSON.parse(readFileSync('data/states/nj/ballot/nj-morris-2026.json', 'utf8')).removals;
    console.log(JSON.stringify({ removals, markup: renderToStaticMarkup(createElement(FilingChanges, { removals })), empty: renderToStaticMarkup(createElement(FilingChanges, { removals: [] })) }));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
  const result = JSON.parse(output.trim()) as { removals: { id: string; statement: string; lastListed: { sourceUrl: string }; absentFrom: { sourceUrl: string } }[]; markup: string; empty: string };
  assert.ok(result.removals.length > 0);
  assert.equal([...result.markup.matchAll(/data-filing-change-id=/g)].length, result.removals.length);
  for (const record of result.removals) {
    assert.ok(result.markup.includes(record.id));
    assert.ok(result.markup.includes(record.lastListed.sourceUrl));
    assert.ok(result.markup.includes(record.absentFrom.sourceUrl));
  }
  assert.ok(!result.markup.includes("data-candidate-target"));
  assert.equal(result.empty, "");
});
