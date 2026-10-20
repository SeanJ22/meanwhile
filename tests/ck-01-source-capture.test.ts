import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MemoryEvidenceStore} from '../lib/control-plane/evidence/store.ts';
import {vaultCapture} from '../lib/facts/capture.ts';
import {sittingOnPage} from '../lib/facts/meeting-facts.ts';
import {checkFact} from '../lib/facts/check.ts';
const at='2026-10-20T06:45:00Z';

test('a real saved PDF retains exact binary bytes and a replayable complete text extraction',async()=>{
 const vault=new MemoryEvidenceStore();const bytes=await readFile('tests/fixtures/pima-edu/agenda-2026-08-10.pdf');
 const out=await vaultCapture({vault,url:'https://www.pima.edu/agenda.pdf',bytes,contentType:'application/pdf',httpStatus:200,retrievedAt:at});
 assert.ok(!('error' in out),JSON.stringify(out));if('error' in out)return;
 assert.equal(out.record.tier,'EXTRACTED_DERIVED');assert.equal(out.capture.evidence.sourceDocument?.kind,'PDF_TEXT');
 const parent=(await vault.get((await vault.list('project/freshness/')).find(key=>key.endsWith('.pdf'))!))!;
 assert.deepEqual(Buffer.from(parent.bytes),bytes);assert.match(out.capture.evidence.text,/2026/);
});

test('a public page carrying a scanner finding uses its sanitized text without losing its civic words',async()=>{
 const vault=new MemoryEvidenceStore();const key='AIza'+'A'.repeat(35);const html=`<h1>City Council</h1><p>Robert Fee</p><script src="https://maps.googleapis.com/maps/api/js?key=${key}"></script>`;
 const out=await vaultCapture({vault,url:'https://www.pima.gov/2792',bytes:Buffer.from(html),contentType:'text/html',httpStatus:200,retrievedAt:at});
 assert.ok(!('error' in out));if('error' in out)return;
 assert.equal(out.record.tier,'SANITIZED_DERIVED');assert.match(out.capture.evidence.text,/Robert Fee/);assert.ok(!out.capture.evidence.text.includes(key));
});

test('UTC calendar text proves the same instant as the local meeting; date and time remain in the checked value',()=>{
 const meeting={startsAt:'2026-10-20T19:00:00-07:00',timeZone:'America/Phoenix',startPrecision:'MINUTE' as const};
 const text='BEGIN:VEVENT\nDTSTART:20261021T020000Z\nEND:VEVENT';const sitting=sittingOnPage(text,meeting)!;
 assert.equal(sitting.valueText,'20261021T020000Z');
 assert.equal(sittingOnPage('DTSTART:20261020T190000Z',meeting),null);
 assert.equal(sittingOnPage('2026-10-20T19:00:00Z',meeting),null);
 const html='City Council 2026-10-20T00:00:00 at 7:00 PM';const local=sittingOnPage(html,meeting)!;
 assert.equal(checkFact({entity:{id:'b',fullName:'City Council',stateName:null,hosts:['clerk.example.gov'],externalIds:[]},fieldKind:'meeting',provenance:'OFFICIAL',valueText:local.valueText,quote:local.quote,copy:{id:1,finalUrl:'https://clerk.example.gov/',text:html,fetchedAt:new Date(at),isArchive:false}},new Date(at),()=>168).ok,true);
});

test('a generated governing label matches the complete official jurisdiction name in either order, retaining the state check',()=>{
 const make=(text:string)=>checkFact({entity:{id:'ocd-division/country:us/state:nj/county:morris/place:denville_township#governing',fullName:'Denville township governing',stateName:'New Jersey',hosts:[],externalIds:[]},fieldKind:'officeholder',provenance:'OFFICIAL',valueText:'Glenn R. Buie',quote:'Glenn R. Buie',copy:{id:1,finalUrl:'https://www.denvillenj.gov/administration/township_council.php',text,fetchedAt:new Date(at),isArchive:false}},new Date(at),()=>168);
 assert.equal(make('Township of Denville New Jersey Glenn R. Buie').ok,true);
 assert.equal(make('Denville Township New Jersey Glenn R. Buie').ok,true);
 assert.equal(make('Township of Denville New Hampshire Glenn R. Buie').ok,false);
 assert.equal(make('Township of Randolph New Jersey Glenn R. Buie').ok,false);
});
