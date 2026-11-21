import {afterEach,expect,it,vi} from 'vitest';
import {getMonitorProjection,ownerClock,queryMonitor} from './status-client';
import {declaredIncidentID,newOwnerCommand} from './incident-owner';
import {monitorAdminCommand,monitorOwnerProjection} from './admin/monitor-owner';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('captures one clock reading and preserves subsecond command times',()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValueOnce(180100).mockReturnValue(180999);
 expect(ownerClock()).toEqual({at_unix:180,at_unix_micros:180100000});expect(clock).toHaveBeenCalledTimes(1);
 expect(newOwnerCommand('resolve','fixture')).toMatchObject({at_unix:180,at_unix_micros:180999000});
 expect(newOwnerCommand('resolve','fixture',{at_unix:12})).toMatchObject({at_unix:12});
 expect(newOwnerCommand('resolve','fixture',{at_unix:12})).not.toHaveProperty('at_unix_micros');
});
it('preserves explicit historical seconds without inventing current microseconds',()=>{
 const clock=vi.spyOn(Date,'now');expect(ownerClock(12)).toEqual({at_unix:12});expect(clock).not.toHaveBeenCalled();
});
it('sends precise query and command clock fields over the existing owner API',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(180999);
 vi.stubEnv('STATUS_API_URL','http://owner.invalid');vi.stubEnv('STATUS_API_TOKEN','fixture');
 const fetchOwner=vi.fn(async()=>new Response(JSON.stringify({version:'monitor.v1',revision:1}),{status:200}));vi.stubGlobal('fetch',fetchOwner);
 await getMonitorProjection();await queryMonitor('api');await queryMonitor('api',12);await monitorAdminCommand({id:'fixture',kind:'sweep_reconcile'});
 const bodies=fetchOwner.mock.calls.map((call:any)=>JSON.parse(call[1].body));
 expect(bodies[0]).toMatchObject({at_unix:180,at_unix_micros:180999000});expect(bodies[1]).toMatchObject({at_unix:180,at_unix_micros:180999000});
 expect(bodies[2]).toEqual({version:'monitor.v1',component_id:'api',at_unix:12});expect(bodies[3]).toMatchObject({at_unix:180,at_unix_micros:180999000});
});

it('uses the native incident identity after promotion and rejects an absent result',()=>{
 expect(declaredIncidentID({incident_id:'existing-owner-incident'})).toBe('existing-owner-incident');
 expect(()=>declaredIncidentID({})).toThrow('did not return');
});

it('requests a bounded recent-observation owner projection only when asked',async()=>{
 vi.stubEnv('STATUS_API_URL','http://owner.invalid');vi.stubEnv('STATUS_API_TOKEN','fixture');
 const transport=vi.fn(async()=>new Response(JSON.stringify({version:'monitor.v1',revision:1}),{status:200}));vi.stubGlobal('fetch',transport);
 await monitorOwnerProjection(true,10);
 expect(JSON.parse((transport.mock.calls[0] as any)[1].body)).toMatchObject({include_archived:true,include_observations:true,observation_limit:10});
 await expect(monitorOwnerProjection(true,101)).rejects.toThrow('Observation limit');expect(transport).toHaveBeenCalledTimes(1);
});
