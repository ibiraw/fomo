/**
 * @file config.test.ts
 * @description Tests for loadConfig: validation, defaults and pairing-token persistence.
 * @author Reborn1987
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { ConfigError } from '../src/core/errors.js';

const dirs: string[] = [];
/** Creates a temp data dir cleaned up after each test. */
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'fomo-cfg-'));
  dirs.push(d);
  return d;
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const base = { SOLANA_RPC_HTTP: 'https://rpc.example', SOLANA_RPC_WSS: 'wss://rpc.example' };

describe('loadConfig', () => {
  it('applies defaults and keeps the same pairing token across loads', () => {
    const DATA_DIR = tempDir();
    const a = loadConfig({ ...base, DATA_DIR });
    expect(a).toMatchObject({ gatewayHost: '127.0.0.1', gatewayPort: 8787, execTimeoutMs: 90_000, dbPath: join(DATA_DIR, 'orders.db') });
    expect(a.pairingToken.length).toBeGreaterThan(20);
    expect(loadConfig({ ...base, DATA_DIR }).pairingToken).toBe(a.pairingToken);
    expect(a.jupiter).toEqual({ url: 'https://lite-api.jup.ag/price/v3', apiKey: null, pollMs: 1500 });
    expect(loadConfig({ ...base, DATA_DIR, JUPITER_API_KEY: 'k' }).jupiter).toMatchObject({ url: 'https://api.jup.ag/price/v3', apiKey: 'k' });
  });

  it('lists every invalid variable', () => {
    expect(() => loadConfig({ SOLANA_RPC_HTTP: 'wss://x', GATEWAY_PORT: '0', DATA_DIR: tempDir() }))
      .toThrow(ConfigError);
    expect(() => loadConfig({ DATA_DIR: tempDir() })).toThrow(/SOLANA_RPC_HTTP.*SOLANA_RPC_WSS/);
  });
});
