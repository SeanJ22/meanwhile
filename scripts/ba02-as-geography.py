"""Connect AS's certified House races to saved Census villages using the current constitution.

The Governor's certified-results enclosure on docs.house.gov contains the five
voter-approved amendments first, followed by eleven proposed amendments later.
Only the first district table is used. The January 2025 official announcement
confirms the approved amendments took effect. This does not adopt proposal #5's
unapproved Malaeimi reassignment or proposal #4's extra seats.
"""
from pathlib import Path
import hashlib
import html
import json
import re
import subprocess
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba02-vote-limits"
PATH = ROOT / "data/ballot/2026-general/as.json"
BASE = "ocd-division/country:us/territory:as"


def capture(name, suffix):
    raw = (EVIDENCE / (name + suffix)).read_bytes()
    meta = json.loads((EVIDENCE / (name + ".source.json")).read_text())
    assert meta["httpStatus"] == 200
    assert hashlib.sha256(raw).hexdigest() == meta["sha256"]
    return raw, meta


raw, meta = capture("as-official-results-2022-house", ".pdf")
text = subprocess.run(["pdftotext", "-layout", str(EVIDENCE / "as-official-results-2022-house.pdf"), "-"],
                      check=True, capture_output=True).stdout.decode()
assert text == (EVIDENCE / "as-official-results-2022-house.txt").read_text()
assert "text of the five amendme nts that were approved by the voters" in text
section = text.split("Representative District No. 1\n", 1)[1].split("Senators and representatives shall be reapportioned", 1)[0]
section = "Representative District No. 1\n" + section
section = re.sub(r"Note: New language is underlined\..*?\d+ of 20", "", section, flags=re.S)
rows = {int(number): " ".join(quote.split()) for number, quote in re.findall(
    r"Representative District No\. (\d+)\n(.*?)(?=Representative District No\.|\Z)", section, re.S)}
assert set(rows) == set(range(1, 18))
assert "Malaeimi" not in section
assert "Nu’uuli, Fagasa, Matuu, Faganeanea: 2 Representatives" in rows[12]
assert rows[15].endswith("2 Representatives")
amendment_raw, amendment_meta = capture("as-current-amendments-house", ".html")
amendment_text = html.unescape(re.sub("<[^>]+>", " ", amendment_raw.decode()))
assert "January 16, 2025" in amendment_text
assert "Haaland" in amendment_text and "amendments" in amendment_text


def words(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub("[^a-z0-9]", "", value)


# Exact named villages only. Ambiguous historical spellings/places absent from
# the held Census index stay unresolved; they are never widened to a county.
names = {
    2: ["Ofu", "Olosega", "Sili"],
    3: ["Alao", "Aoa", "Onenoa", "Tula", "Vatia"],
    4: ["Aunuu", "Amouli", "Alofau"],
    5: ["Fagaitua", "Amaua", "Auto", "Avaio", "Alega", "Aumi", "Laulii"],
    6: ["Sailele", "Masausi", "Masefau", "Afono"],
    7: ["Fatumafuti", "Fagaalu", "Utulei"],
    8: ["Fagatogo"], 9: ["Pago Pago"], 10: ["Satala", "Atuu", "Leloaloa"], 11: ["Aua"],
    12: ["Nu’uuli", "Fagasa", "Matuu", "Faganeanea"],
    13: ["Leone", "Auma"],
    14: ["Fagamalo", "Fagalii", "Poloa", "Amanave", "Failolo", "Seetaga", "Nua", "Afao", "Amaluia", "Asili"],
    15: ["Tafuna", "Mesepa", "Faleniu", "Mapusaga Fou", "Pavaiai", "Iliili", "Vaitogi"],
    16: ["Futiga", "Taputimu", "Vailoatai"], 17: ["Aoloau"],
}
shard = json.loads((ROOT / "data/derived/zip-divisions/96.json").read_text())
indexed = {words(division.split("/place:")[1]): division for division in shard["divisions"]
           if division.startswith(BASE + "/place:")}
memberships = []


def add(district, member):
    assert member in shard["divisions"]
    ident = "as-ba02-" + re.sub("[^a-z0-9]+", "-", member.removeprefix(BASE)) + "-to-house-" + str(district)
    memberships.append({"id": ident, "memberOcdId": member, "districtOcdId": BASE + "/sldl:" + str(district),
                        "provenance": {"sourceUrl": meta["finalUrl"], "sourceOrg": "American Samoa Governor, certified constitutional text filed with the U.S. House",
                                       "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"],
                                       "quote": "Representative District No. " + str(district) + " | " + rows[district]}})


for county in ["ta_u", "fitiuta", "faleasao"]:
    assert words(county) in words(rows[1])
    add(1, BASE + "/county:manu_a_district/place:" + county + "_county")
for district, villages in names.items():
    for village in villages:
        assert words(village) in words(rows[district]), (district, village)
        assert words(village) in indexed, village
        add(district, indexed[words(village)])
for district, published, identifier in [(16, "Ituau (Malaeloa)", "malaeloa_ituau"), (17, "Aitulagi (Malaeloa)", "malaeloa_aitulagi")]:
    assert published in rows[district]
    add(district, BASE + "/place:" + identifier)
assert {row["districtOcdId"] for row in memberships} == {BASE + "/sldl:" + str(n) for n in range(1, 18)}
zip_divisions = {shard["divisions"][index] for index in shard["zips"]["96799"]}
assert all(row["memberOcdId"] in zip_divisions for row in memberships)

def apply_as_geography(package):
    ballot = next(iter(package["ballots"].values()))
    old = [row for row in ballot.get("districtMemberships", []) if not row["id"].startswith("as-ba02-")]
    ballot["districtMemberships"] = old + memberships
    note = "The official constitutional district table connects the named villages to all 17 House electorates. ZIP 96799 reaches every district; an address narrows the ballot."
    if note not in ballot["coverageNotes"]:
        ballot["coverageNotes"].append(note)
    for source_meta, publisher, detail in [
        (meta, "American Samoa Governor; U.S. House of Representatives", "Governor's certified results enclosure: first constitutional district table only, incorporating the five voter-approved amendments, printed pages 7–9. Exact named villages/counties join existing Census divisions; proposed amendments later in the file are excluded."),
        (amendment_meta, "Office of U.S. Representative Aumua Amata", "January 16, 2025 official announcement confirms the approved constitutional amendments took effect. Geographic allocations in the first certified text remain unchanged.")]:
        source = {"requestedUrl": source_meta["url"], "finalUrl": source_meta["finalUrl"], "retrievedAt": source_meta["retrievedAt"],
                  "httpStatus": 200, "rawHash": source_meta["sha256"], "publisher": publisher, "sourceClass": "OFFICIAL_PUBLISHER",
                  "reviewOutcome": "SUPPORTED", "reviewedEvidence": detail}
        sources = package["sourceReceipt"]["sources"]
        sources[:] = [row for row in sources if row["finalUrl"] != source["finalUrl"]]
        sources.append(source)
    package["sourceReceipt"]["reviewedAt"] = max(row["retrievedAt"] for row in package["sourceReceipt"]["sources"])
    return len(memberships)


if __name__ == "__main__":
    package = json.loads(PATH.read_text())
    count = apply_as_geography(package)
    PATH.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
    print(f"AS: {count} exact source-backed village/county memberships connect all 17 House districts to ZIP 96799.")
