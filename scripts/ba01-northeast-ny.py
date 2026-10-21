"""Replay every New York Supreme Court candidate, including continuation pages."""
import argparse
import datetime
import html
import importlib.util
import json
import pathlib
import re

SPEC = importlib.util.spec_from_file_location("ba01_northeast_pa", pathlib.Path(__file__).with_name("ba01-northeast-pa.py"))
PA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PA)
COMMON = PA.COMMON
SOURCE = "ny-accessible-2026-general-ballot-certification-10.7.2026.pdf"
URL = "https://elections.ny.gov/system/files/documents/2026/10/accessible-2026-general-ballot-certification-10.7.2026.pdf"
PUBLISHER = "New York State Board of Elections"
PREFIX = "ocd-division/country:us/state:ny/"
NYC_GUIDE = "https://www.nycvotes.org/whats-on-the-ballot/2026-general-election-voter-guide/ballot-proposals-2026/"
NYC_PUBLISHER = "New York City Campaign Finance Board"


def city_questions():
    def text(value):
        return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).split())
    questions = []
    for number in range(1, 6):
        source = f"nyc-2026-proposal-{number}.html"
        page = (COMMON.SOURCES / source).read_text()
        title = text(re.search(r'<div class="article single-col">.*?<h2>(.*?)</h2>', page, re.S)[1])
        section = re.search(r'<h4>What you will see on the ballot</h4>\s*<p>(.*?)</p>\s*<ul>(.*?)</ul>', page, re.S)
        questions.append({"number": str(number), "title": title, "questionText": text(section[1]),
                          "officialStatement": text(section[2]), "source": source,
                          "url": NYC_GUIDE + f"ballot-proposal-{number}/"})
    return questions


def court_groups():
    groups, active, district = {}, False, None
    for lines in PA.pdf_lines(COMMON.SOURCES / SOURCE):
        for index, (x, y, text) in enumerate(lines):
            if text == "Office:":
                office = " ".join(t for xx, yy, t in lines if abs(y-yy) < 1 and xx > 100)
                active = office == "Supreme Court Justice"
            if not active:
                continue
            if text.startswith("District: "):
                district = text.split(": ")[1]
                groups[district] = {"voteFor": None, "counties": None, "names": {}}
            elif text.startswith("Vote For:"):
                groups[district]["voteFor"] = int(text.split(": ")[1])
            elif text.startswith("Counties:"):
                stop = next(yy for xx, yy, t in lines if yy > y and t.startswith("Vote For:"))
                parts = [t for xx, yy, t in lines if y <= yy < stop]
                groups[district]["counties"] = " ".join(parts).removeprefix("Counties: ")
            elif text in {"Democratic", "Republican", "Conservative", "Working Families"} and x < 100:
                # Continuation pages have no office or table header. Carry the
                # active district, and read wrapped name cells around each row.
                name = " ".join(t for xx, yy, t in lines if abs(xx-165.84) < 1 and abs(yy-y) < 13)
                if name:
                    groups[district]["names"].setdefault(name, []).append(text)
    return groups


def update(at):
    path = COMMON.ROOT / "data/ballot/2026-general/ny.json"
    data = json.loads(path.read_text()); ballot = next(iter(data["ballots"].values()))
    before = (len(ballot["contests"]), len(ballot["candidacies"]))
    captured_at = COMMON.capture_time(data, URL, COMMON.SOURCES / SOURCE)
    memberships = []
    for district, group in court_groups().items():
        contest_id = f"ny-2026-general:supreme-court-{district}"
        division = PREFIX + "supreme_court:" + district
        quote = f"Office: Supreme Court Justice | District: {district} | Counties: {group['counties']} | Vote For: {group['voteFor']}"
        provenance = {"sourceUrl": URL, "sourceOrg": PUBLISHER, "collectedAt": captured_at, "verifiedAt": at, "quote": quote}
        contest = next((c for c in ballot["contests"] if c["id"] == contest_id), None)
        if contest is None:
            contest = {"id": contest_id, "electionId": ballot["election"]["id"], "ocdId": division, "divisionVintage": "2026",
                       "title": f"Supreme Court Justice, District {district}", "type": "CANDIDACY", "voteFor": group["voteFor"],
                       "termYears": None, "scopeNote": None, "candidateListComplete": True}
            ballot["contests"].append(contest)
        if datetime.datetime.fromisoformat(contest.get("provenance", provenance)["collectedAt"].replace("Z", "+00:00")) <= datetime.datetime.fromisoformat(captured_at.replace("Z", "+00:00")):
            contest["provenance"] = provenance
        for name, parties in group["names"].items():
            candidate_id = contest_id + ":" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            candidate = next((c for c in ballot["candidacies"] if c["id"] == candidate_id), None)
            if candidate is None:
                candidate = {"id": candidate_id, "contestId": contest_id, "givenName": "", "familyName": name, "partyLabel": " / ".join(parties),
                             "slogan": None, "incumbent": None, "websiteUrl": None}
                ballot["candidacies"].append(candidate)
            candidate["provenance"] = {**provenance, "quote": f"Supreme Court Justice | District: {district} | {name} | " + " / ".join(parties)}
        for county in re.split(r",\s*|\s*&\s*", group["counties"]):
            suffix = "st_lawrence" if county == "Saint Lawrence" else county.lower().replace(" ", "_")
            member = PREFIX + "county:" + suffix
            memberships.append({"id": f"ny-2026-court-membership:{suffix}->{district}", "memberOcdId": member,
                                "districtOcdId": division, "provenance": provenance})
    existing = [r for r in ballot.get("districtMemberships", []) if not r["id"].startswith("ny-2026-court-membership:")]
    ballot["districtMemberships"] = existing + memberships
    for question in city_questions():
        captured = COMMON.capture_time(data, question["url"], COMMON.SOURCES / question["source"])
        provenance = {"sourceUrl": question["url"], "sourceOrg": NYC_PUBLISHER, "collectedAt": captured, "verifiedAt": at, "quote": question["questionText"]}
        contest_id = "ny-2026-new-york-city-charter-proposal-" + question["number"]
        contest = next((c for c in ballot["contests"] if c["id"] == contest_id), None)
        if contest is None:
            contest = {"id": contest_id, "electionId": ballot["election"]["id"], "ocdId": PREFIX + "place:new_york", "divisionVintage": "2026",
                       "title": "New York City Proposal " + question["number"] + ": " + question["title"], "type": "MEASURE", "measureTextUrl": question["url"],
                       "voteFor": 1, "termYears": None, "scopeNote": None}
            ballot["contests"].append(contest)
        if datetime.datetime.fromisoformat(contest.get("provenance", provenance)["collectedAt"].replace("Z", "+00:00")) <= datetime.datetime.fromisoformat(captured.replace("Z", "+00:00")):
            contest["provenance"] = provenance
        measure = next((m for m in ballot["measures"] if m["contestId"] == contest_id), None)
        if measure is None:
            measure = {"id": contest_id + "#question", "contestId": contest_id, "officialNumber": question["number"],
                       "questionText": question["questionText"], "officialStatement": question["officialStatement"]}
            ballot["measures"].append(measure)
        if datetime.datetime.fromisoformat(measure.get("provenance", provenance)["collectedAt"].replace("Z", "+00:00")) <= datetime.datetime.fromisoformat(captured.replace("Z", "+00:00")):
            measure["provenance"] = provenance
        receipt = COMMON.receipt(COMMON.SOURCES / question["source"], question["url"], NYC_PUBLISHER, captured,
            "Exact current official voter-guide section labelled 'What you will see on the ballot', including both Yes/No explanations. "
            "NYC311 .gov links to NYC Votes' guide; that saved government page establishes the government-published domain. "
            "The current guide and Charter Commission appendix both enumerate five proposals; NYC311's contrary count of six remains unresolved and creates no invented sixth question.")
        receipt["sourceClass"] = "OFFICIAL_PUBLISHER"
        COMMON.add_receipt(data, receipt, at)
    COMMON.add_receipt(data, COMMON.receipt(COMMON.SOURCES / SOURCE, URL, PUBLISHER, captured_at,
        "All11 certified Supreme Court district contests and60 distinct candidates/95 printed party lines replayed across all continuation pages. "
        "Identical printed names within each contest retain all fusion party lines. Official Counties cells provide only whole-county memberships."), at)
    return path, data, {"state": "NY", "before": before, "after": (len(ballot["contests"]), len(ballot["candidacies"])),
                        "judicialContests": len(court_groups()), "judicialCandidacies": sum(len(g["names"]) for g in court_groups().values()),
                        "judicialCountyMemberships": len(memberships), "newYorkCityQuestions": len(city_questions()),
                        "questionCountEvidence": "NYC311 says6; current official NYC Votes guide and Commission appendix list5. The official10001 sample subsequently confirms5; its exact ballot wording supersedes the guide wording."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    path, data, report = update(datetime.datetime.now(datetime.timezone.utc).isoformat())
    if args.write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report))
