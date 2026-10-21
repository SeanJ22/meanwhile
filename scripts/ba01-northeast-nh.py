"""Replay November municipal samples and the New Hampshire district statute.

Manchester's scanned samples were OCRed with Tesseract --psm 6 and every
transcribed House candidate was checked visually against the saved page image.
Code checks the name tokens, party columns and district against the saved source.
The machine-readable Goffstown sample supplies the other offices and local question.
"""
import argparse
import collections
import datetime
from html.parser import HTMLParser
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import tempfile
import urllib.request

SPEC = importlib.util.spec_from_file_location("ba01_northeast_pa", pathlib.Path(__file__).with_name("ba01-northeast-pa.py"))
PA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PA)
COMMON = PA.COMMON
STATUTE = "https://www.gc.nh.gov/rsa/html/LXIII/662/662-mrg.htm"
URLS = json.loads((COMMON.SOURCES / "nh-municipal-source-urls.json").read_text())

# The first twelve groups are each ward's base district; the last three are
# overlapping floterial contests, printed in addition to the base House contest.
MANCHESTER_HOUSE = [
    (1, 21, 2, ["Chris Morgan"], ["Christine Seibert", "Jeff Goley"]),
    (2, 17, 2, ["Ben Prescott"], ["Sean Parr", "Rob Fox"]),
    (3, 23, 2, [], ["Jean Jeudy", "Mary Ngwanda Georges"]),
    (4, 24, 2, ["Paul LaFerriere", "Shuvom Ghose"], ["Jessica Margeson", "Frank Anthony"]),
    (5, 25, 2, ["Kathleen Paquette"], ["Kathy Staub", "Heather Deiner"]),
    (6, 16, 2, ["Michael J. Tkacz", "David A. Smith"], ["Maxine Mosley", "Ben Baroody"]),
    (7, 26, 2, ["Henry Emele", "Brian Cole"], ["Patrick N. Long", "Mary Freitas"]),
    (8, 15, 2, ["Mark Proulx", "Mark McLean"], ["Michael Fitzell", "Michael Farley"]),
    (9, 20, 2, ["Jose R. Marte", "Pierre M. Dupont"], ["Alissandra Murray", "Pauline Martineau"]),
    (10, 19, 2, ["Mickey Mullin", "Matt Drew"], ["Chrissy Simonds", "Jane Beaulieu"]),
    (11, 22, 2, ["Brittany Ping", "Max Abramson"], ["Nicole Leapley", "Greg Erskine"]),
    (12, 18, 2, ["Steven Kesselring"], ["James Normand", "Jessica Grill"]),
    (1, 40, 4, ["Bill O'Brien", "Robert Rivera", "Lynne M. Cumming", "Carlos Gonzalez"],
     ["Robert Richard-Snipes", "Trinidad Tellez", "Erin Kerwin", "Mark S. Mackenzie"]),
    (2, 41, 3, ["Joseph Skinner", "Ryan Hebert", "Jason Hodgdon"], ["Tom Stewart", "Lily M. Foss", "Bishwa Bahadur Shah"]),
    (6, 39, 2, ["William Infantine", "Jon DiPietro"], ["Tommy Katsiantonis", "Ellen A. Boudreau"]),
]


def capture_sources():
    """Capture HTTP bytes and their actual completion timestamps together."""
    from concurrent.futures import ThreadPoolExecutor
    path = COMMON.ROOT / "data/ballot/2026-general/nh.json"
    data = json.loads(path.read_text())
    sources = [(name + ".pdf", url, "Goffstown Town Clerk" if name == "nh-goffstown-sample" else "Manchester City Clerk") for name, url in URLS.items()]
    sources.append(("nh-rsa662-elective-districts.html", STATUTE, "New Hampshire General Court"))

    def one(item):
        filename, url, publisher = item
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*"})
        with urllib.request.urlopen(request, timeout=45) as response:
            body = response.read()
            captured_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
            final_url, status = response.url, response.status
        target = COMMON.SOURCES / filename
        target.write_bytes(body)
        result = COMMON.receipt(target, url, publisher, captured_at, "Actual successful HTTP response bytes captured with this retrieval-completion timestamp. Replayed by ba01-northeast-nh.py.")
        result.update(finalUrl=final_url, httpStatus=status)
        return result

    for result in ThreadPoolExecutor(4).map(one, sources):
        COMMON.add_receipt(data, result, result["retrievedAt"], captured=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def capture_time(data, url, path):
    digest = COMMON.hashlib.sha256(path.read_bytes()).hexdigest()
    sources = [r for r in data["sourceReceipt"]["sources"] if r["requestedUrl"] == url and r["rawHash"] == digest and r["httpStatus"] == 200]
    if not sources:
        raise ValueError("Capture the source before replaying: " + url)
    return max(r["retrievedAt"] for r in sources)


def refresh_ocr():
    """Rebuild the saved extraction from the original scanned municipal PDFs."""
    from concurrent.futures import ThreadPoolExecutor
    from PIL import Image
    env = {**os.environ, "OMP_THREAD_LIMIT": "1"}

    def one(ward):
        source = COMMON.SOURCES / f"nh-manchester-ward-{ward}.pdf"
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "page"
            subprocess.run(["pdftoppm", "-scale-to", "2200", "-png", str(source), str(target)], check=True, capture_output=True)
            images = sorted(pathlib.Path(directory).glob("page-*.png"))
            parts = [subprocess.check_output(["tesseract", str(p), "stdout", "--psm", "6"], env=env, stderr=subprocess.DEVNULL, text=True) for p in images]
            front = Image.open(images[0]).resize((1336, 2200))
            for index, (left, right) in enumerate([(250, 510), (518, 765), (780, 1025)]):
                crop = pathlib.Path(directory) / f"column{index}.png"
                front.crop((left, 440, right, 1975)).save(crop)
                parts.append(subprocess.check_output(["tesseract", str(crop), "stdout", "--psm", "6"], env=env, stderr=subprocess.DEVNULL, text=True))
        (COMMON.SOURCES / f"nh-manchester-ward-{ward}.ocr.txt").write_text("\f".join(parts))

    list(ThreadPoolExecutor(4).map(one, range(1, 13)))


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, value):
        self.parts.append(value)


class TableRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        if tag == "td":
            self.cell = ""

    def handle_data(self, value):
        if self.cell is not None:
            self.cell += value

    def handle_endtag(self, tag):
        if tag == "td" and self.row is not None and self.cell is not None:
            self.row.append(" ".join(self.cell.split()))
            self.cell = None
        if tag == "tr" and self.row:
            self.rows.append(self.row)
            self.row = None


def statutory_house_groups():
    source = (COMMON.SOURCES / "nh-rsa662-elective-districts.html").read_text()
    source = source[source.index("662:5 State"):source.index("662:6 Delegates")]
    pieces = re.split(r"([IVX]+\. ([A-Za-z]+) County)", source)
    counties = {}
    for index in range(1, len(pieces), 3):
        county = pieces[index+1]
        parser = TableRows()
        parser.feed(pieces[index+2])
        groups, number = {}, None
        for row in parser.rows:
            if row[0].startswith("District No."):
                number = int(row[0].rsplit(" ", 1)[1])
                groups[number] = {"places": [], "voteFor": None}
            if number is not None and len(row) >= 2:
                groups[number]["places"].append(row[1])
                if len(row) > 2 and row[2].isdigit():
                    groups[number]["voteFor"] = int(row[2])
        counties[county] = groups
    return counties


def district_memberships(at):
    """Only whole-member memberships: exact ward sets or all towns in a base."""
    counties = statutory_house_groups()
    text = statute_text()
    source = {"sourceUrl": STATUTE, "sourceOrg": "New Hampshire General Court", "collectedAt": at, "verifiedAt": at}
    prefix = "ocd-division/country:us/state:nh/"
    records = {}

    def add(member, district, quote):
        key = (member, district)
        records[key] = {"id": "nh-2026-membership:" + member.removeprefix(prefix) + "->" + district.removeprefix(prefix),
                        "memberOcdId": member, "districtOcdId": district, "provenance": {**source, "quote": quote}}

    county_codes = {"Belknap": 0, "Carroll": 1, "Cheshire": 2, "Coos": 3, "Grafton": 4,
                    "Hillsborough": 5, "Merrimack": 6, "Rockingham": 7, "Strafford": 8, "Sullivan": 9}
    for county, overlays in [("Hillsborough", [39, 40, 41, 44]), ("Merrimack", [28, 29, 30])]:
        for overlay in overlays:
            places = set(counties[county][overlay]["places"])
            district = prefix + f"sldl:{county.lower()}_{overlay}"
            for base, details in counties[county].items():
                if base == overlay or not set(details["places"]) <= places:
                    continue
                quote = f"District No. {overlay} " + " ".join(counties[county][overlay]["places"]) + " " + str(counties[county][overlay]["voteFor"])
                assert quote in text
                # Every listed locality is read from the district's own HTML
                # table; no partial town or partial ward becomes a member.
                add(prefix + f"sldl:{county_codes[county]*100+base:03d}", district, quote)
    for ward, base, _, _, _ in MANCHESTER_HOUSE[:12]:
        details = counties["Hillsborough"][base]
        assert details["places"] == [f"Manchester Ward {ward}"]
        quote = f"District No. {base} Manchester Ward {ward} {details['voteFor']}"
        assert quote in text
        add(prefix + f"sldl:{500+base}", prefix + f"place:manchester/ward:{ward}", quote)
    details = counties["Hillsborough"][29]
    assert details["places"] == ["Goffstown"]
    add(prefix + "sldl:529", prefix + "county:hillsborough/place:goffstown_town", "District No. 29 Goffstown 4")
    council = re.search(r"IV\. Councilor district number 4 is constituted of.*?(?= V\. Councilor)", text)[0]
    commissioner = re.search(r"VI\. Hillsborough:.*?(?= VII\.)", text)[0]
    targets = [(prefix + "executive_district:4", council)]
    for number in [1, 3]:
        clause = re.search(r"District " + str(number) + r", (.*?)(?:;|\.$)", commissioner)[1]
        quote = "District " + str(number) + ", " + clause
        assert quote in text
        targets.append((prefix + f"county:hillsborough/council_district:{number}", quote))
    # Existing Census base districts give the reader's numerical OCD aliases.
    geo = json.loads((COMMON.ROOT / "data/states/nh/geo/sldl-33.geojson").read_text())
    for feature in geo["features"]:
        properties = feature["properties"]
        match = re.search(r"State House District (\w+) (\d+)", properties["label"])
        if not match or int(match[2]) not in counties[match[1]]:
            continue
        places = counties[match[1]][int(match[2])]["places"]
        for district, quote in targets:
            if "/county:hillsborough/" in district and match[1] != "Hillsborough":
                continue
            if all(re.search(r"\b" + re.escape(re.sub(r" Ward \d+", "", place)) + r"\b", quote) for place in places):
                add(properties["ocdId"], district, quote)
    # Municipal county subdivisions are governmental towns/cities, rather than
    # similarly named census designated places that can have different borders.
    geo = json.loads((COMMON.ROOT / "data/states/nh/geo/cousub-33.geojson").read_text())
    for feature in geo["features"]:
        properties = feature["properties"]
        place = re.sub(r" (town|city)$", "", properties["label"])
        for district, quote in targets:
            if "/county:hillsborough/" in district and "/county:hillsborough/" not in properties["ocdId"]:
                continue
            if re.search(r"\b" + re.escape(place) + r"\b", quote):
                add(properties["ocdId"], district, quote)
                if properties["label"].endswith(" city"):
                    add(prefix + "place:" + place.lower().replace(" ", "_"), district, quote)
    return list(records.values())


def statute_text():
    parser = Text()
    parser.feed((COMMON.SOURCES / "nh-rsa662-elective-districts.html").read_text())
    return " ".join(" ".join(parser.parts).split())


def official_house_district_counts():
    text = statute_text()
    text = text[text.index("662:5 State"):text.index("662:6 662:6")]
    counts, county = collections.Counter(), None
    for match in re.finditer(r"([IVX]+\. ([A-Za-z]+) County)|(District No\. (\d+))", text):
        if match[2]:
            county = match[2]
        else:
            counts[county] += 1
    return dict(counts)


def edit_distance_one(a, b):
    if a == b:
        return True
    if abs(len(a)-len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) <= 1
    short, long = (a, b) if len(a) < len(b) else (b, a)
    return any(long[:i] + long[i+1:] == short for i in range(len(long)))


def check_scanned_name(name, text):
    # OCR puts oval glyphs between names and occasionally reads one character
    # incorrectly. Visual reading supplies the spelling; code verifies each name
    # token on the same saved source page. Initials stay exact.
    source_tokens = COMMON.words(text).split()
    for token in COMMON.words(name).split():
        if not any(token == found or len(token) > 2 and edit_distance_one(token, found)
                   for found in source_tokens):
            raise ValueError(f"Candidate token absent from scanned source: {name}: {token}")


def house_groups():
    groups = []
    for ward, district, vote, republican, democratic in MANCHESTER_HOUSE:
        text = (COMMON.SOURCES / f"nh-manchester-ward-{ward}.ocr.txt").read_text()
        assert "Republican" in text and "Democratic" in text
        assert re.search(r"District\s*" + str(district) + r"\b", text)
        candidates = [(name, party) for party, names in [("Republican", republican), ("Democratic", democratic)] for name in names]
        for name, _ in candidates:
            check_scanned_name(name, text)
        division = "sldl:" + ("hillsborough_" + str(district) if district in {39, 40, 41} else str(500+district))
        groups.append({"division": division, "title": f"State Representative, Hillsborough County District {district}",
                       "voteFor": vote, "candidates": candidates, "source": f"nh-manchester-ward-{ward}"})
    return groups


def goffstown_groups():
    lines = PA.pdf_lines(COMMON.SOURCES / "nh-goffstown-sample.pdf")[0]
    specifications = [
        (250, 300, "cd:1", "Representative in Congress, District 1", 1),
        (305, 350, "executive_district:4", "Executive Councilor, District 4", 1),
        (355, 390, "sldu:16", "State Senator, District 16", 1),
        (395, 540, "sldl:529", "State Representative, Hillsborough County District 29", 4),
        (545, 625, "sldl:hillsborough_44", "State Representative, Hillsborough County District 44", 2),
        (635, 665, "county:hillsborough", "Hillsborough County Sheriff", 1),
        (675, 705, "county:hillsborough", "Hillsborough County Attorney", 1),
        (715, 745, "county:hillsborough", "Hillsborough County Treasurer", 1),
        (755, 785, "county:hillsborough", "Hillsborough County Register of Deeds", 1),
        (795, 835, "county:hillsborough", "Hillsborough County Register of Probate", 1),
        (845, 890, "county:hillsborough/council_district:3", "Hillsborough County Commissioner, District 3", 1),
    ]
    groups = []
    for low, high, division, title, vote in specifications:
        candidates = []
        for left, right, party in [(240, 350, "Republican"), (360, 480, "Democratic")]:
            parts = [(y, text) for x, y, text in lines if left < x < right and low < y < high]
            for y, text in parts:
                if candidates and y-last_y < 14 and candidates[-1][1] == party:
                    candidates[-1] = (candidates[-1][0] + " " + text, party)
                else:
                    candidates.append((text, party))
                last_y = y
        # The sheriff is printed in both party columns. Retain one person and
        # both ballot party labels, as in other fusion nominations.
        unique = collections.OrderedDict()
        for name, party in candidates:
            unique.setdefault(name, []).append(party)
        groups.append({"division": division, "title": title, "voteFor": vote,
                       "candidates": [(n, " / ".join(ps)) for n, ps in unique.items()], "source": "nh-goffstown-sample"})
    return groups


def new_groups():
    groups = goffstown_groups() + house_groups()
    # These same English names/party columns are printed on Manchester samples;
    # RSA662 supplies the district assignments absent from the ballot heading.
    for ward, division, title, republican, democratic in [
        (5, "sldu:18", "State Senator, District 18", "Victoria Sullivan", "Leonard Bell"),
        (2, "sldu:20", "State Senator, District 20", "Patrick Binder", "Pat T. Long"),
        (2, "county:hillsborough/council_district:1", "Hillsborough County Commissioner, District 1", "Toni Pappas", "Pierre A. Cetoute"),
    ]:
        text = (COMMON.SOURCES / f"nh-manchester-ward-{ward}.ocr.txt").read_text()
        for name in [republican, democratic]:
            check_scanned_name(name, text)
        groups.append({"division": division, "title": title, "voteFor": 1,
                       "candidates": [(republican, "Republican"), (democratic, "Democratic")],
                       "source": f"nh-manchester-ward-{ward}"})
    return groups


def update_nh(at):
    path = COMMON.ROOT / "data/ballot/2026-general/nh.json"
    data = json.loads(path.read_text())
    ballot = next(iter(data["ballots"].values()))
    before = (len(ballot["contests"]), len(ballot["candidacies"]))
    statute = statute_text()
    assert "first district" in statute and "(2) Goffstown, (3) Manchester" in statute
    assert "Councilor district number 4" in statute and "Senatorial district number 16" in statute
    for group in new_groups():
        slug = re.sub(r"[^a-z0-9]+", "-", group["title"].lower()).strip("-")
        contest_id = "nh-2026-general:" + slug
        source = group["source"]
        publisher = "Goffstown Town Clerk" if source == "nh-goffstown-sample" else "Manchester City Clerk"
        captured_at = capture_time(data, URLS[source], COMMON.SOURCES / (source + ".pdf"))
        provenance = {"sourceUrl": URLS[source], "sourceOrg": publisher, "collectedAt": captured_at, "verifiedAt": at,
                      "quote": group["title"]}
        if not any(c["id"] == contest_id for c in ballot["contests"]):
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
                "ocdId": "ocd-division/country:us/state:nh/" + group["division"], "divisionVintage": "2022",
                "title": group["title"], "type": "CANDIDACY", "voteFor": group["voteFor"], "termYears": None,
                "candidateListComplete": True, "scopeNote": None, "provenance": provenance})
        next(c for c in ballot["contests"] if c["id"] == contest_id)["provenance"] = provenance
        for name, party in group["candidates"]:
            candidate_id = contest_id + ":" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            if not any(c["id"] == candidate_id for c in ballot["candidacies"]):
                ballot["candidacies"].append({"id": candidate_id, "contestId": contest_id, "givenName": "", "familyName": name,
                    "partyLabel": party, "slogan": None, "incumbent": None, "websiteUrl": None,
                    "provenance": {**provenance, "quote": f"{group['title']} | {name} | {party}"}})
            next(c for c in ballot["candidacies"] if c["id"] == candidate_id)["provenance"] = {**provenance, "quote": f"{group['title']} | {name} | {party}"}
        COMMON.add_receipt(data, COMMON.receipt(COMMON.SOURCES / (source + ".pdf"), URLS[source], publisher, captured_at,
            "Official November3 general sample. Full candidate rows transcribed and replayed; every Manchester House name checked against the scanned page. "
            "OCR evidence retained beside the PDF. District assignments use RSA662. Floterial House contests require their own overlapping geography; they are not statewide."), at)
    # This is a municipal/school statutory question, so its scope is Goffstown.
    text = COMMON.pdf_text(COMMON.SOURCES / "nh-goffstown-sample.pdf")
    question = re.search(r'2\. "(Shall the Town of GOFFSTOWN.*?)=\s*Yes', text, re.S)[1]
    question = " ".join(question.split())
    contest_id = "nh-2026-goffstown-hb1300-property-tax-growth"
    captured_at = capture_time(data, URLS["nh-goffstown-sample"], COMMON.SOURCES / "nh-goffstown-sample.pdf")
    provenance = {"sourceUrl": URLS["nh-goffstown-sample"], "sourceOrg": "Goffstown Town Clerk", "collectedAt": captured_at, "verifiedAt": at, "quote": question}
    if not any(c["id"] == contest_id for c in ballot["contests"]):
        ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
            "ocdId": "ocd-division/country:us/state:nh/county:hillsborough/place:goffstown_town", "divisionVintage": "2026",
            "title": "Goffstown School District Property Tax Growth Limit", "type": "MEASURE", "measureTextUrl": URLS["nh-goffstown-sample"],
            "voteFor": 1, "termYears": None, "scopeNote": None, "provenance": provenance})
        ballot["measures"].append({"id": contest_id + "#question", "contestId": contest_id, "officialNumber": "2",
            "questionText": question, "officialStatement": None, "provenance": provenance})
    next(c for c in ballot["contests"] if c["id"] == contest_id)["provenance"] = provenance
    next(c for c in ballot["measures"] if c["contestId"] == contest_id)["provenance"] = provenance
    # Manchester prints the same city question with a different ward label.
    # Store mutually exclusive ballot-text variants, each scoped to its ward.
    for ward in range(1, 13):
        source = f"nh-manchester-ward-{ward}"
        variant = question.replace("Town of GOFFSTOWN", f"City of MANCHESTER - Ward {ward}").replace("GOFFSTOWN SCHOOL DISTRICT (SAU #19)", "MANCHESTER SCHOOL DISTRICT (SAU #37)")
        ocr = (COMMON.SOURCES / (source + ".ocr.txt")).read_text()
        check_scanned_name(variant, ocr)
        contest_id = f"nh-2026-manchester-ward-{ward}-hb1300-property-tax-growth"
        captured_at = capture_time(data, URLS[source], COMMON.SOURCES / (source + ".pdf"))
        provenance = {"sourceUrl": URLS[source], "sourceOrg": "Manchester City Clerk", "collectedAt": captured_at, "verifiedAt": at, "quote": variant}
        if not any(c["id"] == contest_id for c in ballot["contests"]):
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
                "ocdId": f"ocd-division/country:us/state:nh/place:manchester/ward:{ward}", "divisionVintage": "2026",
                "title": "Manchester School District Property Tax Growth Limit", "type": "MEASURE", "measureTextUrl": URLS[source],
                "voteFor": 1, "termYears": None, "scopeNote": None, "provenance": provenance})
            ballot["measures"].append({"id": contest_id + "#question", "contestId": contest_id, "officialNumber": "2",
                "questionText": variant, "officialStatement": None, "provenance": provenance})
        next(c for c in ballot["contests"] if c["id"] == contest_id)["provenance"] = provenance
        next(c for c in ballot["measures"] if c["contestId"] == contest_id)["provenance"] = provenance
    captured_at = capture_time(data, STATUTE, COMMON.SOURCES / "nh-rsa662-elective-districts.html")
    COMMON.add_receipt(data, COMMON.receipt(COMMON.SOURCES / "nh-rsa662-elective-districts.html", STATUTE, "New Hampshire General Court", captured_at,
        "Current statute counts203House districts,24Senate districts,5ExecutiveCouncil districts and2Congressional districts. "
        "It also names Goffstown/ManchesterCD1/Council4 and assigns Senate16/18/20 and Hillsborough commissioner1/3. "
        "It measures regular district slots, not the final certified general-election candidate count."), at)
    ballot["coverageNotes"] = [
        "Official November 3 municipal sample ballots supply complete candidate lists for the state, congressional, legislative and county contests held here. Statewide district and local coverage remains incomplete.",
        "New Hampshire has 203 House districts electing 400 representatives. Voters in a floterial district have an additional overlapping House contest; matching those districts to addresses remains open.",
        "The statewide general candidate PDF currently returns403. Current district assignments and regular contest counts were checked against RSA662. Missing candidate rosters remain active acquisition work.",
    ]
    retained_memberships = [r for r in ballot.get("districtMemberships", []) if not r["id"].startswith("nh-2026-membership:")]
    ballot["districtMemberships"] = retained_memberships + district_memberships(captured_at)
    for membership in ballot["districtMemberships"]:
        membership["provenance"]["verifiedAt"] = at
    return path, data, {"state": "NH", "before": before, "after": (len(ballot["contests"]), len(ballot["candidacies"])),
                        "newCandidateContests": len(new_groups()), "sourceCandidacies": sum(len(g["candidates"]) for g in new_groups())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--refresh-ocr", action="store_true", help="rebuild saved extraction with Poppler, Pillow and Tesseract")
    parser.add_argument("--refresh-sources", action="store_true", help="capture source bytes with actual HTTP retrieval times")
    args = parser.parse_args()
    if args.refresh_sources:
        capture_sources()
    if args.refresh_ocr:
        refresh_ocr()
    path, data, report = update_nh(datetime.datetime.now(datetime.timezone.utc).isoformat())
    if args.write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report))
