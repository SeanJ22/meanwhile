import {subBodyId} from '../civic-data/meeting-body-crosswalk.ts';

/** A source-stated governing body, including a city's named commission. */
export function isGoverningBodyName(name:string,governmentLabel?:string,governmentClass?:string):boolean{
 const value=name.trim();
 if(/^(?:(?:city|town|village|borough|county|municipal|common|tribal) council|council|board of (?:supervisors|commissioners)|(?:city|county|town) commission|selectboard|selectmen|town board)$/i.test(value))return true;
 if(!governmentLabel || !(/^(?:city|town|village|borough|county)(?: and county)? of /i.test(governmentLabel) || ['CITY_OR_TOWN','COUNTY'].includes(governmentClass??'')))return false;
 const place=governmentLabel.replace(/^(?:city|town|village|borough|county)(?: and county)? of /i,'').trim().toLowerCase();
 return value.toLowerCase()===`${place} commission`;
}

/** An inventory is a discovery target. A sourced body's name gives that body
 * its own identity; it never renames the government's existing governing body. */
export function huntBodySubject(subjectId:string,name:string,governmentLabel?:string):string{
 if(subjectId.includes('#') && !subjectId.includes('#inventory:'))return subjectId.replace(/#calendar$/,'');
 const root=subjectId.split('#')[0];
 const governing=isGoverningBodyName(name,governmentLabel);
 const education=/^(?:school board|board of education)$/i.test(name.trim());
 return governing?`${root}#governing`:education?`${root}#board`:subBodyId(root,name);
}
export function huntFindingSubject<T extends {subjectId?:string;field?:string;value?:unknown}>(finding:T,governmentLabel?:string):T{
 if(!finding.subjectId || !finding.field || finding.value===undefined)return finding;
 const inventory=finding.subjectId.endsWith('#inventory:body');
 if((inventory && ['GOV-01','GOV-02','body.name'].includes(finding.field)) || (!finding.subjectId.includes('#') && ['GOV-02','body.name'].includes(finding.field)))return {...finding,subjectId:huntBodySubject(finding.subjectId,String(finding.value),governmentLabel),field:'GOV-02'};
 return finding;
}
