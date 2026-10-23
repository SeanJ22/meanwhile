# Official retention questions

`python scripts/ba02-retention-west.py --check` checks the saved source fingerprints,
the official question forms, the 67 completed questions, and their single-choice
vote limits. Without `--check` it updates the six owned state input files.

The forms expressly leave slots for the certified judge and court. The script
uses the existing verified candidacy and court, and retains the source form in
the question's provenance. Idaho also requires the county and judicial district;
the saved current chapter 8 assigns every county to its district. Colorado's seven
completed questions additionally match the held 2026 Denver sample verbatim.

The Colorado General Assembly's current 2026 download page links directly to the
`olls.info` constitution HTML. The saved government page establishes that host as
an official publisher. Alaska's legislature endpoint returned HTTP 403; the
Alaska Judicial Council's own retention-law page publishes AS 15.15.030(10),
including the exact Supreme Court form. Other failed guessed document paths were
not used for facts. The Montana Secretary of State's layout guide supplies the
actual retention form and the instruction to vote in one oval. Wyoming's current
Title 22 supplies the Justice/Judge forms.

The Colorado constitution HTML and the Idaho and Wyoming source PDF bytes are
retained compressed. The Colorado and Wyoming text snapshots are the relevant
retention sections; Wyoming uses
`pdftotext -layout`. Each source metadata file records both document and text hashes.

Counts: AK 1, AZ 13, CO 7, ID 33, MT 10, WY 3. The source forms and completed
questions are verified data; browser display and production scheduling are
checked by the BA-02 integration work.
