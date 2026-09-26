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

  it('enables EVM chains that have both RPC URLs and normalizes the EVM wallet', () => {
    const cfg = loadConfig({
      ...base, DATA_DIR: tempDir(),
      BASE_RPC_HTTP: 'https://base.example', BASE_RPC_WSS: 'wss://base.example',
      FOMO_EVM_WALLET: '0x59a1b6CC4Cfc711ce0fa70f48Fef4e4b7Dd2B103',
    });
    expect([...cfg.evm]).toEqual([['base', { http: 'https://base.example', wss: 'wss://base.example' }]]);
    expect(cfg.fomoEvmWallet).toBe('0x59a1b6cc4cfc711ce0fa70f48fef4e4b7dd2b103');
    expect(loadConfig({ ...base, DATA_DIR: tempDir() }).fomoEvmWallet).toBeNull();
    expect(() => loadConfig({ ...base, DATA_DIR: tempDir(), BNB_RPC_HTTP: 'https://bnb.example' })).toThrow(/BNB_RPC_HTTP and BNB_RPC_WSS must be set together/);
    expect(() => loadConfig({ ...base, DATA_DIR: tempDir(), FOMO_EVM_WALLET: '0x12' })).toThrow(/Not a valid EVM address/);
  });
});

describe('loadConfig paywall', () => {
  const pay = { PAY_SOLANA_TREASURY: 'JDY8BeQUPmcRZnYJGVBiU7x71SMbdUECW6NMUdGGKQDg', PAY_EVM_TREASURY: '0x59a1b6CC4Cfc711ce0fa70f48Fef4e4b7Dd2B103' };
  it('is off by default and needs both treasury wallets when on', () => {
    expect(loadConfig({ ...base, DATA_DIR: tempDir() }).paywall).toBeNull();
    expect(() => loadConfig({ ...base, DATA_DIR: tempDir(), PAYWALL_ENABLED: 'true' })).toThrow(/PAY_SOLANA_TREASURY and PAY_EVM_TREASURY/);
    expect(loadConfig({ ...base, ...pay, DATA_DIR: tempDir(), PAYWALL_ENABLED: 'true' }).paywall).toEqual({
      treasury: { solana: pay.PAY_SOLANA_TREASURY, evm: pay.PAY_EVM_TREASURY.toLowerCase() }, token: null, priceUsd: 50, tokenPriceUsd: 35, freeOrders: 3,
    });
  });

  it('takes the token as a token key', () => {
    const cfg = loadConfig({ ...base, ...pay, DATA_DIR: tempDir(), PAYWALL_ENABLED: 'true', PAY_TOKEN: 'base:0x9500AF4F2936AAFFBC72860CE19E8D5ED2E8DB07', FREE_ORDERS: '1' });
    expect(cfg.paywall).toMatchObject({ token: 'base:0x9500af4f2936aaffbc72860ce19e8d5ed2e8db07', freeOrders: 1 });
    expect(() => loadConfig({ ...base, ...pay, DATA_DIR: tempDir(), PAYWALL_ENABLED: 'true', PAY_TOKEN: 'nope' })).toThrow(/PAY_TOKEN/);
  });
});
