#!/usr/bin/env python3
"""Run the built Astro subscription routes against the native Subscribers owner."""
import argparse
import base64
from contextlib import closing
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
from urllib.parse import urlsplit
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app', type=Path, required=True, help='Astro app directory with a STATUS_ADAPTER=node build')
parser.add_argument('--owner', type=Path, required=True, help='path to the standalone native Bananapulse status executable')
parser.add_argument('--node', default='node', help='Node.js executable')
args = parser.parse_args()
email = 'native-status-fixture@example.test'
secret = 'fixture-email-link-key'
service = 'fixture-status-owner-service-token'
host = 'status.sessions.gg'

def ports():
    with socket.socket() as owner, socket.socket() as web:
        for listener in (owner, web):
            listener.bind(('127.0.0.1', 0))
        return (owner.getsockname()[1], web.getsockname()[1])

def request(port, path, method='GET', body=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=4)
    headers = {'Host': host, 'Content-Type': 'application/json'}
    try:
        connection.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
        response = connection.getresponse()
        return (response.status, response.getheader('Location'), response.read())
    finally:
        connection.close()

def wait(port, path, process, status):
    for _ in range(120):
        if process.poll() is not None:
            raise RuntimeError(f'{process.args[0]} exited with {process.returncode}')
        try:
            if request(port, path)[0] == status:
                return
        except OSError:
            pass
        time.sleep(0.05)
    raise RuntimeError(f'{path} did not return {status}')

def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

def check_subscriptions(app, owner_binary):
    """Exercise the same HTTP requests and durable state on either topology."""
    owner_port, web_port = ports()
    origin = f'http://127.0.0.1:{owner_port}'
    with tempfile.TemporaryDirectory(prefix='status-subscription-') as directory:
        root = Path(directory)
        db_path = root / 'subscribers.db'
        owner_env = {'STATUS_OWNER_ADDR': f'127.0.0.1:{owner_port}', 'STATUS_API_TOKEN': service, 'STATUS_SUBSCRIBER_DB': str(db_path), 'STATUS_MONITOR_DB': str(root / 'monitor.db'), 'STATUS_AUTH_DB': str(root / 'auth.db'), 'STATUS_SOURCE_ADMIN_ENABLED': 'false', 'STATUS_UNSUBSCRIBE_BASE_URL': f'https://{host}/api/unsubscribe', 'STATUS_DELIVERY_ENABLED': 'false'}
        web_env = {'STATUS_API_URL': origin, 'STATUS_SUBSCRIBER_LINK_SECRET': secret, 'STATUS_API_TOKEN': service}
        owner_env['RESEND_API_KEY'] = ''
        web_env.update(HOST='127.0.0.1', PORT=str(web_port), RESEND_API_KEY='')

        def state():
            with closing(sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)) as db:
                return db.execute('SELECT state FROM subscribers WHERE email = ?', (email,)).fetchall()
        owner = subprocess.Popen([owner_binary.resolve()], env={'PATH': os.environ.get('PATH', '')} | owner_env)
        try:
            wait(owner_port, '/healthz', owner, 200)
            web = subprocess.Popen([args.node, 'dist/server/entry.mjs'], cwd=app, env={'PATH': os.environ.get('PATH', '')} | web_env)
            try:
                wait(web_port, '/api/subscribe/confirm', web, 400)
                assert request(web_port, '/api/subscribe/confirm?token=bad') == (404, None, b'Confirmation link not found or already used.')
                for address in ('  ' + email.upper(), email):
                    assert request(web_port, '/api/subscribe', 'POST', {'email': address}) == (200, None, b'{"ok":true}')
                assert state() == [('pending',)]
                with closing(sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)) as db:
                    [(recipient, body)] = db.execute('SELECT recipient, body FROM subscriber_outbox').fetchall()
                assert recipient == email
                link = next((line for line in body.splitlines() if '/api/subscribe/confirm?' in line))
                parsed = urlsplit(link)
                assert request(web_port, parsed.path + '?' + parsed.query) == (302, '/?subscribed=1', b'')
                assert state() == [('confirmed',)]
                digest = hmac.digest(secret.encode(), b'unsubscribe\x00' + email.encode(), hashlib.sha256)
                token = base64.urlsafe_b64encode(digest).decode().rstrip('=')
                for _ in range(2):
                    assert request(web_port, '/api/unsubscribe?token=' + token) == (302, '/?unsubscribed=1', b'')
                assert state() == [('unsubscribed',)]
            finally:
                stop(web)
        finally:
            stop(owner)
check_subscriptions(args.app, args.owner)
print('Current Status subscription HTTP and durable-state assertions passed')
