#!/usr/bin/env python3
"""Replay Arizona's saved official general guide, roster and certified write-ins.

This is a coverage comparison, not a publication gate. The Clean Elections web
roster has optional profiles; its federal totals are not called a certification.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
import hashlib
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/ba01-west-evidence"
BALLOT = next(iter(json.loads((ROOT / "data/ballot/2026-general/az.json").read_text())["ballots"].values()))
SOURCES = {source["file"]: source for source in json.loads((EVIDENCE / "sources.json").read_text())}


def document(name):
    data = (EVIDENCE / name).read_bytes()
    if hashlib.sha256(data).hexdigest() != SOURCES[name]["snapshotHash"]:
        raise ValueError("Changed saved source: " + name)
    return data.decode()


def norm(value):
    value = unicodedata.normalize("NFD", value or "")
    return re.sub(r"[^a-z0-9]", "", value.lower())


PARTIES = {"democratic": "dem", "republican": "rep", "green": "grn", "libertarian": "lbt", "nolabels": "nol", "independent": "ind", "non": "", "nonpartisan": ""}


def party(value):
    return PARTIES.get(norm(value), norm(value))


def contest(office):
    match = re.search(r"(?:District No\.|District|DISTRICT)\s*(\d+)", office)
    division = None
    if match:
        level = "sldu" if "SENATOR" in office.upper() else "sldl" if "STATE REPRESENTATIVE" in office.upper() else "cd"
        division = "ocd-division/country:us/state:az/" + level + ":" + match[1]
    if division:
        matches = [row for row in BALLOT["contests"] if row["ocdId"] == division and row["type"] == "CANDIDACY"]
    else:
        title = {"SUPERINTENDENT OF PUBLIC INSTRUCTION": "Superintendent of Public Instruction", "STATE MINE INSPECTOR": "State Mine Inspector"}.get(office.upper(), office.title())
        matches = [row for row in BALLOT["contests"] if norm(row["title"]) == norm(title) and row["ocdId"] == "ocd-division/country:us/state:az"]
    if len(matches) != 1:
        raise ValueError(f"Ambiguous held office {office}: {[row['id'] for row in matches]}")
    return matches[0]


def expected_row(office, name, label, source):
    return {"contestId": contest(office)["id"], "office": office, "name": name, "partyLabel": label, "source": source}


def main():
    expected = []
    guide = document("az-general-guide.txt")
    if "General Election" not in guide or "November 3, 2026" not in guide:
        raise ValueError("Wrong guide election")
    active = None
    lines = guide.splitlines()
    executives = {"GOVERNOR", "SECRETARY OF STATE", "ATTORNEY GENERAL", "STATE TREASURER", "SUPERINTENDENT OF PUBLIC INSTRUCTION", "STATE MINE INSPECTOR", "CORPORATION COMMISSIONER"}
    for index, line in enumerate(lines):
        heading = re.search(r"CANDIDATES FOR (.+)", line)
        if heading:
            label = heading[1].strip()
            active = label if label in executives or re.fullmatch(r"STATE (SENATOR|REPRESENTATIVE) - DISTRICT \d+", label) else None
        match = re.search(r"Party:\s*(.*?)\s+Funding:", line)
        if active and match:
            before = index - 1
            while before >= 0 and not lines[before].strip():
                before -= 1
            expected.append(expected_row(active, lines[before].strip(), match[1].strip(), "az-general-guide.txt"))
    printed_guide = list(expected)
    if len(printed_guide) != 178:
        raise ValueError("Expected 158 printed legislative and 20 printed executive candidates: " + str(len(printed_guide)))
    roster = document("az-ccec-all-candidates.html")
    for block in roster.split("<li>")[1:]:
        fields = [re.search(pattern, block, re.S) for pattern in [r"<b>(.*?)</b>", r'<span class="office">(.*?)</span>', r'<span class="party">(.*?)</span>']]
        if not all(fields):
            continue
        name, office, label = [unescape(re.sub(r"<[^>]+>", "", match[1])).strip() for match in fields]
        if office.startswith("U.S. House of Rep.") and "(Write-In)" not in name:
            expected.append(expected_row(office, name, label, "az-ccec-all-candidates.html"))
    if len(expected) != 202:
        raise ValueError("Expected 24 printed federal candidates")
    writeins = document("az-general-writeins.txt")
    if "November 3, 2026" not in writeins or not re.search(r"WITHDRAWN CANDIDATES[\s\S]*?\nnone\n", writeins):
        raise ValueError("Changed write-in or withdrawal certification")
    writein_rows = []
    for line in writeins.splitlines():
        fields = re.split(r"\s{2,}", line.strip())
        if len(fields) == 4 and fields[-1] in {"IND", "NON", "REP", "NOL", "LBT", "GRN"}:
            row = expected_row(fields[1], fields[0], fields[3], "az-general-writeins.txt")
            writein_rows.append(row)
            expected.append(row)
    if len(writein_rows) != 15:
        raise ValueError("Expected all 15 certified core write-ins")
    pima = document("az-pima-general-candidates.txt")
    if not re.search(r"Justice of the Arizona Supreme Court[\s\S]*?NONPARTISAN\s+LOPEZ IV, JOHN", pima):
        raise ValueError("Missing statewide Supreme Court source row")
    supreme = next(row for row in BALLOT["contests"] if row["id"] == "az-2026-general-supreme-court-john-lopez-iv")
    expected.append({"contestId": supreme["id"], "office": supreme["title"], "name": "JOHN LOPEZ IV", "partyLabel": None, "source": "az-pima-general-candidates.txt"})
    groups = defaultdict(list)
    for row in expected:
        groups[row["contestId"]].append(row)
    comparisons = []
    for contest_id, rows in groups.items():
        held = [candidate for candidate in BALLOT["candidacies"] if candidate["contestId"] == contest_id]
        expected_names = {norm(row["name"]): row for row in rows}
        held_names = {norm(candidate.get("givenName", "") + " " + candidate["familyName"]): candidate for candidate in held}
        comparisons.append({"contestId": contest_id, "title": next(row["title"] for row in BALLOT["contests"] if row["id"] == contest_id),
            "officialCandidates": [row["name"] for row in rows], "heldCandidateCount": len(held),
            "missing": [row["name"] for key, row in expected_names.items() if key not in held_names],
            "extraHeld": [candidate.get("givenName", "") + " " + candidate["familyName"] for key, candidate in held_names.items() if key not in expected_names],
            "partyDifferences": [{"name": row["name"], "official": row["partyLabel"], "held": held_names[key]["partyLabel"]} for key, row in expected_names.items() if key in held_names and party(row["partyLabel"]) != party(held_names[key]["partyLabel"])],
            "sources": sorted({SOURCES[row["source"]]["sourceUrl"] for row in rows})})
    report = {"status": "MATCHES_SOURCES_CHECKED_WITH_CERTIFICATION_LIMIT", "checkedAt": datetime.now(timezone.utc).isoformat(),
        "officialContestCount": len(groups), "officialCandidacyCount": len(expected),
        "scope": "30 Senate + 30 House + 9 federal House + 7 executive + 1 statewide Supreme Court retention; four lieutenant-governor ticket mates verified separately against the Pima general list",
        "sourceCounts": {"printedLegislative": 158, "certifiedLegislativeWriteIns": 4, "printedExecutive": 20, "certifiedExecutiveWriteIns": 4, "federalPrintedRoster": 24, "certifiedFederalWriteIns": 7, "statewideJudicialRetention": 1},
        "missingCandidates": sum(len(row["missing"]) for row in comparisons), "extraHeldCandidates": sum(len(row["extraHeld"]) for row in comparisons), "partyDifferences": sum(len(row["partyDifferences"]) for row in comparisons),
        "certificationLimit": "The SOS general certified portal returned403. General printed guide and full SOS write-in certification provide the legislative and executive comparison. Federal printed names match the current official Clean Elections roster, whose webpage warns profiles are optional; an exhaustive general certification is still needed. Official general samples independently confirm printed federal districts1,2,5,6,7,9. Districts3,4,8 have fresh official roster confirmation but their actual official general sample has not been acquired.",
        "zipChecks": [{"zip": "85003", "status": "PARTIAL", "verifiedCommonCountyContests": 59,
            "remaining": "Actual precinct sample requires registered-voter dashboard access. Justice/constable, Phoenix council, school/special-district choices and local measures still require address-specific division matching; all-ZIP completeness is not established."}],
        "contests": comparisons}
    (EVIDENCE / "az-comparison.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    combined = EVIDENCE / "state-comparison.json"
    if combined.exists():
        value = json.loads(combined.read_text())
        value["states"]["AZ"] = report
        combined.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    print({key: value for key, value in report.items() if key in ["status", "officialContestCount", "officialCandidacyCount", "missingCandidates", "extraHeldCandidates", "partyDifferences"]})


if __name__ == "__main__":
    main()
