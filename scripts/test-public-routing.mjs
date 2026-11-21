// On-demand, read-only production routing regression. No subscriptions,
// incident mutations, authentication or notification delivery.
import { spawn } from 'node:child_process';

const hosts = ['status.sessions.gg', 'status.monkeylabs.gg'];
const paths = ['/', '/history', '/api/summary.json', '/uptime.txt'];
const results = [];

async function probe(host, path, round) {
  const result = await new Promise(resolve => {
    const child = spawn('curl', [
      '--silent', '--show-error', '--max-time', '10', '--output', '/dev/null',
      '--write-out', '%{json}', `https://${host}${path}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.once('error', () => resolve({ host, path, round, passed: false, error: 'curl unavailable' }));
    child.once('close', exitCode => {
      let timing;
      try { timing = JSON.parse(output); }
      catch { resolve({ host, path, round, passed: false, error: 'invalid probe output' }); return; }
      resolve({ host, path, round, passed: exitCode === 0 && timing.http_code === 200,
        exitCode, status: timing.http_code, remoteIP: timing.remote_ip,
        connectSeconds: timing.time_connect, tlsSeconds: timing.time_appconnect,
        firstByteSeconds: timing.time_starttransfer, totalSeconds: timing.time_total });
    });
  });
  results.push(result);
  console.log(JSON.stringify(result));
}

// Two concurrent requests, twenty-four total. Do not retry away a failed sample.
for (let round = 1; round <= 3; round++) {
  for (const path of paths) await Promise.all(hosts.map(host => probe(host, path, round)));
}
const failed = results.filter(result => !result.passed).length;
console.log(JSON.stringify({ probes: results.length, failed, passed: failed === 0 }));
process.exitCode = failed === 0 ? 0 : 1;
