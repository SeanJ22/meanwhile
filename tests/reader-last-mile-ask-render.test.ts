import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readFileSync } from "node:fs";

test("map and ballot Ask share every held contact channel, exact rows and per-person provenance", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { AskAnswerContacts } from './components/ask/answer-contacts.tsx';
    import { contactsForBody } from './lib/ask/contacts.ts';
    import { bodyIdentityIndex } from './lib/ask/body-identity.ts';
    import { installNjMorrisFilingFirstSeed, installRegistryRuntimeFirstSeeds } from './tests/helpers/registry-runtime-first-seed.ts';
    import { readFileSync } from 'node:fs';
    import { candidateContactCensus } from './lib/ballot/candidate-contacts.ts';
    import { contactForCandidate } from './lib/ask/candidate-contact.ts';
    await Promise.all([installRegistryRuntimeFirstSeeds(), installNjMorrisFilingFirstSeed()]);
    const candidates = new Map(JSON.parse(readFileSync('data/states/nj/ballot/nj-morris-2026.json','utf8')).candidacies.map(candidate=>[candidate.id,candidate]));
    const filed = candidateContactCensus().contacts.map(contact=>{const candidate=candidates.get(contact.candidacyId);return contactForCandidate(contact.candidacyId,candidate.givenName+' '+candidate.familyName,candidate.contestId)});
    const contacts = [...bodyIdentityIndex().values()].flatMap(body => contactsForBody(body, body.name)).concat(filed);
    const fixture = { id:'held-contact:all-fields', name:'Avery Reader', officeTitle:'Clerk', relationship:'Staff of the named body', basis:'BODY_STAFF', email:'clerk@example.test', phone:'+1 555-555-0100', websiteUrl:'https://office.example.test/', filedAddress:'PO Box 10, Test City', sourceUrl:'https://clerk.example.test/filing', sourceOrg:'Current Clerk', retrievedAt:'2026-09-01' };
    console.log(JSON.stringify({contacts, fixture, markup:renderToStaticMarkup(createElement(AskAnswerContacts,{contacts:[...contacts,fixture]})), empty:renderToStaticMarkup(createElement(AskAnswerContacts,{contacts:[]}))}));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000, maxBuffer: 8_000_000 });
  const { contacts, fixture, markup, empty } = JSON.parse(output) as { contacts: { id: string; name: string; email: string | null; phone: string | null; websiteUrl: string | null; filedAddress?: string | null; sourceUrl: string | null; sourceOrg: string | null }[]; fixture: { id: string }; markup: string; empty: string };
  const escaped = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  assert.ok(contacts.length > 600, "all current sourced body and candidate-filing contacts are exercised");
  assert.equal([...markup.matchAll(/data-ask-contact-id=/g)].length, contacts.length + 1);
  assert.ok(markup.includes(`Who this is (${contacts.length + 1})`));
  assert.ok(!markup.includes('open=""'), "contact disclosure remains collapsed by default");
  for (const contact of contacts) for (const value of [contact.id, contact.name, contact.email, contact.phone, contact.websiteUrl, contact.sourceUrl, contact.sourceOrg].filter((value): value is string => Boolean(value))) assert.ok(markup.includes(escaped(value)), `Missing held contact field: ${value}`);
  for (const value of [fixture.id, 'Clerk', 'Staff of the named body', 'mailto:clerk@example.test', 'tel:+1 555-555-0100', 'https://office.example.test/', 'https://clerk.example.test/filing', 'Current Clerk', 'September 1st, 2026']) assert.ok(markup.includes(value), `Missing field: ${value}`);
  assert.ok(!markup.includes("PO Box 10, Test City"), "legacy filed addresses never render");
  assert.equal(empty, "");
  for (const path of ["components/ask/ask-box.tsx", "components/ask/ballot-ask.tsx"]) assert.match(readFileSync(path, "utf8"), /<AskAnswerContacts contacts=\{(?:grounded|reply)\.contacts \?\? \[\]\} \/>/);
});

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

test("a held filing revision renders its exact statement and both source documents without resurrecting a candidacy", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { readFileSync } from 'node:fs';
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { FilingChanges } from './components/ballot/filing-changes.tsx';
    const removals = JSON.parse(readFileSync('data/states/nj/ballot/nj-morris-2026.json', 'utf8')).removals;
    console.log(JSON.stringify({ removals, markup: renderToStaticMarkup(createElement(FilingChanges, { removals })), empty: renderToStaticMarkup(createElement(FilingChanges, { removals: [] })) }));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 });
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
