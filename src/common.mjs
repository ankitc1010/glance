import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.GLANCE_HOME || path.join(os.homedir(), '.glance');
export const SOCK = path.join(HOME, 'sock');
export const LOG = path.join(HOME, 'chromium.log');
export const PROFILE = path.join(HOME, 'profile');
export const SHOTS = path.join(HOME, 'shots');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends one command to the daemon over its private unix socket.
export function request(cmd, args = {}, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: SOCK, path: '/cmd', method: 'POST', timeout },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          msg.ok ? resolve(msg.result) : reject(new Error(msg.error));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${cmd}: timed out after ${timeout} ms`)));
    req.on('error', reject);
    req.end(JSON.stringify({ cmd, args }));
  });
}
