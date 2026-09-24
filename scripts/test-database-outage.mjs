// Run against the Node build. All connections stay on loopback; the child gets
// no inherited service credentials and its scheduler is disabled.
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const sockets = new Set();
const database = net.createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  // Accept TCP but never answer the PostgreSQL startup handshake.
});
await new Promise((resolve) => database.listen(0, '127.0.0.1', resolve));
const portProbe = net.createServer();
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
  env: {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    STATUS_ADAPTER: 'netlify', // Node build, but no background scheduler.
    DATABASE_URL: `postgres://test:test@127.0.0.1:${database.address().port}/outage`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (data) => { output += data; });
child.stderr.on('data', (data) => { output += data; });
const exited = once(child, 'exit');
try {
  for (let attempt = 0; ; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      const socket = net.connect(port, '127.0.0.1');
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      }).finally(() => socket.destroy());
      break;
    } catch {
      if (attempt === 99) throw new Error(`Server did not start: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  for (const host of ['status.sessions.gg', 'status.monkeylabs.gg']) {
    for (const path of ['/', '/api/status.json']) {
      const started = performance.now();
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { Host: host },
        signal: AbortSignal.timeout(8000),
      });
      const body = await response.text();
      assert.equal(response.status, 503, `${host}${path}`);
      assert.ok(performance.now() - started < 8000);
      if (path === '/') {
        assert.match(body, /Live status is temporarily unavailable/);
        assert.doesNotMatch(body, /That page doesn.t exist/);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(response.headers.get('Retry-After'), '30');
      } else {
        const status = JSON.parse(body);
        assert.equal(status.status, 'unknown');
        assert.equal(status.live, false);
        assert.deepEqual(status.services, []);
      }
      console.log(`PASS ${host}${path}: bounded 503, no invented health`);
    }
  }
} finally {
  child.kill('SIGTERM');
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
  await exited;
  clearTimeout(killTimer);
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => database.close(resolve));
}
