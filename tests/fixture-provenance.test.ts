import assert from "node:assert/strict";
import { test } from "node:test";

import { FIXTURES, FIXTURE_SOURCE_HOSTS } from "../lib/sources/mock/fixtures.ts";
import { mockSource } from "../lib/sources/mock/index.ts";

/**
 * Fixtures must not invent provenance.
 *
 * The mock shipped URLs like `https://tusd1.org/agendas/4107` that looked
 * exactly like real permalinks and resolved to a front page or a 404. Nothing
 * caught it, because a fabricated URL is invisible until someone clicks — which
 * is precisely why this check is cheap and worth having.
 *
 * The same assertions run against `normalize()` output, not just the raw rows,
 * so an adapter that manufactures a URL during the transform fails here too.
 */

function hostOf(url: string): string {
  return new URL(url).host;
}

/** A URL is citable only if someone put its host on the list on purpose. */
function assertCitable(url: string | null, where: string) {
  if (url === null) return;

  let host: string;
  try {
    host = hostOf(url);
  } catch {
    assert.fail(`${where}: ${url} is not a parseable URL`);
  }

  assert.ok(
    FIXTURE_SOURCE_HOSTS.includes(host),
    `${where}: ${host} is not in FIXTURE_SOURCE_HOSTS. Either this URL was ` +
      `invented — in which case it must be null — or it was genuinely read ` +
      `from, in which case add the host to the allowlist in the same change.`,
  );
}

test("no fixture cites a host that is not on the allowlist", () => {
  for (const fixture of FIXTURES) {
    assertCitable(fixture.EventInSiteURL, `fixture ${fixture.EventId} sourceUrl`);
    assertCitable(fixture.EventAgendaFile, `fixture ${fixture.EventId} agendaUrl`);
  }
});

test("every fixture names a publishing organization", () => {
  // sourceOrg is the body that authored the record, never the software vendor
  // holding it. It is knowable even when no permalink is, so unlike sourceUrl
  // it is never allowed to be blank.
  for (const fixture of FIXTURES) {
    assert.ok(
      fixture.PublishingOrg.trim().length > 0,
      `fixture ${fixture.EventId} has no PublishingOrg`,
    );
  }
});

test("a cited sourceUrl always comes with a sourceOrg", () => {
  const meetings = mockSource.normalize(
    FIXTURES.map((f) => ({
      ...f,
      EventDate: "2026-01-01",
      EventTime: "9:00 AM",
      CollectedAt: "2026-01-01T00:00:00.000Z",
    })) as never,
  );

  for (const meeting of meetings) {
    if (meeting.provenance.sourceUrl !== null) {
      assert.ok(
        meeting.provenance.sourceOrg.trim().length > 0,
        `${meeting.id}: cites a URL with no publishing organization`,
      );
    }
  }
});

test("normalize does not manufacture URLs the fixtures did not carry", () => {
  const meetings = mockSource.normalize(
    FIXTURES.map((f) => ({
      ...f,
      EventDate: "2026-01-01",
      EventTime: "9:00 AM",
      CollectedAt: "2026-01-01T00:00:00.000Z",
    })) as never,
  );

  assert.ok(meetings.length > 0, "expected normalize to emit meetings");

  for (const meeting of meetings) {
    assertCitable(meeting.provenance.sourceUrl, `${meeting.id} sourceUrl`);
    assertCitable(meeting.agendaUrl, `${meeting.id} agendaUrl`);
  }
});

test("nothing has been verified against a live source", () => {
  // The fixtures are invented. `verifiedAt` claims a human confirmed a record
  // still matches its source; there is no source, so it must stay null.
  const meetings = mockSource.normalize(
    FIXTURES.map((f) => ({
      ...f,
      EventDate: "2026-01-01",
      EventTime: "9:00 AM",
      CollectedAt: "2026-01-01T00:00:00.000Z",
    })) as never,
  );

  for (const meeting of meetings) {
    assert.equal(
      meeting.provenance.verifiedAt,
      null,
      `${meeting.id}: a fixture must never claim to have been verified`,
    );
  }
});
