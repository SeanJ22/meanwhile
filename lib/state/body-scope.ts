import { readerBodyName } from "../text/reader-names.ts";
import type { Meeting } from "../sources/types.ts";

/**
 * The body scope's key is `<ocdId>|<bodyName>`, never a bare division id: a
 * branded string whose only constructor is `bodyScopeKey`, from a meeting, so
 * a division id, body id or display name handed to `scope/body` is a type error.
 */
export type BodyScopeKey = string & { readonly __bodyScopeKey: never };

/** The one constructor, shared by the dropdown that offers it and the filter that matches it. */
export function bodyScopeKey(meeting: Pick<Meeting, "ocdId" | "bodyName">): BodyScopeKey {
  // The reader's name for the body, so differently worded titles of one body
  // ("GOVERNING BOARD AGENDA REGULAR MEETING", "Governing Board Meeting") are one option.
  return `${meeting.ocdId}|${readerBodyName(meeting.bodyName)}` as BodyScopeKey;
}
