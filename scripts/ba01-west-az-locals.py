#!/usr/bin/env python3
"""Add complete official Pima countywide and Maricopa municipal ballot choices."""
from datetime import datetime, timezone
from pathlib import Path
import gzip
import hashlib
import json
import re
import runpy
import os

ROOT = Path(os.environ.get("BA01_WEST_ROOT", Path(__file__).resolve().parents[1]))
EVIDENCE = ROOT / "data/ballot/ba01-west-evidence"
COMMON = runpy.run_path(str(ROOT / "scripts/ba01-west-court-county.py"))


def held_snapshot(filename):
    source = next(row for row in json.loads((EVIDENCE / "sources.json").read_text()) if row["file"] == filename)
    text = (EVIDENCE / filename).read_bytes()
    assert hashlib.sha256(text).hexdigest() == source["snapshotHash"]
    return text.decode(), source


def local_snapshot(name):
    directory = Path(os.environ.get("BA01_WEST_AZ_LOCAL_CAPTURES", EVIDENCE / "az-local-captures"))
    source = next(row for row in json.loads((directory / "manifest.json").read_text()) if row["name"] == name)
    raw = gzip.decompress((directory / source["file"]).read_bytes())
    text = (directory / source["textSnapshot"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == source["rawHash"]
    assert hashlib.sha256(text).hexdigest() == source["textHash"]
    return text.decode(), source


def pima_rows():
    text, source = held_snapshot("az-pima-general-candidates.txt")
    assert "General Election-November 3, 2026" in text and "UPDATED: 9/9/2026" in text
    clerk = re.search(r"Clerk of the Superior Court.*?DEM\s+(GIACOMINO, JAMES W\.)", text, re.S)
    assert clerk and "Vote for not more than 1" in clerk[0]
    rows = [{"office": "Clerk of the Superior Court", "name": clerk[1], "party": "DEM", "retention": False,
        "quote": "Clerk of the Superior Court\nVote for not more than 1\nDEM " + clerk[1]}]
    appeals = text.split("Judge of the Court of Appeals Division II")[1].split("UPDATED:")[0]
    judges = list(re.finditer(r"NONPARTISAN\s+([^\r\n]+)", appeals))
    assert len(judges) == 3
    for judge in judges:
        name = judge[1].strip()
        rows.append({"office": f"Court of Appeals, Division II — {name} — Retention", "name": name,
            "party": "NONPARTISAN", "retention": True, "quote": "Judge of the Court of Appeals Division II\n" + judge[0]})
    superior = text.split("Judge of the Superior Court")[1].split("Nonpartisan Contests")[0]
    judges = list(re.finditer(r"NONPARTISAN\s+([^\r\n]+?) - DIVISION (\d+)", superior))
    assert len(judges) == 10
    retention, _ = local_snapshot("az-2026-retention-judges")
    assert "2026 RETENTION JUDGES" in retention and "PIMA COUNTY SUPERIOR COURT" in retention
    for judge in judges:
        name, division = judge[1].strip(), judge[2]
        assert name.split(",")[0] in retention.upper()
        rows.append({"office": f"Pima County Superior Court, Division {division} — {name} — Retention", "name": name,
            "party": "NONPARTISAN", "retention": True, "quote": "Judge of the Superior Court\n" + judge[0]})
    writeins, _ = local_snapshot("az-pima-qualified-writeins")
    assert "GENERAL ELECTION - NOVEMBER 3, 2026" in writeins
    assert not re.search(r"CLERK|SUPERIOR COURT|APPEALS", writeins)
    assert len(rows) == 14
    return rows, source


def add_pima(package):
    rows, source = pima_rows()
    for row in rows:
        identifier = "az-pima-general-2026-" + COMMON["slug"](row["office"])
        COMMON["race"](package, identifier, row["office"], "ocd-division/country:us/state:az/county:pima",
            [(row["name"], row["party"])], source, "Pima County Elections Department", row["quote"], row["retention"])
    COMMON["receipt"](package, source, "Pima County Elections Department", "Complete September9 general candidate list: clerk and all3AppealsDivisionII/10PimaSuperiorCourt judicial choices; Pima electorate remains county-specific.")
    for filename in ["az-pima-qualified-writeins"]:
        _, source = local_snapshot(filename)
        COMMON["receipt"](package, source, "Pima County Elections Department", "Complete general qualified write-in list has no clerk, superior or appeals write-ins.")
    _, source = local_snapshot("az-2026-retention-judges")
    COMMON["receipt"](package, source, "Arizona Judicial Branch", "Official2026RetentionJudges list independently identifies all10PimaSuperiorCourt judges as retention choices.", "OFFICIAL_PUBLISHER")
    text, source = local_snapshot("az-appeals-retention-electorates")
    assert "elected from Pima county" in text and "excluding Pima county" in text
    COMMON["receipt"](package, source, "Arizona Legislature", "ARS12-120.02 explicitly separates Pima from the otherDivisionII county electorates and Maricopa from otherDivisionI counties; county sample assignments are not widened.", "OFFICIAL_PUBLISHER")


def scottsdale_rows():
    text, source = held_snapshot("az-scottsdale-sample.txt")
    section = text.split("COUNCILMEMBER\n")[1].split("Retain:")[0]
    assert "VOTE FOR NOT MORE THAN 2" in section
    names = re.findall(r"^([^\r\n]+), ([^\r\n]+)$", section, re.M)
    names = [family + ", " + given for family, given in names]
    assert names == ["GRAHAM, BARRY", "UGENTI-RITA, MICHELLE", "ZUBIA, RAOUL"]
    writeins, _ = held_snapshot("az-maricopa-writeins.txt")
    assert "**End of List." in writeins and "CITY OF SCOTTSDALE" not in writeins
    return names, "CITY OF SCOTTSDALE\nCOUNCILMEMBER\n" + section.strip(), source


def add_scottsdale(package):
    names, quote, source = scottsdale_rows()
    identifier = "az-scottsdale-general-2026-councilmember"
    COMMON["race"](package, identifier, "City of Scottsdale — Councilmember", "ocd-division/country:us/state:az/place:scottsdale",
        [(name, None) for name in names], source, "City of Scottsdale — official Maricopa County sample ballot", quote)
    ballot = next(iter(package["ballots"].values()))
    next(row for row in ballot["contests"] if row["id"] == identifier)["voteFor"] = 2
    COMMON["receipt"](package, source, "City of Scottsdale", "Official November3 general sample lists all3citywide Councilmember candidates and vote-for-two instruction. Complete county write-in list has no Scottsdale candidate.")


def peoria_rows():
    text, source = local_snapshot("az-peoria-pamphlet")
    assert "November 3, 2026" in text and "CITY OF PEORIA DISTRICT SEATS AS THEY WILL APPEAR ON THE BALLOT" in text
    section = text.split("MAYOR – AT LARGE")[1].split("COUNCILMEMBER – ACACIA DISTRICT")[0]
    assert "VOTE FOR NOT MORE THAN 1" in section
    names = re.findall(r"^\s+([A-Z]+, [A-Z]+)\s*$", section, re.M)
    assert names == ["FINN, MICHAEL", "MILLER, ART"]
    writeins, _ = held_snapshot("az-maricopa-writeins.txt")
    assert "**End of List." in writeins
    assert "MAYOR" not in writeins
    return names, section.strip(), source


def municipal_measure(package, place, number, title, question, yes, no, source, publisher):
    ballot = next(iter(package["ballots"].values()))
    identifier = f"az-{place}-general-2026-proposition-{number}"
    proof = COMMON["provenance"](source, publisher, question + "\n" + yes + "\n" + no)
    COMMON["add"](package, "contests", {"id": identifier, "electionId": ballot["election"]["id"],
        "ocdId": f"ocd-division/country:us/state:az/place:{place}", "divisionVintage": "2026", "title": title,
        "type": "MEASURE", "voteFor": None, "termYears": None, "measureTextUrl": source["sourceUrl"], "scopeNote": None, "provenance": proof})
    COMMON["add"](package, "measures", {"id": identifier + "#question", "contestId": identifier, "officialNumber": number,
        "questionText": question, "officialStatement": None, "provenance": proof})
    if not any(row["contestId"] == identifier for row in ballot.setdefault("measureRecords", [])):
        ballot["measureRecords"].append({"contestId": identifier, "whatItDoes": question, "yesMeans": yes, "noMeans": no,
            "parts": [], "sourceUrl": source["sourceUrl"], "sourceHash": source["rawHash"], "sourceHashKind": "CAPTURE_BYTES", "writtenAt": source["retrievedAt"]})


def add_peoria(package):
    names, section, source = peoria_rows()
    COMMON["race"](package, "az-peoria-general-2026-mayor", "City of Peoria — Mayor", "ocd-division/country:us/state:az/place:peoria",
        [(name, None) for name in names], source, "City of Peoria City Clerk", "MAYOR – AT LARGE\n" + section)
    text, _ = local_snapshot("az-peoria-pamphlet")
    section = text.split("TEXT TO APPEAR ON BALLOT")[1].split("CITY OF PEORIA DISTRICT SEATS")[0]
    question = section.split("QUESTION:")[1].split('A "YES"')[0]
    yes = 'A "YES"' + section.split('A "YES"')[1].split('A "NO"')[0]
    no = 'A "NO"' + section.split('A "NO"')[1].split("YES")[0]
    question, yes, no = [re.sub(r"\s+", " ", part).strip() for part in [question, yes, no]]
    assert question.startswith("Shall the proposed Franchise Agreement") and question.endswith("future annexations.")
    municipal_measure(package, "peoria", "417", "City of Peoria — Proposition 417", question, yes, no, source, "City of Peoria City Clerk")
    COMMON["receipt"](package, source, "City of Peoria City Clerk", "Official November3 general publicity pamphlet/ballot text: both at-large mayor candidates and complete Proposition417 question/YES/NO meanings. District council candidates excluded.")


def add_tempe(package):
    text, source = local_snapshot("az-tempe-pamphlet")
    assert "Tuesday, November 3, 2026" in text
    section = text.split("FULL TEXT\n")[1].split("[At the discretion")[0]
    question = section.split("OFFICIAL TITLE:")[1].split("A “YES” vote")[0]
    yes = "A “YES” vote" + section.split("A “YES” vote")[1].split("A “NO” vote")[0]
    no = "A “NO” vote" + section.split("A “NO” vote")[1].split("YES")[0]
    question, yes, no = [re.sub(r"\s+", " ", part).strip() for part in [question, yes, no]]
    question = "OFFICIAL TITLE: " + question
    assert "January 1, 2027" in question and "five-tenths of one percent (0.5%)" in question
    assert "0.3%" in question and "0.1%" in question and "1.8 percent" in question
    municipal_measure(package, "tempe", "424", "City of Tempe — Proposition 424", question, yes, no, source, "City of Tempe City Clerk")
    COMMON["receipt"](package, source, "City of Tempe City Clerk", "Official November3 special election publicity pamphlet FULLTEXT sample ballot page7: complete Proposition424 official/descriptive text and both vote meanings. Advocacy arguments excluded.")


def import_locals():
    file = ROOT / "data/ballot/2026-general/az.json"
    package = json.loads(file.read_text())
    ballot = next(iter(package["ballots"].values()))
    fields = ["contests", "candidacies", "measures"]
    before = {key: {row["id"]: row for row in ballot[key]} for key in fields}
    for parser in [add_pima, add_scottsdale, add_peoria, add_tempe]:
        parser(package)
    for key in fields:
        current = {row["id"]: row for row in ballot[key]}
        assert all(current.get(identifier) == row for identifier, row in before[key].items()), key
    package["sourceReceipt"]["reviewedAt"] = max([datetime.now(timezone.utc)] + [datetime.fromisoformat(row["retrievedAt"].replace("Z", "+00:00")) for row in package["sourceReceipt"]["sources"]]).isoformat()
    package["sourceReceipt"]["reviewedBy"] = "Codex BA-01 official Arizona local ballot replay"
    file.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")
    return {key + "Added": len(ballot[key]) - len(before[key]) for key in fields}


if __name__ == "__main__":
    print(import_locals())
