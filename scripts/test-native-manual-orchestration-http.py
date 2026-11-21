#!/usr/bin/env python3
"""Exercise real canonical Astro manual actions and durable Go monitor state locally."""
import argparse, importlib.util, json, hashlib, hmac, tempfile, time
from pathlib import Path
from urllib.parse import quote
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
spec=importlib.util.spec_from_file_location('status_http',Path(__file__).with_name('test-native-owner-http.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
def run(a):
 with ExitStack() as stack:
  root=Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='status-manual-http-')));ownerport,web=h.port(),h.port()
  proc=h.launch(stack,[a.owner.resolve()],h.native_owner_settings(root,ownerport),ownerport)
  now=datetime.now(timezone.utc);stamp=int(now.timestamp());seq=0
  def resource(path,body):return h.post_owner(ownerport,path,body)
  def command(kind,**body):
   nonlocal seq
   seq+=1;return resource('/internal/monitor/admin/commands',{'version':'monitor.v1','id':f'manual-fixture-{seq}','kind':kind,'at_unix':int(time.time()),**body})
  def query(at=None):
   ms=int(time.time()*1000) if at is None else at
   return resource('/internal/monitor/query',{'version':'monitor.v1','at_unix':ms//1000,'include_observations':True})
  def evaluation(id,at=None):return next(x['evaluation'] for x in query(at)['components'] if x['component']['id']==id)
  for id,parent,kind in [('sessions','','organization'),('historical-service','sessions','service'),('manual-service','sessions','service'),('confirmed-service','sessions','service'),('move-old','sessions','service'),('move-new','sessions','service'),('move-added','sessions','service'),('promotion-service','sessions','service'),('shared-clear','sessions','service'),('shared-confirmed','sessions','service')]:command('upsert_component',component={'id':id,'parent_id':parent,'name':id,'kind':kind,'fallback_status':'operational','launched':True,'launched_set':True})
  def auth(path,body):return resource(path,{'version':'credential-registry/v1',**body})
  auth('/internal/auth/identities/import',{'request_id':'identity','identity_id':'manual-admin','email':h.ADMIN,'state':'enabled','actor_id':'fixture','imported_at':h.iso(now)})
  expiry=h.iso(now+timedelta(minutes=20));auth('/internal/auth/magic-links/issue',{'request_id':'issue','email':h.ADMIN,'token':'manual-link','issued_at':h.iso(now),'expires_at':expiry})
  consumed=auth('/internal/auth/magic-links/consume',{'request_id':'consume','token':'manual-link','consumed_at':h.iso(now)})
  session='manual-session';auth('/internal/auth/sessions/create',{'request_id':'session','challenge_id':consumed['challenge_id'],'identity_id':'manual-admin','token':session,'issued_at':h.iso(now),'expires_at':expiry})
  cookie={'Cookie':f'status_admin_session={session}.'+hmac.new(h.COOKIE_SECRET.encode(),session.encode(),hashlib.sha256).hexdigest(),'Origin':'http://'+h.HOST}
  h.launch(stack,[a.node,'dist/server/entry.mjs'],{'HOST':'127.0.0.1','PORT':str(web),'ADMIN_EMAIL':h.ADMIN,'ADMIN_SESSION_SECRET':h.COOKIE_SECRET,'STATUS_API_URL':f'http://127.0.0.1:{ownerport}','STATUS_API_TOKEN':h.TOKEN,'STATUS_SUBSCRIBER_LINK_SECRET':h.LINK_SECRET,'STATUS_DELIVERY_ENABLED':'false'},web,cwd=a.app,health='/admin/login')
  def public(path,method='GET',body=None,status=200):return h.response_json(h.request(web,path,method,body,cookie),status)
  assert h.request(web,'/admin',headers=cookie)[0]==200, 'dashboard must render components with no observations'
  historicalID='auto/historical/service/1'
  command('open_incident',import_mode=True,incident={'id':historicalID,'title':'Historical opaque identity','summary':'Preserve imported ID','severity':'moderate','status':'investigating','auto':False,'affects':['historical-service']})
  command('update_incident',update={'id':'historical-timeline-proof','incident_id':historicalID,'at_unix':stamp,'label':'monitoring','body':'Imported incident timeline proof','author':h.ADMIN})
  assert public('/api/admin/incidents/'+quote(historicalID,safe=''))['data']['id']==historicalID
  assert h.request(web,'/incident/'+quote(historicalID,safe=''))[0]==200
  rawIncident=h.request(web,'/incident/'+historicalID)
  assert rawIncident[0]==200 and b'Imported incident timeline proof' in rawIncident[2], f'raw slash incident URL must preserve the imported identity and timeline: HTTP {rawIncident[0]}'
  listing=h.request(web,'/admin/incidents',headers=cookie)
  assert listing[0]==200 and ('/admin/incidents/'+quote(historicalID,safe='')).encode()in listing[2], 'real admin links must encode the imported opaque identity'
  created=public('/api/admin/incidents' ,'POST',{'title':'Manual issue','summary':'Human declaration','severity':'moderate','affects':['manual-service'],'author':'forged@example.test'},201)['data'];id=created['id']
  assert any(x.get('detail')=='manual override by '+h.ADMIN for x in query().get('observations',[])), 'manual observation must retain authenticated server-side author'
  assert evaluation('manual-service')['status']=='degraded','manual declaration must append a manual observation and change the live read model'
  public('/api/admin/incidents/'+quote(id,safe=''),'PATCH',{'severity':'major','note':'Human escalation'})
  assert evaluation('manual-service')['status']=='outage','manual severity escalation must update the manual signal'
  public('/api/admin/incidents/'+quote(id,safe=''),'PATCH',{'status':'monitoring','note':'Human monitoring'})
  assert public('/api/admin/incidents/'+quote(id,safe=''))['data']['status']=='monitoring'
  public('/api/admin/incidents/'+quote(id,safe='')+'/resolve','POST',{'body':'Human all clear'})
  assert evaluation('manual-service')['status']=='operational'
  assert any(x.get('incident_id')==id and x.get('body')=='Human all clear' for x in query().get('incident_updates',[])), 'human resolution note must survive in timeline'
  assert next(x for x in query()['incidents'] if x['id']==id)['status']=='resolved'
  command('open_incident',import_mode=True,incident={'id':'promotion-existing','title':'Existing engine issue','summary':'Preserved engine history','severity':'moderate','status':'investigating','auto':True,'affects':['promotion-service']})
  promoted=public('/api/admin/incidents','POST',{'title':'Human takeover','summary':'Human words','severity':'major','affects':['promotion-service']},201)['data']
  assert promoted['id']=='promotion-existing', 'manual declare must return the promoted existing identity'
  assert not next(x for x in query()['incidents'] if x['id']=='promotion-existing')['auto']
  assert len([x for x in query()['incidents'] if 'promotion-service' in x['affects'] and x['status']!='resolved'])==1
  for sid in ['monitor-a','monitor-b']:
   command('upsert_source',source={'id':sid,'name':sid,'kind':'probe','weight':1,'trusted':sid=='monitor-a','default_ttl_seconds':None})
   command('append_observation',observation={'id':sid+'-down','source_id':sid,'component_id':'confirmed-service','signal':'down','observed_at_unix':stamp-400})
  incident=next(x for x in query()['incidents'] if 'confirmed-service' in x['affects'] and x['status']!='resolved')
  public('/api/admin/incidents/'+quote(incident['id'],safe='')+'/resolve','POST',{'body':'Premature all clear'})
  assert evaluation('confirmed-service')['status']=='outage','manual all clear cannot suppress two corroborating monitors'
  assert next(x for x in query()['incidents'] if x['id']==incident['id'])['status']!='resolved','confirmed outage must remain open'
  command('revoke_source',source_id='monitor-b')
  assert evaluation('confirmed-service')['status']=='operational','manual grace can clear a lone monitor'
  manual=next(x for x in evaluation('confirmed-service')['reads'] if x['kind']=='manual')
  horizon=manual['expires_at_unix']*1000
  # Use precise owner observation projection when present to preserve expiry milliseconds.
  assert evaluation('confirmed-service',horizon-1)['status']=='operational'
  assert evaluation('confirmed-service',horizon+1000)['status']=='outage','expired all clear must restore monitor truth'
  command('open_incident',import_mode=True,incident={'id':'shared-existing','title':'Existing shared issue','summary':'Preserved historical shared record','severity':'major','status':'investigating','auto':False,'affects':['shared-clear','shared-confirmed']})
  shared={'id':'shared-existing'}
  for sid in ['monitor-a','monitor-b']:
   if sid=='monitor-b':command('restore_source',source_id=sid)
   command('append_observation',observation={'id':sid+'-shared-down','source_id':sid,'component_id':'shared-confirmed','signal':'down','observed_at_unix':stamp-400})
  public('/api/admin/incidents/'+quote(shared['id'],safe='')+'/resolve','POST',{'body':'Shared premature all clear'})
  assert evaluation('shared-clear')['status']=='operational'
  assert evaluation('shared-confirmed')['status']=='outage'
  assert next(x for x in query()['incidents'] if x['id']==shared['id'])['status']!='resolved','corrective guard: any confirmed affected component keeps the shared incident open'
  # Correct the old public metadata-only affects edit: transfer manual votes.
  rawToken='manual-api-fixture-token'
  assert auth('/internal/auth/api-tokens/import',{'request_id':'move-token','token_id':'move-token','name':'Manual API fixture','scope':'full','token_digest':hashlib.sha256(rawToken.encode()).hexdigest(),'created_at':h.iso(now)})['created']
  moving=public('/api/admin/incidents','POST',{'title':'Moving human issue','summary':'Move without stale votes','severity':'major','affects':['move-old']},201)['data']
  for sid in ['monitor-a','monitor-b']:
   command('append_observation',observation={'id':sid+'-move-down','source_id':sid,'component_id':'move-old','signal':'down','observed_at_unix':stamp-400})
  moved=h.response_json(h.request(web,'/api/incidents/'+quote(moving['id'],safe=''),'PATCH',{'affects':['move-new'],'author':'forged@example.test'},{'Authorization':'Bearer '+rawToken}))['data']
  assert moved['id']==moving['id'] and moved['affects']==['move-new']
  assert next(r for r in evaluation('move-old')['reads'] if r['kind']=='manual')['signal']=='ok','removed target must receive a bounded manual all-clear'
  assert evaluation('move-old')['status']=='outage','removed target with two confirming monitors must remain visibly down'
  assert evaluation('move-new')['status']=='outage','new affected target must acquire the existing human declaration'
  oldManual=next(r for r in evaluation('move-old')['reads'] if r['kind']=='manual');assert oldManual['expires_at_unix']>int(time.time())+3590
  def manual_rows(component):
   snapshot=query();manualIDs={r['id']for r in snapshot['sources']if r['kind']=='manual'}
   return [r for r in snapshot.get('observations',[])if r['component_id']==component and r['source_id']in manualIDs]
  retained=manual_rows('move-new')
  h.response_json(h.request(web,'/api/incidents/'+quote(moving['id'],safe=''),'PATCH',{'affects':['move-new','move-added']},{'Authorization':'Bearer '+rawToken}))
  assert manual_rows('move-new')==retained,'retained target vote must remain unchanged'
  assert evaluation('move-added')['status']=='outage'
  before=query();assert not any('forged@example.test' in str(x) for x in before.get('observations',[])), 'request payload must not forge the authenticated actor'
  h.stop(proc);h.launch(stack,[a.owner.resolve()],h.native_owner_settings(root,ownerport),ownerport)
  after=query();assert before['revision']==after['revision'];assert before['incidents']==after['incidents']
  assert {x['component']['id']:x['evaluation']['status'] for x in before['components']}=={x['component']['id']:x['evaluation']['status'] for x in after['components']}, 'reopen must preserve live evaluations as well as stored incidents'
  print(json.dumps({'passed':True,'canonicalAdminActions':['create','severity','monitoring','resolve'],'corroborationPreserved':True,'manualGraceExpires':True,'sharedIncidentGuard':'intentional correction to legacy per-component resolution hole','reopenDurability':True,'existingIncidentPromotion':True,'importedOpaqueIncidentIDPreserved':True,'publicAffectsVoteTransfer':'intentional correction to legacy metadata-only move hole','authenticatedAuthorAndNote':True,'ownerSHA256':hashlib.sha256(a.owner.read_bytes()).hexdigest(),'deliveryEnabled':False}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--app',type=Path,required=True);p.add_argument('--owner',type=Path,required=True);p.add_argument('--node',default='node');run(p.parse_args())
