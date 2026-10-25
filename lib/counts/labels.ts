const labels:Readonly<Record<string,string>>={
  CREATED:"One-off work",STANDING:"Recurring work",REGISTRY_RUNTIME_BINDING:"Government lists",
  CURATED_READER_RECORD:"Published civic records",FEDERAL_CIVIC_RECORD:"Federal records",
  FEC_FUNDING:"Federal campaign money",STATE_CAMPAIGN_FINANCE:"State campaign money",LOCAL_CAMPAIGN_FINANCE:"Local campaign money",
  CANDIDATE_PUBLICATION:"Candidate information",CANDIDATE_PROFILE:"Candidate profiles",BALLOT_CANDIDACY:"Candidates on the ballot",
  PRL_PROFILE:"Public statement profiles",DOTGOV_REFERENCE:"Government websites",OPERATIONAL_REFERENCE:"Source reference information",
};
export function countLabel(value:string):string {
  if(labels[value])return labels[value];
  const words=value.replace(/^fact:/,"facts · ").replace(/^work:/,"work records · ").replace(/^door:/,"sources · ")
    .replace(/^box:/,"findings · ").replaceAll(":"," · ").replaceAll("_"," ").toLowerCase();
  return words.charAt(0).toUpperCase()+words.slice(1);
}
