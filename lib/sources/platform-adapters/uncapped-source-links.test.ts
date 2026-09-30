import test from 'node:test';
import assert from 'node:assert/strict';
import { uncappedSourceLinks } from './uncapped-source-links.ts';
test('held source links after the model display cap remain discoverable for every publisher',()=>{
 for(const source of ['https://first.gov/records','https://second.gov/records']) {
  const html=Array.from({length:95},(_,i)=>'<a href="/document/'+i+'">Document '+i+'</a>').join('');
  const result=uncappedSourceLinks(html,source);
  assert.equal(result.length,95);assert.ok(result.some(link=>link.url.endsWith('/document/94')));
  assert.ok(result.every(link=>link.sourceUrl===source));
 }
});
