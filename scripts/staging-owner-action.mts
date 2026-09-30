/** Sean's terminal-only staging controls. Never import this command from the app or runner. */
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';

const DATABASE_KEYS=['DATABASE_URL','WTP_CONTROL_PLANE_DATABASE_URL'] as const;
type Environment=Readonly<Record<string,string|undefined>>;
function databaseHost(value:string|undefined):string {
  try {
    const url=new URL(value??'');
    if(!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname)throw Error();
    return url.hostname.toLowerCase();
  } catch {throw new Error('STAGING_DATABASE_URL_REQUIRED');}
}
function endpoint(host:string):string {return host.replace(/-pooler(?=\.)/,'');}

/** Runs before opening a database or loading any gateway writer. Errors contain no credentials. */
export function stagingHosts(env:Environment,staging:Environment):Record<typeof DATABASE_KEYS[number],string> {
  if(env.WTP_DB_ROLE!=='local')throw new Error('STAGING_LOCAL_ROLE_REQUIRED');
  const production=new Set([...Object.entries(staging),...Object.entries(env)].filter(([name,value])=>value &&
    /(?:PROD.*(?:URL|DATABASE)|(?:URL|DATABASE).*PROD)/i.test(name)).map(([,value])=>{
      try{return endpoint(new URL(value!).hostname.toLowerCase());}catch{return '';}
    }));
  const hosts={} as Record<typeof DATABASE_KEYS[number],string>;
  for(const key of DATABASE_KEYS) {
    const actual=databaseHost(env[key]),expected=databaseHost(staging[key]);
    if(production.has(endpoint(actual)))throw new Error('PRODUCTION_DATABASE_REFUSED:'+key);
    if(actual!==expected)throw new Error('STAGING_DATABASE_HOST_MISMATCH:'+key);
    hosts[key]=actual;
  }
  return hosts;
}

export function ownerActions(args:readonly string[]):{check:boolean;ceiling:number|null;resume:boolean} {
  if(args.some(arg=>arg!=='--check' && arg!=='--resume' && !/^--ceiling=\d+(?:\.\d{1,2})?$/.test(arg)))throw Error('Use --check or --ceiling=100 --resume');
  const values=args.filter(arg=>arg.startsWith('--ceiling='));
  if(values.length>1)throw Error('ONE_CEILING_REQUIRED');
  const ceiling=values.length?Number(values[0].slice('--ceiling='.length)):null;
  if(ceiling!==null && (!Number.isFinite(ceiling) || ceiling<=0))throw Error('POSITIVE_CEILING_REQUIRED');
  const resume=args.includes('--resume'),check=args.length===0 || args.includes('--check');
  if(check && (ceiling!==null || resume))throw Error('CHECK_IS_READ_ONLY');
  return {check,ceiling,resume};
}

async function main() {
  const action=ownerActions(process.argv.slice(2));
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const supplied=parseEnv(readFileSync(resolve(root,'../.env.staging'),'utf8'));
  const hosts=stagingHosts(process.env,supplied);
  console.log(JSON.stringify({target:'staging',dbRole:'local',hosts}));
  if(!action.check && (!process.stdin.isTTY || !process.stdout.isTTY))throw Error('OWNER_TERMINAL_REQUIRED: Sean must run write actions himself in an interactive terminal');
  const {createPgRepositories}=await import('../lib/control-plane/repository/pg-store.ts');
  const {readIntents,RESEARCH_INTENT_LOG_KEY}=await import('../lib/control-plane/scheduler/research-policy.ts');
  const {ADMIN_CONFIG_ID,fleetSpendCeilingOverrideUsd}=await import('../lib/control-plane/gateway/admin-config.ts');
  const {resolveRollingCeiling}=await import('../lib/control-plane/fleet-safety.ts');
  // No bootstrap in check mode: even a missing schema is a read failure, never an installation.
  const repos=await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL!,new Date().toISOString(),{skipBootstrap:true});
  const readback=async()=>{
    const [log,config]=await Promise.all([repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY),repos.adminConfig.read(ADMIN_CONFIG_ID)]);
    const pause=readIntents(log).runnerPause;
    console.log(JSON.stringify({runnerPaused:pause.paused,pauseAction:pause.intent?.action??null,
      rollingCeilingUsd:resolveRollingCeiling(fleetSpendCeilingOverrideUsd(config?.value??null)).rollingCeilingUsd}));
  };
  if(action.check){await readback();return;}
  const {submit}=await import('../lib/control-plane/gateway/gateway.ts');
  const now=()=>new Date().toISOString(),stamp=Date.now();
  const actions:[string,Record<string,unknown>][]=[];
  if(action.ceiling!==null)actions.push(['config.setFleetSpendCeiling',{rollingCeilingUsd:action.ceiling}]);
  if(action.resume)actions.push(['runner.resume',{note:'Sean at the terminal: resume staging only; production stays paused.'}]);
  for(const [type,input] of actions) {
    const result=await submit({type,subject:'staging runner',input,stateVersion:null,idempotencyKey:`staging-owner-${stamp}-${type}`,
      caller:'OWNER_SESSION',actorRef:'Sean at the terminal (staging-owner-action)'},
      {repos,now,currentStateVersion:null,codeSha:null,recordReview:null});
    console.log(JSON.stringify({type,outcome:result.receipt.outcome,refusal:result.receipt.refusal,says:result.receipt.says}));
    if(!result.ok)throw Error('OWNER_ACTION_REFUSED: later actions were not submitted');
  }
  await readback();
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error instanceof Error?error.message:'STAGING_OWNER_ACTION_FAILED');process.exitCode=1;});
}
