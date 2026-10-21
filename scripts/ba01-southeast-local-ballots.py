"""Replay the saved official Southeast ballot documents into state packages.

Usage: python scripts/ba01-southeast-local-ballots.py --captures DIR [--write]
DIR contains captured documents and their .meta.json files.
Requires openpyxl, pandas for Delaware tables, and pdftotext for PDF captures.
The source documents remain the authority; district names
must match the existing registration data before a local record is added.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import pathlib
import re
import subprocess
import xml.etree.ElementTree as ET
from collections import defaultdict

import openpyxl

import runpy

capture_sha256 = runpy.run_path(str(pathlib.Path(__file__).with_name("ba01_evidence.py")))["capture_sha256"]

ROOT = pathlib.Path(__file__).resolve().parents[1]


def normalized(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")


def capture_bytes(captures, key):
    path = captures / key
    return path.read_bytes() if path.exists() else gzip.decompress((captures / (key + ".gz")).read_bytes())


def pdf_text(captures, key):
    meta = json.loads((captures / (key + ".meta.json")).read_text())
    saved = captures / (key + ".layout.txt.gz")
    if saved.exists():
        text = gzip.decompress(saved.read_bytes()).decode()
        assert hashlib.sha256(text.encode()).hexdigest() == meta["convertedTextHash"]
        return text, meta
    raw = capture_bytes(captures, key)
    assert capture_sha256(raw) == meta["rawHash"]
    return subprocess.check_output(["pdftotext", "-layout", "-", "-"], input=raw).decode(), meta


def source(captures, key, publisher):
    raw = capture_bytes(captures, key)
    meta = json.loads((captures / (key + ".meta.json")).read_text())
    assert capture_sha256(raw) == meta["rawHash"]
    assert meta["httpStatus"] == 200
    workbook = openpyxl.load_workbook(io.BytesIO(raw), data_only=True)
    rows = iter(workbook.active.values)
    headings = next(rows)
    records = [dict(zip(headings, row)) for row in rows]
    receipt = {
        "requestedUrl": meta["url"], "finalUrl": meta["finalUrl"],
        "publisher": publisher, "sourceClass": "ELECTION_AUTHORITY",
        "retrievedAt": meta["retrievedAt"], "httpStatus": 200,
        "rawHash": meta["rawHash"],
        "reviewedEvidence": "Replayed exact office, jurisdiction, candidate name, party, incumbency, seat count and official question cells from the saved November 3, 2026 workbook. No campaign mailing addresses were projected.",
    }
    provenance = {
        "sourceUrl": meta["finalUrl"], "sourceOrg": publisher,
        "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"],
    }
    return records, receipt, provenance


def virginia(captures, write):
    path = ROOT / "data/ballot/2026-general/va.json"
    package = json.loads(path.read_text())
    ballot = next(iter(package["ballots"].values()))
    registry = json.loads((ROOT / "data/derived/registration/va.json").read_text())["divisions"]
    by_label = defaultdict(list)
    for division in registry:
        by_label[normalized(division[3])].append(division)

    def locality(label):
        matches = [d for d in by_label[normalized(label)] if d[1] == "county"]
        return matches[0] if len(matches) == 1 else None

    def jurisdiction(row):
        county = locality(row["Locality"])
        district = str(row.get("District") or "").strip()
        if not county:
            return None
        if district.startswith("Town of "):
            matches = [d for d in by_label[normalized(district[8:] + " town")] if d[1] == "place"]
        elif normalized(district) == normalized(row["Locality"]):
            matches = [county]
        elif district == "At-Large" or (not district and "At Large" in row["Office Title"]):
            matches = [county]
        else:
            matches = [d for d in by_label[normalized(district)]
                       if d[1] == "cousub" and d[0].startswith(county[0] + "/")]
        return matches[0] if len(matches) == 1 else None

    records, candidate_receipt, candidate_provenance = source(captures, "va-2", "Virginia Department of Elections")
    groups = defaultdict(list)
    unresolved = set()
    federal = set()
    for row in records:
        title = str(row.get("Office Title") or "").strip()
        if not title:
            continue
        if title in ("Member, United States Senate", "Member, House of Representatives", "Member, House of Delegates"):
            federal.add((title, row["District"], row["Candidate Name"], row["Candidate Party"]))
            continue
        division = jurisdiction(row)
        if not division:
            unresolved.add((row["Locality"], title, str(row.get("District") or "")))
            continue
        key = (division[0], title, str(row.get("Office Term") or ""), str(row.get("Special Office Unexpired Term End Date") or ""))
        groups[key].append(row)

    old_contests = len(ballot["contests"])
    old_candidates = len(ballot["candidacies"])
    old_measures = len(ballot["measures"])
    existing = {(c["ocdId"], c["title"]): c for c in ballot["contests"]}
    added_by_county = defaultdict(lambda: {"contests": 0, "candidacies": 0, "measures": 0})
    for (division, title, term, expires), rows in sorted(groups.items()):
        district = str(rows[0].get("District") or "").strip()
        displayed_title = title + (" — " + district if district and district not in title else "")
        if (division, displayed_title) in existing:
            continue
        identifier = "va-local-2026-" + hashlib.sha256(json.dumps([division, title, term, expires]).encode()).hexdigest()[:20]
        unique = {}
        for row in rows:
            unique[(row["Candidate Name"], row["Candidate Party"])] = row
        seats = {r["Number of Seats"] for r in unique.values()}
        assert len(seats) == 1 and all(r["Candidate Name"] for r in unique.values())
        term_match = re.fullmatch(r"(\d+) year", term)
        ballot["contests"].append({
            "id": identifier, "electionId": ballot["election"]["id"], "ocdId": division,
            "divisionVintage": "TIGER_GENZ2025", "title": displayed_title,
            "type": "CANDIDACY", "voteFor": int(next(iter(seats))),
            "termYears": int(term_match[1]) if term_match else None,
            "candidateListComplete": True, "scopeNote": None,
            "provenance": {**candidate_provenance, "quote": title + " | " + district},
        })
        count = added_by_county[rows[0]["Locality"]]
        count["contests"] += 1
        for (name, party), row in sorted(unique.items()):
            ballot["candidacies"].append({
                "id": identifier + ":" + hashlib.sha256(json.dumps([name, party]).encode()).hexdigest()[:16],
                "contestId": identifier, "givenName": "", "familyName": name,
                "partyLabel": party or None, "slogan": None,
                "incumbent": {"Yes": True, "No": False}.get(row["Incumbent"]),
                "websiteUrl": row["Campaign Website"] or None,
                "provenance": {**candidate_provenance, "quote": " | ".join([title, district, name, party or ""])},
            })
            count["candidacies"] += 1

    referendums, measure_receipt, measure_provenance = source(captures, "va-3", "Virginia Department of Elections")
    for row in referendums:
        if row.get("Active") != "Yes" or row.get("Referendum Area") != "Locality":
            continue
        division = locality(row["Locality"])
        if not division:
            continue
        title = row["Referendum Title"]
        if (division[0], title) in existing:
            continue
        question = row["Referendum Text"]
        assert isinstance(question, str) and question.strip()
        identifier = "va-local-measure-2026-" + hashlib.sha256(json.dumps([division[0], title]).encode()).hexdigest()[:20]
        if any(c["id"] == identifier for c in ballot["contests"]):
            continue
        ballot["contests"].append({
            "id": identifier, "electionId": ballot["election"]["id"], "ocdId": division[0],
            "divisionVintage": "TIGER_GENZ2025", "title": title, "type": "MEASURE",
            "measureTextUrl": measure_provenance["sourceUrl"], "voteFor": 1,
            "termYears": None, "scopeNote": None, "provenance": measure_provenance,
        })
        ballot["measures"].append({
            "id": identifier + ":question", "contestId": identifier,
            "questionText": question, "officialStatement": None, "provenance": measure_provenance,
        })
        count = added_by_county[row["Locality"]]
        count["contests"] += 1
        count["measures"] += 1

    for receipt in [candidate_receipt, measure_receipt]:
        if not any(r["finalUrl"] == receipt["finalUrl"] and r["rawHash"] == receipt["rawHash"] and r["retrievedAt"] == receipt["retrievedAt"] for r in package["sourceReceipt"]["sources"]):
            package["sourceReceipt"]["sources"].append(receipt)
    package["sourceReceipt"]["reviewedAt"] = max(candidate_receipt["retrievedAt"], measure_receipt["retrievedAt"])
    package["sourceReceipt"]["reviewedBy"] = "BA-01 official workbook replay"
    if write:
        path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
    return {"state": "VA", "officialFederalAndLegislativeContests": len({r[:2] for r in federal}),
            "officialFederalAndLegislativeCandidacies": len(federal),
            "addedContests": len(ballot["contests"]) - old_contests,
            "addedCandidacies": len(ballot["candidacies"]) - old_candidates,
            "addedMeasures": len(ballot["measures"]) - old_measures,
            "byLocality": dict(added_by_county), "unresolvedLocalJurisdictions": sorted(unresolved)}


def district_of_columbia(captures, write):
    path = ROOT / "data/ballot/2026-general/dc.json"
    package = json.loads(path.read_text())
    ballot = next(iter(package["ballots"].values()))
    raw = capture_bytes(captures, "dc-3")
    meta = json.loads((captures / "dc-3.meta.json").read_text())
    assert meta["rawHash"] == capture_sha256(raw) and meta["httpStatus"] == 200
    page = subprocess.check_output(["pdftotext", "-layout", "-", "-"], input=raw).decode()
    aliases = {
        "Delegate to the U.S. House of Representatives": "Delegate to the House of Representatives",
        "Mayor of the District of Columbia": "Mayor of the District of Columbia",
        "Chairman of the Council": "Chairman of the Council of the District of Columbia",
        "At-Large Member of the Council": "At-Large Member of the Council",
    }
    by_title = {c["title"]: c for c in ballot["contests"]}
    held = {(c["contestId"], normalized(c["givenName"] + " " + c["familyName"])) for c in ballot["candidacies"]}
    added = []
    corrected = []
    registered_count = 0
    anc_count = 0
    for line in page.splitlines():
        cells = re.split(r"\s{2,}", line.strip())
        if len(cells) < 3:
            continue
        name, office, party = cells[:3]
        if office.startswith("ANC "):
            anc_count += 1
            continue
        if office not in aliases:
            continue
        registered_count += 1
        contest = by_title[aliases[office]]
        provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": "District of Columbia Board of Elections",
                      "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"],
                      "quote": " | ".join([name, office, party])}
        if (contest["id"], normalized(name)) in held:
            prior = next(row for row in ballot["candidacies"] if row["contestId"] == contest["id"] and normalized(row["givenName"] + " " + row["familyName"]) == normalized(name))
            if prior["partyLabel"] != (None if party == "N/A" else party):
                corrected.append({"name": name, "previousParty": prior["partyLabel"], "officialParty": party})
                prior["partyLabel"] = None if party == "N/A" else party
                prior["provenance"] = provenance
            continue
        ballot["candidacies"].append({
            "id": contest["id"] + ":" + slug(name), "contestId": contest["id"],
            "givenName": "", "familyName": name, "partyLabel": None if party == "N/A" else party,
            "slogan": "Declared write-in", "incumbent": None, "websiteUrl": None,
            "provenance": provenance,
        })
        added.append(name)
    assert registered_count == 15
    if added or corrected:
        receipt = {
            "requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "httpStatus": 200,
            "rawHash": meta["rawHash"], "retrievedAt": meta["retrievedAt"],
            "publisher": "District of Columbia Board of Elections", "sourceClass": "ELECTION_AUTHORITY",
            "reviewedEvidence": "All 15 registered write-in candidates for the existing District-wide contests replayed from the current official list. ANC write-ins remain separate local coverage work. Only name, contest, stated party and write-in designation projected.",
        }
        if receipt not in package["sourceReceipt"]["sources"]:
            package["sourceReceipt"]["sources"].append(receipt)
        package["sourceReceipt"]["reviewedAt"] = meta["retrievedAt"]
        package["sourceReceipt"]["reviewedBy"] = "BA-01 current official write-in list replay"
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
    return {"state": "DC", "officialDistrictWriteInCandidates": registered_count,
            "addedCandidacies": added, "correctedParties": corrected, "localANCWriteInsNotYetMapped": anc_count}


def north_carolina(captures, write):
    path = ROOT / "data/ballot/2026-general/nc.json"
    package = json.loads(path.read_text())
    ballot = next(iter(package["ballots"].values()))
    raw = capture_bytes(captures, "nc-1")
    meta = json.loads((captures / "nc-1.meta.json").read_text())
    assert capture_sha256(raw) == meta["rawHash"] and meta["httpStatus"] == 200
    records = [r for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))) if r["election_dt"] == "11/03/2026"]
    registry = json.loads((ROOT / "data/derived/registration/nc.json").read_text())["divisions"]
    counties = {normalized(d[3].removesuffix(" County")): d[0] for d in registry if d[1] == "county"}
    places = defaultdict(list)
    for division in registry:
        if division[1] == "place" and division[3].endswith((" city", " town", " village")):
            places[normalized(division[3].rsplit(" ", 1)[0])].append(division[0])
    groups = defaultdict(list)
    official_state = set()
    court_raw = capture_bytes(captures, "nc-court-meck")
    court_meta = json.loads((captures / "nc-court-meck.meta.json").read_text())
    assert hashlib.sha256(court_raw).hexdigest() == court_meta["rawHash"]
    court_text = " ".join(re.sub(r"<[^>]+>", " ", court_raw.decode()).split())
    assert "District Court District 26" in court_text and "Prosecutorial District 26" in court_text
    for row in records:
        title = row["contest_name"]
        if title.startswith(("US ", "NC STATE SENATE", "NC HOUSE OF REPRESENTATIVES", "NC SUPREME", "NC COURT OF APPEALS")):
            official_state.add((title, row["name_on_ballot"], row["party_candidate"]))
            continue
        county_name = row["county_name"]
        county = counties.get(normalized(county_name))
        county_titles = {
            county_name + " COUNTY CLERK OF SUPERIOR COURT",
            county_name + " COUNTY SHERIFF",
            county_name + " COUNTY BOARD OF COMMISSIONERS AT-LARGE",
            county_name + " SOIL AND WATER CONSERVATION DISTRICT SUPERVISOR",
        }
        division = county if title in county_titles else None
        if county_name == "MECKLENBURG" and (title == "DISTRICT ATTORNEY DISTRICT 26" or re.fullmatch(r"NC DISTRICT COURT JUDGE DISTRICT 26 SEAT \d+(?: \(UNEXPIRED\))?", title)):
            division = county
        city = re.fullmatch(r"(?:CITY|TOWN|VILLAGE) OF (.+?) (MAYOR|CITY COUNCIL AT-LARGE|TOWN COUNCIL AT-LARGE)", title)
        if city:
            choices = places[normalized(city[1])]
            if len(choices) == 1:
                division = choices[0]
        if division:
            groups[(division, title)].append(row)
    by_id = {c["id"]: c for c in ballot["contests"]}
    existing_state = {(normalized(by_id[c["contestId"]]["title"]), normalized(c["givenName"] + " " + c["familyName"]), c["partyLabel"])
                      for c in ballot["candidacies"]}
    state_missing = [r for r in official_state if (normalized(r[0]), normalized(r[1]), r[2]) not in existing_state]
    assert not state_missing, state_missing
    old_contests, old_candidates = len(ballot["contests"]), len(ballot["candidacies"])
    existing = {(c["ocdId"], c["title"]) for c in ballot["contests"]}
    count_by_county = defaultdict(lambda: {"contests": 0, "candidacies": 0})
    provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": "North Carolina State Board of Elections",
                  "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"]}
    for (division, title), rows in sorted(groups.items()):
        if (division, title) in existing:
            continue
        unique = {(r["name_on_ballot"], r["party_candidate"]): r for r in rows}
        seats = {r["vote_for"] for r in rows}
        terms = {r["term"] for r in rows}
        assert len(seats) == 1 and len(terms) == 1 and all(name for name, party in unique)
        identifier = "nc-local-2026-" + hashlib.sha256(json.dumps([division, title]).encode()).hexdigest()[:20]
        term = next(iter(terms))
        ballot["contests"].append({
            "id": identifier, "electionId": ballot["election"]["id"], "ocdId": division,
            "divisionVintage": "TIGER_GENZ2025", "title": title, "type": "CANDIDACY",
            "voteFor": int(next(iter(seats))), "termYears": int(term) if term.isdigit() else None,
            "candidateListComplete": True, "scopeNote": None,
            "provenance": {**provenance, "quote": title},
        })
        count = count_by_county[rows[0]["county_name"]]
        count["contests"] += 1
        for (name, party), row in sorted(unique.items()):
            ballot["candidacies"].append({
                "id": identifier + ":" + hashlib.sha256(json.dumps([name, party]).encode()).hexdigest()[:16],
                "contestId": identifier, "givenName": "", "familyName": name,
                "partyLabel": party or None, "slogan": None, "incumbent": None, "websiteUrl": None,
                "provenance": {**provenance, "quote": " | ".join([title, name, party])},
            })
            count["candidacies"] += 1
    sample_raw = capture_bytes(captures, "nc-meck-B0009")
    sample_meta = json.loads((captures / "nc-meck-B0009.meta.json").read_text())
    assert hashlib.sha256(sample_raw).hexdigest() == sample_meta["rawHash"]
    official_root = capture_bytes(captures, "nc-meck-election-root")
    root_meta = json.loads((captures / "nc-meck-election-root.meta.json").read_text())
    assert hashlib.sha256(official_root).hexdigest() == root_meta["rawHash"] and b"apps.meckboe.org" in official_root
    sample_text = subprocess.check_output(["pdftotext", "-f", "2", "-l", "2", "-bbox", "-", "-"], input=sample_raw)
    tree = ET.fromstring(sample_text)
    words = [word for word in tree.iter() if word.tag.endswith("}word") and float(word.attrib["yMin"]) >= 75]
    for start, end, title in [(130, 250, "Transportation Bonds"), (250, 367, "Housing Bonds"), (367, 490, "Neighborhood Improvement Bonds")]:
        column = [word for word in words if start <= float(word.attrib["xMin"]) < end]
        column.sort(key=lambda word: (round(float(word.attrib["yMin"]) / 2), float(word.attrib["xMin"])))
        question = " ".join(word.text or "" for word in column).split(" Yes ")[0].strip()
        assert question.startswith("Additional property taxes") and question.endswith("be $0.00 per year.") and "Shall the order authorizing" in question
        division = "ocd-division/country:us/state:nc/place:charlotte"
        assert any(d[0] == division for d in registry)
        displayed_title = "City of Charlotte — " + title
        if (division, displayed_title) in existing:
            continue
        identifier = "nc-local-measure-2026-" + slug(title)
        measure_provenance = {"sourceUrl": sample_meta["finalUrl"], "sourceOrg": "Mecklenburg County Board of Elections",
                              "collectedAt": sample_meta["retrievedAt"], "verifiedAt": sample_meta["retrievedAt"]}
        ballot["contests"].append({
            "id": identifier, "electionId": ballot["election"]["id"], "ocdId": division,
            "divisionVintage": "TIGER_GENZ2025", "title": displayed_title, "type": "MEASURE",
            "measureTextUrl": sample_meta["finalUrl"], "voteFor": 1, "termYears": None,
            "scopeNote": None, "provenance": measure_provenance,
        })
        ballot["measures"].append({"id": identifier + ":question", "contestId": identifier,
                                  "questionText": question, "officialStatement": None, "provenance": measure_provenance})
    if len(ballot["contests"]) > old_contests:
        package["sourceReceipt"]["sources"].append({
            "requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "httpStatus": 200,
            "rawHash": meta["rawHash"], "retrievedAt": meta["retrievedAt"],
            "publisher": "North Carolina State Board of Elections", "sourceClass": "ELECTION_AUTHORITY",
            "reviewedEvidence": "Replayed November 3 rows only. All 189 federal/statewide/legislative candidate contests and 366 candidates match the held package. County-wide and municipal at-large offices use exact registered county/place labels. Mecklenburg District Court 26 and prosecutor jurisdiction match the Judicial Branch county page and the sample ballot; superior court electoral subdivisions remain separate.",
        })
        for other_meta, publisher, source_class, reviewed in [
            (sample_meta, "Mecklenburg County Board of Elections", "ELECTION_AUTHORITY", "Current official sample ballot B0009, linked from the county government's voter lookup, provides exact full Charlotte bond questions and the Mecklenburg local races."),
            (root_meta, "Mecklenburg County Board of Elections", "ELECTION_AUTHORITY", "The official .gov Board of Elections homepage links apps.meckboe.org for sample ballots, establishing its government publishing authority."),
            (court_meta, "North Carolina Judicial Branch", "OFFICIAL_PUBLISHER", "The Mecklenburg County court page explicitly identifies District Court District 26 and Prosecutorial District 26 for the county; superior court electoral subdivisions are not widened."),
        ]:
            package["sourceReceipt"]["sources"].append({"requestedUrl": other_meta["url"], "finalUrl": other_meta["finalUrl"],
                "httpStatus": 200, "rawHash": other_meta["rawHash"], "retrievedAt": other_meta["retrievedAt"],
                "publisher": publisher, "sourceClass": source_class, "reviewedEvidence": reviewed})
        unique_receipts = {}
        for receipt in package["sourceReceipt"]["sources"]:
            unique_receipts[(receipt["requestedUrl"], receipt["finalUrl"], receipt["rawHash"], receipt["retrievedAt"])] = receipt
        package["sourceReceipt"]["sources"] = list(unique_receipts.values())
        package["sourceReceipt"]["reviewedAt"] = meta["retrievedAt"]
        package["sourceReceipt"]["reviewedBy"] = "BA-01 exact official local candidate CSV replay"
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
    return {"state": "NC", "officialFederalStateLegislativeContests": len({r[0] for r in official_state}),
            "officialFederalStateLegislativeCandidacies": len(official_state), "missingFederalStateLegislativeCandidacies": state_missing,
            "addedContests": len(ballot["contests"]) - old_contests,
            "addedCandidacies": len(ballot["candidacies"]) - old_candidates, "byCounty": dict(count_by_county)}


def maryland(captures, write):
    path = ROOT / "data/ballot/2026-general/md.json"
    package = json.loads(path.read_text())
    ballot = next(iter(package["ballots"].values()))
    registry = json.loads((ROOT / "data/derived/registration/md.json").read_text())["divisions"]
    counties = {}
    for division in registry:
        if division[1] == "county":
            counties[normalized(division[3].removesuffix(" County"))] = division[0]
    groups = defaultdict(list)
    sources = []
    for key in ["md-local-browser-ua", "md-30"]:
        raw = capture_bytes(captures, key)
        meta = json.loads((captures / (key + ".meta.json")).read_text())
        assert capture_sha256(raw) == meta["rawHash"] and meta["httpStatus"] == 200
        records = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        sources.append(meta)
        for row in records:
            if row["Candidate Status"] != "Active":
                continue
            title = row["Office Name"]
            district = row["Contest Run By District Name and Number"]
            division = counties.get(normalized(district)) if key == "md-local-browser-ua" else None
            seats = None
            kind = "CANDIDACY"
            if title in ["Mayor - City of Cumberland", "Council - City of Cumberland"]:
                division = "ocd-division/country:us/state:md/place:cumberland"
            if row["Candidate Residential Jurisdiction"] == "Montgomery County":
                if title == "Board of Education" and district in ["Board of Education District 1", "Board of Education District 3", "Board of Education District 5"]:
                    division = counties["montgomery"]
                    title += " — " + district
                    seats = 1
                if title == "Judge of the Circuit Court":
                    division = counties["montgomery"]
                    title += " — Circuit 6, Montgomery County"
                    seats = 4
                if title in ["County Executive", "Clerk of the Circuit Court", "Register of Wills", "Sheriff", "State's Attorney", "Board of Education At Large"]:
                    seats = 1
                if title == "County Council At Large":
                    seats = 4
            if key == "md-30" and title == "Justice Supreme Court of Maryland" and district == "Appellate Circuit 4":
                division = counties["princegeorge's"] if "princegeorge's" in counties else counties[normalized("Prince George's")]
                title += " — Appellate Circuit 4"
                seats = 1
                kind = "RETENTION"
            if division:
                groups[(division, title, kind, seats, key)].append(row)

    # County ballot bundles establish that these offices appear on every style,
    # including school-board seats whose district is a candidate residence rule.
    text, sample_meta = pdf_text(captures, "md-15")
    styles = text.count("End of Ballot")
    assert styles == 257
    for name in ["Brenda M. Diaz", "Grace Rivera-Oven", "Sally A. McCarthy", "Elma-Lorraine Diggs", "Sharon V. Burrell", "Victor M. Del Pino", "James J. Dietrich", "Catherine H. McQueen"]:
        assert text.count(name) == styles
    pg_text, pg_meta = pdf_text(captures, "md-pg")
    assert pg_text.count("Peter Killough") == 2 * pg_text.count("End of Ballot") == 654
    sources.extend([sample_meta, pg_meta])

    old_contests, old_candidates = len(ballot["contests"]), len(ballot["candidacies"])
    existing = {(c["ocdId"], c["title"]) for c in ballot["contests"]}
    for (division, title, kind, seats, key), rows in sorted(groups.items(), key=lambda item: str(item[0])):
        if (division, title) in existing:
            continue
        meta = next(m for m in sources if m["url"] == json.loads((captures / (key + ".meta.json")).read_text())["url"])
        provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": "Maryland State Board of Elections",
                      "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"]}
        identifier = "md-local-2026-" + hashlib.sha256(json.dumps([division, title]).encode()).hexdigest()[:20]
        ballot["contests"].append({
            "id": identifier, "electionId": ballot["election"]["id"], "ocdId": division,
            "divisionVintage": "TIGER_GENZ2025", "title": title, "type": kind,
            "voteFor": seats, "termYears": None, "candidateListComplete": True,
            "scopeNote": "Vote Yes or No for continuance in office." if kind == "RETENTION" else None,
            "provenance": {**provenance, "quote": title + " | " + rows[0]["Contest Run By District Name and Number"]},
        })
        for row in rows:
            name = (row["Candidate First Name and Middle Name"] + " " + row["Candidate Ballot Last Name and Suffix"]).strip()
            party = row["Office Political Party"] or None
            ballot["candidacies"].append({
                "id": identifier + ":" + hashlib.sha256(json.dumps([name, party]).encode()).hexdigest()[:16],
                "contestId": identifier, "givenName": row["Candidate First Name and Middle Name"],
                "familyName": row["Candidate Ballot Last Name and Suffix"], "partyLabel": party,
                "slogan": "Declared write-in" if row["Filing Type and Date"].startswith("Write-In") else None,
                "incumbent": True if kind == "RETENTION" else None, "websiteUrl": row["Website"] or None,
                "provenance": {**provenance, "quote": " | ".join([title, row["Contest Run By District Name and Number"], name, party or ""])},
            })
    if len(ballot["contests"]) > old_contests:
        for meta in sources:
            package["sourceReceipt"]["sources"].append({
                "requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "httpStatus": 200,
                "rawHash": meta["rawHash"], "retrievedAt": meta["retrievedAt"],
                "publisher": "Maryland State Board of Elections", "sourceClass": "ELECTION_AUTHORITY",
                "reviewedEvidence": "Exact active candidate rows replayed from official general-election CSVs. Montgomery county-wide judicial and board-of-education scope checked across all 257 certified ballot styles; Supreme Court Circuit 4 retention appears in all 327 Prince George's styles. Unresolved local electoral districts were not widened to county scope.",
            })
        package["sourceReceipt"]["reviewedAt"] = max(m["retrievedAt"] for m in sources)
        package["sourceReceipt"]["reviewedBy"] = "BA-01 official local CSV and certified ballot replay"
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
    return {"state": "MD", "addedContests": len(ballot["contests"]) - old_contests,
            "addedCandidacies": len(ballot["candidacies"]) - old_candidates,
            "montgomerySampleBallotStyles": styles, "princeGeorgesSampleBallotStyles": pg_text.count("End of Ballot")}


def county_offices(captures, state, write):
    path = ROOT / ("data/ballot/2026-general/" + state + ".json")
    package = json.loads(path.read_text())
    ballot = next(iter(package["ballots"].values()))
    registry = json.loads((ROOT / ("data/derived/registration/" + state + ".json")).read_text())["divisions"]
    counties = {normalized(d[3].removesuffix(" County")): d[0] for d in registry if d[1] == "county"}
    groups = defaultdict(list)
    key = "sc-session-export" if state == "sc" else "de-3"
    raw = capture_bytes(captures, key)
    meta = json.loads((captures / (key + ".meta.json")).read_text())
    assert capture_sha256(raw) == meta["rawHash"] and meta["httpStatus"] == 200
    if state == "sc":
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        countywide = {"Probate Judge", "Auditor", "County Treasurer", "Sheriff", "Coroner", "Clerk of Court",
                      "County Supervisor", "County Council Chair", "County Council at Large", "Register of Deeds",
                      "Soil and Water District Commission"}
        for row in rows:
            county = counties.get(normalized(row["Associated Counties"]))
            if row["Status"] == "Active" and row["Office"] in countywide and not row["District"] and county:
                name = (row["Ballot Name (first - middle)"] + " " + row["Ballot Name (last - suffix)"]).strip()
                groups[(county, row["Office"])].append((name, row["Party"], False))
        publisher = "South Carolina State Election Commission"
    else:
        import pandas
        rows = pandas.read_html(io.StringIO(raw.decode()))[0].to_dict("records")
        for row in rows:
            county = counties.get(normalized(row["County"]))
            if row["Status"] == "Qualified" and county and not re.search(r"\bDistrict\b", row["Office"]):
                groups[(county, row["Office"])].append((row["Candidate"], row["Party"], False))
        # The official tables repeat some write-in rows in county sections.
        # Include each source-listed name once without inferring its party.
        write_meta = json.loads((captures / "de-4.meta.json").read_text())
        write_raw = capture_bytes(captures, "de-4")
        assert hashlib.sha256(write_raw).hexdigest() == write_meta["rawHash"]
        for table in pandas.read_html(io.StringIO(write_raw.decode())):
            for row in table.to_dict("records"):
                county = counties.get(normalized(row["County"]))
                if row["Status"] == "Qualified" and county and not re.search(r"\bDistrict\b", row["Office"]):
                    groups[(county, row["Office"])].append((row["Candidate"], None, True))
        publisher = "Delaware Department of Elections"
    old_contests, old_candidates = len(ballot["contests"]), len(ballot["candidacies"])
    existing = {(c["ocdId"], c["title"]) for c in ballot["contests"]}
    for (division, title), rows in sorted(groups.items()):
        if (division, title) in existing:
            continue
        identifier = state + "-local-2026-" + hashlib.sha256(json.dumps([division, title]).encode()).hexdigest()[:20]
        provenance = {"sourceUrl": meta["finalUrl"], "sourceOrg": publisher,
                      "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"]}
        ballot["contests"].append({
            "id": identifier, "electionId": ballot["election"]["id"], "ocdId": division,
            "divisionVintage": "TIGER_GENZ2025", "title": title, "type": "CANDIDACY",
            "voteFor": None, "termYears": None, "candidateListComplete": True, "scopeNote": None,
            "provenance": {**provenance, "quote": title},
        })
        for name, party, write_in in sorted(set(rows), key=str):
            candidate_provenance = provenance
            if state == "de" and write_in:
                candidate_provenance = {**provenance, "sourceUrl": write_meta["finalUrl"],
                                        "collectedAt": write_meta["retrievedAt"], "verifiedAt": write_meta["retrievedAt"]}
            ballot["candidacies"].append({
                "id": identifier + ":" + hashlib.sha256(json.dumps([name, party]).encode()).hexdigest()[:16],
                "contestId": identifier, "givenName": "", "familyName": name, "partyLabel": party or None,
                "slogan": "Declared write-in" if write_in else None, "incumbent": None, "websiteUrl": None,
                "provenance": {**candidate_provenance, "quote": " | ".join([title, name, party or ""])},
            })
    if len(ballot["contests"]) > old_contests:
        package["sourceReceipt"]["sources"].append({
            "requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "httpStatus": 200,
            "rawHash": meta["rawHash"], "retrievedAt": meta["retrievedAt"], "publisher": publisher,
            "sourceClass": "ELECTION_AUTHORITY", "reviewedEvidence": "Exact qualified or active names and printed parties replayed from the current official all-office list. County-wide offices match the source county and existing registered county division. Local electoral districts remain separate coverage work.",
        })
        package["sourceReceipt"]["reviewedAt"] = meta["retrievedAt"]
        package["sourceReceipt"]["reviewedBy"] = "BA-01 official county office list replay"
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
    return {"state": state.upper(), "addedContests": len(ballot["contests"]) - old_contests,
            "addedCandidacies": len(ballot["candidacies"]) - old_candidates}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--captures", type=pathlib.Path, required=True)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--state", choices=["va", "dc", "nc", "md", "sc", "de"], default="va")
    args = parser.parse_args()
    if args.state in ["sc", "de"]:
        result = county_offices(args.captures, args.state, args.write)
    else:
        run = {"va": virginia, "dc": district_of_columbia, "nc": north_carolina, "md": maryland}[args.state]
        result = run(args.captures, args.write)
    print(json.dumps(result, indent=2))
