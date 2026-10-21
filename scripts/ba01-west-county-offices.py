#!/usr/bin/env python3
"""Import source-verified countywide offices, with no widened district matches."""
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone
import csv
import gzip
import hashlib
import io
import json
import re

import runpy

capture_sha256 = runpy.run_path(str(Path(__file__).with_name("ba01_evidence.py")))["capture_sha256"]

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/ba01-west-evidence"
COUNTY = EVIDENCE / "county-captures"
MANIFEST = {row["name"]: row for row in json.loads((COUNTY / "manifest.json").read_text())}


def snapshot(name):
    source = MANIFEST[name]
    raw = gzip.decompress((COUNTY / source["file"]).read_bytes())
    if capture_sha256(raw) != source["rawHash"]:
        raise ValueError("Changed raw source: " + name)
    data = (COUNTY / source["textSnapshot"]).read_bytes()
    if hashlib.sha256(data).hexdigest() != source["textHash"]:
        raise ValueError("Changed text snapshot: " + name)
    return data.decode(), source


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def import_candidates(state, county, rows, source):
    file = ROOT / f"data/ballot/2026-general/{state}.json"
    package = json.loads(file.read_text())
    ballot = next(iter(package["ballots"].values()))
    added_contests = added_candidates = 0
    for row in rows:
        contest_id = f"{state}-{county}-general-2026-{slug(row['office'])}"
        provenance = {"sourceUrl": source["sourceUrl"], "sourceOrg": source["publisher"],
            "collectedAt": source["retrievedAt"], "verifiedAt": source["retrievedAt"], "quote": row["quote"]}
        if not any(contest["id"] == contest_id for contest in ballot["contests"]):
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
                "ocdId": f"ocd-division/country:us/state:{state}/county:{county}", "divisionVintage": "2026",
                "title": row["office"], "type": "CANDIDACY", "voteFor": row.get("voteFor"), "termYears": None,
                "candidateListComplete": True, "scopeNote": None, "provenance": provenance})
            added_contests += 1
        candidate_id = contest_id + "-" + slug(row["name"])
        if not any(candidate["id"] == candidate_id for candidate in ballot["candidacies"]):
            ballot["candidacies"].append({"id": candidate_id, "contestId": contest_id, "familyName": row["name"],
                "givenName": "", "partyLabel": row["party"], "slogan": None, "incumbent": None, "websiteUrl": None,
                "provenance": provenance})
            added_candidates += 1
    checked = {"requestedUrl": source["sourceUrl"], "finalUrl": source["sourceUrl"], "httpStatus": 200,
        "rawHash": source["rawHash"], "retrievedAt": source["retrievedAt"], "publisher": source["publisher"],
        "sourceClass": "ELECTION_AUTHORITY", "reviewedEvidence": source["reviewedEvidence"], "reviewOutcome": "SUPPORTED"}
    existing = next((held for held in package["sourceReceipt"]["sources"] if held["rawHash"] == source["rawHash"] and
        held["retrievedAt"] == source["retrievedAt"] and source["sourceUrl"] in {held["requestedUrl"], held["finalUrl"]}), None)
    if existing:
        existing.update(checked)
    else:
        package["sourceReceipt"]["sources"].append(checked)
    package["sourceReceipt"]["reviewedAt"] = max([datetime.now(timezone.utc)] +
        [datetime.fromisoformat(row["retrievedAt"].replace("Z", "+00:00")) for row in package["sourceReceipt"]["sources"]]).isoformat()
    package["sourceReceipt"]["reviewedBy"] = "Codex BA-01 official county source replay"
    file.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")
    return {"state": state, "county": county, "contestsAdded": added_contests, "candidaciesAdded": added_candidates}


def clark_rows():
    text, source = snapshot("nv-clark-candidates")
    if "November 3 2026" not in text or "Clark County, Nevada" not in text:
        raise ValueError("Wrong Clark election")
    section = text.split("COUNTY PARTISAN")[1].split("STATE AND DISTRICT NONPARTISAN")[0]
    # The PDF merges each office cell vertically; names above and below the office
    # label belong to that same table cell. These six countywide cells were read
    # from pages4-5. Exact family/given/party rows must still replay below.
    cells = [
        ("District Attorney", [("Wolfson", "Steve", "DEM")]),
        ("County Assessor", [("Joe", "Judy", "REP"), ("Warren", "Lynette", "LPN"), ("Washington", "Tamicka N.", "DEM")]),
        ("County Clerk", [("Goya", "Lynn Marie", "DEM"), ("Shaw", "Howell", "REP"), ("Stamper", "George", "LPN")]),
        ("County Recorder", [("Borella", "Steven T.", "LPN"), ("Flanagan", "Tanya", "DEM"), ("Young", "Bill", "REP")]),
        ("County Treasurer", [("Diaz", 'J. "Ken"', "DEM"), ("Ferreira", 'Tim J. "TJ"', "LPN"), ("Tracy", "Mitchell T.", "REP")]),
        ("Public Administrator", [("Itkin-Goodman", "Stephanie", "DEM"), ("Murphy", "Michael", "REP")]),
    ]
    rows = []
    for office, names in cells:
        if office not in section:
            raise ValueError("Missing countywide office: " + office)
        for family, given, party in names:
            pattern = re.escape(family) + r"\s+" + r"\s+".join(re.escape(part) for part in given.split()) + r"\s+" + party + r"\b"
            match = re.search(pattern, section)
            if not match:
                raise ValueError("Unverified Clark candidate: " + given + " " + family)
            rows.append({"office": office, "name": given + " " + family, "party": party, "voteFor": 1,
                "quote": office + "\n" + match[0]})
    source = {**source, "publisher": "Clark County Election Department",
        "reviewedEvidence": "Official complete November3,2026 general contest/candidate table, pages4-5, COUNTY PARTISAN section. Six countywide offices and15 named candidates replayed against exact name/party rows; commissioner districts excluded."}
    return rows, source


def laramie_rows():
    text, source = snapshot("wy-laramie-county")
    if "2026 GENERAL ELECTION CANDIDATE ROSTER" not in text or "COUNTY OFFICES" not in text or "FINAL" not in text:
        raise ValueError("Wrong Laramie roster")
    offices = {"Assessor", "Clerk", "Clerk of District Court", "Commissioner", "Coroner", "District Attorney", "Sheriff", "Treasurer"}
    rows = []
    for line in text.splitlines():
        fields = re.split(r"\s{2,}", line.strip())
        if len(fields) >= 3 and fields[0] in offices and fields[1] in {"Republican", "Democratic"}:
            if re.search(r"\d{1,2}/\d{1,2}/\d{4}\s*$", line):
                continue
            rows.append({"office": fields[0], "name": fields[2], "party": fields[1],
                "voteFor": None if fields[0] == "Commissioner" else 1,
                "quote": "2026 GENERAL ELECTION CANDIDATE ROSTER — COUNTY OFFICES — FINAL\n" + " | ".join(fields[:3])})
    if len(rows) != 13 or len({row["office"] for row in rows}) != 8:
        raise ValueError("Expected all13 Laramie nominees across eight countywide offices")
    source = {**source, "publisher": "Laramie County Clerk Elections Office",
        "reviewedEvidence": "Official FINAL2026 general COUNTY OFFICES candidate roster. Parsed all13 candidates/eight offices, omitting private contact columns from published records. County commission vote count remains unknown until a sample supplies it."}
    return rows, source


def salt_lake_rows():
    text, source = snapshot("ut-saltlake-bt1")
    if "Tuesday, November 3, 2026" not in text or "Certified by the Clerk of Salt Lake County" not in text:
        raise ValueError("Wrong Salt Lake sample")
    # A -raw snapshot preserves each county candidate's party without the adjacent
    # judicial column. It is checked against the unchanged source PDF hash above.
    data = (COUNTY / source["rawTextSnapshot"]).read_bytes()
    if hashlib.sha256(data).hexdigest() != source["rawTextHash"]:
        raise ValueError("Changed Salt Lake raw extraction")
    raw = data.decode()
    section = raw.split("COUNTY COUNCIL AT-LARGE A")[1].split("Shall JILL M. POHLMAN")[0]
    active, rows = "County Council At-Large A", []
    titles = {"COUNTY DISTRICT ATTORNEY": "County District Attorney", "COUNTY AUDITOR": "County Auditor",
        "COUNTY CLERK": "County Clerk", "COUNTY SHERIFF": "County Sheriff"}
    for line in section.splitlines():
        if line in titles:
            active = titles[line]
        match = re.fullmatch(r"(.+) \((CON|DEM|REP|LIB|UNA|FWD)\)", line)
        if match:
            rows.append({"office": active, "name": match[1], "party": match[2], "voteFor": 1, "quote": active.upper() + "\nVote for One\n" + line})
    if len(rows) != 10 or len({row["office"] for row in rows}) != 5:
        raise ValueError("Expected all10 Salt Lake nominees across five countywide offices")
    source = {**source, "publisher": "Salt Lake County Clerk",
        "reviewedEvidence": "Official certified November3,2026 Salt Lake sample BT1. Five explicitly COUNTY offices apply countywide, including Council At-Large A. District and municipal contests are excluded. All10 printed names/parties and Vote for One replayed from complete PDF raw extraction."}
    return rows, source


def minnehaha_rows():
    captures = EVIDENCE / "captures"
    source = next(row for row in json.loads((captures / "manifest.json").read_text()) if row["file"] == "sd-export.gz")
    data = gzip.decompress((captures / source["file"]).read_bytes())
    if hashlib.sha256(data).hexdigest() != source["uncompressedHash"]:
        raise ValueError("Changed South Dakota export")
    offices = {"County Auditor", "Sheriff", "Register of Deeds", "County Commissioner At Large"}
    rows = []
    for row in csv.DictReader(io.StringIO(data.decode("utf-8-sig"))):
        if row["District/County"] == "Minnehaha" and row["Contest"] in offices and "(Withdrawn " not in row["Name"]:
            rows.append({"office": row["Contest"], "name": row["Name"], "party": row["Party"],
                "voteFor": None if row["Contest"] == "County Commissioner At Large" else 1,
                "quote": " | ".join(row[field] for field in ["Contest", "District/County", "Name", "Party"])})
    if len(rows) != 9 or len({row["office"] for row in rows}) != 4:
        raise ValueError("Expected all9 Minnehaha nominees across four countywide offices")
    source = {"sourceUrl": source["sourceUrl"], "rawHash": source["uncompressedHash"], "retrievedAt": source["retrievedOrExtractedAt"],
        "publisher": "South Dakota Secretary of State",
        "reviewedEvidence": "Complete official2026 general CSV export, Minnehaha county. Nine active candidates in four expressly countywide offices. Conservation district scope and commission vote count remain separate sample work; no electorate widened."}
    return rows, source


def salt_lake_bond():
    text, source = snapshot("ut-saltlake-bt1")
    question = re.search(r"Shall Salt Lake County, Utah, be authorized to issue general obligation bonds[\s\S]*?now outstanding\?", text)
    if not question or "FOR THE ISSUANCE OF BONDS" not in text or "AGAINST THE ISSUANCE OF BONDS" not in text:
        raise ValueError("Missing official county bond question/vote choices")
    question = re.sub(r"\s+", " ", question[0]).strip()
    file = ROOT / "data/ballot/2026-general/ut.json"
    package = json.loads(file.read_text())
    ballot = next(iter(package["ballots"].values()))
    contest_id = "ut-salt_lake-general-2026-special-bond-election"
    if any(contest["id"] == contest_id for contest in ballot["contests"]):
        held = next(measure for measure in ballot["measures"] if measure["contestId"] == contest_id)
        if "officialNumber" in held and held["officialNumber"] is None:
            del held["officialNumber"]
            file.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")
        return {"state": "ut", "measuresAdded": 0}
    provenance = {"sourceUrl": source["sourceUrl"], "sourceOrg": "Salt Lake County Clerk", "collectedAt": source["retrievedAt"],
        "verifiedAt": source["retrievedAt"], "quote": question + "\nFOR THE ISSUANCE OF BONDS\nAGAINST THE ISSUANCE OF BONDS"}
    ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
        "ocdId": "ocd-division/country:us/state:ut/county:salt_lake", "divisionVintage": "2026",
        "title": "Salt Lake County — Special Bond Election", "type": "MEASURE", "voteFor": None, "termYears": None,
        "measureTextUrl": source["sourceUrl"], "scopeNote": None, "provenance": provenance})
    ballot["measures"].append({"id": contest_id + "#question", "contestId": contest_id,
        "questionText": question, "officialStatement": None, "provenance": provenance})
    ballot.setdefault("measureRecords", []).append({"contestId": contest_id, "whatItDoes": question, "yesMeans": None,
        "noMeans": None, "parts": [], "sourceUrl": source["sourceUrl"], "sourceHash": source["rawHash"],
        "sourceHashKind": "CAPTURE_BYTES", "writtenAt": source["retrievedAt"]})
    file.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")
    return {"state": "ut", "measuresAdded": 1}


if __name__ == "__main__":
    for state, county, parser in [("nv", "clark", clark_rows), ("wy", "laramie", laramie_rows),
        ("ut", "salt_lake", salt_lake_rows), ("sd", "minnehaha", minnehaha_rows)]:
        rows, source = parser()
        print(import_candidates(state, county, rows, source))
    print(salt_lake_bond())
