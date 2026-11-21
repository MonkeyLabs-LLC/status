import type { ServiceStatus } from './types';
import {monitorOwnerProjection} from './admin/monitor-owner';

export interface SummaryNode {id:string;name:string;kind:string;status:ServiceStatus;issueCount:number;incidents:{id:string;title:string;severity:string;status:string;auto:boolean;started:string}[];children:SummaryNode[]}

export async function componentExists(id:string):Promise<boolean>{const p=await monitorOwnerProjection(true);return p.components.some(({component:c})=>c.id===id&&!c.archived);}
export async function isLeafComponent(id:string):Promise<boolean>{const p=await monitorOwnerProjection(true);return p.components.some(({component:c})=>c.id===id&&!c.archived&&(c.kind==='service'||c.kind==='host'));}
