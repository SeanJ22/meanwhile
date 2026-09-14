# Method data boundaries

`knowledge.json` and `conclusions.json` are versioned software/method inputs.

`candidates.json` is the immutable 2026-09-02 cutover seed evidence only. Its
Git blob is `5ca91ada3d17f18c64abe346a31351d1d37337b9`; it is not live state and no
runtime process may read or write it. The mutable candidate lifecycle lives at
`cp_method_candidates/live` in the standing control plane. The first clean
deployed runtime binds the imported revision to this evidence with a canonical
`METHOD_CANDIDATE_AUTHORITY_ADOPTION` receipt in the existing owner outcome
history.
