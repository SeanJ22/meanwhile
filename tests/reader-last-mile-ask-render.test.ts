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
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 });
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

test("a sourced explainer without a held URL retains its publisher and read date without an invented link", () => {
  const markup = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
    import {AskAnswerRecords} from './components/ask/answer-records.tsx';
    console.log(renderToStaticMarkup(createElement(AskAnswerRecords,{initiallyOpen:true,records:[{kind:'KEY_VOTE_CONTEXT',id:'key-vote-entry:held-question',text:'The held question explainer',sourceUrl:null,sourceOrg:'congress.gov bill text and official summary',retrievedAt:'2026-08-15'}]})));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 });
  assert.ok(markup.includes("congress.gov bill text and official summary"));
  assert.ok(markup.includes("August 15th, 2026"));
  assert.ok(!markup.includes("href="));
});
