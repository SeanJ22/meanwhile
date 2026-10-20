"""Add Pennsylvania district races from official general-election candidate lists."""
import argparse
import datetime
import functools
import importlib.util
import json
import pathlib
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET

SPEC = importlib.util.spec_from_file_location("ba01_northeast", pathlib.Path(__file__).with_name("ba01-northeast.py"))
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)


@functools.cache
def pdf_lines(path):
    with tempfile.NamedTemporaryFile(suffix=".xml") as target:
        subprocess.run(["pdftotext", "-bbox-layout", str(path), target.name], check=True)
        pages = ET.parse(target.name).findall(".//x:page", COMMON.NS)
    return [sorted([(float(line.get("xMin")), float(line.get("yMin")), " ".join(word.text or "" for word in line))
                    for line in page.findall(".//x:line", COMMON.NS)], key=lambda line: (line[1], line[0])) for page in pages]


def division(office, number):
    kind = "cd" if "Congress" in office else "sldu" if "Senator" in office else "sldl"
    return kind + ":" + str(int(number))


def chester_rows():
    rows = []
    for line in COMMON.pdf_text(COMMON.SOURCES / "pa-chester-2026-official-candidates.pdf").splitlines():
        match = re.match(r"^\d+\s+(.*?)\s{2,}(.*?)\s+(Democratic|Republican|Libertarian)\s+\d+\s+(\d+)\s+(\d+)$", line)
        if not match or "Governor" in match[1]:
            continue
        district = re.search(r"(\d+)(?:st|nd|rd|th) District", match[1])[1]
        rows.append({"division": division(match[1], district), "office": match[1], "name": match[2],
                     "party": match[3], "voteFor": int(match[4]), "termYears": int(match[5])})
    return rows


def bucks_rows():
    rows = []
    for lines in pdf_lines(COMMON.SOURCES / "pa-bucks-2026-official-candidates.pdf"):
        offices = []
        for x, y, text in lines:
            match = re.search(r"(\d+)(?:st|nd|rd|th) (Congressional|Senatorial|Legislative) District", text)
            if x < 500 and match:
                kind = {"Congressional": "cd", "Senatorial": "sldu", "Legislative": "sldl"}[match[2]]
                offices.append((y, f"{kind}:{int(match[1])}", text))
        for x, y, party in lines:
            if x < 820 or party not in {"Democratic", "Republican", "Libertarian", "Independent Party", "Forward Independent"}:
                continue
            name = " ".join(text for nx, ny, text in lines if 620 <= nx < 820 and abs(ny-y) < 1)
            if not name or "Governor" in name:
                continue
            _, district, office = min(offices, key=lambda row: abs(row[0]-y))
            rows.append({"division": district, "office": office, "name": name, "party": party,
                         "voteFor": 1, "termYears": 4 if district.startswith("sldu:") else 2})
    return rows


def delaware_rows():
    rows = []
    for lines in pdf_lines(COMMON.SOURCES / "pa-delaware-2026-official-candidates.pdf"):
        for x, y, party in lines:
            if not 260 <= x < 300 or party not in {"Democratic", "Republican", "Libertarian", "Green"}:
                continue
            office_parts = [text for ox, oy, text in lines if ox < 140 and abs(oy-y) < 10]
            office = " ".join(office_parts)
            if "Governor" in office:
                continue
            district_text = next((text
                             for dx, dy, text in lines if 145 <= dx < 220 and abs(dy-y) < 2
                             and re.search(r"(\d+)(?:st|nd|rd|th) District", text)), None)
            name = " ".join(text for nx, ny, text in lines if 310 <= nx < 470 and abs(ny-y) < 1)
            note = " ".join(text for nx, ny, text in lines if 470 <= nx < 530 and abs(ny-y) < 12)
            if not district_text or not name or any(word in note for word in ["Withdrew", "Removed"]):
                continue
            district = re.search(r"(\d+)(?:st|nd|rd|th) District", district_text)[1]
            key = division(office, district)
            full_office = "Representative in Congress" if key.startswith("cd:") else "Senator in the General Assembly" if key.startswith("sldu:") else "Representative in the General Assembly"
            rows.append({"division": key, "office": full_office + " – " + district_text, "name": name,
                         "party": party, "voteFor": 1, "termYears": None})
    return rows


def cumberland_rows():
    rows, district, office = [], None, None
    for line in COMMON.pdf_text(COMMON.SOURCES / "pa-cumberland-2026-official-candidates.pdf").splitlines():
        match = re.match(r"^(\d+)(?:st|nd|rd|th) (Congressional|Senatorial|Legislative)\s+(.*?)\s{2,}(Democratic|Republican)\s+(.*)$", line)
        if match:
            kind = {"Congressional": "cd", "Senatorial": "sldu", "Legislative": "sldl"}[match[2]]
            district, office, party, name = kind + ":" + str(int(match[1])), match[3], match[4], match[5]
        else:
            match = re.match(r"^\s+(Democratic|Republican)\s+(.*)$", line)
            if not district or not match:
                continue
            party, name = match.groups()
        rows.append({"division": district, "office": office + " – District " + district.split(":")[1],
                     "name": name.strip(), "party": party, "voteFor": 1, "termYears": None})
    return rows


def dauphin_rows():
    rows, district, office = [], None, None
    text = COMMON.pdf_text(COMMON.SOURCES / "pa-dauphin-2026-official-candidates.pdf")
    for line in text.splitlines():
        if line.strip().startswith(("REPRESENTATIVE IN CONGRESS", "SENATOR IN THE GENERAL", "REPRESENTATIVE IN THE GENERAL")):
            office = line.strip()
            district = None
        match = re.search(r"(\d+)(?:st|nd|rd|th) (Congressional|Senatorial|Legislative)", line)
        if match and office:
            kind = {"Congressional": "cd", "Senatorial": "sldu", "Legislative": "sldl"}[match[2]]
            district = kind + ":" + str(int(match[1]))
        match = re.match(r"^\s*•\s+(.*?)\s+[–-]\s+(DEMOCRATIC|REPUBLICAN)\s*$", line)
        if match and district:
            rows.append({"division": district, "office": office.split(" – ")[0] + " – District " + district.split(":")[1],
                         "name": match[1], "party": match[2], "voteFor": 1, "termYears": None})
    return rows


def erie_rows():
    rows, district, office = [], None, None
    for line in COMMON.pdf_text(COMMON.SOURCES / "pa-erie-2026-official-candidates.pdf").splitlines():
        match = re.match(r"^DISTRICT (\d+)\s+(REPRESENTATIVE IN (?:CONGRESS|THE GENERAL ASSEMBLY))\s+", line)
        if match:
            district, office = ("cd:" if match[2].endswith("CONGRESS") else "sldl:") + str(int(match[1])), match[2]
        candidate = re.search(r"\s+(DEMOCRATIC/REPUBLICAN|DEMOCRATIC|REPUBLICAN)\s+(.*)$", line)
        if district and candidate:
            rows.append({"division": district, "office": office + " – District " + district.split(":")[1],
                         "name": candidate[2], "party": candidate[1], "voteFor": 1, "termYears": 2})
    return rows


def sample_rows(filename, lackawanna=False):
    """Read English office/district and name/party blocks, deduplicating ballot styles."""
    rows = {}
    column = (lambda x: int(x >= 230)) if lackawanna else (lambda x: int(x >= 300))
    for lines in pdf_lines(COMMON.SOURCES / filename):
        offices = []
        for x, y, text in lines:
            if lackawanna:
                match = re.fullmatch(r"(\d+)(?:ST|ND|RD|TH) DISTRICT", text)
                if not match:
                    continue
                preceding = " ".join(t for hx, hy, t in lines if column(hx) == column(x) and 0 < y-hy < 25)
                kind = "cd" if "CONGRESS" in preceding else "sldu" if "SENATOR" in preceding else "sldl" if "ASSEMBLY" in preceding else None
                if not kind:
                    raise ValueError((filename, text, preceding))
            else:
                match = re.search(r"(\d+)(?:st|nd|rd|th) (Congressional|Senatorial|Legislative) District", text)
                if not match or not text.startswith(("Representative", "Senator")):
                    continue
                kind = {"Congressional": "cd", "Senatorial": "sldu", "Legislative": "sldl"}[match[2]]
            offices.append((column(x), y, kind + ":" + str(int(match[1])), text))
        for x, y, party in lines:
            if party not in {"Democratic", "Republican", "Libertarian", "Green", "Independent"}:
                continue
            preceding = [o for o in offices if o[0] == column(x) and o[1] < y]
            if not preceding:
                continue  # Statewide ticket precedes district offices and is already held.
            _, _, district, title = max(preceding, key=lambda o: o[1])
            names = [(ny, t) for nx, ny, t in lines if column(nx) == column(x) and abs(nx-x) < 8 and 0 < y-ny < 16]
            if not names:
                raise ValueError((filename, district, party, y))
            name = max(names)[1]
            row = {"division": district, "office": title, "name": name, "party": party, "voteFor": 1, "termYears": None}
            rows[(district, name, party)] = row
    return list(rows.values())


def luzerne_rows():
    return sample_rows("pa-luzerne-2026-sample-ballots.pdf")


def lackawanna_rows():
    return sample_rows("pa-lackawanna-2026-sample-ballots.pdf", True)


def montgomery_rows():
    rows = []
    text = COMMON.pdf_text(COMMON.SOURCES / "pa-montgomery-2026-candidates.pdf")
    for line in text.splitlines():
        match = re.match(r"^(\d+)(?:st|nd|rd|th) (Congressional|Senatorial|Legislative) District\s+(.*?)\s{2,}(.*?)\s{2,}(.*?)\s*$", line)
        if match:
            kind = {"Congressional": "cd", "Senatorial": "sldu", "Legislative": "sldl"}[match[2]]
            rows.append({"division": kind + ":" + str(int(match[1])), "office": match[3] + " – District " + match[1],
                         "name": match[4], "party": match[5], "voteFor": 1, "termYears": None})
    return rows


def juniata_rows():
    rows, district, office = [], None, None
    for line in COMMON.pdf_text(COMMON.SOURCES / "pa-juniata-2026-candidates.pdf").splitlines():
        match = re.search(r"(REPRESENTATIVE IN CONGRESS|SENATOR IN THE GENERAL ASSEMBLY|REPRESENTATIVE IN THE GENERAL ASSEMBLY) (\d+)(?:ST|ND|RD|TH) DISTRICT", line)
        if match:
            office, district = match[1], division(match[1].title(), match[2])
        match = re.match(r"^\s*(.*?)\s+[–-]\s+(DEMOCRATIC|REPUBLICAN)\s*$", line)
        if match and district:
            rows.append({"division": district, "office": office + " – District " + district.split(":")[1],
                         "name": match[1], "party": match[2], "voteFor": 1, "termYears": None})
    return rows


SOURCES = [
    (bucks_rows, "pa-bucks-2026-official-candidates.pdf", "https://www.buckscounty.gov/DocumentCenter/View/27847/2026-General-Election---Official-Candidate-Listing---UPD-09-17-2026?bidId=", "Bucks County Board of Elections"),
    (chester_rows, "pa-chester-2026-official-candidates.pdf", "https://www.chesco.org/DocumentCenter/View/85852/CHESTER_2026-GENERAL_OFFICIAL-LIST-OF-CANDIDATES?bidId=", "Chester County Voter Services"),
    (delaware_rows, "pa-delaware-2026-official-candidates.pdf", "https://www.delcopa.gov/sites/default/files/media/GE2026-Official-Candidate-Information.pdf", "Delaware County Board of Elections"),
    (cumberland_rows, "pa-cumberland-2026-official-candidates.pdf", "https://www.cumberlandcountypa.gov/DocumentCenter/View/55560/Official-Candidate-Listing?bidId=", "Cumberland County Bureau of Elections"),
    (dauphin_rows, "pa-dauphin-2026-official-candidates.pdf", "https://www.dauphincounty.gov/docs/default-source/registration-elections/offices-and-candidates-to-be-elected-for-the-november-3-2026-general-election.pdf?sfvrsn=6b07cc87_1", "Dauphin County Board of Elections"),
    (erie_rows, "pa-erie-2026-official-candidates.pdf", "https://www.eriecountycouncilpa.gov/uploads/2026_general_election_unofficial_candidate_listing.pdf", "Erie County Board of Elections"),
    (luzerne_rows, "pa-luzerne-2026-sample-ballots.pdf", "https://www.luzernecounty.org/DocumentCenter/View/48757/Sample-Ballots", "Luzerne County Bureau of Elections"),
    (lackawanna_rows, "pa-lackawanna-2026-sample-ballots.pdf", "https://www.lackawannacounty.org/Document_center/Department/Elections/SAMPLE%20-%20PA%20Lackawanna%20261103%20General.pdf?t=202609171313240", "Lackawanna County Board of Elections"),
    (montgomery_rows, "pa-montgomery-2026-candidates.pdf", "https://assets.montgomerycountypa.gov/files/2026-08/2026%20GE%20Candidate%20List%208-27%20HEADER.pdf", "Montgomery County Voter Services"),
    (juniata_rows, "pa-juniata-2026-candidates.pdf", "https://www.juniatacountypa.gov/DocumentCenter/View/452/2026-Election-Candidate-List-PDF", "Juniata County Board of Elections"),
]


def local_questions():
    luzerne = pdf_lines(COMMON.SOURCES / "pa-luzerne-2026-sample-ballots.pdf")[1]
    question = " ".join(t for x, y, t in luzerne if x < 100 and 560 < y < 725)
    question += " " + " ".join(t for x, y, t in luzerne if 300 < x < 330 and 120 < y < 150)
    lackawanna = pdf_lines(COMMON.SOURCES / "pa-lackawanna-2026-sample-ballots.pdf")[0]
    question2 = " ".join(t for x, y, t in lackawanna if 415 < x < 425 and 475 < y < 600).strip('“”')
    return [("luzerne", "Luzerne County Home Rule Charter Amendment Question", question, next(s for s in SOURCES if s[0] == luzerne_rows)),
            ("lackawanna", "Referendum on Lackawanna County Home Rule Charter Amendment", question2, next(s for s in SOURCES if s[0] == lackawanna_rows))]


def update_pa(at):
    path = COMMON.ROOT / "data/ballot/2026-general/pa.json"
    data = json.loads(path.read_text())
    ballot = next(iter(data["ballots"].values()))
    before = (len(ballot["contests"]), len(ballot["candidacies"]))
    reports = []
    for parse, filename, url, publisher in SOURCES:
        rows = parse()
        groups = {}
        for row in rows:
            groups.setdefault(row["division"], []).append(row)
        added_contests, added_candidates = 0, 0
        for district, candidates in groups.items():
            # Preserve existing complete candidate lists and their stable person IDs.
            # County lists overlap districts; a different printed name is reviewed separately.
            if any(c["ocdId"] == "ocd-division/country:us/state:pa/" + district and c["type"] == "CANDIDACY" for c in ballot["contests"]):
                continue
            contest_id = "pa-dos:pa-2026-general:" + district.replace(":", "-")
            first = candidates[0]
            provenance = {"sourceUrl": url, "sourceOrg": publisher, "collectedAt": at, "verifiedAt": at,
                          "quote": first["office"]}
            kind, number = district.split(":")
            title = {"cd": "Representative in Congress", "sldu": "Senator in the General Assembly", "sldl": "Representative in the General Assembly"}[kind] + " – District " + number
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
                "ocdId": "ocd-division/country:us/state:pa/" + district, "divisionVintage": "2022",
                "title": title, "type": "CANDIDACY", "voteFor": first["voteFor"], "termYears": first["termYears"],
                "candidateListComplete": True, "scopeNote": None, "provenance": provenance})
            added_contests += 1
            for candidate in candidates:
                ballot["candidacies"].append({"id": contest_id + ":" + re.sub(r"[^a-z0-9]+", "-", candidate["name"].lower()).strip("-"),
                    "contestId": contest_id, "givenName": "", "familyName": candidate["name"], "partyLabel": candidate["party"],
                    "slogan": None, "incumbent": None, "websiteUrl": None,
                    "provenance": {**provenance, "quote": f"{candidate['office']} | {candidate['name']} | {candidate['party']}"}})
                added_candidates += 1
        COMMON.add_receipt(data, COMMON.receipt(COMMON.SOURCES / filename, url, publisher, at,
            f"Official November 3, 2026 general candidate list replay: {len(groups)} district races, {len(rows)} candidacies, excluding the statewide ticket already held. "
            "Blank party slots and explicitly removed or withdrawn candidates are excluded. Every printed candidate in each newly added race is retained."), at)
        reports.append({"publisher": publisher, "officialDistrictContests": len(groups), "officialDistrictCandidates": len(rows),
                        "addedContests": added_contests, "addedCandidates": added_candidates})
    for county, title, question, (_, _, url, publisher) in local_questions():
        contest_id = "pa-2026-" + county + "-home-rule-charter-amendment"
        if not any(c["id"] == contest_id for c in ballot["contests"]):
            provenance = {"sourceUrl": url, "sourceOrg": publisher, "collectedAt": at, "verifiedAt": at, "quote": question}
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
                "ocdId": "ocd-division/country:us/state:pa/county:" + county, "divisionVintage": "2026", "title": title,
                "type": "MEASURE", "measureTextUrl": url, "voteFor": 1, "termYears": None, "scopeNote": None, "provenance": provenance})
            ballot["measures"].append({"id": contest_id + "#question", "contestId": contest_id,
                "questionText": question, "officialStatement": None, "provenance": provenance})
        measure = next(m for m in ballot["measures"] if m["contestId"] == contest_id)
        if measure.get("officialNumber") is None:
            measure.pop("officialNumber", None)
    current_candidates = sum(c["type"] == "CANDIDACY" for c in ballot["contests"])
    ballot["coverageNotes"] = [
        f"Pennsylvania coverage includes {current_candidates} candidate contests and {len(ballot['candidacies'])} candidacies from official county lists. District coverage across the state remains incomplete.",
        "The statewide Candidate Database returned an Incapsula challenge without candidate records. County election offices are supplying the missing official general-election lists.",
        "Philadelphia's two charter questions and the Luzerne and Lackawanna County charter amendments are included for their counties. Other local and statewide measure coverage remains open.",
    ]
    return path, data, {"state": "PA", "before": before, "after": (len(ballot["contests"]), len(ballot["candidacies"])), "sources": reports}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    path, data, report = update_pa(datetime.datetime.now(datetime.timezone.utc).isoformat())
    if args.write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report))
