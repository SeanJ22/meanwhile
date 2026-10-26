import { factClocks } from "../facts/clocks.ts";
import type { Clocks } from "../facts/publish.ts";
import { observedSourceEveryMs } from "../civic-data/source-change-cadence.ts";
import { CAMPAIGN_FINANCE_PARSER } from "./state-sources.ts";

const MINUTE=60_000,HOUR=60*MINUTE,DAY=24*HOUR;
export interface CampaignProviderClock {
  readonly providerAttemptedAt?:string;
  readonly providerRawHash?:string;
  readonly providerHashBasis?:"SOURCE_CONTENT_V1";
  readonly providerParserVersion?:string;
  readonly providerDescriptorHash?:string;
  readonly providerObservedFrom?:string;
  readonly providerChangedAt?:string;
  readonly providerCheckedAt?:string;
  readonly providerChanges?:number;
}
export interface CampaignStateClock extends CampaignProviderClock {
  readonly startedAt?:string;readonly completedAt?:string;readonly sourceFailedAt?:string;
  readonly heldContinuationPending?:boolean;
  readonly sourceComplete?:boolean;readonly continuationPending?:boolean;readonly sourceDescriptorHash?:string;
}
export const CAMPAIGN_STATE_CLOCK_FIELDS=["startedAt","providerAttemptedAt","heldContinuationPending","completedAt","sourceFailedAt","sourceComplete","continuationPending","sourceDescriptorHash","dependencyHash",
  "providerRawHash","providerHashBasis","providerParserVersion","providerDescriptorHash","providerObservedFrom","providerChangedAt","providerCheckedAt","providerChanges"]as const;
const instant=(value:string|undefined)=>Date.parse(value??"");
const nativeClock=(work:CampaignStateClock|null|undefined)=>!!work&&work.providerHashBasis==="SOURCE_CONTENT_V1"&&
  work.providerParserVersion===CAMPAIGN_FINANCE_PARSER&&work.providerDescriptorHash===work.sourceDescriptorHash&&
  /^[a-f0-9]{64}$/.test(work.providerRawHash??"")&&Number.isFinite(instant(work.providerObservedFrom))&&
  Number.isFinite(instant(work.providerChangedAt))&&Number.isFinite(instant(work.providerCheckedAt))&&
  Number.isSafeInteger(work.providerChanges)&&work.providerChanges!>=0;

/** Actual native bytes, never people/output hashes, move the source's existing clock row. */
export function observeCampaignProvider(previous:CampaignStateClock|null|undefined,input:{
  readonly rawHash?:string;readonly descriptorHash:string;readonly checkedAt:string;readonly complete:boolean;
}):CampaignProviderClock{
  const keys=["providerRawHash","providerHashBasis","providerParserVersion","providerDescriptorHash","providerObservedFrom","providerChangedAt","providerCheckedAt","providerChanges"]as const;
  const held=Object.fromEntries(keys.flatMap(key=>previous?.[key]===undefined?[]:[[key,previous[key]]])) as CampaignProviderClock;
  if(!input.complete||!/^[a-f0-9]{64}$/.test(input.rawHash??"")||!Number.isFinite(instant(input.checkedAt)))return held;
  const comparable=nativeClock(previous)&&previous!.providerDescriptorHash===input.descriptorHash;
  if(comparable&&instant(input.checkedAt)<instant(previous!.providerCheckedAt))return held;
  const changed=comparable&&previous!.providerRawHash!==input.rawHash;
  return{providerRawHash:input.rawHash,providerHashBasis:"SOURCE_CONTENT_V1",providerParserVersion:CAMPAIGN_FINANCE_PARSER,
    providerDescriptorHash:input.descriptorHash,providerObservedFrom:comparable?previous!.providerObservedFrom:input.checkedAt,
    providerChangedAt:!comparable||changed?input.checkedAt:previous!.providerChangedAt,providerCheckedAt:input.checkedAt,
    providerChanges:comparable?previous!.providerChanges!+Number(changed):0};
}

export function campaignMoneyEveryMs(work:CampaignStateClock|null|undefined,clocks:Clocks=factClocks(null)):number{
  const floor=clocks.retryMinutes("money")*MINUTE,window=clocks.windowHours("money")*HOUR;
  if(work?.sourceComplete===false)return floor;
  if(Number.isFinite(instant(work?.sourceFailedAt))&&(!Number.isFinite(instant(work?.providerCheckedAt))||
    instant(work?.sourceFailedAt)>=instant(work?.providerCheckedAt)))return floor;
  const observed=nativeClock(work)?observedSourceEveryMs({rawHash:work!.providerRawHash!,observedFrom:work!.providerObservedFrom!,
    lastChangedAt:work!.providerChangedAt!,changes:work!.providerChanges!,meanChangeMs:work!.providerChanges!>0?
      (instant(work!.providerChangedAt)-instant(work!.providerObservedFrom))/work!.providerChanges!:null},
    {lastSucceededObservedAt:work!.providerCheckedAt}):undefined;
  return Math.max(floor,Math.min(window,observed??DAY));
}

export function campaignMoneyStateNextDue(work:CampaignStateClock|null,at:string,clocks:Clocks=factClocks(null)):number{
  const now=instant(at),started=instant(work?.startedAt),attempted=instant(work?.providerAttemptedAt??work?.startedAt),completed=instant(work?.completedAt),failed=instant(work?.sourceFailedAt);
  if(!Number.isFinite(now))throw Error("CAMPAIGN_MONEY_CLOCK_TIME_INVALID");
  if(!Number.isFinite(attempted)||attempted>now)return now;
  const checked=nativeClock(work)?instant(work!.providerCheckedAt):attempted;
  const floor=clocks.retryMinutes("money")*MINUTE;
  if(Number.isFinite(failed)&&(!nativeClock(work)||failed>=instant(work!.providerCheckedAt)))return failed+floor;
  if(work?.continuationPending===true&&Number.isFinite(completed)&&completed>=started&&completed<=now)return now;
  if(work?.sourceComplete===false)return attempted+floor;
  return checked+campaignMoneyEveryMs(work,clocks);
}
