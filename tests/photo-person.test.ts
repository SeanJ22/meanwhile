import assert from "node:assert/strict";
import test from "node:test";
import {personIdentityKeys,sameNativePerson} from "../lib/officials/people-identity.ts";

test("same names do not join people and declared native aliases do",()=>{
  const one={id:"plural:az:one",personId:"plural:one",nativeIds:{"az-legislature":["123"]}};
  assert.equal(sameNativePerson(one,{id:"az-legislature:123"}),true);
  assert.equal(sameNativePerson(one,{id:"plural:az:two",personId:"plural:two"}),false);
  assert.ok(personIdentityKeys(one).has("plural:one"));
  assert.equal(personIdentityKeys(one).has("Jane Doe"),false);
});
