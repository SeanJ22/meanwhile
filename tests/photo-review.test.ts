import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyPortraitSources, portraitVerificationMatches, portraitBindingMatches, type PortraitVerification } from "../lib/photos/evidence.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

const NOW="2026-10-01T00:00:00Z", NAME="Jane Doe", ID="plural:person-123", IMAGE="https://images.example.org/jane-doe.jpg";
function capture(url:string,text:string):WorkerPublicationCapture {
  const hash=`sha256-${createHash('sha256').update(text).digest('hex')}`;
  return {evidence:{artifactId:hash,contentHash:hash,text,canonicalUrl:url,retrievedAt:NOW,sourceId:new URL(url).hostname,
    acquiredByAttemptId:'fixture',methodRouteId:'portrait'},observedAt:NOW,httpStatus:200,transport:'REACHABLE',partial:false};
}
const profile=capture('https://legislature.gov/jane',`<h1>Jane Doe</h1><img alt="Jane Doe" src="${IMAGE}"><p>Photograph is public domain.</p>`);
const roster=capture('https://data.openstates.org/people/current/oh.csv',`id,name,image\nocd-person/person-123,Jane Doe,${IMAGE}\n`);
const subject={personId:ID,name:NAME,nativeIds:{"ocd-person":["ocd-person/person-123"]},profileUrls:[profile.evidence.canonicalUrl,"https://press.example.org/jane","https://jane.example/","https://social.example/jane"]};
const sources={subject,imageUrl:IMAGE,captures:[profile,roster]};

test('the same named portrait has two saved sources and its own explicit licence',()=>{
  const got=verifyPortraitSources(ID,sources,NOW);
  assert.equal(got.sources.length,2);assert.equal(got.license?.value,'public domain');
  assert.equal(got.license?.sourceUrl,profile.evidence.canonicalUrl);
});

test('a non-official portrait still needs two intact fresh copies of the same named image',()=>{
  const profile = capture('https://press.example.org/jane', '<h1>Jane Doe</h1><img alt="Jane Doe" src="'+IMAGE+'">');
  const bad=[
    {...sources,captures:[profile]},
    {...sources,captures:[profile,capture('https://press.example.org/jane-copy',profile.evidence.text+' ')]},
    {...sources,captures:[profile,{...roster,partial:true}]},
    {...sources,captures:[profile,{...roster,observedAt:'2020-01-01T00:00:00Z'}]},
    {...sources,captures:[profile,{...roster,evidence:{...roster.evidence,text:roster.evidence.text+'corruption'}}]},
    {...sources,captures:[profile,capture(roster.evidence.canonicalUrl,`name,image\nOther Person,${IMAGE}\n`)]},
    {...sources,captures:[profile,capture(roster.evidence.canonicalUrl,`name,image\nJane Doe,https://images.example.org/other.jpg\n`)]},
  ];
  for(const input of bad)assert.throws(()=>verifyPortraitSources(ID,input,NOW),/PORTRAIT_/);
});

test('a replacement URL or source image cannot inherit another portrait verification',()=>{
  const hash='sha256-'+'a'.repeat(64),url='/api/portraits/officials/'+hash.slice(7)+'.jpg';
  const verification:PortraitVerification={...verifyPortraitSources(ID,sources,NOW),imageHash:hash,sourceImageHash:hash};
  const photo={url,sourceUrl:IMAGE,verification};
    assert.equal(portraitBindingMatches(ID,photo),true);
    assert.equal(portraitBindingMatches('Someone Else',photo),false);
    assert.equal(portraitBindingMatches(ID,{...photo,url:url+'?swapped'}),false);
    assert.equal(portraitBindingMatches(ID,{...photo,sourceUrl:'https://images.example.org/other.jpg'}),false);
    assert.equal(portraitVerificationMatches(ID,{...verification,sources:[verification.sources[0]]}),true);
    assert.equal(portraitVerificationMatches(NAME),false);
});

test('CP-10: one official portrait publishes without a licence sentence and still binds the exact image bytes',()=>{
  const own = capture('https://legislature.gov/jane', `<h1>Jane Doe</h1><img alt="Jane Doe" src="${IMAGE}">`);
  const checked = verifyPortraitSources(ID,{ subject, imageUrl: IMAGE, captures: [own] },NOW);
  assert.equal(checked.basis,'OWN_PAGE'); assert.equal(checked.license,undefined);
  assert.equal(checked.attribution?.sourceUrl,own.evidence.canonicalUrl);
  const hash='sha256-'+'b'.repeat(64);
  assert.equal(portraitBindingMatches(ID,{ url:'/api/portraits/officials/'+hash.slice(7)+'.jpg',sourceUrl:IMAGE,
    verification:{...checked,imageHash:hash,sourceImageHash:hash} }),true);
});

test('CP-10: a verified own-campaign portrait needs one source; a personal social account still needs two',()=>{
  const own = capture('https://jane.example/', `<title>Jane Doe for Mayor 2026</title><img alt="Jane Doe" src="${IMAGE}">`);
  const checked=verifyPortraitSources(ID,{subject,imageUrl:IMAGE,captures:[own],campaign:{url:own.evidence.canonicalUrl,name:NAME,office:'Mayor',cycle:'2026'}},NOW);
  assert.equal(checked.basis,'OWN_PAGE');
  const personal=capture('https://social.example/jane',own.evidence.text);
  assert.throws(()=>verifyPortraitSources(ID,{subject,imageUrl:IMAGE,captures:[personal]},NOW),/SECOND_SOURCE/);
  assert.throws(()=>verifyPortraitSources('Other Person',{subject,imageUrl:IMAGE,captures:[own],campaign:{url:own.evidence.canonicalUrl,name:NAME,office:'Mayor',cycle:'2026'}},NOW),/PORTRAIT_/);
});

test('a rechecked known profile cites its real vault object and preserves the original acquisition date',()=>{
  const heldAt='2026-09-01T00:00:00Z';
  const {artifactId:_artifact,...evidence}=profile.evidence;
  const checked=verifyPortraitSources(ID,{subject,imageUrl:IMAGE,captures:[{...profile,
    evidence:{...evidence,retrievedAt:heldAt,vaultKey:'project/freshness/source/official-person-profile/held/page.html'}}]},NOW);
  assert.equal(checked.sources[0].artifactId,undefined);
  assert.equal(checked.sources[0].retrievedAt,heldAt);
  assert.equal(checked.sources[0].vaultKey,'project/freshness/source/official-person-profile/held/page.html');
  const hash='sha256-'+'c'.repeat(64);
  assert.equal(portraitVerificationMatches(ID,{...checked,imageHash:hash,sourceImageHash:hash}),true);
});
