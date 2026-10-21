"""Replay Arkansas's three unambiguous circuit electorates and candidate pairs."""
from pathlib import Path
import hashlib
import html
import json
import re

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-south/ar-core"
STATE = ROOT / "data/ballot/2026-general/ar.json"
meta = json.loads((EVIDENCE / "circuit-directory.source.json").read_text())
raw = (EVIDENCE / "circuit-directory.html").read_bytes()
assert hashlib.sha256(raw).hexdigest() == meta["sha256"] and meta["httpStatus"] == 200
registry = (EVIDENCE / "ocd-ar-circuits.csv").read_bytes()
registry_meta = json.loads((EVIDENCE / "ocd-ar-circuits.source.json").read_text())
assert hashlib.sha256(registry).hexdigest() == registry_meta["sourceTextSha256"]


def clean(value):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).split())


tables = {}
for block in re.findall(r"<table\b[^>]*>.*?</table>", raw.decode(), re.S):
    caption = re.search(r"<caption>(.*?)</caption>", block, re.S)
    if caption:
        county = clean(caption[1])
        tables[county] = [[clean(cell) for cell in re.findall(r"<td\b[^>]*>(.*?)</td>", row, re.S)]
                          for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", block, re.S) if "<td" in row]

roster_meta = json.loads((EVIDENCE / "sos-general-roster.source.json").read_text())
roster_raw = (EVIDENCE / "sos-general-roster.json").read_bytes()
assert hashlib.sha256(roster_raw).hexdigest() == roster_meta["sha256"]
roster = json.loads(roster_raw)["data"]
details = {}
for capture in json.loads((EVIDENCE / "sos-general-details.json").read_text())["sources"]:
    assert hashlib.sha256(capture["body"].encode()).hexdigest() == capture["sha256"]
    value = json.loads(capture["body"])
    assert value["OnGeneralBallot"] == "True" and value["Withdrawn"] == "False"
    assert value["ElecCyDesc"] == "General and Nonpartisan Judicial Runoff"
    details[value["FilerID"]] = (value, capture)

circuits = [
    (2, "Second Judicial Circuit", "Division 4", "Circuit Judge, District 02, Division 04, At Large",
     ["Clay", "Craighead", "Crittenden", "Greene", "Mississippi", "Poinsett"]),
    (4, "Fourth Judicial Circuit", "Division 2", "Circuit Judge, District 04, Division 02", ["Madison", "Washington"]),
    (16, "Sixteenth Judicial Circuit", "Division 2", "Circuit Judge, District 16, Division 02",
     ["Cleburne", "Fulton", "Independence", "Izard", "Stone"]),
]
data = json.loads(STATE.read_text())
ballot = data["ballots"]["AR:ar-2026-11-03-general"]
memberships = ballot.setdefault("districtMemberships", [])
added_contests = added_candidates = added_memberships = 0
for number, circuit, division, office, counties in circuits:
    district = "ocd-division/country:us/state:ar/circuit_court:" + str(number)
    assert district + ",AR State Circuit Court - " in registry.decode()
    rows = [row for row in roster if row["Descript"] == office]
    assert len(rows) == 2 and all(row["PartyAffiliation"] == "Non Partisan Judicial" for row in rows)
    cid = "ar-ba01-2026-circuit-" + str(number) + "-division-" + division.rsplit(" ", 1)[1]
    if not any(row["id"] == cid for row in ballot["contests"]):
        provenance = {"sourceUrl": roster_meta["finalUrl"], "sourceOrg": "Arkansas Secretary of State, Elections Division",
            "collectedAt": roster_meta["retrievedAt"], "verifiedAt": roster_meta["retrievedAt"], "quote": json.dumps(rows)}
        ballot["contests"].append({"id": cid, "electionId": ballot["election"]["id"], "ocdId": district,
            "divisionVintage": "OCD_CURRENT", "title": office, "type": "CANDIDACY", "voteFor": None,
            "termYears": None, "scopeNote": None, "candidateListComplete": True, "provenance": provenance})
        added_contests += 1
        for row in rows:
            detail, capture = details[row["FilerID"]]
            provenance = {"sourceUrl": capture["finalUrl"], "sourceOrg": "Arkansas Secretary of State, Elections Division",
                "collectedAt": capture["retrievedAt"], "verifiedAt": capture["retrievedAt"],
                "quote": json.dumps({key: detail[key] for key in ["CanBallotName", "Descript", "PartyAffiliation", "ElecCyDesc", "OnGeneralBallot", "Withdrawn"]})}
            ballot["candidacies"].append({"id": cid + "-filer-" + row["FilerID"], "contestId": cid,
                "familyName": row["CanBallotName"], "givenName": "", "partyLabel": row["PartyAffiliation"],
                "slogan": None, "incumbent": None, "websiteUrl": None, "provenance": provenance})
            added_candidates += 1
    for county in counties:
        # The official directory groups the entire county under the named
        # circuit and lists the election's division in that county's table.
        assert tables[county] and {row[6] for row in tables[county]} == {circuit}
        assert any(row[7] == division for row in tables[county])
        county_slug = county.lower().replace(" ", "_")
        ident = "ar-ba01-county-" + county_slug + "-circuit-" + str(number)
        if not any(row["id"] == ident for row in memberships):
            memberships.append({"id": ident, "memberOcdId": "ocd-division/country:us/state:ar/county:" + county_slug,
                "districtOcdId": district, "provenance": {"sourceUrl": meta["finalUrl"], "sourceOrg": "Arkansas Judiciary",
                    "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"],
                    "quote": "County: " + county + "; Judicial Circuit: " + circuit + "; " + division}})
            added_memberships += 1
receipt = {"requestedUrl": meta["url"], "finalUrl": meta["finalUrl"], "retrievedAt": meta["retrievedAt"],
    "httpStatus": meta["httpStatus"], "rawHash": meta["sha256"], "publisher": "Arkansas Judiciary",
    "sourceClass": "OFFICIAL_PUBLISHER", "reviewOutcome": "SUPPORTED",
    "reviewedEvidence": "Current official Circuit Judges directory county-captioned tables place each entire county in the named circuit and list the division. scripts/ba01-south-ar-circuits.py checks every membership, all candidate pairs and explicit general-ballot status against saved responses; canonical district IDs match the captured OCD registry."}
if not any(row.get("finalUrl") == receipt["finalUrl"] and row.get("rawHash") == receipt["rawHash"] for row in data["sourceReceipt"]["sources"]):
    data["sourceReceipt"]["sources"].append(receipt)
data["sourceReceipt"]["reviewedAt"] = max(data["sourceReceipt"]["reviewedAt"], meta["retrievedAt"])
ballot["coverageNotes"][1] = "All three circuit-judge runoff races in the state roster are held and mapped to their constituent counties. The District 11-West prosecuting-attorney runoff still needs its distinct electorate mapped. County, municipal, school and special-district contests and local measures remain incomplete."
STATE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"state": "AR", "added_contests": added_contests, "added_candidates": added_candidates,
    "added_memberships": added_memberships, "contests": len(ballot["contests"]), "candidacies": len(ballot["candidacies"])}))
