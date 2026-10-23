"""Recover public MN general export and OH sample ballots with persistent HTTP sessions.

Requires httpx and lxml. This writes source evidence only; the separate replay script
verifies and assembles ballot rows. No voter names or other individual lookups are used.

python scripts/ba01-great-lakes-fetch.py mn --out /tmp/ba01-mn
python scripts/ba01-great-lakes-fetch.py oh --county warren --district 'FIFTY FIFTH HOUSE' --out /tmp/ba01-oh
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urljoin

import httpx
from lxml import html


def fields(tree):
    result = {e.get('name'):e.get('value','') for e in tree.xpath('//input[@name]')
              if e.get('type') in ['hidden','text']}
    for e in tree.xpath('//select[@name]'):
        options = e.xpath('./option[@selected]') or e.xpath('./option')[:1]
        if options: result[e.get('name')] = options[0].get('value','')
    return result


def fetch_mn(out):
    url = 'https://candidates.sos.mn.gov/CandidateFilingSearch.aspx'
    with httpx.Client(follow_redirects=True, timeout=45) as client:
        response = client.get(url); response.raise_for_status()
        payload = fields(html.fromstring(response.content))
        payload.update(__EVENTTARGET='ctl00$ContentPlaceHolder1$lbGenStateMediaFile', __EVENTARGUMENT='')
        response = client.post(url, data=payload, headers={'Referer':url,'Origin':'https://candidates.sos.mn.gov'})
        response.raise_for_status()
        assert 'No matches found' not in response.text and ';U.S. Senator;' in response.text
        out.joinpath('mn-general-export.txt').write_bytes(response.content)
        out.joinpath('mn-general-export.retrieval.json').write_text(json.dumps({
            'requestedUrl':url,'method':'POST','finalUrl':str(response.url),'httpStatus':response.status_code,
            'bytes':len(response.content),'eventTarget':payload['__EVENTTARGET']},indent=2)+'\n')


def fetch_oh(county, district, out):
    url = f'https://lookup.boe.ohio.gov/vtrapp/{county}/ballotlist.aspx'
    with httpx.Client(follow_redirects=True, timeout=45, headers={
            'User-Agent':'Mozilla/5.0','Accept':'*/*','Referer':f'https://www.boe.ohio.gov/{county}/'}) as client:
        response = client.get(url); response.raise_for_status(); tree = html.fromstring(response.content)
        for values in [dict(cmbelectionlist='20261103G',__EVENTTARGET='cmbelectionlist'),
                       dict(cmbDistrictCat='3',__EVENTTARGET='cmbDistrictCat')]:
            payload=fields(tree);payload.update(values,__EVENTARGUMENT='')
            response=client.post(url,data=payload);response.raise_for_status();tree=html.fromstring(response.content)
        assert district in tree.xpath('//select[@name="cmbDistName"]/option/@value')
        payload=fields(tree);payload.update(cmbDistName=district,btnsubmit='Find Ballots',__EVENTTARGET='',__EVENTARGUMENT='')
        response=client.post(url,data=payload);response.raise_for_status();tree=html.fromstring(response.content)
        out.joinpath('selection.html').write_bytes(response.content)
        links=tree.xpath('//a[contains(@href,"getballot.aspx")]/@href');assert links
        ballot_url=urljoin(url,links[0]);ballot=client.get(ballot_url);ballot.raise_for_status();assert ballot.content.startswith(b'%PDF')
        out.joinpath('ballot.pdf').write_bytes(ballot.content)
        out.joinpath('retrieval.json').write_text(json.dumps({'requestedUrl':ballot_url,'finalUrl':str(ballot.url),
            'httpStatus':ballot.status_code,'bytes':len(ballot.content),'county':county,'district':district,
            'election':'20261103G'},indent=2)+'\n')


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',choices=['mn','oh']);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--county');parser.add_argument('--district');args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    if args.source=='mn':fetch_mn(args.out)
    else:
        assert args.county and args.district,'OH requires --county and --district'
        fetch_oh(args.county,args.district,args.out)
