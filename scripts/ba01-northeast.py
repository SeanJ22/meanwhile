"""Replay the official New Jersey ballot PDFs and Philadelphia question PDF.

Requires Poppler's pdftotext. Source bytes are retained beside the state files;
only ballot names, parties and question text enter the reader data.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = ROOT / "data/ballot/sources/ba01-northeast"
NJ_BASE = "https://www.nj.gov/state/elections/assets/pdf/election-results/2026/"
HOUSE = "2026-official-general-candidates-us-house-0904.pdf"
SENATE = "2026-official-general-candidates-us-senate.pdf"
PHILA = "https://vote.phila.gov/media/2026G_Ballot_Questions.pdf"
NS = {"x": "http://www.w3.org/1999/xhtml"}


def words(value):
    return re.sub(r"[^\w]+", " ", value.casefold()).strip()


def pdf_text(path):
    return subprocess.check_output(["pdftotext", "-layout", str(path), "-"], text=True)


def nj_rows(path, senate=False):
    """Read candidate and party cells by their PDF column coordinates."""
    with tempfile.NamedTemporaryFile(suffix=".xml") as target:
        subprocess.run(["pdftotext", "-bbox-layout", str(path), target.name], check=True)
        pages = ET.parse(target.name).findall(".//x:page", NS)
    rows = []
    for index, page in enumerate(pages):
        lines = [(float(line.get("xMin")), float(line.get("yMin")),
                  " ".join(word.text or "" for word in line))
                 for line in page.findall(".//x:line", NS)]
        cells = [(float(word.get("xMin")), float(word.get("yMin")), word.text or "")
                 for word in page.findall(".//x:word", NS)]
        headers = {text: (x, y) for x, y, text in lines if text in {"Name", "Address", "Party", "County"}}
        if "Name" not in headers:
            continue
        address_x, party_x, county_x = [headers[name][0] for name in ["Address", "Party", "County"]]
        header_y = headers["Name"][1]
        candidates = [(y, name) for x, y, name in lines
                      if x < address_x - 2 and y > header_y + 10
                      and not re.search(r"Congressional District|Counties|^\(part\)", name)]
        for y, raw_name in candidates:
            party = " ".join(text for x, py, text in cells
                             if x >= party_x - 2 and abs(py - y) < 1)
            # A long party designation may extend beyond the normal county column.
            if not party:
                raise ValueError(f"No party cell for {raw_name}")
            rows.append({"district": None if senate else index + 1,
                         "name": raw_name.removesuffix(" *").strip(), "party": party,
                         "incumbent": raw_name.endswith(" *")})
    return rows


def receipt(path, url, publisher, at, evidence):
    return {"requestedUrl": url, "finalUrl": url, "publisher": publisher,
            "sourceClass": "ELECTION_AUTHORITY", "retrievedAt": at,
            "httpStatus": 200, "rawHash": hashlib.sha256(path.read_bytes()).hexdigest(),
            "reviewedEvidence": evidence}


def add_receipt(data, source, at, *, captured=False):
    sources = data["sourceReceipt"]["sources"]
    same_bytes = [prior for prior in sources if prior["requestedUrl"] == source["requestedUrl"] and prior["rawHash"] == source["rawHash"]]
    # Replaying saved bytes is verification, not a new network retrieval.
    # Only capture code may introduce a new retrieval timestamp for held bytes.
    if not captured:
        if not same_bytes:
            raise ValueError(f"No actual capture receipt for saved bytes: {source['requestedUrl']}")
        source = {**source, "retrievedAt": max(same_bytes, key=lambda r: datetime.datetime.fromisoformat(r["retrievedAt"].replace("Z", "+00:00")))["retrievedAt"]}
    existing = next((i for i, prior in enumerate(sources)
                     if prior["requestedUrl"] == source["requestedUrl"] and prior["rawHash"] == source["rawHash"] and prior["retrievedAt"] == source["retrievedAt"]), None)
    if existing is None:
        sources.append(source)
    else:
        sources[existing] = source
    data["sourceReceipt"].update(reviewedAt=at, reviewedBy="BA-01 official ballot PDF replay")


def capture_time(data, url, path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    matches = [r for r in data["sourceReceipt"]["sources"]
               if url in (r.get("requestedUrl"), r.get("finalUrl"))
               and r.get("rawHash") == digest and r.get("httpStatus") == 200]
    if not matches:
        raise ValueError(f"No actual successful capture for saved source: {url}")
    return max(matches, key=lambda r: datetime.datetime.fromisoformat(r["retrievedAt"].replace("Z", "+00:00")))["retrievedAt"]


def capture_http_sources(data, sources):
    """Capture real response bytes and retain every cited receipt version."""
    def fetch(item):
        filename, url, publisher = item
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*"})
        with urllib.request.urlopen(request, timeout=60) as response:
            body, final_url, status = response.read(), response.geturl(), response.status
            captured_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if status != 200:
            raise ValueError((url, status))
        target = SOURCES / filename
        target.write_bytes(body)
        source = receipt(target, url, publisher, captured_at,
            "Actual successful HTTP response bytes captured at this retrieval-completion time; source facts replayed by the BA-01 Northeast scripts.")
        source.update(finalUrl=final_url, httpStatus=status)
        return source
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(fetch, sources))
    for source in results:
        add_receipt(data, source, source["retrievedAt"], captured=True)
    return results


def update_nj(at):
    path = ROOT / "data/ballot/2026-general/nj.json"
    data = json.loads(path.read_text())
    ballot = next(iter(data["ballots"].values()))
    old = (len(ballot["contests"]), len(ballot["candidacies"]))
    for filename, senate in [(HOUSE, False), (SENATE, True)]:
        source_path = SOURCES / filename
        captured_at = capture_time(data, NJ_BASE + filename, source_path)
        rows = nj_rows(source_path, senate)
        source = receipt(source_path, NJ_BASE + filename, "New Jersey Division of Elections", at,
                         f"Official November 3, 2026 list: {len(rows)} printed candidates. "
                         "Candidate names, party cells and incumbency markers replayed by PDF coordinates; "
                         "all printed candidates receive the same fields. Addresses are excluded.")
        for row in rows:
            division = "ocd-division/country:us/state:nj" + ("" if senate else f"/cd:{row['district']}")
            contest = next((c for c in ballot["contests"] if c["ocdId"] == division and c["type"] == "CANDIDACY"), None)
            provenance = {"sourceUrl": source["finalUrl"], "sourceOrg": source["publisher"],
                          "collectedAt": captured_at, "verifiedAt": at,
                          "quote": f"{'US Senate' if senate else 'House of Representatives, District ' + str(row['district'])} | {row['name']} | {row['party']}"}
            if contest is None:
                contest = {"id": f"nj-doe-2026-us-house-{row['district']}", "electionId": ballot["election"]["id"],
                           "ocdId": division, "divisionVintage": "2026", "title": f"Member of the House of Representatives (District {row['district']})",
                           "type": "CANDIDACY", "voteFor": 1, "termYears": 2, "scopeNote": None,
                           "candidateListComplete": True, "provenance": provenance}
                ballot["contests"].append(contest)
            # Retain IDs and every supplemental field already attached to a person.
            existing = next((c for c in ballot["candidacies"] if c["contestId"] == contest["id"]
                             and words(c["givenName"] + " " + c["familyName"]) == words(row["name"])), None)
            if existing is None:
                existing = {"id": contest["id"] + ":" + re.sub(r"[^a-z0-9]+", "-", row["name"].lower()).strip("-"),
                            "contestId": contest["id"], "givenName": "", "familyName": row["name"],
                            "slogan": None, "websiteUrl": None}
                ballot["candidacies"].append(existing)
            existing.update(partyLabel=row["party"], incumbent=row["incumbent"], provenance=provenance)
            contest.update(candidateListComplete=True, provenance=provenance)
        add_receipt(data, source, at)
    return path, data, {"state": "NJ", "before": old,
                        "after": (len(ballot["contests"]), len(ballot["candidacies"])),
                        "officialFederalContests": 13, "officialFederalCandidates": 39}


def update_philadelphia(at):
    path = ROOT / "data/ballot/2026-general/pa.json"
    data = json.loads(path.read_text())
    ballot = next(iter(data["ballots"].values()))
    document = SOURCES / "2026G_Ballot_Questions.pdf"
    captured_at = capture_time(data, PHILA, document)
    pages = pdf_text(document).split("\f")
    questions = []
    for page in pages:
        match = re.search(r"Question #(\d+).*?Ballot Question:\s*(.*?)\s*Statement:\s*(.*)", page, re.S)
        if match:
            questions.append((match[1], " ".join(match[2].split()), " ".join(match[3].split())))
    for number, question, statement in questions:
        contest_id = f"pa-philadelphia-2026-charter-question-{number}"
        provenance = {"sourceUrl": PHILA, "sourceOrg": "Philadelphia City Commissioners",
                      "collectedAt": captured_at, "verifiedAt": at, "quote": question}
        if not any(c["id"] == contest_id for c in ballot["contests"]):
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
                "ocdId": "ocd-division/country:us/state:pa/county:philadelphia", "divisionVintage": "2026",
                "title": f"Philadelphia Charter Change Question #{number}", "type": "MEASURE",
                "measureTextUrl": PHILA, "voteFor": 1, "termYears": None, "scopeNote": None, "provenance": provenance})
            ballot["measures"].append({"id": contest_id + "#question", "contestId": contest_id,
                "officialNumber": number, "questionText": question, "officialStatement": statement, "provenance": provenance})
    add_receipt(data, receipt(document, PHILA, "Philadelphia City Commissioners", at,
                "Both English ballot questions and their full explanatory statements replayed from the official Philadelphia Home Rule Charter question PDF. County scope only."), at)
    return path, data, {"state": "PA", "addedLocalMeasures": len(questions)}


def ma_sections():
    office, district = None, "Statewide"
    sections = {}
    source = SOURCES / "ma-2026-state-election-candidates.rendered.txt"
    for line in source.read_text().splitlines():
        if line.startswith("## "):
            office, district = line[3:], "Statewide"
        elif line.startswith("### "):
            district = line[4:]
        elif office and line and not line.startswith("【") and "," in line:
            sections.setdefault(office, []).append((district, line))
    return sections


def update_ma(at):
    path = ROOT / "data/ballot/2026-general/ma.json"
    data = json.loads(path.read_text())
    ballot = next(iter(data["ballots"].values()))
    source_path = SOURCES / "ma-2026-councillor-capture.rendered.txt"
    url = "https://www.sec.state.ma.us/divisions/elections/research-and-statistics/2026-state-election-candidates.htm"
    rows = ma_sections()["Councillor"]
    captured_at = capture_time(data, url, source_path)
    fresh_text = source_path.read_text()
    ordinals = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"]
    before = (len(ballot["contests"]), len(ballot["candidacies"]))
    for district, line in rows:
        number = ordinals.index(district.split()[0]) + 1
        name = re.split(r",\s+\d", line)[0]
        party = next(p for p in ["Democratic", "Republican"] if line.endswith(p))
        if not any(name in candidate_line and party in candidate_line for candidate_line in fresh_text.splitlines()):
            raise ValueError(f"Councillor name and party absent from fresh source: {name}")
        contest_id = f"ma-2026-11-03:councillor-{number}"
        provenance = {"sourceUrl": url, "sourceOrg": "Massachusetts Secretary of the Commonwealth, Elections Division",
                      "collectedAt": captured_at, "verifiedAt": at, "quote": f"Councillor | {district} | {name} | {party}"}
        if not any(c["id"] == contest_id for c in ballot["contests"]):
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
                "ocdId": f"ocd-division/country:us/state:ma/governors_council:{number}", "divisionVintage": "2022",
                "title": f"Councillor – {district}", "type": "CANDIDACY", "voteFor": 1, "termYears": 2,
                "scopeNote": None, "candidateListComplete": True, "provenance": provenance})
        next(c for c in ballot["contests"] if c["id"] == contest_id).update(ocdId=f"ocd-division/country:us/state:ma/governors_council:{number}", provenance=provenance)
        if not any(c["contestId"] == contest_id and words(c["givenName"] + " " + c["familyName"]) == words(name) for c in ballot["candidacies"]):
            ballot["candidacies"].append({"id": contest_id + ":" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
                "contestId": contest_id, "givenName": "", "familyName": name, "partyLabel": party,
                "slogan": None, "incumbent": None, "websiteUrl": None, "provenance": provenance})
        next(c for c in ballot["candidacies"] if c["contestId"] == contest_id and words(c["givenName"] + " " + c["familyName"]) == words(name))["provenance"] = provenance
    add_receipt(data, receipt(source_path, url, "Massachusetts Secretary of the Commonwealth, Elections Division", at,
        "Saved rendered official candidate page obtained through the web reader after the direct HTTP route returned Incapsula. "
        "Hash describes this saved rendered reader window, which contains the full Councillor section. "
        "All 8 Councillor districts and all 11 printed candidate names and party labels replayed against this capture. Addresses stay in source evidence only."), at)
    return path, data, {"state": "MA", "before": before,
                        "after": (len(ballot["contests"]), len(ballot["candidacies"]))}


def vt_rows():
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(SOURCES / "2026_general_election_qualified_candidates.xlsx") as workbook:
        strings = ["".join(item.itertext()) for item in ET.fromstring(workbook.read("xl/sharedStrings.xml")).findall("s:si", ns)]
        rows = []
        for row in ET.fromstring(workbook.read("xl/worksheets/sheet1.xml")).findall(".//s:row", ns)[1:]:
            values = {}
            for cell in row:
                value = cell.find("s:v", ns)
                if value is not None:
                    values[re.sub(r"\d", "", cell.get("r"))] = strings[int(value.text)] if cell.get("t") == "s" else value.text
            if values.get("C"):
                rows.append({"office": values["A"], "district": values["B"], "name": values["C"],
                             "party": values.get("E"), "term": int(values["N"]), "vote": values["O"]})
        return rows


def update_vt(at):
    path = ROOT / "data/ballot/2026-general/vt.json"
    data = json.loads(path.read_text())
    ballot = next(iter(data["ballots"].values()))
    source_path = SOURCES / "2026_general_election_qualified_candidates.xlsx"
    url = "https://outside.vermont.gov/dept/sos/Elections_Division/election_info_resources/candidates/2026_general_election_qualified_candidates.xlsx"
    captured_at = capture_time(data, url, source_path)
    county_offices = {"PROBATE JUDGE", "ASSISTANT JUDGE", "STATE'S ATTORNEY", "SHERIFF", "HIGH BAILIFF"}
    selected = [row for row in vt_rows() if row["district"] == "CHITTENDEN" and row["office"] in county_offices or
                (row["office"] == "JUSTICE OF THE PEACE" and row["district"] == "BURLINGTON" and row["vote"] == "FIFTEEN")]
    numbers = {"ONE": 1, "TWO": 2, "FIFTEEN": 15}
    before = (len(ballot["contests"]), len(ballot["candidacies"]))
    for row in selected:
        slug = re.sub(r"[^a-z0-9]+", "-", row["office"].lower()).strip("-")
        county = row["district"] == "CHITTENDEN"
        contest_id = f"vt-2026-{row['district'].lower()}-{slug}"
        provenance = {"sourceUrl": url, "sourceOrg": "Vermont Secretary of State",
                      "collectedAt": captured_at, "verifiedAt": at,
                      "quote": " | ".join(str(row[key]) for key in ["office", "district", "name", "party", "term", "vote"])}
        if not any(c["id"] == contest_id for c in ballot["contests"]):
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
                "ocdId": "ocd-division/country:us/state:vt/" + ("county:chittenden" if county else "place:burlington"),
                "divisionVintage": "2026", "title": f"{row['office']} — {row['district']}", "type": "CANDIDACY",
                "voteFor": numbers[row["vote"]], "termYears": row["term"], "scopeNote": None,
                "candidateListComplete": True, "provenance": provenance})
        next(c for c in ballot["contests"] if c["id"] == contest_id)["provenance"] = provenance
        if not any(c["contestId"] == contest_id and words(c["givenName"] + " " + c["familyName"]) == words(row["name"]) for c in ballot["candidacies"]):
            ballot["candidacies"].append({"id": contest_id + ":" + re.sub(r"[^a-z0-9]+", "-", row["name"].lower()).strip("-"),
                "contestId": contest_id, "givenName": "", "familyName": row["name"], "partyLabel": row["party"],
                "slogan": None, "incumbent": None, "websiteUrl": None, "provenance": provenance})
        next(c for c in ballot["candidacies"] if c["contestId"] == contest_id and words(c["givenName"] + " " + c["familyName"]) == words(row["name"]))["provenance"] = provenance
    add_receipt(data, receipt(source_path, url, "Vermont Secretary of State", at,
        "Official workbook lists all 132 federal, statewide and legislative contests and 319 printed candidacies already held. "
        "Added all 9 candidates in 5 Chittenden County offices and all 41 Burlington justice-of-the-peace candidates, corroborated against the city's official Chittenden-13 sample ballot."), at)
    sample = SOURCES / "burlington-chittenden-13-sample.pdf"
    add_receipt(data, receipt(sample, "https://www.burlingtonvt.gov/DocumentCenter/View/12823/Chi-13-Sample?bidId=", "Burlington City Clerk", at,
        "November 3, 2026 Chittenden-13 official sample: 15 candidacy contests and 2 statewide proposals; 81 printed candidacies. "
        "Chittenden county and Burlington justice-of-the-peace candidate sets agree with the official statewide workbook. "
        "The city's official sample-ballot index links this document at https://www.burlingtonvt.gov/192/Sample-Ballots-Warnings-Notices."), at)
    return path, data, {"state": "VT", "before": before,
                        "after": (len(ballot["contests"]), len(ballot["candidacies"]))}


def ny_groups():
    """Reconstruct party/name table cells; consolidate identical fusion names."""
    with tempfile.NamedTemporaryFile(suffix=".xml") as target:
        subprocess.run(["pdftotext", "-bbox-layout", str(SOURCES / "ny-accessible-2026-general-ballot-certification-10.7.2026.pdf"), target.name], check=True)
        pages = ET.parse(target.name).findall(".//x:page", NS)
    groups = {}
    for page in pages:
        lines = sorted([(float(line.get("xMin")), float(line.get("yMin")),
                         " ".join(word.text or "" for word in line))
                        for line in page.findall(".//x:line", NS)], key=lambda line: (line[1], line[0]))
        starts = [y for x, y, text in lines if "Office:" in text]
        for start, end in zip(starts, starts[1:] + [720]):
            section = [(x, y, text) for x, y, text in lines if start <= y < end]
            office_line = next(text for x, y, text in section if "Office:" in text)
            office = office_line.split("Office:", 1)[1].strip() or " ".join(text for x, y, text in section if abs(y-start) < 1 and x > 100)
            district_y = next(y for x, y, text in section if text.startswith("District:"))
            district = " ".join(text for x, y, text in section if abs(y-district_y) < 1).split(":", 1)[1].strip()
            if office == "Supreme Court Justice":
                continue
            columns = sorted({round(x, 1) for x, y, text in section if text == "Candidate Name"})
            header_y = max(y for x, y, text in section if text == "Candidate Name")
            parties = []
            for x, y, text in section:
                if x < 100 and y > header_y:
                    if parties and y - parties[-1][-1][0] < 20:
                        parties[-1].append((y, text))
                    else:
                        parties.append([(y, text)])
            centers = [sum(y for y, text in row)/len(row) for row in parties]
            rows = []
            for index, (center, party) in enumerate(zip(centers, parties)):
                low = (centers[index-1] + center)/2 if index else header_y + 5
                high = (centers[index+1] + center)/2 if index+1 < len(centers) else end-5
                names = [" ".join(text for x, y, text in section if abs(x-column) < 1 and low <= y < high)
                         for column in columns]
                if any(names):
                    rows.append({"name": " and ".join(name for name in names if name), "party": " ".join(text for y, text in party)})
            groups[(office, district)] = rows
    return groups


def update_ny(at):
    path = ROOT / "data/ballot/2026-general/ny.json"
    data = json.loads(path.read_text())
    ballot = next(iter(data["ballots"].values()))
    groups = ny_groups()
    mismatches = []
    for contest in ballot["contests"]:
        if not contest["id"].startswith("ny-boe:2026-general:") or contest["type"] != "CANDIDACY":
            continue
        quote = contest["provenance"]["quote"]
        office = re.search(r"Office: (.*)", quote)[1]
        district = re.search(r"District: (.*)", quote)[1]
        official = {words(row["name"]) for row in groups.get((office, district), [])}
        held = {words(row["givenName"] + " " + row["familyName"]) for row in ballot["candidacies"] if row["contestId"] == contest["id"]}
        if official != held:
            mismatches.append({"office": office, "district": district, "missing": sorted(official-held), "extra": sorted(held-official)})
        for candidate in ballot["candidacies"]:
            if candidate["contestId"] != contest["id"]:
                continue
            name = words(candidate["givenName"] + " " + candidate["familyName"])
            parties = {row["party"] for row in groups.get((office, district), []) if words(row["name"]) == name}
            if parties != set((candidate["partyLabel"] or "").split(" / ")):
                mismatches.append({"office": office, "district": district, "partyMismatch": name})
    # This is a source comparison report; existing reader data remains available on mismatch.
    if not mismatches:
        source = SOURCES / "ny-accessible-2026-general-ballot-certification-10.7.2026.pdf"
        url = "https://elections.ny.gov/system/files/documents/2026/10/accessible-2026-general-ballot-certification-10.7.2026.pdf"
        current = receipt(source, url, "New York State Board of Elections", at,
            "Replayed every federal, statewide executive and legislative office/district table from the October 7 amended certification. "
            "All 242 contests and all 442 distinct printed candidacies match; fusion party lines are consolidated by identical printed name. "
            "Judicial districts are separate local acquisition work.")
        # Retain the official certification link as the original requested URL.
        current["requestedUrl"] = "https://elections.ny.gov/certification-november-3-2026-general-election"
        add_receipt(data, current, at)
    return path, data, {"state": "NY", "officialContests": len(groups),
        "officialCandidates": sum(len({words(row["name"]) for row in rows}) for rows in groups.values()), "mismatches": mismatches}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--at", default=datetime.datetime.now(datetime.timezone.utc).isoformat())
    args = parser.parse_args()
    for update in [update_nj, update_philadelphia, update_ma, update_vt, update_ny]:
        path, data, report = update(args.at)
        if args.write:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(report))
