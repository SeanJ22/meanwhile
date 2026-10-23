import {subBodyId} from '../civic-data/meeting-body-crosswalk.ts';
import {isGoverningBoardName,type GoverningContext} from '../civic-data/governing-board-name.ts';

/** What the registry says about the government a body name was read under. */
function governmentContext(governmentLabel?:string,governmentClass?:string):GoverningContext{
 return {name:governmentLabel??null,
  school:/SCHOOL/i.test(governmentClass??'') || /school/i.test(governmentLabel??''),
  special:/SPECIAL|AUTHORITY|DISTRICT/i.test(governmentClass??'') && !/SCHOOL/i.test(governmentClass??''),
  county:/COUNTY|BOROUGH|PARISH/i.test(governmentClass??'') || /^(?:county|borough|parish|city and borough)\b/i.test(governmentLabel??'')};
}

/** A source-stated governing body by any common name: council, commission, assembly, board of aldermen, fiscal court, school board, "Mayor and Council", "Autauga County Commission". */
export function isGoverningBodyName(name:string,governmentLabel?:string,governmentClass?:string):boolean{
 return isGoverningBoardName(name.trim(),governmentContext(governmentLabel,governmentClass));
}

/** An inventory is a discovery target. A sourced body's name gives that body
 * its own identity; it never renames the government's existing governing body. */
export function huntBodySubject(subjectId:string,name:string,governmentLabel?:string):string{
 if(subjectId.includes('#') && !subjectId.includes('#inventory:'))return subjectId.replace(/#calendar$/,'');
 const root=subjectId.split('#')[0];
 const governing=isGoverningBodyName(name,governmentLabel);
 // A school system's governing board is its board; any other government's is its governing body.
 const school=/:(?:school|depschool):|school_district:|:nces:/.test(root) || /\b(?:school board|board of education|education board)\b/i.test(name);
 return governing?`${root}#${school?'board':'governing'}`:subBodyId(root,name);
}
export function huntFindingSubject<T extends {subjectId?:string;field?:string;value?:unknown}>(finding:T,governmentLabel?:string):T{
 if(!finding.subjectId || !finding.field || finding.value===undefined)return finding;
 const inventory=finding.subjectId.endsWith('#inventory:body');
 if((inventory && ['GOV-01','GOV-02','body.name'].includes(finding.field)) || (!finding.subjectId.includes('#') && ['GOV-02','body.name'].includes(finding.field)))return {...finding,subjectId:huntBodySubject(finding.subjectId,String(finding.value),governmentLabel),field:'GOV-02'};
 return finding;
}
