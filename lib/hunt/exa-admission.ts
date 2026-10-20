import {ADMIN_CONFIG_ID} from '../control-plane/gateway/admin-config.ts';
import {EXA_AGENT_LANE_SETTING} from './settings.ts';
import {readSetting} from '../control-plane/settings.ts';
import type {ControlPlaneRepositories} from '../control-plane/repository/types.ts';
/** An available hunter is used unless Sean explicitly disabled it. This read
 * changes no saved setting and grants no spending authority. */
export async function exaAgentEnabled(repos:Pick<ControlPlaneRepositories,'adminConfig'>):Promise<boolean>{
 const row=await repos.adminConfig.read(ADMIN_CONFIG_ID);
 return readSetting(row?.value??null,EXA_AGENT_LANE_SETTING,true);
}
