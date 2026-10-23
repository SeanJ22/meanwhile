"""Restore territorial county aliases using held official county names and ballots."""
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-south/territories"
AT = datetime.now(timezone.utc).isoformat()
COUNTY_URL = "https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt"


def main():
    county_path = ROOT / "data/ballot/sources/ba01-northeast/ma-2020-census-county-fips.txt"
    raw = county_path.read_bytes()
    ma = json.loads((ROOT / "data/ballot/2026-general/ma.json").read_text())
    census_source = next(s for s in ma["sourceReceipt"]["sources"] if s["finalUrl"] == COUNTY_URL)
    assert hashlib.sha256(raw).hexdigest() == census_source["rawHash"]
    county_rows = {(r["STATE"], r["COUNTYNAME"]): r for r in csv.DictReader(raw.decode().splitlines(), delimiter="|")}
    result = {}
    for state in ["MP", "VI"]:
        path = ROOT / f"data/ballot/2026-general/{state.lower()}.json"
        data = json.loads(path.read_text())
        ballot = next(iter(data["ballots"].values()))
        base = f"ocd-division/country:us/territory:{state.lower()}/"
        memberships = ballot.setdefault("districtMemberships", [])
        def add(county, district, source, quote):
            row = dict(id=f"bl02-{state.lower()}-{county}-to-{district.replace(':','-')}",
                       memberOcdId=base + "county:" + county, districtOcdId=base + district,
                       provenance=dict(sourceUrl=source["finalUrl"], sourceOrg=source["publisher"],
                           collectedAt=source["retrievedAt"], verifiedAt=AT, quote=quote))
            if not any(m["memberOcdId"] == row["memberOcdId"] and m["districtOcdId"] == row["districtOcdId"] for m in memberships):
                memberships.append(row)
        if state == "MP":
            for name, code in [("Rota", "100"), ("Tinian", "120")]:
                row = county_rows[(state, name + " Municipality")]
                assert row["COUNTYFP"] == code and row["STATEFP"] == "69"
                add(name.lower(), "municipality:" + name.lower(), census_source,
                    f"MP|69|{code}|{row['COUNTYNS']}|{row['COUNTYNAME']}|{row['CLASSFP']}|{row['FUNCSTAT']}")
            if not any(s["finalUrl"] == COUNTY_URL and s["rawHash"] == census_source["rawHash"] for s in data["sourceReceipt"]["sources"]):
                data["sourceReceipt"]["sources"].append({**census_source,
                    "reviewedEvidence": "The held original Census county code list names MP county equivalents RotaMunicipality69100 and TinianMunicipality69120. Their ZIP county names are aliases of those whole mayor electorates; the current CEC specimens already verify each municipality's mayor race."})
        else:
            for county, island, district, filename, title in [
                ("st_croix", "St. Croix Island", "st_croix", "vi-stx-sample", "ST. CROIX / SANTA CRUZ"),
                ("st_thomas", "St. Thomas Island", "st_thomas-st_john", "vi-stt-stj-sample", "ST. THOMAS - ST. JOHN / SAN TOMAS - SAN JOHN"),
                ("st_john", "St. John Island", "st_thomas-st_john", "vi-stt-stj-sample", "ST. THOMAS - ST. JOHN / SAN TOMAS - SAN JOHN")]:
                assert county_rows[(state, island)]["STATEFP"] == "78"
                metadata = json.loads((EVIDENCE / (filename + ".pdf.source.json")).read_text())
                pdf = (EVIDENCE / (filename + ".pdf")).read_bytes()
                assert hashlib.sha256(pdf).hexdigest() == metadata["sha256"]
                text = (EVIDENCE / (filename + ".txt")).read_text()
                assert title in text and "NOVEMBER 3, 2026" in text and "BOARD OF EDUCATION" in text and "BOARD OF ELECTIONS" in text
                source = next(s for s in data["sourceReceipt"]["sources"] if s["finalUrl"] == metadata["finalUrl"])
                add(county, "sldu:" + district, source,
                    f"{title}; NOVEMBER 3, 2026; LEGISLATURE OF THE VIRGIN ISLANDS; BOARD OF EDUCATION; BOARD OF ELECTIONS. The island county belongs to the same named election district printed on this official sample.")
        data["sourceReceipt"]["reviewedAt"] = AT
        data["sourceReceipt"]["reviewedBy"] = "bl02-territorial-county-memberships"
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        result[state] = dict(memberships=[r for r in memberships if r["id"].startswith("bl02-")],
                             splitCounties=[], meaning="Entire named island counties; existing district memberships carry the result to the board races.")
    report = dict(checkedAt=AT, states=result,
                  method="Reused original Census county-equivalent names and complete current official territorial ballot specimens. No geography is inferred from a ZIP centroid.")
    (ROOT / "data/ballot/reports/bl02-territory-memberships.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({state: len(row["memberships"]) for state, row in result.items()}))


if __name__ == "__main__":
    main()
