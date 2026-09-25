/**
 * **ADMIN NEVER CALLS A REGISTERED STATE "NOTHING REGISTERED".** (2026-09-25.)
 *
 * Production held a promoted REGISTRATION pointer for fifty states and DC
 * while All states, the state page and the scope select in every header said
 * "nothing registered" for all of them but Arizona, New Hampshire and New
 * Jersey. These tests hold the three places a state's standing is decided —
 * the pointer read, the scope select, and the empty-scope card — to the
 * pointers: a promoted pointer reads as registered with its promoted time, an
 * absent one keeps "nothing registered" and the Census sentence, and a read
 * that did not happen claims neither. The pointer read touches no payload.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyScope } from "@/app/(admin)/_mw/blocks.tsx";
import { shellScope } from "@/app/(admin)/_mw/load-shell.ts";
import {
  registrationCounts,
  registrationPointers,
  type ReadOnlyQuery,
  type RegistrationPointers,
  type Row,
  type Statement,
} from "@/lib/control-plane/admin-view/promoted-slices.ts";
import { noFiguresCell, registrationCountWords, registrationWords, standingLabel, stateStanding } from "@/lib/control-plane/admin-view/registration-standing.ts";
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

test("a promoted registration makes the state registered, not 'nothing registered', everywhere the scope select names it", async () => {
  const registration = await registrationPointers(PRODUCTION_LIKE);
  const ohio = shellScope({ kind: "state", state: "oh" }, [], registration);
  assert.equal(ohio.label, "Ohio — registered, no figures yet");
  assert.notEqual(ohio.label, "Ohio — nothing registered");
  assert.equal(ohio.tracked, false, "registered is not the same as tracked with figures");
  assert.equal(ohio.standing?.kind, "REGISTERED");

  const options = ohio.groups.flatMap((g) => g.options.map((o) => ({ group: g.label, ...o })));
  const ohioOption = options.find((o) => o.value === "oh");
  assert.deepEqual(ohioOption, { group: "Registered, no figures yet", value: "oh", label: "Ohio — registered, no figures yet" });
  assert.equal(options.find((o) => o.value === "dc")?.label, "District of Columbia — registered, no figures yet");
  assert.ok(!options.some((o) => (o.value === "oh" || o.value === "dc") && /nothing registered/.test(o.label)), "no promoted state is offered as nothing registered");

  // An absent pointer keeps "nothing registered".
  const guam = options.find((o) => o.value === "gu");
  assert.deepEqual(guam, { group: "Nothing registered", value: "gu", label: "Guam — nothing registered" });
  assert.equal(shellScope({ kind: "state", state: "al" }, [], registration).label, "Alabama — nothing registered", "Alabama has no pointer in this table");

  // A tracked state is named alone, registration or not, and everywhere counts the tracked states.
  const arizona = shellScope({ kind: "state", state: "az" }, [], registration);
  assert.equal(arizona.label, "Arizona");
  assert.equal(arizona.tracked, true);
  assert.equal(shellScope({ kind: "all" }, [], registration).label, "Everywhere · 3 tracked states");
  assert.equal(options.filter((o) => o.group === "Tracked states").length, 3);
  assert.equal(options.filter((o) => o.value.length === 2).length, 56, "every state and territory is offered once");
});

test("when the pointers were not read, no untracked state is called registered or unregistered", () => {
  const unread: RegistrationPointers = { kind: "UNREAD", detail: "Registration could not be read (TypeError)." };
  const shell = shellScope({ kind: "state", state: "oh" }, [], unread);
  assert.equal(shell.label, "Ohio — registration not read");
  const labels = shell.groups.map((g) => g.label);
  assert.ok(labels.includes("Registration not read"));
  assert.ok(!labels.includes("Nothing registered"), "an absence nobody checked is never claimed");
  assert.ok(!shell.groups.some((g) => g.options.some((o) => /nothing registered/.test(o.label))));
  assert.equal(shellScope({ kind: "state", state: "nj" }, [], unread).label, "New Jersey", "a tracked state does not depend on the pointer read");
});

test("the row words: registered with its promoted time, nothing registered, or not read — and the cells never say 'not registered' for a registered state", () => {
  const registered = stateStanding("oh", false, { kind: "HELD", pointers: [{ state: "oh", versionId: "cv-oh", promotedAt: OHIO_AT }] });
  assert.equal(registered.kind, "REGISTERED");
  assert.equal(
    registrationWords("Ohio", registered),
    "Registered: Ohio's governments from the 2022 Census of Governments are on file, promoted September 25, 2026, 2:08 PM ET. No coverage, requirement or delivery figures are measured there yet.",
  );
  assert.equal(noFiguresCell(registered), "not measured yet");
  assert.equal(standingLabel("Ohio", registered), "Ohio — registered, no figures yet");

  const absent = stateStanding("gu", false, { kind: "HELD", pointers: [] });
  assert.equal(registrationWords("Guam", absent), "Nothing registered yet.");
  assert.equal(noFiguresCell(absent), "not registered");

  const unread = stateStanding("oh", false, { kind: "UNREAD", detail: "x" });
  assert.match(registrationWords("Ohio", unread), /not read just now, so it is called neither registered nor unregistered/);
  assert.equal(noFiguresCell(unread), "not read");
  assert.equal(stateStanding("az", true, { kind: "UNREAD", detail: "x" }).kind, "TRACKED");
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
  if (alaska.kind !== "HELD") return;
  assert.equal(
    registrationCountWords("Alaska", alaska.value),
    "The registration holds 199 bodies on 230 Census divisions, from the 237 governments and dependent school systems the 2022 Census of Governments lists in Alaska: 197 of them sit on a Census division; the other 40 do not, so the registration holds no body for them.",
  );
});

async function renderEmptyScope(props: Parameters<typeof EmptyScope>[0]): Promise<string> {
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
  const noop = () => {};
  const router = { refresh: noop, push: noop, replace: noop, back: noop, forward: noop, prefetch: noop };
  return renderToStaticMarkup(h((AppRouterContext as unknown as { Provider: Parameters<typeof h>[0] }).Provider, { value: router } as never, h(EmptyScope, props)));
}

test("the empty-scope card on a registered state says registered, with its counts and the Census sentence, and never 'Nothing is registered here'", async () => {
  const standing = stateStanding("oh", false, { kind: "HELD", pointers: [{ state: "oh", versionId: "cv-oh", promotedAt: OHIO_AT }] });
  const html = await renderEmptyScope({
    name: "Ohio",
    scope: { kind: "state", state: "oh" },
    standing,
    counts: "The registration holds 2,933 bodies on 4,120 Census divisions.",
    census: "The Census lists 3,936 governments in Ohio.",
  });
  assert.match(html, /Registered, not measured yet/);
  assert.match(html, /promoted September 25, 2026, 2:08 PM ET/);
  assert.match(html, /2,933 bodies/);
  assert.match(html, /The Census lists 3,936 governments in Ohio\./);
  assert.doesNotMatch(html, /Nothing is registered here|no registered bodies/);

  const guam = await renderEmptyScope({
    name: "Guam",
    scope: { kind: "state", state: "gu" },
    standing: stateStanding("gu", false, { kind: "HELD", pointers: [] }),
    census: "The Census of Governments does not survey Guam; its 3 ZIP codes are known.",
  });
  assert.match(guam, /Nothing is registered here/, "an absent pointer keeps its sentence");
  assert.match(guam, /does not survey Guam/, "and the Census sentence");

  const unread = await renderEmptyScope({ name: "Ohio", scope: { kind: "state", state: "oh" }, standing: { kind: "NOT_READ", detail: "Registration could not be read (TypeError)." } });
  assert.match(unread, /Registration not read/);
  assert.doesNotMatch(unread, /Nothing is registered here|no registered bodies/);
});
