import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { HELD_BODY_ROSTERS, BODY_ROSTERS, ROSTER_READER_DISPOSITIONS } from "../../lib/registry/body-rosters.ts";
import { floored } from "../../lib/ops/denominator-floor.ts";
const path="data/states/nj/hunt/wikipedia-nj-morris.json";
const bytes=readFileSync(path);
const source=JSON.parse(bytes.toString("utf8")) as {municipalities:{title:string;governingBody:{seats:number|null;bodyName:string|null}|null}[]};
const scope=[
  ["boonton","Boonton, New Jersey",true],
  ["boonton_township","Boonton Township, New Jersey",false],
  ["chatham_township","Chatham Township, New Jersey",false],
  ["harding_township","Harding Township, New Jersey",false],
  ["mendham_township","Mendham Township, New Jersey",false],
  ["morris_township","Morris Township, New Jersey",false],
  ["pequannock_township","Pequannock Township, New Jersey",false],
  ["lincoln_park","Lincoln Park, New Jersey",true],
] as const;
const rows=scope.map(([slug,title,mayorSeparate])=>{
  const raw=HELD_BODY_ROSTERS.find((roster)=>roster.members.some((member)=>member.id.startsWith(`roster:nj-morris-${slug}#`)));
  const reference=source.municipalities.find((row)=>row.title===title);
  if(!raw||!reference?.governingBody?.seats) throw new Error(`Missing held completeness inputs: ${slug}`);
  const projected=BODY_ROSTERS.find((roster)=>roster.bodyId===raw.bodyId)!;
  const compared=projected.members.filter((member)=>!(mayorSeparate&&member.officeTitle==="Mayor"));
  const floor=floored("distinct projected roster members","existing held governing-body seat denominator",reference.governingBody.seats,Math.min(compared.length,reference.governingBody.seats));
  return {slug,bodyId:raw.bodyId,rawCount:raw.members.length,projectedCount:projected.members.length,mayorSeparate,declaredSeats:reference.governingBody.seats,comparedCount:compared.length,missingSeats:Math.max(0,reference.governingBody.seats-compared.length),floor,sourceUrl:raw.sourceUrl,sourceOrg:raw.sourceOrg,collectedAt:raw.collectedAt,memberIds:projected.members.map((member)=>member.id),dispositions:ROSTER_READER_DISPOSITIONS.filter((row)=>raw.members.some((member)=>member.id===row.sourceId)&&row.state!=="READER_ELIGIBLE")};
});
const artifact={rule:"Bounded recheck of the existing NJ wire's held seat-count reference after exact duplicate/non-person dispositions. The discovery seat reference is a diagnostic input, not newly promoted reader truth. Valid named people stay visible; a deficit is an OURS identity/completeness gap, never a publisher absence.",referencePath:path,referenceSha256:createHash("sha256").update(bytes).digest("hex"),rows};
writeFileSync("docs/evidence/reader-last-mile-roster-completeness.json",JSON.stringify(artifact,null,2)+"\n");
console.log(JSON.stringify(rows.map(({slug,rawCount,projectedCount,declaredSeats,comparedCount,missingSeats})=>({slug,rawCount,projectedCount,declaredSeats,comparedCount,missingSeats}))));
