import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveServerBindConfig } from './serverBindConfig';

test('CLI --port and --host override container PORT=8080 in dev mode', () => {
  const cfg = resolveServerBindConfig(
    ['--port', '3000', '--host', '0.0.0.0'],
    { PORT: '8080', NODE_ENV: 'development', DISABLE_HMR: 'true' }
  );
  assert.deepEqual(cfg, {
    port: 3000,
    host: '0.0.0.0',
    isProd: false,
    disableHmr: true,
  });
});

test('supports --port= and --host= syntax', () => {
  const cfg = resolveServerBindConfig(['--port=3005', '--host=127.0.0.1'], {
    PORT: '8080',
    NODE_ENV: 'development',
  });
  assert.equal(cfg.port, 3005);
  assert.equal(cfg.host, '127.0.0.1');
});

test('ignores inherited PORT=8080 in development mode when no CLI port is given', () => {
  const cfg = resolveServerBindConfig([], {
    PORT: '8080',
    NODE_ENV: 'development',
  });
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.host, '0.0.0.0');
  assert.equal(cfg.isProd, false);
});

test('respects custom dev PORT when it does not collide with 8080', () => {
  const cfg = resolveServerBindConfig([], {
    PORT: '3100',
    NODE_ENV: 'development',
  });
  assert.equal(cfg.port, 3100);
});

test('respects PORT=8080 in production mode (Cloud Run)', () => {
  const cfg = resolveServerBindConfig([], {
    PORT: '8080',
    NODE_ENV: 'production',
  });
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.isProd, true);
});
