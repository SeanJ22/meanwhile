"""Replay Benton County's saved November 2026 composite ballot into the state file.

Only whole legislative districts and explicitly city/county-wide offices are
included. Ward, school and special-district boundaries remain acquisition work.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-south"
meta = json.loads((EVIDENCE / "ar-benton-2026.source.json").read_text())
pdf = EVIDENCE / "ar-benton-2026.pdf"
assert hashlib.sha256(pdf.read_bytes()).hexdigest() == meta["sha256"]
source = subprocess.check_output(["pdftotext", "-raw", str(pdf), "-"], text=True)
assert source == (EVIDENCE / "ar-benton-2026.txt").read_text()
assert "NOVEMBER 3, 2026" in source and "BENTON COUNTY, AR" in source
lines = source.splitlines()
state_file = ROOT / "data/ballot/2026-general/ar.json"
data = json.loads(state_file.read_text())
ballot = data["ballots"]["AR:ar-2026-11-03-general"]
before = {field: len(ballot[field]) for field in ["contests", "candidacies", "measures"]}
provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": "Benton County Election Commission",
              "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"]}


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def add_contest(title, ocd, names, quote, *, measure=None, official_number=None):
    assert title and ocd and quote
    assert quote in source
    cid = "ar-ba01-benton-2026-" + slug(ocd.rsplit("/", 1)[-1] + "-" + title)
    if any(row["id"] == cid for row in ballot["contests"]):
        return
    p = {**provenance, "quote": quote}
    contest = {"id": cid, "electionId": ballot["election"]["id"], "ocdId": ocd,
               "divisionVintage": "2026", "title": title, "type": "MEASURE" if measure else "CANDIDACY",
               "voteFor": 1, "termYears": None, "scopeNote": None, "provenance": p}
    if measure:
        contest["measureTextUrl"] = meta["finalUrl"]
        item = {"id": cid + "-text", "contestId": cid, "questionText": measure,
                "officialStatement": None, "provenance": p}
        if official_number:
            item["officialNumber"] = official_number
        ballot["measures"].append(item)
    else:
        assert names and len({name for name, _party in names}) == len(names)
        contest["candidateListComplete"] = True
        for name, party in names:
            assert name in quote
            ballot["candidacies"].append({"id": cid + "-" + slug(name), "contestId": cid,
                "familyName": name, "givenName": "", "partyLabel": party, "slogan": None,
                "incumbent": None, "websiteUrl": None, "provenance": p})
    ballot["contests"].append(contest)


# State contests: every printed candidate/party pair, with no inference from
# incumbent office labels on the ballot. Already-held federal/state offices stay.
for i, line in enumerate(lines):
    match = re.fullmatch(r"State (Senate|Representative), District (\d+)", line)
    if not match:
        continue
    assert lines[i + 1] == "Vote for One"
    j = i + 2
    while j < len(lines) and not (lines[j].startswith("State Senate, District ") or
            lines[j].startswith("State Representative, District ") or lines[j] == "UNOPPOSED CANDIDATES"):
        j += 1
    block = lines[i:j]
    names = [(block[k - 1], block[k].removesuffix(" Party"))
             for k in range(1, len(block)) if block[k].endswith(" Party")]
    chamber = "sldu" if match[1] == "Senate" else "sldl"
    add_contest(line, "ocd-division/country:us/state:ar/" + chamber + ":" + match[2],
                names, "\n".join(block))

# The county-wide circuit clerk is printed despite the ballot's explicit
# exclusion of other unopposed county/municipal offices.
clerk = "Circuit Clerk\nVote for One\nBrenda DeShields -\nCircuit Clerk\nRepublican Party"
add_contest("Circuit Clerk — Benton County", "ocd-division/country:us/state:ar/county:benton",
            [("Brenda DeShields", "Republican")], clerk)

labels = {"Senator", "Congressman", "Governor", "State Senator", "Lieutenant Governor",
          "Attorney General", "Secretary of State", "State Treasurer", "Auditor of State",
          "State Representative", "Justice", "Representative", "Mayor", "Councilmember",
          "Council Member", "City Council Member", "Council Woman", "Councilman",
          "City Clerk", "City Clerk/Treasurer", "(Mayor)"}
city = None
for i, line in enumerate(lines):
    if re.fullmatch(r"(?:CITY|TOWN) OF [A-Z ]+", line):
        city = line.split(" OF ", 1)[1].title()
    if i <= 180 or line != "Vote for One" or lines[i - 1] not in {"Mayor", "Recorder/Treasurer", "City Clerk", "City Attorney"}:
        continue
    assert city
    j = i + 1
    while j < len(lines) and not any(lines[j].startswith(x) for x in
            ["CITY OF ", "TOWN OF ", "SPECIAL ELECTION ", "SCHOOL", "DISCLAIMER:"]) and not (
            j + 1 < len(lines) and lines[j + 1] == "Vote for One"):
        j += 1
    block = lines[i - 1:j]
    names = [(value, None) for value in lines[i + 1:j] if value and value not in labels and
             not value.endswith(" Party") and not value.isdigit()]
    add_contest(lines[i - 1] + " — " + city, "ocd-division/country:us/state:ar/place:" + city.lower().replace(" ", "_"),
                names, "\n".join(block))


def measure_block(start, end, title, place, *, prefix="", official_number=None):
    block = source.split(start, 1)[1].split(end, 1)[0].strip()
    question = prefix + block
    assert block in source and (not prefix or prefix.strip() in source)
    # Keep the full printed language, including shared conditions for Rogers.
    add_contest(title, "ocd-division/country:us/state:ar/place:" + place, [], block,
                measure=question, official_number=official_number)


measure_block("Ordinance No. 2026-006\n", "\nFOR\nAGAINST", "Little Flock — Sales and Compensating Use Tax",
              "little_flock", official_number="Ordinance No. 2026-006")
rogers_prefix = source.split("ROGERS\nThe bonds described below", 1)[1].split("\nREFUNDING BONDS", 1)[0]
rogers_prefix = "The bonds described below" + rogers_prefix + "\n\n"
for printed, title in [("REFUNDING BONDS", "Refunding Bonds"),
                       ("STREET IMPROVEMENT BONDS", "Street Improvement Bonds"),
                       ("PARK AND RECREATIONAL\nIMPROVEMENT BONDS", "Park and Recreational Improvement Bonds"),
                       ("FIRE IMPROVEMENT BONDS", "Fire Improvement Bonds"),
                       ("POLICE IMPROVEMENT BONDS", "Police Improvement Bonds"),
                       ("ANIMAL SERVICES IMPROVEMENT\nBONDS", "Animal Services Improvement Bonds")]:
    measure_block(printed + "\n", "\nFOR\nAGAINST", "Rogers — " + title, "rogers", prefix=rogers_prefix)
measure_block("BONDS AND TAX\n", "\nFOR\nAGAINST", "Siloam Springs — Wastewater Bonds and Tax", "siloam_springs")

receipt = {"requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "retrievedAt": meta["retrievedAt"],
           "httpStatus": meta["httpStatus"], "rawHash": meta["sha256"], "publisher": provenance["sourceOrg"],
           "sourceClass": "ELECTION_AUTHORITY", "reviewOutcome": "SUPPORTED",
           "reviewedEvidence": "Saved official six-page November 3, 2026 Benton County composite sample ballot. scripts/ba01-south-benton.py replays all included names, parties, offices and verbatim local measure language against the saved PDF text. Ward, school and special-district races require their own boundary mapping and remain unacquired."}
if not any(row.get("rawHash") == receipt["rawHash"] and row.get("finalUrl") == receipt["finalUrl"] for row in data["sourceReceipt"]["sources"]):
    data["sourceReceipt"]["sources"].append(receipt)
data["sourceReceipt"]["reviewedAt"] = max(data["sourceReceipt"]["reviewedAt"], meta["retrievedAt"])
has_pulaski = any(row["ocdId"] == "ocd-division/country:us/state:ar/county:pulaski" for row in ballot["contests"])
counties = "Sebastian, Benton and Pulaski" if has_pulaski else "Sebastian and Benton"
ballot["coverageNotes"][0] = "The November general-election candidates held here come from official notices/sample ballots published by " + counties + " counties. The Secretary of State candidate search remains labeled ‘2026 Preferential Primary and Nonpartisan Judicial General Election’; a statewide certified November candidate list remains unacquired."
held_upper = {int(row["ocdId"].rsplit(":", 1)[1]) for row in ballot["contests"] if "/sldu:" in row["ocdId"]}
held_lower = {int(row["ocdId"].rsplit(":", 1)[1]) for row in ballot["contests"] if "/sldl:" in row["ocdId"]}
missing_upper = sorted({2, 7, 9, 10, 11, 13, 14, 15, 16, 21, 24, 27, 28, 30, 31, 32, 35} - held_upper)
missing_lower = sorted(set(range(1, 101)) - held_lower)
held_federal = {int(row["ocdId"].rsplit(":", 1)[1]) for row in ballot["contests"] if "/cd:" in row["ocdId"]}
missing_federal = sorted({1, 2, 3, 4} - held_federal)
federal_note = "U.S. House districts that remain unacquired: " + ", ".join(map(str, missing_federal)) + ". " if missing_federal else "All four U.S. House districts are held. "
ballot["coverageNotes"][1] = (federal_note +
    "State Senate districts in the official running-for-office handbook’s 2026 regular-election list that remain unacquired: " + ", ".join(map(str, missing_upper)) + ". State House districts that remain unacquired: " + ", ".join(map(str, missing_lower)) +
    ". Later special-election additions remain unverified. Benton County ward, school and special-district races still need their exact district boundaries; the county composite is not a single reader’s ballot.")
state_file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"state": "AR", "source": meta["finalUrl"], "added": {
    field: len(ballot[field]) - before[field] for field in before}, "totals": {
    field: len(ballot[field]) for field in before}}))
