# Hand-off to CX-VS-MT, CX-VS-RI, CX-VS-WI (from River, Oct 30 ~1 AM ET)

Sean (Oct 29): River does only the statewide VIP fill; the CX-VS lanes add county/town polling-place doors.
These files are River builders' work up to that order. They are not merged anywhere; delete this branch once used.

- WI/: 35 sources already LIVE as 33 cp_doors rows (official-voting-source, votingState_WI) written Oct 30 04:41Z;
  feed:voting-sites:WI reopened with readNow. Sean said keep them and hand to CX-VS-WI. coverage.csv lists all 1,849
  municipalities with door/reason; report.md has the reader gap (county Type B/C/D legal-notice PDFs, column groups)
  that would unlock most remaining towns. Don't re-add these doors.
- MT/: 18 door drafts proven to parse locally (doors.json) + doors-need-linking-page.json. NOT in production.
- RI/: 24 door drafts proven to parse locally (doors.json) + doors-pending-association.json. NOT in production.
- BRIEF.md: the brief those builders followed (how doors work, rules, proof standard).
