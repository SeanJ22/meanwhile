# Retention wording sources

`python scripts/ba02-retention.py --write` fills Florida's 23, Missouri's one,
and CNMI's one published retention question. Without `--write`, it checks that
the saved official source bytes still produce the values in the state inputs.
The scheduled ballot assembler reads those ordinary state inputs directly.

Florida Statutes 105.041(2) and Missouri Constitution V25(c)(1) prescribe the
question templates. Only the name and court fields are filled from the held
certified candidate record. Florida's numbered appellate districts are checked
against the held Chapter 35 statute. CNMI's full question is extracted from all
13 fronts of the already-held November 3, 2026 official specimen, with identical
wording on each front.

The two statute captures here were read from their official legislative sites
on October 23, 2026. Each `.source.json` pins the raw HTML SHA-256, URL and capture
time. Direct re-downloads of Florida's candidate CSV and Missouri's certified
candidate PDF returned HTTP 403 on that pass; the existing verified candidate
records and saved Missouri certification text remain the name and court sources.
The prescribed question itself comes from the newly captured statute. When
rechecking a retention question, search held specimens first, then the exact
retention-ballot statute; a certified candidate list alone often omits wording.
