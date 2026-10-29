import assert from "node:assert/strict";
import test from "node:test";

import { identityKeys, mintId, personId } from "../lib/core/ids.ts";
import { matchPerson, samePerson, type PersonEvidence } from "../lib/identity/match-person.ts";
import { foldAccents, nameParts, parsePersonName } from "../lib/identity/name-parts.ts";

const UUID = "d3f48e28-4ee5-4027-9670-0d617ca6048e";
const person = (id: string, name: string, extra: Partial<PersonEvidence> = {}): PersonEvidence => ({ id, name, state: "TN", ...extra });

test("a shared strong key is the match, whatever the name or seat says", () => {
  const held = person("plural:" + UUID, "Brent Taylor", { keys: identityKeys("plural:" + UUID, [["campaign-person:TN", "ocd-person/" + UUID]]) });
  const probe = person("ocd-person/" + UUID, "Taylor, Brent A.", { keys: identityKeys("ocd-person/" + UUID, [["openstates", "ocd-person/" + UUID]]) });
  const found = matchPerson(probe, [held]);
  assert.deepEqual([found.kind, found.kind === "MATCH" ? found.basis : null], ["MATCH", "KEY"]);
});

test("a name alone never matches; it comes back as NAME_ONLY with the namesake", () => {
  const namesake = person("a", "Brent Taylor");
  const found = matchPerson(person("b", "Brent Taylor"), [namesake]);
  assert.equal(found.kind, "NAME_ONLY");
  assert.deepEqual(found.kind === "NAME_ONLY" ? found.candidates.map(row => row.id) : [], ["a"]);
});

test("the same name in the same seat is one person; a different seat is only a namesake", () => {
  const seat = ["body:council|seat:4"];
  assert.equal(matchPerson(person("b", "Brent Taylor", { seats: seat }), [person("a", "Brent A. Taylor", { seats: seat })]).kind, "MATCH");
  assert.equal(matchPerson(person("b", "Brent Taylor", { seats: seat }), [person("a", "Brent Taylor", { seats: ["body:council|seat:5"] })]).kind, "NAME_ONLY");
});

test("two holders of the same name in one seat tie and nobody is picked", () => {
  const seat = ["body:council"];
  const found = matchPerson(person("c", "Chris Green", { seats: seat }), [person("a", "Chris Green", { seats: seat }), person("b", "Chris Green", { seats: seat })]);
  assert.equal(found.kind, "TIE");
  assert.deepEqual(found.kind === "TIE" ? [found.reason, found.candidates.map(row => row.id)] : [], ["SEAT_AND_NAME_AMBIGUOUS", ["a", "b"]]);
});

test("a probe whose keys reach two held records ties, unless the seat settles it", () => {
  const first = person("a", "Ana Ruiz", { keys: ["fec:H1", "x:1"], seats: ["district:3"] });
  const second = person("b", "Ana Ruiz", { keys: ["fec:H2", "x:2"], seats: ["district:4"] });
  const bridge = person("c", "Ana Ruiz", { keys: ["x:1", "x:2"] });
  const tied = matchPerson(bridge, [first, second]);
  assert.deepEqual([tied.kind, tied.kind === "TIE" ? tied.reason : null], ["TIE", "KEYS_JOIN_CANDIDATES"]);
  const settled = matchPerson({ ...bridge, seats: ["district:4"] }, [first, second]);
  assert.deepEqual([settled.kind, settled.kind === "MATCH" ? settled.candidate.id : null], ["MATCH", "b"]);
});

test("two different Open States ids are two people even when the name and seat agree", () => {
  const seat = ["district:3"];
  const held = person("a", "Jennifer Clark", { keys: ["ocd-person:" + UUID], seats: seat });
  const probe = person("b", "Jennifer Clark", { keys: ["ocd-person:5a30542d-49dc-4944-81db-dd1a2f855be6"], seats: seat });
  assert.equal(matchPerson(probe, [held]).kind, "NEW");
  const joined = matchPerson({ ...probe, keys: [...probe.keys!, "campaign:link"] }, [{ ...held, keys: [...held.keys!, "campaign:link"] }]);
  assert.deepEqual([joined.kind, joined.kind === "TIE" ? joined.reason : null], ["TIE", "KEY_CONFLICT"]);
});

test("a different state or a term that ended before the other began is not the same seat", () => {
  const seat = ["district:3"];
  assert.equal(matchPerson(person("b", "Ana Ruiz", { seats: seat }), [{ ...person("a", "Ana Ruiz", { seats: seat }), state: "NM" }]).kind, "NEW");
  const older = person("a", "Ana Ruiz", { seats: seat, term: { start: "2015-01-01", end: "2018-12-31" } });
  assert.equal(matchPerson(person("b", "Ana Ruiz", { seats: seat, term: { start: "2023-01-01", end: "2026-12-31" } }), [older]).kind, "NAME_ONLY");
  assert.equal(matchPerson(person("b", "Ana Ruiz", { seats: seat, term: { start: "2017-01-01", end: "2022-12-31" } }), [older]).kind, "MATCH");
});

test("names compare exactly: a middle initial matches its name, a nickname the record prints is a first name, a diminutive is not", () => {
  const seat = ["this seat"];
  const same = (a: string, b: string) => samePerson({ id: "a", name: parsePersonName(a), seats: seat }, { id: "b", name: parsePersonName(b), seats: seat });
  assert.equal(same("Matt J. Heinz", "Matt James Heinz"), true);
  assert.equal(same("Matt Heinz", "Matt James Heinz"), true);
  assert.equal(same("Matt James Heinz", "Matt Karl Heinz"), false);
  assert.equal(same('Nicholas "Nick" Myers', "Nick Myers"), true);
  assert.equal(same('Nicholas "Nick" Myers', "Nick Meyers"), false);
  assert.equal(same("Matthew Heinz", "Matt Heinz"), false);
  assert.equal(same("J. Smith", "James Smith"), false);
  assert.equal(same("Greg Sargent", "Gregory Sargent"), false);
  assert.equal(same("HEINZ, MATT J", "Matt James Heinz"), true);
  assert.equal(same("Smith, John", "Jane Smith"), false, "a shared surname is not a person");
  assert.equal(same("Smith", "Smith"), false, "a surname alone is not a name");
  assert.equal(same(foldAccents("Alma Hernández"), "Alma Hernandez"), true, "folded, an accent is not a different name");
});

test("a comma form drops a trailing generational suffix", () => {
  assert.deepEqual(parsePersonName("Haynes, Thomas J., III"), nameParts("Thomas J.", "Haynes"));
});

test("new people get one id style, built from the strongest key the source supplied", () => {
  assert.equal(personId("TN", [["roster-name:x#governing", "brent taylor"], ["openstates", "ocd-person/" + UUID]]), `person:tn:${UUID}`);
  assert.equal(personId("AZ", [["fec", "H2AZ06143"], ["bioguide", "C001133"]]), "person:az:c001133", "a bioguide id outranks an FEC id");
  assert.equal(personId("AZ", [["fec", "H2AZ06143"]]), "person:az:h2az06143");
  assert.equal(personId(null, [["bioguide", "C001133"]]), "person:us:c001133");
  assert.equal(personId("AZ", [["legistar:pima", "77"]]), "person:az:legistar-pima-77");
  assert.equal(personId("AZ", [["legistar:pima", "77"]]), personId("az", [["legistar:pima", "77"]]), "the same keys always give the same id");
  assert.match(personId("AZ", [["roster-name:az:city:example#governing", "ada sample"]]), /^person:az:ada-sample-[0-9a-f]{8}$/);
  assert.equal(mintId("meeting", "wa", "granicus:tacoma:1042"), "meeting:wa:granicus-tacoma-1042");
  assert.throws(() => mintId("person", "washington", "x"), /MINT_ID_INVALID/);
  assert.throws(() => personId("AZ", []), /MINT_ID_NEEDS_A_KEY/);
});

test("every spelling of an Open States id, and a bioguide id, is one key", () => {
  const keys = identityKeys("plural:tn:" + UUID, [["campaign-person:TN", UUID], ["bioguide", "C001133"], ["roster-name:b#governing", "x"], ["legistar:pima", "77"]]);
  assert.ok(keys.includes("ocd-person:" + UUID));
  assert.ok(keys.includes("congress:C001133"));
  assert.ok(keys.includes("legistar:pima:77"));
  assert.ok(!keys.includes("77"), "a bare number is only ever kept with the scheme that issued it");
  assert.ok(!keys.some(key => key.includes("roster-name")), "a seat-and-name key is not an identity");
});
