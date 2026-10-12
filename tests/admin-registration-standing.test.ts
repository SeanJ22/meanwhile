/**
 * Admin never calls a registered state "nothing registered". The three places a state's standing is
 * decided (the pointer read, the scope select, the empty-scope card) follow the pointers: a promoted
 * pointer reads as registered with its promoted time, an absent one keeps "nothing registered" and
 * the Census sentence, and a read that did not happen claims neither. The pointer read touches no payload.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  registrationCounts,
  registrationPointers,
  type ReadOnlyQuery,
  type Row,
  type Statement,
} from "@/lib/control-plane/admin-view/promoted-slices.ts";
import { REGISTRATION_TARGETS } from "@/lib/registration/publication.ts";

const OHIO_AT = "2026-09-25T18:08:28.272Z";

/** Answers the pointer statement the way Postgres does, from a table of promoted pointers. */
function pointerTable(promoted: Readonly<Record<string, { versionId: string; promotedAt: Date | string }>>, seen: Statement[] = []): ReadOnlyQuery {
  return async (statements) => {
    seen.push(...statements);
    return statements.map((s): Row[] => {
      const [recordClass, scopes] = s.params as [string, string[]];
      return Object.entries(promoted)
        .filter(([scope]) => recordClass === "REGISTRATION" && scopes.includes(scope))
        .map(([scope, p]) => ({ scope, version_id: p.versionId, promoted_at: p.promotedAt }));
    });
  };
}

const PRODUCTION_LIKE = pointerTable({
  "US-OH:registration:v1": { versionId: "cv-oh", promotedAt: new Date(OHIO_AT) },
  "US-DC:registration:v1": { versionId: "cv-dc", promotedAt: "2026-09-25T17:00:00.000Z" },
  "US-AZ:registration:v1": { versionId: "cv-az", promotedAt: "2026-09-25T16:00:00.000Z" },
  // A pointer outside the registration scopes is never read as a state's.
  "US-OH:registration:v2-draft": { versionId: "cv-x", promotedAt: "2026-09-25T16:00:00.000Z" },
});

test("the pointer read asks for every state's registration scope and reads no payload", async () => {
  const seen: Statement[] = [];
  const read = await registrationPointers(pointerTable({}, seen));
  assert.deepEqual(read, { kind: "HELD", pointers: [] }, "no pointer promoted is an empty list, read");
  assert.equal(seen.length, 1, "one statement");
  assert.doesNotMatch(seen[0].text, /payload/, "the registration itself is never read for the list");
  assert.match(seen[0].text, /FROM civic_data_promotions WHERE record_class = \$1 AND scope = ANY\(\$2::text\[\]\)/);
  const [recordClass, scopes] = seen[0].params as [string, string[]];
  assert.equal(recordClass, "REGISTRATION");
  assert.deepEqual([...scopes].sort(), REGISTRATION_TARGETS.map((t) => t.scope).sort(), "every state, DC and territory in the FIPS table");
});

test("a promoted pointer reads as that state's, with its version and promoted time", async () => {
  const read = await registrationPointers(PRODUCTION_LIKE);
  assert.equal(read.kind, "HELD");
  if (read.kind !== "HELD") return;
  const byState = Object.fromEntries(read.pointers.map((p) => [p.state, p]));
  assert.deepEqual(Object.keys(byState).sort(), ["az", "dc", "oh"]);
  assert.deepEqual(byState.oh, { state: "oh", versionId: "cv-oh", promotedAt: OHIO_AT }, "a driver Date reads as its ISO instant");
  assert.equal(byState.dc.promotedAt, "2026-09-25T17:00:00.000Z", "a string instant reads the same");
});

test("a pointer read that fails, or has no store to ask, is UNREAD with its reason — never an empty list", async () => {
  assert.equal((await registrationPointers(null)).kind, "UNREAD");
  const failed = await registrationPointers(async () => {
    throw new TypeError("fetch failed");
  });
  assert.deepEqual(failed, { kind: "UNREAD", detail: "Registration could not be read (TypeError)." });
});

test("one state's counts are cut out of its own row, and name what they count", async () => {
  const seen: Statement[] = [];
  const query: ReadOnlyQuery = async (statements) => {
    seen.push(...statements);
    return statements.map((s): Row[] =>
      s.params[1] === "US-AK:registration:v1"
        ? [{ version_id: "cv-ak", promoted_at: new Date("2026-09-25T18:08:28.272Z"), governments: 237, paired: 197, bodies: 199, divisions: 230 }]
        : [],
    );
  };
  const alaska = await registrationCounts("ak", query);
  assert.deepEqual(alaska, {
    kind: "HELD",
    versionId: "cv-ak",
    value: { promotedAt: "2026-09-25T18:08:28.272Z", governments: 237, pairedGovernments: 197, bodies: 199, divisions: 230 },
  });
  assert.match(seen[0].text, /WHERE record_class = \$1 AND scope = \$2$/, "one state's row only");
  assert.doesNotMatch(seen[0].text, /\bpayload\b(?!->)/, "the payload column itself never crosses the wire: only what Postgres cuts out of it");
  assert.deepEqual(await registrationCounts("gu", query), { kind: "NOT_PUBLISHED" }, "no pointer is not published, never zero governments");
  assert.deepEqual(await registrationCounts("zz", query), { kind: "NOT_PUBLISHED" }, "a code outside the FIPS table has no registration");
});
