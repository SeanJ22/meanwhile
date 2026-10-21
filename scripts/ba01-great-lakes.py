"""Replay saved official ballot sources; add only source-bound rows, preserving held data.

Run with --write to append verified Ohio additions (--write-wi replays earlier Dane additions). Without --write,
prints source/repository comparisons. Web captures retain the extractor's line
numbers; their receipt hashes identify those captured text bytes, not PDF bytes.
"""
import csv
import argparse
import gzip
import hashlib
import io
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data/ballot/evidence/ba01-great-lakes"
NOW = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
OH_URL = "https://www.vote.franklincountyohio.gov/getmedia/e0a4ca45-6893-45c1-8190-87696f8804b4/2026-General-Candidate-List-5"
WI_URL = "https://elections.countyofdane.com/documents/pdf/What-s-on-the-Ballot-Nov-2026.pdf"
WI_TOWN_URL = "https://cdn.townweb.com/townofdane.gov/wp-content/uploads/2026/09/Dane-County-Type-B-ToD-Notice-for-Fall-2026.pdf"


def load_state(state):
    path = ROOT / f"data/ballot/2026-general/{state}.json"
    data = json.loads(path.read_text())
    return path, data, next(iter(data["ballots"].values()))


def web_text(name):
    return re.sub(r"\s+", " ", " ".join(re.findall(r"^L\d+(?:@P[\d-]+)?: (.*)$", (EVIDENCE / name).read_text(), re.M)))


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def add(data, ballot, state, title, division, rows, url, publisher, quote, source_name):
    """No existing row is removed or overwritten; all candidates get identical fields."""
    captured_at = datetime.fromtimestamp((EVIDENCE / source_name).stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z")
    provenance = {"sourceUrl": url, "sourceOrg": publisher, "collectedAt": captured_at,
                  "verifiedAt": NOW, "quote": quote}
    matches = [c for c in ballot["contests"] if c["title"] == title and c["ocdId"] == division]
    contest_id = matches[0]["id"] if matches else f"{state}-ba01-{slug(title)}-{slug(division.split('/')[-1])}"
    if not matches:
        ballot["contests"].append({"id": contest_id, "electionId": ballot["election"]["id"],
            "ocdId": division, "divisionVintage": "2026", "title": title, "type": "CANDIDACY",
            "candidateListComplete": True, "voteFor": None, "termYears": None,
            "scopeNote": None, "provenance": provenance})
    for name, party, row_quote in rows:
        existing = [c for c in ballot["candidacies"] if c["contestId"] == contest_id and
                    (c["givenName"] + " " + c["familyName"]).strip().casefold() == name.casefold()]
        if existing:
            continue
        ballot["candidacies"].append({"id": f"{contest_id}-candidate-{slug(name)}", "contestId": contest_id,
            "familyName": name, "givenName": "", "partyLabel": party, "slogan": None,
            "incumbent": None, "websiteUrl": None,
            "provenance": {**provenance, "quote": row_quote}})
    raw = (EVIDENCE / source_name).read_bytes()
    if not any(s["finalUrl"] == url and s["rawHash"] == hashlib.sha256(raw).hexdigest()
               for s in data["sourceReceipt"]["sources"]):
        data["sourceReceipt"]["sources"].append({"requestedUrl": url, "finalUrl": url,
            "httpStatus": 200, "retrievedAt": captured_at, "rawHash": hashlib.sha256(raw).hexdigest(),
            "publisher": publisher, "sourceClass": "ELECTION_AUTHORITY",
            "reviewedEvidence": f"Saved extracted official document text: data/ballot/evidence/ba01-great-lakes/{source_name}. Code replays each full candidate name, party and office from this capture. Hash identifies captured text bytes, not original PDF bytes."})
    data["sourceReceipt"].update(reviewedAt=NOW, reviewedBy="BA-01 saved official source replay")


def ohio(write):
    path, data, ballot = load_state("oh")
    before = len(ballot["contests"]), len(ballot["candidacies"])
    source = web_text("oh-franklin.web.txt")
    assert "Revised October 16, 2026" in source
    groups = []
    for district, entries in {
        3: [("Joyce Beatty", "Democratic"), ("Cleophus Dulaney", "Republican")],
        15: [("Brennan Barrington", "Libertarian"), ("Mike Carey", "Republican"),
             ("Don Leonard", "Democratic"), ("Gary Josephson", None), ("Samuel Ronan", None)],
    }.items():
        office = f"REPRESENTATIVE TO CONGRESS {district:02d}{'RD' if district == 3 else 'TH'} CONGRESSIONAL DISTRICT"
        groups.append((office, f"Representative to Congress, District {district}", f"cd:{district}", entries))
    for district, entries in {
        3: [("Stacie A. Baker", "Democratic"), ("Michele Reynolds", "Republican")],
        15: [("Joseph Healy", "Republican"), ("Latyna M. Humphrey", "Democratic")],
        25: [("Raisheda D. Angus", None), ("Bill DeMora", "Democratic"), ("Don Roberts", "Republican")],
    }.items():
        groups.append((f"STATE SENATOR OHIO SENATE DISTRICT {district:02d}",
                       f"State Senator, District {district}", f"sldu:{district}", entries))
    for district, entries in {
        1: [("Joel A. Greff", "Republican"), ("Dontavius Jarrells", "Democratic")],
        2: [("Charity Martin King", "Democratic")],
        3: [("Elegant Afriyie", None), ("Bernadine Kennedy Kent", "Republican"), ("Ismail Mohamed", "Democratic")],
        4: [("Beryl Brown Piccolantonio", "Democratic")],
        5: [("Richard Cole", "Republican"), ("Eboney C. Eldridge", None), ("Meredith R. Lawson-Rowe", "Democratic")],
        6: [("Christine Cockley", "Democratic"), ("Matthew Jackson", "Republican")],
        7: [("Ukeme Awakessien Jeter", "Democratic"), ("Cameron Koffel", '"nonparty"'), ("William Mercier", "Republican")],
        8: [("Kelly Hunter-Kalagidis", "Republican"), ("Anita Somani", "Democratic")],
        9: [("Munira Yasin Abdullahi", "Democratic"), ("Bruce Euans", "Republican")],
        10: [("Denise D'Angelo", "Republican"), ("Mark Sigrist", "Democratic")],
        11: [("Shawn Kaeser", "Republican"), ("Crystal Lett", "Democratic")],
        12: [("Brian Stewart", "Republican"), ("Lee Yarsky", "Democratic")],
    }.items():
        groups.append((f"STATE REPRESENTATIVE OHIO HOUSE DISTRICT {district:02d}",
                       f"State Representative, District {district}", f"sldl:{district}", entries))
    local = [
        ("JUDGE OF COURT OF APPEALS 10TH DISTRICT", "Judge of Court of Appeals, 10th District", "02/09/2027", [("Michael C. Mentel", "Democratic")]),
        ("JUDGE OF COURT OF APPEALS 10TH DISTRICT", "Judge of Court of Appeals, 10th District", "07/01/2027", [("Terri Jamison", "Democratic")]),
        ("JUDGE OF THE COURT OF COMMON PLEAS (General Division)", "Judge of the Court of Common Pleas (General Division)", "01/01/2027", [("Carl Aveni", None)]),
        ("JUDGE OF THE COURT OF COMMON PLEAS (General Division)", "Judge of the Court of Common Pleas (General Division)", "02/09/2027", [("Andy Miller", None)]),
        ("JUDGE OF THE COURT OF COMMON PLEAS (General Division)", "Judge of the Court of Common Pleas (General Division)", "07/01/2027", [("David Young", None)]),
        ("JUDGE OF THE COURT OF COMMON PLEAS (General Division)", "Judge of the Court of Common Pleas (General Division)", "07/02/2027", [("Chris Brown", None)]),
        ("JUDGE OF THE COURT OF COMMON PLEAS (Domestic Relations Division)", "Judge of the Court of Common Pleas (Domestic Relations Division)", "01/02/2027", [("Kelley Gabrielle Boller", None)]),
        ("JUDGE OF THE COURT OF COMMON PLEAS (Domestic Relations Division)", "Judge of the Court of Common Pleas (Domestic Relations Division)", "01/03/2027", [("Lasheyl N. Stroud", None)]),
        ("JUDGE OF THE COURT OF COMMON PLEAS-Probate", "Judge of the Court of Common Pleas (Probate)", "02/09/2027", [("Kelly Green", None), ("Chris Junga", None)]),
        ("COUNTY AUDITOR", "County Auditor", "", [("Michael Stinziano", "Democratic")]),
        ("COUNTY COMMISSIONER", "County Commissioner", "01/01/2027", [("Erica C. Crawley", "Democratic"), ("Eric Terford", "Libertarian")]),
    ]
    assert re.search(r"### Tenth District\s+L126:.*?L127:.*?Franklin", (EVIDENCE / "oh-appellate-geography.web.txt").read_text(), re.S)
    for office, title, term, entries in local:
        groups.append((office, f"Franklin County — {title}" + (f" (term commencing {term})" if term else ""), "county:franklin", entries))
    verified = []
    for office, title, division, entries in groups:
        rows = []
        for name, party in entries:
            pattern = re.escape(name) + r"\s+" + re.escape(party if party is not None else "N/A") + r"\s+" + re.escape(office)
            if party is None and "COURT" in office:
                pattern = re.escape(name) + r"\s+" + re.escape(office)
            match = re.search(pattern, source)
            assert match, (name, office)
            if "COURT" in office:
                assert re.search(pattern + r"\s+Full Term Commencing " + re.escape(next(term for o,t,term,e in local if (name,party) in e)), source), (name,"term")
            rows.append((name, party, match.group()))
        add(data, ballot, "oh", title, f"ocd-division/country:us/state:oh/{division}", rows,
            OH_URL, "Franklin County Board of Elections", office, "oh-franklin.web.txt")
        verified.append({"office": title, "candidates": len(rows)})
    for number, tail, title in [
        (8, "258ab3a2-ddef-42a8-a869-c38b6c068a06/Notice-of-Election-Columbus-Charter-Amendment-1-Petition", "Columbus Issue 8 — City Council District Elections (By Petition)"),
        (9, "a3d9d75e-83ff-492a-98c4-a8cc09e1cd60/Notice-of-Election-Columbus-Charter-Amendment-2-Council", "Columbus Issue 9 — City Council District and At-Large Elections"),
    ]:
        name = f"oh-columbus-{number}.web.txt"
        notice = web_text(name)
        assert "City of Columbus, Ohio" in notice and "November, 2026" in notice
        start = notice.index("This proposed charter amendment")
        end = notice.index("Shall the proposed charter amendment be approved?") + len("Shall the proposed charter amendment be approved?")
        question = notice[start:end].replace("\x02", "-")
        url = "https://www.vote.franklincountyohio.gov/getmedia/" + tail
        add(data, ballot, "oh", title, "ocd-division/country:us/state:oh/place:columbus", [],
            url, "Franklin County Board of Elections", question, name)
        contest = next(c for c in ballot["contests"] if c["title"] == title)
        contest.update(type="MEASURE", measureTextUrl=url)
        contest.pop("candidateListComplete", None)
        if not any(m["contestId"] == contest["id"] for m in ballot["measures"]):
            ballot["measures"].append({"id":contest["id"]+"-question", "contestId":contest["id"],
                "officialNumber":str(number), "questionText":question, "officialStatement":None,
                "provenance":contest["provenance"]})
    if write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return {"state": "OH", "officialSource": OH_URL, "sourceScope": "Franklin County candidate list, October 16; this source covers county-overlapping districts. Other saved official county lists and samples complete all Ohio federal/statewide/legislative districts.",
            "before": before, "after": [len(ballot["contests"]), len(ballot["candidacies"])], "verifiedAdditions": verified}


def ohio_sample_core(write):
    path,data,ballot=load_state('oh')
    specs=[
        ('warren-fifty-fifth-house',[("State Representative",55,[("Paul Michael Kurtz","Democratic"),("Philip L. Pirdy","Libertarian"),("C. Michelle Teska","Republican")])]),
        ('warren-fifty-sixth-house',[("State Representative",56,[("Laalitya Acharya","Democratic"),("Adam Mathews","Republican")])]),
        ('delaware-60th-house-district',[("State Representative",60,[("Shelby Kimball","Democratic"),("Brian Lorenz","Republican")])]),
        ('lucas-house-district-41',[("State Senator",11,[("James Nowak","Republican"),("Kenneth W. Sharp","Libertarian"),("Paula Hicks-Hudson","Democratic")]),("State Representative",41,[("Ian Chamberlin","Republican"),("Erika White","Democratic")])]),
        ('lucas-house-district-42',[("State Representative",42,[("Robert McMahon","Republican"),("Elgin Rogers Jr.","Democratic")])]),
        ('lucas-house-district-43',[("State Representative",43,[("Michele Grim","Democratic"),("Zach Hall","Libertarian"),("David Karmol","Republican")])]),
    ]
    counts=[]
    for stem,groups in specs:
        source_name='oh-sample-'+stem+'.right.txt';meta=json.loads((EVIDENCE/('oh-sample-'+stem+'.retrieval.json')).read_text());text=web_text(source_name)
        assert 'november 3, 2026' in web_text('oh-sample-'+stem+'.full.txt').lower()
        for kind,number,rows in groups:
            heading=re.search('For '+kind+r' \('+str(number)+r'(?:st|nd|rd|th) District\)',text)
            assert heading,(stem,kind,number)
            section=text[heading.end():].split('For ',1)[0]
            for name,party in rows:assert f'{name} {party}' in section,(stem,name,party)
            division='sldu' if kind=='State Senator' else 'sldl';title=f'{kind}, District {number}'
            add(data,ballot,'oh',title,f'ocd-division/country:us/state:oh/{division}:{number}',[(name,party,f'{name} {party}') for name,party in rows],meta['url'],meta['publisher'],heading.group(),source_name)
        counts.append({'source':meta['url'],'districtContests':len(groups),'candidateRows':sum(len(g[2]) for g in groups)})
    if write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'state':'OH','officialSampleCore':counts,'contests':len(ballot['contests']),'candidacies':len(ballot['candidacies'])}


def ohio_withdrawal(write):
    path, data, ballot = load_state("oh")
    source_name = "oh-cuyahoga.web.txt"
    text = web_text(source_name)
    quote = "Ron Ula & Michael C. Lehnerd 8/24/2026 Withdrawn 10/15/2026"
    assert "For Governor and Lieutenant Governor" in text and quote in text
    candidate = next(c for c in ballot["candidacies"] if c["givenName"] == "Ron Ula and Michael C." and c["familyName"] == "Lehnerd")
    url = "https://boe.cuyahogacounty.gov/docs/default-source/boe/candidates-page/candidate-list.pdf?sfvrsn=4b1792c0_450"
    captured_at = datetime.fromtimestamp((EVIDENCE / source_name).stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z")
    provenance = {"sourceUrl":url,"sourceOrg":"Cuyahoga County Board of Elections","collectedAt":captured_at,"verifiedAt":NOW,"quote":quote}
    removals = ballot.setdefault("removals", [])
    if not any(r["id"] == candidate["id"] for r in removals):
        removals.append({**{k:candidate[k] for k in ["id","contestId","familyName","givenName","partyLabel","slogan"]},
            "status":"REMOVED_FROM_FILING", "lastListed":candidate["provenance"], "absentFrom":provenance,
            "firstAbsentOn":"2026-10-20", "statement":"Ron Ula and Michael C. Lehnerd withdrew from the Ohio governor and lieutenant governor contest on October 15, 2026, according to the Cuyahoga County Board of Elections candidate list."})
    raw = (EVIDENCE / source_name).read_bytes(); digest = hashlib.sha256(raw).hexdigest()
    if not any(s["finalUrl"] == url and s["rawHash"] == digest for s in data["sourceReceipt"]["sources"]):
        data["sourceReceipt"]["sources"].append({"requestedUrl":url,"finalUrl":url,"httpStatus":200,"retrievedAt":captured_at,"rawHash":digest,
            "publisher":"Cuyahoga County Board of Elections","sourceClass":"ELECTION_AUTHORITY","reviewedEvidence":f"Saved extracted official document text: data/ballot/evidence/ba01-great-lakes/{source_name}. Code replays the explicit withdrawal name and date. Hash identifies captured text bytes, not original PDF bytes."})
    assert "Ron Ula/Michael C. Lehnerd have withdrawn, votes for these candidates will not count" in web_text("oh-clark.web.txt")
    if write: path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n")
    return {"state":"OH","explicitWithdrawals":1,"candidacyId":candidate["id"],"firstObserved":"2026-10-20","officialWithdrawalDate":"2026-10-15","source":url}


def wisconsin(write):
    path, data, ballot = load_state("wi")
    before = len(ballot["contests"]), len(ballot["candidacies"])
    source = web_text("wi-dane.web.txt")
    lines = re.findall(r"^L\d+(?:@P[\d-]+)?: (.*)$", (EVIDENCE / "wi-dane.web.txt").read_text(), re.M)
    assert "November 3, 2026" in source
    groups = []
    current = None
    for line in lines:
        m = re.match(r"State (Senator|Assembly) [–-] District (\d+)", line)
        if m:
            kind, n = m.groups(); current = [f"{'State Senator' if kind == 'Senator' else 'Representative to the Assembly'} District {n}", f"{'sldu' if kind == 'Senator' else 'sldl'}:{n}", []];groups.append(current)
        elif line in ["Sheriff", "Clerk of Circuit Court"]:
            current = [f"Dane County {line}", "county:dane", []];groups.append(current)
        elif re.match(r"Statewide Referendum", line):
            current = None
        elif current:
            m = re.match(r"^(.+?) \((REP|DEM|Serving People Not Parties|American Solidarity Party)\)(?: Dane County)?$",line)
            if m:
                name, party = m.groups()
                # The county summary has a spelling error; the county's signed
                # Type B notice independently supplies the ballot spelling.
                if current[1] == "sldu:27":
                    assert "Dianne Hesselbein (Democratic)" in web_text("wi-town-dane.web.txt")
                    name = "Dianne Hesselbein"
                current[2].append((name, {"REP":"Republican", "DEM":"Democratic"}.get(party,party), line))
    verified = []
    for title, division, rows in groups:
        if division in ["sldu:17", "sldl:50"]:
            continue  # The complete contests already exist from Green County.
        town = division == "sldu:27"
        add(data, ballot, "wi", title, f"ocd-division/country:us/state:wi/{division}",
            [(n,p,"Dianne Hesselbein (Democratic)" if town else q) for n,p,q in rows],
            WI_TOWN_URL if town else WI_URL, "Dane County Clerk", title,
            "wi-town-dane.web.txt" if town else "wi-dane.web.txt")
        verified.append({"office":title,"candidates":len(rows)})
    if write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return {"state":"WI", "officialSource":WI_URL, "sourceScope":"Dane County sample comparison only; statewide Wisconsin comparison belongs to Pacific.",
            "before":before,"after":[len(ballot["contests"]),len(ballot["candidacies"])],"verifiedAdditions":verified}


def ohio_district_lists(write):
    path, data, ballot=load_state('oh'); before=len(ballot['contests']),len(ballot['candidacies'])
    sources=[('oh-cuyahoga.web.txt','https://boe.cuyahogacounty.gov/docs/default-source/boe/candidates-page/candidate-list.pdf?sfvrsn=4b1792c0_450','Cuyahoga County Board of Elections'),
             ('oh-summit.web.txt','https://www.boe.ohio.gov/summit/c/upload/Election_CandidateList.pdf','Summit County Board of Elections')]
    counts=[]
    for source_name,url,publisher in sources:
        lines=re.findall(r'^L\d+(?:@P[\d-]+)?: (.*)$',(EVIDENCE/source_name).read_text(),re.M)
        assert any('November 3, 2026' in line for line in lines)
        groups=defaultdict(list); kind=None; number=None
        for line in lines:
            if source_name=='oh-cuyahoga.web.txt':
                match=re.match(r'For (Representative to Congress|State Senator|State Representative)$',line)
                if match: kind=match.group(1);number=None;continue
                if line.startswith('For '):kind=None;number=None
                match=re.match(r'\((\d+)(?:st|nd|rd|th) District\)',line)
                if kind and match:number=int(match.group(1));continue
                if not kind or number is None or not re.search(r'\d{1,2}/\d{1,2}/20\d{2}',line):continue
                if 'Yes' not in line or 'Withdrawn' in line or 'Removed' in line:continue
                party=next((p for p in ['Democratic','Republican','Libertarian','Nonpartisan'] if p in line),None)
                name=re.split(r'\d{1,2}/\d{1,2}/20\d{2}',line)[0].strip()
                if party and party in name:name=name[:name.index(party)].strip()
                groups[(kind,number)].append((name,party,line))
            else:
                match=re.match(r'(\d+)(?:ST|ND|RD|TH) DISTRICT (CONGRESSIONAL REPRESENTATIVE|STATE SENATOR|STATE REPRESENTATIVE)$',line)
                if match:
                    number=int(match.group(1));kind={'CONGRESSIONAL REPRESENTATIVE':'Representative to Congress','STATE SENATOR':'State Senator','STATE REPRESENTATIVE':'State Representative'}[match.group(2)];continue
                if line.startswith(('CITY OF','9TH DISTRICT COURT')):kind=None;number=None
                if not kind or number is None:continue
                match=re.match(r'(.+?) \((R|D|L|Nonparty candidate|Other-party candidate|WRITE-IN)\)',line)
                if match:
                    name,party=match.groups();groups[(kind,number)].append((name,{'R':'Republican','D':'Democratic','L':'Libertarian','WRITE-IN':None}.get(party,party),match.group()))
        expected=15 if 'cuyahoga' in source_name else 7
        assert len(groups)==expected,(source_name,len(groups))
        for (kind,number),rows in groups.items():
            division={'Representative to Congress':'cd','State Senator':'sldu','State Representative':'sldl'}[kind]
            title=f'{kind}, District {number}'
            add(data,ballot,'oh',title,f'ocd-division/country:us/state:oh/{division}:{number}',rows,url,publisher,title,source_name)
        counts.append({'source':url,'districtContests':len(groups),'candidateRows':sum(len(v) for v in groups.values())})
    source_name='oh-montgomery.web.txt'
    text=web_text(source_name)
    url='https://www.montgomery.boe.ohio.gov/wp-content/uploads/2023/10/10.16.2026-Candidate-Petition-Report.pdf'
    groups=[('Representative to Congress',10,[('Kristina Knickerbocker','Democratic','DEM'),('Thomas F. McMasters','Libertarian','LIB'),('Mike Turner','Republican','REP')]),
            ('State Senator',5,[('Jeffrey Harris','Democratic','DEM'),('Phil Plummer','Republican','REP')]),
            ('State Representative',36,[('Chuck Horn',None,''),('Rose Lounsbury','Democratic','DEM'),('Andrea White','Republican','REP')]),
            ('State Representative',37,[('Tom Herner','Democratic','DEM'),('Tom Young','Republican','REP')]),
            ('State Representative',38,[('Desiree Tims','Democratic','DEM')]),
            ('State Representative',39,[('Daquan Neal','Democratic','DEM'),('Mark Campbell','Republican','REP')]),
            ('State Representative',40,[('Timothy B. Hornbacker','Democratic','DEM'),('Joshua A. Umbaugh','Libertarian','LIB'),('Rodney Creech','Republican','REP')])]
    assert 'Friday, October 16, 2026' in text
    for kind,number,rows in groups:
        heading=re.search(re.escape(kind)+r'-\s*'+str(number)+r'(?:st|nd|rd|th) District \(1\)',text)
        assert heading,(kind,number)
        section=re.split(r'(?:Representative to Congress|State Senator|State Representative|Judge of the Court)',text[heading.end():],maxsplit=1)[0]
        source_rows=[]
        for name,party,abbr in rows:
            assert re.search(re.escape((abbr+' '+name).strip())+r' ',section),(number,name)
            source_rows.append((name,party,(abbr+' '+name).strip()))
        title=f'{kind}, District {number}'
        division={'Representative to Congress':'cd','State Senator':'sldu','State Representative':'sldl'}[kind]
        add(data,ballot,'oh',title,f'ocd-division/country:us/state:oh/{division}:{number}',source_rows,url,'Montgomery County Board of Elections',heading.group(),source_name)
    counts.append({'source':url,'districtContests':len(groups),'candidateRows':sum(len(x[2]) for x in groups)})
    source_name='oh-hamilton.web.txt';text=web_text(source_name)
    url='https://votehamiltoncountyohio.gov/wp-content/uploads/2026/09/November-2026-Certified-Candidate-Profile-and-Data.pdf'
    groups=defaultdict(list)
    for m in re.finditer(r'([A-Z][A-Za-z.\-]*(?: [A-Za-z.\-]+){1,4}) (Representative to Congress|State Senate|State Representative) \((\d+)(?:st|nd|rd|th) [Dd]istrict\) \d+/\d+/2027 (Republican|Democratic|Libertarian)',text):
        name,kind,number,party=m.groups();kind='State Senator' if kind=='State Senate' else kind
        groups[(kind,int(number))].append((name,party,m.group()))
    assert len(groups)==11 and sum(len(v) for v in groups.values())==21,groups
    for (kind,number),rows in groups.items():
        title=f'{kind}, District {number}';division={'Representative to Congress':'cd','State Senator':'sldu','State Representative':'sldl'}[kind]
        add(data,ballot,'oh',title,f'ocd-division/country:us/state:oh/{division}:{number}',rows,url,'Hamilton County Board of Elections',title,source_name)
    counts.append({'source':url,'districtContests':len(groups),'candidateRows':sum(len(v) for v in groups.values())})
    for candidate in ballot['candidacies']:
        if candidate['id'].endswith('-candidate-tracy-l-tackett'):
            assert 'Tracey L. Tackett US CONGRESS' in web_text('oh-mercer.web.txt')
            candidate['familyName']='Tracey L. Tackett'
            candidate['provenance'].update(sourceUrl='https://www.mercercountyoh.gov/bskpdf/46-day--updated-10-15-26/',sourceOrg='Mercer County Board of Elections',verifiedAt=NOW,quote='Tracey L. Tackett US CONGRESS Countywide')
    specs=[('oh-erie.web.txt','https://www.boe.ohio.gov/erie/c/upload/Election_Candidates.pdf','Erie County Board of Elections',[
        ('Representative to Congress',9,[('Marcy Kaptur','Democratic'),('Derek Merrin','Republican'),('Kathy McKinstry',None)]),
        ('State Representative',89,[('Easton Michael Retzke','Democratic'),('Caleb Stidham','Republican'),('Steve Kraus',None)])]),
        ('oh-licking.web.txt','https://www.boe.ohio.gov/licking/c/upload/ELECTION_Candidates.pdf','Licking County Board of Elections',[
        ('Representative to Congress',12,[('JERRAD CHRISTIAN','Democratic'),('TROY BALDERSON','Republican')]),
        ('State Representative',68,[('MASON BLANKENSHIP','Democratic'),('THAD CLAGGETT','Republican')]),
        ('State Representative',69,[('AMY RIGSBY','Democratic'),('KEVIN D. MILLER','Republican')])]),
        ('oh-ashtabula.web.txt','https://www.boe.ohio.gov/ashtabula/c/upload/Election_Candidates.pdf','Ashtabula County Board of Elections',[
        ('State Representative',65,[('JOHN BARBO','Democratic'),('DAVID THOMAS','Republican')]),
        ('State Representative',99,[('SARAH FOWLER ARTHUR','Republican'),('LOUIS MURPHY','Democratic')])]),
        ('oh-lake.web.txt','https://wpassets.lakecountyohio.gov/wp-content/uploads/sites/12/2026/10/15161638/2026-Candidate-Filings.pdf','Lake County Board of Elections',[
        ('Representative to Congress',14,[('David P. Joyce','Republican'),('Maria Jukic','Democratic')]),
        ('State Representative',57,[('Belinda Grassi','Nonparty'),('Jesse Styles','Republican'),('Rick Walker','Democratic')])]),
        ('oh-fairfield.web.txt','https://www.boe.ohio.gov/fairfield/c/upload/Election_Candidates.pdf','Fairfield County Board of Elections',[
        ('State Representative',73,[('JEFF LARE','Republican'),('WHITTNEY WOOD','Democratic')])]),
        ('oh-medina.web.txt','https://www.boe.ohio.gov/medina/c/upload/FWAB_11November46Day.pdf','Medina County Board of Elections',[
        ('State Representative',66,[('CHRIS NARDO','Democratic'),('JUSTIN P. PEROLI','Libertarian'),('SEAN M. HUTSON','Republican')]),
        ('State Representative',67,[('HEATHER L. SAMPLE','Democratic'),('MELANIE MILLER','Republican')])]),
        ('oh-greene.web.txt','https://www.boe.ohio.gov/greene/c/upload/Election_CandidatesList.pdf','Greene County Board of Elections',[
        ('State Representative',70,[('KIM MCCARTHY','Democratic'),('BRIAN LAMPTON','Republican')]),
        ('State Representative',71,[('LEVI DEAN','Republican'),('KRISTA MAGAW','Democratic')])]),
        ('oh-jefferson.web.txt','https://www.boe.ohio.gov/jefferson/c/upload/FWAB_11November46Day.pdf','Jefferson County Board of Elections',[
        ('Representative to Congress',6,[('Elizabeth Kirtley','Democratic'),('Michael A. Rulli','Republican')]),
        ('State Representative',96,[('Ron Ferguson','Republican'),('Charrie L. Foglio','Democratic')])]),
        ('oh-clark.web.txt','https://www.boe.ohio.gov/clark/c/upload/FWAB_11November46Day.pdf','Clark County Board of Elections',[
        ('Representative to Congress',4,[('Joshua D. Kolasinski','Democratic'),('Jim Jordan','Republican')]),
        ('State Representative',74,[('Darrell E. Jackson','Democratic'),('Bernard Willis','Republican')])]),
        ('oh-brown.web.txt','https://www.boe.ohio.gov/brown/c/upload/FWAB_11November46Day.pdf','Brown County Board of Elections',[
        ('Representative to Congress',2,[('Jen Mazzuckelli','Democratic'),('David J. Taylor','Republican')]),
        ('State Representative',63,[('Debbie Davidson','Democratic'),('Adam C. Bird','Republican')]),
        ('State Representative',90,[('Collin Docterman','Democratic'),('Justin Pizzulli','Republican')])]),
        ('oh-shelby.web.txt','https://www.boe.ohio.gov/shelby/c/upload/FWAB_11November46Day.pdf','Shelby County Board of Elections',[
        ('State Representative',85,[('VICTORIA MADDOX','Democratic'),('TIM BARHORST','Republican')])]),
        ('oh-paulding.web.txt','https://www.boe.ohio.gov/paulding/c/upload/FWAB_11November46Day.pdf','Paulding County Board of Elections',[
        ('State Senator',1,[('CRAIG S. RIEDEL','Republican')]),
        ('State Representative',82,[('MADDUX MCCRAY','Democratic'),('CHRISTOPHER ELDER','Libertarian'),('ROY W. KLOPFENSTEIN','Republican')])]),
        ('oh-wyandot.web.txt','https://www.boe.ohio.gov/wyandot/c/upload/FWAB_11November46Day.pdf','Wyandot County Board of Elections',[
        ('State Representative',87,[('Lora Covrett','Democratic'),('Jeffrey A. McClain','Republican'),('Craig Swartz','Independent'),('Greg White',None)])]),
        ('oh-lawrence.web.txt','https://www.boe.ohio.gov/lawrence/c/upload/FWAB_11November46Day.pdf','Lawrence County Board of Elections',[
        ('State Senator',17,[('Brian A. Deer','Democratic'),('Shane Wilkin','Republican')]),
        ('State Representative',93,[('Jessica Harper','Democratic'),('Jason Stephens','Republican')])]),
        ('oh-holmes.web.txt','https://www.boe.ohio.gov/holmes/c/upload/FWAB_11November46Day.pdf','Holmes County Board of Elections',[
        ('State Senator',19,[('Scott Charland','Democratic'),('Ryan Rivers','Republican')]),
        ('State Representative',98,[('Scott Grund','Democratic'),('Mark Hiner','Republican')])]),
        ('oh-knox.web.txt','https://www.boe.ohio.gov/knox/c/upload/FWAB_11November46Day.pdf','Knox County Board of Elections',[
        ('State Representative',61,[('VINCE MCGRAIL','Democratic'),('SHAWN STEVENS','Republican')])]),
        ('oh-mahoning.web.txt','https://vote.mahoningcountyoh.gov/DocumentCenter/View/2648/46-Day-Notice---2026-General?bidId=','Mahoning County Board of Elections',[
        ('State Senator',33,[('Michael L Kripchak','Democratic'),('Al Cutrona','Republican')]),
        ('State Representative',58,[('John A. Boccieri','Democratic'),('Heather Fronk','Republican')]),
        ('State Representative',59,[('Wayne Penny, Jr.','Democratic'),('Tex Fischer','Republican')])]),
        ('oh-trumbull-fwab.web.txt','https://boe.co.trumbull.oh.gov/pdfs/46%20day%20notice.pdf','Trumbull County Board of Elections',[
        ('State Representative',64,[('NICK SANTUCCI','Republican')])]),
        ('oh-richland.web.txt','https://www.boe.ohio.gov/richland/c/upload/FWAB_11November46Day.pdf','Richland County Board of Elections',[
        ('State Representative',76,[('Colton Stidam','Democratic'),('Marilyn S. John','Republican')])]),
        ('oh-ross.web.txt','https://www.boe.ohio.gov/ross/c/upload/FWAB_11November46Day.pdf','Ross County Board of Elections',[
        ('State Representative',91,[('AMY WRIGHT','Democratic'),('BOB PETERSON','Republican')]),
        ('State Representative',92,[('SARAH SENFF','Democratic'),('MARK JOHNSON','Republican')])]),
        ('oh-washington.web.txt','https://www.boe.ohio.gov/washington/c/upload/FWAB_11November46Day.pdf','Washington County Board of Elections',[
        ('State Representative',94,[('Wenda Sheard','Democratic'),('Kevin Ritter','Republican')])]),
        ('oh-belmont.web.txt','https://www.boe.ohio.gov/belmont/c/upload/FWAB_11November46Day.pdf','Belmont County Board of Elections',[
        ('State Representative',95,[('Paul Cameron','Democratic'),('Ty Moore','Republican')])]),
        ('oh-henry.web.txt','https://www.henrycountyohio.gov/DocumentCenter/View/1059/46-Day-Notice-PDF','Henry County Board of Elections',[
        ('State Representative',81,[('David Swanson','Democratic'),('Patti Rockey','Republican')])]),
        ('oh-mercer.web.txt','https://www.mercercountyoh.gov/bskpdf/46-day--updated-10-15-26/','Mercer County Board of Elections',[
        ('State Representative',84,[('Arienne C. Childrey','Democratic'),('Angie King','Republican')]),
        ('Representative to Congress',4,[('Tracey L. Tackett',None)])]),
        ('oh-allen.web.txt','https://www.dropbox.com/scl/fi/2e7gtmv9d30h0wyztnces/2026_GENERAL_FWAB.pdf?dl=1&rlkey=zseu69mlokl60inwapljzmsga','Allen County Board of Elections',[
        ('State Representative',78,[('Jeffrey R. Givan','Democratic'),('Matt Huffman','Republican')])]),
        ('oh-hancock.web.txt','https://docs.google.com/document/d/1hsyr289kQ_Q32VhOIQeOn_fEeRk04fQecBoveOXyc4Y/export?format=txt','Hancock County Board of Elections',[
        ('State Representative',83,[('Sheila Coressel','Democratic'),('Ty Mathews','Republican')])]),
        ('oh-union.web.txt','https://www.unioncountyohio.gov/media/Agencies/Board%20of%20Elections/46%20Day%20notice%20with%20candidates.pdf','Union County Board of Elections',[
        ('State Representative',86,[('KENT HALLORAN','Democratic'),('BEN WEBER','Republican')])]),
        ('oh-muskingum.web.txt','https://www.boe.ohio.gov/muskingum/c/upload/FWAB_11November46Day.pdf','Muskingum County Board of Elections',[
        ('State Senator',31,[('Laura Sirot','Democratic'),('Al Landis','Republican')]),
        ('State Representative',97,[('Kris Geis',None),('Tim Godwin','Libertarian'),('Adam P. Holmes','Republican')])]),
        ('oh-stark.web.txt','https://www.starkcountyohio.gov/Board%20of%20Elections/Candidates%20List%20General.pdf','Stark County Board of Elections',[
        ('State Senator',29,[('Thomas West','Democratic'),('Jane Timken','Republican')]),
        ('State Representative',48,[('Nick Morris','Democratic'),('Christina M. Hagan','Republican')]),
        ('State Representative',49,[('Krista L. Allison','Democratic'),('Jim Thomas','Republican')]),
        ('State Representative',50,[('Rylan Zachary Finzer','Democratic'),('Matthew Kishman','Republican')]),
        ('State Representative',51,[('Amanda Fontana','Democratic'),('Jodi Salvo','Republican')])]),
        ('oh-wood.web.txt','https://boe.woodcountyohio.gov/DocumentCenter/View/1006/Candidate-List','Wood County Board of Elections',[
        ('State Representative',44,[('David J. Fournier','Democratic'),('Edward L. Schimmel','Republican'),('Lyndsey A. Stough','Independent')]),
        ('State Representative',75,[('Richard J. Rettig','Democratic'),('Haraz N. Ghanbari','Republican')])]),
        ('oh-wayne.web.txt','https://www.waynecountyoh.gov/wp-content/uploads/2026/10/Form-120-46-Day-FWAB-Gen-26-10162026-0910.pdf','Wayne County Board of Elections',[
        ('State Representative',77,[('Brooke Dillon','Democratic'),('Meredith Craig','Republican')])]),
        ('oh-columbiana.web.txt','https://columbiana.boe.ohio.gov/wp-content/uploads/2026/09/46-Day-FWAB-Nov-3-2026-General.pdf','Columbiana County Board of Elections',[
        ('State Representative',79,[('Monica Robb Blasdel','Republican'),('Bob Guy','Democratic')])]),
        ('oh-darke.web.txt','https://www.boe.ohio.gov/darke/c/upload/FWAB_11November46Day.pdf','Darke County Board of Elections',[
        ('State Representative',80,[('Katie Koehler Wagner','Democratic'),('Johnathan Newman','Republican')])]),
        ('oh-seneca.web.txt','https://www.boe.ohio.gov/seneca/c/upload/FWAB_11November46Day.pdf','Seneca County Board of Elections',[
        ('State Representative',88,[('Gary Click','Republican'),('Aaron W. Jones','Democratic')])]),
        ('oh-clermont.web.txt','https://cms2.revize.com/revize/clermontcounty/FWAB%2046%20day%20-%20November%203,%202026%20General%20r5.pdf?t=202610151622530','Clermont County Board of Elections',[
        ('State Representative',62,[('Ron Grethel','Libertarian'),('Jean Schmidt','Republican'),('Ian Schwartz','Democratic')])]),
        ('oh-portage.web.txt','https://www.portagecounty-oh.gov/sites/g/files/vyhlif3706/f/uploads/november_3_2026_46_day_notice_update.pdf','Portage County Board of Elections',[
        ('State Representative',72,[('Jeff Clapper','Democratic'),('Michael Fricke','Libertarian'),('Heidi Workman','Republican')])])]
    for source_name,url,publisher,groups in specs:
        text=web_text(source_name)
        for kind,number,rows in groups:
            # Office and every full name are replayed from this retained official capture.
            assert re.search(str(number)+r'(?:st|nd|rd|th)? (?:Dist|OHIO REPRESENTATIVE|STATE HOUSE|House District)|District '+str(number)+r'|(?:Congress|Rep) '+str(number)+r'(?:st|nd|rd|th)|State Representative- '+str(number),text,re.I),number
            for name,party in rows:
                assert name in text,(source_name,name)
                if source_name=='oh-erie.web.txt':
                    assert re.search(re.escape(name)+r'.{0,150}'+re.escape(party or 'n/a'),text),(name,party)
                elif source_name=='oh-licking.web.txt':
                    assert f"{name} ({party[0]})" in text,(name,party)
                elif source_name=='oh-ashtabula.web.txt':
                    assert f'{party.upper()} {name}' in text,(name,party)
                elif source_name=='oh-lake.web.txt':
                    assert f"{party[0] if party in ['Democratic','Republican'] else party} {name}" in text,(name,party)
                elif source_name=='oh-fairfield.web.txt':
                    assert f'{name} ({party[0]})' in text,(name,party)
                elif source_name=='oh-medina.web.txt':
                    assert f'{name} ({party[:3]})' in text,(name,party)
                elif source_name=='oh-greene.web.txt':
                    assert re.search(re.escape(name)+r'\s+STATE REP '+str(number)+r'(?:ST|ND|RD|TH) DISTRICT .{0,400}'+('DEMOCRAT' if party=='Democratic' else 'REPUBLICAN'),text),(name,party)
                elif source_name=='oh-jefferson.web.txt':
                    assert re.search(re.escape(name)+r' (?:Congress|House of Rep) '+str(number)+r'(?:st|nd|rd|th) '+party[:3],text),(name,party)
                elif source_name=='oh-clark.web.txt' and party:
                    assert f'{name} {party}' in text,(name,party)
                elif source_name in ['oh-brown.web.txt','oh-shelby.web.txt','oh-paulding.web.txt','oh-knox.web.txt','oh-richland.web.txt','oh-ross.web.txt','oh-washington.web.txt','oh-belmont.web.txt','oh-muskingum.web.txt','oh-wayne.web.txt','oh-darke.web.txt']:
                    assert (not party) or f'{name} ({party[:3]})' in text,(name,party)
                elif source_name=='oh-wyandot.web.txt' and party:
                    assert f'{name} State Representative 87th District {party}' in text,(name,party)
                elif source_name=='oh-lawrence.web.txt':
                    assert re.search(re.escape(name)+r' State (?:Rep\.|Senate) '+str(number)+r'(?:st|nd|rd|th) Dist\. '+party[:3].upper(),text),(name,party)
                elif source_name=='oh-holmes.web.txt':
                    assert f'{name} {party}' in text,(name,party)
                elif source_name=='oh-mahoning.web.txt':
                    assert re.search(re.escape(name)+r' State (?:Senate/|Representative/)'+str(number)+r'(?:st|nd|rd|th) District '+party,text),(name,party)
                elif source_name=='oh-clermont.web.txt':
                    assert f'{name} {party}' in text,(name,party)
                elif source_name=='oh-portage.web.txt':
                    assert re.search(re.escape(name)+r'.{0,90}'+party,text),(name,party)
                elif source_name=='oh-stark.web.txt':
                    assert f'{party} Nominated {name}' in text,(name,party)
                elif source_name=='oh-wood.web.txt':
                    assert f'{party} {name}' in text,(name,party)
                elif source_name=='oh-columbiana.web.txt':
                    assert re.search(re.escape(name)+r' State Representative '+str(number)+r'th District '+party[:3],text,re.I),(name,party)
                elif source_name=='oh-seneca.web.txt':
                    assert f'{name} For State Representative ({number}th District) {party[0]}' in text,(name,party)
                elif source_name=='oh-allen.web.txt':
                    assert f'{name} ({party[:3]})' in text,(name,party)
                elif source_name=='oh-hancock.web.txt':
                    assert f'{name} ({party[0]})' in text,(name,party)
                elif source_name=='oh-union.web.txt':
                    assert f'{name} ({party[:3]})' in text,(name,party)
                elif source_name=='oh-henry.web.txt':
                    assert re.search(re.escape(name)+r' Ohio House of Representative '+str(number)+r'st District '+party,text),(name,party)
                elif source_name=='oh-mercer.web.txt' and party:
                    assert f'{name} {number}th STATE HOUSE OF REPRESENTATIVES {party[0]}' in text,(name,party)
                elif source_name=='oh-trumbull-fwab.web.txt':
                    assert re.search(re.escape(name)+r' STATE REPRESENTATIVE – '+str(number)+r'TH DISTRICT '+party[:3].upper(),text),(name,party)
            rows=[(name,party,name) for name,party in rows]
            title=f'{kind}, District {number}';division={'Representative to Congress':'cd','State Senator':'sldu','State Representative':'sldl'}[kind]
            add(data,ballot,'oh',title,f'ocd-division/country:us/state:oh/{division}:{number}',rows,url,publisher,title,source_name)
        counts.append({'source':url,'districtContests':len(groups),'candidateRows':sum(len(x[2]) for x in groups)})
    for source_name,url,publisher,expected in [
        ('oh-lorain.web.txt','https://www.voteloraincountyohio.gov/_files/ugd/2568d0_ef2bd7f0adc244659d5357bfa1879d07.pdf','Lorain County Board of Elections',5),
        ('oh-butler.web.txt','https://elections.bcohio.gov/2026/November/PetitionActivityReport.pdf','Butler County Board of Elections',7)]:
        lines=re.findall(r'^L\d+(?:@P[\d-]+)?: (.*)$',(EVIDENCE/source_name).read_text(),re.M)
        groups=defaultdict(list);current=None
        for line in lines:
            if source_name=='oh-lorain.web.txt':
                match=re.search(r'(Representative to Congress|State Senator|State Representative) ?-? (\d+)(?:st|nd|rd|th) District',line)
                if match:current=(match.group(1),int(match.group(2)));continue
                if line.startswith('Page 4 of 5Judge'):current=None
                match=re.match(r'(.+?) (Republican|Democratic|Libertarian|Other Party|Write-In) 1 [24] ',line)
                if current and match:groups[current].append((match.group(1),match.group(2),line))
            else:
                match=re.search(r'([\d]+)(?:st|nd|rd|th) (?:Congressional|State Senate|House) District - (?:For )?(Representative to Congress|State Senator|State Representative)',line)
                if match:current=(match.group(2),int(match.group(1)));continue
                if line.startswith('12th County Court'):current=None
                match=re.match(r'\(([DRL])\) (.+?) (?:Files with|\(P\))',line)
                if current and match:
                    party,name=match.groups();groups[current].append((name,{'D':'Democratic','R':'Republican','L':'Libertarian'}[party],line))
        assert len(groups)==expected,(source_name,groups)
        for (kind,number),rows in groups.items():
            title=f'{kind}, District {number}';division={'Representative to Congress':'cd','State Senator':'sldu','State Representative':'sldl'}[kind]
            add(data,ballot,'oh',title,f'ocd-division/country:us/state:oh/{division}:{number}',rows,url,publisher,title,source_name)
        counts.append({'source':url,'districtContests':len(groups),'candidateRows':sum(len(v) for v in groups.values())})
    if write:path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'state':'OH','districtSourceComparisons':counts,'before':before,'after':[len(ballot['contests']),len(ballot['candidacies'])]}


def core_comparisons():
    # Michigan's report includes disqualified and withdrawn filings. Those rows
    # are excluded using the report's own status; incumbency is not a party.
    from lxml import html
    import openpyxl
    source = gzip.decompress((EVIDENCE / "mi-1.html.gz").read_bytes())
    table = html.fromstring(source).xpath('//table[@class="jrPage"]')[0]
    sections = []
    current = None
    for tr in table.xpath('./tr'):
        cells = [' '.join(x.text_content().split()) for x in tr.xpath('./td')]
        cells = [s for s in cells if s]
        if len(cells) == 1 and ' Position' in cells[0]:
            current = {"title": cells[0], "rows": []}; sections.append(current)
        elif current and len(cells) > 1 and re.search(r'\d{2}/\d{2}/\d{4}', ' '.join(cells)):
            if cells[0] not in ['DISQ', 'WITHD']:
                current['rows'].append((cells[-3], cells[-4] if len(cells)>3 and ('Party' in cells[-4] or cells[-4] == 'No Party Affiliation') else None))
    _, _, ballot = load_state('mi')
    verified = 0
    for contest in ballot['contests']:
        if contest['type'] != 'CANDIDACY': continue
        section = next(s for s in sections if s['title']==contest['title'] or s['title'].startswith(contest['title']+' '))
        held = {(c['familyName'],c['partyLabel']) for c in ballot['candidacies'] if c['contestId']==contest['id']}
        assert held == set(section['rows']), contest['title']
        verified += len(held)
    mi_contests=[c for c in ballot['contests'] if c['type']=='CANDIDACY']
    results = [{"state":"MI", "officialCoreContests":170,"officialCandidateContests":len(sections),"repositoryCandidateContests":len(mi_contests),
        "officialCandidateRows":sum(len(s['rows']) for s in sections),"repositoryCandidateRows":verified,"missingCoreContests":[],
        "missingCoreCandidates":[],"source":next(s['finalUrl'] for s in load_state('mi')[1]['sourceReceipt']['sources'] if 'entellitrak' in s['finalUrl']),
        "remaining":"County/city/school contests and local measures, remaining district-court boundary memberships and full sample-ballot/live comparison still owed."}]
    workbook = openpyxl.load_workbook(io.BytesIO(gzip.decompress((EVIDENCE/'in-0.xlsx.gz').read_bytes())),read_only=True,data_only=True)
    offices = defaultdict(list)
    for row in workbook.active.iter_rows(values_only=True):
        if len(row)>=4 and row[0] and row[1] and row[2] and row[0] not in ['OFFICE CATEGORY:','BALLOT NAME']:
            offices[row[2]].append((row[0],row[1]))
    _, data, ballot = load_state('in')
    verified = 0
    for contest in ballot['contests']:
        if contest['type'] != 'CANDIDACY': continue
        held = {((c['givenName']+' '+c['familyName']).strip(),c['partyLabel']) for c in ballot['candidacies'] if c['contestId']==contest['id']}
        assert held == set(offices[contest['title']]), contest['title']
        verified += len(held)
    results.append({"state":"IN","officialCandidateContests":137,"repositoryCandidateContests":137,
        "officialCandidateRows":verified,"repositoryCandidateRows":271,"missingCoreContests":[],"missingCoreCandidates":[],
        "source":data['sourceReceipt']['sources'][0]['finalUrl'],
        "remaining":"County, township, city, school, judicial-district contests and local questions need sample-ballot reconciliation."})
    source_lines = re.findall(r'^L\d+(?:@P[\d-]+)?: (.*)$',(EVIDENCE/'ia-candidates.web.txt').read_text(),re.M)
    _, data, ballot = load_state('ia')
    by_title = {c['title']:c for c in ballot['contests']}
    groups=defaultdict(list); current=None; source_count=0
    for line in source_lines:
        match=re.match(r'(?:(United States Senator|United States Representative District \d+|Governor|Lieutenant Governor|Secretary of State|Auditor of State|Treasurer of State|Secretary of Agriculture|Attorney General|State Senator District \d+|State Representative District \d+) )?(Republican|Democratic|Libertarian|No Party) (.+)',line)
        if not match: continue
        office,party,rest=match.groups()
        if office: current=office
        if rest=='--': continue
        source_count+=1
        title='Governor / Lieutenant Governor' if current in ['Governor','Lieutenant Governor'] else current
        contest=by_title[title]
        held=[c for c in ballot['candidacies'] if c['contestId']==contest['id'] and c['partyLabel']==party]
        matches=[]
        for candidate in held:
            names=(candidate['givenName']+' '+candidate['familyName']).strip().split('\n')
            expected=names[0 if current=='Governor' else 1] if current in ['Governor','Lieutenant Governor'] else names[0]
            if rest.startswith(expected+' '): matches.append(candidate['id'])
        assert len(matches)==1,(title,party,rest)
        groups[title].extend(matches)
    assert len(groups)==136 and source_count==245
    source_ids={x for values in groups.values() for x in values}
    held_ids={c['id'] for c in ballot['candidacies'] if c['contestId'] in {x['id'] for x in ballot['contests'] if x['type']=='CANDIDACY'}}
    assert source_ids==held_ids
    results.append({"state":"IA","officialCandidateContests":136,"repositoryCandidateContests":136,
        "officialCandidateRows":243,"repositoryCandidateRows":243,"officialIndividualNames":245,
        "missingCoreContests":[],"missingCoreCandidates":[],"source":data['sourceReceipt']['sources'][1]['finalUrl'],
        "remaining":"Governor/lieutenant governor are two rows per ticket in the state PDF and one joint contest in the repository. Local/sample-ballot coverage remains owed."})
    source_lines=re.findall(r'^L\d+(?:@P[\d-]+)?: (.*)$',(EVIDENCE/'mo-candidates.web.txt').read_text(),re.M)
    groups=defaultdict(list);party=None;kind=None;recent=[];i=0
    while i<len(source_lines):
        line=source_lines[i];i+=1
        match=re.search(r'(REPUBLICAN|DEMOCRATIC|LIBERTARIAN|INDEPENDENT) CANDIDATES',line)
        if match:party=match.group(1);kind=None;recent=[];continue
        match=re.match(r'For (State Auditor|U.S. Representative|State Senator|State Representative|Circuit Judge)',line)
        if match:kind=match.group(1);recent=[];continue
        if line.startswith(('CERTIFICATION','Certificate of Judicial')):kind=None
        if not party or not kind:continue
        if kind=='State Auditor' and re.match(r'^[A-Z][a-z]+ [A-Z][a-z]+$',line):groups[(kind,None)].append([party,line])
        match=re.search(r'District (\d+), (.*)',line)
        if match and kind in ['U.S. Representative','State Senator','State Representative']:
            name=re.sub(r'(?:CERTIFICATION| LIBERTARIAN PARTY EMBLEM|\s*\d+)$','',match.group(2))
            row=[party,name];groups[(kind,int(match.group(1)))].append(row);recent.append(row)
        elif re.fullmatch(r'[a-z][A-Za-z]*',line):
            # The extractor emits right-column surname tails below their rows.
            # Append those exact saved tails in source order, without guessing.
            tails=[line]
            while i<len(source_lines) and re.fullmatch(r'[a-z][A-Za-z]*',source_lines[i]):tails.append(source_lines[i]);i+=1
            for row,tail in zip(recent[-len(tails):],tails):row[1]+=tail
    _,data,ballot=load_state('mo')
    for contest in ballot['contests']:
        if contest['type']!='CANDIDACY':continue
        match=re.match(r'(U.S. Representative|State Senator|State Representative) District (\d+)',contest['title'])
        key=(match.group(1),int(match.group(2))) if match else (contest['title'],None)
        held={(c['partyLabel'],(c['givenName']+' '+c['familyName']).strip()) for c in ballot['candidacies'] if c['contestId']==contest['id']}
        assert held=={tuple(x) for x in groups[key]},(contest['title'],held,groups[key])
    assert len(groups)==189 and sum(len(v) for v in groups.values())==366
    results.append({'state':'MO','officialCandidateContests':189,'repositoryCandidateContests':189,
        'officialCandidateRows':366,'repositoryCandidateRows':366,'missingCoreContests':[],'missingCoreCandidates':[],
        'source':data['sourceReceipt']['sources'][0]['finalUrl'],
        'remaining':'District/local judicial contests and county/city sample-ballot comparisons remain owed.'})
    # General export is distinct from the all-filings search, which retains primary losers.
    groups=defaultdict(set)
    for row in csv.reader(io.StringIO(gzip.decompress((EVIDENCE/'mn-general-export.txt.gz').read_bytes()).decode('utf-8-sig')),delimiter=';'):
        if len(row)>6:groups[row[3]].add((row[1],row[6]))
    _,data,ballot=load_state('mn');count=0;contests=0
    for contest in ballot['contests']:
        if contest['type']!='CANDIDACY' or not (contest['ocdId']=='ocd-division/country:us/state:mn' or any(part in contest['ocdId'] for part in ['/cd:','/sldu:','/sldl:'])):continue
        held={((c['givenName']+' '+c['familyName']).strip(),c['partyLabel']) for c in ballot['candidacies'] if c['contestId']==contest['id']}
        assert held==groups[contest['title']],(contest['title'],held,groups[contest['title']])
        count+=len(held);contests+=1
    assert contests==221 and count==427
    results.append({'state':'MN','officialCandidateContests':221,'repositoryCandidateContests':221,'officialCandidateRows':427,'repositoryCandidateRows':427,
        'missingCoreContests':[],'missingCoreCandidates':[],'source':'https://candidates.sos.mn.gov/CandidateFilingTextView.aspx?download=false',
        'remaining':'Core comparison is scoped to federal/statewide/legislative rows. Separate ba01-great-lakes-mn-local.py verifies all114 district-judge races and selected county/school offices; remaining local and live/per-ZIP work stays open.'})
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser();parser.add_argument("--write",action="store_true");parser.add_argument("--write-wi",action="store_true");args=parser.parse_args()
    print(json.dumps([ohio(args.write),ohio_district_lists(args.write),ohio_sample_core(args.write),ohio_withdrawal(args.write),wisconsin(args.write_wi),*core_comparisons()],indent=2))
