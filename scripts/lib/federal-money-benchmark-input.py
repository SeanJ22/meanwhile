import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("source", choices=["usaspending", "usaspending-national", "sam-gov-entities"])
parser.add_argument("output")
parser.add_argument("--rows", type=int, required=True)
parser.add_argument("--padding", type=int, default=2048)
parser.add_argument("--seed-directory")
args = parser.parse_args()
os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
expanded = 0
if args.source == "usaspending-national":
    inventory = json.load(open(os.path.join(args.seed_directory, "inventory.json")))
    base, remainder = divmod(args.rows, inventory["governments"])
    assert base > 0
    os.makedirs(args.output, exist_ok=True)
    states = []
    governments = 0
    synthetic_counties = 0
    for state in inventory["states"]:
        with open(os.path.join(args.seed_directory, "seeds", state + "-counties.jsonl")) as county_seeds:
            counties = sorted({row["geoid"] for line in county_seeds for row in json.loads(line)["divisions"]})
        path = os.path.join(args.output, state + ".zip")
        state_rows = 0
        state_governments = 0
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
            with archive.open("Transactions.csv", "w", force_zip64=True) as binary:
                with io.TextIOWrapper(binary, encoding="utf-8", newline="") as target:
                    writer = csv.writer(target)
                    writer.writerow(["assistance_transaction_unique_key", "assistance_award_unique_key", "assistance_type", "recipient_uei", "recipient_name", "action_date", "federal_action_obligation", "primary_place_of_performance_state_code", "primary_place_of_performance_county_code", "primary_place_of_performance_city_code", "nces_leaid", "last_modified_date", "award_description"])
                    with open(os.path.join(args.seed_directory, "seeds", state + ".jsonl")) as seeds:
                        for line in seeds:
                            seed = json.loads(line)
                            government = seed["government"]
                            geography = {row["divisionType"]: row["geoid"] for row in seed["divisions"]}
                            county = geography.get("county") or government.get("countyFips")
                            if not county and counties:
                                county = counties[int.from_bytes(hashlib.sha256(seed["uei"].encode()).digest()[:8], "big") % len(counties)]
                                synthetic_counties += 1
                            count = base + int(governments < remainder)
                            for index in range(count):
                                identifier = "GENERATED-" + seed["uei"] + "-" + str(index)
                                writer.writerow([identifier, identifier, ["04", "A", "07"][index % 3], seed["uei"], government["name"], "2026-01-01", "1234.56", state.upper(), county or "", geography.get("place", ""), government["nativeIds"].get("nces_leaid", ""), "2026-10-14", "Generated national-volume award"])
                            state_rows += count
                            state_governments += 1
                            governments += 1
            size = archive.getinfo("Transactions.csv").file_size
        states.append({"state": state.upper(), "path": os.path.abspath(path), "rows": state_rows, "governments": state_governments, "expandedBytes": size, "compressedBytes": os.path.getsize(path)})
        expanded += size
    manifest = {"source": "usaspending", "generated": True, "rows": args.rows, "governments": governments, "states": states, "syntheticCountyAssignments": synthetic_counties, "geographyBasis": "Missing performance counties use deterministic UEI-hash selection among held counties in the source state; generated geography is independent of recipient identity.", "expandedBytes": expanded, "compressedBytes": sum(row["compressedBytes"] for row in states)}
    with open(os.path.join(args.output, "manifest.json"), "w") as output:
        json.dump(manifest, output)
    print(json.dumps({key: value for key, value in manifest.items() if key != "states"}))
elif args.source == "usaspending":
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
        with archive.open("Assistance_Transactions.csv", "w", force_zip64=True) as target:
            header = b"assistance_transaction_unique_key,assistance_award_unique_key,assistance_type,recipient_uei,recipient_name,action_date,federal_action_obligation,primary_place_of_performance_state_code,primary_place_of_performance_county_code,primary_place_of_performance_congressional_district,last_modified_date,award_description\n"
            target.write(header)
            expanded += len(header)
            padding = "Generated source transport stress. " + "x" * args.padding
            for index in range(args.rows):
                row = f"GENERATED-{index},GENERATED-AWARD-{index},04,GENERATEDUEI,Generated government,2026-01-01,1234.56,CA,037,34,2026-10-15,{padding}\n".encode()
                target.write(row)
                expanded += len(row)
else:
    with gzip.open(args.output, "wb", compresslevel=1) as target:
        prefix = ('{"totalRecords":' + str(args.rows) + ',"entityData":[').encode()
        target.write(prefix)
        expanded += len(prefix)
        padding = "Generated source transport stress. " + "x" * args.padding
        for index in range(args.rows):
            row = {"entityRegistration": {"ueiSAM": f"{index:012d}", "legalBusinessName": f"Generated entity {index}",
                "lastUpdateDate": "2026-10-15", "registrationDate": "2026-01-01", "registrationStatus": "Active"},
                "coreData": {"physicalAddress": {"stateOrProvinceCode": "CA"}, "generalInformation": {"entityStructureDesc": padding}}}
            encoded = (("," if index else "") + json.dumps(row, separators=(",", ":"))).encode()
            target.write(encoded)
            expanded += len(encoded)
        target.write(b"]}")
        expanded += 2
if args.source != "usaspending-national":
    print(json.dumps({"source": args.source, "generated": True, "rows": args.rows, "expandedBytes": expanded,
        "compressedBytes": os.path.getsize(args.output), "path": os.path.abspath(args.output)}))
