"""Replay GEC's certified roster/specimen and CEE's next-election statement.

No network or database writes: saved official documents are the inputs. The GEC
general-info workbook still includes primary entrants; the newer certified
primary results, General Election ballot-placement roster and specimen determine
the final field. The specimen's printed name wins when an older roster differs.
"""
from pathlib import Path
import hashlib
import html
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba02-territories"
DEST = ROOT / "data/ballot/2026-general"


def capture(name):
    raw = (EVIDENCE / name).read_bytes()
    meta = json.loads((EVIDENCE / (name + ".source.json")).read_text())
    assert meta["httpStatus"] == 200
    assert hashlib.sha256(raw).hexdigest() == meta["sha256"], name
    return raw, meta


def pdf(name):
    raw, meta = capture(name + ".pdf")
    text = subprocess.run(["pdftotext", "-layout", str(EVIDENCE / (name + ".pdf")), "-"],
                          check=True, capture_output=True).stdout.decode()
    assert text == (EVIDENCE / (name + ".txt")).read_text()
    return text, meta


def clean(text):
    return " ".join(text.split())


def plain(raw):
    return clean(html.unescape(re.sub("<[^>]+>", " ", raw.decode())))


def prov(meta, org, quote, source_url=None):
    return {"sourceUrl": source_url or meta["url"], "sourceOrg": org,
            "collectedAt": meta["retrievedAt"], "verifiedAt": meta["retrievedAt"], "quote": quote}


def receipt(meta, org, evidence, source_class="ELECTION_AUTHORITY"):
    return {"requestedUrl": meta["url"], "finalUrl": meta["finalUrl"],
            "retrievedAt": meta["retrievedAt"], "httpStatus": meta["httpStatus"],
            "rawHash": meta["sha256"], "publisher": org, "sourceClass": source_class,
            "reviewOutcome": "SUPPORTED", "reviewedEvidence": evidence}


def save(state, ballot, sources):
    package = {"kind": "ballot-contests", "ballots": {state + ":" + ballot["election"]["id"]: ballot},
               "sourceReceipt": {"contractVersion": 1, "reviewedAt": max(s["retrievedAt"] for s in sources),
                                 "reviewedBy": "BA-02 official territory source replay", "sources": sources}}
    (DEST / (state.lower() + ".json")).write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")


org = "Guam Election Commission"
info_raw, info_meta = capture("gu-general-info-http.html")
assert "2026 General Election Sample Ballots" in plain(info_raw)
assert b"1RKr3bLuivj8n0n29XKbQVHEgdUYwILMN" in info_raw
placement_link_raw, placement_link_meta = capture("gu-ballot-placement-http.html")
assert placement_link_meta["url"] == "http://gec.guam.gov/2026-general-election-ballot-placement/"
assert "13Lo-4rv9AXfMLGaJ00m1qE89NQMXuhHd" in placement_link_meta["finalUrl"]
primary_link_raw, primary_link_meta = capture("gu-primary-official-http.html")
assert b"1p9FDSdsSlHPxvik-lZKYBdOYJ24ZHMwY" in primary_link_raw
sample, sample_meta = pdf("gu-sample")
placement, placement_meta = pdf("gu-ballot-placement")
primary, primary_meta = pdf("gu-primary-official-summary")
assert "November 3, 2026" in sample
assert "OFFICIAL RESULTS" in primary and "08/15/2026" in primary
assert "ADA/CALVO" in primary and "TERLAJE/PEREZ" in primary
assert "MOYLAN, James Craig" in primary and "LIMTIACO, Alicia Anne Garrido" in primary
qual_raw, qual_meta = capture("gu-candidate-qualifications-http.html")
education_quote = "Six (6) voting members shall be elected at-large at each General Election."
assert education_quote in plain(qual_raw)
education_law, education_law_meta = pdf("gu-education-statute")
assert education_quote in clean(education_law)

pages = sample.split("\f")
legislature = []
for line in pages[0].splitlines():
    match = re.match(r"^\s*(\d+)\.\s+(.+?)\s{2,}(\d+)\.\s+(.+?)\s*$", line)
    if match:
        assert match[1] == match[3]
        legislature.extend([(int(match[1]), "REPUBLICAN", match[2]), (int(match[3]), "DEMOCRAT", match[4])])
assert len(legislature) == 30
for party in ["REPUBLICAN", "DEMOCRAT"]:
    assert [n for n, p, name in legislature if p == party] == list(range(1, 16))
placement_names = clean(placement)
for n, party, name in legislature:
    older_name = "NEDEDOG, Sarah Mattie Villaranda Thomas" if name == "NEDEDOG, Sarah Mattie T." else name
    assert older_name in placement_names, name

attorney, utilities = [], []
before_education, education = pages[1].split("Guam Education Board", 1)
for line in before_education.splitlines():
    match = re.match(r"^\s*(\d+)\.\s+(.+?)\s{2,}(\d+)\.\s+(.+?)\s*$", line)
    if match:
        assert match[1] == match[3]
        attorney.append(match[2]); utilities.append(match[4])
education_names = [m[1] for m in re.finditer(r"^\s*\d+\.\s+(.+?)\s*$", education, re.M)]
assert len(attorney) == len(utilities) == 5 and len(education_names) == 4
for name in attorney + utilities + education_names:
    older_name = "TAITANO, John R. II" if name == "TAITANO II, John R." else name
    assert older_name in placement_names, name
assert "Mark one (1) oval only." in sample
assert "Mark no more than fifteen (15) ovals." in sample
assert "Mark no more than three (3) ovals." in sample

election_id = "gu-2026-11-03-general"
base = "ocd-division/country:us/territory:gu"
ballot = {"election": {"id": election_id, "date": "2026-11-03", "name": "2026 General Election", "state": "GU"},
          "contests": [], "candidacies": [], "measures": [], "absences": [], "candidateTickets": []}


def slug(value):
    return re.sub("[^a-z0-9]+", "-", value.lower()).strip("-")


def candidate(contest_id, name, party, provenance):
    return {"id": contest_id + "-" + slug(name), "contestId": contest_id,
            "familyName": name, "givenName": "", "partyLabel": party,
            "slogan": None, "incumbent": None, "websiteUrl": None, "provenance": provenance}


def race(suffix, title, count, names, instruction, limits_meta=None, limits_org=None):
    contest_id = "gu-ba02-2026-" + suffix
    ballot["contests"].append({"id": contest_id, "electionId": election_id, "ocdId": base,
                               "divisionVintage": "2026", "title": title, "type": "CANDIDACY",
                               "voteFor": count, "termYears": None, "scopeNote": None,
                               "candidateListComplete": True,
                               "provenance": prov(limits_meta or sample_meta, limits_org or org, title + " | " + instruction)})
    for name, party in names:
        assert name in sample, name
        ballot["candidacies"].append(candidate(contest_id, name, party, prov(sample_meta, org, name)))
    return contest_id


governor_id = race("governor", "Governor & Lieutenant Governor of Guam", 1,
                   [("ADA, Vicente A.", "REPUBLICAN"), ("TERLAJE, Therese Maria", "DEMOCRAT")],
                   "Mark one (1) oval only.")
for lead_name, mate_name, party in [("ADA, Vicente A.", "CALVO, Edward John", "REPUBLICAN"),
                                     ("TERLAJE, Therese Maria", "PEREZ, Sabina Eileen", "DEMOCRAT")]:
    assert mate_name in sample
    lead = next(c for c in ballot["candidacies"] if c["familyName"] == lead_name)
    p = prov(sample_meta, org, lead_name + "\n" + mate_name)
    ballot["candidateTickets"].append({"id": lead["id"] + "-ticket", "leadCandidacyId": lead["id"],
                                        "runningMate": {**candidate(governor_id, mate_name, party, p), "office": "Lieutenant Governor"},
                                        "provenance": p})
race("delegate", "Non-Voting Delegate to the U.S. House of Representatives", 1,
     [("MOYLAN, James Craig", "REPUBLICAN"), ("LIMTIACO, Alicia Anne Garrido", "DEMOCRAT")],
     "Mark one (1) oval only.")
race("legislature", "Guam Legislature", 15, [(name, party) for n, party, name in legislature],
     "Mark no more than fifteen (15) ovals.")
race("attorney-general", "Attorney General of Guam", 1, [(n, None) for n in attorney], "Mark one (1) oval only.")
race("utilities", "Consolidated Commission on Utilities", 3, [(n, None) for n in utilities],
     "Mark no more than three (3) ovals.")
race("education-board", "Guam Education Board", 6, [(n, None) for n in education_names], education_quote,
     education_law_meta, "Compiler of Laws, Judiciary of Guam")
assert len(ballot["contests"]) == 6 and len(ballot["candidacies"]) == 48 and len(ballot["candidateTickets"]) == 2
gu_sources = [
    receipt(placement_meta, org, "All 30 legislative and 14 nonpartisan candidates agree with the newer official specimen; two source name variants are explicitly checked."),
    receipt(primary_meta, org, "Certified primary winners ADA/CALVO, TERLAJE/PEREZ, MOYLAN and LIMTIACO agree with the official general specimen."),
    receipt(sample_meta, org, "Every one of 48 candidate choices and both running mates is verified against the official November 3 sample; all six offices and printed vote limits are replayed."),
    receipt(education_law_meta, "Compiler of Laws, Judiciary of Guam", "17 GCA §3102.3(b): six Education Board members elected at-large each general election; GEC's saved qualifications page quotes the same law.")]
save("GU", ballot, gu_sources)

pr_org = "Comisión Estatal de Elecciones"
authority_raw, authority_meta = capture("pr-authority.html")
assert b"https://www.ceepur.org/" in authority_raw
pr_text, pr_meta = pdf("pr-rfp-2028")
pr_quote = "Las próximas elecciones generales serán el 7 de noviembre de 2028."
assert pr_quote in clean(pr_text)
assert "las elecciones generales se celebran cada cuatro (4) años" in clean(pr_text)
pr_ballot = {"election": {"id": "pr-2026-11-03-general", "date": "2026-11-03",
                           "name": "2026 General Election Calendar", "state": "PR"},
             "contests": [], "candidacies": [], "measures": [],
             "absences": [{"ocdId": "ocd-division/country:us/territory:pr", "divisionVintage": "2026",
                           "statement": "Puerto Rico has no general election on November 3, 2026. Its next general election is November 7, 2028.",
                           "provenance": prov(pr_meta, pr_org, pr_quote)}]}
save("PR", pr_ballot, [receipt(authority_meta, "Government of Puerto Rico", "Official PR.gov agency directory identifies the CEE and links ceepur.org.", "OFFICIAL_PUBLISHER"),
                         receipt(pr_meta, pr_org, "Section 12.0 expressly states the four-year general-election cycle and next regular election date, November 7, 2028; exact Spanish text verified.")])
print(json.dumps({"GU": {"contests": 6, "candidateChoices": 48, "runningMates": 2, "voteFor": [1, 1, 15, 1, 3, 6]},
                  "PR": {"generalElectionOn2026November3": False, "nextGeneralElection": "2028-11-07", "absenceRecords": 1}}))
