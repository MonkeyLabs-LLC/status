import {beforeEach,describe,expect,it,vi} from 'vitest';
const owner=vi.hoisted(()=>({projection:vi.fn(),publish:vi.fn(),incident:vi.fn()}));
vi.mock('@/lib/admin-api',()=>({requireAdmin:vi.fn(async()=> 'admin@example.test'),ok:(data:unknown,status=200)=>Response.json({data},{status}),err:(code:string,message:string,status:number)=>Response.json({error:{code,message}},{status})}));
vi.mock('@/lib/admin/monitor-owner',()=>({monitorOwnerProjection:owner.projection}));
vi.mock('@/lib/incident-owner',async original=>({...await original<any>(),publishIncidentCommand:owner.publish,ownerIncident:owner.incident}));
import {POST} from './index';
function ctx(body:unknown){return {request:{json:async()=>body},locals:{}} as any;}
function components(...items:[string,string][]){owner.projection.mockResolvedValue({components:items.map(([id,kind])=>({component:{id,kind}}))});}
beforeEach(()=>{vi.resetAllMocks();components();owner.publish.mockResolvedValue({monitor:{incident_id:"fixture-native-incident"}});owner.incident.mockImplementation(async(id:string)=>({incident:{id,title:'down',summary:'down',severity:'major',status:'investigating',affects:['sessions-api'],started_at_unix:1}}));});
describe('native admin declare leaf validation',()=>{
 it('rejects unknown components before publication',async()=>{const r=await POST(ctx({componentId:'ghost',severity:'major'}));expect(r.status).toBe(400);expect((await r.json()).error.message).toContain('Unknown component');expect(owner.publish).not.toHaveBeenCalled();});
 it('rejects nonleaf components before publication',async()=>{components(['org-root','organization']);const r=await POST(ctx({componentId:'org-root',severity:'major'}));expect(r.status).toBe(400);expect((await r.json()).error.message).toContain('not a leaf');expect(owner.publish).not.toHaveBeenCalled();});
 it('requires at least one affected component',async()=>{expect((await POST(ctx({severity:'major'}))).status).toBe(400);expect(owner.projection).not.toHaveBeenCalled();expect(owner.publish).not.toHaveBeenCalled();});
 it('publishes a valid leaf through the native workflow and returns 201',async()=>{components(['sessions-api','service']);const r=await POST(ctx({componentId:'sessions-api',severity:'major',title:'down'}));expect(r.status).toBe(201);expect(owner.publish).toHaveBeenCalledOnce();expect(owner.publish.mock.calls[0][0]).toMatchObject({kind:'open_incident',incident:{affects:['sessions-api'],severity:'major',auto:false}});});
 it('rejects the entire multi-affects declaration when any component is nonleaf',async()=>{components(['svc-a','service'],['product-b','product']);expect((await POST(ctx({affects:['svc-a','product-b'],severity:'minor'}))).status).toBe(400);expect(owner.publish).not.toHaveBeenCalled();});
});
