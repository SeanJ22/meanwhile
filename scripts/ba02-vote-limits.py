"""Reproduce ballot vote limits from saved official instructions and scoped rules.

python scripts/ba02-vote-limits.py --write
python scripts/ba02-vote-limits.py --inventory-only

The normal scheduled assembler consumes the resulting state files. This replay
also serves the older source builders, so rebuilding a roster retains the same
verified voting instructions instead of replacing them with nulls.
"""
from pathlib import Path
from html.parser import HTMLParser
from collections import Counter
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba02-vote-limits"


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1

    def handle_data(self, text):
        if not self.skip:
            self.parts.append(text)


def clean(text):
    return " ".join(text.split())


def capture(name):
    path = EVIDENCE / name
    raw = path.read_bytes()
    receipt_path = path.with_name(name + ".source.json")
    if not receipt_path.exists():
        receipt_path = path.with_suffix(".source.json")
    meta = json.loads(receipt_path.read_text())
    # Earlier capture helpers used url/sha256 for the same receipt fields.
    meta = {**meta, "requestedUrl": meta.get("requestedUrl", meta.get("url")),
            "rawHash": meta.get("rawHash", meta.get("sha256"))}
    assert meta["httpStatus"] == 200
    assert hashlib.sha256(raw).hexdigest() == meta["rawHash"], name
    if name.endswith(".pdf"):
        text = subprocess.check_output(["pdftotext", "-raw", str(path), "-"]).decode()
    elif name.endswith(".html"):
        parser = Text()
        parser.feed(raw.decode())
        text = " ".join(parser.parts)
    else:
        text = raw.decode()
    return clean(text), meta


def source(name, quote, publisher, checked_text=None):
    text, meta = capture(name)
    assert clean(quote) in (checked_text or text), (name, quote)
    return {
        "sourceUrl": meta["finalUrl"], "sourceOrg": publisher,
        "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"],
        "quote": quote,
    }, {
        **{key: meta[key] for key in ("requestedUrl", "finalUrl", "retrievedAt", "httpStatus", "rawHash")},
        "publisher": publisher, "sourceClass": "OFFICIAL_PUBLISHER",
        "reviewedEvidence": quote,
        **({"captureMethod": meta["captureMethod"]} if meta.get("captureMethod") else {}),
    }


def hampton_instruction():
    """Read the white-on-blue instruction from page 3 of the saved specimen.

    The 2018 specimen supplies the local ballot rule, rather than candidate
    facts. Three current county term records independently establish its 2026
    application. The specimen's actual year remains in its source filename.
    """
    from PIL import Image
    capture("sc-hampton-2018-sample.pdf")
    with tempfile.TemporaryDirectory() as directory:
        prefix = str(Path(directory) / "hampton")
        subprocess.run(["pdftoppm", "-f", "3", "-l", "3", "-png", "-scale-to", "2400",
                        str(EVIDENCE / "sc-hampton-2018-sample.pdf"), prefix], check=True, capture_output=True)
        image = Image.open(prefix + "-3.png")
        width, height = image.size
        header = image.crop((int(.5 * width), int(.125 * height), int(.9 * width), int(.16 * height)))
        header = header.convert("L").point(lambda value: 0 if value > 175 else 255)
        output = str(Path(directory) / "instruction.png")
        header.save(output)
        text = subprocess.check_output(["tesseract", output, "stdout", "--psm", "6"],
                                       stderr=subprocess.DEVNULL, env={**os.environ, "OMP_THREAD_LIMIT": "1"}).decode()
        assert "County Council At Large" in text
        # OCR varies between "to" and "ta" on this printed instruction.
        assert re.search(r"up t[oa] Three", text), text
    return "County Council At Large Vote for up to Three"


def apply_sc_limits(package):
    ballot = next(iter(package["ballots"].values()))
    assert ballot["election"]["state"] == "SC" and ballot["election"]["date"] == "2026-11-03"
    sample_org = "Georgetown County Elections & Voter Registration"
    legislature = "South Carolina Legislature"
    receipts = {}

    def fact(name, quote, publisher=legislature, checked_text=None):
        provenance, receipt = source(name, quote, publisher, checked_text)
        receipts[(receipt["finalUrl"], receipt["rawHash"])] = receipt
        return provenance

    single = fact("sc-georgetown-samples.pdf", "Vote for one candidate in each contest unless otherwise indicated.", sample_org)
    soil = fact("sc-georgetown-samples.pdf", "Soil and Water District Commission Vote for up to Two", sample_org)
    soil_scope = fact("sc-soil-water-election-memo.pdf", "November 3, 2026 is General Election Day. Two positions on each conservation district board will be elected in the General Election.", "South Carolina Department of Natural Resources")
    house = fact("sc-code-t02c001.html", "Beginning with the 2024 General Election, one representative of the House of Representatives must be elected from each of the following districts:")
    senate = fact("sc-code-t02c001.html", "Commencing with the 2024 General Election, one member of the Senate must be elected from each of the following districts:")
    congress = fact("sc-code-t07c019.html", "each of such congressional districts shall be entitled to elect one member to represent this State in the Congress of the United States")
    county_offices = fact("sc-constitution-a05.pdf", "There shall be elected in each county by the electors thereof a clerk of the circuit court, a sheriff, and a coroner;")
    probate = fact("sc-code-t14c023.html", "There shall be a judge of probate for each probate court.")
    taxes = fact("sc-code-t04c009.html", "Under the council, council-supervisor and council-administrator forms of government provided for in this chapter the county treasurer and the county auditor shall be elected.")
    supervisor = fact("sc-code-t04c009.html", "The supervisor shall be a qualified elector of the county, elected at large from the county in the general election for a term of two or four years.")
    chair = fact("sc-code-t04c009.html", "In those counties in which the chairman of the governing body was elected at large as a separate office prior to the adoption of one of the alternate forms of government provided for in this chapter, the chairman shall continue to be so elected.")
    deeds = fact("sc-code-t30c005.html", "The registers of deeds in Berkeley and Dorchester counties are elected for terms of four years and until a successor is elected in the general election and qualifies.")
    charleston_deeds = fact("sc-charleston-rod.html", "The ROD, an elected official", "Charleston County Register of Deeds")
    chester = fact("sc-chester-council.web.txt", "At Large Erin Mosley Vice Chair", "Chester County")
    colleton = fact("sc-colleton-council.html", "Seat at Large, Vice Chairman Term Expires: 12/31/2026", "Colleton County")
    hampton = fact("sc-hampton-2018-sample.pdf", hampton_instruction(), "Hampton County Board of Voter Registration and Elections", "County Council At Large Vote for up to Three")
    hampton_terms = [fact("sc-hampton-council-" + str(index) + ".html", quote, "Hampton County") for index, quote in [
        (1, "Term: January 2023 - December 2026"), (2, "Term: January 2023 - December 2026"),
        (4, "Term: November 2024 - December 2026"),
    ]]
    by_title = {
        "Clerk of Court": county_offices, "Sheriff": county_offices, "Coroner": county_offices,
        "Probate Judge": probate, "Auditor": taxes, "County Treasurer": taxes,
        "County Supervisor": supervisor, "County Council Chair": chair,
    }
    statewide = {"Governor and Lieutenant Governor", "Secretary of State", "State Treasurer", "Attorney General",
                 "Comptroller General", "State Superintendent of Education", "Commissioner of Agriculture", "U.S. Senate"}
    rows = []
    for contest in ballot["contests"]:
        title, division = contest["title"], contest["ocdId"]
        if title == "Soil and Water District Commission":
            assert "/county:" in division
            count, sources = 2, [soil, soil_scope]
        elif title == "County Council at Large":
            county = division.rsplit(":", 1)[1]
            count, sources = {"chester": (1, [single, chester]), "colleton": (1, [single, colleton]),
                              "hampton": (3, [hampton, *hampton_terms])}[county]
        elif title in statewide:
            count, sources = 1, [single]
        elif title.startswith("State House of Representatives, District "):
            assert division.endswith("/sldl:" + title.rsplit(" ", 1)[1])
            count, sources = 1, [single, house]
        elif title.startswith("U.S. House of Representatives, District "):
            assert division.endswith("/cd:" + title.rsplit(" ", 1)[1])
            count, sources = 1, [single, congress]
        elif title == "State Senate District 15 (Unexpired Term)":
            assert division.endswith("/sldu:15")
            count, sources = 1, [single, senate]
        elif title == "Register of Deeds":
            county = division.rsplit(":", 1)[1]
            count, sources = 1, [single, {"berkeley": deeds, "charleston": charleston_deeds}[county]]
        elif title in by_title:
            assert "/county:" in division
            count, sources = 1, [single, by_title[title]]
        else:
            raise AssertionError(("Unverified SC voting instruction", contest["id"], title))
        contest["voteFor"], contest["voteForSources"] = count, sources
        rows.append({"id": contest["id"], "title": title, "ocdId": division, "voteFor": count,
                     "sources": [item["sourceUrl"] for item in sources]})
    receipt = package["sourceReceipt"]
    for item in receipts.values():
        identity = item["finalUrl"], item["rawHash"]
        if not any((old["finalUrl"], old["rawHash"]) == identity for old in receipt["sources"]):
            receipt["sources"].append(item)
    receipt["reviewedAt"] = max(item["retrievedAt"] for item in receipt["sources"])
    receipt["reviewedBy"] = "BA-02 official ballot voting instructions and scoped rules replay"
    return rows


def apply_as_limits(package):
    """Join the current certified roster to the ballot rule and exact seat map.

    The first constitutional table in the Governor's submission incorporates
    the five approved amendments. The later eleven-proposal table includes
    rejected changes and must not be used for the voting limits.
    """
    ballot = next(iter(package["ballots"].values()))
    assert ballot["election"]["state"] == "AS" and ballot["election"]["date"] == "2026-11-03"
    receipts = {}

    def fact(name, quote, publisher):
        provenance, receipt = source(name, quote, publisher)
        receipts[(receipt["finalUrl"], receipt["rawHash"])] = receipt
        return provenance

    certified_text, _ = capture("as-candidates.html")
    certified = fact("as-candidates.html", "The Commissioner of Elections has certified the following candidates for the Midterm Election scheduled for November 3, 2026.", "American Samoa Election Office")
    formula = fact("as-elections-ilo.pdf", "In multirace districts, the ballot shall state that the qualified elector shall not vote for more than the number of seats available or the number of candidates listed where such number is less than the seats available.", "American Samoa Code Annotated, reproduced by the International Labour Organization")
    # The current ballot statute separately identifies the sole territory-wide
    # delegate winner; it does not select multiple delegates by district.
    delegate = fact("as-delegate-usc2024.html", "The Territory of American Samoa shall be represented in the United States Congress by a nonvoting Delegate to the House of Representatives, elected as hereinafter provided.", "United States Government Publishing Office")
    delegate_ballot = fact("as-delegate-usc2024.html", "The Delegate shall be elected at large, by separate ballot, and by a plurality of the votes cast for the office of Delegate.", "United States Government Publishing Office")
    effective = fact("as-current-amendments-house.html", "The amendments are already approved by the people of American Samoa", "Office of Congresswoman Uifa’atali Amata")
    constitution, _ = capture("as-official-results-2022-house.pdf")
    intro = "The House of Representatives shall consist of twenty members elected from the following representative districts, the number of representatives from each of the districts to be as indicated:"
    start = constitution.index(intro)
    table = constitution[start:constitution.index("Senators and representatives shall be reapportioned", start)]
    seat_rows = list(re.finditer(r"Representative District No\. (\d+) (.*?)[:;] ([12]) Representatives?", table))
    seats = {int(row[1]): int(row[3]) for row in seat_rows}
    assert seats == {district: 2 if district in (1, 12, 15) else 1 for district in range(1, 18)}
    allocations = {int(row[1]): fact("as-official-results-2022-house.pdf", row[0], "Office of the Governor of American Samoa, submitted to the U.S. House of Representatives") for row in seat_rows}
    candidacies = {}
    for candidate in ballot["candidacies"]:
        candidacies.setdefault(candidate["contestId"], []).append(candidate)
    rows, districts = [], set()
    for contest in ballot["contests"]:
        candidates = candidacies[contest["id"]]
        division = contest["ocdId"]
        if division == "ocd-division/country:us/territory:as":
            assert contest["title"] == "Delegate to the United States Congress"
            section = certified_text.split("DELEGATE TO THE UNITED STATES CONGRESS", 1)[1].split("HOUSE OF REPRESENTATIVES", 1)[0]
            count, sources = 1, [certified, delegate, delegate_ballot]
        else:
            district = int(re.fullmatch(r"ocd-division/country:us/territory:as/sldl:(\d+)", division)[1])
            districts.add(district)
            header = re.search(r"Representative District #\s*" + str(district) + r"\s", certified_text)
            assert header, district
            section = certified_text[header.end():].split("Representative District #", 1)[0]
            count, sources = min(seats[district], len(candidates)), [certified, formula, allocations[district], effective]
        # Every published name must be printed in this exact certified office
        # section. The statute's explicit cap applies only after that join.
        assert candidates and all(candidate["familyName"] in section for candidate in candidates), contest["id"]
        contest["voteFor"], contest["voteForSources"] = count, sources
        rows.append({"id": contest["id"], "title": contest["title"], "ocdId": division, "voteFor": count,
                     "sources": [item["sourceUrl"] for item in sources]})
    assert districts == set(range(1, 18)) and len(rows) == 18
    ballot["coverageNotes"] = [note for note in ballot.get("coverageNotes", []) if note != "The Election Office certified list verifies the delegate and all 17 numbered House contests. We are working on official sample ballots, ballot questions and voting instructions."]
    receipt = package["sourceReceipt"]
    for item in receipts.values():
        identity = item["finalUrl"], item["rawHash"]
        if not any((old["finalUrl"], old["rawHash"]) == identity for old in receipt["sources"]):
            receipt["sources"].append(item)
    for item in receipt["sources"]:
        if item["finalUrl"] == certified["sourceUrl"]:
            item["reviewedEvidence"] = "The Commissioner of Elections certifies six delegate names and all 38 House names in 17 numbered districts for November 3, 2026. Each name is joined to its exact certified office; voting limits attach from the saved ballot rule, single-delegate statute and constitutional seat table. Unprinted party labels remain null."
    receipt["reviewedAt"] = max(item["retrievedAt"] for item in receipt["sources"])
    receipt["reviewedBy"] = "BA-02 current certified roster joined to official ballot rule and constitutional seats"
    return rows


def missing_count_inventory():
    """Scan one state at a time; keep only the missing fields in the report."""
    missing = []
    for path in sorted((ROOT / "data/ballot/2026-general").glob("*.json")):
        package = json.loads(path.read_text())
        for ballot in package["ballots"].values():
            for contest in ballot["contests"]:
                if contest.get("voteFor") is None:
                    missing.append({"state": ballot["election"]["state"], "electionId": ballot["election"]["id"],
                                    "id": contest["id"], "title": contest["title"], "type": contest["type"], "ocdId": contest["ocdId"]})
    return {"total": len(missing), "byState": dict(sorted(Counter(row["state"] for row in missing).items())),
            "byType": dict(sorted(Counter(row["type"] for row in missing).items())), "races": missing}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--inventory-only", action="store_true")
    args = parser.parse_args()
    if not args.inventory_only:
        path = ROOT / "data/ballot/2026-general/sc.json"
        package = json.loads(path.read_text())
        rows = apply_sc_limits(package)
        assert len(rows) == 298 and Counter(row["voteFor"] for row in rows) == {1: 254, 2: 43, 3: 1}
        if args.write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
            (ROOT / "data/ballot/reports/ba02-sc-vote-limits.json").write_text(json.dumps(rows, indent=2) + "\n")
        print("SC: 298 verified limits; 254 vote-for-1, 43 vote-for-2, 1 vote-for-3")
        path = ROOT / "data/ballot/2026-general/as.json"
        package = json.loads(path.read_text())
        rows = apply_as_limits(package)
        assert Counter(row["voteFor"] for row in rows) == {1: 15, 2: 3}
        if args.write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
            (ROOT / "data/ballot/reports/ba02-as-vote-limits.json").write_text(json.dumps(rows, indent=2) + "\n")
        print("AS: 18 verified limits; 15 vote-for-1, 3 vote-for-2")
    inventory = missing_count_inventory()
    if args.write or args.inventory_only:
        (ROOT / "data/ballot/reports/ba02-missing-vote-counts.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"remainingNullCounts": inventory["total"], "byState": inventory["byState"]}))
