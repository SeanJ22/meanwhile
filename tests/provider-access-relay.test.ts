import assert from 'node:assert/strict';
import {test} from 'node:test';
import {providerOf,providerHostOf,resolveProviderPolicy,decideProviderRequest,MAPTILER,BLOCKED_BY_DEFAULT} from '../lib/ops/provider-access.ts';
test('map files fetched through our relay keep the existing default block and opted-in limit',()=>{
 for(const host of ['https://meanwhileusa.com','http://127.0.0.1:3214','http://maptiler-smoke.localhost']) {
  const url=host+'/api/maptiler/maps/basic-v2/style.json';
  assert.equal(providerOf(url),MAPTILER);assert.equal(providerHostOf(url),'api.maptiler.com');
  assert.equal(decideProviderRequest(url,BLOCKED_BY_DEFAULT,0).verdict,'BLOCKED_BY_DEFAULT');
  const allowed=resolveProviderPolicy({requested:MAPTILER,env:{WTP_PROVIDER_ACCESS:MAPTILER,WTP_PROVIDER_REQUEST_CEILING:'1'}});
  assert.equal(decideProviderRequest(url,allowed,0).verdict,'ALLOWED_UNDER_CEILING');
  assert.equal(decideProviderRequest(url,allowed,1).verdict,'REFUSED_CEILING_EXCEEDED');
 }
 for(const url of ['https://example.com/api/maptiler/maps/test.json','https://meanwhileusa.com/api/maptiler-other','https://meanwhileusa.com/api/meetings','file:///api/maptiler/maps/test.json'])assert.equal(providerOf(url),null);
});
