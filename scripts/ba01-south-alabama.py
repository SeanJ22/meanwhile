"""Replay countywide offices from the five largest Alabama county samples.

The sample PDFs include many styles. Deduplicate each complete printed office
and candidate list. District, division and school boundaries stay separate.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-south"
state_file = ROOT / "data/ballot/2026-general/al.json"
data = json.loads(state_file.read_text())
ballot = data["ballots"]["AL:al-2026-11-03-general"]
before = {field: len(ballot[field]) for field in ["contests", "candidacies", "measures"]}


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


for county in ["jefferson", "mobile", "madison", "baldwin", "shelby"]:
    stem = "al-" + county + "-2026"
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    pdf = EVIDENCE / (stem + ".pdf")
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == meta["sha256"]
    source = subprocess.check_output(["pdftotext", "-raw", str(pdf), "-"], text=True)
    assert source == (EVIDENCE / (stem + ".txt")).read_text()
    assert "NOVEMBER 3, 2026" in source and county.upper() + " COUNTY, ALABAMA" in source
    lines = source.splitlines()
    offices = {}
    for i, line in enumerate(lines):
        if line != "(Vote for One)":
            continue
        j = i - 1
        while j >= 0 and not lines[j].startswith("FOR ") and i - j < 6:
            j -= 1
        if j < 0 or not lines[j].startswith("FOR "):
            continue
        title = " ".join(lines[j:i])
        # These offices are explicitly county-wide. A numbered judicial,
        # commission, education or Bessemer division seat is not widened.
        if county.upper() + " COUNTY" not in title or not any(word in title for word in
                ["SHERIFF", "TAX ASSESSOR", "TAX COLLECTOR", "CORONER", "LICENSE DIRECTOR", "REVENUE COMMISSIONER", "PROPERTY TAX COMMISSIONER"]):
            continue
        if any(word in title for word in ["DISTRICT", "CIRCUIT", "BOARD", "DIVISION", "ASSISTANT"]):
            continue
        end = i + 1
        names = []
        while end + 1 < len(lines) and lines[end + 1].upper() in {"DEMOCRAT", "REPUBLICAN", "INDEPENDENT"}:
            names.append((lines[end], lines[end + 1]))
            end += 2
        assert names
        assert all(party.upper() in {"DEMOCRAT", "REPUBLICAN", "INDEPENDENT"} for _name, party in names)
        key = slug(title)
        if key in offices:
            assert offices[key][1] == names
            continue
        offices[key] = (title, names, "\n".join(lines[j:end]))
    for key, (title, names, quote) in offices.items():
        cid = "al-ba01-2026-" + key
        if any(row["id"] == cid for row in ballot["contests"]):
            continue
        assert quote in source
        provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": "Alabama Secretary of State",
            "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"], "quote": quote}
        ballot["contests"].append({"id": cid, "electionId": ballot["election"]["id"],
            "ocdId": "ocd-division/country:us/state:al/county:" + county, "divisionVintage": "2026",
            "title": title.removeprefix("FOR "), "type": "CANDIDACY", "voteFor": 1,
            "termYears": None, "scopeNote": None, "candidateListComplete": True, "provenance": provenance})
        for name, party in names:
            assert name in quote
            ballot["candidacies"].append({"id": cid + "-" + slug(name), "contestId": cid,
                "familyName": name, "givenName": "", "partyLabel": party, "slogan": None,
                "incumbent": None, "websiteUrl": None, "provenance": provenance})
    receipt = {"requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "retrievedAt": meta["retrievedAt"],
        "httpStatus": meta["httpStatus"], "rawHash": meta["sha256"], "publisher": "Alabama Secretary of State",
        "sourceClass": "ELECTION_AUTHORITY", "reviewOutcome": "SUPPORTED",
        "reviewedEvidence": "Saved official November 3, 2026 " + county.title() + " County sample ballot. scripts/ba01-south-alabama.py checks the saved PDF hash and exact printed countywide office/candidate/party blocks across all held styles. District, school and division contests require their own exact boundary mappings."}
    if not any(row.get("rawHash") == receipt["rawHash"] and row.get("finalUrl") == receipt["finalUrl"] for row in data["sourceReceipt"]["sources"]):
        data["sourceReceipt"]["sources"].append(receipt)
    data["sourceReceipt"]["reviewedAt"] = max(data["sourceReceipt"]["reviewedAt"], meta["retrievedAt"])
    print(json.dumps({"county": county, "verified_countywide_contests": len(offices),
        "candidacies": sum(len(row[1]) for row in offices.values()), "source": meta["finalUrl"]}))
state_file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"state": "AL", "added": {field: len(ballot[field]) - before[field] for field in before},
                  "totals": {field: len(ballot[field]) for field in before}}))
