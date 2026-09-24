/**
 * **WHAT A SANITIZED FIXTURE CAME FROM.** (2026-08-28, the post-cleanroom
 * shipping hotfix.)
 *
 * When `lib/ops/fixture-credentials.ts` removes a publisher's credential from a
 * captured page, it removes bytes that the capture genuinely contained. That is
 * correct — see that module for why — but it means the committed file is no
 * longer a faithful copy of what was retrieved, and a fixture that has quietly
 * diverged from its source with nothing recording the divergence is a fixture
 * nobody can re-derive.
 *
 * So the divergence is written down, and it is written down in TWO halves that
 * are owned by different things:
 *
 *   - **This file is the DECLARED half, and it is hand-authored.** Where the
 *     page came from and when it was read are facts about an act of retrieval.
 *     No scanner can recover them from the bytes, so a human states them, once,
 *     next to the code that uses them.
 *   - **`data/fixtures/sanitization.json` is the DERIVED half, and it is
 *     GENERATED** by `pnpm fixtures:credentials --sanitize`. Hashes, classes and
 *     counts are mechanical, and RULING 92 means nobody hand-edits them.
 *
 * `tests/fixture-credentials.test.ts` holds the two together: every fixture the
 * generated record names must have a declaration here, and every declaration
 * must name a file that exists. Neither half can drift without the suite saying
 * so.
 *
 * **The raw bytes are NOT committed anywhere.** `rawSha256` in the generated
 * record is the entire memory of them, and that is deliberate: the point of the
 * repair is that this repository stops being a durable mirror of a third
 * party's live credential. A hash is reproducible by anyone who re-captures the
 * page; the page itself is not ours to keep.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { sanitizeText, type CredentialFinding } from "./fixture-credentials.ts";

export interface FixtureCapture {
  /** Repo-relative path of the committed fixture. */
  path: string;
  /** The exact public URL that was read. */
  sourceUrl: string;
  /** The date of retrieval, as the recording session stamped it. */
  capturedOn: string;
  /** What performed the retrieval — a script where one exists, else the session. */
  capturedBy: string;
  /** Why the capture is held at all: the record the fixture is evidence for. */
  provesWhat: string;
}

/**
 * The captures that have been sanitized, and therefore need their provenance
 * stated. **A fixture absent from this list is not a fixture claimed clean** —
 * it is a fixture that has never needed redaction, which is the ordinary case
 * and needs no declaration.
 */
export const SANITIZED_CAPTURES: readonly FixtureCapture[] = [
  {
    path: "tests/fixtures/legistar-insite-pima-clerk-schedule.html",
    sourceUrl: "https://www.pima.gov/board-of-supervisors-meeting-schedule",
    capturedOn: "2026-08-28",
    capturedBy: "scripts/learn-legistar-horizon.mts --record",
    provesWhat:
      "the Clerk of the Board's own table publishes the same fourteen future Pima " +
      "sittings the portal does, through 2026-12-15 — the CLERK_SCHEDULE_PAGE route of MTG-13",
  },
  {
    path: "tests/fixtures/schedulepage/newlondon-calendar-2026-08.html",
    sourceUrl: "https://newlondon.nh.gov/calendar",
    capturedOn: "2026-08-19",
    capturedBy: "the M123 (g21) schedule-page shape session",
    provesWhat:
      "the `event-tip` month-grid shape: one town-wide calendar carrying eleven boards, " +
      "concerts and transfer-station hours, from which one board's sittings are separated",
  },
  /*
   * The two Diligent Community meeting pages below were read by the session
   * that diagnosed the Diligent agenda-extraction defect. Before this record
   * was taken, their ASP.NET page state (`__VIEWSTATE`, `__EVENTVALIDATION`),
   * the Telerik combined-script token and the WebResource/ScriptResource
   * identifiers were replaced by fixed placeholders, so `rawSha256` below is
   * the hash of that page-state-blanked page. The SHA-256 of each page exactly
   * as served is stated in its `capturedBy`.
   */
  {
    path: "tests/fixtures/diligent/meeting-information-tusd-502.html",
    sourceUrl:
      "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=502",
    capturedOn: "2026-09-23",
    capturedBy:
      "the Diligent agenda-extraction diagnosis session, one GET with the project user agent " +
      "(as served: sha256 7b3c0ee092bbec2d27a334415a3ba47290097c2f3cbfcb482cc33c45248894cc)",
    provesWhat:
      "an ASP.NET WebForms page whose one server form wraps the whole page: removed whole, it " +
      "left 62 characters of skip links that were stored as Tucson Unified sitting 502's agenda",
  },
  {
    path: "tests/fixtures/diligent/meeting-information-pcc-698.html",
    sourceUrl: "https://pima.community.highbond.com/Portal/MeetingInformation.aspx?Org=Cal&Id=698",
    capturedOn: "2026-09-23",
    capturedBy:
      "the Diligent agenda-extraction diagnosis session, one GET with the project user agent " +
      "(as served: sha256 b8117e8cc4d25c18413e33ef6a888c82ca02b793130f917d2c34b8100edcb9cc)",
    provesWhat:
      "a second Diligent tenant's meeting page of the same WebForms shape, whose sitting's " +
      "agenda is a linked document rather than anything the page itself carries",
  },
];

/** The declaration for a path, or `null` when none has been made. */
export function captureFor(path: string): FixtureCapture | null {
  return SANITIZED_CAPTURES.find((c) => c.path === path) ?? null;
}

/**
 * **THE ONE DOOR A CAPTURED PAGE ENTERS THE REPOSITORY THROUGH.**
 *
 * `scripts/learn-legistar-horizon.mts` wrote its recordings with a bare
 * `writeFileSync`, which is how a live Google Maps key and a thirty-day bearer
 * token reached `tests/fixtures/` and stopped a deploy. Every recorder now
 * calls this instead, so the redaction happens at the moment of acquisition
 * rather than being found later by a scanner — RULING 103's shared path, and
 * the reason `pnpm fixtures:credentials` should never again have anything to
 * find.
 *
 * It returns what it redacted so the caller can PRINT it. A recorder that
 * silently removed bytes from evidence would be worse than the leak: the whole
 * value of a fixture is that it is what the server sent, and any departure from
 * that has to be visible at the moment it happens.
 */
export function writeCapturedFixture(
  absolutePath: string,
  body: string,
): {
  bytes: number;
  sha256: string;
  replaced: number;
  classes: string[];
  redactions: CredentialFinding[];
} {
  const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex");
  const { text, replaced, redactions } = sanitizeText(body, sha256);
  const bytes = Buffer.from(text, "utf8");
  writeFileSync(absolutePath, bytes);
  return {
    bytes: bytes.length,
    sha256: sha256(text),
    replaced,
    classes: [...new Set(redactions.map((r) => r.classId))],
    redactions,
  };
}
