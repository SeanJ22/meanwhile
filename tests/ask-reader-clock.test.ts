import assert from 'node:assert/strict';
import test from 'node:test';
import { withReaderTimeZone } from '../lib/ask/reader-clock.ts';
import { displayDate, localDate, readableSitting } from '../lib/ask/meeting-time.ts';
import { composeSittingAnswer } from '../lib/ask/sitting-answer.ts';
import { synthesisCacheKey } from '../lib/ask/model-result-cache.ts';

const sitting = {id:'one',title:'Council Meeting',startsAt:'2026-10-28T00:30:00Z',timeZone:'America/Chicago',status:'SCHEDULED'};
const input = {shape:'MEETING_TIME' as const, subjectName:'Council',sittings:[sitting],records:[{kind:'MEETING' as const,id:'one',text:'Council meeting',sourceUrl:'https://example.gov/one'}],sittingGaps:[],now:Date.parse('2026-10-27T12:00Z')};

test('Ask uses the reader clock across midnight and keeps source calendar selection intact', async()=>{
 const replies = await Promise.all(['America/Phoenix','Asia/Tokyo'].map(zone=>withReaderTimeZone(zone,async()=>{
  await Promise.resolve();
  return {line:readableSitting(sitting),sourceDate:localDate(sitting),displayDate:displayDate(sitting),answer:composeSittingAnswer(input)?.answer};
 })));
 assert.match(replies[0].line,/Tuesday, October 27th, 2026 at 5:30 PM MST/);
 assert.match(replies[1].line,/Wednesday, October 28th, 2026 at 9:30 AM GMT\+9/);
 assert.deepEqual(replies.map(row=>row.sourceDate),['2026-10-27','2026-10-27']);
 assert.deepEqual(replies.map(row=>row.displayDate),['2026-10-27','2026-10-28']);
 assert.match(replies[0].answer!,/October 27 at 5:30 PM MST/);
 assert.match(replies[1].answer!,/October 28 at 9:30 AM GMT\+9/);
});

test('date-only postings and invalid reader zones preserve the source date and zone',()=>{
 const dateOnly={...sitting,startPrecision:'DAY' as const};
 assert.equal(withReaderTimeZone('Asia/Tokyo',()=>readableSitting(dateOnly)),readableSitting(dateOnly));
 assert.equal(withReaderTimeZone('not/a/time-zone',()=>readableSitting(sitting)),readableSitting(sitting));
});

test('a cached Ask answer cannot reuse another reader zone',()=>{
 const pack={question:'When is the council meeting?',intent:'MEETING_TIME',temporal:{kind:'NEXT'},subject:null,records:[],gaps:[],denominators:{},today:'2026-10-27'};
 assert.notEqual(withReaderTimeZone('America/Phoenix',()=>synthesisCacheKey(pack,'m','low')),
  withReaderTimeZone('Asia/Tokyo',()=>synthesisCacheKey(pack,'m','low')));
});
