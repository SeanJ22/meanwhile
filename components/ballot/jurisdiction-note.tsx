export const JURISDICTION_MARK = "◆";
export const JURISDICTION_NOTE_HEADING = "Contests marked ◆ depend on your address.";

export function JurisdictionMark() {
  return (
    <sup>
      <a
        href="#jurisdiction-note"
        title={JURISDICTION_NOTE_HEADING}
        aria-label="Depends on your address"
        className="ml-0.5 align-super t-caption text-signal no-underline"
        data-jurisdiction-mark="true"
      >
        {JURISDICTION_MARK}
      </a>
    </sup>
  );
}

export function JurisdictionNote() {
  return <p id="jurisdiction-note" data-jurisdiction-note="true" className="t-body text-paper-dim">
    {JURISDICTION_NOTE_HEADING}
  </p>;
}
