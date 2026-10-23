#!/usr/bin/env python3
"""Recover the official master PDF's embedded font and import countywide choices."""
from pathlib import Path
import gzip
import hashlib
import json
import re
import runpy

ROOT = Path(__file__).resolve().parents[1]
COUNTY = ROOT / "data/ballot/ba01-west-evidence/county-captures"
COMMON = runpy.run_path(str(ROOT / "scripts/ba01-west-county-offices.py"))


def el_paso_source():
    sources = {row["name"]: row for row in json.loads((COUNTY / "manifest.json").read_text())}
    source = sources["co-elpaso-sample"]
    raw = gzip.decompress((COUNTY / source["file"]).read_bytes())
    if hashlib.sha256(raw).hexdigest() != source["rawHash"]:
        raise ValueError("Changed official El Paso PDF")
    text = (COUNTY / source["rawTextSnapshot"]).read_bytes()
    if hashlib.sha256(text).hexdigest() != source["rawTextHash"]:
        raise ValueError("Changed El Paso extraction")
    # The embedded custom fonts encode ASCII codepoints minus29. Poppler also
    # inserts ordinary whitespace between positioned glyph runs; preserve that.
    decoded = "".join(chr(ord(char) + 29) if 3 <= ord(char) <= 97 and char not in "\t\n\r " else
        (" " if char == "¬" else char) for char in text.decode())
    decoded = re.sub(r"\s+", " ", decoded)
    decoded = decoded.replace("\uf0b7", "•")
    if "NOVEMBER 3" not in decoded or b"2026" not in text:
        raise ValueError("Wrong El Paso election date")
    # These two punctuation losses were checked against the rendered PDF saved
    # with this receipt; no name or party is reconstructed from an inference.
    decoded = decoded.replace("David Muka Traenkle", "David 'Muka' Traenkle")
    decoded = decoded.replace("0.23% TWENTY-THREE HUNDREDTHS OF ONE CENT PUBLIC", "0.23% (TWENTY-THREE HUNDREDTHS OF ONE CENT) PUBLIC")
    if "County Surveyor Vote for One There are no candidates for this office." not in decoded:
        raise ValueError("Missing explicit empty Surveyor office")
    directory = sources["co-official-counties"]
    public = gzip.decompress((COUNTY / directory["file"]).read_bytes())
    if hashlib.sha256(public).hexdigest() != directory["rawHash"] or b"clerkandrecorder.elpasoco.com" not in public:
        raise ValueError("Missing Colorado SOS official publisher link")
    source = {**source, "publisher": "El Paso County Clerk and Recorder",
        "reviewedEvidence": "Official November3,2026 master sample linked by clerkandrecorder.elpasoco.com/elections/election-information/. Colorado SOS .gov CountyElectionOffices directory explicitly links that official clerk site. Custom PDF font recovered by codepoint+29; five county office cells,every local retention question,and county1A were visually checked against saved rendered PDF excerpts. Commissioner districts and municipalities are not widened to the county. Surveyor has no candidate and is held separately."}
    return decoded, source


def el_paso_rows():
    text, source = el_paso_source()
    section = text.split("County Clerk and Recorder Vote for One")[1].split("Municipal Offices")[0]
    section = "County Clerk and Recorder Vote for One " + section
    pieces = re.split(r"(County Clerk and Recorder|County Treasurer|County Assessor|County Sheriff|County Surveyor|County Coroner) Vote for One ", section)
    rows = []
    for index in range(1, len(pieces), 2):
        office, contents = pieces[index], pieces[index + 1]
        if office == "County Surveyor":
            if contents.strip() != "There are no candidates for this office.":
                raise ValueError("Changed empty county office")
            continue
        for match in re.finditer(r"(.+?) (Republican|Democratic)(?: |$)", contents):
            rows.append({"office": office, "name": match[1].strip(), "party": match[2], "voteFor": 1,
                "quote": office + "\nVote for One\n" + match[0].strip()})
    if len(rows) != 8 or len({row["office"] for row in rows}) != 5:
        raise ValueError("Expected eight candidates in five occupied county offices")
    retentions = re.findall(r"Shall Judge ([A-Za-z][A-Za-z .'-]+?) of the (4th Judicial District|El Paso County Court) be retained in office\?", text)
    if len(retentions) != 10:
        raise ValueError("Expected all six district and four county retention decisions")
    for name, court in retentions:
        rows.append({"office": f"{court} — {name} — Retention", "name": name, "party": None, "voteFor": 1,
            "quote": f"Shall Judge {name} of the {court} be retained in office?"})
    if [name for name, _ in retentions] != ["William B. Bain", "Hilary Gurney", "Dennis L. McGuire", "Amanda J. Philipps", "Erin Lynn Sokol",
        "Gregory Robert Werner", "Sam Burney", "Marika Frady", "Meredith Patrick Cord", "Ann M. Rotolo"]:
        raise ValueError("Retention names differ from the visually checked official sample")
    return rows, source


def add_el_paso():
    rows, source = el_paso_rows()
    result = COMMON["import_candidates"]("co", "el_paso", rows, source)
    file = ROOT / "data/ballot/2026-general/co.json"
    package = json.loads(file.read_text())
    ballot = next(iter(package["ballots"].values()))
    provenance = {"sourceUrl": source["sourceUrl"], "sourceOrg": source["publisher"],
        "collectedAt": source["retrievedAt"], "verifiedAt": source["retrievedAt"]}
    surveyor_id = "co-el_paso-general-2026-county-surveyor"
    if not any(contest["id"] == surveyor_id for contest in ballot.setdefault("heldContests", [])):
        ballot["heldContests"].append({"id": surveyor_id, "electionId": ballot["election"]["id"],
            "ocdId": "ocd-division/country:us/state:co/county:el_paso", "title": "County Surveyor",
            "provenance": {**provenance, "quote": "County Surveyor\nVote for One\nThere are no candidates for this office."},
            "reason": "No candidate appears on the official sample ballot"})
    text, _ = el_paso_source()
    question = text.split("El Paso County Ballot Issue 1A ")[1].split("YES / FOR NO / AGAINST")[0].strip()
    if not question.startswith("WITHOUT RAISING ADDITIONAL TAXES") or not question.endswith("249?"):
        raise ValueError("Incomplete county ballot Issue1A")
    contest_id = "co-el_paso-general-2026-ballot-issue-1a"
    if not any(contest["id"] == contest_id for contest in ballot["contests"]):
        prov = {**provenance, "quote": question}
        ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
            "ocdId": "ocd-division/country:us/state:co/county:el_paso", "divisionVintage": "2026", "title": "El Paso County Ballot Issue 1A",
            "type": "MEASURE", "voteFor": None, "termYears": None, "measureTextUrl": source["sourceUrl"], "scopeNote": None, "provenance": prov})
        ballot["measures"].append({"id": contest_id + "#question", "contestId": contest_id, "officialNumber": "1A",
            "questionText": question, "officialStatement": None, "provenance": prov})
        ballot.setdefault("measureRecords", []).append({"contestId": contest_id, "whatItDoes": question, "yesMeans": None,
            "noMeans": None, "parts": [], "sourceUrl": source["sourceUrl"], "sourceHash": source["rawHash"],
            "sourceHashKind": "CAPTURE_BYTES", "writtenAt": source["retrievedAt"]})
        result["contestsAdded"] += 1
        result["measuresAdded"] = 1
    file.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")
    return result


if __name__ == "__main__":
    print(add_el_paso())
