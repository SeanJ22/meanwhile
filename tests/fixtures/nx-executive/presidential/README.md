Saved official source responses retrieved 2026-10-23 UTC, using existing configured credentials for FEC and Congress.gov. Credentials are passed as headers and absent from these files.

- `register-complete.json`: Federal Register `/api/v1/documents.json` with presidential type, signer `donald-trump`, publication date from 2025-01-20, explicit subtype/signing-date fields, and `per_page=1000`. All 656 source rows are held, including document subtypes the card does not relabel as orders, proclamations or memoranda.
- `register-orders.json`: the same API with `conditions[presidential_document_type]=executive_order`, explicit native number/subtype/signing-date fields, and `per_page=2`.
- `register.json`, `register-detail.json`: default presidential listing and document `2026-21666` detail. The default listing lacks subtype and signing date, so it cannot alone prove an order or memorandum.
- `register-presidents.html`: Federal Register `/presidential-documents`, which binds published names to signer slugs. `/api/v1/presidents.json` returns HTTP 404 and is not used.
- `congress-actions.json`, `congress-bill.json`: Congress.gov API bill 119/HR1 and its actions. A signature is stated explicitly; an enactment alone is not called a signature.
- `congress-veto-actions.json`: Congress.gov API bill 119/HR131 actions, including the 2025-12-29 presidential veto and later override attempts.
- `congress-laws-private.json`: Congress.gov API `/law/119/priv` listing, used to verify the source shape for private laws.
- `fec-candidates.json`: OpenFEC `/v1/candidates/` filtered to office P, name Donald J. Trump and election year 2024. It supplies native candidate identity and party.
- `fec-candidate.json`, `fec-totals.json`: OpenFEC candidate P80001571 and candidate totals for cycle 2024. Totals preserve the exact reported coverage end, 2024-08-08, rather than implying they cover the entire election.
- `senate-ties.html`: Senate `/legislative/TieVotes.htm`, with Vice President sections and exact linked roll calls.
- `senate-vote.xml`: Senate roll call 119/1/15. The Senate member tally is 50–50; the separate Vice President tie-breaker vote is Yea. The published result is 51–50.
- `senate-veto-index.html`, `senate-vetoes.html`: Senate veto counts and the linked current Trump administration page. Name plus tenure distinguishes the two nonconsecutive terms. Bill IDs are discovery leads; final veto facts come from Congress.gov actions.
