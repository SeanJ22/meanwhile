/**
 * **AN IDENTIFIER ON THE FACE: A NAME, THEN THE EXACT ID ONE CLICK AWAY.**
 * (ADM-48, from the 9.6.26 owner review.)
 *
 * The owner, on the Scout Attempts table: *"The ID also is vertical, which is
 * really ugly looking."* A 24-character hash in a narrow column wraps one
 * character per line and turns a row into a stripe. The rule the brief sets is
 * the same one CLAUDE.md already carries for keys: the human-readable name
 * leads, the short id sits beside it, the exact id lives in a disclosure, and
 * a copy control puts it on the clipboard so it never has to be transcribed.
 *
 * One component, used by both the role cards and the Scout Attempts table, so
 * an id looks the same everywhere on this page. The copy control is the
 * release review's `CopyButton` — there is exactly one clipboard button in
 * this console (RULING 103).
 */
import { displayNameOf } from "@/lib/control-plane/display-name.ts";

import { CopyButton } from "../../_mw/copy-button";
import { Name } from "../../console-ui.tsx";

export function Identity({
  id,
  what,
  candidateNames,
}: {
  readonly id: string;
  readonly what: string;
  readonly candidateNames?: Readonly<Record<string, string>>;
}) {
  const shown = displayNameOf(id, { candidateNames });
  return (
    <span className="wf-id">
      <Name raw={id} candidateNames={candidateNames} />
      <CopyButton value={id} what={what} />
      <details className="raw-ids">
        <summary>exact id</summary>
        <small className="note">
          <code>{id}</code>
          {shown.recognised ? "" : " — no display name is on file for this key, so it reads as its own words."}
        </small>
      </details>
    </span>
  );
}
