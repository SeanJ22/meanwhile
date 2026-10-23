"""Replay Pulaski's official November notice, preserving the existing AR data.

Unopposed county/city offices other than Circuit Clerk/Mayor do not print on
Arkansas general ballots. Ward/township seats need their exact boundaries.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-south"
meta = json.loads((EVIDENCE / "ar-pulaski-2026.source.json").read_text())
pdf = EVIDENCE / "ar-pulaski-2026.pdf"
assert hashlib.sha256(pdf.read_bytes()).hexdigest() == meta["sha256"]
source = subprocess.check_output(["pdftotext", "-raw", str(pdf), "-"], text=True)
assert source == (EVIDENCE / "ar-pulaski-2026.txt").read_text()
assert "November 3, 2026 General Election" in source and "Pulaski County Board of Election Commissioners" in source
state_file = ROOT / "data/ballot/2026-general/ar.json"
data = json.loads(state_file.read_text())
ballot = data["ballots"]["AR:ar-2026-11-03-general"]
before = {field: len(ballot[field]) for field in ["contests", "candidacies", "measures"]}
provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": "Pulaski County Board of Election Commissioners",
              "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"]}
base = "ocd-division/country:us/state:ar"


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def clean_name(name):
    return re.sub(r"^(?:LR City Director|State Representative|State Senator|Congressman|Representative|Senator|Mayor|Sheriff|Circuit & County Clerk) ", "", name)


def add(title, ocd, block, names=None, question=None):
    assert block in source
    cid = "ar-ba01-pulaski-2026-" + slug(title)
    if any(row["id"] == cid for row in ballot["contests"]):
        return
    p = {**provenance, "quote": block}
    contest = {"id": cid, "electionId": ballot["election"]["id"], "ocdId": ocd,
               "divisionVintage": "2026", "title": title, "type": "MEASURE" if question else "CANDIDACY",
               "voteFor": 1, "termYears": None, "scopeNote": None, "provenance": p}
    if question:
        contest["measureTextUrl"] = meta["finalUrl"]
        ballot["measures"].append({"id": cid + "-text", "contestId": cid,
            "questionText": question, "officialStatement": None, "provenance": p})
    else:
        assert names and len(names) == len(set(name for name, _party in names))
        contest["candidateListComplete"] = True
        for name, party in names:
            assert name.replace("\n", " ") in block.replace("\n", " ")
            ballot["candidacies"].append({"id": cid + "-" + slug(name), "contestId": cid,
                "familyName": name, "givenName": "", "partyLabel": party,
                "slogan": None, "incumbent": None, "websiteUrl": None, "provenance": p})
    ballot["contests"].append(contest)


text = source.split("CANDIDATES FOR THIS ELECTION\n", 1)[1].split("CONSTITUTIONAL AMENDMENTS", 1)[0]
lines = text.splitlines()
headings = []
for i, line in enumerate(lines):
    if (re.fullmatch(r"U\.S\. (?:Senate|Congress District \d+)", line) or
        line in {"Governor", "Lieutenant Governor", "Attorney General", "Auditor of State", "State Treasurer", "Secretary of State", "Commissioner of State Lands", "Unopposed Candidates:"} or
        re.fullmatch(r"State (?:Senate|Representative) District \d+", line) or
        re.fullmatch(r"Pulaski County (?:Judge|Sheriff|Circuit/County Clerk|Treasurer|Assessor)", line) or
        re.fullmatch(r"Justice of the Peace District \d+|Constable .+ Township", line) or
        re.fullmatch(r"(?:Alexander|Jacksonville|Little Rock|Maumelle|Sherwood|Cammack Village|Wrightsville|North Little Rock|N\. Little Rock) (?:Mayor|City Clerk/Treasurer|City Attorney|City Clerk|Council Member .+|City Council .+|City Director .+)", line)):
        headings.append(i)
headings.append(len(lines))
for start, end in zip(headings, headings[1:]):
    title = lines[start]
    ocd = None
    federal = re.fullmatch(r"U\.S\. Congress District (\d+)", title)
    legislative = re.fullmatch(r"State (Senate|Representative) District (\d+)", title)
    if federal and int(federal[1]) in {1, 2}:
        ocd = base + "/cd:" + federal[1]
    elif legislative:
        ocd = base + ("/sldu:" if legislative[1] == "Senate" else "/sldl:") + legislative[2]
    elif title in {"Pulaski County Judge", "Pulaski County Circuit/County Clerk"}:
        ocd = base + "/county:pulaski"
    elif title in {"Alexander Mayor", "Jacksonville Mayor", "Little Rock Mayor", "Maumelle Mayor",
                    "Maumelle City Clerk/Treasurer", "Sherwood Mayor", "Cammack Village Mayor", "Wrightsville Mayor"}:
        place = title.removesuffix(" Mayor").removesuffix(" City Clerk/Treasurer").lower().replace(" ", "_")
        ocd = base + "/place:" + place
    if not ocd:
        continue
    block = "\n".join(lines[start:end])
    # Page furniture is between complete candidate blocks, not evidence cells.
    candidate_text = re.sub(r"\n\f?November 3rd\nGeneral Election Page \d of 5\n", "\n", block)
    candidate_text = candidate_text.replace("-\n", "-")
    names = []
    for line in candidate_text.splitlines()[1:]:
        match = re.fullmatch(r"(.+)-(DEM|REP|LIB|IND)", line)
        if match:
            name = clean_name(match[1])
            names.append((name, match[2]))
    add(title, ocd, block, names)

question = source.split("JACKSONVILLE BALLOT INITIATIVE (for residents of the city of Jacksonville only)", 1)[1].split("(Ballot Title)\n", 1)[1].strip()
add("Jacksonville Ward-Based Representation Initiative Ordinance", base + "/place:jacksonville", question, question=question)
receipt = {"requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "retrievedAt": meta["retrievedAt"],
    "httpStatus": meta["httpStatus"], "rawHash": meta["sha256"], "publisher": provenance["sourceOrg"],
    "sourceClass": "ELECTION_AUTHORITY", "reviewOutcome": "SUPPORTED",
    "reviewedEvidence": "Saved official five-page November 3, 2026 Pulaski County Notice of Election. scripts/ba01-south-pulaski.py replays every included candidate, printed party abbreviation and complete Jacksonville measure text. Unopposed non-mayor municipal offices and county offices except Circuit Clerk are not treated as printed ballot contests; ward and township races need exact boundaries."}
if not any(row.get("rawHash") == receipt["rawHash"] and row.get("finalUrl") == receipt["finalUrl"] for row in data["sourceReceipt"]["sources"]):
    data["sourceReceipt"]["sources"].append(receipt)
data["sourceReceipt"]["reviewedAt"] = max(data["sourceReceipt"]["reviewedAt"], meta["retrievedAt"])
held_upper = {int(row["ocdId"].rsplit(":", 1)[1]) for row in ballot["contests"] if "/sldu:" in row["ocdId"]}
held_lower = {int(row["ocdId"].rsplit(":", 1)[1]) for row in ballot["contests"] if "/sldl:" in row["ocdId"]}
missing_upper = sorted({2, 7, 9, 10, 11, 13, 14, 15, 16, 21, 24, 27, 28, 30, 31, 32, 35} - held_upper)
missing_lower = sorted(set(range(1, 101)) - held_lower)
ballot["coverageNotes"][0] = "The November general-election candidates held here come from official notices/sample ballots published by Sebastian, Benton and Pulaski counties. Pulaski’s new official election commission website is votepulaskiar.gov; the former votepulaski.net address no longer carries its election content. The Secretary of State candidate search remains labeled ‘2026 Preferential Primary and Nonpartisan Judicial General Election’; a statewide certified November candidate list remains unacquired."
ballot["coverageNotes"][1] = ("All four U.S. House districts are held. State Senate districts in the official running-for-office handbook’s 2026 regular-election list that remain unacquired: " + ", ".join(map(str, missing_upper)) + ". State House districts that remain unacquired: " + ", ".join(map(str, missing_lower)) +
    ". Later special-election additions remain unverified. County ward, school and special-district races still need exact district boundaries; a county composite is not a single reader’s ballot.")
state_file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"state": "AR", "added": {field: len(ballot[field]) - before[field] for field in before},
                  "totals": {field: len(ballot[field]) for field in before}}))
