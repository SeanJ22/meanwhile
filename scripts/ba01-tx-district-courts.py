"""Replay certified Texas district judges and regional declared write-ins.

County membership must agree in every county section of the candidate certification
and the October 2026 court jurisdiction map. Conflicts remain named acquisition work.
"""
import argparse
from collections import defaultdict
from datetime import datetime
import gzip
import hashlib
import html
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/sources/ba-01/tx"
SPEC = importlib.util.spec_from_file_location("tx_counties", Path(__file__).with_name("ba01-tx-counties.py"))
COUNTIES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COUNTIES)


def verified_capture(metadata_file, raw_file=None):
    metadata = json.loads((EVIDENCE / metadata_file).read_text())
    raw = gzip.decompress((EVIDENCE / (raw_file or metadata["file"])).read_bytes())
    assert raw.startswith(b"%PDF") and hashlib.sha256(raw).hexdigest() == metadata["rawHash"]
    text = (EVIDENCE / metadata["textFile"]).read_bytes()
    assert hashlib.sha256(text).hexdigest() == metadata["textHash"]
    return metadata, text.decode()


def county_map(text, counties):
    assert "State District Courts by County (October 2026)" in text
    assert "* Indicates a multicounty district." in text
    result, quotes, seen = defaultdict(set), {}, set()
    county, header = None, None
    for raw in text.splitlines():
        line = raw.strip()
        if line == "25R3780":
            break
        heading = re.fullmatch(r"([A-Z][A-Z ]+) \([\d,]+\)", line)
        if heading:
            key = COUNTIES.office_key(heading[1])
            # The PDF draws each alphabetical initial separately as a drop cap.
            # Resolve only an exact name or its unique missing-initial rendering.
            matches = [name for name in counties if name == key or name[1:] == key]
            assert len(matches) == 1, heading[1]
            county, header = matches[0], line
            assert county not in seen
            seen.add(county)
        elif county and re.fullmatch(r"[\d,* A-Za-z-]+", line) and re.search(r"\d", line):
            for token in line.split(","):
                number = token.strip().lstrip("*")
                if not number:
                    continue
                if re.fullmatch(r"\d+(?:-A)?", number):
                    district = str(int(number.split("-")[0])) + ("a" if number.endswith("-A") else "")
                else:
                    assert number == "2nd 25th", (county, number)
                    district = "2nd_25"
                result[district].add(county)
                quotes[(county, district)] = header + "\n" + line
    assert seen == set(counties), sorted(set(counties) - seen)
    return result, quotes


def district_attorney_write_in(data, ballot, memberships, geography, counties, write_in, write_in_text):
    """Resolve the PDF's 31st/3fS1 extraction using its glyphs and the Governor's exact office statement."""
    metadata = json.loads((EVIDENCE / "da31-governor-source.json").read_text())
    raw = gzip.decompress((EVIDENCE / metadata["file"]).read_bytes())
    assert hashlib.sha256(raw).hexdigest() == metadata["rawHash"]
    plain = html.unescape(re.sub(r"<[^>]+>", " ", raw.decode()))
    plain = re.sub(r"\s+", " ", plain)
    quote = "Governor Abbott appointed Leslie Timmons as District Attorney of the 31st Judicial District in Gray, Hemphill, Lipscomb, Roberts, and Wheeler Counties for a term set to expire December 31, 2026, or until her successor shall be duly elected and qualified."
    assert quote in plain
    assert re.search(r"^District Attorney, .+?Judicial District.+?Leslie Timmons\s*$", write_in_text, re.M)
    assert geography["31"] == {"GRAY", "HEMPHILL", "LIPSCOMB", "ROBERTS", "WHEELER"}
    assert not any("DISTRICT ATTORNEY" in office and "31ST" in office for _, office in COUNTIES.certification())
    provenance = {"sourceUrl": write_in["url"], "sourceOrg": "Texas Secretary of State",
        "collectedAt": write_in["retrievedAt"], "verifiedAt": write_in["retrievedAt"],
        "quote": "District Attorney, 31st Judicial District – Unexpired Term | Leslie Timmons",
        "extractionNote": "Office number31st checked directly against the saved original PDF image; text extraction rendered it3fS1. Governor's exact official office statement independently confirms31st and allfive counties."}
    scope = {"sourceUrl": metadata["url"], "sourceOrg": "Office of the Texas Governor",
        "collectedAt": metadata["retrievedAt"], "verifiedAt": metadata["retrievedAt"], "quote": quote}
    contest_id = "tx-ba01-2026-district-attorney-31-unexpired"
    division = "ocd-division/country:us/state:tx/judicial_district:31"
    if not any(row["id"] == contest_id for row in ballot["contests"]):
        ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"], "ocdId": division,
            "divisionVintage": "2026", "title": "District Attorney, 31st Judicial District (Unexpired Term)",
            "type": "CANDIDACY", "voteFor": 1, "termYears": None, "candidateListComplete": True,
            "scopeNote": "The certified declared write-in is included; the final regular certification lists no printed candidate.",
            "provenance": provenance})
    if not any(row["id"] == contest_id + ":leslie_timmons" for row in ballot["candidacies"]):
        ballot["candidacies"].append({"id": contest_id + ":leslie_timmons", "contestId": contest_id,
            "familyName": "Leslie Timmons", "givenName": "", "partyLabel": None, "slogan": None,
            "incumbent": True, "websiteUrl": None, "provenance": provenance, "incumbencyProvenance": scope})
    for county in sorted(geography["31"]):
        member_id = "tx-ba01-county-da31-" + COUNTIES.slug(counties[county])
        if not any(row["id"] == member_id for row in memberships):
            memberships.append({"id": member_id,
                "memberOcdId": "ocd-division/country:us/state:tx/county:" + COUNTIES.slug(counties[county]),
                "districtOcdId": division, "provenance": scope})
    if not any(row["finalUrl"] == metadata["url"] and row["retrievedAt"] == metadata["retrievedAt"] for row in data["sourceReceipt"]["sources"]):
        data["sourceReceipt"]["sources"].append({"requestedUrl": metadata["url"], "finalUrl": metadata["finalUrl"],
            "httpStatus": metadata["httpStatus"], "rawHash": metadata["rawHash"], "retrievedAt": metadata["retrievedAt"],
            "sourceClass": "OFFICIAL_PUBLISHER", "publisher": "Office of the Texas Governor",
            "reviewedEvidence": "Exact Governor appointment announcement explicitly confirms LeslieTimmons, DistrictAttorney31, thefive counties, and a term expiring December31,2026. It corroborates the certified write-in office's visually reviewed numeral."})
    return {"contestId": contest_id, "certifiedWriteIns": 1, "counties": sorted(geography["31"]), "source": metadata}


def replay(write=False):
    official, _ = verified_capture("core-source.json", "2026-ballot-cert.pdf.gz")
    write_in, write_in_text = verified_capture("write-in-source.json", "2026-write-in-cert.pdf.gz")
    mapping, text = verified_capture("district-courts-source.json")
    law = json.loads((EVIDENCE / "hb16-enrolled-source.json").read_text())
    history = json.loads((EVIDENCE / "hb16-history-source.json").read_text())
    law_raw = gzip.decompress((EVIDENCE / law["file"]).read_bytes())
    history_raw = gzip.decompress((EVIDENCE / history["file"]).read_bytes())
    assert hashlib.sha256(law_raw).hexdigest() == law["rawHash"]
    assert hashlib.sha256(history_raw).hexdigest() == history["rawHash"]
    current_law = re.sub(r"<s\b[^>]*>.*?</s>", "", law_raw.decode(), flags=re.S)
    current_law = html.unescape(re.sub(r"<[^>]+>", " ", current_law)).replace("[", "").replace("]", "")
    current_law = re.sub(r"\s+", " ", current_law)
    law_quote = "The 274th Judicial District is composed of Comal and Hays counties."
    assert law_quote in current_law and "Effective January 1, 2026" in current_law
    history_text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", history_raw.decode())))
    assert "09/17/2025" in history_text and "Signed by the Governor" in history_text
    reference = json.loads((ROOT / "data/reference/national_county_time_zones.json").read_text())
    counties = {COUNTIES.office_key(name.removesuffix(" County")): name.removesuffix(" County")
                for _, state, name, _ in reference["counties"] if state == "TX"}
    geography, quotes = county_map(text, counties)
    groups = defaultdict(list)
    for (county, office), candidates in COUNTIES.certification().items():
        if not office.startswith("DISTRICT JUDGE,"):
            continue
        number = re.search(r", (\d+)(?:ST|ND|RD|TH) JUDICIAL DISTRICT", office)
        district = str(int(number[1])) if number else "1a" if office == "DISTRICT JUDGE, JUDICIAL DISTRICT 1A" else None
        assert district, office
        groups[district].append((COUNTIES.office_key(county), office, tuple(candidates)))
    assert len(groups) == 268
    path = ROOT / "data/ballot/2026-general/tx.json"
    data = json.loads(path.read_text())
    ballot = next(iter(data["ballots"].values()))
    before = {field: {row["id"]: row.copy() for row in ballot[field]} for field in ("contests", "candidacies", "measures")}
    memberships = ballot.setdefault("districtMemberships", [])
    before_memberships = len(memberships)
    conflicts, resolved, published = [], [], []
    added_contests = added_candidates = added_memberships = 0
    for district, sections in sorted(groups.items()):
        certified_counties = {row[0] for row in sections}
        assert len({row[2] for row in sections}) == 1, (district, "candidate list differs by county")
        if certified_counties != geography.get(district):
            difference = {"district": district, "certificationCounties": sorted(certified_counties),
                          "currentMapCounties": sorted(geography.get(district, [])), "candidates": list(sections[0][2])}
            if district == "274" and certified_counties == {"COMAL", "GUADALUPE", "HAYS"} and geography[district] == {"COMAL", "HAYS"}:
                resolved.append({**difference, "winningSource": law["url"], "quote": law_quote,
                    "reason": "Enacted HB16 section1.06 removed Guadalupe effective January1,2026; signed September17,2025. Current October court map agrees. The certification's obsolete Guadalupe listing is retained as the losing value."})
            else:
                conflicts.append(difference)
                continue
        electorate_counties = geography[district]
        _, office, candidates = sections[0]
        division = f"ocd-division/country:us/state:tx/judicial_district:{district}"
        contest_id = "tx-ba01-2026-district-judge-" + district
        provenance = {"sourceUrl": official["url"], "sourceOrg": "Texas Secretary of State",
                      "collectedAt": official["retrievedAt"], "verifiedAt": official["retrievedAt"],
                      "quote": office + "\n" + "\n".join(f"{name} {party}" for name, party in candidates)}
        if not any(row["id"] == contest_id for row in ballot["contests"]):
            ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"], "ocdId": division,
                "divisionVintage": "2026", "title": office, "type": "CANDIDACY", "voteFor": 1, "termYears": None,
                "scopeNote": None, "candidateListComplete": True, "provenance": provenance})
            added_contests += 1
        for name, party in candidates:
            candidate_id = contest_id + ":" + COUNTIES.slug(name)
            if not any(row["id"] == candidate_id for row in ballot["candidacies"]):
                ballot["candidacies"].append({"id": candidate_id, "contestId": contest_id, "familyName": name,
                    "givenName": "", "partyLabel": party, "slogan": None, "incumbent": None,
                    "websiteUrl": None, "provenance": provenance})
                added_candidates += 1
        for county in sorted(electorate_counties):
            member = f"ocd-division/country:us/state:tx/county:{COUNTIES.slug(counties[county])}"
            member_id = "tx-ba01-county-judicial-" + COUNTIES.slug(counties[county]) + "-" + district
            if not any(row["id"] == member_id for row in memberships):
                memberships.append({"id": member_id, "memberOcdId": member, "districtOcdId": division,
                    "provenance": {"sourceUrl": mapping["url"], "sourceOrg": "Texas Office of Court Administration",
                        "collectedAt": mapping["retrievedAt"], "verifiedAt": mapping["retrievedAt"],
                        "quote": "State District Courts by County (October 2026)\n" + quotes[(county, district)]}})
                added_memberships += 1
        published.append({"district": district, "contestId": contest_id, "printedCandidates": len(candidates),
                          "counties": sorted(electorate_counties)})
    # Exact certified write-in; its other regional entry remains unresolved OCR.
    match = re.search(r"^District Judge, 276th Judicial District\s{2,}(.+?)\s*$", write_in_text, re.M)
    assert match and match[1] == "Michael P. Kopech"
    assert "276" not in groups, "a printed candidate requires reconciliation before adding this write-in-only office"
    write_in_provenance = {"sourceUrl": write_in["url"], "sourceOrg": "Texas Secretary of State",
        "collectedAt": write_in["retrievedAt"], "verifiedAt": write_in["retrievedAt"], "quote": match[0].strip()}
    if not any(row["id"] == "tx-ba01-2026-district-judge-276" for row in ballot["contests"]):
        ballot["contests"].append({"id": "tx-ba01-2026-district-judge-276", "electionId": ballot["election"]["id"],
            "ocdId": "ocd-division/country:us/state:tx/judicial_district:276", "divisionVintage": "2026",
            "title": "District Judge, 276th Judicial District", "type": "CANDIDACY", "voteFor": 1, "termYears": None,
            "scopeNote": "The final regular certification lists no printed candidate; the certified declared write-in is included.",
            "candidateListComplete": True, "provenance": write_in_provenance})
        added_contests += 1
    for county in sorted(geography["276"]):
        member_id = "tx-ba01-county-judicial-" + COUNTIES.slug(counties[county]) + "-276"
        if not any(row["id"] == member_id for row in memberships):
            memberships.append({"id": member_id,
                "memberOcdId": f"ocd-division/country:us/state:tx/county:{COUNTIES.slug(counties[county])}",
                "districtOcdId": "ocd-division/country:us/state:tx/judicial_district:276",
                "provenance": {"sourceUrl": mapping["url"], "sourceOrg": "Texas Office of Court Administration",
                    "collectedAt": mapping["retrievedAt"], "verifiedAt": mapping["retrievedAt"],
                    "quote": "State District Courts by County (October 2026)\n" + quotes[(county, "276")]}})
            added_memberships += 1
    published.append({"district": "276", "contestId": "tx-ba01-2026-district-judge-276",
        "printedCandidates": 0, "certifiedWriteIns": 1, "counties": sorted(geography["276"])})
    write_in_id = "tx-ba01-2026-district-judge-276:write-in:michael_p_kopech"
    if not any(row["id"] == write_in_id for row in ballot["candidacies"]):
        ballot["candidacies"].append({"id": write_in_id, "contestId": "tx-ba01-2026-district-judge-276",
            "familyName": match[1], "givenName": "", "partyLabel": None, "slogan": None, "incumbent": None,
            "websiteUrl": None, "provenance": write_in_provenance})
        added_candidates += 1
    for metadata, publisher, source_class in [(mapping, "Texas Office of Court Administration", "OFFICIAL_PUBLISHER"),
            (law, "Texas Legislature", "OFFICIAL_PUBLISHER"), (history, "Texas Legislature", "OFFICIAL_PUBLISHER")]:
        if not any(row["finalUrl"] == metadata["url"] and row["retrievedAt"] == metadata["retrievedAt"] and
                   row["rawHash"] == metadata["rawHash"] for row in data["sourceReceipt"]["sources"]):
            data["sourceReceipt"]["sources"].append({"requestedUrl": metadata["url"], "finalUrl": metadata["finalUrl"],
                "httpStatus": metadata["httpStatus"], "retrievedAt": metadata["retrievedAt"], "rawHash": metadata["rawHash"],
                "publisher": publisher, "sourceClass": source_class,
                "reviewedEvidence": "Exact official source bytes replayed by ba01-tx-district-courts.py. October court map covers254 counties. HB16 section1.06 and signed history resolve district274's obsolete Guadalupe certification entry; the losing value is retained in the comparison report."})
    da_write_in = district_attorney_write_in(data, ballot, memberships, geography, counties, write_in, write_in_text)
    for source in data["sourceReceipt"]["sources"]:
        if source["finalUrl"] == write_in["url"] and source["rawHash"] == write_in["rawHash"]:
            source["reviewedEvidence"] = "All17 names in this exact declared-write-in certification are now held:14core, DallasDA, Judge276 and DA31. The31st numeral was checked directly against the saved PDF image and corroborated by the Governor's exact office/county statement. Later certification updates remain standing acquisition work."
    data["sourceReceipt"]["reviewedAt"] = max(data["sourceReceipt"]["reviewedAt"], *[row["retrievedAt"] for row in data["sourceReceipt"]["sources"]],
        key=lambda stamp: datetime.fromisoformat(stamp.replace("Z", "+00:00")))
    for field, rows in before.items():
        after = {row["id"]: row for row in ballot[field]}
        assert all(after[key] == value for key, value in rows.items()), field
    report = {"officialDistrictJudgeContests": len(groups) + 1, "writeInOnlyContests": 1, "publishedContests": len(published),
              "printedCandidates": sum(row["printedCandidates"] for row in published), "certifiedWriteIns": 1,
              "added": {"contests": len(ballot["contests"])-len(before["contests"]),
                  "candidacies": len(ballot["candidacies"])-len(before["candidacies"]),
                  "memberships": len(memberships)-before_memberships},
              "sources": [official, mapping, write_in, law, history], "sourceConflicts": conflicts, "resolvedSourceDifferences": resolved,
              "districtAttorneyWriteIn": da_write_in,
              "remaining": "Other appellate/district attorney races; other county and municipal sample races. All17 names in the saved statewide declared-write-in certification are now held.",
              "contests": published}
    if write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        (ROOT / "data/ballot/reports/ba01-tx-district-courts.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in ("officialDistrictJudgeContests", "publishedContests", "printedCandidates", "certifiedWriteIns", "added", "sourceConflicts")}, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    replay(parser.parse_args().write)
