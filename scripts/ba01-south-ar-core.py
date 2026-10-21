"""Replay complete legislative candidate blocks from official county ballots.

Existing verified rows remain. A district appearing in multiple county styles
has one contest, with the same candidate names/parties checked across repeats.
"""
from pathlib import Path
from collections import defaultdict
import hashlib
import json
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-south/ar-core"
state_file = ROOT / "data/ballot/2026-general/ar.json"
data = json.loads(state_file.read_text())
ballot = data["ballots"]["AR:ar-2026-11-03-general"]
added_contests = added_candidates = 0


def normalize(value):
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def add_source(stem, publisher, contests):
    global added_contests, added_candidates
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    for chamber, district, candidates, quote, term in contests:
        assert candidates
        ocd = "ocd-division/country:us/state:ar/" + chamber + ":" + str(int(district))
        prior = [row for row in ballot["contests"] if row["ocdId"] == ocd and row["type"] == "CANDIDACY"]
        assert len(prior) <= 1
        title = ("State Senate" if chamber == "sldu" else "State Representative") + ", District " + str(int(district))
        provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": publisher,
                      "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"], "quote": quote}
        cid = prior[0]["id"] if prior else "ar-ba01-2026-" + chamber + "-" + str(int(district))
        if not prior:
            ballot["contests"].append({"id": cid, "electionId": ballot["election"]["id"], "ocdId": ocd,
                "divisionVintage": "2026", "title": title, "type": "CANDIDACY", "voteFor": 1 if "Vote for One" in quote else None,
                "termYears": term, "scopeNote": None, "candidateListComplete": True, "provenance": provenance})
            added_contests += 1
        held_names = {normalize(row["givenName"] + " " + row["familyName"]) for row in ballot["candidacies"] if row["contestId"] == cid}
        for name, party in candidates:
            if normalize(name) in held_names:
                continue
            assert re.sub(r"\s+", " ", name) in re.sub(r"\s+", " ", quote)
            ballot["candidacies"].append({"id": cid + "-" + slug(name), "contestId": cid,
                "familyName": name, "givenName": "", "partyLabel": party, "slogan": None,
                "incumbent": None, "websiteUrl": None, "provenance": provenance})
            added_candidates += 1
    receipt = {"requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "retrievedAt": meta["retrievedAt"],
        "httpStatus": meta["httpStatus"], "rawHash": meta["sha256"], "publisher": publisher,
        "sourceClass": "ELECTION_AUTHORITY", "reviewOutcome": "SUPPORTED",
        "reviewedEvidence": "Saved official November 3, 2026 county election publication. scripts/ba01-south-ar-core.py replays complete legislative office/district/name/party blocks and deduplicates repeated ballot styles; existing verified rows remain."}
    if not any(row.get("finalUrl") == receipt["finalUrl"] and row.get("rawHash") == receipt["rawHash"] for row in data["sourceReceipt"]["sources"]):
        data["sourceReceipt"]["sources"].append(receipt)
    data["sourceReceipt"]["reviewedAt"] = max(data["sourceReceipt"]["reviewedAt"], meta["retrievedAt"])


def garland():
    stem = "garland-samples"
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    pdf = EVIDENCE / (stem + ".pdf")
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == meta["sha256"]
    source = subprocess.check_output(["pdftotext", "-raw", str(pdf), "-"], text=True)
    assert source == (EVIDENCE / (stem + ".txt")).read_text()
    assert "GARLAND COUNTY, ARKANSAS - NOVEMBER 3, 2026" in source
    groups = {}
    pattern = r"STATE (SENATE|REPRESENTATIVE)\nDISTRICT (\d+)\n(2|4) Year Term\nVote for One\n(.*?)(?=\n(?:STATE OFFICES|COUNTY OFFICES|UNOPPOSED|STATE SENATE|STATE REPRESENTATIVE|Review|COUNTY|MUNICIPAL|WATER DISTRICT|FEDERAL OFFICES))"
    for match in re.finditer(pattern, source, re.S):
        block = match[4].splitlines()
        names = [(block[index - 1], line) for index, line in enumerate(block) if line in
                 {"REPUBLICAN", "DEMOCRATIC", "LIBERTARIAN", "INDEPENDENT"}]
        assert names
        key = ("sldu" if match[1] == "SENATE" else "sldl", str(int(match[2])))
        if key in groups:
            assert groups[key][2] == names
        else:
            groups[key] = (*key, names, match[0], int(match[3]))
    assert set(groups) == {("sldu", "7"), ("sldl", "84"), ("sldl", "85"), ("sldl", "89"), ("sldl", "90"), ("sldl", "91")}
    # The official county government links this election commission domain.
    linking = (EVIDENCE / "garland.html").read_text()
    assert "GARLANDCOUNTYVOTE.ORG" in linking
    add_source(stem, "Garland County Election Commission", groups.values())


def saline():
    stem = "saline-general-notice"
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    pdf = EVIDENCE / (stem + ".pdf")
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == meta["sha256"]
    source = subprocess.check_output(["pdftotext", "-raw", str(pdf), "-"], text=True)
    assert source == (EVIDENCE / (stem + ".txt")).read_text()
    assert "Notice of General Election\nNovember 3, 2026\nSaline County, Arkansas" in source
    section = source.split("State Senate District 07", 1)[1].split("\nCounty\nCircuit Clerk", 1)[0]
    section = "State Senate District 07" + section
    matches = list(re.finditer(r"State (Senate|Representative) (?:District )?(\d+)\n", section))
    groups = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(section)
        block = section[match.start():end]
        names = []
        for candidate in re.finditer(r"(?m)^(.+) \(([RDLI])\)$", block):
            name = re.sub(r"^(?:State Senator|State Representative|Sheriff) ", "", candidate[1])
            names.append((name, candidate[2]))
        assert names
        groups.append(("sldu" if match[1] == "Senate" else "sldl", match[2], names, block, None))
    assert len(groups) == 9
    add_source(stem, "Saline County Election Commission", groups)


def stone():
    stem = "stone-samples"
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    pdf = EVIDENCE / (stem + ".pdf")
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == meta["sha256"]
    source = subprocess.check_output(["pdftotext", "-raw", str(pdf), "-"], text=True)
    assert source == (EVIDENCE / (stem + ".txt")).read_text()
    assert "Stone County, Arkansas - November 3, 2026" in source
    groups = {}
    pattern = r"State (Senate|Representative) District (\d+)\nVote for One\n(.*?)(?=\n(?:State Senate District|State Representative District|Nonpartisan Judicial Runoff Election|County|Unopposed Candidates))"
    for match in re.finditer(pattern, source, re.S):
        lines = match[3].splitlines()
        candidates = []
        name_lines = []
        for line in lines:
            if line in {"Republican", "Democratic", "Independent", "Libertarian"}:
                name = re.sub(r"^(?:State Representative|Senator) ", "", " ".join(name_lines))
                candidates.append((name, line))
                name_lines = []
            elif line.strip():
                name_lines.append(line.strip())
        assert candidates
        key = ("sldu" if match[1] == "Senate" else "sldl", str(int(match[2])))
        if key in groups:
            assert groups[key][2] == candidates
        else:
            groups[key] = (*key, candidates, match[0], None)
    assert set(groups) == {("sldu", "24"), ("sldl", "27"), ("sldl", "28"), ("sldl", "41")}
    # Correct the first pass's wrapped-name extraction while retaining its ID.
    # The printed district 27 name occupies two lines before the party label.
    assert groups[("sldl", "27")][2] == [("Steven Walker", "Republican")]
    for row in ballot["candidacies"]:
        if row["id"] == "ar-ba01-2026-sldl-27-walker":
            assert row["familyName"] in {"Walker", "Steven Walker"}
            row["familyName"] = "Steven Walker"
    add_source(stem, "Stone County Election Commission", groups.values())


def white():
    stem = "white-notice"
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    document = EVIDENCE / (stem + ".docx")
    assert hashlib.sha256(document.read_bytes()).hexdigest() == meta["sha256"]
    xml = ET.fromstring(zipfile.ZipFile(document).read("word/document.xml"))
    source = "\n".join("".join(node.itertext()) for node in xml.findall(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"))
    assert source == (EVIDENCE / (stem + ".txt")).read_text()
    assert "2026 General Election will be held on November 3, 2026" in source
    match = re.search(r"State Representative District (58)\n(.*?)\nCounty Candidates", source, re.S)
    assert match
    candidates = [(re.sub(r"^State Represetative ", "", row[1]), row[2])
                  for row in re.finditer(r"(?m)^(.+) \(([RDLI])\)$", match[2])]
    assert len(candidates) == 2
    add_source(stem, "White County Election Commission", [("sldl", match[1], candidates, match[0], None)])


def marion():
    stem = "marion-general-notice"
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    document = EVIDENCE / (stem + ".pdf")
    assert hashlib.sha256(document.read_bytes()).hexdigest() == meta["sha256"]
    source = subprocess.check_output(["pdftotext", "-raw", str(document), "-"], text=True)
    assert source == (EVIDENCE / (stem + ".txt")).read_text()
    assert "ELECTION will be held on November 3rd, 2026" in source
    match = re.search(r"State Representative District (04) State Representative (.+) (Republican)\n", source)
    assert match
    add_source(stem, "Marion County Election Commission", [("sldl", match[1], [(match[2], match[3])], match[0], None)])


def crawford():
    stem = "crawford-state-list"
    meta = json.loads((EVIDENCE / (stem + ".source.json")).read_text())
    document = EVIDENCE / (stem + ".pdf")
    assert hashlib.sha256(document.read_bytes()).hexdigest() == meta["sha256"]
    source = subprocess.check_output(["pdftotext", "-raw", str(document), "-"], text=True)
    assert source == (EVIDENCE / (stem + ".txt")).read_text()
    assert "https://crawford-county-elections.org" in (EVIDENCE / "crawford-clerk.html").read_text()
    assert "26-ge-state-list.pdf" in (EVIDENCE / "crawford-general.html").read_text()
    # The linked general-election state-office table contains the full candidate
    # blocks for these two newly acquired House districts. District 48 is held.
    groups = defaultdict(list)
    quotes = defaultdict(list)
    for match in re.finditer(r"(?m)^Crawford State Representative District (24|25) (.+) (DEM|REP|LIB)$", source):
        name = re.sub(r"^State Representative ", "", match[2])
        groups[match[1]].append((name, match[3]))
        quotes[match[1]].append(match[0])
    assert set(groups) == {"24", "25"}
    assert all(len(rows) == 2 for rows in groups.values())
    add_source(stem, "Crawford County Election Commission", [("sldl", district, names, "\n".join(quotes[district]), None)
               for district, names in groups.items()])


garland()
saline()
stone()
white()
marion()
crawford()
upper = {int(row["ocdId"].rsplit(":", 1)[1]) for row in ballot["contests"] if "/sldu:" in row["ocdId"]}
lower = {int(row["ocdId"].rsplit(":", 1)[1]) for row in ballot["contests"] if "/sldl:" in row["ocdId"]}
missing_upper = sorted({2, 7, 9, 10, 11, 13, 14, 15, 16, 21, 24, 27, 28, 30, 31, 32, 35} - upper)
missing_lower = sorted(set(range(1, 101)) - lower)
ballot["coverageNotes"][0] = "The November general-election candidates held here come from official county notices and sample ballots. The Secretary of State candidate-search banner remains labeled ‘2026 Preferential Primary and Nonpartisan Judicial General Election’; its public API returned no rows in the routes checked. The full statewide certified November candidate list remains unacquired."
ballot["coverageNotes"][1] = ("All four U.S. House districts are held. Regular 2026 State Senate districts still unacquired: " + ", ".join(map(str, missing_upper)) +
    ". State House districts still unacquired: " + ", ".join(map(str, missing_lower)) + ". Later special-election additions remain unverified. Local district coverage remains incomplete.")
state_file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"state": "AR", "added_contests": added_contests, "added_candidates": added_candidates,
    "missing_regular_senate": missing_upper, "missing_regular_house": missing_lower,
    "contests": len(ballot["contests"]), "candidacies": len(ballot["candidacies"])}))
