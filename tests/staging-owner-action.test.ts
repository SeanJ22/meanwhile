import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingHosts,ownerActions} from '../scripts/staging-owner-action.mts';
const staging={WTP_DB_ROLE:'local',DATABASE_URL:'postgres://user:private@stage-reader.example/db',
  WTP_CONTROL_PLANE_DATABASE_URL:'postgres://user:private@stage-control.example/db'};

test('owner command refuses missing local role, mismatched hosts, and production aliases before connecting',()=>{
  assert.throws(()=>stagingHosts({...staging,WTP_DB_ROLE:undefined},staging),/LOCAL_ROLE/);
  assert.throws(()=>stagingHosts({...staging,DATABASE_URL:'postgres://user:private@other.example/db'},staging),/HOST_MISMATCH/);
  assert.throws(()=>stagingHosts({...staging,WTP_PRODUCTION_DATABASE_URL:staging.DATABASE_URL},staging),/PRODUCTION_DATABASE/);
  assert.throws(()=>stagingHosts({...staging,DATABASE_URL:'postgres://u:p@stage-pooler.example/db',DATABASE_URL_PRODUCTION:'postgres://u:p@stage.example/db'},staging),/PRODUCTION_DATABASE/);
  assert.throws(()=>stagingHosts({...staging,DATABASE_URL:undefined},staging),/DATABASE_URL_REQUIRED/);
  assert.deepEqual(stagingHosts(staging,staging),{DATABASE_URL:'stage-reader.example',WTP_CONTROL_PLANE_DATABASE_URL:'stage-control.example'});
});

test('check and the default action cannot also change pause or ceiling',()=>{
  assert.deepEqual(ownerActions([]),{check:true,ceiling:null,resume:false});
  assert.deepEqual(ownerActions(['--check']),{check:true,ceiling:null,resume:false});
  assert.throws(()=>ownerActions(['--check','--resume']),/READ_ONLY/);
  assert.throws(()=>ownerActions(['--check','--ceiling=100']),/READ_ONLY/);
  assert.throws(()=>ownerActions(['--ceiling=0']),/POSITIVE/);
  assert.deepEqual(ownerActions(['--ceiling=100','--resume']),{check:false,ceiling:100,resume:true});
});
