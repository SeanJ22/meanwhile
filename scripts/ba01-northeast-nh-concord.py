"""Replay Concord's official November 3 general and school sample ballots."""
import argparse
import concurrent.futures
import datetime
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import tempfile

SPEC = importlib.util.spec_from_file_location("ba01_northeast_nh", pathlib.Path(__file__).with_name("ba01-northeast-nh.py"))
NH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NH)
COMMON = NH.COMMON
URLS = json.loads((COMMON.SOURCES / "nh-concord-source-urls.json").read_text())
PREFIX = "ocd-division/country:us/state:nh/"
SCHOOL = PREFIX + "county:merrimack/school_district:concord_school_district"
# Ward, district, Democratic column, Republican column. Every candidate cell
# was visually checked; the saved party-column OCR is replayed below.
HOUSE = [
    (1, 15, ["Tracy Bricchi"], []),
    (2, 16, ["Connie Lane"], ["Laurence Weissbrot"]),
    (3, 17, ["Beth Richards"], []),
    (4, 18, ["Lisa D. Beaudoin"], ["Elijah J. Wilson"]),
    (5, 19, ["Mary Jane Wallner"], []),
    (6, 20, ["Nathan Giffard"], ["Jonathan Clark"]),
    (7, 21, ["Timothy Soucy"], ["Darryl Berleth"]),
    (8, 22, ["Alison Murphy"], ["Jonathan R. Cate"]),
    (9, 23, ["Kristopher Levesque"], ["Andrew Georgevits"]),
    (10, 24, ["Matthew Hicks"], []),
    (1, 28, ["Lisa Brown"], []),
    (4, 29, ["Kris Schultz"], []),
    (5, 30, ["Jason Quinno"], ["Robert C. Washburn"]),
]


def refresh_ocr():
    from PIL import Image
    env = {**os.environ, "OMP_THREAD_LIMIT": "1"}
    def one(ward):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "page"
            subprocess.run(["pdftoppm", "-scale-to", "2200", "-png", str(COMMON.SOURCES / f"nh-concord-ward-{ward}.pdf"), str(target)], check=True, capture_output=True)
            images = sorted(pathlib.Path(directory).glob("page-*.png"))
            parts = [subprocess.check_output(["tesseract", str(p), "stdout", "--psm", "6"], env=env, stderr=subprocess.DEVNULL, text=True) for p in images]
            front = Image.open(images[0]); width, height = front.size
            for party, left, right in [("Other", .258, .414), ("Democratic", .414, .565), ("Republican", .568, .72)]:
                crop = pathlib.Path(directory) / (party + ".png")
                front.crop((int(width*left), int(height*.203), int(width*right), int(height*.93))).save(crop)
                parts.append("COLUMN " + party + "\n" + subprocess.check_output(["tesseract", str(crop), "stdout", "--psm", "6"], env=env, stderr=subprocess.DEVNULL, text=True))
            (COMMON.SOURCES / f"nh-concord-ward-{ward}.ocr.txt").write_text("\f".join(parts))
    list(concurrent.futures.ThreadPoolExecutor(4).map(one, range(1, 11)))


def groups():
    result = []
    for ward, district, democratic, republican in HOUSE:
        source = f"nh-concord-ward-{ward}"
        text = (COMMON.SOURCES / (source + ".ocr.txt")).read_text()
        assert re.search(r"District\s+" + str(district) + r"\b", text)
        candidates = [(name, party) for party, names in [("Democratic", democratic), ("Republican", republican)] for name in names]
        for name, party in candidates:
            column = text.split("COLUMN " + party + "\n")[1].split("\f")[0]
            NH.check_scanned_name(name, column)
        division = "sldl:" + ("merrimack_" + str(district) if district >= 28 else str(600+district))
        result.append({"division": division, "title": f"State Representative, Merrimack County District {district}", "voteFor": 1, "source": source, "candidates": candidates})
    for division, title, candidates in [
        ("sldu:15", "State Senator, District 15", [("Tara Reardon", "Democratic"), ("Dennis Blankenbeker", "Republican")]),
        ("county:merrimack/council_district:1", "Merrimack County Commissioner, District 1", [("Steve Shurtleff", "Democratic")]),
    ]:
        text = (COMMON.SOURCES / "nh-concord-ward-1.ocr.txt").read_text()
        for name, _ in candidates:
            NH.check_scanned_name(name, text)
        result.append({"division": division, "title": title, "voteFor": 1, "source": "nh-concord-ward-1", "candidates": candidates})
    for zone in "abc":
        source = f"nh-concord-school-{zone}"
        text = COMMON.pdf_text(COMMON.SOURCES / (source + ".pdf"))
        block = text.split("Vote for not more than 1", 1)[1].split("(Write-in)", 1)[0]
        names = [line.strip() for line in block.splitlines() if line.strip()]
        result.append({"division": SCHOOL.removeprefix(PREFIX) + "/school_board_district:" + zone,
                       "title": f"Concord School District Board of Education, Voting Zone {zone.upper()}",
                       "voteFor": 1, "termYears": 3, "source": source, "candidates": [(name, None) for name in names]})
    return result


def general_sample_comparison(ballot, ward):
    """Compare every race, including candidate rows retained from earlier work."""
    common = [
        ("ballot-nh-merrimack:governor", [("Cinde Warmington", "Democratic"), ("Kelly Ayotte", "Republican"), ("Stephen Villee", "Libertarian")]),
        ("ballot-nh-merrimack:us-senate", [("Chris Pappas", "Democratic"), ("John E. Sununu", "Republican"), ("Edmond Laplante", "Constitution")]),
        ("ballot-nh-merrimack:us-house-2", [("Maggie Goodlander", "Democratic"), ("Lily Tang Williams", "Republican"), ("Robbie Mahrou", "Independent")]),
        ("ballot-nh-merrimack:executive-council-2", [("Karen Liot Hill", "Democratic"), ("Tobin Menard", "Republican")]),
        ("nh-2026-general:state-senator-district-15", [("Tara Reardon", "Democratic"), ("Dennis Blankenbeker", "Republican")]),
        ("ballot-nh-merrimack:county-sheriff", [("Peter Shephard", "Democratic"), ("Frank T. Cassidy", "Republican")]),
        ("ballot-nh-merrimack:county-attorney", [("Steven Endres", "Democratic"), ("Meg Hagaman", "Republican")]),
        ("ballot-nh-merrimack:county-treasurer", [("Kathleen Donnelly", "Democratic")]),
        ("ballot-nh-merrimack:register-of-deeds", [("Erica S. Davis", "Democratic"), ("Samantha Morse", "Republican")]),
        ("ballot-nh-merrimack:register-of-probate", [("Jane Bradstreet", "Democratic"), ("Alyssa Ehl", "Republican")]),
        ("nh-2026-general:merrimack-county-commissioner-district-1", [("Steve Shurtleff", "Democratic")]),
    ]
    overlay = 28 if ward in [1, 2, 3] else 29 if ward in [4, 9, 10] else 30
    house = [r for r in groups()[:13] if r["division"] in [f"sldl:{614+ward}", f"sldl:merrimack_{overlay}"]]
    for group in house:
        contest_id = "nh-2026-general:" + re.sub(r"[^a-z0-9]+", "-", group["title"].lower()).strip("-")
        common.append((contest_id, group["candidates"]))
    text = (COMMON.SOURCES / f"nh-concord-ward-{ward}.ocr.txt").read_text()
    differences, races = [], []
    for contest_id, candidates in common:
        for name, party in candidates:
            # Columns prove the party association; minor-party labels and the
            # back-page commissioner are checked on their full printed pages.
            in_front_column = party in ["Democratic", "Republican"] and name != "Steve Shurtleff"
            source = text.split("COLUMN " + party + "\n")[1].split("\f")[0] if in_front_column else text
            if party not in ["Democratic", "Republican"]:
                source = text.split("COLUMN Other\n")[1].split("\f")[0]
            NH.check_scanned_name(name, source)
            NH.check_scanned_name(party, text)
        expected = {(COMMON.words(name), party) for name, party in candidates}
        held = {(COMMON.words(c["givenName"] + " " + c["familyName"]), c["partyLabel"])
                for c in ballot["candidacies"] if c["contestId"] == contest_id}
        if held != expected:
            differences.append({"contestId": contest_id, "missing": sorted(expected-held), "extra": sorted(held-expected)})
        races.append({"contestId": contest_id, "officialCandidacies": len(expected)})
    return {"place": f"Concord Ward{ward}", "sourceUrl": URLS[f"nh-concord-ward-{ward}"],
            "officialCandidateContests": len(common), "officialCandidacies": sum(len(names) for _, names in common),
            "officialGeneralBallotMeasures": 2, "differences": differences, "races": races,
            "schoolBallotComparedSeparately": True, "liveVerified": False}


def memberships(at):
    text = NH.statute_text()
    source = {"sourceUrl": NH.STATUTE, "sourceOrg": "New Hampshire General Court", "collectedAt": at, "verifiedAt": at}
    council = re.search(r"II\. Councilor district number 2 .*?(?= III\.)", text)[0]
    commissioner = re.search(r"VII\. Merrimack: District 1, .*?(?=; District 2)", text)[0]
    records = {}
    def add(member, district, quote):
        key = (member, district)
        records[key] = {"id": "nh-2026-concord-membership:" + member.removeprefix(PREFIX) + "->" + district.removeprefix(PREFIX),
                        "memberOcdId": member, "districtOcdId": district, "provenance": {**source, "quote": quote}}
    targets = [(PREFIX + "executive_district:2", council), (PREFIX + "county:merrimack/council_district:1", commissioner)]
    counties = NH.statutory_house_groups()
    for ward, district, _, _ in HOUSE[:10]:
        details = counties["Merrimack"][district]
        assert details["places"] == [f"Concord Ward {ward}"]
        quote = f"District No. {district} Concord Ward {ward} 1"
        assert quote in text
        add(PREFIX + f"sldl:{600+district}", PREFIX + f"place:concord/ward:{ward}", quote)
    for feature in json.loads((COMMON.ROOT / "data/states/nh/geo/sldl-33.geojson").read_text())["features"]:
        properties = feature["properties"]
        match = re.search(r"State House District (\w+) (\d+)", properties["label"])
        if not match or int(match[2]) not in counties[match[1]]:
            continue
        places = counties[match[1]][int(match[2])]["places"]
        for district, quote in targets:
            if "/county:merrimack/" in district and match[1] != "Merrimack":
                continue
            if all(re.search(r"\b" + re.escape(re.sub(r" Ward \d+", "", place)) + r"\b", quote) for place in places):
                add(properties["ocdId"], district, quote)
    for feature in json.loads((COMMON.ROOT / "data/states/nh/geo/cousub-33.geojson").read_text())["features"]:
        properties = feature["properties"]
        place = re.sub(r" (town|city)$", "", properties["label"])
        for district, quote in targets:
            if "/county:merrimack/" in district and "/county:merrimack/" not in properties["ocdId"]:
                continue
            if re.search(r"\b" + re.escape(place) + r"\b", quote):
                add(properties["ocdId"], district, quote)
                if properties["label"].endswith(" city"):
                    add(PREFIX + "place:" + place.lower().replace(" ", "_"), district, quote)
    return list(records.values())


def update(at):
    path = COMMON.ROOT / "data/ballot/2026-general/nh.json"
    data = json.loads(path.read_text()); ballot = next(iter(data["ballots"].values()))
    before = (len(ballot["contests"]), len(ballot["candidacies"]))
    for group in groups():
        source = group["source"]; url = URLS[source]
        captured_at = COMMON.capture_time(data, url, COMMON.SOURCES / (source + ".pdf"))
        provenance = {"sourceUrl": url, "sourceOrg": "Concord City Clerk", "collectedAt": captured_at, "verifiedAt": at, "quote": group["title"]}
        contest_id = "nh-2026-general:" + re.sub(r"[^a-z0-9]+", "-", group["title"].lower()).strip("-")
        if not any(c["id"] == contest_id for c in ballot["contests"]):
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"], "ocdId": PREFIX + group["division"],
                "divisionVintage": "2022", "title": group["title"], "type": "CANDIDACY", "voteFor": group["voteFor"],
                "termYears": group.get("termYears"), "candidateListComplete": True, "scopeNote": None, "provenance": provenance})
        next(c for c in ballot["contests"] if c["id"] == contest_id)["provenance"] = provenance
        for name, party in group["candidates"]:
            candidate_id = contest_id + ":" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            candidate = next((c for c in ballot["candidacies"] if c["id"] == candidate_id), None)
            if candidate is None:
                candidate = {"id": candidate_id, "contestId": contest_id, "givenName": "", "familyName": name, "partyLabel": party,
                             "slogan": None, "incumbent": None, "websiteUrl": None}
                ballot["candidacies"].append(candidate)
            candidate["provenance"] = {**provenance, "quote": f"{group['title']} | {name}" + (" | " + party if party else "")}
    # Correct the same existing Council race, retaining both candidate IDs.
    rsa_at = COMMON.capture_time(data, NH.STATUTE, COMMON.SOURCES / "nh-rsa662-elective-districts.html")
    council_quote = re.search(r"II\. Councilor district number 2 .*?(?= III\.)", NH.statute_text())[0]
    contest = next(c for c in ballot["contests"] if c["id"] == "ballot-nh-merrimack:executive-council-2")
    source = "nh-concord-ward-1"; url = URLS[source]; captured_at = COMMON.capture_time(data, url, COMMON.SOURCES / (source + ".pdf"))
    provenance = {"sourceUrl": url, "sourceOrg": "Concord City Clerk", "collectedAt": captured_at, "verifiedAt": at,
                  "quote": "Executive Councilor | Democratic Candidates: Karen Liot Hill | Republican Candidates: Tobin Menard"}
    correction = {"previousOcdId": PREFIX + "county:merrimack/place:newbury_town",
                  "provenance": {"sourceUrl": NH.STATUTE, "sourceOrg": "New Hampshire General Court", "collectedAt": rsa_at, "verifiedAt": at, "quote": council_quote}}
    contest.update(ocdId=PREFIX + "executive_district:2", divisionVintage="2022", scopeNote=None, provenance=provenance, scopeCorrection=correction)
    for candidate in ballot["candidacies"]:
        if candidate["contestId"] == contest["id"]:
            candidate["provenance"] = {**provenance, "quote": candidate["givenName"] + " " + candidate["familyName"] + " | " + candidate["partyLabel"]}
    # Citywide statutory question is printed as ten ward-specific text variants.
    goffstown = COMMON.pdf_text(COMMON.SOURCES / "nh-goffstown-sample.pdf")
    template = " ".join(re.search(r'2\. "(Shall the Town of GOFFSTOWN.*?)=\s*Yes', goffstown, re.S)[1].split())
    for ward in range(1, 11):
        school = "CONCORD SCHOOL DISTRICT (SAU #8)" + (" AND MERRIMACK VALLEY SCHOOL DISTRICT (SAU #46)" if ward <= 2 else "")
        question = template.replace("Town of GOFFSTOWN", f"City of CONCORD - Ward {ward}").replace("GOFFSTOWN SCHOOL DISTRICT (SAU #19)", school)
        source = f"nh-concord-ward-{ward}"; text = (COMMON.SOURCES / (source + ".ocr.txt")).read_text(); NH.check_scanned_name(question, text)
        put_measure(data, ballot, f"nh-2026-concord-ward-{ward}-hb1300-property-tax-growth", PREFIX + f"place:concord/ward:{ward}",
                    "Concord School District Property Tax Growth Limit", "2", question, source, at)
    source = "nh-concord-school-a"; text = COMMON.pdf_text(COMMON.SOURCES / (source + ".pdf"))
    question = " ".join(text.split("BALLOT QUESTION", 1)[1].split("YES", 1)[0].split())
    put_measure(data, ballot, "nh-2026-concord-school-dewey-property-sale", SCHOOL,
                "Concord School District Sale of Former Dewey School Property", None, question, source, at)
    for source, url in URLS.items():
        captured_at = COMMON.capture_time(data, url, COMMON.SOURCES / (source + ".pdf"))
        COMMON.add_receipt(data, COMMON.receipt(COMMON.SOURCES / (source + ".pdf"), url, "Concord City Clerk", captured_at,
            "Official November3 general/school sample; every imported candidate and question replayed. All scanned House candidate names and party columns checked visually and against saved OCR. School zones remain separate electorates; partial school boundaries are not widened to city wards."), at)
    previous = [r for r in ballot.get("districtMemberships", []) if not r["id"].startswith("nh-2026-concord-membership:")]
    ballot["districtMemberships"] = previous + memberships(rsa_at)
    for row in ballot["districtMemberships"]:
        if row["id"].startswith("nh-2026-concord-membership:"):
            row["provenance"]["verifiedAt"] = at
    return path, data, {"state": "NH", "before": before, "after": (len(ballot["contests"]), len(ballot["candidacies"])),
                        "newCandidateContests": len(groups()), "newCandidacies": sum(len(g["candidates"]) for g in groups()),
                        "generalSampleComparisons": [general_sample_comparison(ballot, ward) for ward in range(1, 11)],
                        "schoolZoneAddressMatching": "open; wards1/2 have partial school-district boundaries"}


def put_measure(data, ballot, contest_id, division, title, number, question, source, at):
    url = URLS[source]; captured_at = COMMON.capture_time(data, url, COMMON.SOURCES / (source + ".pdf"))
    provenance = {"sourceUrl": url, "sourceOrg": "Concord City Clerk", "collectedAt": captured_at, "verifiedAt": at, "quote": question}
    contest = next((c for c in ballot["contests"] if c["id"] == contest_id), None)
    if contest is None:
        contest = {"id": contest_id, "electionId": ballot["election"]["id"], "ocdId": division, "divisionVintage": "2026", "title": title,
                   "type": "MEASURE", "measureTextUrl": url, "voteFor": 1, "termYears": None, "scopeNote": None}
        ballot["contests"].append(contest)
    contest["provenance"] = provenance
    measure = next((m for m in ballot["measures"] if m["contestId"] == contest_id), None)
    if measure is None:
        measure = {"id": contest_id + "#question", "contestId": contest_id, "questionText": question, "officialStatement": None}
        if number is not None:
            measure["officialNumber"] = number
        ballot["measures"].append(measure)
    measure["provenance"] = provenance


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--refresh-ocr", action="store_true")
    parser.add_argument("--refresh-sources", action="store_true")
    args = parser.parse_args()
    if args.refresh_sources:
        path = COMMON.ROOT / "data/ballot/2026-general/nh.json"; data = json.loads(path.read_text())
        COMMON.capture_http_sources(data, [(name + ".pdf", url, "Concord City Clerk") for name, url in URLS.items()])
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    if args.refresh_ocr:
        refresh_ocr()
    path, data, report = update(datetime.datetime.now(datetime.timezone.utc).isoformat())
    if args.write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report))
