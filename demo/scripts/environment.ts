import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const origin = process.env.E2E_BASE_URL ?? 'http://localhost:' + (process.env.WEB_PORT ?? '5173');

export function compose(...args: string[]) {
  return execFileSync('docker', ['compose', '--file', root + 'compose.yaml', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

export function requireTestEnvironment() {
  if (!/^horizonte-e2e(?:-[a-z0-9]+)*$/.test(process.env.COMPOSE_PROJECT_NAME ?? '') ||
      process.env.ALLOW_TEST_RESET !== '1') {
    throw Error('Source demo/test-env.sh in a test terminal before resetting data or injecting test failures.');
  }
  const url = new URL(origin);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== process.env.WEB_PORT) {
    throw Error('E2E_BASE_URL must use the selected test stack’s loopback WEB_PORT.');
  }
}
