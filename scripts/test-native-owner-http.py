#!/usr/bin/env python3
"""Compare Status Astro routes against native and historical owner services."""
import argparse
import base64
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
TOKEN = 'status-differential-service-credential-fixture'
ADMIN = 'admin@example.test'
COOKIE_SECRET = 'status-differential-cookie-secret-fixture'
LINK_SECRET = 'fixture-subscriber-link-key'
SUBSCRIBER = 'fixture-status-subscriber@example.test'
HOST = 'status.sessions.gg'
NOW = datetime.now(timezone.utc).replace(microsecond=0)
DB = 'postgres://fixture@127.0.0.1:1/legacy?connect_timeout=1'

def request(port, path, method='GET', payload=None, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    try:
        connection.request(method, path, json.dumps(payload) if payload is not None else None, {'Host': HOST, 'Content-Type': 'application/json', **(headers or {})})
        result = connection.getresponse()
        return (result.status, result.getheader('Location'), result.read())
    finally:
        connection.close()

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

def launch(stack, command, settings, listen, cwd=None, health='/health', health_status=200):
    process = subprocess.Popen(command, cwd=cwd, env={'PATH': os.environ.get('PATH', ''), 'NODE_ENV': 'production', 'RESEND_API_KEY': '', **settings})
    stack.callback(stop, process)
    for _ in range(120):
        if process.poll() is not None:
            raise RuntimeError(f'{command[0]} exited with {process.returncode}')
        try:
            if request(listen, health)[0] == health_status:
                return process
        except OSError:
            pass
        time.sleep(0.05)
    raise RuntimeError(f'{command[0]} did not serve {health}')

def iso(value):
    return value.isoformat().replace('+00:00', 'Z')

def response_json(result, status=200):
    if result[0] != status:
        raise AssertionError(f'expected HTTP {status}, got {result[0]} {result[2][:800]!r}')
    return json.loads(result[2])

def post_owner(port, path, payload):
    return response_json(request(port, path, 'POST', payload, {'Authorization': 'Bearer ' + TOKEN}))

def native_owner_settings(root, monitor):
    return {'STATUS_OWNER_ADDR': f'127.0.0.1:{monitor}', 'STATUS_API_TOKEN': TOKEN, 'STATUS_SUBSCRIBER_DB': str(root / 'subscribers.db'), 'STATUS_MONITOR_DB': str(root / 'monitor.db'), 'STATUS_AUTH_DB': str(root / 'auth.db'), 'STATUS_SOURCE_SAGA_DB': str(root / 'source-sagas.db'), 'STATUS_UNSUBSCRIBE_BASE_URL': f'https://{HOST}/api/unsubscribe', 'STATUS_DELIVERY_ENABLED': 'false'}

def run(args, root=None):
    app = args.app
    with ExitStack() as stack:
        if root is None:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='status-owner-parity-')))
        web, monitor = (port(), port())

        def public_request(path, *args, **kwargs):
            head = path.split('?', 1)[0]
            return request(web, path, *args, **kwargs)
        env = {'HOST': '127.0.0.1', 'PORT': str(web), 'ADMIN_SESSION_SECRET': COOKIE_SECRET, 'ADMIN_EMAIL': ADMIN, 'DATABASE_URL': DB, 'STATUS_DELIVERY_ENABLED': 'false'}
        owner_process = launch(stack, [args.owner.resolve()], native_owner_settings(root, monitor), monitor)
        env.update(STATUS_API_URL=f'http://127.0.0.1:{monitor}', STATUS_API_TOKEN=TOKEN, STATUS_SUBSCRIBER_LINK_SECRET=LINK_SECRET)

        def monitor_command(command):
            path = '/internal/monitor/admin/commands'
            return post_owner(monitor, path, {'version': 'monitor.v1', 'at_unix': int(NOW.timestamp()), **command})
        root_component = 'sessions'
        for component, parent, kind in [(root_component, '', 'organization'), ('fixture-api', root_component, 'service')]:
            assert monitor_command({'kind': 'upsert_component', 'id': 'component-' + component, 'component': {'id': component, 'parent_id': parent, 'name': 'Fixture ' + component, 'kind': kind, 'fallback_status': 'operational', 'launched': True, 'launched_set': True}})['revision'] > 0
        now_unix = int(NOW.timestamp())
        assert monitor_command({'id': 'incident-open', 'kind': 'open_incident', **{'import_mode': True}, 'incident': {'id': 'fixture-incident', 'title': 'Fixture API outage', 'summary': 'Fixture outage text.', 'status': 'investigating', 'severity': 'moderate', 'affects': ['fixture-api'], 'started_at_unix': now_unix, 'created_at_unix': now_unix}})['revision'] > 0
        assert monitor_command({'id': 'incident-update', 'kind': 'update_incident', 'update': {'id': 'fixture-update', 'incident_id': 'fixture-incident', 'at_unix': now_unix, 'label': 'monitoring', 'body': 'Fixture incident timeline.', 'author': ADMIN}})['revision'] > 0
        assert monitor_command({'id': 'maintenance-add', 'kind': 'schedule_maintenance', 'maintenance': {'id': 'fixture-maintenance', 'title': 'Fixture API maintenance', 'summary': 'Fixture maintenance text.', 'kind': 'scheduled', 'scheduled_start_unix': now_unix + 3600, 'scheduled_end_unix': now_unix + 7200, 'created_at_unix': now_unix, 'affects': ['fixture-api']}})['revision'] > 0

        def auth_command(path, body):
            return post_owner(monitor, path, {'version': 'credential-registry/v1', **body})
        assert auth_command('/internal/auth/identities/import', {'request_id': 'identity', 'identity_id': 'fixture-admin', 'email': ADMIN, 'state': 'enabled', 'actor_id': 'fixture', 'imported_at': iso(NOW)})['imported']
        expiry = iso(NOW + timedelta(minutes=20))
        issued = auth_command('/internal/auth/magic-links/issue', {'request_id': 'issue', 'email': ADMIN, 'token': 'fixture-magic', 'issued_at': iso(NOW), 'expires_at': expiry})
        assert issued['accepted'] and issued['deliver']
        consumed = auth_command('/internal/auth/magic-links/consume', {'request_id': 'consume', 'token': 'fixture-magic', 'consumed_at': iso(NOW)})
        assert consumed['authenticated']
        session = 'fixture-admin-session'
        assert auth_command('/internal/auth/sessions/create', {'request_id': 'session', 'challenge_id': consumed['challenge_id'], 'identity_id': 'fixture-admin', 'token': session, 'issued_at': iso(NOW), 'expires_at': expiry})['created']
        app_command = [args.node, 'dist/server/entry.mjs']
        web_process = launch(stack, app_command, env, web, cwd=app, health='/')
        for path, needle in {'/': 'Fixture fixture-api', '/history': 'Fixture API outage', '/incident/fixture-incident': 'Fixture incident timeline.', '/feed.atom': 'Fixture API outage', '/feed.xml': 'Fixture API outage'}.items():
            status, _, body = public_request(path)
            if status != 200 or needle.encode() not in body:
                raise AssertionError(f'{path}: HTTP {status}, missing {needle!r}')
        assert b'Fixture API maintenance' in public_request('/')[2]
        feed = response_json(public_request('/feed.json'))
        assert feed['version'] == 'https://jsonfeed.org/version/1.1'
        item = next((item for item in feed['items'] if item['title'] == 'Fixture API outage'))
        assert item['title'] == 'Fixture API outage'
        assert item['content_text'] == 'Fixture incident timeline.'
        assert item['_status'] == {'severity': 'moderate', 'status': 'investigating', 'affects': ['fixture-api'], 'resolved': False}
        observed = {'feed': {key: item[key] for key in ('title', 'content_text', '_status')}}
        flat = response_json(public_request('/api/status.json'))
        summary = response_json(public_request(f'/api/summary.json?scope={root_component}'))
        assert flat['state'] == summary['state'] and flat['status'] == summary['status']
        assert summary['live'] is True
        assert [service['id'] for service in flat['services']] == ['fixture-api']
        assert [incident['id'] for incident in flat['activeIncidents']] == ['fixture-incident']
        assert [maintenance['id'] for maintenance in flat['scheduledMaintenance']] == ['fixture-maintenance']
        assert summary['tree']['id'] == root_component
        assert summary['tree']['children'][0]['id'] == 'fixture-api'
        for service in flat['services']:
            if service['product'] == root_component:
                service['product'] = 'fixture-root'
        summary['tree']['id'] = 'fixture-root'
        assert summary['tree']['name'] == 'Fixture ' + root_component
        summary['tree']['name'] = 'Fixture root'
        summary.pop('generatedAt')
        assert summary['scope'] == root_component
        summary['scope'] = 'fixture-root'
        observed['public_status'] = {'flat': flat, 'summary': summary}
        source_token = 'fixture-monitor-source-token'
        source = post_owner(monitor, '/internal/sources/create', {'version': 'bananapulse.host.source/v1', 'request_id': 'source-fixture-create', 'source': {'id': 'fixture-source', 'name': 'Fixture source', 'kind': 'push', 'weight': 1, 'direct_targets': True}, 'credential_id': 'fixture-source-credential', 'token': source_token, 'created_at': iso(NOW)})
        assert source['completed']
        monitor_command({'id': 'map-fixture-source', 'kind': 'map_source_target', 'mapping': {'id': 'fixture-source-map', 'source_id': 'fixture-source', 'raw_label': 'fixture-api', 'component_id': 'fixture-api'}})
        source_headers = {'Authorization': 'Bearer ' + source_token}
        second_source = post_owner(monitor, '/internal/sources/create', {'version': 'bananapulse.host.source/v1', 'request_id': 'unmapped-source-create', 'source': {'id': 'unmapped-source', 'name': 'Unmapped fixture', 'kind': 'push', 'weight': 1}, 'credential_id': 'unmapped-source-credential', 'token': 'unmapped-source-token', 'created_at': iso(NOW)})
        assert second_source['completed']
        unmapped = public_request('/api/ingest', 'POST', {'target': 'missing-target', 'signal': 'ok'}, {'Authorization': 'Bearer unmapped-source-token'})
        error = response_json(unmapped, 422)['error']
        assert error == {'code': 'unmapped_target', 'message': 'No mapping for target "missing-target" on this source. Add a source_target_map row.'}
        result = response_json(public_request('/api/ingest', 'POST', {'target': 'fixture-api', 'signal': 'ok'}, source_headers), 202)
        observed['ingest_component'] = result['data']['component_id']
        assert observed['ingest_component'] == 'fixture-api'
        signature = hmac.new(COOKIE_SECRET.encode(), session.encode(), hashlib.sha256).hexdigest()
        cookie = {'Cookie': f'status_admin_session={session}.{signature}', 'Origin': f'http://{HOST}'}
        assert monitor_command({'id': 'precision-component-seed', 'kind': 'upsert_component', 'component': {'id': 'precision-component', 'parent_id': root_component, 'name': 'Precision fixture', 'kind': 'service', 'fallback_status': 'operational', 'created_at_unix': 1780517935, 'created_at_unix_micros': 1780517935869949}})['revision'] > 0
        components = response_json(public_request('/api/admin/components', headers=cookie))['data']
        precise_component = next((row for row in components if row['id'] == 'precision-component'))
        assert precise_component['createdAt'] == '2026-06-03T20:18:55.869Z'
        assert monitor_command({'id': 'precision-source-seed', 'kind': 'upsert_source', 'source': {'id': 'precision-source', 'name': 'Precision source', 'kind': 'push', 'weight': 1, 'trusted': False, 'default_ttl_seconds': 0, 'created_at_unix': 1780518004, 'created_at_unix_micros': 1780518004938974}})['revision'] > 0
        sources = response_json(public_request('/api/admin/sources', headers=cookie))['data']
        precise_source = next((row for row in sources if row['id'] == 'precision-source'))
        assert precise_source['createdAt'] == '2026-06-03T20:20:04.938Z'
        print('Actual native component/source admin APIs preserve snapshot fractional timestamp examples')
        before_retired = post_owner(monitor, '/internal/monitor/projection', {})
        retired = ('/api/v1/summary.json', '/api/v1/incidents', '/api/v1/incidents/fixture-incident', '/api/v1/incidents/fixture-incident/timeline', '/api/v1/maintenance', '/api/v1/maintenance/fixture-maintenance', '/api/v1/subscribers', '/api/v1/ingest', '/api/v1/ingest/status-probe', '/api/v1/ingest/grafana', '/api/v1/ingest/uptimerobot', '/api/v1/sweep', '/api/v1/admin/components', '/api/v1/admin/components/fixture-api', '/api/v1/admin/incidents', '/api/v1/admin/incidents/fixture-incident', '/api/v1/admin/incidents/fixture-incident/updates', '/api/v1/admin/incidents/fixture-incident/resolve', '/api/v1/admin/maintenance', '/api/v1/admin/maintenance/fixture-maintenance', '/api/v1/admin/sources', '/api/v1/admin/sources/fixture-source', '/api/v1/admin/sources/fixture-source/map', '/api/v1/admin/subscribers', '/api/v1/admin/subscribers/fixture-subscriber')
        for retired_path in retired:
            for method in ('GET', 'POST', 'PATCH', 'DELETE'):
                reply = public_request(retired_path, method, {'id': 'retired-must-not-execute', 'title': 'Retired route must not mutate', 'email': SUBSCRIBER, 'signal': 'down', 'target': 'fixture-api'}, cookie)
                assert reply[0] == 404, (method, retired_path, reply[0])
        after_retired = post_owner(monitor, '/internal/monitor/projection', {})
        assert before_retired == after_retired, 'retired API requests changed owner state'
        print('Retired public API: 25 paths x 4 methods returned404; owner projection unchanged')
        path = '/api/admin/components'
        response_json(public_request(path), 401)
        response_json(public_request(path, headers=cookie))
        result = public_request(path, 'POST', {'id': 'fixture-admin-service', 'name': 'Created from Astro', 'kind': 'service', 'parentId': root_component}, cookie)
        component = response_json(result, 201)
        observed['component'] = component['data']
        incident = response_json(public_request('/api/admin/incidents', 'POST', {'title': 'Created through Astro', 'summary': 'Fixture owner incident.', 'severity': 'moderate', 'affects': ['fixture-admin-service']}, cookie), 201)['data']
        observed['incident'] = {key: incident[key] for key in ('title', 'severity', 'affects') if key in incident}
        timeline = public_request(f'/api/admin/incidents/{incident['id']}/updates', 'POST', {'label': 'monitoring', 'body': 'Fixture admin update.'}, cookie)
        response_json(timeline, 201)
        maintenance = response_json(public_request('/api/admin/maintenance', 'POST', {'title': 'Created maintenance through Astro', 'summary': 'Fixture owner maintenance.', 'scheduledStart': iso(NOW + timedelta(hours=3)), 'scheduledEnd': iso(NOW + timedelta(hours=4)), 'affects': ['fixture-api']}, cookie), 201)['data']
        deadline = time.monotonic() + 12
        while not any((row['id'] == maintenance['id'] for row in response_json(public_request('/api/admin/maintenance', headers=cookie))['data'])):
            if time.monotonic() >= deadline:
                raise AssertionError('created maintenance not visible in the admin list')
            time.sleep(0.1)
        response_json(public_request(f'/api/admin/maintenance/{maintenance['id']}', 'PATCH', {'summary': 'Updated fixture owner maintenance.'}, cookie))
        deadline = time.monotonic() + 12
        while b'Created through Astro' not in public_request('/history')[2]:
            if time.monotonic() >= deadline:
                raise AssertionError('admin incident not visible in public history')
            time.sleep(0.1)
        projection = post_owner(monitor, '/internal/monitor/projection', {})
        [updated] = [entry for entry in projection['maintenance'] if entry['id'] == maintenance['id']]
        observed['maintenance'] = {key: updated[key] for key in ('title', 'summary', 'affects', 'kind')}
        assert observed['maintenance']['summary'] == 'Updated fixture owner maintenance.'
        assert response_json(public_request('/api/subscribe', 'POST', {'email': SUBSCRIBER})) == {'ok': True}
        for scope in ('read', 'full'):
            raw_token = f'fixture-api-token-{scope}'
            result = auth_command('/internal/auth/api-tokens/import', {'request_id': f'api-token-{scope}', 'token_id': f'api-token-{scope}', 'name': f'Fixture {scope} token', 'scope': scope, 'token_digest': hashlib.sha256(raw_token.encode()).hexdigest(), 'created_at': iso(NOW)})
            assert result['created'] and result['token_id'] == f'api-token-{scope}'
        raw_token = 'fixture-api-token-full'
        full = {'Authorization': 'Bearer ' + raw_token}
        read = {'Authorization': 'Bearer fixture-api-token-read'}
        assert response_json(public_request('/api/maintenance', headers=read))['data']
        response_json(public_request('/api/subscribers', headers=read), 403)
        response_json(public_request('/api/subscribers'), 401)
        subscribers = response_json(public_request('/api/subscribers', headers=full))['data']
        assert any((row['email'] == SUBSCRIBER for row in subscribers))
        assert auth_command('/internal/auth/api-tokens/revoke', {'request_id': 'api-token-revoke', 'token_id': 'api-token-full', 'revoked_at': iso(NOW)})['revoked']
        response_json(public_request('/api/subscribers', headers=full), 401)
        assert auth_command('/internal/auth/sessions/revoke', {'request_id': 'revoke', 'token': session, 'revoked_at': iso(NOW)})['revoked']
        response_json(public_request(path, headers=cookie), 401)
        stop(owner_process)
        flat_unavailable = response_json(public_request('/api/status.json'), 503)
        tree_unavailable = response_json(public_request(f'/api/summary.json?scope={root_component}'), 503)
        assert flat_unavailable == {'status': 'unknown', 'state': 'unknown', 'live': False, 'services': [], 'activeIncidents': [], 'scheduledMaintenance': []}
        assert tree_unavailable['scope'] == root_component
        tree_unavailable['scope'] = 'fixture-root'
        tree_unavailable.pop('generatedAt')
        assert tree_unavailable == {'scope': 'fixture-root', 'status': 'unknown', 'state': 'unknown', 'live': False, 'tree': None}
        observed['owner_unavailable'] = {'flat': flat_unavailable, 'summary': tree_unavailable}
        return observed
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('app', 'owner'):
        parser.add_argument('--' + flag, type=Path, required=True)
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    run(args)
    print('Current Status canonical HTTP, authorization, durable-state and precision assertions passed')
