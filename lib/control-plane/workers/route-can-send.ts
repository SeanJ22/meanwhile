import {assertPublicUrl} from '../../hunt/egress.ts';
import type {RouteDescriptor} from '../scheduler/registry.ts';
/** A descriptor with no HTTP request is disposed by the existing dispatcher
 * in its parent. It does not need a disposable acquisition process. */
export function routeCanSend(route:RouteDescriptor|null):boolean {
 if(!route || !['HTTP_GET','HTTP_POST'].includes(route.open.kind))return false;
 try{assertPublicUrl((route.open as {url:string}).url);return true;}catch{return false;}
}
