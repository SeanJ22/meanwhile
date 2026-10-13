/** What a sanitized fixture came from: the provenance of a committed capture whose credentials were removed. */

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

/** The sanitized captures. A fixture absent from this list never needed redaction; it is not a fixture claimed clean. */
export const SANITIZED_CAPTURES: readonly FixtureCapture[] = [
  {
    path: "tests/fixtures/voting-sources/pima-official-election-native.html",
    sourceUrl: "https://www.pima.gov/3199/Pima-Votes",
    capturedOn: "2026-10-13",
    capturedBy: "the VS-01 official election source capture session, public HTTP GET after robots permission",
    provesWhat:
      "Pima County's current election page links the public ArcGIS application whose data sources " +
      "identify vote-center, early-voting and ballot-drop-box routes",
  },
  {
    path: "tests/fixtures/voting-sources/tx-el-paso-early-native.html",
    sourceUrl: "https://epcountyvotestx.gov/voter-information/early-voting-locations",
    capturedOn: "2026-10-13",
    capturedBy: "the VS-01 official election source capture session, public HTTP GET after robots permission",
    provesWhat:
      "El Paso County publishes its November 2026 early-voting locations without requiring a voter's identity",
  },
  {
    path: "tests/fixtures/voting-sources/tx-el-paso-vote-centers-native.html",
    sourceUrl: "https://epcountyvotestx.gov/voter-information/election-day-vote-centers",
    capturedOn: "2026-10-13",
    capturedBy: "the VS-01 official election source capture session, public HTTP GET after robots permission",
    provesWhat:
      "El Paso County's own page publishes 123 November 3, 2026 vote centers and 7 a.m. to 7 p.m. hours; " +
      "the embedded location records are read without using the unrelated map-service credential",
  },
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
  // Page state and script tokens were replaced by fixed placeholders before recording; `rawSha256` hashes that page.
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

/** The one door a captured page enters the repository through: redaction happens at acquisition. */
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
